// scripts/kt-activation-type-normalization-selftest.ts
//
// 작업명: MCC_KT_REINSPECTION_ACTIVATION_TYPE_NORMALIZATION_FIX_1
//
// client/src/pages/KtActivationAudit.tsx의 normalize(v, 'openType') 분기를 self-test한다.
//
// 왜 실제 함수를 import하지 않고 아래에 분기를 그대로 옮겨왔는가: KtActivationAudit.tsx는
// 브라우저 전용 React 컴포넌트 파일이라(Layout → Sidebar → `@assets/*.png` Vite 전용 에셋
// alias까지 모듈 그래프에 포함됨), tsx/node로 직접 import하면 Vite 없이는 해석 불가능한
// 에셋 import에서 ERR_MODULE_NOT_FOUND로 즉시 실패한다(실제로 시도해서 확인함, export만
// 추가해도 동일하게 실패 — 그래서 export도 추가하지 않았다). openType 분기 자체는 외부
// 의존성이 전혀 없는 순수 2줄짜리 whitelist 로직이라, 그 두 if문을 아래에 정확히 그대로
// 복사해서 테스트한다 — 이 파일의 NORMALIZE_OPEN_TYPE()을 수정할 때는 반드시
// KtActivationAudit.tsx의 normalize() 'openType' 분기도 같은 내용으로 함께 수정해야 한다.
//
// 실행: npx tsx scripts/kt-activation-type-normalization-selftest.ts

// ── KtActivationAudit.tsx normalize()의 'openType' 분기 그대로(문자 단위 동일) ──────
function text(v: unknown): string {
  return String(v ?? "").trim();
}
function normalizeOpenType(raw: unknown): string {
  const s = text(raw).normalize("NFKC");
  const t = s.replace(/\s/g, "").toUpperCase();
  if (["1", "10", "010", "신규", "신규개통", "신규가입"].includes(t)) return "NEW";
  if (["2", "3", "MNP", "번호이동", "번호이동가입"].includes(t)) return "MNP";
  return t;
}

let failures = 0;
function assertEqual(label: string, actual: unknown, expected: unknown) {
  const pass = actual === expected;
  console.log(`${pass ? "[PASS]" : "[FAIL]"} ${label} — expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  if (!pass) failures++;
}
function assertMatch(label: string, a: unknown, b: unknown, expectMatch: boolean) {
  const na = normalizeOpenType(a);
  const nb = normalizeOpenType(b);
  const matched = na === nb;
  assertEqual(`${label} (normalize("${a}")="${na}" vs normalize("${b}")="${nb}")`, matched, expectMatch);
}

// CASE_1~CASE_8: 섹션9/10 요구 케이스(양방향 포함)
assertMatch("CASE_1: 신규 == 신규", "신규", "신규", true);
assertMatch("CASE_2: 신규 == 신규가입", "신규", "신규가입", true);
assertMatch("CASE_3: 신규가입 == 신규", "신규가입", "신규", true);
assertMatch("CASE_4: 번호이동 == 번호이동", "번호이동", "번호이동", true);
assertMatch("CASE_5: 번호이동 == 번호이동가입", "번호이동", "번호이동가입", true);
assertMatch("CASE_6: 번호이동가입 == 번호이동", "번호이동가입", "번호이동", true);
assertMatch("CASE_7: 신규 != 번호이동", "신규", "번호이동", false);
assertMatch("CASE_8: 신규가입 != 번호이동가입", "신규가입", "번호이동가입", false);
// 추가 교차 케이스(섹션10 "신규 vs 번호이동가입" 등)
assertMatch("EXTRA: 신규 != 번호이동가입", "신규", "번호이동가입", false);
assertMatch("EXTRA: 번호이동 != 신규가입", "번호이동", "신규가입", false);

// 기존 alias 보존(회귀) — 이번 수정으로 기존에 이미 맞던 것들이 깨지지 않아야 함
assertMatch("REGRESSION: 1 == 신규", "1", "신규", true);
assertMatch("REGRESSION: 신규개통 == 신규", "신규개통", "신규", true);
assertMatch("REGRESSION: 2 == 번호이동", "2", "번호이동", true);
assertMatch("REGRESSION: 3 == 번호이동", "3", "번호이동", true);
assertMatch("REGRESSION: MNP == 번호이동", "MNP", "번호이동", true);

// CASE_9: 공란 처리는 normalize() 밖(호출부 KtActivationAudit.tsx:522 `if (!text(bv) || !text(kv)) { skipped++; continue; }`)
// 에서 이미 비교 자체를 skip한다 — normalize() 레벨에서 확인할 수 있는 것은 "공란이 NEW/MNP로
// 임의 변환되지 않는다"는 사실뿐이다.
assertEqual("CASE_9: 공란은 NEW/MNP로 임의 변환되지 않음(원문 그대로 통과, 호출부에서 비교 자체를 skip)", normalizeOpenType(""), "");

// CASE_10: unknown 값(기기변경/변경/해지 등)은 NEW/MNP로 임의 변환되지 않고 원문 그대로 통과 —
// 즉 서로 다른 unknown 값은 여전히 불일치로 남는다(policy 유지).
assertEqual("CASE_10a: 기기변경은 NEW/MNP로 변환되지 않음", normalizeOpenType("기기변경"), "기기변경");
assertMatch("CASE_10b: 기기변경 != 변경 (unknown 값끼리는 여전히 불일치)", "기기변경", "변경", false);
assertMatch("CASE_10c: 기기변경 != 신규 (unknown이 NEW로 잘못 흡수되지 않음)", "기기변경", "신규", false);

// trim/공백 처리(섹션6)
assertMatch("TRIM: '신규가입 ' == '신규'", "신규가입 ", "신규", true);
assertMatch("TRIM: ' 번호이동가입' == '번호이동'", " 번호이동가입", "번호이동", true);

console.log(`\n${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
