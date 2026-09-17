// client/src/pages/DailyPerformanceBoard.tsx
//
// 작업명: MCC_PERFORMANCE_TWO_JPG_EXPORTS_FINAL_RESTORE_1
// (원래 라우트 정정: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1)
//
// 전사 공지용 당일실적 화면(/performance/daily) — index.html의 routes.daily가 실제로
// 가리키는 MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/performance.html을 그대로 이식한
// NetworkDetailBoard를 렌더링한다.
//
// [MCC_PERFORMANCE_TWO_JPG_EXPORTS_FINAL_RESTORE_1] performance.html 자체의 JPG 기능
// (#jpgBtn "PPT 한장 JPG" / exportJpg() / #dashboard 전체 캡처 / 모바일당일실적_대시보드.jpg)을
// 여기 복원한다. 이 handler는 closing.html 기반 /performance/closing의 JPG(담당판매점별
// 표만 캡처)와 완전히 별개다 — capture target도, filename도, 렌더링 방식도 공유하지 않는다.
//
// exportJpg() 원본 로직 그대로 포팅(추측/임의 변경 없음):
//   const dash=$('dashboard');
//   const h=Math.ceil(dash.scrollHeight);
//   const canvas=await html2canvas(dash,{backgroundColor:'#ffffff',scale:2,windowWidth:1920,windowHeight:h,height:h});
//   const out=document.createElement('canvas');
//   out.width=1920;
//   out.height=Math.ceil(canvas.height/canvas.width*1920);
//   const ctx=out.getContext('2d');
//   ctx.fillStyle='#fff'; ctx.fillRect(0,0,out.width,out.height);
//   ctx.drawImage(canvas,0,0,out.width,out.height);
//   a.download='모바일당일실적_대시보드.jpg'; a.href=out.toDataURL('image/jpeg',0.95);
//
// [MCC_PERFORMANCE_TWO_JPG_EXPORTS_FINAL_RESTORE_1 — 실측으로 발견한 차이 수정]
// performance.html 원본은 사이드바/상단 네비게이션이 전혀 없는 단독 페이지라 windowWidth:1920
// 가상 창에서 .dashboard가 거의 전체 폭(.wrap max-width:1780px)을 그대로 쓴다. 반면 MCC의
// 이 페이지는 Layout의 고정폭 Sidebar + max-w-7xl(1280px) 콘텐츠 래퍼 안에 중첩되어 있어서,
// 같은 windowWidth:1920으로 캡처하면 대시보드가 실제로 쓸 수 있는 폭이 좁아져 표 컬럼이
// 원본보다 좁게(글자가 붙어 보이게) 렌더링된다 — 원본 performance.html을 직접 실행해 받은
// 실제 JPG와 나란히 비교해서 확인한 사실이다(추측 아님). onclone에서 dash의 조상 체인을
// 따라 올라가며 형제 요소(Sidebar/TopNavigation/날짜바 등 MCC 전용 UI)를 제거하고 폭 제한을
// 풀어서, performance.html에 사이드바가 없을 때와 동일한 폭 조건을 만든다 — html2canvas
// 옵션(scale/windowWidth/height) 자체나 이후 1920px 리사이즈 로직은 원본 그대로 변경하지
// 않았다.

import { useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { PerformanceDateBar } from "@/components/performance/PerformanceDateBar";
import { NetworkDetailBoard } from "@/components/performance/NetworkDetailBoard";
import { PerformanceLoadingBanner, PerformanceErrorBanner } from "@/components/performance/PerformanceStateBanner";
import { usePerformanceDataset, formatDateInput } from "@/hooks/usePerformanceDataset";
import { ImageDown } from "lucide-react";

export function DailyPerformanceBoard() {
  const [date, setDate] = useState(() => formatDateInput(new Date()));
  const { data, isLoading, isFetching, isError, error, isSuccess, refetch } = usePerformanceDataset(date);
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  // performance.html exportJpg() 그대로 — closing.html의 handleSaveJpg()와 별개 구현,
  // capture target(#dashboard 전체)/렌더링 방식/파일명을 전혀 공유하지 않는다.
  const handleExportDashboardJpg = async () => {
    const dash = dashboardRef.current;
    if (!dash) return;
    setSaving(true);
    try {
      const h = Math.ceil(dash.scrollHeight);
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(dash, {
        backgroundColor: "#ffffff",
        scale: 2,
        windowWidth: 1920,
        windowHeight: h,
        height: h,
        onclone: (_clonedDocument, clonedEl) => {
          // performance.html에는 Sidebar/TopNavigation이 없다 — MCC Layout이 씌운 고정폭
          // 사이드바와 max-w-7xl 래퍼가 windowWidth:1920 안에서 대시보드 폭을 좁히지 않도록,
          // dash의 조상 체인을 따라 올라가며 형제 요소를 제거하고 폭 제한을 해제한다.
          let node: HTMLElement | null = clonedEl as HTMLElement;
          while (node && node.parentElement && node.tagName !== "BODY" && node.tagName !== "HTML") {
            const parent: HTMLElement = node.parentElement;
            Array.from(parent.children).forEach((sibling: Element) => {
              if (sibling !== node) sibling.remove();
            });
            parent.style.maxWidth = "none";
            parent.style.width = "100%";
            parent.style.marginLeft = "0";
            parent.style.marginRight = "0";
            parent.style.paddingLeft = "0";
            parent.style.paddingRight = "0";
            node = parent;
          }
        },
      });

      const out = document.createElement("canvas");
      out.width = 1920;
      out.height = Math.ceil((canvas.height / canvas.width) * 1920);
      const ctx = out.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0, out.width, out.height);

      const a = document.createElement("a");
      a.download = "모바일당일실적_대시보드.jpg";
      a.href = out.toDataURL("image/jpeg", 0.95);
      a.click();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="전사 공지용 당일실적">
      <PerformanceDateBar
        title="전사 공지용 당일실적"
        date={date}
        onDateChange={setDate}
        onRefresh={() => refetch()}
        isFetching={isFetching}
        extra={
          <Button variant="outline" onClick={handleExportDashboardJpg} disabled={!isSuccess || saving}>
            <ImageDown className="h-4 w-4 mr-2" />
            PPT 한장 JPG
          </Button>
        }
      />

      {isLoading && <PerformanceLoadingBanner />}
      {isError && <PerformanceErrorBanner onRetry={() => refetch()} error={error} />}

      {data && !isLoading && <NetworkDetailBoard dataset={data} dashboardRef={dashboardRef} />}
    </Layout>
  );
}

export default DailyPerformanceBoard;
