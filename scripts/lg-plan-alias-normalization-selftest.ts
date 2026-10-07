// scripts/lg-plan-alias-normalization-selftest.ts
//
// 작업명: MCC_LG_REINSPECTION_PLAN_ALIAS_NORMALIZATION_FIX_1
//
// client/src/pages/LgActivationAudit.tsx의 normalizePlan()(PLAN_ALIASES 포함)을 self-test한다.
//
// 왜 실제 함수를 import하지 않고 아래에 그대로 옮겨왔는가: LgActivationAudit.tsx는 브라우저
// 전용 React 컴포넌트 파일이라(Layout → Sidebar → `@assets/*.png` Vite 전용 에셋 alias까지
// 모듈 그래프에 포함됨), tsx/node로 직접 import하면 Vite 없이는 해석 불가능한 에셋 import에서
// ERR_MODULE_NOT_FOUND로 즉시 실패한다(scripts/kt-activation-type-normalization-selftest.ts
// 작성 시 KtActivationAudit.tsx로 실제로 시도해서 이미 확인한 것과 동일한 제약 — export를
// 추가해도 결과는 같다). normalizePlan()/PLAN_ALIASES 자체는 외부 의존성이 없는 순수 로직이라
// 아래에 문자 단위로 그대로 복사해서 테스트한다 — PLAN_ALIASES나 normalizePlan()의 정규화
// 파이프라인을 수정할 때는 반드시 LgActivationAudit.tsx의 실제 함수도 같은 내용으로 함께
// 수정해야 한다.
//
// 실행: npx tsx scripts/lg-plan-alias-normalization-selftest.ts

// ── LgActivationAudit.tsx의 text()/PLAN_ALIASES/normalizePlan() 그대로(문자 단위 동일) ──
function text(v: unknown): string {
  return String(v ?? '').trim();
}

const PLAN_ALIASES: Record<string, string> = {
  'L프선)선불데이터10.3G/2': 'LG_PREPAID_DATA_10_3G_2',
  '[SN2]선불정액383(10.3GB+3Mbps)_인스코비': 'LG_PREPAID_DATA_10_3G_2',
};

function normalizePlan(v: unknown): string {
  const raw = text(v).normalize('NFKC');
  const aliased = PLAN_ALIASES[raw];
  if (aliased) return aliased;
  const s = raw
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[^(）)]{1,20}\)\s*/, '')
    .replace(/\/\s*\d+(?:\s*\/\s*\d+)*\s*\/?\s*$/, '');
  return s
    .replace(/\s/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .toUpperCase();
}

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? '[PASS]' : '[FAIL]'} ${label} — expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (!pass) failures++;
}
function assertMatch(label: string, a: unknown, b: unknown, expectMatch: boolean) {
  const na = normalizePlan(a);
  const nb = normalizePlan(b);
  const matched = na === nb;
  assertEqual(`${label} (normalizePlan("${a}")="${na}" vs normalizePlan("${b}")="${nb}")`, matched, expectMatch);
}

const SOURCE = 'L프선)선불데이터10.3G/2'; // 우리 스프레드시트
const HQ = '[SN2]선불정액383(10.3GB+3Mbps)_인스코비'; // 본사 검수 CSV

// CASE_1/2: 양방향 MATCH
assertMatch('CASE_1: SOURCE vs HQ → MATCH', SOURCE, HQ, true);
assertMatch('CASE_2: HQ vs SOURCE → MATCH (반대 방향)', HQ, SOURCE, true);

// CASE_3/4: 등록되지 않은 유사 요금제와는 MISMATCH 유지 (섹션9 — fuzzy 금지 증거)
assertMatch('CASE_3: SOURCE vs 완전히 다른 요금제 → MISMATCH', SOURCE, 'L프선)선불데이터10.3G/1', false);
assertMatch('CASE_3b: SOURCE vs 같은 계열 다른 순번 → MISMATCH', SOURCE, 'L프선)선불데이터10.3G/3', false);
assertMatch('CASE_4: HQ vs 다른 SN코드 요금제 → MISMATCH', HQ, '[SN1]선불정액383(10.3GB+3Mbps)_인스코비', false);
assertMatch('CASE_4b: HQ vs 다른 사업자 → MISMATCH', HQ, '[SN2]선불정액383(10.3GB+3Mbps)_다른사업자', false);
assertMatch('EXTRA: "10.3GB" 포함만으로는 매칭되지 않음', HQ, '[SN3]선불정액999(10.3GB+10Mbps)_인스코비', false);
assertMatch('EXTRA: "인스코비" 포함만으로는 매칭되지 않음', HQ, '[SN2]완전히다른요금제_인스코비', false);

// CASE_5: unknown plan — 기존 일반 정규화 경로로 그대로 처리(정책 유지, alias 테이블에
// 없는 값은 일반 파이프라인을 그대로 통과)
assertEqual('CASE_5: unknown plan은 alias 테이블에 없으면 일반 정규화만 적용', normalizePlan('완전히새로운요금제명'), '완전히새로운요금제명'.toUpperCase());

// CASE_6: blank — 기존 정책 유지(빈 문자열은 그대로 빈 문자열, 호출부의 "양쪽 다 있어야
// 비교" 정책은 LgActivationAudit.tsx 비교 루프 쪽 책임이며 이번 수정으로 바뀌지 않음)
assertEqual('CASE_6: blank 값은 alias로 변환되지 않고 빈 문자열 그대로', normalizePlan(''), '');

// 기존 일반 정규화 회귀(접두어/접미어 스트립 로직이 이번 수정으로 깨지지 않았는지)
assertEqual(
  'REGRESSION: 등록되지 않은 값은 기존 접두어/접미어 스트립 로직 그대로 동작',
  normalizePlan('L프선)선불데이터10.3G/1'),
  '선불데이터10.3G',
);

// trim 처리(섹션5)
assertMatch('TRIM: 앞뒤 공백 포함된 SOURCE도 정상 매칭', `  ${SOURCE}  `, HQ, true);
assertMatch('TRIM: 앞뒤 공백 포함된 HQ도 정상 매칭', SOURCE, ` ${HQ} `, true);

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
