// scripts/seed-rbac.ts
//
// 작업명: MCC_RBAC_PHASE_2A_FOUNDATION_SCHEMA_AND_READONLY_RESOLVER_1
//
// roles/permissions/role_permissions system seed를 1회 적용한다.
// idempotent — 이미 있으면 건너뛴다(server/lib/rbac-seed.ts 참고).
//
// 실행: npx tsx --env-file=.env scripts/seed-rbac.ts

import { seedRbacFoundation } from "../server/lib/rbac-seed";

async function main() {
  const result = await seedRbacFoundation();
  console.log("=== RBAC seed 결과 ===");
  console.log("roles 신규:", result.rolesInserted.length ? result.rolesInserted.join(", ") : "(없음)");
  console.log("roles 기존(건너뜀):", result.rolesSkipped.length ? result.rolesSkipped.join(", ") : "(없음)");
  console.log("permissions 신규:", result.permissionsInserted.length ? result.permissionsInserted.join(", ") : "(없음)");
  console.log("permissions 기존(건너뜀):", result.permissionsSkipped.length ? result.permissionsSkipped.join(", ") : "(없음)");
  console.log("role_permissions 신규 링크:", result.rolePermissionLinksInserted);
  console.log("role_permissions 기존 링크(건너뜀):", result.rolePermissionLinksSkipped);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
