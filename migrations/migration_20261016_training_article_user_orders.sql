-- ============================================================
-- migration_20261016_training_article_user_orders.sql
-- MCC_TRAINING_PERSONAL_ORDER_AND_ATTACHMENT_UPLOAD_FIX_1
--
-- 로그인 principal별 교육자료 "개인 순서" 저장용 신규 테이블 1개 추가.
-- 기존 training_articles / training_attachments 테이블은 전혀 건드리지 않는다.
-- 관리자 공통 노출순서(training_articles.sort_order)는 그대로 GLOBAL DEFAULT로 유지되고,
-- 이 테이블은 "그 사람 로그인 기준 개인 순서"만 별도로 저장한다.
--
-- 실행 방법 (로컬/DEV만 — Production 적용은 이번 작업 범위 아님, 별도 승인 필요):
--   psql "$DATABASE_URL_DEV" -f migrations/migration_20261016_training_article_user_orders.sql
--
-- 주의:
--   - 신규 테이블만 추가(CREATE TABLE IF NOT EXISTS) — 기존 테이블 destructive 변경 없음
--   - 재실행해도 안전(idempotent)
--   - principal_type/principal_id는 user_roles/user_permission_overrides와 동일한
--     polymorphic principal 구조('ADMIN' | 'USER' | 'SALES_MANAGER' | 'DEALER', DB FK 없음)
--   - (principal_type, principal_id, article_id) UNIQUE — 같은 사람이 같은 article에
--     순서를 두 번 갖지 않는다
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS training_article_user_orders (
  id serial PRIMARY KEY,
  principal_type varchar(20) NOT NULL,
  principal_id integer NOT NULL,
  article_id integer NOT NULL REFERENCES training_articles(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS training_article_user_orders_principal_article_uidx
  ON training_article_user_orders (principal_type, principal_id, article_id);

CREATE INDEX IF NOT EXISTS training_article_user_orders_principal_idx
  ON training_article_user_orders (principal_type, principal_id);

COMMIT;
