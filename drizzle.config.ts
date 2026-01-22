// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./shared/schema.ts", // ✅ 실제 존재하는 경로로 유지
  out: "./drizzle", // 폴더 이름은 바꿔도 됨
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
