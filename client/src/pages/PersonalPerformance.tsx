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
// [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] MCC의 개인 업무 실적은
// 개통 업무와 변경 업무, 최소 두 개의 독립 KPI다(요구사항) — 하나로 합쳐서 하나의
// 기여도/목표율을 계산하지 않는다. 이 화면은 기존 디자인 언어를 유지하면서 "개통 업무"
// 섹션(기존 히어로 카드, LOCK 공식 그대로)과 "변경 업무" 섹션(신규, 처리량만 — 기여도/
// 목표 달성률 공식은 기존 코드/HTML 어디에도 없어 HOLD, 처리량만 표시)을 분리해서 보여준다.

import { useEffect, useState } from "react";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApiRequest } from "@/lib/auth";
import { cn } from "@/lib/utils";

type Range = "today" | "week" | "month";

interface ActivationBlock {
  recognized: number;
  self: number;
  support: { SK: number; KT: number; LG: number; TOSS: number; total: number };
  homeNetworkOfficialTotal: number | null;
  contributionRate: number | null;
  teamAverage: number | null;
}

interface ChangeBlock {
  total: number;
  self: number;
  support: { SK: number; KT: number; LG: number; TOSS: number; total: number };
  teamAverage: number | null;
  homeNetworkOfficialTotal: number | null;
  contributionRate: number | null;
}

interface PersonalPerformanceResponse {
  mapped: boolean;
  isAdmin: boolean;
  user: { name: string; homeNetwork?: string; performanceWorkerName?: string; userType?: string };
  message?: string;
  range?: { type: Range; dates: string[] };
  activation?: ActivationBlock;
  activationMonth?: { recognized: number; homeNetworkOfficialTotal: number | null; contributionRate: number | null };
  activationTarget?: {
    year: number;
    month: number;
    targetContributionRate: number | null;
    achievementRate?: number | null;
    diffPoints?: number | null;
    message?: string;
  };
  change?: ChangeBlock;
  changeMonth?: { total: number; self: number; homeNetworkOfficialTotal: number | null; contributionRate: number | null };
  changeTarget?: {
    year: number;
    month: number;
    changeTargetRate: number | null;
    achievementRate?: number | null;
    diffPoints?: number | null;
    note?: string;
    message?: string;
  };
  trend?: { date: string; activationSource: string; activationRecognized: number; changeTotal: number }[];
  recent?: { date: string; workType: "개통" | "변경"; channel: string; type: string; count: number }[];
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
            <p className="text-sm text-muted-foreground mt-1">내 개통·변경 업무 실적을 한눈에 확인하세요.</p>
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
                {data.isAdmin ? "관리자 계정은 실적관리에서 전체 근무자 실적을 확인할 수 있습니다." : "실적 작업자가 아직 연결되지 않았습니다."}
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                {data.isAdmin
                  ? "근무자별 실적 작업자 연결과 월별 목표는 실적관리(/performance)의 \"월별 인원·목표\" 탭에서 관리합니다."
                  : "관리자에게 실적 작업자 연결을 요청해 주세요."}
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && !error && data && data.mapped && data.activation && (
          <PersonalPerformanceView data={data} />
        )}
      </div>
    </Layout>
  );
}

function PersonalPerformanceView({ data }: { data: PersonalPerformanceResponse }) {
  const act = data.activation!;
  const chg = data.change!;
  const target = data.activationTarget;
  const changeTarget = data.changeTarget;
  const ringPct = target?.achievementRate != null ? Math.max(0, Math.min(100, target.achievementRate)) : 0;
  const changeRingPct = changeTarget?.achievementRate != null ? Math.max(0, Math.min(100, changeTarget.achievementRate)) : 0;
  const rangeLabel = data.range?.type === "today" ? "오늘" : data.range?.type === "week" ? "이번 주" : "이번 달";

  return (
    <div className="space-y-8">
      {/* ── 개통 업무 ────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold text-gray-500 tracking-wide">개통 업무</h2>

        <div className="grid gap-4 md:grid-cols-[1.2fr_.8fr]">
          <Card className="border-0 text-white" style={{ background: "linear-gradient(135deg,#173968 0%,#245ec0 62%,#4b7ee1 100%)" }}>
            <CardContent className="py-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold opacity-75 mb-2">이번 달 개통 현재 기여도</div>
                <div className="text-3xl font-extrabold">
                  {fmtPct(data.activationMonth?.contributionRate)}
                  <span className="text-sm font-semibold opacity-80 ml-2">
                    {target?.targetContributionRate != null ? `목표 ${fmtPct(target.targetContributionRate)}` : "목표 미설정"}
                  </span>
                </div>
                <div className="text-xs mt-2 opacity-90">
                  {target?.targetContributionRate != null
                    ? `목표 대비 달성 ${fmtPct(target.achievementRate)} · 목표와 차이 ${fmtPtDiff(target.diffPoints)}`
                    : "이번 달 개통 목표가 아직 설정되지 않았습니다."}
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
              <CardTitle className="text-sm">개통 팀 평균과 비교 ({rangeLabel})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CompareBar label="내 인정 처리량" value={act.recognized} max={Math.max(act.recognized, act.teamAverage ?? 0, 1)} color="#266be9" />
              <CompareBar label={`${data.user.homeNetwork}팀 평균`} value={act.teamAverage} max={Math.max(act.recognized, act.teamAverage ?? 0, 1)} color="#a9b5c6" />
              <p className="text-xs text-muted-foreground pt-1">
                * 팀 평균은 같은 기간 실적이 등록된 같은 망({data.user.homeNetwork}) 근무자 기준입니다. 휴무/근태는 반영하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label={`${rangeLabel} 개통 인정 처리량`} value={`${act.recognized}건`} />
          <MetricCard label="본인 처리" value={`${act.self}건`} />
          <MetricCard label="지원 처리" value={`${act.support.total}건`} sub={act.support.total === 0 ? "현재 지원업무 없음" : undefined} />
          <MetricCard label={`${data.user.homeNetwork}망 총실적`} value={act.homeNetworkOfficialTotal != null ? `${act.homeNetworkOfficialTotal}건` : "-"} sub={`${data.user.homeNetwork}망 기준`} />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">개통 처리 구성 ({rangeLabel})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChannelBar label={`${data.user.homeNetwork} 본인 처리`} value={act.self} max={Math.max(act.recognized, 1)} color="#e9579c" />
            {(["SK", "KT", "LG", "TOSS"] as const)
              .filter((net) => net !== data.user.homeNetwork)
              .map((net) => (
                <ChannelBar key={net} label={`${net} 지원 처리`} value={act.support[net]} max={Math.max(act.recognized, 1)} color={net === "KT" ? "#2c74e8" : net === "SK" ? "#ef7f47" : "#7e5bef"} />
              ))}
          </CardContent>
        </Card>
      </section>

      {/* ── 변경 업무 ────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-bold text-gray-500 tracking-wide">변경 업무</h2>

        <div className="grid gap-4 md:grid-cols-[1.2fr_.8fr]">
          <Card className="border-0 text-white" style={{ background: "linear-gradient(135deg,#3d2a70 0%,#5c3fae 62%,#7e5bef 100%)" }}>
            <CardContent className="py-5 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold opacity-75 mb-2">이번 달 변경 현재 기여도</div>
                <div className="text-3xl font-extrabold">
                  {fmtPct(data.changeMonth?.contributionRate)}
                  <span className="text-sm font-semibold opacity-80 ml-2">
                    {changeTarget?.changeTargetRate != null ? `목표 ${fmtPct(changeTarget.changeTargetRate)}` : "목표 미설정"}
                  </span>
                </div>
                <div className="text-xs mt-2 opacity-90">
                  {changeTarget?.changeTargetRate != null
                    ? `목표 대비 달성 ${fmtPct(changeTarget.achievementRate)} · 목표와 차이 ${fmtPtDiff(changeTarget.diffPoints)}`
                    : "이번 달 변경 목표가 아직 설정되지 않았습니다."}
                </div>
              </div>
              <div
                className="h-[110px] w-[110px] rounded-full grid place-items-center flex-shrink-0"
                style={{ background: `conic-gradient(#75e1c2 0 ${changeRingPct}%, rgba(255,255,255,.18) ${changeRingPct}% 100%)` }}
              >
                <div className="h-[80px] w-[80px] rounded-full grid place-items-center text-lg font-extrabold" style={{ background: "#5c3fae" }}>
                  {changeTarget?.changeTargetRate != null ? `${changeRingPct.toFixed(0)}%` : "-"}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">변경 팀 평균과 비교 ({rangeLabel})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CompareBar label="내 변경 처리량" value={chg.total} max={Math.max(chg.total, chg.teamAverage ?? 0, 1)} color="#7e5bef" />
              <CompareBar label={`${data.user.homeNetwork}팀 평균`} value={chg.teamAverage} max={Math.max(chg.total, chg.teamAverage ?? 0, 1)} color="#a9b5c6" />
              <p className="text-xs text-muted-foreground pt-1">
                * 팀 평균은 같은 기간 실적이 등록된 같은 망({data.user.homeNetwork}) 근무자 기준입니다. 휴무/근태는 반영하지 않습니다.
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label={`${rangeLabel} 변경 인정 처리량`} value={`${chg.total}건`} />
          <MetricCard label="본인 처리" value={`${chg.self}건`} />
          <MetricCard label="지원 처리" value={`${chg.support.total}건`} sub={chg.support.total === 0 ? "현재 지원업무 없음" : undefined} />
          <MetricCard label={`${data.user.homeNetwork}망 변경 총실적`} value={chg.homeNetworkOfficialTotal != null ? `${chg.homeNetworkOfficialTotal}건` : "-"} sub={`${data.user.homeNetwork}망 기준(■변경완료+00700)`} />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">변경 처리 구성 ({rangeLabel})</CardTitle>
            <CardDescription>■변경완료(00700 포함) 기준. 개통 처리량과 합산되지 않습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChannelBar label={`${data.user.homeNetwork} 본인 처리`} value={chg.self} max={Math.max(chg.total, 1)} color="#e9579c" />
            {(["SK", "KT", "LG", "TOSS"] as const)
              .filter((net) => net !== data.user.homeNetwork)
              .map((net) => (
                <ChannelBar key={net} label={`${net} 지원 처리`} value={chg.support[net]} max={Math.max(chg.total, 1)} color={net === "KT" ? "#2c74e8" : net === "SK" ? "#ef7f47" : "#7e5bef"} />
              ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-[1.4fr_.8fr]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">최근 7일 실적 추이 (개통 · 변경)</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart trend={data.trend || []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">범례</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: "#286de7" }} /> 개통 인정 처리량</div>
            <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: "#7e5bef" }} /> 변경 처리량</div>
            <p className="text-xs text-muted-foreground pt-1">오늘은 ■당일완료, 그 이전 날짜는 개통처리부 기준입니다.</p>
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
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2 text-left font-medium">날짜</th>
                  <th className="p-2 text-left font-medium">업무</th>
                  <th className="p-2 text-left font-medium">소속</th>
                  <th className="p-2 text-left font-medium">처리 구분</th>
                  <th className="p-2 text-left font-medium">수량</th>
                </tr>
              </thead>
              <tbody>
                {(data.recent || []).map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{r.date}</td>
                    <td className="p-2">{r.workType}</td>
                    <td className="p-2">{r.channel}</td>
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 font-semibold">{r.count}건</td>
                  </tr>
                ))}
                {(!data.recent || data.recent.length === 0) && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">최근 7일 내 처리 내역이 없습니다.</td>
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
// [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] 개통(activationRecognized)과
// 변경(changeTotal) 두 선을 함께 그린다.
function TrendChart({ trend }: { trend: { date: string; activationSource: string; activationRecognized: number; changeTotal: number }[] }) {
  const width = 620;
  const height = 180;
  const yTop = 20;
  const yBase = 150;
  const yClose = 170;

  const allValues = trend.flatMap((t) => [t.activationRecognized, t.changeTotal]);
  const max = Math.max(1, ...allValues);
  const n = trend.length;

  function pointsFor(key: "activationRecognized" | "changeTotal") {
    return trend.map((t, i) => {
      const x = n > 1 ? (i / (n - 1)) * width : width / 2;
      const frac = t[key] / max;
      const y = yBase - frac * (yBase - yTop);
      return { x, y };
    });
  }
  const actPoints = pointsFor("activationRecognized");
  const chgPoints = pointsFor("changeTotal");

  function toPath(points: { x: number; y: number }[]) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }
  const actLine = toPath(actPoints);
  const actArea = actPoints.length ? `${actLine} L${width} ${yClose} L0 ${yClose} Z` : "";
  const chgLine = toPath(chgPoints);
  const lastAct = actPoints[actPoints.length - 1];
  const lastChg = chgPoints[chgPoints.length - 1];

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
          {actArea && <path d={actArea} fill="url(#personalPerfArea)" />}
          {actLine && <path d={actLine} fill="none" stroke="#286de7" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
          {chgLine && <path d={chgLine} fill="none" stroke="#7e5bef" strokeWidth={2.5} strokeDasharray="5,4" strokeLinecap="round" strokeLinejoin="round" />}
          {lastAct && <circle cx={lastAct.x} cy={lastAct.y} r={5} fill="#fff" stroke="#286de7" strokeWidth={3} />}
          {lastChg && <circle cx={lastChg.x} cy={lastChg.y} r={4} fill="#fff" stroke="#7e5bef" strokeWidth={2.5} />}
        </svg>
      </div>
      <div className="flex justify-between text-[11px] text-muted-foreground px-1">
        {dayLabels.map((label, i) => (
          <span key={trend[i]?.date ?? i}>{label}</span>
        ))}
      </div>
      <div className="flex justify-between text-xs font-semibold text-muted-foreground px-1 mt-0.5">
        {trend.map((t) => (
          <span key={t.date}>{t.activationRecognized}/{t.changeTotal}</span>
        ))}
      </div>
    </div>
  );
}
