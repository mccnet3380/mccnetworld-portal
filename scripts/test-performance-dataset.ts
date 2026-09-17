// scripts/test-performance-dataset.ts
//
// 작업명: MCC_VERIFIED_HTML_OUTPUT_PORT_TO_BACKEND_1
//
// computePerformanceDataset()의 불변조건 + 기존 검증 로직 회귀를 확인한다.
// 라이브 데이터는 계속 바뀌므로 과거 숫자를 하드코딩해서 비교하지 않는다.
//
// 실행: npx tsx --env-file=.env scripts/test-performance-dataset.ts

import { computePerformanceDataset } from "../server/lib/performance-dataset";
import { NOTICE_GROUPS } from "../server/lib/closing-notice";
import { resolveActiveSpreadsheet } from "../server/lib/spreadsheet-resolver";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function isFiniteNumber(n: unknown): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

async function main() {
  const now = new Date();
  console.log(`실행 시각: ${now.toISOString()}`);

  console.log("\n=== Google Sheets 월 자동탐색 ===");
  const active = await resolveActiveSpreadsheet();
  console.log(`활성 스프레드시트: ${active.name} (${active.targetYearMonth}, resolvedVia=${active.resolvedVia})`);
  check("월 자동탐색 정상 동작(예외 없이 활성 파일 반환)", !!active.id);

  const ds = await computePerformanceDataset(now);

  console.log("\n=== 모바일 당일(■당일완료, 기존 검증 로직) ===");
  console.log(ds.mobile.daily);
  check("모바일 당일 합계 = SK+KT+LG+TOSS", ds.mobile.daily.합계 === ds.mobile.daily.SK + ds.mobile.daily.KT + ds.mobile.daily.LG + ds.mobile.daily.TOSS);

  console.log("\n=== 모바일 누적(개통처리부) ===");
  console.log(`raw=${ds.mobile.cumulative.raw}, 데이터유심 누적=${ds.mobile.cumulative.dataUsimCumulative}`);
  const catSum = ds.mobile.cumulative.byCategory.reduce((s, c) => s + c.count, 0);
  check("카테고리별 누적 합 === raw", catSum === ds.mobile.cumulative.raw, `catSum=${catSum}, raw=${ds.mobile.cumulative.raw}`);

  console.log("\n=== 기타업무(기존 검증 로직) ===");
  console.log(ds.otherDuty.networkTotals);
  check(
    "기타업무 합계 = SK+KT+LG+TOSS",
    ds.otherDuty.networkTotals.합계 ===
      ds.otherDuty.networkTotals.SK + ds.otherDuty.networkTotals.KT + ds.otherDuty.networkTotals.LG + ds.otherDuty.networkTotals.TOSS,
  );

  console.log("\n=== worker × network 매트릭스 ===");
  console.log(`모바일 워커 수=${ds.mobile.workerMatrix.length}, 기타업무 워커 수=${ds.otherDuty.workerMatrix.length}`);
  for (const w of ds.mobile.workerMatrix) {
    check(`[${w.worker}] SK+KT+LG+TOSS === 합계`, w.SK + w.KT + w.LG + w.TOSS === w.합계);
  }

  console.log("\n=== 담당자별 실적 (workers) ===");
  console.log(`worker 수=${ds.workers.length}`);
  for (const w of ds.workers) {
    console.log(
      `  ${w.worker} home=${w.homeNetwork} homeCount=${w.homeCount} support(SK=${w.supportSK},KT=${w.supportKT},LG=${w.supportLG},TOSS=${w.supportTOSS}) ` +
        `totalHandled=${w.totalHandled} officialTotal=${w.homeNetworkOfficialTotal} rate=${w.performanceRate}`,
    );
    check(`[${w.worker}] homeCount+supportTotal === totalHandled`, w.homeCount + w.supportTotal === w.totalHandled);
    check(
      `[${w.worker}] support 4망 합 === supportTotal`,
      w.supportSK + w.supportKT + w.supportLG + w.supportTOSS === w.supportTotal,
    );
    check(`[${w.worker}] totalHandled은 finite number`, isFiniteNumber(w.totalHandled));
    if (w.performanceRate !== null) {
      check(`[${w.worker}] performanceRate는 NaN/Infinity 아님`, isFiniteNumber(w.performanceRate));
    } else {
      check(`[${w.worker}] officialTotal 없거나 0이면 performanceRate=null`, w.homeNetworkOfficialTotal === null || w.homeNetworkOfficialTotal === 0);
    }
  }
  if (ds.workers.length === 0) {
    console.log("  (오늘 라이브 데이터에 모바일 당일완료 작업자가 없어 개별 검증은 스킵 — 구조/함수 자체는 정상 호출됨)");
  }

  console.log("\n=== 유선 (기존 확정 로직, 내부적으로 이미 별도 스크립트에서 18개 검증됨) ===");
  if (ds.internet) {
    console.log(`totalDaily=${ds.internet.totalDaily} totalCumulative=${ds.internet.totalCumulative}`);
    check("유선 received === daily+waiting", ds.internet.totalReceived === ds.internet.totalDaily + ds.internet.totalWaiting);
  } else {
    console.log("  internet=null (Sheets/DB 접근 실패 폴백 — 이번 실행에서는 발생 안 함이 기대값)");
    check("internet 블록이 null로 폴백되지 않음", ds.internet !== null);
  }

  console.log("\n=== 마감 공지텍스트 ===");
  console.log(ds.closing.noticeText);
  check("noticeText가 '합계 : '로 시작", ds.closing.noticeText.startsWith("합계 : "));
  check("noticeText totalDaily가 NaN 아님", isFiniteNumber(ds.closing.totalDaily));
  for (const g of NOTICE_GROUPS) {
    check(`noticeText에 "${g.title}" 포함`, ds.closing.noticeText.includes(g.title));
  }
  check(`noticeText에 "▶본사" 그룹에 데이터유심 포함`, ds.closing.groups.find((g) => g.title === "▶본사")?.entries.some((e) => e.label === "데이터유심") === true);
  check(
    "noticeText 그룹 순서가 NOTICE_GROUPS 순서와 동일(SK→KT→LG→본사)",
    ds.closing.groups.map((g) => g.title).join(",") === NOTICE_GROUPS.map((g) => g.title).join(","),
  );
  check(`설명 문구("당일포함누적/당일") 미포함`, !ds.closing.noticeText.includes("당일포함"));

  const closingEntrySum = ds.closing.groups.flatMap((g) => g.entries).reduce((s, e) => s + e.daily, 0);
  check(
    "noticeText 21개 항목 당일 합 === 합계(첫 줄) — 실제 합계 source 검증",
    closingEntrySum === ds.closing.totalDaily,
    `entrySum=${closingEntrySum}, totalDaily=${ds.closing.totalDaily}`,
  );

  // NaN/Infinity 전수 검사
  console.log("\n=== NaN/Infinity 전수 검사 ===");
  const allNumbers: number[] = [
    ds.closing.totalDaily,
    ...ds.closing.groups.flatMap((g) => g.entries.flatMap((e) => [e.cumulative, e.daily])),
    ...ds.workers.flatMap((w) => [w.homeCount, w.supportTotal, w.totalHandled, w.performanceRate ?? 0]),
  ];
  check("모든 수치 필드가 finite (NaN/Infinity 없음)", allNumbers.every((n) => isFiniteNumber(n)));

  console.log("\n" + "=".repeat(60));
  console.log(`총 ${pass + fail}건 중 통과 ${pass}건 / 실패 ${fail}건`);
  console.log("=".repeat(60));
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("테스트 실행 오류:", err);
  process.exit(1);
});
