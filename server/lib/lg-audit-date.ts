// server/lib/lg-audit-date.ts
//
// 작업명: LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1
//
// "개통처리부" 시트의 "개통일" 셀을 검수일(auditDate)과 정확히(exact) 비교하기 위한 전용 파서.
// 원래 server/lib/performance-calc.ts의 matchesDate()는 셀 값이 대상 날짜 문자열로 "시작"만
// 해도 일치로 처리하는 startsWith 비교를 쓰고 있어(예: 검수일 9/1을 찾을 때 셀 값 "9/17"도
// 매치됨) 감사에서 확인됐다. 당시 LG 검수는 하루 단위 정확 매칭이 핵심이라 그 함수를
// 재사용/수정하지 않고 이 파일에서 완전히 독립적으로 prefix 비교가 전혀 없는 연/월/일
// 정수 비교만 사용하도록 만들었다.
//
// [MCC_PERFORMANCE_EXACT_DATE_MATCHING_ROOT_FIX_1] 이후 동일한 접두어 오매칭 버그가
// performance-calc.ts/personal-performance.ts의 날짜 판정에도 실측으로 확인되어,
// 이 파일의 normalizeLedgerDate()/isSameExactDate()를 performance-calc.ts의
// matchesDate()가 그대로 재사용하도록 변경했다(새 파서를 또 만들지 않음). 이 파일
// 자체의 로직은 무수정이다.

export interface ExactDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  return true;
}

/**
 * "개통처리부"의 "개통일" 셀 값을 연/월/일 정수로 정규화한다.
 * 지원 형식(구분자 - . / 혼용 허용): 9/1, 09/01, 2026-09-01, 2026.9.1
 * 연도가 없는 값(월/일만)은 fallbackYear(검수일의 연도)를 적용한다.
 * 정규화에 실패하면 null — 실패를 다른 날짜로 오인하지 않는다(부분/prefix 일치 절대 없음).
 */
export function normalizeLedgerDate(cell: unknown, fallbackYear: number): ExactDate | null {
  const s = String(cell ?? "").trim();
  if (!s) return null;

  const full = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/);
  if (full) {
    const year = Number(full[1]);
    const month = Number(full[2]);
    const day = Number(full[3]);
    return isValidYmd(year, month, day) ? { year, month, day } : null;
  }

  const monthDayOnly = s.match(/^(\d{1,2})[.\-\/](\d{1,2})$/);
  if (monthDayOnly) {
    const month = Number(monthDayOnly[1]);
    const day = Number(monthDayOnly[2]);
    return isValidYmd(fallbackYear, month, day) ? { year: fallbackYear, month, day } : null;
  }

  return null;
}

/** 두 날짜의 연/월/일이 모두 같은지만 확인한다 — startsWith 등 부분 일치는 절대 사용하지 않는다. */
export function isSameExactDate(a: ExactDate | null, b: ExactDate): boolean {
  if (!a) return false;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}
