import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  integer,
  boolean,
  text,
  decimal,
  serial,
  primaryKey,
} from "drizzle-orm/pg-core";

//===============================================
// PostgreSQL 데이터베이스 테이블 정의
//===============================================

// 세션 저장소 테이블 (필수) - 실제 DB 구조에 맞춤
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    userId: integer("user_id").notNull(),
    userType: varchar("user_type", { length: 20 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(), // expires_at 컬럼 추가
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// 인증 세션 테이블 (우리 인증 시스템용)
export const authSessions = pgTable("auth_sessions", {
  sid: varchar("sid").primaryKey(),
  userId: integer("user_id").notNull(),
  userType: varchar("user_type", { length: 20 }).notNull(),
});

// 영업팀 테이블 (신규 추가)
export const salesTeams = pgTable("sales_teams", {
  id: serial("id").primaryKey(),
  teamName: varchar("team_name", { length: 100 }).notNull(), // 영업팀명
  teamCode: varchar("team_code", { length: 20 }).unique().notNull(), // 영업팀 코드
  description: text("description"), // 팀 설명
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 영업과장 테이블 (신규 추가)
export const salesManagers = pgTable("sales_managers", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => salesTeams.id).notNull(),
  managerName: varchar("manager_name", { length: 100 }).notNull(), // 과장명
  managerCode: varchar("manager_code", { length: 20 }).unique().notNull(), // 과장 코드
  username: varchar("username", { length: 50 }).unique().notNull(), // 로그인 ID
  password: varchar("password", { length: 255 }).notNull(), // 해시된 비밀번호
  position: varchar("position", { length: 20 }).notNull().default('대리'), // 직급
  contactPhone: varchar("contact_phone", { length: 20 }),
  email: varchar("email", { length: 100 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 관리자 테이블
export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 50 }).unique().notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// 판매점 원장 테이블 — admins 다음, contactCodes 앞에 위치해야 FK 참조 가능
export const dealerRegistrations = pgTable("dealer_registrations", {
  id: serial("id").primaryKey(),
  dealerCode: varchar("dealer_code", { length: 20 }).unique(), // 판매점 식별 코드 (MCC0001 형식)
  businessName: varchar("business_name", { length: 255 }).notNull(),
  representativeName: varchar("representative_name", { length: 100 }).notNull(),
  businessNumber: varchar("business_number", { length: 20 }).notNull(),
  contactPhone: varchar("contact_phone", { length: 20 }).notNull(),
  contactEmail: varchar("contact_email", { length: 100 }),
  address: text("address").notNull(),
  bankAccount: varchar("bank_account", { length: 100 }),
  bankName: varchar("bank_name", { length: 50 }),
  accountHolder: varchar("account_holder", { length: 100 }),
  username: varchar("username", { length: 50 }).unique().notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default('대기'),
  approvedBy: integer("approved_by").references(() => admins.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  isActive: boolean("is_active").default(true),
  isHiddenPos: boolean("is_hidden_pos").default(false),
  isContactPolicyPos: boolean("is_contact_policy_pos").default(false),
  settlementOnly: boolean("settlement_only").default(false),
  mCode: varchar("m_code", { length: 30 }),
  kpNumber: varchar("kp_number", { length: 50 }),
  regionName: varchar("region_name", { length: 100 }),
  sourceDealerName: varchar("source_dealer_name", { length: 255 }),
  subDealerName: varchar("sub_dealer_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 접점 코드 테이블
export const contactCodes = pgTable("contact_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  dealerName: varchar("dealer_name", { length: 255 }).notNull(),
  realSalesPOS: varchar("real_sales_pos", { length: 255 }),
  carrier: varchar("carrier", { length: 100 }).notNull(),
  salesManagerId: integer("sales_manager_id").references(() => salesManagers.id),
  salesManagerName: varchar("sales_manager_name", { length: 100 }),
  dealerRegistrationId: integer("dealer_registration_id").references(() => dealerRegistrations.id),
  realSalesPosCode: varchar("real_sales_pos_code", { length: 30 }),
  memo: text("memo"),
  mCode: varchar("m_code", { length: 30 }),
  channel: varchar("channel", { length: 100 }),
  kpNumber: varchar("kp_number", { length: 50 }),
  regionName: varchar("region_name", { length: 100 }),
  aliasName: varchar("alias_name", { length: 255 }),
  subDealerName: varchar("sub_dealer_name", { length: 255 }),
  sourceDealerName: varchar("source_dealer_name", { length: 255 }),
  codeName: varchar("code_name", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("contact_codes_m_code_idx").on(table.mCode),
  index("contact_codes_channel_idx").on(table.channel),
  index("contact_codes_m_code_channel_idx").on(table.mCode, table.channel),
]);

// POS별 히든 정산 단가 테이블 (신규 추가)
export const hiddenPricesByPos = pgTable("hidden_prices_by_pos", {
  id: serial("id").primaryKey(),
  contactCode: varchar("contact_code", { length: 50 }).notNull(),
  servicePlanId: integer("service_plan_id").notNull(),
  hiddenPrice: decimal("hidden_price", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true),
  effectiveFrom: timestamp("effective_from").defaultNow(),
  effectiveUntil: timestamp("effective_until"),
  memo: text("memo"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("hidden_prices_contact_code_service_plan_idx").on(table.contactCode, table.servicePlanId),
  index("hidden_prices_effective_from_idx").on(table.effectiveFrom),
]);

// 접점 코드와 영업과장 매핑 테이블 (신규 추가)
export const contactCodeMappings = pgTable("contact_code_mappings", {
  id: serial("id").primaryKey(),
  managerId: integer("manager_id").references(() => salesManagers.id).notNull(),
  carrier: varchar("carrier", { length: 50 }).notNull(),
  contactCode: varchar("contact_code", { length: 50 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 사용자 테이블
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  dealerId: integer("dealer_id"),
  dealerRegistrationId: integer("dealer_registration_id").references(() => dealerRegistrations.id),
  username: varchar("username", { length: 50 }).unique().notNull(),
  password: varchar("password", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  userType: varchar("user_type", { length: 20 }).notNull().default('user'),
  role: varchar("role", { length: 50 }),
  allowedCarriers: jsonb("allowed_carriers").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow(),
});

// 통신사 테이블
export const carriers = pgTable("carriers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // 통신사명
  displayOrder: integer("display_order").default(0), // 표시 순서
  isActive: boolean("is_active").default(true), // 활성화 상태
  isWired: boolean("is_wired").default(false), // 유선 통신사 여부
  bundleNumber: varchar("bundle_number", { length: 100 }), // 결합 번호
  bundleCarrier: varchar("bundle_carrier", { length: 100 }), // 결합 통신사
  documentRequired: boolean("document_required").default(false), // 서류 필수 여부
  requireCustomerName: boolean("require_customer_name").default(true), // 고객명 필수
  requireCustomerPhone: boolean("require_customer_phone").default(true), // 고객 전화번호 필수
  requireCustomerEmail: boolean("require_customer_email").default(false), // 고객 이메일 필수
  requireContactCode: boolean("require_contact_code").default(true), // 접점코드 필수
  requireCarrier: boolean("require_carrier").default(true), // 통신사 필수
  requirePreviousCarrier: boolean("require_previous_carrier").default(false), // 이전통신사 필수
  requireDocumentUpload: boolean("require_document_upload").default(false), // 서류 업로드 필수
  requireBundleNumber: boolean("require_bundle_number").default(false), // 결합 번호 필수
  requireBundleCarrier: boolean("require_bundle_carrier").default(false), // 결합 통신사 필수
  allowNewCustomer: boolean("allow_new_customer").default(true), // 신규 고객 허용
  allowPortIn: boolean("allow_port_in").default(true), // 번호이동 허용
  requireDesiredNumber: boolean("require_desired_number").default(false), // 희망번호 필수 (신규시)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 기타 통신사 테이블 (새로 추가)
export const otherCarriers = pgTable("other_carriers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // 기타통신사명
  displayOrder: integer("display_order").default(0), // 표시 순서
  isActive: boolean("is_active").default(true), // 활성화 상태
  description: text("description"), // 설명
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 기타업무통신사 테이블 (사용자 요청)
export const otherBusinessCarriers = pgTable("other_business_carriers", {
  id: serial("id").primaryKey(),
  businessRequestPoint: varchar("business_request_point", { length: 200 }).notNull(), // 업무 요청점
  memo: text("memo"), // 메모
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 서비스 플랜 테이블
export const servicePlans = pgTable("service_plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(), // 요금제명
  carrier: varchar("carrier", { length: 100 }).notNull(), // 통신사
  planType: varchar("plan_type", { length: 50 }).notNull(), // 요금제 유형 (LTE, 5G 등)
  dataAllowance: varchar("data_allowance", { length: 100 }), // 데이터 제공량
  monthlyFee: decimal("monthly_fee", { precision: 10, scale: 2 }).notNull(), // 월 요금
  combinationEligible: boolean("combination_eligible").default(false), // 결합 가능 여부
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 부가서비스 테이블
export const additionalServices = pgTable("additional_services", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 200 }).notNull(), // 부가서비스명
  carrier: varchar("carrier", { length: 100 }).notNull(), // 통신사
  monthlyFee: decimal("monthly_fee", { precision: 10, scale: 2 }).notNull(), // 월 요금
  description: text("description"), // 설명
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 정산단가 테이블
export const settlementUnitPrices = pgTable("settlement_unit_prices", {
  id: serial("id").primaryKey(),
  servicePlanId: integer("service_plan_id").references(() => servicePlans.id).notNull(),
  newCustomerPrice: decimal("new_customer_price", { precision: 10, scale: 2 }).notNull(), // 신규 정산단가
  portInPrice: decimal("port_in_price", { precision: 10, scale: 2 }).notNull(), // 번호이동 정산단가
  isActive: boolean("is_active").default(true),
  effectiveFrom: timestamp("effective_from").defaultNow(), // 적용 시작일
  effectiveUntil: timestamp("effective_until"), // 적용 종료일 (null이면 현재 적용 중)
  memo: text("memo"), // 메모 (몇차 단가인지 등)
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: integer("created_by").notNull(), // 등록한 관리자 ID
});

// 통신사별 부가서비스 정책 테이블
export const carrierServicePolicies = pgTable("carrier_service_policies", {
  id: serial("id").primaryKey(),
  carrier: varchar("carrier", { length: 100 }).notNull(),
  policyName: varchar("policy_name", { length: 200 }).notNull(),
  policyType: varchar("policy_type", { length: 20 }).notNull(), // 'deduction' or 'addition'
  serviceCategory: varchar("service_category", { length: 50 }).notNull(), // 'internet', 'tv', 'security', 'mobile', 'bundle', 'other'
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  effectiveFrom: timestamp("effective_from").defaultNow(),
  effectiveUntil: timestamp("effective_until"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  createdBy: integer("created_by").notNull(),
});

// 문서 접수 테이블
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  dealerId: integer("dealer_id"), // nullable - admin이 직접 등록할 수도 있음
  userId: integer("user_id").notNull(), // 등록한 사용자 ID
  documentNumber: varchar("document_number", { length: 50 }).notNull().unique(),
  customerName: varchar("customer_name", { length: 100 }).notNull(),
  customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
  customerEmail: varchar("customer_email", { length: 100 }),
  storeName: varchar("store_name", { length: 255 }),
  contactCode: varchar("contact_code", { length: 50 }),
  carrier: varchar("carrier", { length: 100 }).notNull(),
  previousCarrier: varchar("previous_carrier", { length: 100 }),
  customerType: varchar("customer_type", { length: 20 }).default('new'), // 'new' or 'port-in' or 'other'
  desiredNumber: varchar("desired_number", { length: 20 }),
  status: varchar("status", { length: 20 }).notNull().default('접수'),
  activationStatus: varchar("activation_status", { length: 20 }).notNull().default('대기'),
  filePath: varchar("file_path", { length: 500 }),
  fileName: varchar("file_name", { length: 255 }),
  fileSize: integer("file_size"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  activatedAt: timestamp("activated_at"),
  activatedBy: integer("activated_by"),
  activatedByType: varchar("activated_by_type", { length: 20 }), // 'admin' or 'user'
  cancelledBy: integer("cancelled_by"),
  cancelledAt: timestamp("cancelled_at"),
  notes: text("notes"),
  // 작업 잠금 시스템
  assignedWorkerId: integer("assigned_worker_id"),
  assignedAt: timestamp("assigned_at"),
  // 보완 관련 필드
  supplementRequired: text("supplement_required"),
  supplementNotes: text("supplement_notes"),
  supplementRequiredBy: integer("supplement_required_by"),
  supplementRequiredAt: timestamp("supplement_required_at"),
  // 개통 완료 후 플랜 정보
  servicePlanId: integer("service_plan_id").references(() => servicePlans.id),
  servicePlanName: varchar("service_plan_name", { length: 200 }),
  additionalServiceIds: text("additional_service_ids"), // JSON 배열
  registrationFee: decimal("registration_fee", { precision: 10, scale: 2 }),
  registrationFeePrepaid: boolean("registration_fee_prepaid").default(false),
  registrationFeePostpaid: boolean("registration_fee_postpaid").default(false),
  registrationFeeInstallment: boolean("registration_fee_installment").default(false),
  simFeePrepaid: boolean("sim_fee_prepaid").default(false),
  simFeePostpaid: boolean("sim_fee_postpaid").default(false),
  bundleApplied: boolean("bundle_applied").default(false),
  bundleNotApplied: boolean("bundle_not_applied").default(false),
  bundleDiscount: decimal("bundle_discount", { precision: 10, scale: 2 }),
  totalMonthlyFee: decimal("total_monthly_fee", { precision: 10, scale: 2 }),
  // 단말기 정보
  deviceModel: varchar("device_model", { length: 100 }),
  deviceSerialNumber: varchar("device_serial_number", { length: 100 }), // 단말일련번호 추가
  simNumber: varchar("sim_number", { length: 50 }),
  subscriptionNumber: varchar("subscription_number", { length: 50 }),
  dealerNotes: text("dealer_notes"),
  discardReason: text("discard_reason"),
  // 정산단가 저장 (개통 완료 시점의 단가)
  settlementNewCustomerPrice: decimal("settlement_new_customer_price", { precision: 10, scale: 2 }),
  settlementPortInPrice: decimal("settlement_port_in_price", { precision: 10, scale: 2 }),
  settlementCalculatedAt: timestamp("settlement_calculated_at"),
  // 수정된 정산 금액 (관리자가 직접 수정한 경우)
  settlementAmount: decimal("settlement_amount", { precision: 10, scale: 2 }),
});

// 채팅방 테이블
export const chatRooms = pgTable("chat_rooms", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  dealerId: integer("dealer_id"), // 판매점 ID (documents에서 가져올 수도 있지만 직접 저장)
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 채팅 메시지 테이블
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  chatRoomId: integer("chat_room_id").references(() => chatRooms.id).notNull(),
  senderId: integer("sender_id").notNull(), // 발송자 ID (dealer_registration 또는 user/admin)
  senderType: varchar("sender_type", { length: 20 }).notNull(), // 'dealer', 'worker', 'admin'
  senderName: varchar("sender_name", { length: 100 }).notNull(), // 발송자 이름
  message: text("message").notNull(),
  messageType: varchar("message_type", { length: 20 }).default('text'), // 'text', 'image', 'file'
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

//===============================================
// 정산 엔진 테이블 (STEP 5B)
//===============================================

// 정책 차수 테이블
export const policyVersions = pgTable("policy_versions", {
  id: serial("id").primaryKey(),
  policyNo: varchar("policy_no", { length: 50 }).notNull().unique(),
  policyName: varchar("policy_name", { length: 200 }).notNull(),
  effectiveFrom: timestamp("effective_from").notNull(),
  effectiveTo: timestamp("effective_to"),
  isActive: boolean("is_active").default(true),
  memo: text("memo"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// 정책 단가 행 테이블
export const policyRows = pgTable("policy_rows", {
  id: serial("id").primaryKey(),
  policyVersionId: integer("policy_version_id").references(() => policyVersions.id).notNull(),
  channel: varchar("channel", { length: 100 }).notNull(),
  planName: varchar("plan_name", { length: 200 }).notNull(),
  customerType: varchar("customer_type", { length: 20 }).notNull(),
  nationalityType: varchar("nationality_type", { length: 20 }),
  simCount: integer("sim_count"),
  bundleType: varchar("bundle_type", { length: 100 }),
  addService: varchar("add_service", { length: 200 }),
  regFeeType: varchar("reg_fee_type", { length: 50 }),
  rebateAmount: decimal("rebate_amount", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("policy_rows_version_channel_plan_idx").on(table.policyVersionId, table.channel, table.planName),
  index("policy_rows_version_channel_plan_sim_idx").on(table.policyVersionId, table.channel, table.planName, table.simCount),
]);

// 정책 원본 파일 보관 테이블
export const policyFiles = pgTable("policy_files", {
  id: serial("id").primaryKey(),
  policyVersionId: integer("policy_version_id").references(() => policyVersions.id).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  filePath: varchar("file_path", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 20 }).notNull(),
  fileSize: integer("file_size"),
  memo: text("memo"),
  uploadedBy: integer("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

// 정산 원장 테이블 (개통 데이터 — 정산 기준: activation_datetime)
export const activationRecords = pgTable("activation_records", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id),
  receptionDatetime: timestamp("reception_datetime"),
  activationDatetime: timestamp("activation_datetime").notNull(),
  requestChannel: varchar("request_channel", { length: 50 }),
  channel: varchar("channel", { length: 100 }).notNull(),
  customerName: varchar("customer_name", { length: 100 }),
  customerPhone: varchar("customer_phone", { length: 20 }),
  customerEmail: varchar("customer_email", { length: 100 }),
  receptionNumber: varchar("reception_number", { length: 50 }),
  subscriptionNumber: varchar("subscription_number", { length: 50 }),
  activationNumber: varchar("activation_number", { length: 50 }),
  contactCode: varchar("contact_code", { length: 50 }),
  mccCode: varchar("mcc_code", { length: 20 }),
  dealerRegistrationId: integer("dealer_registration_id").references(() => dealerRegistrations.id),
  contactCodeId: integer("contact_code_id"),
  dealerName: varchar("dealer_name", { length: 255 }),
  codeName: varchar("code_name", { length: 200 }),
  realSalesPOS: varchar("real_sales_pos", { length: 255 }),
  subDealerName: varchar("sub_dealer_name", { length: 255 }),
  matchingStatus: varchar("matching_status", { length: 20 }),
  matchingBasis: varchar("matching_basis", { length: 100 }),
  simCount: integer("sim_count"),
  planName: varchar("plan_name", { length: 200 }),
  customerType: varchar("customer_type", { length: 20 }),
  nationalityType: varchar("nationality_type", { length: 20 }).default('내국인'),
  previousCarrier: varchar("previous_carrier", { length: 100 }),
  bundleType: varchar("bundle_type", { length: 100 }),
  addService: varchar("add_service", { length: 200 }),
  regFeeType: varchar("reg_fee_type", { length: 50 }),
  receptionist: varchar("receptionist", { length: 100 }),
  policyVersionId: integer("policy_version_id").references(() => policyVersions.id),
  source: varchar("source", { length: 20 }).notNull().default('수동입력'),
  memo: text("memo"),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("activation_records_activation_datetime_idx").on(table.activationDatetime),
  index("activation_records_dealer_datetime_idx").on(table.dealerRegistrationId, table.activationDatetime),
  index("activation_records_contact_code_idx").on(table.contactCode),
  index("activation_records_document_id_idx").on(table.documentId),
]);

// 정산 결과 테이블
export const settlementItems = pgTable("settlement_items", {
  id: serial("id").primaryKey(),
  activationId: integer("activation_id").references(() => activationRecords.id).notNull(),
  policyVersionId: integer("policy_version_id").references(() => policyVersions.id),
  policyRowId: integer("policy_row_id").references(() => policyRows.id),
  dealerRegistrationId: integer("dealer_registration_id").references(() => dealerRegistrations.id),
  dealerName: varchar("dealer_name", { length: 255 }),
  rebateAmount: decimal("rebate_amount", { precision: 10, scale: 2 }),
  adjustedAmount: decimal("adjusted_amount", { precision: 10, scale: 2 }),
  addAmount: decimal("add_amount", { precision: 10, scale: 2 }),
  deductAmount: decimal("deduct_amount", { precision: 10, scale: 2 }),
  hiddenAmount: decimal("hidden_amount", { precision: 10, scale: 2 }),
  lockedAmount: decimal("locked_amount", { precision: 10, scale: 2 }),
  lockedAt: timestamp("locked_at"),
  lockedBy: integer("locked_by"),
  matchStatus: varchar("match_status", { length: 30 }).notNull().default('POLICY_NOT_FOUND'),
  status: varchar("status", { length: 20 }).notNull().default('미정산'),
  forcePolicyVersionId: integer("force_policy_version_id").references(() => policyVersions.id),
  forceReason: text("force_reason"),
  policySnapshotJson: jsonb("policy_snapshot_json"),
  settledAt: timestamp("settled_at"),
  settledBy: integer("settled_by"),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("settlement_items_activation_id_idx").on(table.activationId),
  index("settlement_items_dealer_status_idx").on(table.dealerRegistrationId, table.status),
  index("settlement_items_match_status_idx").on(table.matchStatus),
  index("settlement_items_locked_at_idx").on(table.lockedAt),
]);

// 추가금/차감금 정책 규칙 테이블 (향후 자동 적용용 — 현재 단계에서는 자동 계산 미적용)
export const adjustmentRules = pgTable("adjustment_rules", {
  id: serial("id").primaryKey(),
  policyVersionId: integer("policy_version_id").references(() => policyVersions.id).notNull(),
  channel: varchar("channel", { length: 100 }).notNull(),
  planName: varchar("plan_name", { length: 200 }).notNull(),
  customerType: varchar("customer_type", { length: 10 }).notNull(),
  conditionType: varchar("condition_type", { length: 50 }).notNull(),
  conditionValue: varchar("condition_value", { length: 200 }),
  adjustmentType: varchar("adjustment_type", { length: 10 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  isActive: boolean("is_active").default(true),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 히든정책 행 테이블
export const hiddenPolicyRows = pgTable("hidden_policy_rows", {
  id: serial("id").primaryKey(),
  dealerRegistrationId: integer("dealer_registration_id").references(() => dealerRegistrations.id),
  contactCode: varchar("contact_code", { length: 50 }),
  channel: varchar("channel", { length: 100 }),
  planName: varchar("plan_name", { length: 200 }),
  customerType: varchar("customer_type", { length: 10 }),
  hiddenAmount: decimal("hidden_amount", { precision: 10, scale: 2 }).notNull(),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  isActive: boolean("is_active").default(true),
  memo: text("memo"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 정산 근거 파일 테이블
export const settlementFiles = pgTable("settlement_files", {
  id: serial("id").primaryKey(),
  settlementItemId: integer("settlement_item_id").references(() => settlementItems.id).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  filePath: varchar("file_path", { length: 500 }).notNull(),
  fileType: varchar("file_type", { length: 20 }).notNull(),
  fileSize: integer("file_size"),
  memo: text("memo"),
  uploadedBy: integer("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

//===============================================
// 타입 정의
//===============================================

// Database schema types
export interface Admin {
  id: number;
  username: string;
  password: string;
  name: string;
  createdAt: Date;
}

export interface User {
  id: number;
  dealerId?: number;
  dealerRegistrationId?: number;
  username: string;
  password: string;
  name: string;
  userType: 'admin' | 'user' | 'sales_manager' | 'dealer';
  role?: string;
  allowedCarriers?: string[]; // 허용된 통신사 목록
  createdAt: Date;
}

// 통신사 타입
export interface Carrier {
  id: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
  isWired: boolean;
  bundleNumber?: string;
  bundleCarrier?: string;
  documentRequired: boolean;
  requireCustomerName: boolean;
  requireCustomerPhone: boolean;
  requireCustomerEmail: boolean;
  requireContactCode: boolean;
  requireCarrier: boolean;
  requirePreviousCarrier: boolean;
  requireDocumentUpload: boolean;
  requireBundleNumber: boolean;
  requireBundleCarrier: boolean;
  allowNewCustomer: boolean;
  allowPortIn: boolean;
  requireDesiredNumber: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 기타 통신사 타입
export interface OtherCarrier {
  id: number;
  name: string;
  displayOrder: number;
  isActive: boolean;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// 서비스 플랜 타입
export interface ServicePlan {
  id: number;
  name: string;
  carrier: string;
  planType: string;
  dataAllowance?: string;
  monthlyFee: number;
  combinationEligible: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 부가서비스 타입
export interface AdditionalService {
  id: number;
  name: string;
  carrier: string;
  monthlyFee: number;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 영업팀 타입
export interface SalesTeam {
  id: number;
  teamName: string;
  teamCode: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 영업과장 타입
export interface SalesManager {
  id: number;
  teamId: number;
  managerName: string;
  managerCode: string;
  username: string;
  password: string;
  position: string;
  contactPhone?: string;
  email?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// 접점 코드 타입
export interface ContactCode {
  id: number;
  code: string;
  dealerName: string;
  realSalesPOS?: string;
  realSalesPosCode?: string;
  carrier: string;
  salesManagerId?: number;
  salesManagerName?: string;
  dealerRegistrationId?: number;
  memo?: string;
  mCode?: string;
  channel?: string;
  kpNumber?: string;
  regionName?: string;
  aliasName?: string;
  subDealerName?: string;
  sourceDealerName?: string;
  codeName?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: number;
  dealerId?: number;
  userId: number;
  documentNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  storeName?: string;
  contactCode?: string;
  carrier: string;
  previousCarrier?: string;
  customerType?: string;
  desiredNumber?: string;
  status: string;
  activationStatus: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  uploadedAt: Date;
  updatedAt: Date;
  activatedAt?: Date;
  activatedBy?: number;
  activatedByRole?: string; // 'admin' | 'user'
  cancelledBy?: number;
  cancelledAt?: Date;
  notes?: string;
  assignedWorkerId?: number;
  assignedAt?: Date;
  supplementRequired?: string;
  supplementNotes?: string;
  supplementRequiredBy?: number;
  supplementRequiredAt?: Date;
  servicePlanId?: number;
  servicePlanName?: string;
  additionalServiceIds?: string;
  registrationFee?: number;
  registrationFeePrepaid?: boolean;
  registrationFeePostpaid?: boolean;
  registrationFeeInstallment?: boolean;
  simFeePrepaid?: boolean;
  simFeePostpaid?: boolean;
  bundleApplied?: boolean;
  bundleNotApplied?: boolean;
  bundleDiscount?: number;
  totalMonthlyFee?: number;
  deviceModel?: string;
  deviceSerialNumber?: string;
  simNumber?: string;
  subscriptionNumber?: string;
  dealerNotes?: string;
  discardReason?: string;
  settlementNewCustomerPrice?: number;
  settlementPortInPrice?: number;
  settlementCalculatedAt?: Date;
  settlementAmount?: number;
}

export interface Dealer {
  id: number;
  dealerCode?: string;
  businessName: string;
  representativeName: string;
  businessNumber: string;
  contactPhone: string;
  contactEmail?: string;
  address: string;
  bankAccount?: string;
  bankName?: string;
  accountHolder?: string;
  username: string;
  password: string;
  status: string;
  approvedBy?: number;
  approvedAt?: Date;
  rejectionReason?: string;
  isActive: boolean;
  isHiddenPos: boolean;
  mCode?: string;
  kpNumber?: string;
  regionName?: string;
  sourceDealerName?: string;
  subDealerName?: string;
  createdAt: Date;
  updatedAt: Date;
}

//===============================================
// Zod 스키마 정의
//===============================================

export const loginSchema = z.object({
  username: z.string().min(3, "아이디는 최소 3자 이상이어야 합니다"),
  password: z.string().min(4, "비밀번호는 최소 4자 이상이어야 합니다"),
});

export const createUserSchema = z.object({
  username: z.string().min(3, "아이디는 최소 3자 이상이어야 합니다"),
  password: z.string().min(6, "비밀번호는 최소 6자 이상이어야 합니다"),
  name: z.string().min(1, "이름을 입력해주세요"),
  userType: z.enum(['admin', 'user']).default('user'),
  role: z.string().optional(),
  dealerId: z.number().optional(),
});

export const createAdminSchema = z.object({
  username: z.string().min(3, "아이디는 최소 3자 이상이어야 합니다"),
  password: z.string().min(6, "비밀번호는 최소 6자 이상이어야 합니다"),
  name: z.string().min(1, "이름을 입력해주세요"),
});

export const createWorkerSchema = z.object({
  username: z.string().min(3, "아이디는 최소 3자 이상이어야 합니다"),
  password: z.string().min(6, "비밀번호는 최소 6자 이상이어야 합니다"),
  name: z.string().min(1, "이름을 입력해주세요"),
});

export const createDocumentSchema = z.object({
  customerName: z.string().min(1, "고객명을 입력하세요"),
  customerPhone: z.string().min(1, "연락처를 입력하세요"),
  customerEmail: z.string().email().optional().or(z.literal("")),
  contactCode: z.string().min(1, "개통방명코드를 입력하세요"),
  carrier: z.string().min(1, "통신사를 선택하세요"),
  previousCarrier: z.string().optional(),
  customerType: z.enum(['new', 'port-in', 'other']).default('new'),
  desiredNumber: z.string().optional(),
  notes: z.string().optional(),
});

export const updateDocumentStatusSchema = z.object({
  status: z.enum(['접수', '보완필요', '완료']),
  activationStatus: z.enum(['대기', '진행중', '업무요청중', '보완필요', '개통', '취소', '기타완료', '폐기']),
  notes: z.string().optional(),
});

export const updateActivationStatusSchema = z.object({
  activationStatus: z.enum(['대기', '진행중', '업무요청중', '보완필요', '개통', '취소', '기타완료', '폐기']),
  notes: z.string().optional(),
  // 개통 완료 관련 정보 (상태가 '개통'일 때만 필요)
  servicePlanId: z.number().optional(),
  servicePlanName: z.string().optional(),
  additionalServiceIds: z.string().optional(),
  registrationFee: z.number().optional(),
  registrationFeePrepaid: z.boolean().optional(),
  registrationFeePostpaid: z.boolean().optional(),
  registrationFeeInstallment: z.boolean().optional(),
  simFeePrepaid: z.boolean().optional(),
  simFeePostpaid: z.boolean().optional(),
  bundleApplied: z.boolean().optional(),
  bundleNotApplied: z.boolean().optional(),
  bundleDiscount: z.number().optional(),
  totalMonthlyFee: z.number().optional(),
  deviceModel: z.string().optional(),
  deviceSerialNumber: z.string().optional(),
  simNumber: z.string().optional(),
  subscriptionNumber: z.string().optional(),
  dealerNotes: z.string().optional(),
  discardReason: z.string().optional(),
});

export const createServicePlanSchema = z.object({
  name: z.string().min(1, "요금제명을 입력하세요"),
  carrier: z.string().min(1, "통신사를 선택하세요"),
  planType: z.string().min(1, "요금제 유형을 입력하세요"),
  dataAllowance: z.string().optional(),
  monthlyFee: z.number().min(0, "월 요금을 입력하세요"),
  combinationEligible: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const createAdditionalServiceSchema = z.object({
  name: z.string().min(1, "부가서비스명을 입력하세요"),
  carrier: z.string().min(1, "통신사를 선택하세요"),
  monthlyFee: z.number().min(0, "월 요금을 입력하세요"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const createCarrierSchema = z.object({
  name: z.string().min(1, "통신사명을 입력하세요"),
  displayOrder: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  isWired: z.boolean().default(false),
  bundleNumber: z.string().optional(),
  bundleCarrier: z.string().optional(),
  documentRequired: z.boolean().default(false),
  requireCustomerName: z.boolean().default(true),
  requireCustomerPhone: z.boolean().default(true),
  requireCustomerEmail: z.boolean().default(false),
  requireContactCode: z.boolean().default(true),
  requireCarrier: z.boolean().default(true),
  requirePreviousCarrier: z.boolean().default(false),
  requireDocumentUpload: z.boolean().default(false),
  requireBundleNumber: z.boolean().default(false),
  requireBundleCarrier: z.boolean().default(false),
  allowNewCustomer: z.boolean().default(true),
  allowPortIn: z.boolean().default(true),
  requireDesiredNumber: z.boolean().default(false),
});

export const updateCarrierSchema = z.object({
  name: z.string().min(1, "통신사명을 입력하세요"),
  displayOrder: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
  isWired: z.boolean().default(false),
  bundleNumber: z.string().optional(),
  bundleCarrier: z.string().optional(),
  documentRequired: z.boolean().default(false),
  requireCustomerName: z.boolean().default(true),
  requireCustomerPhone: z.boolean().default(true),
  requireCustomerEmail: z.boolean().default(false),
  requireContactCode: z.boolean().default(true),
  requireCarrier: z.boolean().default(true),
  requirePreviousCarrier: z.boolean().default(false),
  requireDocumentUpload: z.boolean().default(false),
  requireBundleNumber: z.boolean().default(false),
  requireBundleCarrier: z.boolean().default(false),
  allowNewCustomer: z.boolean().default(true),
  allowPortIn: z.boolean().default(true),
  requireDesiredNumber: z.boolean().default(false),
});

export const createSettlementUnitPriceSchema = z.object({
  servicePlanId: z.number().min(1, "서비스 플랜을 선택하세요"),
  newCustomerPrice: z.number().min(0, "신규 정산단가를 입력하세요"),
  portInPrice: z.number().min(0, "번호이동 정산단가를 입력하세요"),
  isActive: z.boolean().default(true),
  effectiveFrom: z.string().optional(),
  effectiveUntil: z.string().optional(),
  memo: z.string().optional(),
});

// Dealer schema
export const createDealerSchema = z.object({
  name: z.string().min(1, '판매점명을 입력하세요'),
  code: z.string().min(1, '판매점 코드를 입력하세요'),
  businessNumber: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('올바른 이메일을 입력하세요').optional().or(z.literal('')),
  managerName: z.string().optional(),
  isActive: z.boolean().default(true)
});

// Dealer account schema
export const createDealerAccountSchema = z.object({
  dealerId: z.number(),
  username: z.string().min(1, '사용자명을 입력하세요'),
  password: z.string().min(6, '비밀번호는 최소 6자 이상이어야 합니다'),
  name: z.string().min(1, '이름을 입력하세요'),
  role: z.string().optional(),
  allowedCarriers: z.array(z.string()).optional()
});

// Update dealer contact codes schema
export const updateDealerContactCodesSchema = z.object({
  dealerId: z.number(),
  contactCodes: z.array(z.string())
});

export const updateSettlementUnitPriceSchema = z.object({
  newCustomerPrice: z.number().min(0, "신규 정산단가를 입력하세요").optional(),
  portInPrice: z.number().min(0, "번호이동 정산단가를 입력하세요").optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: z.string().optional(),
  effectiveUntil: z.string().optional(),
  memo: z.string().optional(),
});

// Removed duplicate createDealerSchema - using the one defined above

// 영업팀 관련 스키마 (신규 추가)
export const createSalesTeamSchema = z.object({
  teamName: z.string().min(1, "영업팀명을 입력하세요"),
  teamCode: z.string().min(1, "영업팀 코드를 입력하세요"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const updateSalesTeamSchema = z.object({
  teamName: z.string().min(1, "영업팀명을 입력하세요"),
  teamCode: z.string().min(1, "영업팀 코드를 입력하세요"),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
});

// 영업과장 관련 스키마 (신규 추가)
export const createSalesManagerSchema = z.object({
  teamId: z.number().min(1, "영업팀을 선택하세요"),
  managerName: z.string().min(1, "과장명을 입력하세요"),
  managerCode: z.string().min(1, "과장 코드를 입력하세요"),
  username: z.string().min(3, "로그인 ID는 최소 3자 이상이어야 합니다"),
  password: z.string().min(6, "비밀번호는 최소 6자 이상이어야 합니다"),
  position: z.string().min(1, "직급을 입력하세요").default('대리'),
  contactPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const updateSalesManagerSchema = z.object({
  teamId: z.number().min(1, "영업팀을 선택하세요"),
  managerName: z.string().min(1, "과장명을 입력하세요"),
  managerCode: z.string().min(1, "과장 코드를 입력하세요"),
  username: z.string().min(3, "로그인 ID는 최소 3자 이상이어야 합니다"),
  password: z.string().optional(),
  position: z.string().min(1, "직급을 입력하세요").default('대리'),
  contactPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

// 접점 코드 관련 스키마 (신규 추가)
export const createContactCodeSchema = z.object({
  code: z.string().min(1, "접점 코드를 입력하세요"),
  dealerName: z.string().min(1, "대리점명을 입력하세요"),
  realSalesPOS: z.string().optional(),
  realSalesPosCode: z.string().optional(),
  carrier: z.string().min(1, "통신사를 입력하세요"),
  salesManagerId: z.number().optional(),
  salesManagerName: z.string().optional(),
  dealerRegistrationId: z.number().optional().nullable(),
  memo: z.string().optional(),
  mCode: z.string().optional(),
  channel: z.string().optional(),
  kpNumber: z.string().optional(),
  regionName: z.string().optional(),
  aliasName: z.string().optional(),
  subDealerName: z.string().optional(),
  sourceDealerName: z.string().optional(),
  codeName: z.string().optional(),
  isActive: z.boolean().default(true),
});

export const updateContactCodeSchema = z.object({
  dealerName: z.string().min(1, "대리점명을 입력하세요"),
  realSalesPOS: z.string().optional(),
  realSalesPosCode: z.string().optional(),
  carrier: z.string().min(1, "통신사를 입력하세요"),
  salesManagerId: z.number().optional(),
  salesManagerName: z.string().optional(),
  dealerRegistrationId: z.number().optional().nullable(),
  memo: z.string().optional(),
  mCode: z.string().optional(),
  channel: z.string().optional(),
  kpNumber: z.string().optional(),
  regionName: z.string().optional(),
  aliasName: z.string().optional(),
  subDealerName: z.string().optional(),
  sourceDealerName: z.string().optional(),
  codeName: z.string().optional(),
  isActive: z.boolean().default(true),
});

// 영업과장 팀 배정 스키마 (신규 추가)
export const assignSalesManagerToTeamSchema = z.object({
  teamId: z.number().min(1, "팀을 선택하세요"),
  salesManagerUserId: z.number().min(1, "영업과장을 선택하세요"),
  managerCode: z.string().min(1, "과장 코드를 입력하세요"),
  position: z.enum(['팀장', '과장', '대리']).default('대리'),
  contactPhone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

// 접점 코드 매핑 관련 스키마 (신규 추가)
export const createContactCodeMappingSchema = z.object({
  managerId: z.number().min(1, "영업과장을 선택하세요"),
  carrier: z.string().min(1, "통신사를 입력하세요"),
  contactCode: z.string().min(1, "접점 코드를 입력하세요"),
  isActive: z.boolean().default(true),
});

export const updateContactCodeMappingSchema = z.object({
  managerId: z.number().min(1, "영업과장을 선택하세요"),
  carrier: z.string().min(1, "통신사를 입력하세요"),
  contactCode: z.string().min(1, "접점 코드를 입력하세요"),
  isActive: z.boolean().default(true),
});

// Form schemas using drizzle-zod
export const insertUserSchema = createInsertSchema(users);
export const insertCarrierSchema = createInsertSchema(carriers);
export const insertServicePlanSchema = createInsertSchema(servicePlans);
export const insertAdditionalServiceSchema = createInsertSchema(additionalServices);
export const insertDocumentSchema = createInsertSchema(documents);
export const insertDealerSchema = createInsertSchema(dealerRegistrations);
export const insertSalesTeamSchema = createInsertSchema(salesTeams);
export const insertSalesManagerSchema = createInsertSchema(salesManagers);
export const insertContactCodeSchema = createInsertSchema(contactCodes);
export const insertContactCodeMappingSchema = createInsertSchema(contactCodeMappings);
export const insertOtherBusinessCarrierSchema = createInsertSchema(otherBusinessCarriers);
export const insertCarrierServicePolicySchema = createInsertSchema(carrierServicePolicies);
export const insertPolicyVersionSchema = createInsertSchema(policyVersions);
export const insertPolicyRowSchema = createInsertSchema(policyRows);
export const insertPolicyFileSchema = createInsertSchema(policyFiles);
export const insertActivationRecordSchema = createInsertSchema(activationRecords);
export const insertSettlementItemSchema = createInsertSchema(settlementItems);
export const insertSettlementFileSchema = createInsertSchema(settlementFiles);
export const insertAdjustmentRuleSchema = createInsertSchema(adjustmentRules);
export const insertHiddenPolicyRowSchema = createInsertSchema(hiddenPolicyRows);

// Form data types
export type CreateUserForm = z.infer<typeof createUserSchema>;
export type CreateAdminForm = z.infer<typeof createAdminSchema>;
export type CreateWorkerForm = z.infer<typeof createWorkerSchema>;
export type CreateDocumentForm = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentStatusForm = z.infer<typeof updateDocumentStatusSchema>;
export type UpdateActivationStatusForm = z.infer<typeof updateActivationStatusSchema>;
export type CreateServicePlanForm = z.infer<typeof createServicePlanSchema>;
export type CreateAdditionalServiceForm = z.infer<typeof createAdditionalServiceSchema>;
export type CreateCarrierForm = z.infer<typeof createCarrierSchema>;
export type CreateSettlementUnitPriceForm = z.infer<typeof createSettlementUnitPriceSchema>;
export type UpdateSettlementUnitPriceForm = z.infer<typeof updateSettlementUnitPriceSchema>;
export type CreateDealerForm = z.infer<typeof createDealerSchema>;
export type CreateSalesTeamForm = z.infer<typeof createSalesTeamSchema>;
export type UpdateSalesTeamForm = z.infer<typeof updateSalesTeamSchema>;
export type CreateSalesManagerForm = z.infer<typeof createSalesManagerSchema>;
export type UpdateSalesManagerForm = z.infer<typeof updateSalesManagerSchema>;
export type CreateContactCodeForm = z.infer<typeof createContactCodeSchema>;
export type UpdateContactCodeForm = z.infer<typeof updateContactCodeSchema>;
export type CreateContactCodeMappingForm = z.infer<typeof createContactCodeMappingSchema>;
export type UpdateContactCodeMappingForm = z.infer<typeof updateContactCodeMappingSchema>;

// Select types from tables
export type UserSelect = typeof users.$inferSelect;
export type CarrierSelect = typeof carriers.$inferSelect;
export type ServicePlanSelect = typeof servicePlans.$inferSelect;
export type AdditionalServiceSelect = typeof additionalServices.$inferSelect;
export type DocumentSelect = typeof documents.$inferSelect;
export type DealerSelect = typeof dealerRegistrations.$inferSelect;
export type SalesTeamSelect = typeof salesTeams.$inferSelect;
export type SalesManagerSelect = typeof salesManagers.$inferSelect;
export type ContactCodeSelect = typeof contactCodes.$inferSelect;
export type ContactCodeMappingSelect = typeof contactCodeMappings.$inferSelect;
export type OtherBusinessCarrierSelect = typeof otherBusinessCarriers.$inferSelect;
export type CarrierServicePolicySelect = typeof carrierServicePolicies.$inferSelect;
export type PolicyVersionSelect = typeof policyVersions.$inferSelect;
export type PolicyRowSelect = typeof policyRows.$inferSelect;
export type PolicyFileSelect = typeof policyFiles.$inferSelect;
export type ActivationRecordSelect = typeof activationRecords.$inferSelect;
export type SettlementItemSelect = typeof settlementItems.$inferSelect;
export type SettlementFileSelect = typeof settlementFiles.$inferSelect;
export type AdjustmentRuleSelect = typeof adjustmentRules.$inferSelect;
export type HiddenPolicyRowSelect = typeof hiddenPolicyRows.$inferSelect;

// Login response type
export type LoginResponse = {
  success: boolean;
  user: AuthUser;
  sessionId: string;
};

// Auth user type (공통)
export type AuthUser = {
  id: number;
  name: string;
  username: string;
  userType: 'admin' | 'user' | 'sales_manager' | 'dealer';
  userRole?: string;
  dealerId?: number;
  dealerRegistrationId?: number;
  dealerCode?: string;
  isHiddenPos?: boolean;
  managerId?: number;
  teamId?: number;
};

// Login success response type
export type LoginSuccessResponse = {
  success: boolean;
  user: AuthUser;
  sessionId: string;
};

// Authentication types (used by routes.ts)
export type AuthResponse = {
  success: boolean;
  user?: AuthUser;
  sessionId?: string;
  error?: string;
};

export type AuthSession = {
  sessionId: string;
  userId: number;
  userType: 'admin' | 'user' | 'sales_manager' | 'dealer';
  userRole?: string;
  dealerId?: number;
  dealerRegistrationId?: number;
  managerId?: number;
  teamId?: number;
  username?: string;
  name?: string;
  user?: AuthUser;
  createdAt: string;
  expiresAt?: Date;
};