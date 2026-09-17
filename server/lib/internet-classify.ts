// server/lib/internet-classify.ts
//
// 작업명: MCC_INTERNET_CLASSIFICATION_IMPLEMENT_1
//
// 유선(인터넷) 원본 요청점 코드 → V17 출력 카테고리 매핑.
//
// 근거: MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/performance.html의
// <script id="initialData"> 안에 내장된 실제 스냅샷에서, internet(카테고리 요약)과
// internetByWorker(원본 코드별)를 같은 날짜 데이터로 교차 대조해서 역산한 매핑이다
// (MCC_INTERNET_V17_RULE_TRACE_2 분석 결과, 사용자 확정).
//
// 절대 원칙:
// - 모바일 classifyReq()(performance-classify.ts)를 재사용하지 않는다 — 완전히 별개 체계.
// - SKB와 SKY는 SK로 합치지 않는다. 각자 독립 카테고리.
// - 매핑표에 없는 코드("기타-유선" 포함)는 KT 등으로 임의 귀속하지 않고
//   반드시 UNRESOLVED로 명시적으로 분류한다 (조용히 사라지거나 잘못된 카테고리로
//   집계되는 것을 방지).
// - 당일접수/총누적 "최종 실적 보고" 계산 규칙(performance-calc.ts 연결)은 아직 보류한다
//   (performance-calc.ts의 internet=null 유지).
//
// [MCC_INTERNET_WAITING_AND_DAILY_PERFORMANCE_RULE_1] 사용자 확정 업무 규칙:
// 인터넷접수 시트에 요청점이 존재하는 건 = "당일 접수건수"이지만, 그중 작업자 이름이
// 비어있는 건은 "당일 처리실적"이 아니다. 유선 업무 마감은 18:00, 실적 보고는 20:00이라
// 그 사이 들어온 신규 접수는 시트에 존재해도 실제 처리는 익일 진행되기 때문이다.
// 판정 기준은 시각(18:00)이 아니라 "작업자 이름 존재 여부"다 — 시각 기반 필터링 로직은
// 만들지 않는다. 작업자 이름이 없는 건은 "미배정"이라는 가상 작업자로 집계하지 않고
// "대기" 건수로 분리해서 작업자별 실적/당일 처리실적 총합에서 제외한다.

export type WireCategory =
  | "SKB"
  | "KT"
  | "KT-U"
  | "KT-V"
  | "LG"
  | "LG(소호)"
  | "LGHV-B"
  | "SKY"
  | "KT-선불"
  | "LG-선불";

export const KNOWN_WIRE_CATEGORIES: readonly WireCategory[] = [
  "SKB",
  "KT",
  "KT-U",
  "KT-V",
  "LG",
  "LG(소호)",
  "LGHV-B",
  "SKY",
  "KT-선불",
  "LG-선불",
] as const;

/** MCC_INTERNET_V17_RULE_TRACE_2에서 [확정]/[추정]으로 검증된 원본 코드 → 카테고리 매핑 */
const WIRE_CODE_TO_CATEGORY: Readonly<Record<string, WireCategory>> = {
  "SKB-티": "SKB",

  "KT-탑": "KT",
  "KT-엠": "KT",

  "KT-UI": "KT-U",
  "KT-UIT": "KT-U",

  "KT-VI": "KT-V",
  "KT-VIT": "KT-V",

  "LG-탑": "LG",
  "LG-엠": "LG",

  "LG-탑(소호)": "LG(소호)",
  "LG-엠(소호)": "LG(소호)",

  "LGHV-B": "LGHV-B",
  "LGHV-B 동판": "LGHV-B",

  "SKY-엠": "SKY",
  "SKY-탑": "SKY",

  "KT-선불(M)": "KT-선불",
  "KT-선불(R)": "KT-선불",

  "LG-선불(미)": "LG-선불",
  "LG-선불": "LG-선불",
};

/** 매핑표에 없다는 사실이 이미 확인된 코드 — 근거 없이 임의 배정하지 않고 UNRESOLVED로 유지 */
const KNOWN_UNRESOLVED_CODES: ReadonlySet<string> = new Set(["기타-유선"]);

export interface WireClassification {
  /** trim된 원본 요청점 코드 */
  code: string;
  /** 매핑되면 카테고리, 안 되면 "UNRESOLVED" */
  category: WireCategory | "UNRESOLVED";
  resolved: boolean;
  /** 매핑표에 없던 완전히 새로운 코드인지(=기존에 알려진 미분류 코드가 아닌지) */
  isNewUnknownCode: boolean;
}

function normalize(code: unknown): string {
  return String(code ?? "").trim();
}

/**
 * 원본 유선 요청점 코드를 V17 카테고리로 분류한다.
 * 매핑표에 없는 코드는 절대 임의 기본값(KT 등)으로 떨어뜨리지 않고 UNRESOLVED로 반환한다.
 */
export function classifyWireRequestPoint(rawCode: unknown): WireClassification {
  const code = normalize(rawCode);
  const mapped = WIRE_CODE_TO_CATEGORY[code];

  if (mapped) {
    return { code, category: mapped, resolved: true, isNewUnknownCode: false };
  }

  return {
    code,
    category: "UNRESOLVED",
    resolved: false,
    isNewUnknownCode: !KNOWN_UNRESOLVED_CODES.has(code),
  };
}

// ─────────────────────────────────────────────────────────
// internetByWorker: V17 구조 재현 + 접수/실적/대기 개념 분리
//   행 = 원본 요청점 코드 (그룹핑 안 함)
//   열 = 실제 작업자 이름이 있는 건만 (동적, 하드코딩 없음) + "당일처리실적합계"
//   작업자 이름이 없는 건 → "미배정" 가상 작업자로 집계하지 않고
//     행별 waiting(대기) / 전체 grandWaiting(대기 총합)으로 분리
//   판정 기준은 오직 "작업자 이름 존재 여부" (시각 기반 필터링 없음)
// ─────────────────────────────────────────────────────────

export interface WireEntry {
  worker: string;
  requestPoint: string;
}

export interface WireWorkerRow {
  code: string;
  /** 실제 작업자 이름이 있는 건만. "미배정" 가상 컬럼 없음 */
  counts: Record<string, number>;
  /** 당일 처리실적 (작업자 배정된 건의 합) */
  total: number;
  /** 대기 (작업자 이름 없는 건) */
  waiting: number;
  /** 당일 접수건수 = total + waiting */
  received: number;
}

export interface WireWorkerMatrix {
  /** 실제 작업자 이름만, 가나다순 정렬 ("미배정" 없음 — 하드코딩 없이 입력 데이터에서 동적 생성) */
  workers: string[];
  rows: WireWorkerRow[];
  /** 당일 처리실적 총합 (작업자 배정된 건만) */
  grandTotal: number;
  /** 대기 총합 (작업자 이름 없는 건) */
  grandWaiting: number;
  /** 당일 접수 총합 = grandTotal + grandWaiting */
  grandReceived: number;
}

/**
 * V17 internetByWorker 구조(원본 코드 행 × 동적 작업자 열)를 재현하되,
 * 작업자 이름이 없는 건은 "미배정" 가상 실적으로 집계하지 않고 "대기"로 분리한다.
 * 카테고리로 묶지 않고 원본 코드 그대로 행을 유지한다 (V17 구조 그대로).
 */
export function summarizeWireWorkerMatrix(entries: WireEntry[]): WireWorkerMatrix {
  const workerSet = new Set<string>();
  const byCode = new Map<string, { counts: Map<string, number>; waiting: number }>();

  for (const entry of entries) {
    const code = normalize(entry.requestPoint);
    if (!code) continue;

    if (!byCode.has(code)) byCode.set(code, { counts: new Map(), waiting: 0 });
    const rec = byCode.get(code)!;

    const worker = normalize(entry.worker);
    if (!worker) {
      // 작업자 이름 없음 = 대기. 가상 "미배정" 실적으로 집계하지 않는다.
      rec.waiting++;
      continue;
    }

    workerSet.add(worker);
    rec.counts.set(worker, (rec.counts.get(worker) || 0) + 1);
  }

  const workers = Array.from(workerSet).sort((a, b) => a.localeCompare(b, "ko"));

  const rows: WireWorkerRow[] = Array.from(byCode.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([code, rec]) => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const w of workers) {
        const c = rec.counts.get(w) || 0;
        counts[w] = c;
        total += c;
      }
      return { code, counts, total, waiting: rec.waiting, received: total + rec.waiting };
    });

  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  const grandWaiting = rows.reduce((sum, r) => sum + r.waiting, 0);

  return { workers, rows, grandTotal, grandWaiting, grandReceived: grandTotal + grandWaiting };
}
