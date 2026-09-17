// scripts/inspect-daily-completed.ts
//
// 작업명: MCC_PERFORMANCE_NETWORK_CLASSIFICATION_CONFIRMED_1 (다음 단계)
//
// 목적: ■당일완료 시트의 실제 컬럼 구조/샘플을 확인하기 위한 1회성 진단 스크립트.
// 계산 로직을 확정하지 않고 관찰만 한다.
//
// 실행: npx tsx --env-file=.env scripts/inspect-daily-completed.ts

import { fetchSheetValues } from "../server/lib/google-sheets-client";

async function main() {
  const values = await fetchSheetValues("■당일완료");
  if (values.length === 0) {
    console.log("빈 시트이거나 조회 결과 없음");
    return;
  }
  const header = values[0];
  console.log(`헤더(${header.length}열):`);
  header.forEach((h, i) => console.log(`  [${i}] ${h}`));

  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  console.log(`\n전체 데이터 행수: ${rows.length}`);

  console.log(`\n샘플 8건 (전체 컬럼, 값 있는 것만):`);
  rows.slice(0, 8).forEach((r, i) => {
    console.log(`#${i + 1}:`);
    header.forEach((h, ci) => {
      const v = r[ci];
      if (v !== undefined && String(v).trim() !== "") console.log(`   ${h}: ${v}`);
    });
  });

  const dateIdx = header.findIndex((h) => h.includes("개통일"));
  console.log(`\n'개통일' 추정 컬럼: index=${dateIdx} (${dateIdx >= 0 ? header[dateIdx] : "찾지 못함"})`);
  if (dateIdx >= 0) {
    const variants = ["9/16", "09/16", "9.16"];
    const matched = rows.filter((r) => variants.some((v) => String(r[dateIdx] ?? "").trim().startsWith(v)));
    console.log(`9/16 매칭 행수: ${matched.length}`);
  }
}

main().catch((err) => {
  console.error("진단 스크립트 오류:", err);
  process.exit(1);
});
