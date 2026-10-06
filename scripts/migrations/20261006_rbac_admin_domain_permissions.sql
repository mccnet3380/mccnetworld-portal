-- scripts/migrations/20261006_rbac_admin_domain_permissions.sql
--
-- 작업명: MCC_RBAC_PHASE_2C_2B_ADMIN_API_PERMISSION_ENFORCEMENT_1
--
-- CARRIER_MANAGE / SERVICE_PLAN_MANAGE 2개 permission만 추가하는 순수 additive migration.
-- roles/user_roles 테이블은 전혀 건드리지 않고, permissions에 2행을 추가하고
-- role_permissions에 OWNER/ADMIN 연결만 추가한다. 기존 행은 전혀 삭제/수정하지 않는다.
--
-- 이 파일 하나만으로 20261005_rbac_foundation.sql이 이미 적용된 DB에서 PHASE 2C-2B와
-- 동일한 상태(permissions 31→33, OWNER role_permissions 31→33, ADMIN role_permissions
-- 27→29)를 재현할 수 있다.
--
-- 멱등성: ON CONFLICT DO NOTHING만 사용하므로 몇 번 다시 실행해도 안전하다.
--
-- 실행:
--   psql "$DATABASE_URL" -f scripts/migrations/20261006_rbac_admin_domain_permissions.sql
--
-- 주의: role_permissions의 seed 내용은 server/lib/rbac-seed.ts의 ROLE_PERMISSION_MAP과
-- 반드시 동일해야 한다(docs/RBAC_FOUNDATION_MIGRATION.md 참고). OWNER는 CROSS JOIN으로
-- "모든 permission"을 받으므로, 신규 permission을 추가하면 자동으로 OWNER에 연결된다 —
-- 20261005 migration과 동일한 패턴. ADMIN도 "OWNER 전용 4개를 제외한 전체"이므로 자동으로
-- 연결된다(신규 2개는 OWNER 전용 목록에 없음).

BEGIN;

-- =========================================================================
-- 1. System seed — 신규 permissions (2) — server/lib/rbac-seed.ts SEED_PERMISSIONS와 동일해야 함
-- =========================================================================

INSERT INTO "permissions" ("code", "name", "description") VALUES
  ('CARRIER_MANAGE', '통신사 관리', 'carriers/other_business_carriers CRUD(관리자 UI 전용, 조회 포함)'),
  ('SERVICE_PLAN_MANAGE', '요금제/부가서비스 관리', 'service_plans/additional_services CRUD(관리자 UI 전용, 조회 포함)')
ON CONFLICT ("code") DO NOTHING;

-- =========================================================================
-- 2. role_permissions — OWNER는 전체 permission을 받으므로 신규 2개도 자동 포함
-- =========================================================================

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.code = 'OWNER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- =========================================================================
-- 3. role_permissions — ADMIN은 "OWNER 전용 4개를 제외한 전체"이므로 신규 2개도 자동 포함
-- =========================================================================

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
WHERE r.code = 'ADMIN'
  AND p.code NOT IN ('ROLE_READ', 'ROLE_MANAGE', 'MENU_PERMISSION_READ', 'MENU_PERMISSION_MANAGE')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

COMMIT;
