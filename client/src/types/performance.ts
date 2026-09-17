// client/src/types/performance.ts
//
// 작업명: MCC_PERFORMANCE_SITE_INTEGRATION_1
//
// server/lib/performance-dataset.ts의 PerformanceDataset 응답 구조를 그대로 미러링한다.
// frontend에서 이 타입 외의 새로운 계산/필드를 만들지 않는다 — 표시만 담당.

export type Network = "SK" | "KT" | "LG" | "TOSS";

export interface NetworkTotals {
  SK: number;
  KT: number;
  LG: number;
  TOSS: number;
  합계: number;
  byCategory: Record<Network, Record<string, number>>;
}

export interface WorkerNetworkRow {
  worker: string;
  home: "SK" | "KT" | "LG" | "유선" | "본사" | "기타";
  SK: number;
  KT: number;
  LG: number;
  TOSS: number;
  합계: number;
}

export interface MobileCumulativeCategoryCount {
  net: Network;
  cat: string;
  count: number;
}

export interface MobileCumulativeRaw {
  sourceSheet: string;
  raw: number;
  byCategory: MobileCumulativeCategoryCount[];
  byCategoryMap: Record<string, number>;
  dataUsimSourceSheet: string;
  dataUsimCumulative: number;
}

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
  homeNetworkOfficialTotal: number | null;
  performanceRate: number | null;
}

export interface WireCategoryReport {
  category: string;
  received: number;
  daily: number;
  waiting: number;
  cumulative: number;
}

export interface WireWorkerDailyEntry {
  worker: string;
  requestPoint: string;
  count: number;
}

export interface WirePerformanceSnapshot {
  date: string;
  yearMonth: string;
  categories: WireCategoryReport[];
  totalReceived: number;
  totalDaily: number;
  totalWaiting: number;
  totalCumulative: number;
  workerDaily: WireWorkerDailyEntry[];
  cumulativeSheetCounts: {
    inProgress: number;
    carriedOver: number;
    completedThisMonth: number;
    carriedOverCompleted: number;
  };
  unresolvedDailyCodes: string[];
  unresolvedCumulativeCodes: string[];
  carryOverProcessing: "NOT_USED_BY_DESIGN";
}

export interface ClosingCategoryEntry {
  label: string;
  cumulative: number;
  daily: number;
}

export interface ClosingNetworkGroup {
  title: string;
  entries: ClosingCategoryEntry[];
}

export interface DealerPerformanceRow {
  dealer: string;
  total: number;
  counts: Record<string, number>;
}

export interface DealerPerformanceGroup {
  group: string;
  rows: DealerPerformanceRow[];
  totalRow: DealerPerformanceRow;
}

export interface DealerPerformanceMatrix {
  sourceSheet: string;
  columns: string[];
  groups: DealerPerformanceGroup[];
  grandTotal: DealerPerformanceRow;
  raw: number;
}

export interface DetailWorkerRow {
  worker: string;
  total: number;
  contribution: number;
  categories: Record<string, number>;
}

export interface NetworkDetailTable {
  columns: string[];
  rows: DetailWorkerRow[];
  total: number;
}

export interface NetworkDetailMatrix {
  activation: Record<Network, NetworkDetailTable>;
  extra: Record<"KT" | "LG" | "SK", NetworkDetailTable>;
}

export interface PerformanceDataset {
  date: string;
  mobile: {
    daily: NetworkTotals;
    cumulative: MobileCumulativeRaw;
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
  dealerMatrix: DealerPerformanceMatrix;
  networkDetail: NetworkDetailMatrix;
}
