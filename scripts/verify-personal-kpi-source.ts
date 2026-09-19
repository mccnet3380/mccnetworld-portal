// scripts/verify-personal-kpi-source.ts
//
// 작업명: MCC_ACTIVATION_CHANGE_KPI_SOURCE_AUDIT_AND_VISUAL_FINAL_FIX_1
//
// 개인 실적 화면의 개통/변경 KPI denominator가 정확히 무엇으로 구성됐는지(어느 날짜,
// 어느 source, 몇 건) 개발자가 추적할 수 있게 하는 진단 스크립트. Production 일반
// 사용자 화면에는 이 breakdown을 노출하지 않는다 — 이 스크립트는 로컬/개발 검증 전용이다.
// 계산 자체는 새로 만들지 않고 server/lib/personal-performance.ts의 기존 함수
// (computeActivationPerformanceForDates/aggregateForWorker,
// computeChangeWorkForDates/aggregateChangeForWorker)를 그대로 호출한다.
//
// 실행: npx tsx --env-file=.env scripts/verify-personal-kpi-source.ts "<performanceWorkerName>" [YYYY-MM-DD] [YYYY-MM-DD]
// 인자 생략 시 이번 달 1일~오늘을 기본값으로 사용한다.
//
// 개인정보(이름 외 요청점/고객 관련 원문 셀 값 등)는 출력하지 않는다 — 건수만 출력한다.

import {
  createLedgerCache,
  computeActivationPerformanceForDates,
  aggregateForWorker,
  computeChangeWorkForDates,
  aggregateChangeForWorker,
  workerHomeNetwork,
  activationSourceLabel,
  ymd,
} from "../server/lib/personal-performance";

function parseArgDate(v: string | undefined, fallback: Date): Date {
  if (!v) return fallback;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`날짜 형식 오류(YYYY-MM-DD): ${v}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function datesBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

async function main() {
  const workerName = process.argv[2];
  if (!workerName) {
    console.error('사용법: npx tsx --env-file=.env scripts/verify-personal-kpi-source.ts "<performanceWorkerName>" [시작일] [종료일]');
    process.exit(1);
  }

  const today = new Date();
  const monthFirst = new Date(today.getFullYear(), today.getMonth(), 1);
  const startDate = parseArgDate(process.argv[3], monthFirst);
  const endDate = parseArgDate(process.argv[4], today);

  const home = workerHomeNetwork(workerName);
  const dates = datesBetween(startDate, endDate);
  const cache = createLedgerCache();

  console.log(`\n=== 대상: "${workerName}" (home=${home}) ===`);
  console.log(`조회 기간: ${ymd(startDate)} ~ ${ymd(endDate)} (${dates.length}일)`);

  // ── [ACTIVATION] ──────────────────────────────────────────────────────
  console.log("\n--- [ACTIVATION] 날짜별 source/officialTotal ---");
  const actPerDay = await computeActivationPerformanceForDates(dates, today, cache);
  let actOfficialSum = 0;
  for (const day of actPerDay as any[]) {
    const date = new Date(day.date + "T00:00:00");
    const source = activationSourceLabel(date, today);
    const official = home === "SK" || home === "KT" || home === "LG" ? day.totals[home] : null;
    const mine = day.workers.find((w: any) => w.worker === workerName);
    console.log(
      `  ${day.date} [${source}] ${home}공식=${official ?? "-"} 본인=${mine ? mine.homeCount : 0} 지원=${mine ? mine.supportTotal ?? mine.supportSK + mine.supportKT + mine.supportLG + mine.supportTOSS : 0}`,
    );
    if (official != null) actOfficialSum += official;
  }
  const actAgg = aggregateForWorker(actPerDay, workerName, home);
  console.log("\n[ACTIVATION 최종]");
  console.log(`  self(본인)=${actAgg.self}`);
  console.log(`  support(지원 SK/KT/LG/TOSS)=${actAgg.supportSK}/${actAgg.supportKT}/${actAgg.supportLG}/${actAgg.supportTOSS} (합계 ${actAgg.supportTotal})`);
  console.log(`  recognized(numerator)=${actAgg.recognized}`);
  console.log(`  officialTotal(denominator, 날짜별 합산 검증=${actOfficialSum})=${actAgg.officialTotal}`);
  console.log(`  contributionRate=${actAgg.contributionRate?.toFixed(4) ?? "null"}%`);

  // ── [CHANGE] ──────────────────────────────────────────────────────────
  console.log("\n--- [CHANGE] 날짜별 officialTotal(■변경완료+00700결합 합산) ---");
  const chgPerDay = await computeChangeWorkForDates(dates, cache);
  let chgOfficialSum = 0;
  for (const day of chgPerDay as any[]) {
    const official = home === "SK" || home === "KT" || home === "LG" ? day.totals[home] : null;
    const mine = day.workers.find((w: any) => w.worker === workerName);
    console.log(`  ${day.date} ${home}공식=${official ?? "-"} 본인=${mine ? (mine.home === home ? mine[home as "SK" | "KT" | "LG"] : 0) : 0}`);
    if (official != null) chgOfficialSum += official;
  }
  const chgAgg = aggregateChangeForWorker(chgPerDay, workerName, home);
  console.log("\n[CHANGE 최종]");
  console.log(`  self(본인)=${chgAgg.self}`);
  console.log(`  support(지원 SK/KT/LG/TOSS)=${chgAgg.supportSK}/${chgAgg.supportKT}/${chgAgg.supportLG}/${chgAgg.supportTOSS} (합계 ${chgAgg.supportTotal})`);
  console.log(`  recognized(numerator, total)=${chgAgg.total}`);
  console.log(`  officialTotal(denominator, 날짜별 합산 검증=${chgOfficialSum})=${chgAgg.officialTotal}`);
  console.log(`  contributionRate=${chgAgg.contributionRate?.toFixed(4) ?? "null"}%`);

  console.log("\n=== 완료 ===");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
