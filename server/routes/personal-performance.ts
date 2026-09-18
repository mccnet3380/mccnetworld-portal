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
  computeWorkerPerformanceForDates,
  aggregateForWorker,
  teamAverageForHome,
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
        message: "관리자 계정은 개인 실적 매핑 대상이 아닙니다. 근무자 관리에서 매핑을 설정하세요.",
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

    const rangeDates = resolveRangeDates(range, today);
    const rangePerDay = await computeWorkerPerformanceForDates(rangeDates, cache);
    const rangeAgg = aggregateForWorker(rangePerDay, performanceWorkerName);
    const teamAverage = teamAverageForHome(rangePerDay, home);

    // 이번 달 누적(목표 비교용) — range와 무관하게 항상 "이번 달 1일~오늘" 기준
    const monthDates = resolveRangeDates("month", today);
    const monthPerDay = range === "month" ? rangePerDay : await computeWorkerPerformanceForDates(monthDates, cache);
    const monthAgg = aggregateForWorker(monthPerDay, performanceWorkerName);

    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const targetRow = await getStorage().getPerformanceTarget(req.session.userId, year, month);
    const targetContributionRate = targetRow ? Number(targetRow.targetContributionRate) : null;
    const monthContributionRate = monthAgg.contributionRate;

    let achievementRate: number | null = null;
    let diffPoints: number | null = null;
    if (targetContributionRate !== null && monthContributionRate !== null && targetContributionRate > 0) {
      achievementRate = (monthContributionRate / targetContributionRate) * 100;
      diffPoints = monthContributionRate - targetContributionRate;
    }

    // 최근 7일 추이 — range와 무관하게 항상 7일(오늘 포함), 같은 캐시 재사용
    const trendDates = lastNDays(7, today);
    const trendPerDay = await computeWorkerPerformanceForDates(trendDates, cache);
    const trend = trendPerDay.map((d) => {
      const mine = d.workers.find((w) => w.worker === performanceWorkerName);
      return { date: d.date, recognized: mine ? mine.totalHandled : 0 };
    });

    // 최근 반영 내역 — 최근 7일 중 실제 처리 이력이 있는 날짜만, 본인/지원 구분해서 나열
    const recent: { date: string; channel: string; type: string; count: number }[] = [];
    for (const d of [...trendPerDay].reverse()) {
      const mine = d.workers.find((w) => w.worker === performanceWorkerName);
      if (!mine) continue;
      if (mine.homeCount > 0) recent.push({ date: d.date, channel: home, type: "본인 처리", count: mine.homeCount });
      (["SK", "KT", "LG", "TOSS"] as const).forEach((net) => {
        const key = `support${net}` as "supportSK" | "supportKT" | "supportLG" | "supportTOSS";
        const v = mine[key];
        if (v > 0) recent.push({ date: d.date, channel: net, type: "지원 처리", count: v });
      });
    }

    res.set("Cache-Control", "no-store");
    res.json({
      mapped: true,
      isAdmin: false,
      user: { name: user.name, homeNetwork: home, performanceWorkerName },
      range: { type: range, dates: rangeDates.map((d) => ymd(d)) },
      performance: {
        recognized: rangeAgg.recognized,
        self: rangeAgg.self,
        support: { SK: rangeAgg.supportSK, KT: rangeAgg.supportKT, LG: rangeAgg.supportLG, TOSS: rangeAgg.supportTOSS, total: rangeAgg.supportTotal },
        homeNetworkOfficialTotal: rangeAgg.officialTotal || null,
        contributionRate: rangeAgg.contributionRate,
        teamAverage,
      },
      month: {
        recognized: monthAgg.recognized,
        homeNetworkOfficialTotal: monthAgg.officialTotal || null,
        contributionRate: monthContributionRate,
      },
      target:
        targetContributionRate !== null
          ? { year, month, targetContributionRate, achievementRate, diffPoints }
          : { year, month, targetContributionRate: null, message: "이번 달 목표 미설정" },
      trend,
      recent: recent.slice(0, 10),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
