// client/src/pages/PerformanceManagement.tsx
//
// 작업명: MCC_PERFORMANCE_HTML_UI_ROUTE_AND_EXPORT_FINAL_RESTORE_1
// (원래 사이트 연결: MCC_PERFORMANCE_SITE_INTEGRATION_1)
//
// 실적관리 화면(/performance) — index.html의 routes.result가 실제로 가리키는
// MCC_UNIFIED_PERFORMANCE_REPORT_HTML_17/result_management.html을 그대로 이식한
// ResultManagementBoard를 렌더링한다. 새 카드/표 디자인(PerformanceSummaryCards/
// WorkerPerformanceTable)은 더 이상 사용하지 않는다 — 기존 HTML UI로 완전히 교체했다.

import { useState } from "react";
import { Layout } from "@/components/Layout";
import { PerformanceDateBar } from "@/components/performance/PerformanceDateBar";
import { ResultManagementBoard } from "@/components/performance/ResultManagementBoard";
import { PerformanceLoadingBanner, PerformanceErrorBanner } from "@/components/performance/PerformanceStateBanner";
import { usePerformanceDataset, formatDateInput } from "@/hooks/usePerformanceDataset";

export function PerformanceManagement() {
  const [date, setDate] = useState(() => formatDateInput(new Date()));
  const { data, isLoading, isFetching, isError, error, refetch } = usePerformanceDataset(date);

  return (
    <Layout title="실적관리">
      <PerformanceDateBar title="실적관리" date={date} onDateChange={setDate} onRefresh={() => refetch()} isFetching={isFetching} />

      {isLoading && <PerformanceLoadingBanner />}
      {isError && <PerformanceErrorBanner onRetry={() => refetch()} error={error} />}

      {data && !isLoading && <ResultManagementBoard dataset={data} />}
    </Layout>
  );
}

export default PerformanceManagement;
