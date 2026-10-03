// server/routes/activation-audit.ts
//
// 작업명: MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1
//
// "개통현황 조회" 화면에 통합되는 자동검수 API. 기존 server/routes/sheet-viewer.ts(원본
// 시트 그대로 보기)는 무수정 — 이 라우터는 완전히 독립된 신규 엔드포인트만 추가한다.
// READ ONLY — 계산 결과를 DB에 저장하지 않는다(요청마다 계산, 캐시는 personal-performance.ts
// 의 공유 캐시 재사용).
//
// 권한(§6/§7/§8 확정):
// - /summary(전체 작업자 검수): admin 또는 (userType='user' AND !dealerId AND
//   !dealerRegistrationId AND role='middle_manager')만 허용. sales_manager는 이 신규
//   검수 권한 대상이 아니다(§7 — "MIDDLE_MANAGER를 sales_manager로 매핑하지 않는다").
//   Server-side에서 강제한다 — 사이드바 숨김만으로 끝내지 않는다(§8).
// - /me(본인 누락만): admin/sales_manager/dealer 제외, 내부 user만(WORKER·MIDDLE_MANAGER
//   공통 — 둘 다 "본인 개인실적"은 볼 수 있다, §6). 본인 performanceWorkerName 기준으로
//   서버에서 필터링한다(요청 파라미터로 다른 작업자를 지정할 수 없음).

import { Router } from "express";
import * as XLSX from "xlsx";
import { getStorage } from "../storage";
import { createLedgerCache } from "../lib/personal-performance";
import { computeActivationAudit, computeActivationAuditRange, AUDIT_SOURCE_SHEETS, type AuditedActivationRow, type AuditCode, type ActivationAuditOptions } from "../lib/activation-audit";
import { invalidateMemiCache } from "../lib/memi-client";

// [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] §10 — 상단
// 자동검수 원본 선택 UI 전용 파라미터 파싱. 생략하면 undefined를 반환해 기존 날짜 기준
// 자동 선택 동작을 그대로 유지한다(§7/§11 — "기존 정상 결과가 이유 없이 변하면 안 된다").
function parseSourceOverride(v: unknown): ActivationAuditOptions["sourceOverride"] | undefined {
  if (v === AUDIT_SOURCE_SHEETS.today || v === AUDIT_SOURCE_SHEETS.historical) return v;
  return undefined;
}

const router = Router();

function parseDateParam(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] §26 실측(DEV, 아래 성능 측정 결과 기준
// 확정) — 무제한으로 열어두지 않고 합리적인 상한을 둔다. 초과 시 400으로 명확히 안내한다
// (요청을 억지로 잘라서 실행하지 않음, §2와 동일한 원칙).
const MAX_RANGE_DAYS = 31;

function daysBetweenInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((e - s) / msPerDay) + 1;
}

/**
 * §1/§2 — startDate/endDate 우선, 없으면 기존 date(하위호환, 이전 화면/북마크 대비)를
 * 단일 날짜 범위(start=end)로 해석, 아무 것도 없으면 오늘 하루. 시작일>종료일이면
 * 요청을 실행하지 않고 명확한 오류를 반환한다(§2).
 */
function resolveDateRange(query: any): { start: Date; end: Date } | { error: string } {
  const startRaw = query.startDate ?? query.date;
  const endRaw = query.endDate ?? query.date;

  const start = startRaw === undefined ? new Date() : parseDateParam(startRaw);
  const end = endRaw === undefined ? new Date() : parseDateParam(endRaw);

  if (!start || !end) {
    return { error: "startDate/endDate(또는 date)는 YYYY-MM-DD 형식이어야 합니다." };
  }
  if (start.getTime() > end.getTime()) {
    return { error: "시작일이 종료일보다 늦을 수 없습니다." };
  }
  if (daysBetweenInclusive(start, end) > MAX_RANGE_DAYS) {
    return { error: `조회 기간은 최대 ${MAX_RANGE_DAYS}일까지 가능합니다.` };
  }
  return { start, end };
}

async function requireActivationAuditAccess(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType === "admin") {
    req.session = session;
    return next();
  }
  if (session.userType === "user") {
    const user = await getStorage().getUserById(session.userId);
    if (user && !user.dealerId && !user.dealerRegistrationId && user.role === "middle_manager") {
      req.session = session;
      return next();
    }
  }
  return res.status(403).json({ error: "접근 권한이 없습니다." });
}

async function requireOwnActivationAuditAccess(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }
  if (session.userType !== "user") {
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }
  const user = await getStorage().getUserById(session.userId);
  if (!user || user.dealerId || user.dealerRegistrationId) {
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }
  req.session = session;
  next();
}

/**
 * 전체 작업자 검수(관리자/중간관리자 전용) — admin/sales_manager/dealer/worker 접근
 * 불가(worker=일반 user). [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] startDate/
 * endDate(기간, 양끝 포함, §1/§2)를 우선 사용하고 기존 date는 하위호환으로 계속
 * 지원한다(start=end로 해석 — 기존처럼 오늘 하루만 조회하는 방식도 그대로 동작).
 */
router.get("/api/activation-audit/summary", requireActivationAuditAccess, async (req, res) => {
  const range = resolveDateRange(req.query);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const sourceOverride = parseSourceOverride(req.query.source);

  try {
    const cache = createLedgerCache();
    const result = await computeActivationAuditRange(range.start, range.end, cache, { sourceOverride });
    res.set("Cache-Control", "no-store");
    res.json(result);
  } catch (err: any) {
    console.error("[activation-audit] summary 계산 실패:", err?.message ?? err);
    res.status(500).json({ error: "개통현황 검수 데이터를 불러오지 못했습니다." });
  }
});

// [MCC_ACTIVATION_AUDIT_DATE_RANGE_EXCEL_EXPORT_1] §15~§23 — 상단 "개통 후 자동검수"
// 결과 전용 Excel 다운로드. 아래쪽 기존 SheetViewer 원본 다운로드와는 완전히 다른
// 엔드포인트다(§15, §27 — 원본 SheetViewer는 무수정).

const STATUS_KOREAN: Record<AuditedActivationRow["status"], string> = {
  PASS: "정상",
  ERROR: "오류·누락",
  DATA_UNAVAILABLE: "확인필요",
};

const MEMI_STATUS_KOREAN: Record<NonNullable<AuditedActivationRow["memiStatus"]>, string> = {
  MATCHED: "매미 일치",
  NOT_FOUND: "매미 미일치",
  DATA_UNAVAILABLE: "매미 조회불가",
};

type StatusFilterParam = "all" | "problem" | "pass" | "unavailable";

/** §9/§16 — 화면 필터와 동일한 조건식(SheetViewer.tsx의 filteredAuditRows와 1:1 대응, §17 정합성 보장) */
function applyAuditFilters(
  rows: AuditedActivationRow[],
  opts: { status: StatusFilterParam; code: AuditCode | null; worker: string | null },
): AuditedActivationRow[] {
  return rows.filter((r) => {
    if (opts.worker && r.worker !== opts.worker) return false;
    if (opts.code && !r.issues.some((i) => i.code === opts.code)) return false;
    if (opts.status === "problem" && r.status === "PASS") return false;
    if (opts.status === "pass" && r.status !== "PASS") return false;
    if (opts.status === "unavailable" && r.status !== "DATA_UNAVAILABLE") return false;
    return true;
  });
}

/** §22 — 파일시스템에 안전한 문자열로 정규화(경로 구분자/제어문자 등 제거) */
function sanitizeForFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "").trim();
}

function buildExportFilename(startYmd: string, endYmd: string, status: StatusFilterParam, worker: string | null): string {
  const datePart = startYmd === endYmd ? startYmd : `${startYmd}_${endYmd}`;
  const statusPart = status === "problem" ? "오류누락" : status === "pass" ? "정상" : status === "unavailable" ? "확인필요" : "전체";
  const workerPart = worker ? `_${sanitizeForFilename(worker)}` : "";
  return `MCC_개통후자동검수_${datePart}_${statusPart}${workerPart}.xlsx`;
}

/**
 * 상단 "개통 후 자동검수 결과" 전용 XLSX 다운로드(관리자/중간관리자 전용, §24 — 서버에서도
 * 반드시 권한 검증, 프론트 버튼 숨김에만 의존하지 않는다). 화면 DOM을 긁지 않고 서버가
 * 계산한 Audit Result를 그대로 사용한다(§17 — 화면/Excel 결과 동일 보장).
 */
router.get("/api/activation-audit/export", requireActivationAuditAccess, async (req, res) => {
  const range = resolveDateRange(req.query);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const sourceOverride = parseSourceOverride(req.query.source);

  const statusParam = (typeof req.query.status === "string" ? req.query.status : "all") as StatusFilterParam;
  if (!["all", "problem", "pass", "unavailable"].includes(statusParam)) {
    return res.status(400).json({ error: "status는 all/problem/pass/unavailable 중 하나여야 합니다." });
  }
  const codeParam = typeof req.query.code === "string" && req.query.code ? (req.query.code as AuditCode) : null;
  const workerParam = typeof req.query.worker === "string" && req.query.worker && req.query.worker !== "ALL" ? req.query.worker : null;

  try {
    const cache = createLedgerCache();
    const result = await computeActivationAuditRange(range.start, range.end, cache, { sourceOverride });
    const filtered = applyAuditFilters(result.rows, { status: statusParam, code: codeParam, worker: workerParam });

    // §23 — 0건이면 빈 XLSX를 내려보내지 않는다.
    if (filtered.length === 0) {
      return res.status(400).json({ error: "다운로드할 검수 데이터가 없습니다." });
    }

    // §19/§20/§21 — 컬럼 순서 고정, 다중 오류 전체 출력(" / " 구분), 한글 상태명.
    const sheetRows = filtered.map((r) => ({
      "검수일": r.auditDate,
      "작업자": r.worker,
      "개통일": r.activationDate,
      "요청점": r.requestPoint,
      "고객명": r.customerName,
      "개통번호": r.activationNumber,
      "코드": r.code,
      "접점코드": r.contactCode,
      "요금제": r.planName,
      "가입번호": r.subscriptionNumber,
      "외국인등급": r.foreignerGrade,
      "모델명": r.model,
      "일련번호": r.serial,
      "검수상태": STATUS_KOREAN[r.status],
      "오류사유": r.issues.length > 0 ? r.issues.map((i) => i.label).join(" / ") : "",
      "매미대사상태": r.memiStatus ? MEMI_STATUS_KOREAN[r.memiStatus] : "",
      "매미모델명": r.memiModel ?? "",
      "매미일련번호": r.memiSerial ?? "",
    }));

    const ws = XLSX.utils.json_to_sheet(sheetRows, {
      header: ["검수일", "작업자", "개통일", "요청점", "고객명", "개통번호", "코드", "접점코드", "요금제", "가입번호", "외국인등급", "모델명", "일련번호", "검수상태", "오류사유", "매미대사상태", "매미모델명", "매미일련번호"],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "개통후자동검수");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const filename = buildExportFilename(result.startDate, result.endDate, statusParam, workerParam);
    const encoded = encodeURIComponent(filename);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    // RFC 6266 — filename(ASCII 폴백)과 filename*(UTF-8 실제 이름)을 함께 준다. 한글은
    // ASCII가 아니므로 폴백은 고정 영문명을 쓰고, 실제 파일명은 filename*로 전달한다
    // (최신 브라우저는 filename*을 우선 사용 — 기존 접점코드 업로드 양식 라우트와 동일 패턴).
    res.setHeader("Content-Disposition", `attachment; filename="mcc_activation_audit.xlsx"; filename*=UTF-8''${encoded}`);
    res.set("Cache-Control", "no-store");
    res.send(buffer);
  } catch (err: any) {
    console.error("[activation-audit] export 실패:", err?.message ?? err);
    res.status(500).json({ error: "검수 결과 Excel 생성에 실패했습니다." });
  }
});

/** 본인 업무 누락 검수(WORKER/MIDDLE_MANAGER 공통, 본인 performanceWorkerName 기준만) */
router.get("/api/activation-audit/me", requireOwnActivationAuditAccess, async (req: any, res) => {
  const date = req.query.date === undefined ? new Date() : parseDateParam(req.query.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });

  try {
    const user = await getStorage().getUserById(req.session.userId);
    const performanceWorkerName = user?.performanceWorkerName || null;
    if (!performanceWorkerName) {
      return res.json({
        mapped: false,
        message: "실적 작업자가 아직 연결되지 않았습니다. 관리자에게 실적 작업자 연결을 요청해 주세요.",
      });
    }

    const cache = createLedgerCache();
    const result = await computeActivationAudit(date, cache);
    const myRows = result.rows.filter((r) => r.worker === performanceWorkerName);
    const byCode: Record<string, number> = {};
    let error = 0;
    let dataUnavailable = 0;
    for (const r of myRows) {
      if (r.status === "ERROR") error++;
      else if (r.status === "DATA_UNAVAILABLE") dataUnavailable++;
      for (const iss of r.issues) byCode[iss.code] = (byCode[iss.code] ?? 0) + 1;
    }

    res.set("Cache-Control", "no-store");
    res.json({
      mapped: true,
      date: result.date,
      sourceSheet: result.sourceSheet,
      total: myRows.length,
      summary: { error, dataUnavailable, pass: myRows.length - error - dataUnavailable },
      byCode,
      rows: myRows,
      memiSync: result.memiSync,
    });
  } catch (err: any) {
    console.error("[activation-audit] me 계산 실패:", err?.message ?? err);
    res.status(500).json({ error: "본인 업무 누락 검수 데이터를 불러오지 못했습니다." });
  }
});

/**
 * [MCC_MEMI_REALTIME_DEVICE_RECONCILIATION_DEV_1] 관리자/중간관리자용 수동 [매미 새로고침] 보조
 * 기능(§14) — 기본 업무 흐름은 자동(요청 시 cache 없으면 자동 fetch)이며, 이 엔드포인트는
 * cache가 stale하다고 판단될 때 강제로 다시 받아오는 보조 수단일 뿐이다. /summary와 동일한
 * 권한(admin/내부 middle_manager)만 허용 — 일반 WORKER는 호출할 수 없다.
 *
 * [MCC_GOOGLE_SHEETS_SHARED_CACHE_AND_POST_ACTIVATION_AUDIT_SOURCE_CONTROL_1] PHASE 2 —
 * 기존에는 이 버튼이 매미(단말 대사) 캐시만 무효화하고 Google Sheets 원본은 여전히 캐시된
 * 값을 그대로 썼다(실측 확인 — 사용자가 Google Sheet에서 가입번호를 지워도 반영되지
 * 않던 원인). 이제 body.source(현재 화면에서 선택된 자동검수 원본, 생략 시 기존과 동일한
 * 날짜 기준 자동 선택)에 해당하는 "그 시트 하나만" forceRefresh로 강제로 다시 읍는다 —
 * 전체 Spreadsheet나 다른 시트는 건드리지 않는다(§12 — 불필요한 재조회 금지).
 */
router.post("/api/activation-audit/memi-refresh", requireActivationAuditAccess, async (req, res) => {
  const date = req.body?.date === undefined ? new Date() : parseDateParam(req.body.date);
  if (!date) return res.status(400).json({ error: "date는 YYYY-MM-DD 형식이어야 합니다." });
  const dateYmd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const sourceOverride = parseSourceOverride(req.body?.source);
  invalidateMemiCache(dateYmd);
  try {
    const cache = createLedgerCache();
    const result = await computeActivationAudit(date, cache, { sourceOverride, forceRefresh: true });
    res.json({ memiSync: result.memiSync, sourceSheet: result.sourceSheet, total: result.total, summary: result.summary });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? String(err) });
  }
});

export default router;
