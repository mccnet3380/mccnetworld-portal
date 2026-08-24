/**
 * MCC_SETTLEMENT_POLICY_DATA_UPLOAD_1
 * 누락 채널/요금제 기준으로 policy 업로드용 엑셀 템플릿 생성
 *
 * 실행: npx tsx scripts/generate-policy-template.ts
 *   (로컬 dev DB 또는 APP_ENV=production으로 운영 DB 기준 생성)
 *
 * 출력: output/policy_template_YYYYMMDD.xlsx
 *   - 시트1 '정산정책': 누락 채널/요금제 + 10컬럼 국적형 헤더 (금액 칸 빈칸)
 *   - 시트2 '참고_현황': 채널별 건수/커버 현황 요약
 */

import { readFileSync } from 'fs';
import { mkdirSync, existsSync } from 'fs';
import * as path from 'path';
import pg from 'pg';
import * as XLSX from 'xlsx';

// ── 환경변수 로드 ──────────────────────────────────────────
try {
  const env = readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch { /* .env 없으면 무시 */ }

const raw =
  process.env.APP_ENV === 'production'
    ? process.env.DATABASE_URL_PROD
    : process.env.DATABASE_URL_DEV ?? process.env.DATABASE_URL;

if (!raw) {
  console.error('❌ DB URL 없음');
  process.exit(1);
}
const connectionString = raw.replace(/^DATABASE_URL=/, '').replace(/^"+|"+$/g, '');
const isLocal = /127\.0\.0\.1|localhost/.test(connectionString);

const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
});

async function main() {
  console.log(`\n📊 MCC_SETTLEMENT_POLICY_DATA_UPLOAD_1 — 템플릿 생성 시작`);
  console.log(`   DB: ${connectionString.replace(/:([^:@]+)@/, ':****@')}`);

  // ── [1] activation_records에서 채널+요금제+건수 추출 ──────
  const actResult = await pool.query<{ channel: string; plan_name: string; cnt: number }>(`
    SELECT channel, plan_name, COUNT(*)::int AS cnt
    FROM activation_records
    GROUP BY channel, plan_name
    ORDER BY channel, cnt DESC, plan_name
  `);

  // ── [2] 활성 policy_rows 조회 ─────────────────────────────
  const pvResult = await pool.query(`
    SELECT id, policy_name FROM policy_versions
    WHERE is_active = true
    ORDER BY effective_from DESC LIMIT 1
  `);
  const activePV = pvResult.rows[0] ?? null;

  const prResult = await pool.query(`
    SELECT channel, plan_name
    FROM policy_rows pr
    JOIN policy_versions pv ON pv.id = pr.policy_version_id
    WHERE pv.is_active = true AND pr.is_active = true
  `);
  const coveredSet = new Set<string>(
    prResult.rows.map(r => `${r.channel}::${r.plan_name}`)
  );

  console.log(`   활성 정책 차수: ${activePV ? `id=${activePV.id} "${activePV.policy_name}"` : '없음'}`);
  console.log(`   등록된 policy_rows: ${coveredSet.size}개 조합`);

  // ── [3] 채널별 집계 ──────────────────────────────────────
  interface PlanInfo { plan: string; cnt: number; covered: boolean }
  const byChannel = new Map<string, PlanInfo[]>();
  let totalAct = 0;

  for (const row of actResult.rows) {
    totalAct += row.cnt;
    if (!byChannel.has(row.channel)) byChannel.set(row.channel, []);
    byChannel.get(row.channel)!.push({
      plan: row.plan_name,
      cnt: row.cnt,
      covered: coveredSet.has(`${row.channel}::${row.plan_name}`),
    });
  }

  const channels = [...byChannel.entries()].sort((a, b) => {
    const aTotal = a[1].reduce((s, p) => s + p.cnt, 0);
    const bTotal = b[1].reduce((s, p) => s + p.cnt, 0);
    return bTotal - aTotal;
  });

  // ── [4] 누락 집계 ─────────────────────────────────────────
  let missingChannels = 0;
  let missingPlans = 0;
  let missingActivations = 0;

  for (const [ch, plans] of channels) {
    const hasCovered = plans.some(p => p.covered);
    if (!hasCovered) missingChannels++;
    const missing = plans.filter(p => !p.covered);
    missingPlans += missing.length;
    missingActivations += missing.reduce((s, p) => s + p.cnt, 0);
  }

  console.log(`   activation_records: ${totalAct}건 / ${channels.length}채널 / ${actResult.rows.length}개 (채널+요금제) 조합`);
  console.log(`   누락 채널: ${missingChannels}개 / 누락 요금제: ${missingPlans}개 / 누락 건수: ${missingActivations}건`);

  // ── [5] 시트1: 정산정책 (업로드용 템플릿) ────────────────
  const HEADERS = [
    '채널', '요금제',
    '내국인_신규', '내국인_번이', '외국인_신규', '외국인_번이',
    '결합조건', '부가서비스조건', '가입비조건', '메모',
  ];

  const guide1 = [
    '※ 금액 단위: 만원 소수점 (10.0 = 100,000원 / 47.5 = 475,000원)',
    '', '', '', '', '', '', '', '', '',
  ];
  const guide2 = [
    '※ 빈 금액 셀 = 해당 유형 정책행 미생성 / 빈 조건 셀 = wildcard(모든 조건 적용)',
    '', '', '', '', '', '', '', '', '',
  ];

  const dataRows: any[][] = [];

  // 채널별로 건수 내림차순, 채널 내 요금제는 건수 내림차순
  for (const [ch, plans] of channels) {
    const missingInChannel = plans.filter(p => !p.covered);
    if (missingInChannel.length === 0) continue;

    for (const p of missingInChannel) {
      dataRows.push([
        ch,        // 채널
        p.plan,    // 요금제
        '',        // 내국인_신규 (운영자 입력)
        '',        // 내국인_번이
        '',        // 외국인_신규
        '',        // 외국인_번이
        '',        // 결합조건
        '',        // 부가서비스조건
        '',        // 가입비조건
        `(개통 ${p.cnt}건)`,  // 메모 — 참고용, 업로드 시 지워도 됨
      ]);
    }
  }

  const aoa: any[][] = [HEADERS, guide1, guide2, ...dataRows];

  const ws1 = XLSX.utils.aoa_to_sheet(aoa);
  ws1['!cols'] = [
    { wch: 22 }, { wch: 50 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 22 },
  ];

  // 헤더 행 스타일 (셀 배경 — xlsx는 스타일 제한적이므로 XLSX.utils 사용)
  // 안내행 2~3행에 채널/요금제 셀 회색 처리는 생략 (xlsx 기본)

  // ── [6] 시트2: 참고_현황 ─────────────────────────────────
  const summaryHeaders = ['채널', '전체_요금제수', '등록된_요금제수', '누락_요금제수', '전체_건수', '누락_건수', '커버율'];
  const summaryRows: any[][] = [summaryHeaders];

  for (const [ch, plans] of channels) {
    const total = plans.length;
    const covered = plans.filter(p => p.covered).length;
    const missing = total - covered;
    const totalCnt = plans.reduce((s, p) => s + p.cnt, 0);
    const missingCnt = plans.filter(p => !p.covered).reduce((s, p) => s + p.cnt, 0);
    const coverRate = total > 0 ? `${Math.round(covered / total * 100)}%` : '0%';
    summaryRows.push([ch, total, covered, missing, totalCnt, missingCnt, coverRate]);
  }

  // 합계 행
  const totalPlans = channels.reduce((s, [, p]) => s + p.length, 0);
  const totalCovered = [...coveredSet].filter(k =>
    channels.some(([ch, plans]) => plans.some(p => `${ch}::${p.plan}` === k))
  ).length;
  summaryRows.push([
    '【합계】',
    totalPlans,
    totalCovered,
    totalPlans - totalCovered,
    totalAct,
    missingActivations,
    `${Math.round(totalCovered / totalPlans * 100)}%`,
  ]);

  // 채널별 상세 (요금제별)
  const detailHeaders = ['채널', '요금제', '개통건수', '등록여부'];
  const detailRows: any[][] = [detailHeaders];
  for (const [ch, plans] of channels) {
    for (const p of plans) {
      detailRows.push([ch, p.plan, p.cnt, p.covered ? '✅ 등록됨' : '❌ 미등록']);
    }
  }

  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 8 }];

  const ws3 = XLSX.utils.aoa_to_sheet(detailRows);
  ws3['!cols'] = [{ wch: 22 }, { wch: 50 }, { wch: 10 }, { wch: 12 }];

  // ── [7] 파일 저장 ─────────────────────────────────────────
  const outDir = path.join(process.cwd(), 'output');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const outPath = path.join(outDir, `policy_template_${stamp}.xlsx`);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, '정산정책');
  XLSX.utils.book_append_sheet(wb, ws2, '참고_채널별요약');
  XLSX.utils.book_append_sheet(wb, ws3, '참고_요금제별상세');
  XLSX.writeFile(wb, outPath);

  console.log(`\n✅ 템플릿 생성 완료`);
  console.log(`   파일: ${outPath}`);
  console.log(`   정산정책 시트: ${dataRows.length}행 (누락 채널/요금제)`);
  console.log(`   금액 입력 필요 컬럼: 내국인_신규, 내국인_번이, 외국인_신규, 외국인_번이`);
  console.log(`\n[사용 방법]`);
  console.log(`  1. output/policy_template_${stamp}.xlsx 파일을 열기`);
  console.log(`  2. '정산정책' 시트에서 각 요금제의 금액(만원 단위, 소수점 허용)을 입력`);
  console.log(`     예: 내국인 신규 10만원 → 10.0 입력 / 47.5만원 → 47.5 입력`);
  console.log(`  3. 정책이 없는 요금제(판매점 비수수료 채널 등)는 빈 칸 그대로 두면 건너뜀`);
  console.log(`  4. 결합조건/부가서비스조건/가입비조건 빈 칸 = 모든 조건 적용(wildcard)`);
  console.log(`  5. AdminPanel > 정책 관리 > 정산 정책 엑셀 업로드 > 기존 정책 차수 선택 후 업로드`);

  await pool.end();
}

main().catch(e => {
  console.error('❌', e.message ?? e);
  process.exit(1);
});
