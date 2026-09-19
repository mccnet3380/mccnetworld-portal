// server/routes/personal-performance.ts
//
// 작업명: MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1
//
// 로그인한 근무자 본인의 개인 실적만 반환하는 API. worker 식별은 오직 session의
// userId → users.performanceWorkerName 순서로만 결정한다 — frontend가 workerName/
// performanceWorkerName/다른 userId를 보내도 절대 사용하지 않는다(query param 자체를
// 읁지 않음). 다른 근무자의 개별 실적은 이 응답에 절대 포함하지 않는다(팀 평균은
// 서버에서 계산된 숫자만 내려준다).
//
// 권한: admin 또는 (dealerId/dealerRegistrationId가 없는) 내부 user만 허용.
// sales_manager는 이번 기능(내부 개통 근무자 실적) 대상이 아니고, 그 세션의 userId는
// salesManagers.id를 가리켜 users 테이블 조회 자체가 의미 없으므로 명시적으로 차단한다.
// dealer도 차단한다. LG/KT 검수의 requireLgAuditAccess/requireInternalOrAdminAccess는
// sales_manager를 허용하는 다른 정책이라 그대로 재사용하지 않고, 이 파일에서 독립적으로
// 판정한다(LG/KT 파일은 무수정).

import { Router } from "express";
import { getStorage } from "../storage";
import { workerHomeNetwork } from "../lib/performance-classify";
import {
  createLedgerCache,
  resolveRangeDates,
  lastNDays,
  computeActivationPerformanceForDates,
  aggregateForWorker,
  teamAverageForHome,
  computeChangeWorkForDates,
  aggregateChangeForWorker,
  teamAverageChangeForHome,
  activationSourceLabel,
  ymd,
} from "../lib/personal-performance";

const router = Router();

type Range = "today" | "week" | "month";

async function requirePersonalPerformanceSession(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType !== "admin" && session.userType !== "user") {
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }
  if (session.userType === "user") {
    const user = await getStorage().getUserById(session.userId);
    if (!user || user.dealerId || user.dealerRegistrationId) {
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }
  }
  req.session = session;
  next();
}

function parseRange(v: unknown): Range | null {
  if (v === "today" || v === "week" || v === "month") return v;
  return null;
}

router.get("/api/personal-performance/me", requirePersonalPerformanceSession, async (req: any, res) => {
  const range = parseRange(req.query.range) ?? "today";
  const today = new Date();

  try {
    // admin은 users 테이블의 performanceWorkerName 매핑 체계에 해당하지 않는다(admins는
    // 별도 테이블) — 항상 "매핑 없음"으로 응답하고 관리 기능으로 안내한다. 추측 매칭 없음.
    if (req.session.userType === "admin") {
      const admin = await getStorage().getAdminById(req.session.userId);
      return res.json({
        mapped: false,
        isAdmin: true,
        user: { name: admin?.name ?? "", userType: "admin" },
        message: "관리자 계정은 실적관리에서 전체 근무자 실적을 확인할 수 있습니다.",
      });
    }

    const user = await getStorage().getUserById(req.session.userId);
    const performanceWorkerName = user?.performanceWorkerName || null;

    if (!performanceWorkerName) {
      return res.json({
        mapped: false,
        isAdmin: false,
        user: { name: user?.name ?? "", userType: "user" },
        message: "실적 작업자가 아직 연결되지 않았습니다. 관리자에게 실적 작업자 연결을 요청해 주세요.",
      });
    }

    const cache = createLedgerCache();
    const home = workerHomeNetwork(performanceWorkerName);

    // ── 개통 업무 ──────────────────────────────────────────────────────────
    // [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] "오늘"은 실시간
    // ■당일완료, 그 이전 날짜는 확정 historical source(개통처리부)를 자동으로 선택한다
    // (computeActivationPerformanceForDates 내부, 오늘 실적 계산 방식 자체는 무변경).
    const rangeDates = resolveRangeDates(range, today);
    const rangePerDay = await computeActivationPerformanceForDates(rangeDates, today, cache);
    const rangeAgg = aggregateForWorker(rangePerDay, performanceWorkerName);
    const teamAverage = teamAverageForHome(rangePerDay, home);

    // 이번 달 누적(목표 비교용) — range와 무관하게 항상 "이번 달 1일~오늘" 기준.
    // 분자(월 인정 처리량)와 분모(월 officialTotal)를 반드시 같은 날짜 범위로 합산한다 —
    // "월 누적 ÷ 오늘 officialTotal" 같은 기간 혼합 금지(LOCK 원칙).
    const monthDates = resolveRangeDates("month", today);
    const monthPerDay = range === "month" ? rangePerDay : await computeActivationPerformanceForDates(monthDates, today, cache);
    const monthAgg = aggregateForWorker(monthPerDay, performanceWorkerName);

    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const targetRow = await getStorage().getPerformanceTarget(req.session.userId, year, month);
    const targetContributionRate = targetRow?.targetContributionRate != null ? Number(targetRow.targetContributionRate) : null;
    const changeTargetRate = targetRow?.changeTargetRate != null ? Number(targetRow.changeTargetRate) : null;
    const monthContributionRate = monthAgg.contributionRate;

    let achievementRate: number | null = null;
    let diffPoints: number | null = null;
    if (targetContributionRate !== null && monthContributionRate !== null && targetContributionRate > 0) {
      achievementRate = (monthContributionRate / targetContributionRate) * 100;
      diffPoints = monthContributionRate - targetContributionRate;
    }

    // ── 변경 업무(기타업무) ────────────────────────────────────────────────
    // [MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4] source=■변경완료+
    // 00700결합(기존 otherDuty 페어링). 개통 처리량과 절대 합산하지 않는다. 기여도/목표율
    // 공식은 기존 코드/HTML 어디에서도 확인되지 않아 계산하지 않는다(HOLD) — 처리량만 제공.
    const changeRangePerDay = await computeChangeWorkForDates(rangeDates, cache);
    const changeRangeAgg = aggregateChangeForWorker(changeRangePerDay, performanceWorkerName);
    const changeTeamAverage = teamAverageChangeForHome(changeRangePerDay, home);

    const changeMonthPerDay = range === "month" ? changeRangePerDay : await computeChangeWorkForDates(monthDates, cache);
    const changeMonthAgg = aggregateChangeForWorker(changeMonthPerDay, performanceWorkerName);

    // 최근 7일 추이 — range와 무관하게 항상 7일(오늘 포함), 같은 캐시 재사용. 개통/변경을
    // 날짜별로 구분해서 제공한다(그래프용 가짜 값 없음, 전부 실제 계산 결과).
    const trendDates = lastNDays(7, today);
    const trendActivationPerDay = await computeActivationPerformanceForDates(trendDates, today, cache);
    const trendChangePerDay = await computeChangeWorkForDates(trendDates, cache);
    const trend = trendActivationPerDay.map((d, i) => {
      const mine = d.workers.find((w) => w.worker === performanceWorkerName);
      const changeDay = trendChangePerDay[i];
      const mineChange = changeDay?.workers.find((w) => w.worker === performanceWorkerName);
      return {
        date: d.date,
        activationSource: activationSourceLabel(trendDates[i], today),
        activationRecognized: mine ? mine.totalHandled : 0,
        changeTotal: mineChange ? mineChange["합계"] : 0,
      };
    });

    // 최근 실적 내역 — 최근 7일 중 실제 처리 이력이 있는 날짜만, 개통/변경 및 본인/지원
    // 구분해서 나열한다. 각 업무는 서로 다른 source/배열에서 나오므로 중복 표시되지 않는다.
    const recent: { date: string; workType: "개통" | "변경"; channel: string; type: string; count: number }[] = [];
    for (let i = trendActivationPerDay.length - 1; i >= 0; i--) {
      const d = trendActivationPerDay[i];
      const mine = d.workers.find((w) => w.worker === performanceWorkerName);
      if (mine) {
        if (mine.homeCount > 0) recent.push({ date: d.date, workType: "개통", channel: home, type: "본인 처리", count: mine.homeCount });
        (["SK", "KT", "LG", "TOSS"] as const).forEach((net) => {
          const key = `support${net}` as "supportSK" | "supportKT" | "supportLG" | "supportTOSS";
          const v = mine[key];
          if (v > 0) recent.push({ date: d.date, workType: "개통", channel: net, type: "지원 처리", count: v });
        });
      }
      const changeDay = trendChangePerDay[i];
      const mineChange = changeDay?.workers.find((w) => w.worker === performanceWorkerName);
      if (mineChange && mineChange["합계"] > 0) {
        recent.push({ date: d.date, workType: "변경", channel: mineChange.home, type: "처리", count: mineChange["합계"] });
      }
    }

    res.set("Cache-Control", "no-store");
    res.json({
      mapped: true,
      isAdmin: false,
      user: { name: user.name, homeNetwork: home, performanceWorkerName },
      range: { type: range, dates: rangeDates.map((d) => ymd(d)) },
      activation: {
        recognized: rangeAgg.recognized,
        self: rangeAgg.self,
        support: { SK: rangeAgg.supportSK, KT: rangeAgg.supportKT, LG: rangeAgg.supportLG, TOSS: rangeAgg.supportTOSS, total: rangeAgg.supportTotal },
        homeNetworkOfficialTotal: rangeAgg.officialTotal || null,
        contributionRate: rangeAgg.contributionRate,
        teamAverage,
      },
      activationMonth: {
        recognized: monthAgg.recognized,
        homeNetworkOfficialTotal: monthAgg.officialTotal || null,
        contributionRate: monthContributionRate,
      },
      activationTarget:
        targetContributionRate !== null
          ? { year, month, targetContributionRate, achievementRate, diffPoints }
          : { year, month, targetContributionRate: null, message: "이번 달 목표 미설정" },
      change: {
        total: changeRangeAgg.total,
        self: changeRangeAgg.self,
        support: { SK: changeRangeAgg.supportSK, KT: changeRangeAgg.supportKT, LG: changeRangeAgg.supportLG, TOSS: changeRangeAgg.supportTOSS, total: changeRangeAgg.supportTotal },
        teamAverage: changeTeamAverage,
      },
      changeMonth: {
        total: changeMonthAgg.total,
        self: changeMonthAgg.self,
      },
      // [HOLD] 변경 업무의 기여도/목표 달성률 계산 공식은 기존 코드/HTML 어디에서도
      // 확인되지 않았다 — 개통 목표율 공식을 그대로 복사하지 않기 위해 달성률/기여도는
      // 계산하지 않고 관리자가 저장한 목표값만 그대로 전달한다.
      changeTarget:
        changeTargetRate !== null
          ? { year, month, changeTargetRate, note: "달성률 계산 공식이 아직 확정되지 않아 목표값만 표시합니다." }
          : { year, month, changeTargetRate: null, message: "이번 달 변경 목표 미설정" },
      trend,
      recent: recent.slice(0, 10),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
