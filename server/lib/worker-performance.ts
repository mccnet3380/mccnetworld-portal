// server/lib/worker-performance.ts
//
// 작업명: MCC_VERIFIED_HTML_OUTPUT_PORT_TO_BACKEND_1
//
// 담당자별 실적 — result_management.html("실적관리 V7 실제데이터 검증")에 문서화된
// 확정 공식을 그대로 코드로 연결한다. 새 공식이 아니다:
//
//   개인 실적률 = (소속채널 본업 + 타채널 지원업무 전체) ÷ 소속채널 당일 공식 총수량 × 100
//   "채널 공식 총수량에는 타 채널 지원수량을 합산하지 않는다"
//   "개인 인정실적에는 본인 소속 채널 처리량 + 타 채널 지원 처리량을 모두 합산한다"
//
// 입력 데이터는 이미 존재하는 기존 검증 로직 그대로 재사용한다 — 재구현하지 않는다:
// - workerHomeNetwork()/defaultGroup 이식 (performance-classify.ts)
// - summarizeWorkerNetworkMatrix() (performance-calc.ts) — worker × network 원시 매트릭스
// - "소속채널 당일 공식 총수량" = 기존 NetworkTotals(mobileCompleted.totals)의 해당 망 합계
//   (이 값 자체가 이미 "누가 처리했는지와 무관하게 그 망으로 분류된 전체 건수"라서,
//   타채널 지원 건이 섞여 들어가지 않는다 — 그래서 이 값을 그대로 분모로 쓰면
//   "지원건은 총수량에 미합산"이라는 조건이 별도 로직 없이 자연히 성립한다).
//
// 작업자 이름은 하드코딩하지 않는다 — workerMatrix(실제 Google Sheets 데이터)에서 동적으로 처리.

import type { WorkerNetworkRow, NetworkTotals } from "./performance-calc";
import type { Network } from "./performance-classify";

const NETWORK_KEYS: Network[] = ["SK", "KT", "LG", "TOSS"];

export interface WorkerPerformanceRow {
  worker: string;
  homeNetwork: WorkerNetworkRow["home"];
  homeCount: number;
  supportSK: number;
  supportKT: number;
  supportLG: number;
  supportTOSS: number;
  supportTotal: number;
  totalHandled: number;
  /** 소속망이 SK/KT/LG일 때만 존재(TOSS는 workerHomeNetwork()가 반환하지 않는 값이라 해당 없음) */
  homeNetworkOfficialTotal: number | null;
  /** homeNetworkOfficialTotal이 0/없음이면 null (NaN/Infinity 금지) */
  performanceRate: number | null;
}

function officialTotalFor(home: WorkerNetworkRow["home"], totals: NetworkTotals): number | null {
  if (home === "SK" || home === "KT" || home === "LG") return totals[home];
  return null; // "본사"/"유선"/"기타" — 망별 공식 총수량 개념 자체가 없음
}

/**
 * workerHomeNetwork()로 이미 구해진 home과 summarizeWorkerNetworkMatrix()의 worker×network
 * 원시 매트릭스를 받아 담당자별 실적을 계산한다. Google Sheets를 직접 읽지 않는다(순수 함수).
 */
export function computeWorkerPerformance(matrix: WorkerNetworkRow[], dailyTotals: NetworkTotals): WorkerPerformanceRow[] {
  return matrix.map((row) => {
    const home = row.home;
    const homeCount = NETWORK_KEYS.includes(home as Network) ? row[home as Network] : 0;
    const support: Record<Network, number> = { SK: 0, KT: 0, LG: 0, TOSS: 0 };
    for (const net of NETWORK_KEYS) {
      if (net === home) continue;
      support[net] = row[net];
    }
    const supportTotal = support.SK + support.KT + support.LG + support.TOSS;
    const totalHandled = homeCount + supportTotal;
    const homeNetworkOfficialTotal = officialTotalFor(home, dailyTotals);
    const performanceRate =
      homeNetworkOfficialTotal && homeNetworkOfficialTotal > 0 ? (totalHandled / homeNetworkOfficialTotal) * 100 : null;

    return {
      worker: row.worker,
      homeNetwork: home,
      homeCount,
      supportSK: support.SK,
      supportKT: support.KT,
      supportLG: support.LG,
      supportTOSS: support.TOSS,
      supportTotal,
      totalHandled,
      homeNetworkOfficialTotal,
      performanceRate,
    };
  });
}
