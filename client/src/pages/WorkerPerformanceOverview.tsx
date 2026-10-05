// client/src/pages/WorkerPerformanceOverview.tsx
//
// 작업명: MCC_ADMIN_WORKER_PERFORMANCE_OVERVIEW_1
//
// 관리자 전용 "근무자 실적" 요약 화면(/admin/worker-performance). 새 계산 공식을 만들지
// 않는다 — GET /api/admin/worker-performance-overview가 이미 server/lib/personal-performance.ts
// (개인 실적 /performance/me와 동일한 LOCK 계산)로 계산한 값을 그대로 렌더링만 한다.
// 디자인 톤(Card/period 버튼/타이포그래피)은 PersonalPerformance.tsx를 그대로 재사용한다.
//
// 1차 범위: 요약 카드 + 근무자별 비교 테이블까지만. 행 클릭을 통한 "다른 근무자" 개인
// 상세 진입은 포함하지 않는다 — 기존 /performance/me(GET /api/personal-performance/me)는
// 세션의 userId → users.performanceWorkerName 매핑만으로 본인 데이터만 반환하도록
// 하드코딩되어 있어(쿼리 파라미터를 전혀 읽지 않음), 다른 근무자를 안전하게 조회할 수 있는
// admin 전용 상세 API가 현재 존재하지 않는다. 억지로 쿼리 파라미터만 붙이면 그 API의
// "세션 기준 전용" 보장이 깨지므로, 상세 진입은 이번 1차 범위에서 제외하고 별도 작업으로
// 남긴다(§6 — 보안보다 편의성을 우선하지 않음).

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiRequest } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Range = "today" | "week" | "month";

interface WorkerRow {
  worker: string;
  homeNetwork: string;
  activation: { recognized: number; self: number; supportTotal: number; contributionRate: number | null };
  change: { total: number; self: number; supportTotal: number; contributionRate: number | null };
  supportTotal: number;
}

interface OverviewResponse {
  range: { type: Range; dates: string[] };
  summary: { activationTotal: number; changeTotal: number; supportTotal: number; workerCount: number };
  workers: WorkerRow[];
}

function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? "-" : `${v.toFixed(1)}%`;
}

export function WorkerPerformanceOverview() {
  const apiRequest = useApiRequest();
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiRequest(`/api/admin/worker-performance-overview?range=${range}`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const rangeLabel = range === "today" ? "오늘" : range === "week" ? "이번 주" : "이번 달";

  return (
    <Layout title="근무자 실적">
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">근무자 실적</h1>
            <p className="text-sm text-muted-foreground mt-1">전체 근무자의 개통·변경 업무 실적을 확인할 수 있습니다.</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {(["today", "week", "month"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-semibold transition-colors",
                  range === r ? "bg-white text-primary shadow-sm" : "text-muted-foreground",
                )}
              >
                {r === "today" ? "오늘" : r === "week" ? "이번 주" : "이번 달"}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
        {error && <p className="text-sm text-red-600 font-semibold">{error}</p>}

        {!loading && !error && data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label={`전체 개통 처리 (${rangeLabel})`} value={`${data.summary.activationTotal}건`} />
              <MetricCard label={`전체 변경 처리 (${rangeLabel})`} value={`${data.summary.changeTotal}건`} />
              <MetricCard label={`전체 지원 처리 (${rangeLabel})`} value={`${data.summary.supportTotal}건`} />
              <MetricCard label="실적 대상 근무자" value={`${data.summary.workerCount}명`} />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">근무자별 실적 ({rangeLabel})</CardTitle>
                <CardDescription>
                  개통 처리가 많은 순으로 정렬됩니다. 개통·변경 기여도는 개인 실적 화면과 동일한 기준(인정 처리량 ÷ 소속망 공식 총수량 × 100)입니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto border rounded-md">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead className="bg-muted">
                      <tr>
                        {["근무자", "소속망", "개통 처리", "변경 처리", "지원 처리", "개통 기여도", "변경 기여도"].map((h) => (
                          <th key={h} className="p-2 text-left font-medium whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.workers.map((w) => (
                        <tr key={w.worker} className="border-t">
                          <td className="p-2 font-medium">{w.worker}</td>
                          <td className="p-2 text-muted-foreground">{w.homeNetwork}</td>
                          <td className="p-2">{w.activation.recognized}건</td>
                          <td className="p-2">{w.change.total}건</td>
                          <td className="p-2">{w.supportTotal}건</td>
                          <td className="p-2">{fmtPct(w.activation.contributionRate)}</td>
                          <td className="p-2">{fmtPct(w.change.contributionRate)}</td>
                        </tr>
                      ))}
                      {data.workers.length === 0 && (
                        <tr>
                          <td colSpan={7} className="p-6 text-center text-muted-foreground">
                            해당 기간 실적 데이터가 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground pt-3">
                  근무자별 상세(개인 실적 화면과 동일한 상세 보기)는 현재 본인 로그인 세션 기준으로만 제공됩니다 — 관리자가 다른 근무자의 상세를 안전하게 조회하는 기능은 이번 1차 범위에 포함하지 않았습니다(별도 작업 필요).
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs font-semibold text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1.5">{value}</div>
      </CardContent>
    </Card>
  );
}
