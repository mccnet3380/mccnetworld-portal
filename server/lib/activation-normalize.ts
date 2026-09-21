// server/lib/activation-normalize.ts
//
// 작업명: MCC_SETTLEMENT_GOOGLE_SHEETS_ACTIVATION_IMPORT_IMPLEMENTATION_1
//
// server/routes.ts의 기존 "개통완료 엑셀 업로드"(POST /api/admin/activations/upload)와
// "정책 자동매칭"(POST /api/admin/settlement/match) 라우트에 각각 인라인으로 있던 3개
// 순수 헬퍼 함수를 그대로(로직 한 글자도 안 바꾸고) 이 파일로 옮겼다 — 두 라우트 모두 이제
// 여기서 import해서 쓴다. 값/동작은 기존과 100% 동일하다. Google Sheets(개통처리부)
// import 경로도 같은 정규화 규칙을 써야 하므로(§9 "동일한 normalized activation input
// 구조") 이 공용 모듈을 그대로 재사용한다.

export function normalizeCustomerType(v: string | null | undefined): string {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', '신규', '신', 'new'].includes(s)) return '1';
  if (['2', '번이', '번호이동', 'mnp', '이동'].includes(s)) return '2';
  return String(v ?? '').trim();
}

// 요금제명 비교 정규화: 맨 앞 접두어(텔), 엠), 스카이) 등) 제거 후 공백 정리
export function normalizePlanNameForMatching(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[가-힣A-Za-z0-9]+\)\s*/, '')
    .trim();
}

/** 개통 Excel/Sheets 날짜 셀 파서 — 다양한 형식 지원(기존 activations/upload 인라인 로직 그대로 이식) */
export function parseActivationDateStr(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;

  // YYYY-MM-DD 또는 YYYY/MM/DD
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t)) {
    const d = new Date(t.replace(/\//g, '-') + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD HH:mm[:ss]
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s\d{1,2}:\d{2}/.test(t)) {
    const norm = t.replace(/\//g, '-').replace(' ', 'T');
    const d = new Date(norm.length <= 16 ? norm + ':00' : norm);
    return isNaN(d.getTime()) ? null : d;
  }
  // MM월 DD일 (연도 없음 → 현재 연도)
  const m1 = t.match(/^(\d{1,2})월\s*(\d{1,2})일$/);
  if (m1) {
    const d = new Date(new Date().getFullYear(), Number(m1[1]) - 1, Number(m1[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY년 MM월 DD일
  const m2 = t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (m2) {
    const d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  // M/D/YYYY 또는 MM/DD/YYYY (SheetJS 날짜 셀 변환 결과)
  const m4 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m4) {
    const d = new Date(Number(m4[3]), Number(m4[1]) - 1, Number(m4[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  // MM/DD (연도 없음 → 현재 연도)
  const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m3) {
    const d = new Date(new Date().getFullYear(), Number(m3[1]) - 1, Number(m3[2]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
