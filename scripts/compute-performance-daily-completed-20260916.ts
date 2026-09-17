// scripts/compute-performance-daily-completed-20260916.ts
//
// 작업명: MCC_PERFORMANCE_NETWORK_CLASSIFICATION_CONFIRMED_1 (다음 단계)
//
// 목적: ■당일완료(모바일 당일 개통 실적) 9/16 실데이터에
// 검증 완료된 performance-classify.ts (V17 classifyReq 이식) 규칙을 그대로 적용해서
//   1) 통신망(SK/KT/LG)별 총합계
//   2) 작업자별 x 통신망별 매트릭스
// 를 계산해 출력한다. 새 분류 규칙을 만들지 않고 기존 검증된 규칙만 재사용한다.
//
// 실행: npx tsx --env-file=.env scripts/compute-performance-daily-completed-20260916.ts

import { fetchSheetValues } from "../server/lib/google-sheets-client";
import { classifyReq, isUnclassifiedFallback, workerHomeNetwork, type Network } from "../server/lib/performance-classify";

const TARGET_TEXT_VARIANTS = ["9/16", "09/16", "9.16"];
const NETWORKS: Network[] = ["SK", "KT", "LG", "TOSS"];

function isTargetDate(cell: string): boolean {
  const s = String(cell ?? "").trim();
  return TARGET_TEXT_VARIANTS.some((v) => s === v || s.startsWith(v));
}

interface SourceRow {
  worker: string;
  requestPoint: string;
}

async function loadRows(sheetName: string): Promise<SourceRow[]> {
  const values = await fetchSheetValues(sheetName);
  if (values.length === 0) return [];
  const header = values[0];
  const workerIdx = header.indexOf("작업자");
  const dateIdx = header.findIndex((h) => h.includes("개통일"));
  const reqIdx = header.indexOf("요청점");

  const rows = values.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  const out: SourceRow[] = [];
  for (const r of rows) {
    if (!isTargetDate(r[dateIdx])) continue;
    out.push({
      worker: String(r[workerIdx] ?? "").trim(),
      requestPoint: String(r[reqIdx] ?? "").trim(),
    });
  }
  return out;
}

async function main() {
  const rows = await loadRows("■당일완료");
  console.log(`■당일완료 9/16 원본 건수: ${rows.length}건`);

  const unclassified = rows.filter((r) => isUnclassifiedFallback(r.requestPoint));
  if (unclassified.length > 0) {
    console.log(`\n⚠️ KT 기본값으로 떨어진 요청점 ${unclassified.length}건 (수동 확인 필요):`);
    const byReq = new Map<string, number>();
    for (const r of unclassified) byReq.set(r.requestPoint, (byReq.get(r.requestPoint) || 0) + 1);
    for (const [k, v] of byReq) console.log(`   "${k}": ${v}건`);
  } else {
    console.log(`✅ 모든 요청점 값이 SK/LG/KT 중 하나의 명시 키워드에 매칭됨 (기본값 폴백 없음)`);
  }

  const netTotal: Record<string, number> = { SK: 0, KT: 0, LG: 0, TOSS: 0 };
  const netByCategory: Record<string, Map<string, number>> = { SK: new Map(), KT: new Map(), LG: new Map(), TOSS: new Map() };

  for (const r of rows) {
    const c = classifyReq(r.requestPoint);
    netTotal[c.net]++;
    netByCategory[c.net].set(c.cat, (netByCategory[c.net].get(c.cat) || 0) + 1);
  }

  console.log("\n" + "=".repeat(72));
  console.log("통신망별 당일완료 합계 (■당일완료, 9/16)");
  console.log("=".repeat(72));
  for (const net of NETWORKS) {
    if (netTotal[net] === 0) continue;
    console.log(`  ${net}: ${netTotal[net]}건`);
    for (const [cat, cnt] of Array.from(netByCategory[net]).sort((a, b) => b[1] - a[1])) {
      console.log(`      - ${cat}: ${cnt}`);
    }
  }
  console.log(`  합계: ${Object.values(netTotal).reduce((a, b) => a + b, 0)}건 (원본 총 ${rows.length}건과 일치해야 함)`);

  const workerNet = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const c = classifyReq(r.requestPoint);
    if (!workerNet.has(r.worker)) workerNet.set(r.worker, { SK: 0, KT: 0, LG: 0, TOSS: 0, 합계: 0 });
    const rec = workerNet.get(r.worker)!;
    rec[c.net]++;
    rec["합계"]++;
  }

  console.log("\n" + "=".repeat(72));
  console.log("작업자별 x 통신망별 매트릭스 (■당일완료, 9/16)");
  console.log("=".repeat(72));
  console.log(`  ${"작업자".padEnd(12)} ${"소속망".padEnd(6)} ${"SK".padStart(5)} ${"KT".padStart(5)} ${"LG".padStart(5)} ${"합계".padStart(6)}`);
  const sortedWorkers = Array.from(workerNet.entries()).sort((a, b) => b[1]["합계"] - a[1]["합계"]);
  for (const [worker, rec] of sortedWorkers) {
    const home = workerHomeNetwork(worker);
    const supportFlags: string[] = [];
    if (home === "SK" || home === "KT" || home === "LG") {
      for (const net of ["SK", "KT", "LG"]) {
        if (net !== home && rec[net] > 0) supportFlags.push(`${net}지원 ${rec[net]}`);
      }
    }
    console.log(
      `  ${worker.padEnd(12)} ${home.padEnd(6)} ${String(rec.SK).padStart(5)} ${String(rec.KT).padStart(5)} ${String(rec.LG).padStart(5)} ${String(rec["합계"]).padStart(6)}` +
        (supportFlags.length ? `   [${supportFlags.join(", ")}]` : ""),
    );
  }
}

main().catch((err) => {
  console.error("집계 스크립트 오류:", err);
  process.exit(1);
});
