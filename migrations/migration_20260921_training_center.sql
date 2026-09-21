-- ============================================================
-- migration_20260921_training_center.sql
-- MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1
--
-- 교육자료(사내 교육센터) 신규 테이블 2개 추가. 기존 테이블은 전혀 건드리지 않는다.
--
-- 실행 방법 (로컬):
--   $env:DATABASE_URL = (Select-String -Path ".env" -Pattern "^DATABASE_URL=").Line -replace "^DATABASE_URL=", ""
--   psql "$env:DATABASE_URL" -f ".\migrations\migration_20260921_training_center.sql"
--
-- 실행 방법 (운영):
--   psql "$DATABASE_URL" -f migration_20260921_training_center.sql
--
-- 주의:
--   - 신규 테이블만 추가(CREATE TABLE IF NOT EXISTS) — 기존 테이블 destructive 변경 없음
--   - 재실행해도 안전(idempotent)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS training_articles (
  id serial PRIMARY KEY,
  title varchar(200) NOT NULL,
  summary varchar(500),
  category varchar(10) NOT NULL,
  content text NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'DRAFT',
  is_pinned boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by integer,
  updated_by integer,
  deleted_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_attachments (
  id serial PRIMARY KEY,
  article_id integer NOT NULL REFERENCES training_articles(id) ON DELETE CASCADE,
  original_name varchar(255) NOT NULL,
  stored_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  file_size integer NOT NULL,
  file_path varchar(500) NOT NULL,
  attachment_type varchar(10) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_articles_category_status_idx
  ON training_articles (category, status);

CREATE INDEX IF NOT EXISTS training_attachments_article_id_idx
  ON training_attachments (article_id);

COMMIT;
