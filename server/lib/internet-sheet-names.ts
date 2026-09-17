// server/lib/internet-sheet-names.ts
//
// 작업명: MCC_INTERNET_EXISTING_EXCEL_RULE_TRACE_1
//
// "인터넷완료(9월접수,9월개통)", "인터넷이월완료(8월접수,9월개통)" 같은 시트명은
// 월이 바뀌면 그대로 다음 달 숫자로 바뀐다(연도는 시트명에 포함되지 않음 —
// 파일 자체가 이미 월별로 분리돼 있으므로). 이 함수는 순수하게 "시트 이름을
// 대상 연월 기준으로 계산"하는 유틸이며, 유선 집계 계산 규칙 자체는 포함하지 않는다
// (계산 규칙은 아직 기존 Excel에서 근거를 찾지 못해 미구현).

function monthLabel(date: Date): number {
  return date.getMonth() + 1;
}

function previousMonthLabel(date: Date): number {
  const m = date.getMonth() + 1;
  return m === 1 ? 12 : m - 1;
}

export interface MonthlyInternetSheetNames {
  /** 이번 달 접수 + 이번 달 개통 완료 */
  completedThisMonth: string;
  /** 지난 달 접수 + 이번 달 개통 완료 (이월분) */
  carriedOverCompleted: string;
}

/** 대상 날짜를 기준으로 "인터넷완료(...)"/"인터넷이월완료(...)" 시트명을 동적으로 계산 */
export function buildMonthlyInternetSheetNames(date: Date): MonthlyInternetSheetNames {
  const thisMonth = monthLabel(date);
  const prevMonth = previousMonthLabel(date);
  return {
    completedThisMonth: `인터넷완료(${thisMonth}월접수,${thisMonth}월개통)`,
    carriedOverCompleted: `인터넷이월완료(${prevMonth}월접수,${thisMonth}월개통)`,
  };
}

/** 날짜와 무관하게 항상 같은 이름을 쓰는 시트 (참고용 상수) */
export const STATIC_INTERNET_SHEET_NAMES = {
  receipt: "인터넷접수",
  inProgress: "인터넷진행",
  carriedOver: "인터넷이월",
} as const;
