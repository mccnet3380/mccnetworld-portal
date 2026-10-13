// client/src/components/TrainingFormatToolbar.tsx
//
// 작업명: MCC_TRAINING_EDITOR_FORMAT_TOOLBAR_MARKDOWN_RENDER_FIX_1
//
// 교육자료 본문 textarea 위에 올라가는 서식 툴바. 사용자가 Markdown 문법을 외우지
// 않도록 버튼으로 shared/training-markdown.ts가 이해하는 경량 문법을 현재
// selectionStart/selectionEnd 위치에 삽입한다. 저장 포맷은 그대로 plain text
// Markdown 서브셋이라 DB 호환성에는 영향이 없다.

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Heading1,
  Heading2,
  Bold,
  Highlighter,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Minus,
  Link as LinkIcon,
  Smile,
} from "lucide-react";

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  content: string;
  setContent: (value: string) => void;
}

const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: "업무", items: ["✓", "✔", "☑", "•", "→", "⇒", "※", "★", "☆", "■", "□", "▲", "▼"] },
  { label: "상태", items: ["✅", "⚠️", "❗", "❌", "ℹ️", "🔴", "🟠", "🟢", "🔵"] },
  { label: "문서", items: ["📌", "📢", "📞", "📱", "💻", "📝", "📄", "📎", "🔗", "🔍", "💡"] },
  { label: "통신/업무", items: ["📶", "☎️", "💳", "🪪", "👤", "🏢"] },
];

const QUICK_BLOCKS: { label: string; insert: string }[] = [
  { label: "📌 참고", insert: "[!팁] 참고: " },
  { label: "⚠️ 주의", insert: "[!주의] 주의: " },
  { label: "✅ 확인", insert: "✓ 확인: " },
  { label: "❗ 필수", insert: "[!경고] 필수: " },
  { label: "※ 참고사항", insert: "[!팁] ※ 참고사항: " },
];

export function TrainingFormatToolbar({ textareaRef, content, setContent }: Props) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");
  const linkSelectionRef = useRef<{ start: number; end: number; text: string } | null>(null);

  function commit(newValue: string, selStart: number, selEnd: number) {
    const el = textareaRef.current;
    if (el) {
      el.value = newValue;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    }
    setContent(newValue);
  }

  function getSelection() {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? content.length;
    return { start, end };
  }

  /** 선택 영역을 before/after로 감싼다. 선택이 없으면 마커 사이에 커서를 둔다. */
  function wrapSelection(before: string, after: string = before) {
    const { start, end } = getSelection();
    const selected = content.slice(start, end);
    const newValue = content.slice(0, start) + before + selected + after + content.slice(end);
    if (selected) {
      commit(newValue, start + before.length, start + before.length + selected.length);
    } else {
      const cursor = start + before.length;
      commit(newValue, cursor, cursor);
    }
  }

  /**
   * 선택된 각 줄(비어있지 않은 줄) 앞에 markerFor(n)을 붙인다.
   * 선택이 없으면 현재 줄 맨 앞에 markerFor(1)만 삽입하고 커서를 그만큼 뒤로 민다.
   */
  function applyLinePrefix(markerFor: (n: number) => string) {
    const { start, end } = getSelection();
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;

    if (start === end) {
      const marker = markerFor(1);
      const newValue = content.slice(0, lineStart) + marker + content.slice(lineStart);
      const cursor = start + marker.length;
      commit(newValue, cursor, cursor);
      return;
    }

    let lineEnd = content.indexOf("\n", end);
    if (lineEnd === -1) lineEnd = content.length;
    const block = content.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    let n = 0;
    const newLines = lines.map((l) => {
      if (l.trim() === "") return l;
      n += 1;
      return markerFor(n) + l;
    });
    const newBlock = newLines.join("\n");
    const newValue = content.slice(0, lineStart) + newBlock + content.slice(lineEnd);
    const diff = newBlock.length - block.length;
    commit(newValue, lineStart, lineEnd + diff);
  }

  /** 줄 바꿈으로 감싸 독립된 블록(구분선 등)을 삽입한다. */
  function insertBlock(text: string) {
    const { start, end } = getSelection();
    const before = content.slice(0, start);
    const after = content.slice(end);
    const needsLeading = before.length > 0 && !before.endsWith("\n");
    const needsTrailing = after.length > 0 && !after.startsWith("\n");
    const insertion = (needsLeading ? "\n" : "") + text + (needsTrailing ? "\n" : "");
    const newValue = before + insertion + after;
    const cursor = before.length + insertion.length;
    commit(newValue, cursor, cursor);
  }

  /** 현재 cursor 위치에 그대로 삽입한다(이모지/빠른 블록). */
  function insertRaw(text: string) {
    const { start, end } = getSelection();
    const newValue = content.slice(0, start) + text + content.slice(end);
    const cursor = start + text.length;
    commit(newValue, cursor, cursor);
  }

  function openLinkPopover() {
    const { start, end } = getSelection();
    linkSelectionRef.current = { start, end, text: content.slice(start, end) };
    setLinkUrl("https://");
    setLinkOpen(true);
  }

  function applyLink() {
    const sel = linkSelectionRef.current;
    if (!sel) return;
    const label = sel.text || "링크 제목";
    const url = linkUrl.trim() || "https://";
    const insertion = `[${label}](${url})`;
    const newValue = content.slice(0, sel.start) + insertion + content.slice(sel.end);
    const cursor = sel.start + insertion.length;
    commit(newValue, cursor, cursor);
    setLinkOpen(false);
  }

  const buttons: { key: string; label: string; icon: React.ReactNode; onClick: () => void }[] = [
    { key: "h1", label: "제목", icon: <Heading1 className="h-4 w-4" />, onClick: () => applyLinePrefix(() => "## ") },
    { key: "h2", label: "소제목", icon: <Heading2 className="h-4 w-4" />, onClick: () => applyLinePrefix(() => "### ") },
    { key: "bold", label: "굵게", icon: <Bold className="h-4 w-4" />, onClick: () => wrapSelection("**") },
    { key: "mark", label: "강조", icon: <Highlighter className="h-4 w-4" />, onClick: () => wrapSelection("==") },
    { key: "ul", label: "글머리 목록", icon: <List className="h-4 w-4" />, onClick: () => applyLinePrefix(() => "- ") },
    { key: "ol", label: "번호 목록", icon: <ListOrdered className="h-4 w-4" />, onClick: () => applyLinePrefix((n) => `${n}. `) },
    { key: "check", label: "체크", icon: <CheckSquare className="h-4 w-4" />, onClick: () => applyLinePrefix(() => "✓ ") },
    { key: "quote", label: "인용/참고", icon: <Quote className="h-4 w-4" />, onClick: () => applyLinePrefix(() => "> ") },
    { key: "hr", label: "구분선", icon: <Minus className="h-4 w-4" />, onClick: () => insertBlock("---") },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1 flex-wrap border rounded-md p-1 bg-muted/40">
        {buttons.map((b) => (
          <Tooltip key={b.key}>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={b.onClick}>
                {b.icon}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{b.label}</TooltipContent>
          </Tooltip>
        ))}

        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={openLinkPopover}>
                  <LinkIcon className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>링크</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-72 space-y-2" align="start">
            <p className="text-xs text-muted-foreground">연결할 주소를 입력하세요.</p>
            <Input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://"
              onKeyDown={(e) => e.key === "Enter" && applyLink()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setLinkOpen(false)}>취소</Button>
              <Button type="button" size="sm" onClick={applyLink}>적용</Button>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Smile className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>이모지/기호</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-80 space-y-3" align="start">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">빠른 블록</p>
              <div className="flex flex-wrap gap-1">
                {QUICK_BLOCKS.map((qb) => (
                  <Button
                    key={qb.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => insertBlock(qb.insert)}
                  >
                    {qb.label}
                  </Button>
                ))}
              </div>
            </div>
            {EMOJI_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold text-muted-foreground mb-1">{group.label}</p>
                <div className="flex flex-wrap gap-1">
                  {group.items.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-muted text-base"
                      onClick={() => insertRaw(emoji)}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
