// scripts/compute-performance-network-worker-20260916.ts
//
// 작업명: MCC_PERFORMANCE_LIVE_BASELINE_UPDATE_1
//
// 목적: 2026-09-16 "기타업무"(■변경완료 + 00700결합) 현재 실데이터에
// V17의 classifyReq() 분류 규칙을 그대로 적용해서
//   1) 통신망(SK/KT/LG)별 총합계
//   2) 작업자별 x 통신망별 매트릭스 (지원업무 확인용)
// 를 계산해 출력한다.
//
// 이 스크립트는 결과를 "정답"으로 확정하지 않는다.
// 사용자가 현재 시점 실제 Excel/피벗 결과와 육안 대조하기 위한 보고용 산출물이다.
//
// 실행: npx tsx --env-file=.env scripts/compute-performance-network-worker-20260916.ts

import { fetchSheetValues } from "../server/lib/google-sheets-client";
import { classifyReq, isUnclassifiedFallback, workerHomeNetwork, type Network } from "../server/lib/performance-classify";

const TARGET_TEXT_VARIANTS = ["9/16", "09/16", "9.16"];
const NETWORKS: Network[] = ["SK", "KT", "LG", "TOSS"];

function isTargetDate(cell: string): boolean {
  const s = String(cell ?? "").trim();
  return TARGET_TEXT_VARIANTS.some((v) => s === v || s.startsWith(v));
}

interface SourceRow {
  sheet: string;
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
      sheet: sheetName,
      worker: String(r[workerIdx] ?? "").trim(),
      requestPoint: String(r[reqIdx] ?? "").trim(),
    });
  }
  return out;
}

async function main() {
  const changed = await loadRows("■변경완료");
  const combo = await loadRows("00700결합");
  const all = [...changed, ...combo];

  console.log(`■변경완료 9/16: ${changed.length}건`);
  console.log(`00700결합 9/16: ${combo.length}건`);
  console.log(`기타업무 합계(현재 실데이터 기준): ${all.length}건`);

  // 미분류(폴백) 감지
  const unclassified = all.filter((r) => isUnclassifiedFallback(r.requestPoint));
  if (unclassified.length > 0) {
    console.log(`\n⚠️ 명시 키워드에 걸리지 않고 KT 기본값으로 떨어진 요청점 ${unclassified.length}건 (수동 확인 필요):`);
    const byReq = new Map<string, number>();
    for (const r of unclassified) byReq.set(r.requestPoint, (byReq.get(r.requestPoint) || 0) + 1);
    for (const [k, v] of byReq) console.log(`   "${k}": ${v}건`);
  } else {
    console.log(`\n✅ 모든 요청점 값이 SK/LG/KT 중 하나의 명시 키워드에 매칭됨 (기본값 폴백 없음)`);
  }

  // 통신망별 합계
  const netTotal: Record<string, number> = { SK: 0, KT: 0, LG: 0, TOSS: 0 };
  const netByCategory: Record<string, Map<string, number>> = { SK: new Map(), KT: new Map(), LG: new Map(), TOSS: new Map() };

  for (const r of all) {
    const c = classifyReq(r.requestPoint);
    netTotal[c.net]++;
    netByCategory[c.net].set(c.cat, (netByCategory[c.net].get(c.cat) || 0) + 1);
  }

  console.log("\n" + "=".repeat(72));
  console.log("통신망별 기타업무 합계 (현재 9/16 실데이터, classifyReq 규칙 적용)");
  console.log("=".repeat(72));
  for (const net of NETWORKS) {
    if (netTotal[net] === 0 && net === "TOSS") continue;
    console.log(`  ${net}: ${netTotal[net]}건`);
    for (const [cat, cnt] of netByCategory[net]) {
      console.log(`      - ${cat}: ${cnt}`);
    }
  }
  console.log(`  합계: ${Object.values(netTotal).reduce((a, b) => a + b, 0)}건 (원본 총 ${all.length}건과 일치해야 함)`);

  // 작업자 x 통신망 매트릭스
  const workerNet = new Map<string, Record<string, number>>();
  for (const r of all) {
    const c = classifyReq(r.requestPoint);
    if (!workerNet.has(r.worker)) workerNet.set(r.worker, { SK: 0, KT: 0, LG: 0, TOSS: 0, 합계: 0 });
    const rec = workerNet.get(r.worker)!;
    rec[c.net]++;
    rec["합계"]++;
  }

  console.log("\n" + "=".repeat(72));
  console.log("작업자별 x 통신망별 매트릭스 (지원업무 확인용 — 소속망 ≠ 처리망이면 지원업무)");
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

  console.log("\n이 결과를 현재 시점의 실제 Excel/피벗 결과와 대조해서 알려주세요.");
}

main().catch((err) => {
  console.error("집계 스크립트 오류:", err);
  process.exit(1);
});
