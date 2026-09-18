-- MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1
-- 수기 작성 마이그레이션 (project rule: 운영 DB는 db:push 금지, 별도 SQL 파일로 반영).
-- 적용 전 운영 DB 백업 먼저 진행할 것. 아직 운영 DB에는 적용하지 않는다(로컬 작성만).

-- 1) users에 실적 작업자 mapping 필드 추가 (nullable — 매핑 없으면 NULL, 이름 추측 매칭 없음)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "performance_worker_name" varchar(100);
--> statement-breakpoint

-- 2) 근무자 월별 목표 기여도(%) 테이블. 건수 목표가 아니라 소속망 공식 총실적 대비
--    목표 기여도(%)를 저장한다. worker mapping은 users.performance_worker_name(사용자 단위,
--    월 복사 없음)이고, 이 테이블은 targetContributionRate만 매월 별도 관리한다.
CREATE TABLE IF NOT EXISTS "worker_performance_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"target_contribution_rate" numeric(5, 2) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "worker_performance_targets_user_year_month_uq" ON "worker_performance_targets" ("user_id","year","month");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "worker_performance_targets" ADD CONSTRAINT "worker_performance_targets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
