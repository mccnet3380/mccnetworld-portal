-- scripts/migrations/20261006_user_permission_overrides.sql
--
-- 작업명: MCC_RBAC_PHASE_2E_2_USER_PERMISSION_OVERRIDE_FOUNDATION_1
--
-- 개인 사용자별 permission 예외(ALLOW/DENY)를 위한 신규 테이블 하나만 추가하는 순수
-- additive migration. 기존 roles/permissions/user_roles/role_permissions 테이블은
-- 전혀 건드리지 않는다(행 삭제/수정 없음, 스키마 변경 없음).
--
-- 범위: user_permission_overrides 테이블 1개만 생성한다. 관리 API/UI는 이 migration의
-- 대상이 아니다(2E-3 이후) — 이 테이블은 생성 직후 0행이며, 이 migration 자체가 실제
-- override 행을 삽입하지 않는다.
--
-- 멱등성: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / 제약 존재 여부를
-- DO 블록으로 확인 후 추가 — 몇 번을 다시 실행해도 안전하다(기존 20261005/20261006
-- RBAC migration 파일들과 동일한 패턴).
--
-- 실행:
--   psql "$DATABASE_URL" -f scripts/migrations/20261006_user_permission_overrides.sql
--
-- 주의: 이 테이블은 server/lib/rbac.ts의 getPrincipalPermissions()에서만 읍힌다.
-- getPrincipalRoles()는 이 테이블을 전혀 조회하지 않는다 — override 존재가 "role이
-- 있는 principal"로 오해되면 안 된다(NO_ROLE→LEGACY 불변조건, 코드 주석 참고).

BEGIN;

-- =========================================================================
-- 1. 테이블
-- =========================================================================

CREATE TABLE IF NOT EXISTS "user_permission_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" varchar(20) NOT NULL,
	"principal_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	"effect" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by_admin_id" integer
);

-- =========================================================================
-- 2. Foreign key (shared/schema.ts의 .references()와 동일 — ON DELETE 지정 없음 = NO ACTION)
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_permission_overrides_permission_id_permissions_id_fk'
  ) THEN
    ALTER TABLE "user_permission_overrides"
      ADD CONSTRAINT "user_permission_overrides_permission_id_permissions_id_fk"
      FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_permission_overrides_created_by_admin_id_admins_id_fk'
  ) THEN
    ALTER TABLE "user_permission_overrides"
      ADD CONSTRAINT "user_permission_overrides_created_by_admin_id_admins_id_fk"
      FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

-- =========================================================================
-- 3. CHECK 제약 — effect는 'ALLOW' 또는 'DENY'만 허용(이 repo의 다른 RBAC 테이블과
--    동일하게 pg native enum 대신 varchar + CHECK 사용)
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_permission_overrides_effect_check'
  ) THEN
    ALTER TABLE "user_permission_overrides"
      ADD CONSTRAINT "user_permission_overrides_effect_check"
      CHECK ("effect" IN ('ALLOW', 'DENY'));
  END IF;
END $$;

-- =========================================================================
-- 4. Index — 동일 principal+permission에 ALLOW/DENY가 동시에 존재할 수 없도록 unique
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "user_permission_overrides_principal_permission_uidx"
  ON "user_permission_overrides" USING btree ("principal_type", "principal_id", "permission_id");
CREATE INDEX IF NOT EXISTS "user_permission_overrides_principal_idx"
  ON "user_permission_overrides" USING btree ("principal_type", "principal_id");
CREATE INDEX IF NOT EXISTS "user_permission_overrides_permission_id_idx"
  ON "user_permission_overrides" USING btree ("permission_id");

COMMIT;
