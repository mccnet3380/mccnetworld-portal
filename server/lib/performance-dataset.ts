// server/lib/performance-dataset.ts
//
// 작업명: MCC_VERIFIED_HTML_OUTPUT_PORT_TO_BACKEND_1
//
// Google Sheets → MCC performance calculation → Normalized Performance Dataset
// 하나의 결과를 담당자별 실적 / 전사 공지용 당일실적 / 마감 공지텍스트가 공유한다.
// 같은 항목을 화면마다 다시 계산하지 않는다 — 이 파일은 이미 검증된 기존 함수들을
// 조합만 할 뿐, 새로운 Google Sheets 조회나 새로운 분류/공식을 만들지 않는다.
//
// 조합 대상(전부 기존 검증/확정 로직, 이 파일에서 재구현하지 않음):
// - computeDailyPerformanceSnapshot() (performance-calc.ts) — 모바일 당일/기타업무/유선
// - computeMobileCumulativeRaw()/computeDataUsimDaily() (mobile-cumulative.ts) — 모바일 누적
// - computeWorkerPerformance() (worker-performance.ts) — 담당자별 실적(본업+지원업무/실적률)
// - buildClosingNoticeText() (closing-notice.ts) — 마감 공지텍스트 조립(순수 함수)

import { computeDailyPerformanceSnapshot, type DailyPerformanceSnapshot, type NetworkTotals, type WorkerNetworkRow } from "./performance-calc";
import { computeMobileCumulativeRaw, computeDataUsimDaily, type MobileCumulativeRaw } from "./mobile-cumulative";
import { computeWorkerPerformance, type WorkerPerformanceRow } from "./worker-performance";
import { NOTICE_GROUPS, buildClosingNoticeText, type ClosingNetworkGroup } from "./closing-notice";
import { computeDealerPerformanceMatrix, type DealerPerformanceMatrix } from "./dealer-performance";
import { computeNetworkDetailMatrix, type NetworkDetailMatrix } from "./network-detail-matrix";
import type { WirePerformanceSnapshot } from "./internet-cumulative";

export interface PerformanceDataset {
  date: string;
  mobile: {
    daily: NetworkTotals; // ■당일완료 기준, 기존 검증 완료
    cumulative: MobileCumulativeRaw; // 개통처리부 기준(추적 근거는 mobile-cumulative.ts 참고)
    workerMatrix: WorkerNetworkRow[];
  };
  otherDuty: {
    networkTotals: NetworkTotals;
    workerMatrix: WorkerNetworkRow[];
  };
  internet: WirePerformanceSnapshot | null;
  workers: WorkerPerformanceRow[];
  closing: {
    totalDaily: number;
    groups: ClosingNetworkGroup[];
    noticeText: string;
  };
  /** 마감보고·공지텍스트 화면 오른쪽 "담당판매점별 상세 실적표"(closing.html 기존 구조 그대로) */
  dealerMatrix: DealerPerformanceMatrix;
  /** 전사 공지용 당일실적(performance.html) KT/LG/SK/TOSS 개통 현황 + KT/LG/SK 기타 현황 */
  networkDetail: NetworkDetailMatrix;
}

function buildClosingGroups(dailyTotals: NetworkTotals, cumulative: MobileCumulativeRaw, dataUsimDaily: number): ClosingNetworkGroup[] {
  return NOTICE_GROUPS.map((g) => {
    const entries = g.entries.map((e) => ({
      label: e.label,
      cumulative: cumulative.byCategoryMap[e.cat] || 0,
      daily: dailyTotals.byCategory[e.net][e.cat] || 0,
    }));
    if (g.title === "▶본사") {
      entries.push({ label: "데이터유심", cumulative: cumulative.dataUsimCumulative, daily: dataUsimDaily });
    }
    return { title: g.title, entries };
  });
}

export async function computePerformanceDataset(date: Date): Promise<PerformanceDataset> {
  const [snap, mobileCumulative, dataUsimDaily, dealerMatrix, networkDetail] = await Promise.all([
    computeDailyPerformanceSnapshot(date),
    computeMobileCumulativeRaw(),
    computeDataUsimDaily(date),
    computeDealerPerformanceMatrix(date),
    computeNetworkDetailMatrix(date),
  ]);

  const workers = computeWorkerPerformance(snap.mobileCompleted.workerMatrix, snap.mobileCompleted.totals);
  const groups = buildClosingGroups(snap.mobileCompleted.totals, mobileCumulative, dataUsimDaily);
  const totalDaily = snap.mobileCompleted.totals.합계;
  const noticeText = buildClosingNoticeText({ totalDaily, groups });

  return {
    date: snap.date,
    mobile: {
      daily: snap.mobileCompleted.totals,
      cumulative: mobileCumulative,
      workerMatrix: snap.mobileCompleted.workerMatrix,
    },
    otherDuty: {
      networkTotals: snap.otherDuty.totals,
      workerMatrix: snap.otherDuty.workerMatrix,
    },
    internet: snap.internet,
    workers,
    closing: { totalDaily, groups, noticeText },
    dealerMatrix,
    networkDetail,
  };
}

export type { DailyPerformanceSnapshot };
