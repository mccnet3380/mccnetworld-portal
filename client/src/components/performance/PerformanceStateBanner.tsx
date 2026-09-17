// client/src/components/performance/PerformanceStateBanner.tsx
//
// 작업명: MCC_PERFORMANCE_BROWSER_DATA_FETCH_FIX_1
// 3개 실적 화면 공통 로딩/오류 상태 — 데이터를 0으로 먼저 보여주지 않는다.
// 오류는 "불러오지 못했습니다" 하나로 뭉뚱그리지 않고, 서버가 준 실제 메시지를 함께 보여준다
// (useApiRequest()가 서버 응답의 error 필드를 Error.message로 던지므로 이미 안전하게 정제된
// 문자열이다 — stack trace/민감정보는 노출하지 않는다).

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 300);
  return "알 수 없는 오류";
}

export function PerformanceLoadingBanner() {
  return (
    <Card>
      <CardContent className="py-10 text-center space-y-3">
        <p className="text-sm text-gray-500">실적 데이터를 불러오는 중입니다…</p>
        <div className="space-y-2 max-w-md mx-auto">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-5/6 mx-auto" />
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceErrorBanner({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="py-10 text-center space-y-3">
        <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
        <p className="text-sm font-medium text-destructive">실적 데이터를 불러오지 못했습니다.</p>
        {error !== undefined && <p className="text-xs text-gray-500">서버 응답: {safeErrorMessage(error)}</p>}
        <Button variant="outline" onClick={onRetry}>다시 시도</Button>
      </CardContent>
    </Card>
  );
}

export function PerformanceEmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400 py-6 text-center">{children}</p>;
}

/** performanceRate 등 null 가능 수치 표시 — NaN/Infinity/0%로 임의 대체하지 않는다 */
export function formatRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return "-";
  return `${rate.toFixed(1)}%`;
}
