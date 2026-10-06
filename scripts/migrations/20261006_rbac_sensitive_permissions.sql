-- scripts/migrations/20261006_rbac_sensitive_permissions.sql
--
-- 작업명: MCC_RBAC_PHASE_2C_2C_OWNER_AND_SETTLEMENT_SENSITIVE_PERMISSION_CLEANUP_1
--
-- SETTLEMENT_PRICING_MANAGE / HIDDEN_POLICY_MANAGE 2개 permission만 추가하는 순수
-- additive migration. roles/user_roles 테이블은 전혀 건드리지 않고, permissions에
-- 2행을 추가하고 role_permissions에 OWNER/ADMIN 연결만 추가한다. 기존 행은 전혀
-- 삭제/수정하지 않는다.
--
-- 이 파일 하나만으로 20261005_rbac_foundation.sql + 20261006_rbac_admin_domain_permissions.sql
-- 이 이미 적용된 DB에서 PHASE 2C-2C와 동일한 상태(permissions 33→35, OWNER role_permissions
-- 33→35, ADMIN role_permissions 29→31)를 재현할 수 있다.
--
-- 멱등성: ON CONFLICT DO NOTHING만 사용하므로 몇 번 다시 실행해도 안전하다.
--
-- 실행:
--   psql "$DATABASE_URL" -f scripts/migrations/20261006_rbac_sensitive_permissions.sql
--
-- 주의: role_permissions의 seed 내용은 server/lib/rbac-seed.ts의 ROLE_PERMISSION_MAP과
-- 반드시 동일해야 한다. OWNER는 CROSS JOIN으로 "모든 permission"을 받으므로, 신규
-- permission을 추가하면 자동으로 OWNER에 연결된다. ADMIN도 "OWNER 전용 4개를 제외한
-- 전체"이므로 자동으로 연결된다(신규 2개는 OWNER 전용 목록에 없음) — 20261006_rbac_admin_
-- domain_permissions.sql과 동일한 패턴.

BEGIN;

-- =========================================================================
-- 1. System seed — 신규 permissions (2) — server/lib/rbac-seed.ts SEED_PERMISSIONS와 동일해야 함
-- =========================================================================

INSERT INTO "permissions" ("code", "name", "description") VALUES
  ('SETTLEMENT_PRICING_MANAGE', '정산 단가 관리', 'settlement_unit_prices CRUD + 엑셀 업로드(관리자 UI 전용, 조회 포함)'),
  ('HIDDEN_POLICY_MANAGE', '히든 정책/금액 관리', 'hidden_policy_rows CRUD + 히든금액 재계산/진단(관리자 UI 전용, 조회 포함)')
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
