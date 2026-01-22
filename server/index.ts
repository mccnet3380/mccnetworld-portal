// server/index.ts
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { setupVite, serveStatic, log } from "./vite";
import router from "./routes";
import authRouter from "./auth-routes";
import { ChatWebSocketServer } from "./websocket";
import { initializeDatabase, checkPostgreSQLHealth } from "./db";
import { initStorage } from "./storage"; // storage는 반드시 지연 초기화로

// ─────────────────────────────
// 경로 유틸 (ESM 호환)
// ─────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);

// ─────────────────────────────
// 기본 설정 (Replit / Render 환경 친화)
// ─────────────────────────────
const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT ?? 5000);
const NODE_ENV = process.env.NODE_ENV || "development";

// 프록시 환경에서 클라이언트 IP/HTTPS 판별 정확도 향상
app.set("trust proxy", 1);

// ─────────────────────────────
/** 환경별 CORS 설정 */
// ─────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];

console.log(`🔒 CORS 설정 - APP_ENV: ${process.env.APP_ENV}`);
console.log(`🔒 허용된 Origins: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'localhost만'}`);

const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // same-origin 요청은 항상 허용 (origin이 undefined)
    if (!origin) {
      console.log(`✅ CORS 허용 (same-origin): no-origin`);
      return callback(null, true);
    }

    // 개발 환경: localhost + Replit URL 허용
    if (process.env.APP_ENV?.trim() === 'development') {
      // localhost 패턴 허용
      if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(origin)) {
        console.log(`✅ CORS 허용 (개발-localhost): ${origin}`);
        return callback(null, true);
      }
      // Replit Preview URL 허용 (*.replit.dev)
      if (/\.replit\.dev$/.test(origin)) {
        console.log(`✅ CORS 허용 (개발-replit): ${origin}`);
        return callback(null, true);
      }
    }
    
    // Replit 배포 도메인 자동 허용 (*.replit.app)
    if (origin.endsWith('.replit.app')) {
      console.log(`✅ CORS 허용 (replit.app): ${origin}`);
      return callback(null, true);
    }
    
    // ALLOWED_ORIGINS 체크
    if (allowedOrigins.length > 0) {
      if (allowedOrigins.includes(origin)) {
        console.log(`✅ CORS 허용 (allowlist): ${origin}`);
        return callback(null, true);
      }
    } else {
      // ALLOWED_ORIGINS가 비어있으면 모든 HTTPS 요청 허용
      if (origin.startsWith('https://')) {
        console.log(`✅ CORS 허용 (https-auto): ${origin}`);
        return callback(null, true);
      }
    }
    
    console.warn(`❌ CORS 차단: ${origin}`);
    callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};

// ─────────────────────────────
// 헬스체크 엔드포인트 (CORS보다 먼저 - Replit Publish 헬스체크 허용)
// ─────────────────────────────
// Replit Publish용 루트 헬스체크 (Accept 헤더가 */* 또는 비어있으면 헬스체크로 간주)
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  const acceptHeader = req.headers.accept || '';
  
  // Accept가 */*이거나 비어있으면 헬스체크로 간주 (Replit 헬스체크)
  // 브라우저는 Accept: text/html,application/xhtml+xml... 등으로 요청
  if (acceptHeader === '*/*' || acceptHeader === '' || acceptHeader === 'application/json') {
    return res.status(200).json({
      ok: true,
      env: NODE_ENV,
      port: PORT,
      time: new Date().toISOString(),
    });
  }
  
  // 브라우저 요청(HTML 포함)은 다음 핸들러로 (CORS 이후 SPA fallback)
  next();
});

// Replit Publish용 /he 엔드포인트
app.get("/he", async (_req: Request, res: Response) => {
  try {
    const dbHealth = await checkPostgreSQLHealth().catch(() => ({ ok: false }));
    res.status(200).json({
      ok: true,
      env: NODE_ENV,
      port: PORT,
      db: dbHealth,
      time: new Date().toISOString(),
    });
  } catch {
    res.status(200).json({
      ok: true,
      env: NODE_ENV,
      port: PORT,
      db: { ok: false },
      time: new Date().toISOString(),
    });
  }
});

// 일반 헬스체크 엔드포인트
app.get("/api/health", async (_req: Request, res: Response) => {
  try {
    const dbHealth = await checkPostgreSQLHealth().catch(() => ({ ok: false }));
    res.status(200).json({
      ok: true,
      env: NODE_ENV,
      port: PORT,
      db: dbHealth,
      time: new Date().toISOString(),
    });
  } catch {
    res.status(200).json({
      ok: true,
      env: NODE_ENV,
      port: PORT,
      db: { ok: false },
      time: new Date().toISOString(),
    });
  }
});

// ─────────────────────────────
/** 보안/성능 미들웨어 */
// ─────────────────────────────
app.use(
  helmet({
    // CSP를 임시로 비활성화 (빈 페이지 문제 해결을 위해)
    contentSecurityPolicy: false,
  }),
);

// CORS 미들웨어 적용
app.use(cors(corsOptions));

// 프리플라이트 보장
app.options('*', (req, res, next) => {
  console.log('[CORS PREFLIGHT] OPTIONS request:', req.url, 'Origin:', req.headers.origin);
  cors({ ...corsOptions, optionsSuccessStatus: 204 })(req, res, next);
});

app.use(compression());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─────────────────────────────
// 유틸: DATABASE_URL 마스킹 로거
// ─────────────────────────────
function maskDbUrl(raw?: string) {
  if (!raw) return "(empty)";
  try {
    const u = new URL(raw.replace(/^DATABASE_URL=/, "")); // "DATABASE_URL=" 접두어 방지
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return raw.slice(0, 120) + (raw.length > 120 ? "…" : "");
  }
}

// ─────────────────────────────
// 개발 전용 환경 정보 엔드포인트
// ─────────────────────────────
if (process.env.APP_ENV === 'development') {
  app.get('/api/env-echo', (_req: Request, res: Response) => {
    res.json({
      APP_ENV: process.env.APP_ENV,
      SESSION_NAME: process.env.SESSION_NAME,
      buildTime: new Date().toISOString(),
      uiVersion: 'dev-20250926',
      allowedOrigins: allowedOrigins,
      corsEnabled: true
    });
  });
}

// ─────────────────────────────
// API 라우트 (vite보다 항상 먼저)
// ─────────────────────────────
app.use("/api/auth", authRouter);
app.use(router);

// ─────────────────────────────
// 개발/운영 정적 서빙 분기
// ─────────────────────────────
if (false) {
  // Vite 미들웨어 (HMR) - 임시 비활성화
  await setupVite(app, server);
  log("✅ Vite HMR이 활성화되었습니다.");
} else {
  // 1) 기존 헬퍼(있다면)로 정적 서빙
  try {
    serveStatic(app);
  } catch {
    // 무시: 아래 명시적 설정으로 커버
  }

  // 2) 명시적 정적 서빙 + SPA Fallback 보장
  //    - 프로덕션에서는 컴파일된 서버가 dist/index.js에 있으므로 상대 경로 수정
  const distPath = NODE_ENV === "production" 
    ? path.join(__dirname, "public")  // dist/index.js에서 dist/public
    : path.resolve(__dirname, "../dist/public"); // 개발환경
  const indexHtml = path.join(distPath, "index.html");

  // 프로덕션 빌드 파일 존재 확인 및 자동 빌드
  console.log(`📁 정적 파일 경로: ${distPath}`);
  console.log(`📄 index.html 경로: ${indexHtml}`);
  console.log(`✅ index.html 존재 여부: ${fs.existsSync(indexHtml)}`);
  
  if (fs.existsSync(distPath)) {
    const files = fs.readdirSync(distPath);
    console.log(`📂 ${distPath} 내용:`, files);
  }
  
  if (!fs.existsSync(indexHtml)) {
    console.warn(`⚠️ 빌드 파일이 없습니다: ${indexHtml}`);
    if (NODE_ENV === "production") {
      console.log("🔧 프로덕션 환경에서 자동 빌드를 실행합니다...");
      try {
        const { execSync } = await import("child_process");
        execSync("npm run build", { stdio: "inherit" });
        console.log("✅ 빌드가 완료되었습니다.");
      } catch (buildError) {
        console.error("❌ 빌드 실패:", buildError);
        process.exit(1);
      }
    } else {
      console.log("개발 환경에서는 Vite HMR을 사용합니다.");
    }
  }

  // /assets 경로 명시적 MIME 타입 설정 (CSS/JS 오류 방지)
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    fallthrough: false,
    maxAge: NODE_ENV === "production" ? 31536000000 : 0,
    immutable: NODE_ENV === "production",
    setHeaders: (res, filePath) => {
      // MIME 타입 명시적 설정
      if (filePath.endsWith('.js')) {
        res.set('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.css')) {
        res.set('Content-Type', 'text/css; charset=utf-8');
      } else if (filePath.endsWith('.woff') || filePath.endsWith('.woff2')) {
        res.set('Content-Type', 'font/woff2');
      } else if (filePath.endsWith('.svg')) {
        res.set('Content-Type', 'image/svg+xml');
      } else if (filePath.endsWith('.png')) {
        res.set('Content-Type', 'image/png');
      } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
        res.set('Content-Type', 'image/jpeg');
      }
      
      // 캐시 헤더
      if (NODE_ENV === "production") {
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // 정적 파일 서빙 (index.html 등)
  app.use(express.static(distPath, { 
    fallthrough: true,
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));

  // SPA Fallback: 정적 자산을 가로채지 않도록 개선
  app.get("*", (req, res, next) => {
    // API 요청은 다음 핸들러로
    if (req.path.startsWith("/api/")) return next();
    
    // 파일 확장자가 있는 요청(JS, CSS, 이미지 등)은 404로 처리
    if (path.extname(req.path)) return next();
    
    // HTML 요청만 받는 요청만 index.html 반환
    if (!req.accepts("html")) return next();
    
    res.sendFile(indexHtml, (err) => (err ? next(err) : undefined));
  });
}

// ─────────────────────────────
// API 404 핸들링 (정적/Fallback 이후에 남은 /api/* 만)
// ─────────────────────────────
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// ─────────────────────────────
// 공통 에러 핸들러
// ─────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || "서버 오류가 발생했습니다." });
});

// ─────────────────────────────
// 글로벌 에러 핸들링 (DB 연결 에러 등)
// ─────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // EADDRINUSE 등의 오류에서는 항상 프로세스를 종료하여 포트 충돌 방지
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // PostgreSQL 연결 에러 등의 경우 서버를 종료하지 않음
});

// ─────────────────────────────
// 서버 부트스트랩
// ─────────────────────────────
async function main() {
  const bootTimestamp = new Date().toISOString();
  
  console.log("\n" + "=".repeat(80));
  console.log("🚀 MCC 네트월드 서버 부팅 로그");
  console.log("=".repeat(80));
  console.log(`[BOOT] Started at: ${bootTimestamp}`);
  console.log(`[BOOT] NODE_ENV=${NODE_ENV}`);
  console.log(`[BOOT] APP_ENV=${process.env.APP_ENV || 'undefined'}`);
  console.log(`[BOOT] REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT || 'undefined'}`);
  console.log(`[BOOT] REPLIT_ENVIRONMENT=${process.env.REPLIT_ENVIRONMENT || 'undefined'}`);
  console.log(`[BOOT] DATABASE_URL=${maskDbUrl(process.env.DATABASE_URL)}`);
  console.log(`[BOOT] Working directory: ${process.cwd()}`);
  console.log(`[BOOT] dotenv loading: ${process.env.NODE_ENV === 'production' ? '.env.production (if exists)' : 'process.env'}`);
  console.log("=".repeat(80) + "\n");

  // 1) DB 초기화
  try {
    await initializeDatabase();
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
    if (NODE_ENV === "production") {
      process.exit(1); // 운영에서는 반드시 중단
    }
  }

  // 2) Storage 초기화 (DB 이후)
  try {
    await initStorage();
  } catch (err) {
    console.error("❌ Storage initialization failed:", err);
    if (NODE_ENV === "production") {
      process.exit(1);
    }
  }

  // 3) WebSocket 서버
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const chatWS = new ChatWebSocketServer(server);

  // 4) 서버 시작
  server
    .listen(PORT, HOST, () => {
      log(`✅ Server running at http://${HOST}:${PORT} (${NODE_ENV})`);
    })
    .on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        console.error(
          `❌ Port ${PORT} is already in use. Use process.env.PORT in PaaS environments.`,
        );
      } else {
        console.error("❌ Server listen error:", err);
      }
      process.exit(1);
    });

  // 5) Graceful Shutdown
  const shutdown = (signal: string) => {
    console.log(`\n🔻 ${signal} received. Shutting down gracefully...`);
    server.close((closeErr?: Error) => {
      if (closeErr) {
        console.error("Error during HTTP server close:", closeErr);
        process.exit(1);
      }
      console.log("✅ Server closed. Bye!");
      process.exit(0);
    });
    setTimeout(() => {
      console.warn("Force exiting (timeout)...");
      process.exit(1);
    }, 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("❌ Fatal error in server bootstrap:", e);
  process.exit(1);
});