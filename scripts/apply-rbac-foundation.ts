// scripts/apply-rbac-foundation.ts
//
// 작업명: MCC_RBAC_PHASE_2A_1_REPRODUCIBLE_MIGRATION_ARTIFACT_1
//
// scripts/migrations/20261005_rbac_foundation.sql을 안전하게 실행하는 helper.
// - 어떤 DB(DEV/PROD)에 연결하는지 항상 먼저 표시한다(server/db.ts의 getDatabaseUrl()과
//   동일한 선택 로직 — APP_ENV=production이면 DATABASE_URL_PROD, 아니면 DATABASE_URL_DEV).
// - Production은 기본적으로 거부한다. 실행하려면 명시적 --production-confirm 플래그가 필요하다.
// - 실행 후 roles/permissions/role_permissions/user_roles row count를 출력해 검증한다.
// - 실패 시 non-zero exit.
//
// 실행(DEV):
//   npx tsx --env-file=.env scripts/apply-rbac-foundation.ts
//
// 실행(Production, 명시적 opt-in 필요):
//   APP_ENV=production npx tsx --env-file=.env.production scripts/apply-rbac-foundation.ts --production-confirm

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function cleanDatabaseUrl(raw?: string): string {
  if (!raw) return "";
  return raw.replace(/^DATABASE_URL=/, "").replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
}

function maskDbUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return raw.slice(0, 60) + "…";
  }
}

function resolveDatabaseUrl(): { url: string; isProduction: boolean } {
  const isProduction = process.env.APP_ENV === "production";
  if (isProduction) {
    const url = process.env.DATABASE_URL_PROD;
    if (!url) throw new Error("APP_ENV=production인데 DATABASE_URL_PROD가 없습니다.");
    return { url: cleanDatabaseUrl(url), isProduction: true };
  }
  const devUrl = process.env.DATABASE_URL_DEV || process.env.DATABASE_URL;
  if (!devUrl) throw new Error("DATABASE_URL_DEV 또는 DATABASE_URL이 필요합니다.");
  return { url: cleanDatabaseUrl(devUrl), isProduction: false };
}

async function main() {
  const { url, isProduction } = resolveDatabaseUrl();

  console.log("=== RBAC foundation migration 실행 ===");
  console.log("APP_ENV:", process.env.APP_ENV || "(미설정 = development로 취급)");
  console.log("대상 DB:", isProduction ? "PRODUCTION" : "DEVELOPMENT", "-", maskDbUrl(url));

  if (isProduction) {
    const confirmed = process.argv.includes("--production-confirm");
    if (!confirmed) {
      console.error(
        "❌ 거부: Production DB로 보이는데 --production-confirm 플래그가 없습니다.\n" +
          "   의도적으로 Production에 적용하려면 명시적으로 --production-confirm을 추가하세요.\n" +
          "   (이 작업(2A.1)은 artifact 생성만이 목적이며, Production 실행은 사용자 승인 후 별도 단계에서 수행한다.)",
      );
      process.exit(1);
    }
    console.log("⚠️ --production-confirm 확인됨 — Production에 적용합니다.");
  }

  const sqlPath = join(__dirname, "migrations", "20261005_rbac_foundation.sql");
  const sql = readFileSync(sqlPath, "utf8");
  console.log("SQL 파일:", sqlPath);

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(sql);
    console.log("✅ migration 실행 완료");

    const counts = await pool.query(
      `SELECT
        (SELECT count(*) FROM roles) AS roles,
        (SELECT count(*) FROM permissions) AS permissions,
        (SELECT count(*) FROM role_permissions) AS role_permissions,
        (SELECT count(*) FROM user_roles) AS user_roles`,
    );
    console.log("=== 적용 후 row count ===");
    console.log(counts.rows[0]);
    console.log("예상: roles=9, permissions=31, role_permissions=71 (user_roles는 실제 배정에 따라 달라질 수 있음 - 신규 환경이면 0)");
  } catch (err) {
    console.error("❌ migration 실행 실패:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
