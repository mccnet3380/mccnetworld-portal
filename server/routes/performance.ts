// server/routes/performance.ts
//
// 작업명: MCC_PERFORMANCE_SITE_INTEGRATION_1
//
// 실적(모바일/기타업무/유선/담당자별/마감공지) 조회 전용 라우터.
// server/routes.ts(기존 검증된 대형 라우터)는 건드리지 않고
// server/routes/performance-admin.ts와 같은 방식으로 독립 라우터로 분리해서 마운트한다.
//
// 계산 로직은 여기서 새로 작성하지 않는다 — computePerformanceDataset()(이미 검증 완료)를
// 그대로 호출만 한다. 이 라우터의 역할은 오직: 권한 확인 → date validation →
// computePerformanceDataset() → response.
//
// private key/서비스 계정 비밀정보는 절대 응답에 포함하지 않는다.

import { Router } from "express";
import { getStorage } from "../storage";
import { computePerformanceDataset } from "../lib/performance-dataset";

const router = Router();

/** 로그인만 되어 있으면 통과(관리자/근무자/영업과장) — 판매점(dealer) 세션은 회사 내부 실적이라 제외 */
async function requireInternalSession(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  // [MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1] 이번 작업(backend API 권한 조사)
  // 중 발견: 판매점(dealer) 로그인도 세션에는 항상 userType:'user'로 기록된다(auth-routes.ts
  // 확인 완료, dealer-login도 createSession(id, userResult.userType || 'user') 호출 —
  // 'dealer'라는 literal userType은 세션에 절대 저장되지 않는다). 그래서 이 아래 있던
  // `session.userType === "dealer"` 체크는 실제로는 한 번도 매칭되지 않는 죽은 코드였고,
  // 판매점이 직접 이 API를 호출하면 기존에는 통과되고 있었다(프론트는 dealer 라우트 분기로
  // 화면 자체를 막고 있어서 눈에 보이는 회귀는 없었지만 API 레벨 방어는 없었다). LG/KT/개인
  // 실적과 동일하게 dealerId/dealerRegistrationId 재조회 기준으로 판정하도록 고친다.
  if (session.userType === "user") {
    const sessionUser = await getStorage().getUserById(session.userId);
    if (sessionUser && (sessionUser.dealerId || sessionUser.dealerRegistrationId)) {
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }
  }
  req.session = session;
  next();
}

function parseDateParam(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 실적관리 / 전사 공지용 당일실적 / 마감보고·공지텍스트 3개 화면이 공유하는
 * 단일 데이터 source. 화면별로 다시 계산하지 않는다.
 */
router.get("/api/performance/dataset", requireInternalSession, async (req: any, res) => {
  let date: Date;
  if (req.query.date === undefined) {
    date = new Date();
  } else {
    const parsed = parseDateParam(req.query.date);
    if (!parsed) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
    date = parsed;
  }

  try {
    const dataset = await computePerformanceDataset(date);
    res.set("Cache-Control", "no-store");

    // [MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1] 실적관리(전체 근무자 실적)는
    // 관리자 전용으로 바뀌었지만, 이 API는 /performance/daily(전사 공지용 당일실적)와
    // /performance/closing(마감보고)도 그대로 공유한다 — 그 두 화면은 근무자가 실제 업무에
    // 쓰는 화면이라 API 전체를 admin-only로 막으면 회귀가 난다. 그 두 화면은
    // dataset.workers/mobile.workerMatrix/otherDuty.workerMatrix(근무자별 실적·기여도
    // 상세, ResultManagementBoard 전용)를 전혀 쓰지 않으므로, admin이 아닌 요청에서는
    // 이 3개 필드만 제거해서 내려준다 — 나머지(전사 집계/판매점별/인터넷 담당자별 표 등
    // 두 화면이 실제로 쓰는 데이터)는 그대로 유지한다.
    if (req.session.userType !== "admin") {
      const redacted = {
        ...dataset,
        mobile: { ...dataset.mobile, workerMatrix: [] },
        otherDuty: { ...dataset.otherDuty, workerMatrix: [] },
        workers: [],
      };
      return res.json(redacted);
    }

    res.json(dataset);
  } catch (err: any) {
    console.error("[performance] dataset 계산 실패:", err?.message ?? err);
    res.status(500).json({ error: "실적 데이터를 불러오지 못했습니다." });
  }
});

export default router;
