// server/routes/training.ts
//
// 작업명: MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
//
// 교육자료(사내 교육센터) 독립 API. 기존 server/routes.ts(대형 라우터)는 건드리지 않고
// server/routes/lg-audit.ts와 같은 방식으로 독립 라우터로 분리해서 마운트한다.
//
// 열람 권한: admin / sales_manager / (dealerId·dealerRegistrationId가 없는) 내부 user만
// 허용한다 — server/routes/lg-audit.ts의 requireLgAuditAccess와 완전히 동일한 판정
// 방식이다(딜러도 DB상 userType='user'로 저장되므로 session.userType만으로는 내부
// 워커를 판정할 수 없다 — 반드시 getUserById로 재조회해서 dealerId/dealerRegistrationId
// 부재를 직접 확인한다). 등록/수정/삭제/첨부관리는 admin만 허용(백엔드에서 강제).
//
// 본문은 항상 shared/training-markdown.ts의 경량 서브셋 문자열로만 저장한다 — 임의
// HTML을 저장/렌더링하지 않으므로 별도 sanitize 라이브러리 없이도 XSS 표면이 없다.
//
// 업로드 파일은 uploads/training/ 아래 랜덤 파일명으로 저장한다(원본 파일명은 DB
// originalName에만 보관 — 서버 경로에 절대 사용하지 않음, path traversal 방지).

import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getStorage } from "../storage";
import { getDatabase } from "../db";
import { trainingArticles, trainingAttachments } from "../../shared/schema";
import { TRAINING_CATEGORIES, type TrainingCategory } from "../../shared/training-markdown";

const router = Router();

const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "training");

async function requireTrainingViewer(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: "유효하지 않은 세션입니다." });
  }

  if (session.userType === "admin" || session.userType === "sales_manager") {
    req.session = session;
    req.isTrainingAdmin = session.userType === "admin";
    return next();
  }

  if (session.userType === "user") {
    const user = await getStorage().getUserById(session.userId);
    if (user && !user.dealerId && !user.dealerRegistrationId) {
      req.session = session;
      req.isTrainingAdmin = false;
      return next();
    }
    return res.status(403).json({ error: "접근 권한이 없습니다." });
  }

  return res.status(403).json({ error: "접근 권한이 없습니다." });
}

async function requireTrainingAdmin(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }
  const sessionId = authHeader.replace("Bearer ", "");
  const session = await getStorage().getSession(sessionId);
  if (!session || session.userType !== "admin") {
    return res.status(403).json({ error: "관리자 권한이 필요합니다." });
  }
  req.session = session;
  next();
}

function isValidCategory(v: unknown): v is TrainingCategory {
  return typeof v === "string" && (TRAINING_CATEGORIES as readonly string[]).includes(v);
}

// ── 첨부파일 업로드 설정 ──────────────────────────────────────────────
const ALLOWED_EXT_MIME: Record<string, string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".mp4": ["video/mp4"],
  ".webm": ["video/webm"],
  ".pdf": ["application/pdf"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".xls": ["application/vnd.ms-excel"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".doc": ["application/msword"],
  ".txt": ["text/plain"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};

// 타입별 최대 크기(바이트). multer 레벨에서는 전체 상한(영상 기준)만 걸고,
// 실제 타입별 상한은 업로드 후 애플리케이션 레벨에서 재검증한다(§ 계획 4).
const MAX_SIZE_BY_TYPE: Record<string, number> = {
  IMAGE: 15 * 1024 * 1024,
  VIDEO: 150 * 1024 * 1024,
  PDF: 20 * 1024 * 1024,
  FILE: 20 * 1024 * 1024,
};
const MULTER_MAX_SIZE = 150 * 1024 * 1024;

function attachmentTypeForExt(ext: string): "IMAGE" | "VIDEO" | "PDF" | "FILE" {
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) return "IMAGE";
  if ([".mp4", ".webm"].includes(ext)) return "VIDEO";
  if (ext === ".pdf") return "PDF";
  return "FILE";
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
      cb(null, UPLOAD_ROOT);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MULTER_MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedMimes = ALLOWED_EXT_MIME[ext];
    if (!allowedMimes) return cb(new Error("허용되지 않는 파일 형식입니다."));
    if (!allowedMimes.includes(file.mimetype)) return cb(new Error("파일 확장자와 실제 형식이 일치하지 않습니다."));
    cb(null, true);
  },
});

// ── Read (viewer) ────────────────────────────────────────────────────

router.get("/api/training/articles", requireTrainingViewer, async (req: any, res) => {
  try {
    const db = await getDatabase();
    const category = req.query.category;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const wantDrafts = req.isTrainingAdmin && req.query.status === "DRAFT";
    const wantAll = req.isTrainingAdmin && req.query.status === "ALL";

    const conditions = [isNull(trainingArticles.deletedAt)];
    if (isValidCategory(category)) conditions.push(eq(trainingArticles.category, category));
    if (!req.isTrainingAdmin) {
      conditions.push(eq(trainingArticles.status, "PUBLISHED"));
    } else if (wantDrafts) {
      conditions.push(eq(trainingArticles.status, "DRAFT"));
    } else if (!wantAll) {
      conditions.push(eq(trainingArticles.status, "PUBLISHED"));
    }

    const rows = await db
      .select()
      .from(trainingArticles)
      .where(and(...conditions))
      .orderBy(desc(trainingArticles.isPinned), trainingArticles.sortOrder, desc(trainingArticles.updatedAt));

    const filtered = q
      ? rows.filter((r) => {
          const hay = `${r.title} ${r.summary ?? ""} ${r.content}`.toLowerCase();
          return hay.includes(q.toLowerCase());
        })
      : rows;

    res.set("Cache-Control", "no-store");
    res.json({ articles: filtered });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/training/articles/:id", requireTrainingViewer, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 ID입니다." });

  try {
    const db = await getDatabase();
    const rows = await db
      .select()
      .from(trainingArticles)
      .where(and(eq(trainingArticles.id, id), isNull(trainingArticles.deletedAt)))
      .limit(1);
    const article = rows[0];
    if (!article) return res.status(404).json({ error: "교육자료를 찾을 수 없습니다." });
    if (!req.isTrainingAdmin && article.status !== "PUBLISHED") {
      return res.status(403).json({ error: "접근 권한이 없습니다." });
    }

    const attachments = await db
      .select()
      .from(trainingAttachments)
      .where(eq(trainingAttachments.articleId, id))
      .orderBy(trainingAttachments.sortOrder);

    res.set("Cache-Control", "no-store");
    res.json({ article, attachments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/training/attachments/:id/file", requireTrainingViewer, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 ID입니다." });

  try {
    const db = await getDatabase();
    const rows = await db.select().from(trainingAttachments).where(eq(trainingAttachments.id, id)).limit(1);
    const attachment = rows[0];
    if (!attachment) return res.status(404).json({ error: "첨부파일을 찾을 수 없습니다." });

    if (!req.isTrainingAdmin) {
      const articleRows = await db
        .select()
        .from(trainingArticles)
        .where(and(eq(trainingArticles.id, attachment.articleId), isNull(trainingArticles.deletedAt)))
        .limit(1);
      if (!articleRows[0] || articleRows[0].status !== "PUBLISHED") {
        return res.status(403).json({ error: "접근 권한이 없습니다." });
      }
    }

    const absPath = path.join(process.cwd(), attachment.filePath);
    if (!absPath.startsWith(UPLOAD_ROOT) || !fs.existsSync(absPath)) {
      return res.status(404).json({ error: "파일을 찾을 수 없습니다." });
    }

    const disposition = attachment.attachmentType === "IMAGE" || attachment.attachmentType === "PDF" ? "inline" : "attachment";
    res.setHeader("Content-Type", attachment.mimeType);
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(attachment.originalName)}"`);
    fs.createReadStream(absPath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Write (admin) ────────────────────────────────────────────────────

router.post("/api/training/articles", requireTrainingAdmin, async (req: any, res) => {
  const { title, summary, category, content, status, isPinned, sortOrder } = req.body || {};
  if (typeof title !== "string" || !title.trim()) return res.status(400).json({ error: "제목은 필수입니다." });
  if (!isValidCategory(category)) return res.status(400).json({ error: "카테고리가 올바르지 않습니다." });
  if (typeof content !== "string") return res.status(400).json({ error: "본문은 필수입니다." });
  const finalStatus = status === "PUBLISHED" ? "PUBLISHED" : "DRAFT";

  try {
    const db = await getDatabase();
    const [row] = await db
      .insert(trainingArticles)
      .values({
        title: title.trim(),
        summary: typeof summary === "string" ? summary.trim() || null : null,
        category,
        content,
        status: finalStatus,
        isPinned: Boolean(isPinned),
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
        createdBy: req.session.userId,
        updatedBy: req.session.userId,
      })
      .returning();
    res.status(201).json({ article: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/api/training/articles/:id", requireTrainingAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 ID입니다." });

  const { title, summary, category, content, status, isPinned, sortOrder } = req.body || {};
  if (category !== undefined && !isValidCategory(category)) {
    return res.status(400).json({ error: "카테고리가 올바르지 않습니다." });
  }
  if (status !== undefined && status !== "DRAFT" && status !== "PUBLISHED") {
    return res.status(400).json({ error: "게시상태가 올바르지 않습니다." });
  }

  const fields: Record<string, unknown> = { updatedBy: req.session.userId, updatedAt: new Date() };
  if (typeof title === "string") fields.title = title.trim();
  if (summary !== undefined) fields.summary = typeof summary === "string" ? summary.trim() || null : null;
  if (category !== undefined) fields.category = category;
  if (typeof content === "string") fields.content = content;
  if (status !== undefined) fields.status = status;
  if (isPinned !== undefined) fields.isPinned = Boolean(isPinned);
  if (Number.isInteger(sortOrder)) fields.sortOrder = sortOrder;

  try {
    const db = await getDatabase();
    const [row] = await db
      .update(trainingArticles)
      .set(fields)
      .where(and(eq(trainingArticles.id, id), isNull(trainingArticles.deletedAt)))
      .returning();
    if (!row) return res.status(404).json({ error: "교육자료를 찾을 수 없습니다." });
    res.json({ article: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// soft delete — 첨부파일 물리삭제는 하지 않는다(§ 계획 2/4).
router.delete("/api/training/articles/:id", requireTrainingAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 ID입니다." });

  try {
    const db = await getDatabase();
    const [row] = await db
      .update(trainingArticles)
      .set({ deletedAt: new Date(), updatedBy: req.session.userId })
      .where(and(eq(trainingArticles.id, id), isNull(trainingArticles.deletedAt)))
      .returning();
    if (!row) return res.status(404).json({ error: "교육자료를 찾을 수 없습니다." });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/api/training/articles/:id/attachments",
  requireTrainingAdmin,
  (req, res, next) => {
    upload.single("file")(req, res, (err: any) => {
      if (err) return res.status(400).json({ error: err.message || "업로드에 실패했습니다." });
      next();
    });
  },
  async (req: any, res) => {
    const articleId = Number(req.params.id);
    const file = req.file as Express.Multer.File | undefined;
    if (!Number.isInteger(articleId)) return res.status(400).json({ error: "잘못된 ID입니다." });
    if (!file) return res.status(400).json({ error: "파일이 없습니다." });

    const ext = path.extname(file.originalname || "").toLowerCase();
    const attachmentType = attachmentTypeForExt(ext);
    const maxForType = MAX_SIZE_BY_TYPE[attachmentType];
    if (file.size > maxForType) {
      fs.unlink(file.path, () => {});
      return res.status(400).json({ error: `${attachmentType} 파일은 ${Math.floor(maxForType / (1024 * 1024))}MB를 초과할 수 없습니다.` });
    }

    try {
      const db = await getDatabase();
      const articleRows = await db
        .select()
        .from(trainingArticles)
        .where(and(eq(trainingArticles.id, articleId), isNull(trainingArticles.deletedAt)))
        .limit(1);
      if (!articleRows[0]) {
        fs.unlink(file.path, () => {});
        return res.status(404).json({ error: "교육자료를 찾을 수 없습니다." });
      }

      const [row] = await db
        .insert(trainingAttachments)
        .values({
          articleId,
          originalName: file.originalname,
          storedName: file.filename,
          mimeType: file.mimetype,
          fileSize: file.size,
          filePath: path.join("uploads", "training", file.filename),
          attachmentType,
          sortOrder: 0,
        })
        .returning();
      res.status(201).json({ attachment: row });
    } catch (err: any) {
      fs.unlink(file.path, () => {});
      res.status(500).json({ error: err.message });
    }
  },
);

router.delete("/api/training/attachments/:id", requireTrainingAdmin, async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "잘못된 ID입니다." });

  try {
    const db = await getDatabase();
    const rows = await db.select().from(trainingAttachments).where(eq(trainingAttachments.id, id)).limit(1);
    const attachment = rows[0];
    if (!attachment) return res.status(404).json({ error: "첨부파일을 찾을 수 없습니다." });

    await db.delete(trainingAttachments).where(eq(trainingAttachments.id, id));

    const absPath = path.join(process.cwd(), attachment.filePath);
    if (absPath.startsWith(UPLOAD_ROOT)) {
      fs.unlink(absPath, () => {});
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
