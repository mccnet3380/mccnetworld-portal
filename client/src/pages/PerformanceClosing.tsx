// client/src/pages/PerformanceClosing.tsx
//
// 작업명: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1
// (원래 사이트 연결: MCC_PERFORMANCE_SITE_INTEGRATION_1)
//
// 마감보고 · 공지텍스트 화면(/performance/closing, ADMIN 전용) — index.html의
// routes.closing이 가리키는 실제 MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/closing.html을
// 그대로 이식한 EnterpriseDailyReportBoard(공지 텍스트 카드 + 담당판매점별 상세 실적표)를
// 렌더링한다. JPG 저장 버튼은 이 화면에만 있다(전사 공지용 당일실적 화면에는 없음).
//
// JPG 저장(html2canvas): windowWidth/windowHeight는 실제 문서 크기 그대로 둬서 .edrb-layout
// 그리드가 화면과 동일하게 계산되게 하고, 캡처 대상 자체의 width/height/font-size는 절대
// 강제로 바꾸지 않는다. 각 표(.edrb-pivot)의 실제 렌더링된 컬럼 폭을 캡처 직전
// getBoundingClientRect()로 측정해서 onclone에서 table-layout:fixed + colgroup으로 그대로
// freeze한다. 캡처 대상(tableExportRef)은 "전사 공지용 실적" 제목을 포함하지 않는다 —
// 표(전체합계 포함)만 감싼다(EnterpriseDailyReportBoard.tsx 참고). scale은 해상도(DPI)용일
// 뿐 레이아웃 크기와 무관하다.
//
// 중요: 유선 마감(closeWireDay)은 이미 DB 검증이 끝난 기존 기능이라 그대로 연결한다
// (기존 /api/admin/performance/internet/close 라우트 재사용, 로직 수정 없음).
// 모바일/전사 실적 전체를 보존하는 마감 snapshot 저장 구조는 아직 없으므로, 그 버튼은
// "마감 저장 backend 미연결" 상태로 비활성화한다 — 억지로 활성화하지 않는다.

import { useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PerformanceDateBar } from "@/components/performance/PerformanceDateBar";
import { EnterpriseDailyReportBoard } from "@/components/performance/EnterpriseDailyReportBoard";
import { PerformanceLoadingBanner, PerformanceErrorBanner } from "@/components/performance/PerformanceStateBanner";
import { usePerformanceDataset, formatDateInput } from "@/hooks/usePerformanceDataset";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Lock, CheckCircle2, ImageDown } from "lucide-react";

export function PerformanceClosing() {
  const [date, setDate] = useState(() => formatDateInput(new Date()));
  const { data, isLoading, isFetching, isError, error, isSuccess, refetch } = usePerformanceDataset(date);
  const { toast } = useToast();
  const [closingWire, setClosingWire] = useState(false);
  const tableExportRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const handleCloseWire = async () => {
    setClosingWire(true);
    try {
      const res = await apiRequest("POST", "/api/admin/performance/internet/close", { date });
      const result = await res.json();
      toast({
        title: "유선 마감 확정 완료",
        description: `${date} 기준 totalCumulative=${result.totalCumulative}, totalDaily=${result.totalDaily}`,
      });
    } catch (err: any) {
      toast({ title: "유선 마감 확정 실패", description: err?.message ?? String(err), variant: "destructive" });
    } finally {
      setClosingWire(false);
    }
  };

  const handleSaveJpg = async () => {
    const el = tableExportRef.current;
    if (!el) return;
    setSaving(true);
    try {
      // 캡처 직전, 아무것도 건드리기 전의 실제 렌더링된 컬럼 폭을 그대로 측정해서 저장한다.
      // 이 값을 onclone에서 그대로 freeze해서 캡처 순간의 재계산(=축소)을 막는다.
      const liveTables = Array.from(el.querySelectorAll<HTMLTableElement>("table.edrb-pivot"));
      const perTableColWidths = liveTables.map((t) =>
        Array.from(t.querySelectorAll<HTMLElement>("thead th")).map((th) => th.getBoundingClientRect().width),
      );

      const fullWidth = el.scrollWidth;
      const fullHeight = el.scrollHeight;

      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2, // 해상도(DPI)용 — 표 비율/폰트 크기와는 무관, 축소 목적 아님
        useCORS: true,
        width: fullWidth,
        height: fullHeight,
        scrollX: 0,
        scrollY: 0,
        // 실제 문서 폭/높이 그대로 — .edrb-layout 그리드가 화면과 다르게 재계산되지 않도록 한다.
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
        onclone: (clonedDocument, clonedEl) => {
          // 캡처 대상 자체의 width/height/font-size는 절대 바꾸지 않는다. 스크롤 클리핑을
          // 만드는 조상(.edrb-card)의 overflow/max-height만 풀어서 잘리지 않게 한다.
          const target = clonedEl as HTMLElement;
          let node: HTMLElement | null = target;
          while (node) {
            node.style.overflow = "visible";
            node.style.maxHeight = "none";
            node = node.parentElement;
          }

          // 각 표의 컬럼 폭을 라이브 DOM 측정값으로 고정(freeze)한다 — clone에서만
          // table-layout:fixed + colgroup 적용, 화면 CSS는 무변경.
          const clonedTables = Array.from(target.querySelectorAll<HTMLTableElement>("table.edrb-pivot"));
          clonedTables.forEach((table, i) => {
            const widths = perTableColWidths[i];
            if (!widths || widths.length === 0) return;
            table.style.tableLayout = "fixed";
            table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
            let colgroup = table.querySelector("colgroup");
            if (!colgroup) {
              colgroup = clonedDocument.createElement("colgroup");
              table.insertBefore(colgroup, table.firstChild);
            }
            colgroup.innerHTML = "";
            widths.forEach((w) => {
              const col = clonedDocument.createElement("col");
              col.style.width = `${w}px`;
              colgroup!.appendChild(col);
            });
          });

          // [MCC_CLOSING_JPG_RASTER_BORDER_VERTICAL_ALIGNMENT_FINAL_FIX_1]
          // 실제 다운로드된 JPG를 픽셀 단위로 실측해서 확인한 두 가지 html2canvas 자체의
          // rasterize 버그(화면 DOM/CSS는 정상이었음 — 화면을 다시 디자인하지 않고 caption
          // clone에만 보정을 적용한다):
          //
          // 1) 테두리 중복: 화면 CSS가 border-collapse:collapse인데도 html2canvas는 인접 셀의
          //    테두리를 각각 따로 그려서 최종 raster에서 1px 테두리가 ~4px(2배)로 겹쳐 보였다
          //    (0.75px로 줄여도 동일하게 ~4px — collapse 자체가 반영되지 않는 것이 원인).
          //    → border-collapse에 의존하지 않고, 각 셀은 right/bottom 테두리만 그리고(안쪽
          //    격자선은 이웃 셀과 겹치지 않음) table 자체가 outer 테두리를 담당하는 구조로
          //    "경계 하나당 선 하나"를 강제한다. 실측 결과 1px solid가 raster 2px(=scale:2 그대로,
          //    중복 없음)로 정확히 나와서 별도로 줄일 필요가 없었다.
          //
          // 2) 세로 중앙 정렬: vertical-align:middle이 걸려 있어도 html2canvas는 텍스트를
          //    사실상 상단 정렬처럼 그린다 — 이 편향은 flex/block/inline 어떤 방식을 써도
          //    동일했고, 심지어 래퍼가 전혀 없는 <th>(헤더)에서도 동일하게 나타났다(래퍼
          //    문제가 아니라 html2canvas 자체의 vertical-align 렌더링 버그임을 실측으로 증명).
          //    padding-top을 0까지 줄여도(합계 padding은 원본과 동일하게 유지) topGap이
          //    bottomGap보다 여전히 컸다. → 모든 th/td의 내용을 span으로 감싸고
          //    position:relative로 실측 기반 고정 오프셋(top:-6px)만큼 위로 이동시켜 raster
          //    결과 기준으로 보정한다(패딩/폰트크기는 원본 그대로 유지, 문서 전체 높이도
          //    실측 결과 이전과 완전히 동일했다 — 2900x4562).
          const jpgStyle = clonedDocument.createElement("style");
          jpgStyle.textContent = `
            .edrb-table-export table.edrb-pivot {
              border-collapse: separate !important;
              border-spacing: 0 !important;
              border: 1px solid #000 !important;
            }
            .edrb-table-export table.edrb-pivot th,
            .edrb-table-export table.edrb-pivot td {
              border: none !important;
              border-right: 1px solid #000 !important;
              border-bottom: 1px solid #000 !important;
              vertical-align: middle !important;
              padding-top: 4px !important;
              padding-bottom: 4px !important;
            }
            .edrb-table-export table.edrb-pivot tr > *:last-child {
              border-right: none !important;
            }
            .edrb-table-export table.edrb-pivot tbody tr:last-child > * {
              border-bottom: none !important;
            }
            .edrb-table-export .jpg-vcenter-fix {
              display: inline;
              position: relative;
              top: -6px;
            }
          `;
          clonedDocument.head.appendChild(jpgStyle);

          // 모든 th/td 내용을 .jpg-vcenter-fix span으로 감싼다(이미 .edrb-dealer-inner
          // wrapper가 있는 판매점명 셀은 그 wrapper를 재사용) — html2canvas의 세로중앙 정렬
          // 편향을 raster 기준으로 일괄 보정하기 위함이며, 화면 DOM(el 자체)은 건드리지 않는다.
          const allCells = Array.from(target.querySelectorAll<HTMLElement>("table.edrb-pivot th, table.edrb-pivot td"));
          allCells.forEach((cell) => {
            const existing = cell.querySelector<HTMLElement>(".edrb-dealer-inner");
            if (existing) {
              existing.classList.add("jpg-vcenter-fix");
              existing.style.display = "inline"; // 화면 CSS의 flex+height:23px를 완전히 무력화
              existing.style.height = "auto";
              return;
            }
            const wrapper = clonedDocument.createElement("span");
            wrapper.className = "jpg-vcenter-fix";
            while (cell.firstChild) wrapper.appendChild(cell.firstChild);
            cell.appendChild(wrapper);
          });
        },
      });

      const a = document.createElement("a");
      a.download = `전사공지용_실적_${date}.jpg`;
      a.href = canvas.toDataURL("image/jpeg", 0.94);
      a.click();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Layout title="마감보고 · 공지텍스트">
      <PerformanceDateBar
        title="마감보고 · 공지텍스트"
        date={date}
        onDateChange={setDate}
        onRefresh={() => refetch()}
        isFetching={isFetching}
        extra={
          <Button variant="outline" onClick={handleSaveJpg} disabled={!isSuccess || saving}>
            <ImageDown className="h-4 w-4 mr-2" />
            JPG 저장
          </Button>
        }
      />

      {isLoading && <PerformanceLoadingBanner />}
      {isError && <PerformanceErrorBanner onRetry={() => refetch()} error={error} />}

      {data && !isLoading && (
        <div className="space-y-6">
          <EnterpriseDailyReportBoard dataset={data} tableExportRef={tableExportRef} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">마감 확정</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium">유선 마감 확정</p>
                  <p className="text-xs text-gray-500">
                    {date} 기준 라이브 Google Sheets 값으로 internet_daily_closings에 저장합니다. 같은 날짜를 다시
                    눌러도 중복 가산되지 않습니다.
                  </p>
                </div>
                <Button onClick={handleCloseWire} disabled={closingWire}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {closingWire ? "처리 중…" : "유선 마감 확정"}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap opacity-70">
                <div>
                  <p className="text-sm font-medium">전체(모바일·기타업무 포함) 마감 확정</p>
                  <p className="text-xs text-gray-500">모바일/전사 실적 전체를 보존하는 마감 snapshot 저장 구조가 아직 없습니다.</p>
                </div>
                <Button disabled variant="outline">
                  <Lock className="h-4 w-4 mr-2" />
                  마감 저장 backend 미연결
                </Button>
              </div>

              <Alert>
                <AlertTitle className="text-sm">참고</AlertTitle>
                <AlertDescription className="text-xs">
                  마감 확정은 ADMIN만 가능합니다. 유선 마감은 기존 검증된 closeWireDay()를 그대로 사용하며,
                  이 화면에서 로직을 수정하지 않았습니다.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      )}
    </Layout>
  );
}

export default PerformanceClosing;
