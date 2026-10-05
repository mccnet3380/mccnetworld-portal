-- scripts/migrations/20261005_rbac_foundation.sql
--
-- 작업명: MCC_RBAC_PHASE_2A_1_REPRODUCIBLE_MIGRATION_ARTIFACT_1
--
-- RBAC foundation 전용 additive migration (roles / permissions / user_roles / role_permissions).
--
-- 이 파일 하나만으로 "RBAC 4개 테이블이 전혀 없는 DB"에서 PHASE 2A와 완전히 동일한 상태
-- (테이블 4개 + FK + index + system seed: roles 9 / permissions 31 / role_permissions 71 /
-- user_roles 0)를 재현할 수 있다.
--
-- 범위: 이 파일은 roles/permissions/user_roles/role_permissions 4개 테이블만 다룬다.
-- admins/users/sales_managers/dealer_registrations/documents/settlement*/
-- sidebar_menu_visibility/training*/contact_codes 등 기존 테이블은 전혀 건드리지 않는다
-- (DROP/ALTER/UPDATE/DELETE 없음, 전부 CREATE/INSERT뿐).
--
-- 멱등성: 전체를 몇 번 다시 실행해도 안전하다 — 테이블/index는 IF NOT EXISTS, FK는
-- pg_constraint 존재 여부를 확인하는 DO 블록, seed는 ON CONFLICT DO NOTHING.
--
-- 실행:
--   psql "$DATABASE_URL" -f scripts/migrations/20261005_rbac_foundation.sql
-- 또는 scripts/apply-rbac-foundation.ts 참고(실행 전 환경 표시 + 실행 후 count 검증 포함).
--
-- 주의: role_permissions의 seed 내용(어떤 role이 어떤 permission을 갖는지)은
-- server/lib/rbac-seed.ts의 ROLE_PERMISSION_MAP과 반드시 동일해야 한다. 한쪽을 바꾸면
-- 반드시 다른 쪽도 같이 바꾼다 — "서로 다른 두 개의 진실"이 생기면 안 된다
-- (docs/RBAC_FOUNDATION_MIGRATION.md 참고).

BEGIN;

-- =========================================================================
-- 1. 테이블
-- =========================================================================

CREATE TABLE IF NOT EXISTS "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);

-- principal_type + principal_id는 polymorphic 참조(admins/users/sales_managers/
-- dealer_registrations 4개 테이블 중 하나를 가리킴)이므로 의도적으로 DB FK를 걸지 않는다.
CREATE TABLE IF NOT EXISTS "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"principal_type" varchar(20) NOT NULL,
	"principal_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role_id" integer NOT NULL,
	"permission_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now()
);

-- =========================================================================
-- 2. Foreign key (shared/schema.ts의 .references()와 동일 — ON DELETE 지정 없음 = NO ACTION)
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_role_id_roles_id_fk'
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_role_id_roles_id_fk"
      FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'role_permissions_permission_id_permissions_id_fk'
  ) THEN
    ALTER TABLE "role_permissions"
      ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk"
      FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_id_roles_id_fk'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_role_id_roles_id_fk"
      FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;

-- =========================================================================
-- 3. Index
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_uidx" ON "roles" USING btree ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_code_uidx" ON "permissions" USING btree ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_principal_role_uidx" ON "user_roles" USING btree ("principal_type","principal_id","role_id");
CREATE INDEX IF NOT EXISTS "user_roles_principal_idx" ON "user_roles" USING btree ("principal_type","principal_id");
CREATE INDEX IF NOT EXISTS "user_roles_role_id_idx" ON "user_roles" USING btree ("role_id");
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_permission_uidx" ON "role_permissions" USING btree ("role_id","permission_id");
CREATE INDEX IF NOT EXISTS "role_permissions_role_id_idx" ON "role_permissions" USING btree ("role_id");
CREATE INDEX IF NOT EXISTS "role_permissions_permission_id_idx" ON "role_permissions" USING btree ("permission_id");

-- =========================================================================
-- 4. System seed — roles (9) — server/lib/rbac-seed.ts SEED_ROLES와 동일해야 함
-- =========================================================================

INSERT INTO "roles" ("code", "name", "description", "is_system") VALUES
  ('OWNER', '소유자', '모든 permission을 가진 최상위 역할(RBAC 거버넌스 포함)', true),
  ('ADMIN', '관리자', '일상 운영 관리 permission 전체(ROLE_READ/ROLE_MANAGE 제외)', true),
  ('MIDDLE_MANAGER', '중간관리자', 'activation-audit/sheet-viewer 서버 가드가 실제로 확인하는 역할', true),
  ('ACTIVATION', '개통 담당', '개통 업무 전용 역할(현재 미배정, 향후 세분화용)', true),
  ('AUDIT', '검수 담당', '검수 업무 전용 역할(현재 미배정, 향후 세분화용)', true),
  ('SETTLEMENT', '정산 담당', '정산 업무 전용 역할(현재 미배정, 향후 세분화용)', true),
  ('SALES', '영업', '영업 업무 역할 — 현재 대응되는 기능이 불명확하여 permission 미부여', true),
  ('SALES_MANAGER', '영업과장', 'sales_manager 로그인이 현재 구조적으로 막혀있어(authenticateSalesManager 항상 null) permission 미부여', true),
  ('DEALER', '판매점', 'dealer 계정 역할(현재 principal 매핑은 USER로 canonical화 — server/lib/rbac.ts 참고)', true)
ON CONFLICT ("code") DO NOTHING;

-- =========================================================================
-- 5. System seed — permissions (31) — server/lib/rbac-seed.ts SEED_PERMISSIONS와 동일해야 함
-- =========================================================================

INSERT INTO "permissions" ("code", "name", "description") VALUES
  ('DOCUMENT_READ', '접수 문서 조회', 'Documents.tsx / GET /api/documents'),
  ('DOCUMENT_CREATE', '접수 문서 생성', 'SubmitApplication.tsx,OtherApplication.tsx / POST /api/documents'),
  ('DOCUMENT_UPDATE', '접수 문서 수정', 'PUT /api/documents/:id'),
  ('DOCUMENT_COMPLETE', '접수 문서 완료 처리', 'PATCH /api/documents/:id/status (완료 상태)'),
  ('DOCUMENT_CANCEL', '접수 문서 취소/폐기 처리', 'PATCH /api/documents/:id/status (취소/폐기 상태)'),
  ('ACTIVATION_READ', '개통 기록 조회', 'activation_records 조회'),
  ('ACTIVATION_PROCESS', '개통 처리', '개통 등록/처리 작업'),
  ('AUDIT_READ', '개통현황 검수 조회', 'server/routes/activation-audit.ts GET 엔드포인트'),
  ('AUDIT_PROCESS', '개통현황 검수 처리', 'server/routes/activation-audit.ts POST /memi-refresh'),
  ('PERFORMANCE_SELF_READ', '본인 실적 조회', 'PersonalPerformance.tsx'),
  ('PERFORMANCE_ALL_READ', '전체 근무자 실적 조회', 'WorkerPerformanceOverview.tsx(admin 전용)'),
  ('TRAINING_READ', '교육자료 조회', 'TrainingCenter.tsx'),
  ('TRAINING_MANAGE', '교육자료 관리', 'training_articles 작성/수정'),
  ('TYPING_READ', '타이핑 시트 조회', 'TypingVersions.tsx / server/routes/sheet-viewer.ts'),
  ('TYPING_MANAGE', '타이핑 시트 관리', '타이핑 버전 관리'),
  ('SETTLEMENT_READ', '정산 결과 조회', '/settlement/results'),
  ('SETTLEMENT_EDIT', '정산 결과 편집', 'settlement_items 수정'),
  ('SETTLEMENT_POLICY_READ', '정산 정책 조회', '/settlement/policies'),
  ('SETTLEMENT_POLICY_EDIT', '정산 정책 편집', 'policy_versions/policy_rows 수정'),
  ('USER_READ', '계정 조회', 'AdminPanel 사용자 관리 탭 조회'),
  ('USER_MANAGE', '계정 관리', 'AdminPanel 사용자 생성/수정'),
  ('TEAM_READ', '영업팀 조회', 'SalesTeamManagement.tsx 조회'),
  ('TEAM_MANAGE', '영업팀 관리', 'sales_teams 생성/수정'),
  ('DEALER_READ', '판매점 조회', 'dealer_registrations 조회'),
  ('DEALER_MANAGE', '판매점 관리', 'dealer_registrations 생성/수정/승인'),
  ('CONTACT_CODE_READ', '접점코드 조회', 'contact_codes 조회'),
  ('CONTACT_CODE_EDIT', '접점코드 편집', 'contact_codes 생성/수정'),
  ('ROLE_READ', '역할/권한 조회', 'RBAC roles/permissions 조회(resolver)'),
  ('ROLE_MANAGE', '역할/권한 관리', 'RBAC role_permissions/user_roles 변경(OWNER 전용 거버넌스)'),
  ('MENU_PERMISSION_READ', '메뉴 표시설정 조회', 'sidebar_menu_visibility 조회(getSidebarMenuVisibility)'),
  ('MENU_PERMISSION_MANAGE', '메뉴 표시설정 관리', 'sidebar_menu_visibility 변경(upsertSidebarMenuVisibility)')
ON CONFLICT ("code") DO NOTHING;

-- =========================================================================
-- 6. System seed — role_permissions (71 links) — server/lib/rbac-seed.ts
--    ROLE_PERMISSION_MAP과 반드시 동일해야 함. role_id/permission_id는 하드코딩하지 않고
--    roles.code / permissions.code로 조회해서 넣는다.
-- =========================================================================

-- OWNER: 전체 31개
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.code = 'OWNER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- ADMIN: 전체 - ROLE_READ/ROLE_MANAGE (29개)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.code = 'ADMIN' AND p.code NOT IN ('ROLE_READ', 'ROLE_MANAGE')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- MIDDLE_MANAGER: AUDIT_READ, AUDIT_PROCESS, TYPING_READ (3개)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p
  ON p.code IN ('AUDIT_READ', 'AUDIT_PROCESS', 'TYPING_READ')
WHERE r.code = 'MIDDLE_MANAGER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- ACTIVATION: ACTIVATION_READ, ACTIVATION_PROCESS (2개)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p
  ON p.code IN ('ACTIVATION_READ', 'ACTIVATION_PROCESS')
WHERE r.code = 'ACTIVATION'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- AUDIT: AUDIT_READ, AUDIT_PROCESS (2개)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p
  ON p.code IN ('AUDIT_READ', 'AUDIT_PROCESS')
WHERE r.code = 'AUDIT'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- SETTLEMENT: SETTLEMENT_READ, SETTLEMENT_EDIT (2개)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p
  ON p.code IN ('SETTLEMENT_READ', 'SETTLEMENT_EDIT')
WHERE r.code = 'SETTLEMENT'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- SALES: 의도적으로 비워둠(대응 기능 불명확 — server/lib/rbac-seed.ts 주석 참고)
-- SALES_MANAGER: 의도적으로 비워둠(로그인 구조적으로 막혀있어 범위 검증 불가)

-- DEALER: DOCUMENT_READ, DOCUMENT_CREATE (2개)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p
  ON p.code IN ('DOCUMENT_READ', 'DOCUMENT_CREATE')
WHERE r.code = 'DEALER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

COMMIT;
