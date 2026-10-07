// server/routes/typing-versions.ts
//
// 작업명: MCC_TYPING_VERSION_MANAGER_CURRENT_PREVIOUS_DRAFT_INTEGRATION_1
//
// 기존 타이핑 사이트(별도 프로젝트: MCCNETWORLD/public, 11개 통신사/채널 brands/*)를
// 새로 만들지 않고 그대로 재사용하면서, CURRENT/PREVIOUS/DRAFT 3-상태 버전관리를
// 추가한다. server/routes/training.ts와 같은 방식으로 독립 라우터로 분리해서
// server/index.ts에서 마운트한다.
//
// 버전 저장소는 "타이핑 원본 프로젝트"의 형제 폴더(versions/)에 디렉터리 복사본으로
// 둔다(symlink는 Windows 권한 문제로 배제). 경로는 절대 하드코딩하지 않고
// TYPING_VERSIONS_ROOT / TYPING_SOURCE_ROOT 환경변수로 override 가능하며, 생략 시
// 이 Portal 프로젝트의 cwd(= server/ 상위, package.json 위치)를 기준으로 상대 경로를
// 계산한다 — 개발 PC의 실제 폴더 배치(…\업무\MCCNETWORLDPORTAL\MCCNETWORLD 와
// …\업무\MCCNETWORLD\public)와 일치하지만, 운영 배포 시에는 반드시 환경변수로
// 재지정해야 한다(README/보고서 참고).
//
// 권한: TRAINING_READ/MANAGE와 완전히 동일한 구조(server/routes/training.ts)를 그대로
// 재사용한다 — TYPING_READ/TYPING_MANAGE effective RBAC permission(role 또는 explicit
// override)만 본다. MCC_RBAC_PHASE_2F_TYPING_TRAINING_LEGACY_REMOVAL_1에서 legacy
// fallback(admin/sales_manager/내부worker 자동 허용, dealer 차단) 제거.

import express, { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { getStorage } from "../storage";
import { getPrincipalPermissions } from "../lib/rbac";
import { resolveSessionPrincipal } from "../lib/session-rbac";

const router = Router();

// ─────────────────────────────
// 경로 설정
// ─────────────────────────────
const VERSIONS_ROOT = process.env.TYPING_VERSIONS_ROOT
  ? path.resolve(process.env.TYPING_VERSIONS_ROOT)
  : path.resolve(process.cwd(), "..", "..", "MCCNETWORLD", "versions");

const TYPING_SOURCE_PUBLIC = process.env.TYPING_SOURCE_ROOT
  ? path.resolve(process.env.TYPING_SOURCE_ROOT)
  : path.resolve(VERSIONS_ROOT, "..", "public");

type VersionName = "current" | "previous" | "draft";
const VERSION_NAMES: VersionName[] = ["current", "previous", "draft"];

function versionDir(version: string) {
  return path.join(VERSIONS_ROOT, version);
}

// ─────────────────────────────
// 채널 화이트리스트(경로 traversal 방지 + GET /api/typing-versions 응답용)
// public/index.html의 BRAND_ROUTE / CARD_META에서 그대로 가져온 한글명이다.
// prepaid는 overlay-design/plans.json/?mode=design 자체가 없는 단순 정적 페이지라
// 개발도구 대상 채널 목록에서는 제외한다(실제 폴더 구조 실측 결과).
// ─────────────────────────────
const CHANNELS = [
  { carrier: "uplus", brand: "umobile", name: "미디어로그" },
  { carrier: "uplus", brand: "hello", name: "헬로LG" },
  { carrier: "uplus", brand: "freeT", name: "프리티LG" },
  { carrier: "uplus", brand: "device", name: "미디어로그 단말" },
  { carrier: "kt", brand: "mmobile", name: "엠모바일" },
  { carrier: "kt", brand: "skylife", name: "스카이라이프" },
  { carrier: "kt", brand: "stagefive", name: "스테이지파이브(KT)" },
  { carrier: "kt", brand: "device", name: "엠모바일 단말" },
  { carrier: "sk", brand: "7mobile", name: "SK텔링크" },
  { carrier: "sk", brand: "freeT-sk", name: "프리티SK" },
  { carrier: "sk", brand: "stagefive-sk", name: "스테이지파이브(SK)" },
] as const;

function findChannel(carrier: string, brand: string) {
  return CHANNELS.find((c) => c.carrier === carrier && c.brand === brand);
}

// ─────────────────────────────
// 권한 미들웨어 — MCC_RBAC_PHASE_2F_TYPING_TRAINING_LEGACY_REMOVAL_1
//
// Legacy fallback removed after explicit permission coverage rollout
// (MCC_RBAC_PHASE_2F_TYPING_TRAINING_EXPLICIT_COVERAGE_1 — 운영의 모든 non-dealer
// internal USER/ADMIN이 TYPING_READ/TYPING_MANAGE를 role 또는 explicit override로
// 이미 보유). 우선순위:
//   1. 해당 permission에 대한 explicit DENY override가 있으면 → DENY
//      (getPrincipalPermissions()가 role 합집합 ∪ ALLOW override에서 DENY를 이미
//      제외하고 반환하므로, 여기서 DENY를 다시 확인할 필요가 없다 — 포함 안 되면 DENY)
//   2. effective permission(role 합집합 ∪ ALLOW override)에 포함되면 → ALLOW
//   3. 그 외 → DENY (예전의 "legacy 조건 충족 → ALLOW" 3단계는 더 이상 없음)
// RBAC 조회 자체가 실패하면(DB 에러) 여전히 503으로 fail-closed 처리한다(server/lib/
// rbac-guard.ts의 requirePermission()과 동일한 정책 — legacy 제거와 무관하게 유지).
// ─────────────────────────────

// export: scripts/typing-permission-selftest.ts가 동일한 판정 로직을 직접 호출해
// self-test한다(두 번째 "정답"을 만들지 않기 위해 테스트가 이 함수를 그대로 재사용).
export type TypingPermissionCode = "TYPING_READ" | "TYPING_MANAGE";
export type TypingPermissionResult = "ALLOW" | "DENY" | "FAIL_CLOSED";

export async function resolveTypingPermission(
  session: any,
  permissionCode: TypingPermissionCode,
): Promise<TypingPermissionResult> {
  const principal = resolveSessionPrincipal(session.userType, session.userId);
  if (!principal) return "DENY";

  try {
    const permissions = await getPrincipalPermissions(principal.principalType, principal.principalId);
    return permissions.includes(permissionCode) ? "ALLOW" : "DENY";
  } catch (error) {
    console.error("TYPING_RBAC_PERMISSION_CHECK_FAILED", {
      permissionCode,
      principalType: principal.principalType,
      principalId: principal.principalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "FAIL_CLOSED";
  }
}

async function requireTypingViewer(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }

  const result = await resolveTypingPermission(session, "TYPING_READ");
  if (result === "FAIL_CLOSED") {
    return res.status(503).json({ error: "권한 확인 중 오류가 발생했습니다." });
  }
  if (result === "DENY") {
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }

  req.session = session;
  req.sessionToken = sessionId;
  // isTypingAdmin: GET 응답의 isAdmin 힌트용(§ 결과표시). legacy 제거 이후 "admin이면
  // true"가 아니라 실제 TYPING_MANAGE effective permission을 그대로 재사용한다 — 두 번째
  // "정답"을 만들지 않는다. 조회 실패 시에도 fail-closed(false)로 떨어진다.
  const manageCheck = await resolveTypingPermission(session, "TYPING_MANAGE");
  req.isTypingAdmin = manageCheck === "ALLOW";
  next();
}

async function requireTypingAdmin(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    // 기존 requireTypingAdmin과 동일하게 session-invalid도 403으로 유지한다(회귀 방지 —
    // requireTypingViewer는 원래부터 이 경우 401이었으므로 그대로 둔다).
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }

  const result = await resolveTypingPermission(session, "TYPING_MANAGE");
  if (result === "FAIL_CLOSED") {
    return res.status(503).json({ error: "권한 확인 중 오류가 발생했습니다." });
  }
  if (result === "DENY") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }

  req.session = session;
  req.isTypingAdmin = true;
  next();
}

// ─────────────────────────────
// 네비게이션(새 탭 이동) 전용 인증 — MCC_TYPING_VERSION_POC_EXACT_BEHAVIOR_AUDIT_1
//
// 문제: /typing-static/* 로의 "타이핑 열기"/"개발도구 열기"는 일반 브라우저 네비게이션
// (window.open)이라서 Authorization 헤더를 붙일 수 없다. Portal에는 애초에 재사용할
// HttpOnly 세션 쿠키가 없다(순수 localStorage + Bearer 헤더 모델 — 확인됨).
//
// 해법: 새로운 비밀을 만들지 않는다. 클라이언트가 이미 들고 있는 "같은" 서명된
// 세션 토큰(getStorage().getSession()으로 검증하는 그 값)을, 인증된 API 호출
// (Authorization 헤더 포함)로만 호출 가능한 이 엔드포인트가 HttpOnly + Path 한정
// 쿠키로 다시 심어준다. 그러면 그 다음 window.open() 네비게이션에는 브라우저가
// 자동으로 그 쿠키만 실어 보낸다 — URL 쿼리스트링에는 아무 것도 노출되지 않고,
// history/referrer/서버 접근로그 URL 필드에도 남지 않는다.
//
// 범위를 최대한 좁힌다:
//  - Path=/typing-static 만 (다른 어떤 요청에도 이 쿠키가 실리지 않음)
//  - HttpOnly (페이지의 어떤 JS도 읽을 수 없음 — bridge script 포함)
//  - 유효기간은 실제 로그인 세션의 남은 시간과 4시간 중 더 짧은 쪽("단기")
//  - 쿠키 값 자체가 곧 실제 세션 토큰이므로, 로그아웃/세션 만료 시 이 쿠키도
//    getStorage().getSession()에서 즉시 무효화된다 — 별도 폐기 로직 불필요.
// ─────────────────────────────
const NAV_COOKIE_NAME = "typing_nav";
const NAV_COOKIE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4시간 상한

router.post("/api/typing-versions/nav-session", requireTypingViewer, (req: any, res) => {
  const remainingMs = req.session?.expiresAt ? new Date(req.session.expiresAt).getTime() - Date.now() : 0;
  if (remainingMs <= 0) {
    return res.status(401).json({ error: "세션이 만료되었습니다." });
  }
  const maxAge = Math.min(remainingMs, NAV_COOKIE_MAX_AGE_MS);
  res.cookie(NAV_COOKIE_NAME, req.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/typing-static",
    maxAge,
  });
  res.json({ ok: true });
});

// ─────────────────────────────
// 공용 유틸
// ─────────────────────────────
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function copyDirExcludeGit(src: string, dest: string) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirExcludeGit(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

type Manifest = {
  current: { label: string; note: string; createdAt: string } | null;
  previous: { label: string; note: string; createdAt: string } | null;
  draft: { label: string; note: string; createdAt: string } | null;
};

function manifestPath() {
  return path.join(VERSIONS_ROOT, "manifest.json");
}

async function readManifest(): Promise<Manifest> {
  const raw = await fs.promises.readFile(manifestPath(), "utf-8");
  return JSON.parse(raw);
}

async function writeManifestAtomic(manifest: Manifest) {
  const p = manifestPath();
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.writeFile(tmp, JSON.stringify(manifest, null, 2), "utf-8");
  await fs.promises.rename(tmp, p);
}

let bootstrapPromise: Promise<void> | null = null;

// 최초 1회: versions/ 가 없으면 타이핑 원본(public/)을 CURRENT로 복사한다.
// public/ 원본 자체는 절대 수정하지 않는다.
async function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await fs.promises.mkdir(VERSIONS_ROOT, { recursive: true });
      if (fs.existsSync(manifestPath())) return;

      const currentDir = versionDir("current");
      if (!fs.existsSync(currentDir)) {
        if (!fs.existsSync(TYPING_SOURCE_PUBLIC)) {
          throw new HttpError(
            500,
            `타이핑 원본을 찾을 수 없습니다: ${TYPING_SOURCE_PUBLIC} (TYPING_SOURCE_ROOT 환경변수를 확인하세요)`
          );
        }
        await copyDirExcludeGit(TYPING_SOURCE_PUBLIC, currentDir);
      }

      const manifest: Manifest = {
        current: { label: "current", note: "초기 버전(부트스트랩)", createdAt: new Date().toISOString() },
        previous: null,
        draft: null,
      };
      await writeManifestAtomic(manifest);
    })().catch((err) => {
      bootstrapPromise = null; // 실패 시 다음 요청에서 재시도
      throw err;
    });
  }
  return bootstrapPromise;
}

// 사용자에게 보여주는 버전명 규칙(섹션9): YYYY-MM. 내부 상태명(current/previous/draft)과
// 사용자용 버전명(manifest.*.label)은 분리되어 있다 — 폴더명은 절대 바뀌지 않고,
// label만 사람이 읽는 값으로 관리한다.
const VERSION_LABEL_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertValidLabel(label: string) {
  if (!VERSION_LABEL_RE.test(label)) {
    throw new HttpError(400, "버전명은 YYYY-MM 형식이어야 합니다. 예: 2026-11");
  }
}

async function createDraft(label: string, note: string): Promise<Manifest> {
  await ensureBootstrap();
  const manifest = await readManifest();

  const trimmed = (label || "").trim();
  if (!trimmed) throw new HttpError(400, "버전명을 입력해주세요.");
  assertValidLabel(trimmed);
  if (manifest.draft) throw new HttpError(409, "이미 개발 중인 버전(DRAFT)이 있습니다.");
  if (manifest.current && manifest.current.label === trimmed) {
    throw new HttpError(409, "현재 운영 버전과 동일한 버전명입니다.");
  }
  if (manifest.previous && manifest.previous.label === trimmed) {
    throw new HttpError(409, "이전 버전과 동일한 버전명입니다.");
  }

  const currentDir = versionDir("current");
  const draftDir = versionDir("draft");
  if (fs.existsSync(draftDir)) throw new HttpError(409, "DRAFT 폴더가 이미 존재합니다.");
  if (!fs.existsSync(currentDir)) throw new HttpError(500, "CURRENT 버전을 찾을 수 없습니다.");

  await copyDirExcludeGit(currentDir, draftDir);

  manifest.draft = { label: trimmed, note: note || "", createdAt: new Date().toISOString() };
  await writeManifestAtomic(manifest);
  return manifest;
}

// 섹션7/8: 최초 부트스트랩 CURRENT는 실제 운영 버전명을 알 수 없어 내부 placeholder
// label("current")로 생성된다. 이 함수는 파일/폴더를 전혀 건드리지 않고 manifest의
// current.label/note만 사람이 보는 값으로 교체한다 — promote/rollback/DRAFT 로직과
// 완전히 분리된, 순수 메타데이터 수정이다.
async function setCurrentLabel(label: string, note: string | undefined): Promise<Manifest> {
  await ensureBootstrap();
  const manifest = await readManifest();
  if (!manifest.current) throw new HttpError(404, "CURRENT 버전이 없습니다.");

  const trimmed = (label || "").trim();
  assertValidLabel(trimmed);
  if (manifest.previous && manifest.previous.label === trimmed) {
    throw new HttpError(409, "이전 버전과 동일한 버전명입니다.");
  }
  if (manifest.draft && manifest.draft.label === trimmed) {
    throw new HttpError(409, "개발 중인 버전과 동일한 버전명입니다.");
  }

  manifest.current = {
    ...manifest.current,
    label: trimmed,
    note: note !== undefined ? note : manifest.current.note,
  };
  await writeManifestAtomic(manifest);
  return manifest;
}

async function discardDraft(): Promise<Manifest> {
  const manifest = await readManifest();
  if (!manifest.draft) throw new HttpError(404, "DRAFT가 없습니다.");

  const draftDir = versionDir("draft");
  const trashDir = path.join(VERSIONS_ROOT, `__trash_draft_${Date.now()}`);
  if (fs.existsSync(draftDir)) {
    await fs.promises.rename(draftDir, trashDir);
  }
  manifest.draft = null;
  await writeManifestAtomic(manifest);

  fs.promises.rm(trashDir, { recursive: true, force: true }).catch(() => {});
  return manifest;
}

// 운영 적용: DRAFT→CURRENT, CURRENT→PREVIOUS, 기존 PREVIOUS→삭제.
// CURRENT는 draft가 성공적으로 자리를 잡은 뒤에만 사라진다 — 중간에 실패하면
// 이미 끝난 rename들을 역순으로 되돌려 원상복구한다(CURRENT가 없는 상태가
// 절대 발생하지 않도록 함).
//
// TYPING_VERSIONS_FORCE_PROMOTE_FAIL 환경변수는 테스트 전용 fault-injection 훅이다
// (rollback 경로를 실제로 검증하기 위해 추가했다 — 운영에서는 설정하지 않는다).
async function promote(): Promise<Manifest> {
  const manifest = await readManifest();
  if (!manifest.draft) throw new HttpError(409, "DRAFT가 없어 운영 적용할 수 없습니다.");

  const draftDir = versionDir("draft");
  const currentDir = versionDir("current");
  const previousDir = versionDir("previous");

  const draftIndex = path.join(draftDir, "index.html");
  const draftBrands = path.join(draftDir, "brands");
  if (!fs.existsSync(draftIndex) || !fs.existsSync(draftBrands)) {
    throw new HttpError(422, "DRAFT 폴더에 필수 파일(index.html, brands/)이 없습니다. 운영 적용을 중단합니다.");
  }
  const brandEntries = await fs.promises.readdir(draftBrands);
  if (brandEntries.length === 0) {
    throw new HttpError(422, "DRAFT의 brands 폴더가 비어 있습니다. 운영 적용을 중단합니다.");
  }

  const trashPreviousDir = path.join(VERSIONS_ROOT, `__trash_previous_${Date.now()}`);
  const rollbackSteps: Array<() => Promise<void>> = [];

  try {
    if (fs.existsSync(previousDir)) {
      await fs.promises.rename(previousDir, trashPreviousDir);
      rollbackSteps.push(async () => {
        await fs.promises.rename(trashPreviousDir, previousDir);
      });
    }

    await fs.promises.rename(currentDir, previousDir);
    rollbackSteps.push(async () => {
      await fs.promises.rename(previousDir, currentDir);
    });

    if (process.env.TYPING_VERSIONS_FORCE_PROMOTE_FAIL === "1") {
      throw new Error("[테스트 전용] TYPING_VERSIONS_FORCE_PROMOTE_FAIL로 강제된 실패");
    }

    await fs.promises.rename(draftDir, currentDir);
    rollbackSteps.push(async () => {
      await fs.promises.rename(currentDir, draftDir);
    });

    const newManifest: Manifest = {
      current: manifest.draft,
      previous: manifest.current,
      draft: null,
    };
    await writeManifestAtomic(newManifest);

    if (fs.existsSync(trashPreviousDir)) {
      fs.promises.rm(trashPreviousDir, { recursive: true, force: true }).catch(() => {});
    }
    return newManifest;
  } catch (err) {
    for (const undo of rollbackSteps.reverse()) {
      try {
        await undo();
      } catch (undoErr) {
        console.error("[typing-versions] rollback 단계 실패 — 수동 확인이 필요합니다.", undoErr);
      }
    }
    console.error("[typing-versions] 운영 적용 실패, 롤백 완료:", err);
    // MCC_TYPING_VERSION_MANAGER_PROMOTE_FAILURE_ROOT_CAUSE_1: 진단 전용 — promote()의
    // 성공/실패 동작이나 rollback 로직은 전혀 바꾸지 않는다. 실제 운영 적용 실패의
    // 정확한 예외(err.code/syscall/path/stack)를 서버 콘솔뿐 아니라 파일로도 남겨서,
    // 다음 실패 시 추측 없이 원인을 확정할 수 있게 한다(사용자 터미널을 못 보는 환경에서
    // 조사하기 위함). 파일 쓰기 자체가 실패해도 기존 에러 처리에는 영향 없음(catch로 흡수).
    try {
      const anyErr = err as any;
      const detail = [
        `[${new Date().toISOString()}] promote 실패`,
        `message=${anyErr?.message}`,
        `code=${anyErr?.code}`,
        `syscall=${anyErr?.syscall}`,
        `path=${anyErr?.path}`,
        `dest=${anyErr?.dest}`,
        `stack=${anyErr?.stack}`,
        "",
      ].join("\n");
      fs.appendFileSync(path.join(VERSIONS_ROOT, ".promote-error.log"), detail);
    } catch {
      // 진단 로그 쓰기 실패는 무시 — 기존 오류 응답(HttpError 500)에는 영향 없음
    }
    throw new HttpError(500, "운영 적용 중 오류가 발생해 되돌렸습니다. 현재 운영 버전은 유지됩니다.");
  }
}

// ─────────────────────────────
// overlay JSON 파일명 규칙 (기존 채널 index.html이 쓰는 파일명과 동일)
// ─────────────────────────────
const OVERLAY_DOC_RE = /^(adult|teen|change|cancel|device\.adult|device\.teen)$/;
function overlayFileName(doc: string) {
  switch (doc) {
    case "change":
      return "overlay-design.change.json";
    case "cancel":
      return "overlay-design.cancel.json";
    case "device.adult":
      return "overlay-design.device.adult.json";
    case "device.teen":
      return "overlay-design.device.teen.json";
    case "teen":
      return "overlay-design.teen.json";
    default:
      return "overlay-design.adult.json";
  }
}

function resolveChannelDir(version: string, carrier: string, brand: string) {
  const ch = findChannel(carrier, brand);
  if (!ch) throw new HttpError(400, "알 수 없는 채널입니다.");
  return path.join(versionDir(version), "brands", carrier, brand);
}

function assertWritableVersion(version: string) {
  if (version === "current") throw new HttpError(403, "현재 운영 버전은 수정할 수 없습니다.");
  if (version !== "previous" && version !== "draft") {
    throw new HttpError(400, "알 수 없는 버전입니다.");
  }
}

// ─────────────────────────────
// 라우트: 버전 조회/생성/폐기/운영적용
// ─────────────────────────────
router.get("/api/typing-versions", requireTypingViewer, async (req: any, res) => {
  try {
    await ensureBootstrap();
    const manifest = await readManifest();
    res.json({ manifest, channels: CHANNELS, isAdmin: !!req.isTypingAdmin });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "버전 정보를 불러오지 못했습니다." });
  }
});

router.put("/api/typing-versions/current/label", requireTypingAdmin, express.json(), async (req, res) => {
  try {
    const { label, note } = req.body || {};
    const manifest = await setCurrentLabel(String(label || ""), note !== undefined ? String(note) : undefined);
    res.json({ ok: true, manifest });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "버전명 저장 중 오류가 발생했습니다." });
  }
});

router.post("/api/typing-versions/draft", requireTypingAdmin, express.json(), async (req, res) => {
  try {
    const { label, note } = req.body || {};
    const manifest = await createDraft(String(label || ""), String(note || ""));
    res.json({ ok: true, manifest });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "DRAFT 생성 중 오류가 발생했습니다." });
  }
});

router.delete("/api/typing-versions/draft", requireTypingAdmin, async (req, res) => {
  try {
    const manifest = await discardDraft();
    res.json({ ok: true, manifest });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "DRAFT 폐기 중 오류가 발생했습니다." });
  }
});

router.post("/api/typing-versions/promote", requireTypingAdmin, async (req, res) => {
  try {
    const manifest = await promote();
    res.json({ ok: true, manifest });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || "운영 적용 중 오류가 발생했습니다." });
  }
});

// ─────────────────────────────
// 라우트: overlay JSON / plans.json / 이미지 저장 (PREVIOUS·DRAFT만 허용)
// ─────────────────────────────
router.post(
  "/api/typing-versions/:version/overlay/:carrier/:brand/:doc",
  requireTypingAdmin,
  express.json({ limit: "5mb" }),
  async (req, res) => {
    try {
      const { version, carrier, brand, doc } = req.params;
      assertWritableVersion(version);
      if (!OVERLAY_DOC_RE.test(doc)) throw new HttpError(400, "알 수 없는 문서 종류입니다.");
      const dir = resolveChannelDir(version, carrier, brand);
      if (!fs.existsSync(dir)) throw new HttpError(404, "채널 폴더를 찾을 수 없습니다.");

      const fileName = overlayFileName(doc);
      await fs.promises.writeFile(path.join(dir, fileName), JSON.stringify(req.body, null, 2), "utf-8");
      res.json({ ok: true, path: `brands/${carrier}/${brand}/${fileName}` });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "설계 저장 중 오류가 발생했습니다." });
    }
  }
);

router.post(
  "/api/typing-versions/:version/plans/:carrier/:brand",
  requireTypingAdmin,
  express.json({ limit: "5mb" }),
  async (req, res) => {
    try {
      const { version, carrier, brand } = req.params;
      assertWritableVersion(version);
      const dir = resolveChannelDir(version, carrier, brand);
      if (!fs.existsSync(dir)) throw new HttpError(404, "채널 폴더를 찾을 수 없습니다.");

      await fs.promises.writeFile(path.join(dir, "plans.json"), JSON.stringify(req.body, null, 2), "utf-8");
      res.json({ ok: true, path: `brands/${carrier}/${brand}/plans.json` });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "요금표 저장 중 오류가 발생했습니다." });
    }
  }
);

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const IMAGE_DOC_RE = /^(adult|teen|change|cancel)$/;
const ALLOWED_IMAGE_EXT = [".jpg", ".jpeg", ".png"];

router.post(
  "/api/typing-versions/:version/images/:carrier/:brand",
  requireTypingAdmin,
  imageUpload.single("file"),
  async (req: any, res) => {
    try {
      const { version, carrier, brand } = req.params;
      assertWritableVersion(version);

      const doc = String(req.body.doc || "");
      const page = parseInt(req.body.page, 10);
      if (!IMAGE_DOC_RE.test(doc)) throw new HttpError(400, "알 수 없는 서류 종류입니다.");
      if (!Number.isInteger(page) || page < 1 || page > 30) {
        throw new HttpError(400, "페이지 번호가 올바르지 않습니다.");
      }
      if (!req.file) throw new HttpError(400, "업로드할 이미지 파일이 없습니다.");

      const ext = (path.extname(req.file.originalname || "") || ".jpg").toLowerCase();
      if (!ALLOWED_IMAGE_EXT.includes(ext)) throw new HttpError(400, "jpg/png 이미지만 업로드할 수 있습니다.");

      const dir = resolveChannelDir(version, carrier, brand);
      const imagesDir = path.join(dir, "images");
      if (!fs.existsSync(imagesDir)) throw new HttpError(404, "이미지 폴더를 찾을 수 없습니다.");

      // 기존 채널의 파일명 규칙(<doc>-<page>.<ext>, 예: adult-1.jpg)을 그대로 쓴다.
      // 같은 슬롯의 기존 파일(확장자가 다를 수 있음)을 먼저 지워 중복 파일이 남지 않게 한다.
      const existing = await fs.promises.readdir(imagesDir);
      const slotRe = new RegExp(`^${doc}-${page}\\.[a-zA-Z0-9]+$`, "i");
      for (const f of existing) {
        if (slotRe.test(f)) await fs.promises.unlink(path.join(imagesDir, f));
      }

      const filename = `${doc}-${page}${ext}`;
      await fs.promises.writeFile(path.join(imagesDir, filename), req.file.buffer);
      res.json({
        ok: true,
        filename,
        url: `/typing-static/${version}/brands/${carrier}/${brand}/images/${filename}`,
      });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message || "이미지 저장 중 오류가 발생했습니다." });
    }
  }
);

// ─────────────────────────────
// 정적 서빙: /typing-static/:version/* (기존 타이핑 사이트 자체를 그대로 서빙)
// CURRENT는 ?mode=design 요청을 예외 없이 거부한다. PREVIOUS/DRAFT의 ?mode=design은
// 관리자만 허용한다(일반 직원은 "열기"=fill 모드만 가능 — Portal CLAUDE.md의
// "역할 분리는 서버에서 강제한다" 원칙과 동일하게, 여기서도 서버에서 실제로 막는다).
// ─────────────────────────────
router.use(
  "/typing-static/:version",
  async (req: any, res, next) => {
    const version = req.params.version;
    if (!VERSION_NAMES.includes(version)) return res.status(404).json({ error: "알 수 없는 버전입니다." });

    // 이 경로는 fetch API 호출(Authorization 헤더)뿐 아니라 일반 브라우저 네비게이션
    // (window.open으로 열리는 index.html/이미지/overlay-design.json 등 하위 리소스 포함)
    // 으로도 요청이 들어온다 — 네비게이션은 커스텀 헤더를 못 붙이므로, 그 경우에는
    // POST /api/typing-versions/nav-session이 심어둔 Path 한정 HttpOnly 쿠키를 쓴다.
    // 둘 다 "같은" 서명된 세션 토큰을 getSession()으로 검증하므로 보안 수준은 동일하다.
    const authHeader = req.headers.authorization;
    let sessionToken: string | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      sessionToken = authHeader.slice(7);
    } else if (req.cookies && req.cookies[NAV_COOKIE_NAME]) {
      sessionToken = req.cookies[NAV_COOKIE_NAME];
    }
    if (!sessionToken) {
      return res.status(401).json({ error: "인증이 필요합니다." });
    }
    const session = await getStorage().getSession(sessionToken);
    if (!session) return res.status(401).json({ error: "유효하지 않은 세션입니다." });

    // 기존 isInternal/isAdmin 중복 계산 대신 requireTypingViewer/requireTypingAdmin과
    // 동일한 공유 로직(resolveTypingPermission)을 그대로 재사용한다 — 세 번째 "정답"을
    // 만들지 않는다.
    const readResult = await resolveTypingPermission(session, "TYPING_READ");
    if (readResult === "FAIL_CLOSED") {
      return res.status(503).json({ error: "권한 확인 중 오류가 발생했습니다." });
    }
    if (readResult === "DENY") return res.status(403).json({ error: "접근 권한이 없습니다." });

    const isDesignMode = req.query.mode === "design";
    if (isDesignMode) {
      if (version === "current") {
        return res.status(403).json({ error: "현재 운영 버전은 개발도구로 열 수 없습니다." });
      }
      const manageResult = await resolveTypingPermission(session, "TYPING_MANAGE");
      if (manageResult === "FAIL_CLOSED") {
        return res.status(503).json({ error: "권한 확인 중 오류가 발생했습니다." });
      }
      if (manageResult === "DENY") {
        return res.status(403).json({ error: "개발도구는 관리자만 사용할 수 있습니다." });
      }
    }

    const dir = versionDir(version);
    if (!fs.existsSync(dir)) return res.status(404).json({ error: "해당 버전이 아직 없습니다." });

    express.static(dir, {
      etag: true,
      lastModified: true,
      setHeaders: (resp) => {
        resp.setHeader("Cache-Control", "no-store");
      },
    })(req, res, next);
  }
);

export default router;
