// shared/training-markdown.ts
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 교육자료 본문 전용 경량 마크다운 서브셋. 리치에디터/마크다운 라이브러리를 새로
// 추가하지 않기 위해 필요한 문법만 직접 파싱한다(#, ##, **굵게**, 줄바꿈,
// ![](url) 이미지, [!주의]/[!경고]/[!팁] 한 줄 admonition). 저장값 자체가 항상
// 이 서브셋뿐이라 임의 HTML이 DB에 들어갈 수 없다 — 별도 sanitize 없이도 XSS 표면이
// 구조적으로 없다(렌더러가 이스케이프 후 자신이 아는 태그만 삽입).

export interface TrainingBlock {
  type: "h1" | "h2" | "p" | "image" | "note" | "warning" | "tip";
  text?: string;
  src?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** **굵게**만 지원하는 인라인 변환(이스케이프 이후 적용). */
function inlineToHtml(escaped: string): string {
  return escaped.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/** 본문 텍스트를 줄 단위 블록으로 분해한다(저장/검색/렌더링 공용). */
export function parseTrainingContent(content: string): TrainingBlock[] {
  const lines = (content || "").split(/\r?\n/);
  const blocks: TrainingBlock[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") continue;

    const img = line.match(/^!\[\]\(([^)]+)\)$/);
    if (img) {
      blocks.push({ type: "image", src: img[1] });
      continue;
    }

    const note = line.match(/^\[!(주의|경고|팁)\]\s*(.*)$/);
    if (note) {
      const kind = note[1] === "경고" ? "warning" : note[1] === "팁" ? "tip" : "note";
      blocks.push({ type: kind as "note" | "warning" | "tip", text: note[2] });
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: line.slice(2) });
      continue;
    }

    blocks.push({ type: "p", text: line });
  }
  return blocks;
}

/** 검색용 순수 텍스트만 뽑는다(이미지/문법 기호 제외). */
export function trainingContentToPlainText(content: string): string {
  return parseTrainingContent(content)
    .map((b) => b.text || "")
    .join(" ")
    .replace(/\*\*/g, "")
    .trim();
}

/** 블록을 안전한 HTML 문자열로 렌더링한다(신뢰 가능한 고정 태그만 사용). */
export function renderTrainingContentToHtml(content: string): string {
  return parseTrainingContent(content)
    .map((b) => {
      switch (b.type) {
        case "h1":
          return `<h3 class="tc-h1">${inlineToHtml(escapeHtml(b.text || ""))}</h3>`;
        case "h2":
          return `<h4 class="tc-h2">${inlineToHtml(escapeHtml(b.text || ""))}</h4>`;
        case "image":
          return `<img class="tc-img" src="${escapeHtml(b.src || "")}" loading="lazy" />`;
        case "note":
          return `<div class="tc-note">${inlineToHtml(escapeHtml(b.text || ""))}</div>`;
        case "warning":
          return `<div class="tc-warning">${inlineToHtml(escapeHtml(b.text || ""))}</div>`;
        case "tip":
          return `<div class="tc-tip">${inlineToHtml(escapeHtml(b.text || ""))}</div>`;
        case "p":
        default:
          return `<p class="tc-p">${inlineToHtml(escapeHtml(b.text || ""))}</p>`;
      }
    })
    .join("\n");
}

export const TRAINING_CATEGORIES = ["ALL", "SK", "KT", "LG", "OTHER"] as const;
export type TrainingCategory = (typeof TRAINING_CATEGORIES)[number];

export const TRAINING_CATEGORY_LABEL: Record<TrainingCategory, string> = {
  ALL: "전체 교육",
  SK: "SK 교육",
  KT: "KT 교육",
  LG: "LG 교육",
  OTHER: "기타업무",
};
