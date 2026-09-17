// server/lib/performance-classify.ts
//
// 작업명: MCC_PERFORMANCE_LIVE_BASELINE_UPDATE_1
//
// "요청점" 문자열 → {통신망, 카테고리} 분류 규칙.
// MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/performance.html 의 classifyReq() 함수를
// 그대로 TypeScript로 이식한 것. 새로운 분류 규칙을 만든 것이 아니라
// 기존에 검증된 V17 분류 로직을 그대로 옮긴 것이다.
//
// 작업자 접두어 → 소속망 매핑도 같은 파일(defaultGroup)에서 이식.

export type Network = "SK" | "KT" | "LG" | "TOSS";

export interface ClassifiedRequest {
  net: Network;
  cat: string;
}

function clean(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function norm(s: unknown): string {
  return clean(s).replace(/\s/g, "");
}

/** performance.html classifyReq() 이식 */
export function classifyReq(req: unknown): ClassifiedRequest {
  const s = clean(req);
  const n = norm(req);
  const isExtra = /^기타[)\-]/.test(n);
  const isUsim = /^유심[)\-]/.test(n) || /유심/.test(n);

  // 스마텔/토스는 별도 개통 블록으로 분리
  if (/스마텔|토스/i.test(s)) return { net: "TOSS", cat: "선불)스마텔" };

  // SK 계열
  if (/텔링크|카카오SK|프리티SK|중고SK|기타-S|프리S|유심-S|00700|SK/i.test(s)) {
    let cat = s;
    if (isUsim) cat = "유심-S";
    else if (/텔링크/.test(s)) cat = isExtra ? "기타)텔링크" : "후불)텔링크";
    else if (/카카오SK/.test(s)) cat = "후불)카카오SK";
    else if (/프리티SK/.test(s)) cat = isExtra ? "기타-프리S" : /선불/.test(s) ? "선불)프리티SK" : "후불)프리티SK";
    else if (/중고SK/.test(s)) cat = "후불)중고SK";
    else if (/00700/.test(s)) cat = "00700";
    else if (/기타-S/.test(s)) cat = "기타-S";
    return { net: "SK", cat };
  }

  // LG 계열
  if (/미디어|헬로|프리티LG|밸류컴|기타-L|유심-L|LG/i.test(s)) {
    let cat = s;
    if (isUsim) cat = "유심-L";
    else if (/미디어/.test(s)) cat = isExtra ? "기타)미디어" : "후불)미디어";
    else if (/헬로/.test(s)) cat = isExtra ? "기타)헬로" : "후불)헬로";
    else if (/프리티LG/.test(s)) cat = isExtra ? "기타)프리티LG" : /선불/.test(s) ? "선불)프리티LG" : "후불)프리티LG";
    else if (/밸류컴/.test(s)) cat = isExtra ? "기타)밸류컴" : "선불)밸류컴";
    else if (/기타-L/.test(s)) cat = "기타-L";
    return { net: "LG", cat };
  }

  // KT 계열 (기본값)
  let cat = s;
  if (isUsim) cat = "유심-K";
  else if (/엠모바일/.test(s)) cat = isExtra ? "기타)엠모바일" : "후불)엠모바일";
  else if (/카카오KT/.test(s)) cat = isExtra ? "기타)카카오KT" : "후불)카카오KT";
  else if (/중고KT/.test(s)) cat = isExtra ? "기타)중고KT" : "후불)중고KT";
  else if (/스카이/.test(s)) cat = isExtra ? "기타)스카이" : "후불)스카이";
  else if (/코드/.test(s)) cat = isExtra ? "기타-코드K" : "선불)코드";
  else if (/기타-K/.test(s)) cat = "기타-K";
  return { net: "KT", cat };
}

/** 이 요청점 문자열이 SK/LG/KT 중 어느 키워드에도 명시적으로 걸리지 않고
 *  KT 기본값(fallback)으로 떨어졌는지 여부 — 미확인 카테고리 감지용 */
export function isUnclassifiedFallback(req: unknown): boolean {
  const s = clean(req);
  const n = norm(req);
  const isExtra = /^기타[)\-]/.test(n);
  const isUsim = /^유심[)\-]/.test(n) || /유심/.test(n);

  if (/스마텔|토스/i.test(s)) return false;
  if (/텔링크|카카오SK|프리티SK|중고SK|기타-S|프리S|유심-S|00700|SK/i.test(s)) return false;
  if (/미디어|헬로|프리티LG|밸류컴|기타-L|유심-L|LG/i.test(s)) return false;

  const knownKt = isUsim || /엠모바일|카카오KT|중고KT|스카이|코드|기타-K/.test(s);
  return !knownKt;
}

/** performance.html defaultGroup() 이식 — 작업자 접두어 → 소속망 */
export function workerHomeNetwork(workerName: string): "SK" | "KT" | "LG" | "유선" | "본사" | "기타" {
  const n = norm(workerName);
  if (["광섭", "다엘", "본사", "선우", "예정"].includes(n)) return "본사";
  if (n.startsWith("S)")) return "SK";
  if (n.startsWith("K)")) return "KT";
  if (n.startsWith("L)")) return "LG";
  if (n.startsWith("H)")) return "유선";
  return "기타";
}
