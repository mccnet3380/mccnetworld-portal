// server/lib/rbac-seed.ts
//
// 작업명: MCC_RBAC_PHASE_2A_FOUNDATION_SCHEMA_AND_READONLY_RESOLVER_1
//
// roles/permissions/role_permissions 초기 system seed. 이번 단계에서는 아직 어디에도
// enforcement되지 않으므로 운영 영향이 없다 — 추후 실제 enforcement에 쓰일 데이터이므로
// 과도한 permission 부여를 피하고, 코드로 확인된 기능에 한해서만 role_permissions를 채운다.
//
// idempotent — code UNIQUE 기준 onConflictDoNothing. 여러 번 실행해도 중복 row가 생기지 않는다.
//
// 실행: npx tsx --env-file=.env scripts/seed-rbac.ts

import { eq, inArray } from "drizzle-orm";
import { getDatabase } from "../db";
import { roles, permissions, rolePermissions } from "../../shared/schema";

export const SYSTEM_ROLE_CODES = [
  "OWNER",
  "ADMIN",
  "MIDDLE_MANAGER",
  "ACTIVATION",
  "AUDIT",
  "SETTLEMENT",
  "SALES",
  "SALES_MANAGER",
  "DEALER",
] as const;

interface SeedRole {
  code: string;
  name: string;
  description: string;
}

const SEED_ROLES: SeedRole[] = [
  { code: "OWNER", name: "소유자", description: "모든 permission을 가진 최상위 역할(RBAC 거버넌스 포함)" },
  { code: "ADMIN", name: "관리자", description: "일상 운영 관리 permission 전체(ROLE_READ/ROLE_MANAGE 제외)" },
  { code: "MIDDLE_MANAGER", name: "중간관리자", description: "activation-audit/sheet-viewer 서버 가드가 실제로 확인하는 역할" },
  { code: "ACTIVATION", name: "개통 담당", description: "개통 업무 전용 역할(현재 미배정, 향후 세분화용)" },
  { code: "AUDIT", name: "검수 담당", description: "검수 업무 전용 역할(현재 미배정, 향후 세분화용)" },
  { code: "SETTLEMENT", name: "정산 담당", description: "정산 업무 전용 역할(현재 미배정, 향후 세분화용)" },
  { code: "SALES", name: "영업", description: "영업 업무 역할 — 현재 대응되는 기능이 불명확하여 permission 미부여" },
  { code: "SALES_MANAGER", name: "영업과장", description: "sales_manager 로그인이 현재 구조적으로 막혀있어(authenticateSalesManager 항상 null) permission 미부여" },
  { code: "DEALER", name: "판매점", description: "dealer 계정 역할(현재 principal 매핑은 USER로 canonical화 — server/lib/rbac.ts 참고)" },
];

interface SeedPermission {
  code: string;
  name: string;
  description: string;
}

// [비워둠] NOTICE_READ/NOTICE_MANAGE: 코드 감사 결과 전용 공지 CRUD 기능을 찾지 못해 제외했다
// (일부 페이지에 "공지" 텍스트만 존재, 별도 관리 기능 없음). 필요하면 추후 기능 확인 후 추가.
const SEED_PERMISSIONS: SeedPermission[] = [
  { code: "DOCUMENT_READ", name: "접수 문서 조회", description: "Documents.tsx / GET /api/documents" },
  { code: "DOCUMENT_CREATE", name: "접수 문서 생성", description: "SubmitApplication.tsx,OtherApplication.tsx / POST /api/documents" },
  { code: "DOCUMENT_UPDATE", name: "접수 문서 수정", description: "PUT /api/documents/:id" },
  { code: "DOCUMENT_COMPLETE", name: "접수 문서 완료 처리", description: "PATCH /api/documents/:id/status (완료 상태)" },
  { code: "DOCUMENT_CANCEL", name: "접수 문서 취소/폐기 처리", description: "PATCH /api/documents/:id/status (취소/폐기 상태)" },
  { code: "ACTIVATION_READ", name: "개통 기록 조회", description: "activation_records 조회" },
  { code: "ACTIVATION_PROCESS", name: "개통 처리", description: "개통 등록/처리 작업" },
  { code: "AUDIT_READ", name: "개통현황 검수 조회", description: "server/routes/activation-audit.ts GET 엔드포인트" },
  { code: "AUDIT_PROCESS", name: "개통현황 검수 처리", description: "server/routes/activation-audit.ts POST /memi-refresh" },
  { code: "PERFORMANCE_SELF_READ", name: "본인 실적 조회", description: "PersonalPerformance.tsx" },
  { code: "PERFORMANCE_ALL_READ", name: "전체 근무자 실적 조회", description: "WorkerPerformanceOverview.tsx(admin 전용)" },
  { code: "TRAINING_READ", name: "교육자료 조회", description: "TrainingCenter.tsx" },
  { code: "TRAINING_MANAGE", name: "교육자료 관리", description: "training_articles 작성/수정" },
  { code: "TYPING_READ", name: "타이핑 시트 조회", description: "TypingVersions.tsx / server/routes/sheet-viewer.ts" },
  { code: "TYPING_MANAGE", name: "타이핑 시트 관리", description: "타이핑 버전 관리" },
  { code: "SETTLEMENT_READ", name: "정산 결과 조회", description: "/settlement/results" },
  { code: "SETTLEMENT_EDIT", name: "정산 결과 편집", description: "settlement_items 수정" },
  { code: "SETTLEMENT_POLICY_READ", name: "정산 정책 조회", description: "/settlement/policies" },
  { code: "SETTLEMENT_POLICY_EDIT", name: "정산 정책 편집", description: "policy_versions/policy_rows 수정" },
  { code: "USER_READ", name: "계정 조회", description: "AdminPanel 사용자 관리 탭 조회" },
  { code: "USER_MANAGE", name: "계정 관리", description: "AdminPanel 사용자 생성/수정" },
  { code: "TEAM_READ", name: "영업팀 조회", description: "SalesTeamManagement.tsx 조회" },
  { code: "TEAM_MANAGE", name: "영업팀 관리", description: "sales_teams 생성/수정" },
  { code: "DEALER_READ", name: "판매점 조회", description: "dealer_registrations 조회" },
  { code: "DEALER_MANAGE", name: "판매점 관리", description: "dealer_registrations 생성/수정/승인" },
  { code: "CONTACT_CODE_READ", name: "접점코드 조회", description: "contact_codes 조회" },
  { code: "CONTACT_CODE_EDIT", name: "접점코드 편집", description: "contact_codes 생성/수정" },
  { code: "ROLE_READ", name: "역할/권한 조회", description: "RBAC roles/permissions 조회(이 작업에서 생성한 resolver)" },
  { code: "ROLE_MANAGE", name: "역할/권한 관리", description: "RBAC role_permissions/user_roles 변경(OWNER 전용 거버넌스)" },
  { code: "MENU_PERMISSION_READ", name: "메뉴 표시설정 조회", description: "sidebar_menu_visibility 조회(getSidebarMenuVisibility)" },
  { code: "MENU_PERMISSION_MANAGE", name: "메뉴 표시설정 관리", description: "sidebar_menu_visibility 변경(upsertSidebarMenuVisibility)" },
];

// role → permission code 매핑. 애매한 역할(SALES, SALES_MANAGER)은 의도적으로 빈 배열.
const ALL_PERMISSION_CODES = SEED_PERMISSIONS.map((p) => p.code);
const ADMIN_PERMISSION_CODES = ALL_PERMISSION_CODES.filter(
  (c) => c !== "ROLE_READ" && c !== "ROLE_MANAGE",
);

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  OWNER: ALL_PERMISSION_CODES,
  ADMIN: ADMIN_PERMISSION_CODES,
  MIDDLE_MANAGER: ["AUDIT_READ", "AUDIT_PROCESS", "TYPING_READ"],
  ACTIVATION: ["ACTIVATION_READ", "ACTIVATION_PROCESS"],
  AUDIT: ["AUDIT_READ", "AUDIT_PROCESS"],
  SETTLEMENT: ["SETTLEMENT_READ", "SETTLEMENT_EDIT"],
  SALES: [],
  SALES_MANAGER: [],
  DEALER: ["DOCUMENT_READ", "DOCUMENT_CREATE"],
};

export interface RbacSeedResult {
  rolesInserted: string[];
  rolesSkipped: string[];
  permissionsInserted: string[];
  permissionsSkipped: string[];
  rolePermissionLinksInserted: number;
  rolePermissionLinksSkipped: number;
}

export async function seedRbacFoundation(): Promise<RbacSeedResult> {
  const db = await getDatabase();
  const result: RbacSeedResult = {
    rolesInserted: [],
    rolesSkipped: [],
    permissionsInserted: [],
    permissionsSkipped: [],
    rolePermissionLinksInserted: 0,
    rolePermissionLinksSkipped: 0,
  };

  for (const r of SEED_ROLES) {
    const existing = await db.select().from(roles).where(eq(roles.code, r.code)).limit(1);
    if (existing.length > 0) {
      result.rolesSkipped.push(r.code);
      continue;
    }
    const inserted = await db
      .insert(roles)
      .values({ code: r.code, name: r.name, description: r.description, isSystem: true })
      .onConflictDoNothing({ target: roles.code })
      .returning();
    if (inserted.length > 0) result.rolesInserted.push(r.code);
    else result.rolesSkipped.push(r.code);
  }

  for (const p of SEED_PERMISSIONS) {
    const existing = await db.select().from(permissions).where(eq(permissions.code, p.code)).limit(1);
    if (existing.length > 0) {
      result.permissionsSkipped.push(p.code);
      continue;
    }
    const inserted = await db
      .insert(permissions)
      .values({ code: p.code, name: p.name, description: p.description })
      .onConflictDoNothing({ target: permissions.code })
      .returning();
    if (inserted.length > 0) result.permissionsInserted.push(p.code);
    else result.permissionsSkipped.push(p.code);
  }

  const allRoleRows = await db.select().from(roles).where(inArray(roles.code, SYSTEM_ROLE_CODES as unknown as string[]));
  const allPermissionRows = await db.select().from(permissions).where(inArray(permissions.code, ALL_PERMISSION_CODES));
  const roleIdByCode = new Map(allRoleRows.map((r) => [r.code, r.id]));
  const permissionIdByCode = new Map(allPermissionRows.map((p) => [p.code, p.id]));

  for (const [roleCode, permCodes] of Object.entries(ROLE_PERMISSION_MAP)) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) continue;
    for (const permCode of permCodes) {
      const permissionId = permissionIdByCode.get(permCode);
      if (!permissionId) continue;
      const existing = await db
        .select()
        .from(rolePermissions)
        .where(eq(rolePermissions.roleId, roleId))
        .then((rows) => rows.filter((r) => r.permissionId === permissionId));
      if (existing.length > 0) {
        result.rolePermissionLinksSkipped += 1;
        continue;
      }
      const inserted = await db
        .insert(rolePermissions)
        .values({ roleId, permissionId })
        .onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionId] })
        .returning();
      if (inserted.length > 0) result.rolePermissionLinksInserted += 1;
      else result.rolePermissionLinksSkipped += 1;
    }
  }

  return result;
}
