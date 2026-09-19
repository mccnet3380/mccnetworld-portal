-- MCC_PERFORMANCE_WORKER_LIFECYCLE_AND_ROSTER_FIX_1
-- 수기 작성 마이그레이션 (project rule: 운영 DB는 db:push 금지, 별도 SQL 파일로 반영).
-- 적용 전 운영 DB 백업 먼저 진행할 것. 아직 운영 DB에는 적용하지 않는다(로컬 작성만).
--
-- users에 근무자 생애주기(입사일/퇴사일) 필드를 추가한다. 조사 결과 기존 스키마에는
-- 이 개념이 전혀 없었다("근무자 관리" 탭은 100% 정적 데모, 실제 DB 연결 없음) — 새로
-- 추측 구조를 만드는 대신 users 테이블(이미 performanceWorkerName이 있는 곳)에 최소
-- 컬럼만 추가한다. NULL 허용 — 기존 계정(예: 김광섭)은 두 값 다 NULL로 시작하며,
-- NULL hire_date는 "언제부터인지 모름(과거 전체 재직으로 간주, 하한 없음)"으로,
-- NULL termination_date는 "재직 중"으로 취급한다(코드에서 그렇게 해석 — 기존 계정 회귀 없음).
-- 날짜는 다른 곳(internet_daily_closings.date 등)과 동일하게 "YYYY-MM-DD" 문자열로 저장한다.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hire_date" varchar(10);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "termination_date" varchar(10);
