import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { sql } from 'drizzle-orm';
import {
  index,
  sqliteTable,
  text,
  integer,
  blob,
  real,
  primaryKey,
} from "drizzle-orm/sqlite-core";

//===============================================
// SQLite 데이터베이스 테이블 정의
//===============================================

// 세션 저장소 테이블 (필수)
export const sessions = sqliteTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: text("sess", { mode: "json" }).notNull().$type<any>(),
    expire: integer("expire", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// 영업팀 테이블 (신규 추가)
export const salesTeams = sqliteTable("sales_teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamName: text("team_name", { length: 100 }).notNull(), // 영업팀명
  teamCode: text("team_code", { length: 20 }).unique().notNull(), // 영업팀 코드
  description: text("description"), // 팀 설명
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 영업과장 테이블 (신규 추가)
export const salesManagers = sqliteTable("sales_managers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id").references(() => salesTeams.id),
  managerName: text("manager_name", { length: 100 }).notNull(), // 과장명
  managerCode: text("manager_code", { length: 20 }).unique(), // 과장 코드
  username: text("username", { length: 50 }).unique().notNull(), // 로그인 ID
  password: text("password", { length: 255 }).notNull(), // 해시된 비밀번호
  position: text("position", { length: 20 }).notNull().default('대리'), // 직급
  contactPhone: text("contact_phone", { length: 20 }),
  email: text("email", { length: 100 }),
  name: text("name", { length: 100 }), // 기존 컬럼과 호환성
  teamName: text("team_name", { length: 100 }), // 기존 컬럼과 호환성
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 접점 코드 테이블 (신규 추가)
export const contactCodes = sqliteTable("contact_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code", { length: 50 }).notNull().unique(),
  dealerName: text("dealer_name", { length: 255 }).notNull(),
  realSalesPOS: text("real_sales_pos", { length: 255 }), // 실제 판매점명 추가
  carrier: text("carrier", { length: 100 }).notNull(),
  salesManagerId: integer("sales_manager_id").references(() => salesManagers.id),
  salesManagerName: text("sales_manager_name", { length: 100 }),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// POS별 히든 정산 단가 테이블 (신규 추가)
export const hiddenPricesByPos = sqliteTable("hidden_prices_by_pos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactCode: text("contact_code", { length: 50 }).notNull(), // 판매점 코드
  servicePlanId: integer("service_plan_id").notNull(), // 서비스 플랜 ID
  hiddenPrice: real("hidden_price").notNull(), // 히든 정산 단가
  isActive: integer("is_active", { mode: "boolean" }).default(true), // 활성화 여부
  effectiveFrom: integer("effective_from", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`), // 적용 시작일
  effectiveUntil: integer("effective_until", { mode: "timestamp" }), // 적용 종료일 (null이면 무기한)
  memo: text("memo"), // 메모
  createdBy: integer("created_by").notNull(), // 생성자 ID
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("hidden_prices_contact_code_service_plan_idx").on(table.contactCode, table.servicePlanId),
  index("hidden_prices_effective_from_idx").on(table.effectiveFrom),
]);

// 접점 코드와 영업과장 매핑 테이블 (신규 추가)
export const contactCodeMappings = sqliteTable("contact_code_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  managerId: integer("manager_id").references(() => salesManagers.id).notNull(),
  carrier: text("carrier", { length: 50 }).notNull(), // 통신사
  contactCode: text("contact_code", { length: 50 }).notNull(), // 접점 코드
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 관리자 테이블
export const admins = sqliteTable("admins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username", { length: 50 }).unique().notNull(),
  password: text("password", { length: 255 }).notNull(),
  name: text("name", { length: 100 }).notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 사용자 테이블 추가
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealerId: integer("dealer_id"),
  username: text("username", { length: 50 }).unique().notNull(),
  password: text("password", { length: 255 }).notNull(),
  name: text("name", { length: 100 }).notNull(),
  userType: text("user_type", { length: 20 }).notNull().default('user'),
  role: text("role", { length: 50 }),
  allowedCarriers: text("allowed_carriers", { mode: "json" }).$type<string[]>(), // 허용된 통신사 목록
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 통신사 테이블
export const carriers = sqliteTable("carriers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 100 }).notNull(), // 통신사명
  displayOrder: integer("display_order").notNull().default(0), // 표시 순서
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true), // 활성화 상태
  isWired: integer("is_wired", { mode: "boolean" }).notNull().default(false), // 유선 통신사 여부
  bundleNumber: text("bundle_number", { length: 100 }), // 결합 번호
  bundleCarrier: text("bundle_carrier", { length: 100 }), // 결합 통신사
  documentRequired: integer("document_required", { mode: "boolean" }).notNull().default(false), // 서류 필수 여부
  requireCustomerName: integer("require_customer_name", { mode: "boolean" }).notNull().default(true), // 고객명 필수
  requireCustomerPhone: integer("require_customer_phone", { mode: "boolean" }).notNull().default(true), // 고객 전화번호 필수
  requireCustomerEmail: integer("require_customer_email", { mode: "boolean" }).notNull().default(false), // 고객 이메일 필수
  requireContactCode: integer("require_contact_code", { mode: "boolean" }).notNull().default(true), // 접점코드 필수
  requireCarrier: integer("require_carrier", { mode: "boolean" }).notNull().default(true), // 통신사 필수
  requirePreviousCarrier: integer("require_previous_carrier", { mode: "boolean" }).notNull().default(false), // 이전통신사 필수
  requireDocumentUpload: integer("require_document_upload", { mode: "boolean" }).notNull().default(false), // 서류 업로드 필수
  requireBundleNumber: integer("require_bundle_number", { mode: "boolean" }).notNull().default(false), // 결합 번호 필수
  requireBundleCarrier: integer("require_bundle_carrier", { mode: "boolean" }).notNull().default(false), // 결합 통신사 필수
  allowNewCustomer: integer("allow_new_customer", { mode: "boolean" }).notNull().default(true), // 신규 고객 허용
  allowPortIn: integer("allow_port_in", { mode: "boolean" }).notNull().default(true), // 번호이동 허용
  requireDesiredNumber: integer("require_desired_number", { mode: "boolean" }).notNull().default(false), // 희망번호 필수 (신규시)
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 기타 통신사 테이블 (새로 추가)
export const otherCarriers = sqliteTable("other_carriers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 100 }).notNull(), // 기타통신사명
  displayOrder: integer("display_order").default(0), // 표시 순서
  isActive: integer("is_active", { mode: "boolean" }).default(true), // 활성화 상태
  description: text("description"), // 설명
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 기타업무통신사 테이블 (사용자 요청)
export const otherBusinessCarriers = sqliteTable("other_business_carriers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessRequestPoint: text("business_request_point", { length: 200 }).notNull(), // 업무 요청점
  memo: text("memo"), // 메모
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 서비스 플랜 테이블
export const servicePlans = sqliteTable("service_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 200 }).notNull(), // 요금제명
  carrier: text("carrier", { length: 100 }).notNull(), // 통신사
  planType: text("plan_type", { length: 50 }).notNull(), // 요금제 유형 (LTE, 5G 등)
  dataAllowance: text("data_allowance", { length: 100 }), // 데이터 제공량
  monthlyFee: real("monthly_fee").notNull(), // 월 요금
  combinationEligible: integer("combination_eligible", { mode: "boolean" }).notNull().default(false), // 결합 가능 여부
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 부가서비스 테이블
export const additionalServices = sqliteTable("additional_services", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 200 }).notNull(), // 부가서비스명
  carrier: text("carrier", { length: 100 }).notNull(), // 통신사
  monthlyFee: real("monthly_fee").notNull(), // 월 요금
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 문서 테이블
export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dealerId: integer("dealer_id"),
  customerName: text("customer_name", { length: 100 }).notNull(),
  customerPhone: text("customer_phone", { length: 20 }).notNull(),
  customerEmail: text("customer_email", { length: 100 }),
  customerBirthdate: text("customer_birthdate", { length: 20 }),
  customerGender: text("customer_gender", { length: 10 }),
  contactCode: text("contact_code", { length: 50 }),
  carrier: text("carrier", { length: 100 }),
  previousCarrier: text("previous_carrier", { length: 100 }),
  servicePlan: text("service_plan", { length: 200 }),
  selectedServices: text("selected_services", { mode: "json" }).$type<string[]>(),
  bundleNumber: text("bundle_number", { length: 100 }),
  bundleCarrier: text("bundle_carrier", { length: 100 }),
  desiredNumber: text("desired_number", { length: 20 }),
  filePath: text("file_path", { length: 500 }),
  fileName: text("file_name", { length: 255 }),
  fileSize: integer("file_size"),
  status: text("status", { length: 20 }).default('pending'),
  submittedBy: integer("submitted_by"),
  processedBy: integer("processed_by"),
  processedAt: integer("processed_at", { mode: "timestamp" }),
  rejectionReason: text("rejection_reason"),
  memo: text("memo"),
  isNewCustomer: integer("is_new_customer", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 정산 단가 테이블 - 실제 데이터베이스 구조에 맞게 수정
export const settlementUnitPrices = sqliteTable("settlement_unit_prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  servicePlanId: integer("service_plan_id").notNull(),
  newCustomerPrice: real("new_customer_price").notNull(),
  portInPrice: real("port_in_price").notNull(),
  hiddenPrice: real("hidden_price").default(0),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  effectiveFrom: text("effective_from"),
  effectiveUntil: text("effective_until"),
  memo: text("memo"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  createdBy: integer("created_by"),
  carrier: text("carrier"), // 추가된 컬럼
});

// 딜러 테이블
export const dealers = sqliteTable("dealers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name", { length: 100 }).notNull(),
  businessNumber: text("business_number", { length: 20 }),
  contactPhone: text("contact_phone", { length: 20 }),
  email: text("email", { length: 100 }),
  address: text("address", { length: 500 }),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// 딜러 등록 테이블
export const dealerRegistrations = sqliteTable("dealer_registrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessName: text("business_name", { length: 100 }).notNull(),
  businessNumber: text("business_number", { length: 20 }).notNull(),
  representativeName: text("representative_name", { length: 100 }).notNull(),
  contactPhone: text("contact_phone", { length: 20 }).notNull(),
  email: text("email", { length: 100 }).notNull(),
  address: text("address", { length: 500 }).notNull(),
  businessLicenseFile: text("business_license_file", { length: 500 }),
  status: text("status", { length: 20 }).default('pending'),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
  rejectionReason: text("rejection_reason"),
  dealerId: integer("dealer_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
});

// Session storage table
export const appSessions = sqliteTable("app_sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  userType: text("user_type", { length: 20 }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`CURRENT_TIMESTAMP`),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

//===============================================
// 타입 정의
//===============================================

export type Admin = typeof admins.$inferSelect;
export type User = typeof users.$inferSelect;
export type Carrier = typeof carriers.$inferSelect;
export type ServicePlan = typeof servicePlans.$inferSelect;
export type AdditionalService = typeof additionalServices.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type SalesTeam = typeof salesTeams.$inferSelect;
export type SalesManager = typeof salesManagers.$inferSelect;
export type ContactCode = typeof contactCodes.$inferSelect;
export type SettlementUnitPrice = typeof settlementUnitPrices.$inferSelect;
export type OtherCarrier = typeof otherCarriers.$inferSelect;
export type Dealer = typeof dealers.$inferSelect;
export type DealerRegistration = typeof dealerRegistrations.$inferSelect;
export type AppSession = typeof appSessions.$inferSelect;
export type OtherBusinessCarrier = typeof otherBusinessCarriers.$inferSelect;