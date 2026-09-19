// scripts/verify-date-matching.ts
//
// 작업명: MCC_PERFORMANCE_EXACT_DATE_MATCHING_ROOT_FIX_1
//
// server/lib/performance-calc.ts의 matchesDate()가 더 이상 날짜 문자열 접두어(prefix)로
// 오매칭하지 않는지 확인하는 재현 가능한 회귀 테스트. Google Sheets 접근 없이 순수 함수
// matchesDate()만 검증한다(수정 전 버그: "9/1"이 "9/10"~"9/19"의 접두어와도 일치).
//
// 실행: npx tsx scripts/verify-date-matching.ts
import { matchesDate } from "../server/lib/performance-calc";

let failed = 0;
function check(label: string, cell: string, date: Date, expected: boolean) {
  const actual = matchesDate(cell, date);
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: matchesDate("${cell}", ${date.toISOString().slice(0, 10)}) = ${actual} (expected ${expected})`);
}

// 09-01 기준 — 실제 root cause였던 접두어 충돌
const d0901 = new Date(2026, 8, 1);
check("09-01 vs 9/1", "9/1", d0901, true);
check("09-01 vs 09/01", "09/01", d0901, true);
check("09-01 vs 9/10", "9/10", d0901, false);
check("09-01 vs 9/11", "9/11", d0901, false);
check("09-01 vs 9/12", "9/12", d0901, false);
check("09-01 vs 9/19", "9/19", d0901, false);

// 09-02 기준 — 미래(9/20~9/29)와의 잠재적 접두어 충돌
const d0902 = new Date(2026, 8, 2);
check("09-02 vs 9/2", "9/2", d0902, true);
check("09-02 vs 9/20", "9/20", d0902, false);
check("09-02 vs 9/21", "9/21", d0902, false);
check("09-02 vs 9/29", "9/29", d0902, false);

// 09-03 기준 — 9/30과의 접두어 충돌
const d0903 = new Date(2026, 8, 3);
check("09-03 vs 9/3", "9/3", d0903, true);
check("09-03 vs 9/30", "9/30", d0903, false);

// 09-09 vs 09-19 — "9/9"가 "9/19"의 부분 문자열은 아니지만 회귀 확인 차원에서 포함
const d0909 = new Date(2026, 8, 9);
check("09-09 vs 9/9", "9/9", d0909, true);
check("09-09 vs 9/19", "9/19", d0909, false);

// 09-10 — "9/1"과 혼동되면 안 됨(자기 자신만 매치)
const d0910 = new Date(2026, 8, 10);
check("09-10 vs 9/10", "9/10", d0910, true);
check("09-10 vs 9/1", "9/1", d0910, false);

// 09-19 — 자기 자신만 매치
const d0919 = new Date(2026, 8, 19);
check("09-19 vs 9/19", "9/19", d0919, true);
check("09-19 vs 9/1", "9/1", d0919, false);
check("09-19 vs 9/9", "9/9", d0919, false);

// 월 경계 — 10/1이 9/1과 혼동되면 안 됨
const d1001 = new Date(2026, 9, 1);
check("10-01 vs 10/1", "10/1", d1001, true);
check("10-01 vs 9/1", "9/1", d1001, false);

const d1101 = new Date(2026, 10, 1);
check("11-01 vs 11/1", "11/1", d1101, true);

const d1201 = new Date(2026, 11, 1);
check("12-01 vs 12/1", "12/1", d1201, true);

// 연도 경계
const d20261231 = new Date(2026, 11, 31);
check("2026-12-31 vs 12/31", "12/31", d20261231, true);
check("2026-12-31 vs 2026-12-31(전체형식)", "2026-12-31", d20261231, true);

const d20270101 = new Date(2027, 0, 1);
check("2027-01-01 vs 1/1", "1/1", d20270101, true);
check("2027-01-01 vs 2027-01-01(전체형식)", "2027-01-01", d20270101, true);

// 빈 문자열 / 숫자만(엑셀 시리얼 등) — 매치되면 안 됨
check("빈 문자열", "", d0901, false);
check("숫자만(시리얼 오인 방지)", "46000", d0901, false);

console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
