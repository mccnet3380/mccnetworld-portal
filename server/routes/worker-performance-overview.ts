// server/routes/worker-performance-overview.ts
//
// 작업명: MCC_ADMIN_WORKER_PERFORMANCE_OVERVIEW_1
//
// 관리자 전용 "근무자 실적" 요약 화면의 데이터 API. 새 계산 공식을 만들지 않는다 —
// server/lib/personal-performance.ts의 LOCK된 범위 집계 함수(computeActivationPerformanceForDates/
// computeChangeWorkForDates/aggregateForWorker/aggregateChangeForWorker)를 그대로 재사용하고,
// 이미 기간 전체를 1회 fetch한 데이터셋(모든 근무자가 이미 들어있음) 위에서 "근무자별로
// 한 번씩 순수 함수만 다시 돌려서 집계"한다 — Google Sheets 호출은 기간(오늘/주/달)당
// 활성화 1회 + 변경 1회뿐이고(이미 personal-performance.ts의 60초 공유 캐시로 보호됨),
// 근무자 수만큼 늘어나는 N+1 구조가 아니다(§7 원칙).
//
// worker 식별은 Google Sheets 원장의 "작업자" 문자열 그대로 사용한다(추정/정규화 없음) —
// discoverWorkerNamesForDates()와 동일한 원칙. users 테이블을 조회하지 않으므로 password/
// hash 등 민감 정보가 응답에 섞일 가능성 자체가 없다.

import { Router } from "express";
import { getStorage } from "../storage";
import { workerHomeNetwork } from "../lib/performance-classify";
import {
  createLedgerCache,
  resolveRangeDates,
  computeActivationPerformanceForDates,
  computeChangeWorkForDates,
  aggregateForWorker,
  aggregateChangeForWorker,
  ymd,
} from "../lib/personal-performance";

const router = Router();

type Range = "today" | "week" | "month";

// [MCC_ADMIN_WORKER_PERFORMANCE_OVERVIEW_1] 이 화면은 §2 요구사항에 따라 ADMIN 전용이다.
// 기존 requireAdmin과 동등한 독립 미들웨어(다른 performance-*.ts 라우터들과 동일한 패턴)로,
// 메뉴 숨김만으로 끝내지 않고 route 자체를 서버에서 admin만 허용한다.
async function requireAdminSession(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType !== "admin") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  req.session = session;
  next();
}

function parseRange(v: unknown): Range | null {
  if (v === "today" || v === "week" || v === "month") return v;
  return null;
}

router.get("/api/admin/worker-performance-overview", requireAdminSession, async (req: any, res) => {
  const range = parseRange(req.query.range) ?? "today";
  const today = new Date();

  try {
    const cache = createLedgerCache();
    const rangeDates = resolveRangeDates(range, today);

    // 기간 데이터를 "한 번만" fetch — 이 두 호출 각각 내부에서 날짜별로 캐시를 공유하므로
    // 근무자 수와 무관하게 항상 같은 횟수만 Google Sheets를 읽는다.
    const activationPerDay = await computeActivationPerformanceForDates(rangeDates, today, cache);
    const changePerDay = await computeChangeWorkForDates(rangeDates, cache);

    // 기간 내 실제로 등장한 근무자 이름의 합집합(원문 그대로, 추정/정규화 없음).
    const names = new Set<string>();
    for (const day of activationPerDay) for (const w of day.workers) names.add(w.worker);
    for (const day of changePerDay) for (const w of day.workers) names.add(w.worker);

    const workers = Array.from(names)
      .map((name) => {
        const home = workerHomeNetwork(name);
        // 순수 함수 — 이미 메모리에 있는 perDay 배열만 사용, 추가 Sheets 호출 없음.
        const activation = aggregateForWorker(activationPerDay, name, home);
        const change = aggregateChangeForWorker(changePerDay, name, home);
        return {
          worker: name,
          homeNetwork: home,
          activation: {
            recognized: activation.recognized,
            self: activation.self,
            supportTotal: activation.supportTotal,
            contributionRate: activation.contributionRate,
          },
          change: {
            total: change.total,
            self: change.self,
            supportTotal: change.supportTotal,
            contributionRate: change.contributionRate,
          },
          // [MCC_ADMIN_WORKER_PERFORMANCE_OVERVIEW_1] "지원 처리" 단일 컬럼 = 개통
          // 지원처리(activation.supportTotal) + 변경 지원처리(change.supportTotal). 새 공식이
          // 아니라 개인 실적 화면이 이미 노출하는 두 숫자를 더한 값이다.
          supportTotal: activation.supportTotal + change.supportTotal,
        };
      })
      // 기본 정렬: 개통 처리(recognized) 많은 순 — summarizeWorkerNetworkMatrix()의 기존
      // 합계 내림차순 정렬 관례와 동일한 기준.
      .sort((a, b) => b.activation.recognized - a.activation.recognized);

    const summary = workers.reduce(
      (acc, w) => {
        acc.activationTotal += w.activation.recognized;
        acc.changeTotal += w.change.total;
        acc.supportTotal += w.supportTotal;
        return acc;
      },
      { activationTotal: 0, changeTotal: 0, supportTotal: 0 },
    );

    res.set("Cache-Control", "no-store");
    res.json({
      range: { type: range, dates: rangeDates.map((d) => ymd(d)) },
      summary: {
        activationTotal: summary.activationTotal,
        changeTotal: summary.changeTotal,
        supportTotal: summary.supportTotal,
        workerCount: workers.length,
      },
      workers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
