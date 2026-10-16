// client/src/lib/trainingAttachmentBlob.ts
//
// 작업명: MCC_TRAINING_PERSONAL_ORDER_AND_ATTACHMENT_UPLOAD_FIX_1
//
// 교육자료 첨부파일은 /api/training/attachments/:id/file이 requireTrainingViewer(Authorization
// 헤더)로 보호되어 있어, <img>/<video>/<iframe> src나 <a href>로 직접 요청하면 브라우저가
// Authorization 헤더를 붙이지 않아 401로 깨진다(이미지 깨짐 아이콘의 원인). client/src/pages/
// Documents.tsx가 동일한 문제를 해결한 방식(fetch with Authorization → blob →
// URL.createObjectURL)을 그대로 재사용한다 — 두 번째 "정답"을 만들지 않기 위함.

import { useAuth } from "@/lib/auth";

export async function fetchTrainingAttachmentBlobUrl(attachmentId: number): Promise<string> {
  const sessionId = useAuth.getState().sessionId;
  const response = await fetch(`/api/training/attachments/${attachmentId}/file`, {
    method: "GET",
    credentials: "include",
    headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
  });
  if (!response.ok) {
    throw new Error("파일을 불러오지 못했습니다.");
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export function triggerBlobDownload(blobUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
