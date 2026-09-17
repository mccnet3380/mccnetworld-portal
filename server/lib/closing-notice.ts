// server/lib/closing-notice.ts
//
// 작업명: MCC_VERIFIED_HTML_OUTPUT_PORT_TO_BACKEND_1
//
// 마감 공지텍스트 — 어제 확정한 REFERENCE SNAPSHOT과 동일한 순서/명칭/줄바꿈을
// 그대로 재현한다. NOTICE_GROUPS의 라벨→카테고리 매핑은 mobile-cumulative.ts에서
// 실측 대조로 확인한 근거를 그대로 사용한다(ACT_HEADERS/EXTRA_HEADERS 컬럼명과도 일치).
//
// buildClosingNoticeText()는 순수 함수다 — Google Sheets를 읽거나 새 계산을 하지 않는다.
// 입력은 이미 계산이 끝난 숫자이고, 출력 조립만 담당한다.
//
// 절대 원칙:
// - 순서/명칭/줄바꿈을 변경하지 않는다.
// - "(당일포함누적/당일)" 같은 설명 문구를 추가하지 않는다.

import type { Network } from "./performance-classify";

export interface NoticeLabelEntry {
  label: string;
  net: Network;
  cat: string;
}

export interface NoticeGroupDef {
  title: string;
  entries: NoticeLabelEntry[];
}

/**
 * REFERENCE SNAPSHOT의 통신사 순서/명칭 — 변경 금지.
 * 각 라벨의 net/cat은 classifyReq() 출력 카테고리 문자열 그대로다(재분류 아님).
 * "▶본사" 그룹의 중고SK/중고LG는 classifyReq() net으로는 각각 SK/LG이지만
 * REFERENCE에서 본사 섹션에 표시되므로 그 배치를 그대로 따른다(표시 위치만 다름,
 * 분류 자체는 재사용).
 */
export const NOTICE_GROUPS: NoticeGroupDef[] = [
  {
    title: "▶SK망",
    entries: [
      { label: "텔링크", net: "SK", cat: "후불)텔링크" },
      { label: "카카오", net: "SK", cat: "후불)카카오SK" },
      { label: "프리티", net: "SK", cat: "후불)프리티SK" },
      { label: "프리티선불", net: "SK", cat: "선불)프리티SK" },
    ],
  },
  {
    title: "▶KT망",
    entries: [
      { label: "M후불", net: "KT", cat: "후불)엠모바일" },
      { label: "M단말", net: "KT", cat: "단말)KTM" },
      { label: "KT단말", net: "KT", cat: "단말)KT" },
      { label: "카카오", net: "KT", cat: "후불)카카오KT" },
      { label: "중고KT", net: "KT", cat: "후불)중고KT" },
      { label: "코드", net: "KT", cat: "선불)코드" },
      { label: "스카이", net: "KT", cat: "후불)스카이" },
    ],
  },
  {
    title: "▶LG망",
    entries: [
      { label: "U후불", net: "LG", cat: "후불)미디어" },
      { label: "U단말", net: "LG", cat: "단말)미디어" },
      { label: "헬로", net: "LG", cat: "후불)헬로" },
      { label: "프리티", net: "LG", cat: "후불)프리티LG" },
      { label: "밸류컴", net: "LG", cat: "선불)밸류컴" },
      { label: "프리티선불", net: "LG", cat: "선불)프리티LG" },
    ],
  },
  {
    title: "▶본사",
    entries: [
      { label: "스마텔", net: "TOSS", cat: "선불)스마텔" },
      { label: "중고SK", net: "SK", cat: "후불)중고SK" },
      { label: "중고LG", net: "LG", cat: "후불)중고LG" },
      // "데이터유심"은 classifyReq() 체계가 아니라 전용 시트 — buildClosingGroups()에서 별도 추가
    ],
  },
];

export interface ClosingCategoryEntry {
  label: string;
  cumulative: number;
  daily: number;
}

export interface ClosingNetworkGroup {
  title: string;
  entries: ClosingCategoryEntry[];
}

export interface ClosingNoticeInput {
  totalDaily: number;
  groups: ClosingNetworkGroup[];
}

/**
 * REFERENCE SNAPSHOT과 동일한 형식으로 조립한다:
 *   합계 : {totalDaily}
 *   ▶SK망
 *   라벨: 누적/당일
 *   ...
 *   (빈 줄)
 *   ▶KT망
 *   ...
 * 첫 그룹 앞에는 빈 줄이 없고, 그 다음 그룹들 앞에만 빈 줄이 들어간다
 * (사용자가 준 REFERENCE 원문 그대로 — closing.html 예시 문자열과 달리 첫 줄 바로 다음에
 * ▶SK망이 온다).
 */
export function buildClosingNoticeText(data: ClosingNoticeInput): string {
  const lines: string[] = [`합계 : ${data.totalDaily}`];
  data.groups.forEach((group, i) => {
    if (i > 0) lines.push("");
    lines.push(group.title);
    for (const e of group.entries) {
      lines.push(`${e.label}: ${e.cumulative}/${e.daily}`);
    }
  });
  return lines.join("\n");
}
