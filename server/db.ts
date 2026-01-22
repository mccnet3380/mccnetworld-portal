// server/db.ts
import { Pool, PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema";

/** 지수 백오프 유틸 */
async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const info = {
        attempt,
        maxRetries,
        code: error?.code ?? "UNKNOWN",
        errno: error?.errno ?? "N/A",
        sqlState: error?.sqlState ?? "N/A",
        message: String(error?.message ?? "").slice(0, 200),
        timestamp: new Date().toISOString(),
      };
      console.error("🔍 PostgreSQL 연결 진단:", info);

      const retryable =
        [
          "ETIMEDOUT",
          "ECONNRESET",
          "ECONNREFUSED",
          "ENOTFOUND",
          "EAI_AGAIN",
          "ENETUNREACH",
          "EHOSTUNREACH",
        ].includes(error?.code) ||
        /fetch failed|timeout|network|connect|socket|dns|resolve|refused/i.test(
          info.message,
        );

      if (!retryable || attempt === maxRetries) {
        console.error(
          `💥 PostgreSQL 연결 최종 실패 (재시도 ${retryable ? "초과" : "불가"})`,
        );
        throw lastError;
      }
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), 4000);
      console.log(
        `🔄 PostgreSQL 재시도 ${attempt}/${maxRetries} - ${delayMs}ms 후 재시도`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

/** 전역 단일 인스턴스 */
let pool: Pool | null = null;
let db_: ReturnType<typeof drizzle<typeof schema>> | null = null;
let initialized = false;

/** 환경변수 URL 깨끗하게 (접두어/따옴표 제거) */
function cleanDatabaseUrl(raw?: string): string {
  if (!raw) return "";
  const s = raw
    .replace(/^DATABASE_URL=/, "")
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "");
  return s;
}

/** 환경에 따른 DB URL 선택 */
function getDatabaseUrl(): string {
  const APP_ENV = process.env.APP_ENV;
  const NODE_ENV = process.env.NODE_ENV;
  const REPLIT_DEPLOYMENT = process.env.REPLIT_DEPLOYMENT;
  const REPLIT_ENVIRONMENT = process.env.REPLIT_ENVIRONMENT;
  
  // 최고 안전성: 명시적 APP_ENV=production만 허용 (다른 환경 변수들이 불안정함)
  const isProduction = APP_ENV === "production";
  
  const envIndicators = { 
    APP_ENV, 
    NODE_ENV, 
    REPLIT_DEPLOYMENT, 
    REPLIT_ENVIRONMENT,
    isProduction 
  };
  
  if (isProduction) {
    const productionUrl = process.env.DATABASE_URL_PROD;
    if (productionUrl) {
      console.log("🚀 Using PRODUCTION database");
      console.log("Environment indicators:", envIndicators);
      
      // 안전 검증: 개발 환경 표시인데 운영 DB 사용 시 경고
      if (NODE_ENV === "development" && APP_ENV !== "production") {
        console.warn("⚠️ SAFETY WARNING: Development NODE_ENV but using production DB!");
      }
      
      return cleanDatabaseUrl(productionUrl);
    }
    console.warn("⚠️ Production environment detected but DATABASE_URL_PROD not found!");
    throw new Error("DATABASE_URL_PROD is required for production environment");
  }
  
  // 기본값: 개발 환경 (안전 우선)
  const devUrl = process.env.DATABASE_URL_DEV;
  if (!devUrl) {
    console.warn("⚠️ DATABASE_URL_DEV is not set! Falling back to DATABASE_URL");
    console.warn("⚠️ Please configure DATABASE_URL_DEV in Replit Secrets to separate dev/prod databases");
    const fallbackUrl = process.env.DATABASE_URL;
    if (!fallbackUrl) {
      console.error("❌ Neither DATABASE_URL_DEV nor DATABASE_URL is set!");
      throw new Error("DATABASE_URL_DEV or DATABASE_URL is required");
    }
    console.log("🔧 Using FALLBACK database (DATABASE_URL)");
    console.log("Environment indicators:", envIndicators);
    return cleanDatabaseUrl(fallbackUrl);
  }
  console.log("🔧 Using DEVELOPMENT database");
  console.log("Environment indicators:", envIndicators);
  return cleanDatabaseUrl(devUrl);
}

/** 민감정보 마스킹 로그 */
function maskDbUrl(raw?: string) {
  if (!raw) return "(empty)";
  try {
    const u = new URL(cleanDatabaseUrl(raw));
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return raw.slice(0, 120) + (raw.length > 120 ? "…" : "");
  }
}

/** DB 초기화 (단일 Pool) */
export async function initializeDatabase() {
  if (initialized && pool && db_) {
    console.log("PostgreSQL Pool 이미 초기화됨 - 재사용");
    return db_;
  }

  const connectionString = getDatabaseUrl();
  if (!connectionString || !/^postgres(ql)?:\/\//.test(connectionString)) {
    throw new Error(`유효한 DATABASE_URL 필요: 현재 값='${maskDbUrl(connectionString)}'`);
  }

  console.log("단일 PostgreSQL Pool 초기화 중…");
  console.log("DB_URL (masked):", maskDbUrl(connectionString));

  const cfg: PoolConfig = {
    connectionString,
    // Render/일반 Postgres: sslmode=require에서 서버 인증서 검증은 생략(호환 목적)
    ssl: { rejectUnauthorized: false },
    idleTimeoutMillis: 10_000, // 10s
    connectionTimeoutMillis: 30_000, // 30s
    max: 10,
  };

  pool = new Pool(cfg);

  // 헬스체크(연결 확인)
  await withExponentialBackoff(
    async () => {
      const client = await pool!.connect();
      try {
        await client.query("select 1 as ok");
      } finally {
        client.release();
      }
    },
    3,
    500,
  );

  db_ = drizzle(pool, { schema });
  initialized = true;
  console.log("✅ PostgreSQL Pool 초기화 성공");
  return db_;
}

/** DB 인스턴스 가져오기 */
export function getDatabase() {
  if (!db_ || !initialized) {
    return initializeDatabase();
  }
  return db_;
}

/** 헬스체크 */
export async function checkPostgreSQLHealth(): Promise<{
  ok: boolean;
  latencyMs?: number;
  ssl?: boolean;
  family?: string;
  lastErrorCode?: string;
  connectionPool?: string;
  timestamp?: string;
  dbVersion?: string;
  backendPid?: number;
}> {
  if (!pool) {
    return {
      ok: false,
      lastErrorCode: "NO_POOL",
      connectionPool: "None",
      timestamp: new Date().toISOString(),
    };
  }
  try {
    const start = Date.now();
    const r = await withExponentialBackoff(
      async () => {
        return pool!.query<{
          health_check: number;
          db_name: string;
          db_version: string;
          ssl_is_on: string;
          backend_pid: number;
          server_time: string;
        }>(
          `
        SELECT 
          1 as health_check,
          current_database() as db_name,
          version() as db_version,
          COALESCE(current_setting('ssl', true), 'off') as ssl_is_on,
          pg_backend_pid() as backend_pid,
          now() as server_time
        `,
        );
      },
      3,
      500,
    );
    const latencyMs = Date.now() - start;
    const row = r.rows[0];

    console.log("✅ PostgreSQL 헬스체크 성공:", {
      latencyMs,
      ssl: row?.ssl_is_on === "on",
      backendPid: row?.backend_pid,
      time: row?.server_time,
    });

    return {
      ok: true,
      latencyMs,
      ssl: row?.ssl_is_on === "on",
      family: "PostgreSQL",
      connectionPool: "node-postgres",
      dbVersion: row?.db_version?.split(" ")[0],
      backendPid: row?.backend_pid,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("💥 PostgreSQL 헬스체크 1차 실패 - 폴백 시도:", {
      code: error?.code ?? "UNKNOWN",
      message: String(error?.message ?? "").slice(0, 200),
    });
    
    try {
      const minimal = await pool!.query<{ health_check: number }>('SELECT 1 as health_check');
      if (minimal.rows[0]?.health_check === 1) {
        console.log("✅ PostgreSQL 폴백 헬스체크 성공 (최소 연결 확인)");
        return {
          ok: true,
          family: "PostgreSQL",
          connectionPool: "node-postgres",
          timestamp: new Date().toISOString(),
        };
      }
    } catch (fallbackError: any) {
      console.error("💥 PostgreSQL 폴백 헬스체크도 실패:", {
        code: fallbackError?.code ?? "UNKNOWN",
        message: String(fallbackError?.message ?? "").slice(0, 200),
      });
    }
    
    return {
      ok: false,
      lastErrorCode: error?.code ?? "CONNECTION_ERROR",
      connectionPool: "node-postgres",
      timestamp: new Date().toISOString(),
    };
  }
}

/** 호환성 export */
export const db = db_;
