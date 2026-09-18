// client/src/pages/PersonalPerformance.tsx
//
// 작업명: MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1
//
// 개인 실적 대시보드(/performance/me) — MCC_PERSONAL_PERFORMANCE_DASHBOARD_V1.html의
// 메인 콘텐츠 디자인을 기존 MCC Layout/Sidebar 안에서 포팅한다. 참고 HTML의 독립
// topbar/sidebar는 만들지 않는다. 모든 샘플값(30/44/68%/23/78/38.5%)은 제거하고
// GET /api/personal-performance/me 응답으로만 렌더링한다.
//
// worker 식별은 서버가 session 기준으로만 결정한다 — 이 페이지는 workerName/
// performanceWorkerName/다른 userId를 절대 쿼리로 보내지 않는다.
//
// admin은 매핑 대상이 아니라 항상 mapped:false로 응답받는다 — 그 경우 이 페이지는
// "/performance의 월별 인원·목표에서 관리하라"는 안내만 보여준다.
//
// [MCC_PERSONAL_PERFORMANCE_DASHBOARD_CORRECTION_1] 관리자가 전체 직원 목표/매핑을 관리하는
// 표를 이 개인 페이지 하단에 중복해서 두지 않는다 — 실제 존재하는 기존
// client/src/components/performance/ResultManagementBoard.tsx의 "월별 인원·목표" 탭에
// worker_performance_targets 데이터를 연결했다(이 파일은 개인 결과 표시 전용으로 되돌림).
//
// 최근 7일 추이는 참고 HTML(MCC_PERSONAL_PERFORMANCE_DASHBOARD_V1.html)의 SVG 라인/영역
// 차트 형태를 실제 데이터로 그대로 포팅한다(막대 그래프로 단순화하지 않음).

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiRequest } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Range = "today" | "week" | "month";

interface PersonalPerformanceResponse {
  mapped: boolean;
  isAdmin: boolean;
  user: { name: string; homeNetwork?: string; performanceWorkerName?: string; userType?: string };
  message?: string;
  range?: { type: Range; dates: string[] };
  performance?: {
    recognized: number;
    self: number;
    support: { SK: number; KT: number; LG: number; TOSS: number; total: number };
    homeNetworkOfficialTotal: number | null;
    contributionRate: number | null;
    teamAverage: number | null;
  };
  month?: { recognized: number; homeNetworkOfficialTotal: number | null; contributionRate: number | null };
  target?: {
    year: number;
    month: number;
    targetContributionRate: number | null;
    achievementRate?: number | null;
    diffPoints?: number | null;
    message?: string;
  };
  trend?: { date: string; recognized: number }[];
  recent?: { date: string; channel: string; type: string; count: number }[];
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "-" : `${v.toFixed(digits)}%`;
}
function fmtPtDiff(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%p`;
}

export function PersonalPerformance() {
  const apiRequest = useApiRequest();

  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<PersonalPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiRequest(`/api/personal-performance/me?range=${range}`)
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

  return (
    <Layout title="개인 실적">
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              {data?.user?.name ? `${data.user.name}님, 오늘도 좋은 흐름이에요` : "개인 실적"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">내 처리 실적과 팀 기여도를 한눈에 확인하세요.</p>
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

        {!loading && !error && data && !data.mapped && (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-base font-semibold text-gray-800">
                {data.isAdmin ? "관리자 계정은 개인 실적 매핑 대상이 아닙니다." : "실적 작업자가 아직 연결되지 않았습니다."}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {data.isAdmin
                  ? "근무자별 실적 작업자/월별 목표는 실적관리(/performance)의 \"월별 인원·목표\" 탭에서 관리합니다."
                  : "관리자에게 실적 작업자 연결을 요청해 주세요."}
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && data && data.mapped && data.performance && (
          <PersonalPerformanceView data={data} />
        )}
      </div>
    </Layout>
  );
}

function PersonalPerformanceView({ data }: { data: PersonalPerformanceResponse }) {
  const perf = data.performance!;
  const target = data.target;
  const ringPct = target?.achievementRate != null ? Math.max(0, Math.min(100, target.achievementRate)) : 0;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-[1.2fr_.8fr]">
        <Card className="border-0 text-white" style={{ background: "linear-gradient(135deg,#173968 0%,#245ec0 62%,#4b7ee1 100%)" }}>
          <CardContent className="py-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold opacity-75 mb-2">이번 달 현재 기여도</div>
              <div className="text-3xl font-extrabold">
                {fmtPct(data.month?.contributionRate)}
                <span className="text-sm font-semibold opacity-80 ml-2">
                  {target?.targetContributionRate != null ? `목표 ${fmtPct(target.targetContributionRate)}` : "목표 미설정"}
                </span>
              </div>
              <div className="text-xs mt-2 opacity-90">
                {target?.targetContributionRate != null
                  ? `목표 대비 달성 ${fmtPct(target.achievementRate)} · 목표와 차이 ${fmtPtDiff(target.diffPoints)}`
                  : "이번 달 목표가 아직 설정되지 않았습니다."}
              </div>
            </div>
            <div
              className="h-[110px] w-[110px] rounded-full grid place-items-center flex-shrink-0"
              style={{ background: `conic-gradient(#75e1c2 0 ${ringPct}%, rgba(255,255,255,.18) ${ringPct}% 100%)` }}
            >
              <div className="h-[80px] w-[80px] rounded-full grid place-items-center text-lg font-extrabold" style={{ background: "#275bb4" }}>
                {target?.targetContributionRate != null ? `${ringPct.toFixed(0)}%` : "-"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">팀 평균과 비교 ({data.range?.type === "today" ? "오늘" : data.range?.type === "week" ? "이번 주" : "이번 달"})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CompareBar label="내 인정 처리량" value={perf.recognized} max={Math.max(perf.recognized, perf.teamAverage ?? 0, 1)} color="#266be9" />
            <CompareBar label={`${data.user.homeNetwork}팀 평균`} value={perf.teamAverage} max={Math.max(perf.recognized, perf.teamAverage ?? 0, 1)} color="#a9b5c6" />
            <p className="text-xs text-muted-foreground pt-1">
              * 팀 평균은 당일 실적이 등록된 같은 망({data.user.homeNetwork}) 근무자 기준입니다. 휴무/근태는 반영하지 않습니다.
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="오늘 인정 처리량" value={`${perf.recognized}건`} />
        <MetricCard label="본인 처리" value={`${perf.self}건`} />
        <MetricCard label="지원 처리" value={`${perf.support.total}건`} sub={perf.support.total === 0 ? "현재 지원업무 없음" : undefined} />
        <MetricCard label={`${data.user.homeNetwork}망 총실적`} value={perf.homeNetworkOfficialTotal != null ? `${perf.homeNetworkOfficialTotal}건` : "-"} sub={`${data.user.homeNetwork}망 기준`} />
      </section>

      <section className="grid gap-4 md:grid-cols-[1.4fr_.8fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">최근 7일 실적 추이</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart trend={data.trend || []} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">처리 구성</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChannelBar label={`${data.user.homeNetwork} 본인 처리`} value={perf.self} max={Math.max(perf.recognized, 1)} color="#e9579c" />
            {(["SK", "KT", "LG", "TOSS"] as const)
              .filter((net) => net !== data.user.homeNetwork)
              .map((net) => (
                <ChannelBar key={net} label={`${net} 지원 처리`} value={perf.support[net]} max={Math.max(perf.recognized, 1)} color={net === "KT" ? "#2c74e8" : net === "SK" ? "#ef7f47" : "#7e5bef"} />
              ))}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">최근 실적 내역</CardTitle>
          <CardDescription>Google 스프레드시트 원장 기준 최근 7일 반영값입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto border rounded-md">
            <table className="w-full text-sm min-w-[500px]">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left font-medium">날짜</th>
                  <th className="p-2 text-left font-medium">소속</th>
                  <th className="p-2 text-left font-medium">처리 구분</th>
                  <th className="p-2 text-left font-medium">수량</th>
                </tr>
              </thead>
              <tbody>
                {(data.recent || []).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.channel}</td>
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 font-semibold">{r.count}건</td>
                  </tr>
                ))}
                {(!data.recent || data.recent.length === 0) && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-muted-foreground">최근 7일 내 처리 내역이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CompareBar({ label, value, max, color }: { label: string; value: number | null; max: number; color: string }) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <b>{value != null ? `${Math.round(value)}건` : "-"}</b>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function ChannelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-muted-foreground">{label}</span>
        <b>{value}건</b>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs font-semibold text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1.5">{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// MCC_PERSONAL_PERFORMANCE_DASHBOARD_CORRECTION_1: 참고 HTML의 SVG 라인/영역 차트를
// 실제 trend 데이터로 그대로 포팅한다(막대그래프 대체 금지). 값 자체(날짜/수량)는
// API 응답 그대로 사용 — 좌표만 계산한다.
function TrendChart({ trend }: { trend: { date: string; recognized: number }[] }) {
  const width = 620;
  const height = 180;
  const yTop = 20;
  const yBase = 150;
  const yClose = 170;

  const values = trend.map((t) => t.recognized);
  const max = Math.max(1, ...values);
  const n = trend.length;

  const points = trend.map((t, i) => {
    const x = n > 1 ? (i / (n - 1)) * width : width / 2;
    const frac = t.recognized / max;
    const y = yBase - frac * (yBase - yTop);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = points.length ? `${linePath} L${width} ${yClose} L0 ${yClose} Z` : "";
  const last = points[points.length - 1];

  const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
  const dayLabels = trend.map((t, i) => {
    if (i === trend.length - 1) return "오늘";
    const d = new Date(`${t.date}T00:00:00`);
    return weekdayLabels[d.getDay()];
  });

  return (
    <div>
      <div style={{ height: 190, paddingTop: 6, position: "relative" }}>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", overflow: "visible" }}>
          <defs>
            <linearGradient id="personalPerfArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#3c7aec" stopOpacity={0.28} />
              <stop offset="1" stopColor="#3c7aec" stopOpacity={0} />
            </linearGradient>
          </defs>
          <line x1="0" y1="35" x2={width} y2="35" stroke="#e8edf4" strokeWidth={1} />
          <line x1="0" y1="90" x2={width} y2="90" stroke="#e8edf4" strokeWidth={1} />
          <line x1="0" y1="145" x2={width} y2="145" stroke="#e8edf4" strokeWidth={1} />
          {areaPath && <path d={areaPath} fill="url(#personalPerfArea)" />}
          {linePath && <path d={linePath} fill="none" stroke="#286de7" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
          {last && <circle cx={last.x} cy={last.y} r={5} fill="#fff" stroke="#286de7" strokeWidth={3} />}
        </svg>
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground px-1">
        {dayLabels.map((label, i) => (
          <span key={trend[i]?.date ?? i}>{label}</span>
        ))}
      </div>
      <div className="flex justify-between text-xs font-semibold text-muted-foreground px-1 mt-0.5">
        {trend.map((t) => (
          <span key={t.date}>{t.recognized}건</span>
        ))}
      </div>
    </div>
  );
}
