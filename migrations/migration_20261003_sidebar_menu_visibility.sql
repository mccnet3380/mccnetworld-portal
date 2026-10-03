-- ============================================================
-- migration_20261003_sidebar_menu_visibility.sql
-- MCC_SIDEBAR_MENU_VISIBILITY_ADMIN_CONTROL_1
--
-- 사이드바 메뉴 "표시/숨김" 설정 전용 신규 테이블 1개 추가. 기존 테이블/권한/ROLE
-- 로직은 전혀 건드리지 않는다 — 이 테이블은 UI 표시 제어 값만 저장한다.
--
-- 실행 방법 (로컬/DEV만 — Production 적용은 이번 작업 범위 아님, 별도 승인 필요):
--   psql "$DATABASE_URL_DEV" -f migrations/migration_20261003_sidebar_menu_visibility.sql
--
-- 주의:
--   - 신규 테이블만 추가(CREATE TABLE IF NOT EXISTS) — 기존 테이블 destructive 변경 없음
--   - 재실행해도 안전(idempotent)
--   - menu_key는 화면 표시 문자열이 아니라 안정적인 내부 식별자(server/routes.ts의
--     SIDEBAR_MENU_KEYS와 1:1 대응)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS sidebar_menu_visibility (
  menu_key varchar(50) PRIMARY KEY,
  admin_visible boolean NOT NULL DEFAULT true,
  worker_visible boolean NOT NULL DEFAULT true,
  updated_at timestamp DEFAULT now()
);

COMMIT;
