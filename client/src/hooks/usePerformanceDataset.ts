// client/src/hooks/usePerformanceDataset.ts
//
// 작업명: MCC_PERFORMANCE_BROWSER_DATA_FETCH_FIX_1
//
// [실제 원인] App.tsx가 만드는 QueryClient(QueryClientProvider에 실제로 전달되는 그 인스턴스)에는
// defaultOptions.queries.queryFn이 없다 — 기존 모든 페이지(Dashboard.tsx 등)는 useQuery() 호출마다
// 항상 명시적으로 queryFn을 넘긴다(useApiRequest()로 만든 fetcher를 사용). 이 훅은 queryFn을 넘기지
// 않고 "@/lib/queryClient"의 getQueryFn 기본값에 의존했는데, 그 기본값은 App.tsx가 실제로 쓰는
// QueryClient에 연결돼 있지 않아 매 호출이 즉시 실패했다(브라우저에서만 재현 — curl은 이 React Query
// 배선을 거치지 않아 재현되지 않았다). 기존 정상 페이지와 동일하게 useApiRequest()를 명시적으로
// 사용하도록 맞춘다 — 새로운 인증 방식을 만들지 않는다.
//
// 실적관리 / 전사 공지용 당일실적 / 마감보고·공지텍스트 3개 화면이 공유하는 단일 조회 훅.
// staleTime: 0 — Google Sheets가 바뀌면 다음 조회에서 항상 최신 값이 나와야 하므로 캐시를 재사용하지 않는다.

import { useQuery } from "@tanstack/react-query";
import { useApiRequest } from "@/lib/auth";
import type { PerformanceDataset } from "@/types/performance";

export function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function usePerformanceDataset(dateStr: string) {
  const apiRequest = useApiRequest();

  return useQuery<PerformanceDataset>({
    queryKey: [`/api/performance/dataset?date=${dateStr}`],
    queryFn: () => apiRequest(`/api/performance/dataset?date=${dateStr}`) as Promise<PerformanceDataset>,
    staleTime: 0,
    gcTime: 0,
    enabled: !!dateStr,
  });
}
