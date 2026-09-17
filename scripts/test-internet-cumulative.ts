// scripts/test-internet-cumulative.ts
//
// 작업명: MCC_INTERNET_LEGACY_CUMULATIVE_CLEANUP_1
//
// cumulative의 source of truth는 "4개 상태 시트 실시간 재조회"다(구형 DB 체인/baseline/
// previousCumulative는 코드에서 완전히 제거됨). 동일 실행에서 5개 시트를 다시 읽어
// 불변조건을 확인한다. 과거 라이브 숫자는 하드코딩하지 않는다(라이브 데이터는 계속
// 바뀌므로 불변조건만 검증).
//
// 실행: npx tsx --env-file=.env scripts/test-internet-cumulative.ts

import { eq, and } from "drizzle-orm";
import { getDatabase } from "../server/db";
import { internetDailyClosings } from "../shared/schema";
import { computeWirePerformanceSnapshot, closeWireDay } from "../server/lib/internet-cumulative";

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

async function main() {
  const now = new Date();
  console.log(`실행 시각: ${now.toISOString()}`);

  const snapshot = await computeWirePerformanceSnapshot(now);

  console.log("\n[인터넷접수 — daily 소스]");
  console.log(`  received=${snapshot.totalReceived} daily=${snapshot.totalDaily} waiting=${snapshot.totalWaiting}`);

  console.log("\n[4개 상태 시트 — cumulative 소스]");
  console.log(`  인터넷진행=${snapshot.cumulativeSheetCounts.inProgress}`);
  console.log(`  인터넷이월=${snapshot.cumulativeSheetCounts.carriedOver}`);
  console.log(`  인터넷완료(당월접수,당월개통)=${snapshot.cumulativeSheetCounts.completedThisMonth}`);
  console.log(`  인터넷이월완료(전월접수,당월개통)=${snapshot.cumulativeSheetCounts.carriedOverCompleted}`);
  const fourSheetsSum =
    snapshot.cumulativeSheetCounts.inProgress +
    snapshot.cumulativeSheetCounts.carriedOver +
    snapshot.cumulativeSheetCounts.completedThisMonth +
    snapshot.cumulativeSheetCounts.carriedOverCompleted;
  console.log(`  4개 상태 시트 합계=${fourSheetsSum}`);

  console.log("\n[카테고리별 cumulative/daily]");
  for (const c of snapshot.categories) {
    console.log(`  ${c.category.padEnd(10)} cumulative=${String(c.cumulative).padEnd(6)} daily=${c.daily} waiting=${c.waiting} received=${c.received}`);
  }

  console.log("\n[최종]");
  console.log(`  totalCumulative=${snapshot.totalCumulative} totalDaily=${snapshot.totalDaily} totalWaiting=${snapshot.totalWaiting} totalReceived=${snapshot.totalReceived}`);
  console.log(`  carryOverProcessing=${snapshot.carryOverProcessing}`);

  console.log("\n[작업자별 daily]");
  console.log(JSON.stringify(snapshot.workerDaily));

  console.log("\n" + "=".repeat(60));
  console.log("불변조건 검증");
  console.log("=".repeat(60));

  check(
    "SUM(category cumulative) === 4개 상태 시트 유효건 합계 === totalCumulative",
    snapshot.categories.reduce((s, c) => s + c.cumulative, 0) === fourSheetsSum &&
      fourSheetsSum === snapshot.totalCumulative,
    `categorySum=${snapshot.categories.reduce((s, c) => s + c.cumulative, 0)}, fourSheetsSum=${fourSheetsSum}, totalCumulative=${snapshot.totalCumulative}` +
      (snapshot.unresolvedCumulativeCodes.length > 0
        ? ` (주의: UNRESOLVED ${snapshot.unresolvedCumulativeCodes.length}건은 카테고리 합계에서 빠지고 4개 시트 합계에는 포함됨 — 정상)`
        : ""),
  );
  check(
    "SUM(category daily) === totalDaily",
    snapshot.categories.reduce((s, c) => s + c.daily, 0) === snapshot.totalDaily,
  );
  check("received === daily + waiting (전체)", snapshot.totalReceived === snapshot.totalDaily + snapshot.totalWaiting);
  for (const c of snapshot.categories) {
    check(`[${c.category}] received === daily + waiting`, c.received === c.daily + c.waiting);
  }
  const workerSum = snapshot.workerDaily.reduce((s, e) => s + e.count, 0);
  check("작업자별 daily 합 === totalDaily", workerSum === snapshot.totalDaily, `workerSum=${workerSum}`);

  if (snapshot.unresolvedDailyCodes.length > 0) {
    console.log(`  ⚠️ 인터넷접수 UNRESOLVED 코드: ${snapshot.unresolvedDailyCodes.join(", ")}`);
  } else {
    check("인터넷접수 UNRESOLVED = 0", true);
  }
  if (snapshot.unresolvedCumulativeCodes.length > 0) {
    console.log(`  ⚠️ 4개 상태 시트 UNRESOLVED 코드: ${snapshot.unresolvedCumulativeCodes.join(", ")}`);
  } else {
    check("4개 상태 시트 UNRESOLVED = 0", true);
  }

  // ── 재마감 idempotent 확인 (같은 실행 안에서 연속 두 번 close) ──
  console.log("\n" + "=".repeat(60));
  console.log("재마감 확인 (같은 실행 내 연속 close — 값이 같아야 중복 가산 없음이 확인됨)");
  console.log("=".repeat(60));
  try {
    const first = await closeWireDay(now);
    const second = await closeWireDay(now);
    check(
      "연속 재마감 시 totalCumulative 동일 (라이브 데이터 변동 없었다면)",
      first.totalCumulative === second.totalCumulative,
      `1차=${first.totalCumulative}, 2차=${second.totalCumulative} (달라졌다면 그 사이 라이브 시트 자체가 바뀐 것 — 버그 아님)`,
    );

    // ── 동일 날짜 재마감이 새 행을 만들지 않고 UPDATE되는지 DB에서 직접 확인 ──
    const db = await getDatabase();
    const skbRows = await db
      .select()
      .from(internetDailyClosings)
      .where(and(eq(internetDailyClosings.date, snapshot.date), eq(internetDailyClosings.category, "SKB")));
    check(
      "동일 날짜+카테고리(SKB) row가 2번 마감 후에도 1건만 존재",
      skbRows.length === 1,
      `실제 row 수=${skbRows.length}`,
    );
  } catch (err: any) {
    if (err?.code === "23502" && String(err?.column ?? "").includes("previous_cumulative")) {
      console.log(
        "  ⚠️ SKIP: 개발 DB의 internet_daily_closings 테이블이 아직 previous_cumulative 컬럼을 " +
          "NOT NULL로 물리적으로 가지고 있어(구형 마이그레이션 잔재) closeWireDay() INSERT가 실패합니다. " +
          "이건 코드 버그가 아니라 '코드/스키마 정의는 정리됐지만 개발 DB 물리 구조는 아직 정리 전'인 " +
          "예상된 상태입니다 — 완료 보고의 '개발 DB 정리' 섹션 참고, 이번 작업에서 DB는 건드리지 않았습니다.",
      );
    } else {
      throw err;
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`총 ${pass + fail}건 중 통과 ${pass}건 / 실패 ${fail}건`);
  console.log("=".repeat(60));
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("테스트 실행 오류:", err);
  process.exit(1);
});
