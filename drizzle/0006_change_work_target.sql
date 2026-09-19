-- MCC_PERSONAL_PERFORMANCE_MULTI_KPI_HISTORICAL_ENGINE_FIX_4
-- 수기 작성 마이그레이션 (project rule: 운영 DB는 db:push 금지, 별도 SQL 파일로 반영).
-- 적용 전 운영 DB 백업 먼저 진행할 것. 아직 운영 DB에는 적용하지 않는다(로컬 작성만).
--
-- 개통 업무 목표(target_contribution_rate)와 변경 업무 목표는 서로 다른 독립 KPI다.
-- 하나의 컬럼에 두 값을 억지로 합치지 않고, 변경 목표 전용 컬럼을 추가한다.
-- target_contribution_rate의 기존 NOT NULL 제약도 완화한다 — 이제 개통/변경 목표를
-- 각각 독립적으로(한쪽만) 설정할 수 있어야 하기 때문이다. 완화는 데이터 손실이 없는
-- additive 변경이며, 기존에 저장된 값(예: 42.5)은 전혀 건드리지 않는다.

ALTER TABLE "worker_performance_targets" ALTER COLUMN "target_contribution_rate" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "worker_performance_targets" ADD COLUMN IF NOT EXISTS "change_target_rate" numeric(5, 2);
