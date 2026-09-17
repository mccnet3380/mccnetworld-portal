// scripts/test-internet-classify.ts
//
// 작업명: MCC_INTERNET_CLASSIFICATION_IMPLEMENT_1
//
// 1) 필터링 시트의 유선요청점 유효값 20개 전부를 classifyWireRequestPoint()에 넣어
//    각 코드가 어느 카테고리로 분류되는지 표로 출력 ("기타-유선"은 미분류로 남아야 함).
// 2) 처음 보는 임의의 코드도 UNRESOLVED로 안전하게 떨어지는지 확인.
// 3) 실제 인터넷접수 시트의 작업자/요청점 데이터로 summarizeWireWorkerMatrix()가
//    V17 internetByWorker 구조(원본 코드 행 × 동적 작업자 열 × 당일총합계)를
//    재현하는지 확인.
//
// 실행: npx tsx --env-file=.env scripts/test-internet-classify.ts

import { fetchSheetValues } from "../server/lib/google-sheets-client";
import { classifyWireRequestPoint, summarizeWireWorkerMatrix, KNOWN_WIRE_CATEGORIES } from "../server/lib/internet-classify";

const EXPECTED_20_CODES = [
  "KT-UI", "KT-VI", "KT-UIT", "KT-VIT", "SKB-티", "LGHV-B", "SKY-엠", "LG-엠",
  "LG-엠(소호)", "KT-엠", "LGHV-B 동판", "KT-선불(M)", "KT-선불(R)", "기타-유선",
  "KT-탑", "LG-탑", "SKY-탑", "LG-탑(소호)", "LG-선불(미)", "LG-선불",
];

async function testClassificationTable() {
  console.log("=".repeat(72));
  console.log("1) 필터링 시트 유선요청점 유효값 20개 분류 테스트");
  console.log("=".repeat(72));

  const values = await fetchSheetValues("필터링", "Z1:Z420");
  const liveCodes = values.slice(1).map((r) => String(r[0] ?? "").trim()).filter(Boolean);
  console.log(`실제 스프레드시트에서 읽은 유효값 개수: ${liveCodes.length}`);

  const missing = EXPECTED_20_CODES.filter((c) => !liveCodes.includes(c));
  const extra = liveCodes.filter((c) => !EXPECTED_20_CODES.includes(c));
  if (missing.length) console.log(`⚠️ 지난 분석 때 확인한 값 중 지금 시트에 없는 것: ${missing.join(", ")}`);
  if (extra.length) console.log(`⚠️ 지난 분석 이후 새로 추가된 값: ${extra.join(", ")}`);

  console.log(`\n${"코드".padEnd(16)} → 카테고리`);
  console.log("-".repeat(40));
  let resolvedCount = 0;
  let unresolvedCount = 0;
  for (const code of liveCodes) {
    const result = classifyWireRequestPoint(code);
    console.log(`${code.padEnd(16)} → ${result.category}${result.resolved ? "" : "  ⚠️ 미분류"}`);
    if (result.resolved) resolvedCount++;
    else unresolvedCount++;
  }
  console.log("-".repeat(40));
  console.log(`분류됨: ${resolvedCount} / 미분류: ${unresolvedCount}`);

  const giTaeYuseon = classifyWireRequestPoint("기타-유선");
  console.log(
    `\n"기타-유선" 분류 결과: ${giTaeYuseon.category} (resolved=${giTaeYuseon.resolved}) — ` +
      `${giTaeYuseon.category === "UNRESOLVED" && !giTaeYuseon.resolved ? "✅ 의도대로 미분류" : "❌ 예상과 다름"}`,
  );

  const brandNewCode = classifyWireRequestPoint("XX-신규코드-테스트");
  console.log(
    `처음 보는 신규 코드("XX-신규코드-테스트") 분류 결과: ${brandNewCode.category} ` +
      `(isNewUnknownCode=${brandNewCode.isNewUnknownCode}) — ` +
      `${brandNewCode.category === "UNRESOLVED" ? "✅ KT 등으로 임의 귀속되지 않음" : "❌ 임의 귀속됨(버그)"}`,
  );

  console.log(`\n알려진 카테고리 10개: ${KNOWN_WIRE_CATEGORIES.join(", ")}`);
}

async function testWorkerMatrixStructure() {
  console.log("\n" + "=".repeat(72));
  console.log("2) internetByWorker 구조 재현 테스트 (인터넷접수 실데이터)");
  console.log("=".repeat(72));

  const values = await fetchSheetValues("인터넷접수");
  const header = values[0];
  // "인터넷접수" 시트만 작업자 컬럼(0번째 열)의 헤더 텍스트가 공백이다
  // (인터넷진행/인터넷이월/인터넷완료류 4개 시트는 모두 header[0]="작업자"로 정상).
  // 실데이터 위치(0번째 열)는 동일하므로, 정확한 헤더명이 없을 때만 0번째 열로 폴백한다.
  let workerIdx = header.indexOf("작업자");
  if (workerIdx < 0 && String(header[0] ?? "").trim() === "") {
    console.log('⚠️ "인터넷접수" 시트 헤더[0]이 공백 — "작업자" 컬럼으로 간주하고 0번째 열로 폴백');
    workerIdx = 0;
  }
  const reqIdx = header.indexOf("요청점");
  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  const entries = rows.map((r) => ({
    worker: String(r[workerIdx] ?? "").trim(),
    requestPoint: String(r[reqIdx] ?? "").trim(),
  }));

  const matrix = summarizeWireWorkerMatrix(entries);

  console.log(`작업자 목록(동적 생성, 작업자 이름 있는 건만 — "미배정" 가상 컬럼 없음): ${matrix.workers.join(", ")}`);
  console.log(
    `\n${"요청점(원본코드)".padEnd(18)} ${matrix.workers.map((w) => w.padEnd(10)).join("")}` +
      `${"대기".padEnd(6)}${"당일접수".padEnd(10)}당일처리실적`,
  );
  for (const row of matrix.rows) {
    const line = matrix.workers.map((w) => String(row.counts[w]).padEnd(10)).join("");
    console.log(
      `${row.code.padEnd(18)} ${line}${String(row.waiting).padEnd(6)}${String(row.received).padEnd(10)}${row.total}`,
    );
  }
  console.log(
    `\n당일 처리실적 총합: ${matrix.grandTotal}건 / 대기 총합: ${matrix.grandWaiting}건 / ` +
      `당일 접수 총합: ${matrix.grandReceived}건 (인터넷접수 원본 행수 ${rows.length}건과 비교 — 요청점 공백 행은 제외됨)`,
  );
}

async function main() {
  await testClassificationTable();
  await testWorkerMatrixStructure();
}

main().catch((err) => {
  console.error("테스트 오류:", err);
  process.exit(1);
});
