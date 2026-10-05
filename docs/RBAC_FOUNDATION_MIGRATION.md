# RBAC Foundation Migration

작업명: MCC_RBAC_PHASE_2A_1_REPRODUCIBLE_MIGRATION_ARTIFACT_1
(기반 작업: MCC_RBAC_PHASE_2A_FOUNDATION_SCHEMA_AND_READONLY_RESOLVER_1)

## 무엇을 생성하는가

`scripts/migrations/20261005_rbac_foundation.sql` 하나로 아래 4개 테이블 + FK + index +
system seed를 처음부터 재현한다.

- `roles` (9 rows: OWNER, ADMIN, MIDDLE_MANAGER, ACTIVATION, AUDIT, SETTLEMENT, SALES,
  SALES_MANAGER, DEALER)
- `permissions` (31 rows)
- `role_permissions` (71 links)
- `user_roles` (0 rows — 실제 계정 배정은 이번 단계에서 하지 않음)

컬럼/인덱스/FK는 `shared/schema.ts`의 `roles`/`permissions`/`userRoles`/`rolePermissions`
정의와 정확히 일치한다(이 문서를 쓴 시점에 DEV DB의 `information_schema`/`pg_indexes`/
`pg_constraint`로 직접 대조 확인함).

## 기존 데이터에 영향 없음

이 migration은 **오직 CREATE TABLE / CREATE INDEX / ALTER TABLE ADD CONSTRAINT / INSERT**
로만 구성되어 있다. 기존 테이블(`admins`, `users`, `sales_managers`,
`dealer_registrations`, `documents`, `settlement_*`, `sidebar_menu_visibility`,
`training_*`, `contact_codes` 등 전체)에는 **DROP/ALTER/UPDATE/DELETE가 전혀 없다**.

또한 이 4개 테이블은 아직 어떤 route/middleware/프론트엔드에서도 참조되지 않는다 —
기존 로그인/Sidebar/API 권한 로직은 전혀 바뀌지 않는다(PHASE_2A와 동일한 원칙).

## DEV 적용 여부

**이미 DEV DB에 적용되어 있다** (PHASE_2A에서 트랜잭션으로 직접 적용, 이번 2A.1 작업에서
동일 SQL을 재실행해 idempotency를 재확인함 — row count 변화 없음, 중복 없음).

## Production 적용 여부

**아직 미적용.** 이 문서는 이번 2A.1 작업 시점까지 Production에 실행하지 않았다는 사실의
기록이다. 적용은 사용자 승인 후 별도 단계에서 진행한다.

## 적용 전 권장 사항

- DB backup 권장 (일반적인 스키마 변경 전 관례 — 이 migration 자체는 additive라서 데이터
  손실 위험은 없지만, 운영 DB에 무엇을 실행하기 전에는 항상 백업을 권장한다).
- `drizzle/` 디렉터리의 generate/journal 체계는 이미 desync 상태이므로(0004-0007 SQL
  파일이 journal에 없음, `drizzle-kit generate`를 실행하면 RBAC 외에도 과거 db:push로만
  적용되고 한 번도 generate되지 않은 무관한 기존 테이블/컬럼 변경이 대량으로 섞여 나옴)
  **이 migration을 `drizzle-kit migrate`로 실행하지 말 것.** 이 SQL 파일을 직접
  `psql`이나 아래 helper로 실행한다.

## 실행 명령

```bash
# DEV (기본값 — APP_ENV가 production이 아니면 DATABASE_URL_DEV 사용)
npx tsx --env-file=.env scripts/apply-rbac-foundation.ts

# 또는 순수 SQL로 직접 (DEV/Production 공통, psql이 연결할 DB를 직접 지정)
psql "$DATABASE_URL" -f scripts/migrations/20261005_rbac_foundation.sql
```

Production에 적용하려면 `scripts/apply-rbac-foundation.ts`가 `APP_ENV=production`일 때
`--production-confirm` 플래그 없이는 거부하도록 되어 있다 — 실수로 자동 적용되지 않는다.

```bash
# Production (명시적 opt-in 필요 — 사용자 승인 이후에만 실행)
APP_ENV=production npx tsx --env-file=.env.production scripts/apply-rbac-foundation.ts --production-confirm
```

## 검증 명령 / 예상 count

helper 스크립트가 실행 후 자동으로 아래를 출력한다.

```sql
SELECT
  (SELECT count(*) FROM roles) AS roles,
  (SELECT count(*) FROM permissions) AS permissions,
  (SELECT count(*) FROM role_permissions) AS role_permissions,
  (SELECT count(*) FROM user_roles) AS user_roles;
```

예상 결과(신규 환경 기준): `roles=9, permissions=31, role_permissions=71, user_roles=0`.
이미 같은 seed가 존재하는 환경(DEV 등)에서 재실행해도 `ON CONFLICT DO NOTHING`으로 같은
count가 그대로 유지된다(중복 생성 없음).

## Seed 내용을 바꿀 때 주의

`scripts/migrations/20261005_rbac_foundation.sql`의 role/permission/role_permissions
seed 목록은 `server/lib/rbac-seed.ts`의 `SEED_ROLES`/`SEED_PERMISSIONS`/
`ROLE_PERMISSION_MAP`과 **내용이 정확히 같아야 한다** — 이 둘은 지금 코드 레벨에서 자동
동기화되지 않는 두 개의 복제본이다. 한쪽을 바꾸면 반드시 다른 쪽도 같이 바꾸고, 바꾼 뒤
`npx tsx --env-file=.env scripts/seed-rbac.ts`(TS 경로)와
`npx tsx --env-file=.env scripts/apply-rbac-foundation.ts`(SQL 경로)를 각각 재실행해
결과 count가 서로 같은지 확인한다.

## Rollback 원칙

**자동 DROP TABLE rollback 스크립트는 만들지 않는다.** 이 4개 테이블은 아직 어디에도
enforcement로 연결되어 있지 않으므로, 되돌릴 필요가 생기면 아래를 사람이 직접 판단해서
수동으로 실행한다 (순서상 FK가 걸린 테이블부터):

```sql
-- 주의: 아래는 참고용 수동 절차이며 이 저장소에 자동 실행 스크립트로 포함하지 않는다.
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
```

실행 전 반드시: (1) 이 4개 테이블을 참조하는 코드가 정말 없는지 재확인, (2) 운영 중인
`user_roles`에 실제 계정 배정이 들어있다면 그 데이터가 사라져도 되는지 확인, (3) 가능하면
DROP 대신 백업만 해두고 테이블은 남겨두는 방안을 우선 검토한다.
