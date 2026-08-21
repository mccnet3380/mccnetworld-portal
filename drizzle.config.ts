// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

const dbUrl =
  process.env.DATABASE_URL_DEV ||
  process.env.DATABASE_URL;

if (!dbUrl) {
  throw new Error("DATABASE_URL_DEV 또는 DATABASE_URL 환경변수가 필요합니다.");
}

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: dbUrl },
});
