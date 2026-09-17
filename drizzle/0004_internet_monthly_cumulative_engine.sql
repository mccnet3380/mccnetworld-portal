-- MCC_INTERNET_MONTHLY_CUMULATIVE_ENGINE_IMPLEMENT_1
-- (최종 구조로 MCC_INTERNET_LEGACY_CUMULATIVE_CLEANUP_1에서 정리 — 아직 운영 DB에
-- 한 번도 적용된 적 없는 migration이라 새 구조로 직접 다시 작성함. baseline 테이블과
-- previous_cumulative 컬럼은 최종 설계에서 빠졌으므로 포함하지 않는다.)
-- 수기 작성 마이그레이션 (project rule: 운영 DB는 db:push 금지, 별도 SQL 파일로 반영).
-- 적용 전 운영 DB 백업 먼저 진행할 것.

CREATE TABLE IF NOT EXISTS "internet_daily_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"year_month" varchar(7) NOT NULL,
	"category" varchar(20) NOT NULL,
	"received" integer NOT NULL,
	"daily" integer NOT NULL,
	"waiting" integer NOT NULL,
	"cumulative" integer NOT NULL,
	"closed_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internet_daily_closings_date_category_uq" ON "internet_daily_closings" ("date","category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "internet_daily_closings_year_month_idx" ON "internet_daily_closings" ("year_month","category");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "internet_worker_daily_closings" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"worker" varchar(100) NOT NULL,
	"request_point" varchar(50) NOT NULL,
	"category" varchar(20) NOT NULL,
	"count" integer NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "internet_worker_daily_closings_uq" ON "internet_worker_daily_closings" ("date","worker","request_point");
