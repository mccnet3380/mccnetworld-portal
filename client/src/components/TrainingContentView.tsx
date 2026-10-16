// client/src/components/TrainingContentView.tsx
//
// 작업명: MCC_TRAINING_PERSONAL_ORDER_AND_ATTACHMENT_UPLOAD_FIX_1
//
// renderTrainingContentToHtml()의 결과(본문 HTML)를 렌더링하는 공용 뷰. 본문 안의
// <img class="tc-img" src="/api/training/attachments/:id/file">는 인증이 필요한
// 엔드포인트라 그대로 두면 깨진 이미지 아이콘으로 보인다(브라우저가 <img> 요청에
// Authorization 헤더를 붙이지 않음). 렌더링 후 해당 src들만 인증된 blob URL로
// 교체한다. TrainingArticleDetail(상세)과 TrainingEditor(미리보기 탭)가 동일 로직을
// 중복 구현하지 않도록 여기 한 곳에서만 처리한다.

import { useEffect, useRef } from "react";
import { fetchTrainingAttachmentBlobUrl } from "@/lib/trainingAttachmentBlob";

interface Props {
  html: string;
  className?: string;
}

const ATTACHMENT_SRC_RE = /^\/api\/training\/attachments\/(\d+)\/file$/;

export function TrainingContentView({ html, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const blobUrls: string[] = [];
    let cancelled = false;

    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img.tc-img"));
    images.forEach((img) => {
      const originalSrc = img.getAttribute("src") || "";
      const match = originalSrc.match(ATTACHMENT_SRC_RE);
      if (!match) return;
      const attachmentId = Number(match[1]);
      fetchTrainingAttachmentBlobUrl(attachmentId)
        .then((blobUrl) => {
          if (cancelled) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          blobUrls.push(blobUrl);
          img.src = blobUrl;
        })
        .catch(() => {
          img.alt = "이미지를 불러오지 못했습니다.";
        });
    });

    return () => {
      cancelled = true;
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [html]);

  return <div ref={containerRef} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
