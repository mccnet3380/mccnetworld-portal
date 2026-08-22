import { eq, count, sql, and, gte, lt, lte, inArray, isNull, desc, or, getTableColumns } from "drizzle-orm";
import { nanoid } from "nanoid";
import bcrypt from "bcrypt";
import crypto from "crypto";
import {
  users,
  admins,
  documents,
  sessions,
  carriers,
  servicePlans,
  additionalServices,
  contactCodes,
  hiddenPricesByPos,
  otherBusinessCarriers,
  salesManagers,
  salesTeams,
  carrierServicePolicies,
  chatRooms,
  chatMessages,
  dealerRegistrations,
  policyVersions,
  policyRows,
  policyFiles,
  activationRecords,
  settlementItems,
  settlementFiles,
  adjustmentRules,
  hiddenPolicyRows,
} from "../shared/schema";
import { getDatabase, getSchemaInfo } from "./db";

// 🔍 배치 동기화 디버그 로깅 제어
// 개발에서는 기본 on, 운영에서는 기본 off (운영에서도 LOG_BATCH_DEBUG=true로 임시 활성 가능)
const LOG_BATCH_DEBUG =
  (process.env.LOG_BATCH_DEBUG ?? "").toLowerCase() === "true" ||
  (process.env.APP_ENV ?? "development") !== "production";

// ✅ child 문서 판별용 SQL 패턴: notes LIKE %\"isChild\":true%
const CHILD_LIKE = `%\\"isChild\\":true%`;

/** UTC Date → KST 날짜 문자열 (YYYY-MM-DD). 히든정책 기간 비교에 사용. */
const toKSTDateStr = (date: Date): string => {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
};

/** notes 문자열에서 batchId 안전 추출 */
function extractBatchIdFromNotes(notes?: string | null): string | null {
  if (!notes) return null;

  // 1) __BATCH_META__ 섹션 안의 "batchId":"..." 우선 탐지
  let m = notes.match(/__BATCH_META__\s*:\s*\{[^}]*"batchId"\s*:\s*"([^"]+)"[^}]*\}/);
  if (m?.[1]) return m[1];

  // 2) 전체 문자열에서 "batchId":"..." 일반 탐지(폴백)
  m = notes.match(/"batchId"\s*:\s*"([^"]+)"/);
  if (m?.[1]) return m[1];

  return null;
}

/** LIKE 검색에 사용할 안전한 패턴 생성: %"batchId":"<id>"% */
function likePatternForBatchId(batchId: string): string {
  // SQL LIKE 와일드카드 문자 이스케이프 (%, _)
  const escaped = batchId.replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%"batchId":"${escaped}"%`;
}

function logBatch(...args: any[]) {
  if (LOG_BATCH_DEBUG) console.log("[BatchSync]", ...args);
}

// 🚨 CRITICAL: 세션 토큰 마스킹 유틸리티
function maskSessionToken(token: string): string {
  if (!token || token.length < 8) return '***';
  return token.substring(0, 4) + '***' + token.substring(token.length - 4);
}

// KST 월 범위 계산 유틸리티
function getKstMonthRange(date: Date = new Date()): { startUtc: Date; endUtc: Date } {
  // KST는 UTC+9
  const kstOffset = 9 * 60 * 60 * 1000;
  
  // 현재 시간을 KST로 변환
  const kstTime = new Date(date.getTime() + kstOffset);
  
  // KST 기준 월의 시작 (1일 00:00:00)
  const kstMonthStart = new Date(Date.UTC(
    kstTime.getUTCFullYear(),
    kstTime.getUTCMonth(),
    1, 0, 0, 0, 0
  ));
  
  // KST 기준 다음 월의 시작 (1일 00:00:00)
  const kstMonthEnd = new Date(Date.UTC(
    kstTime.getUTCFullYear(),
    kstTime.getUTCMonth() + 1,
    1, 0, 0, 0, 0
  ));
  
  // UTC로 변환 (KST - 9시간)
  const startUtc = new Date(kstMonthStart.getTime() - kstOffset);
  const endUtc = new Date(kstMonthEnd.getTime() - kstOffset);
  
  return { startUtc, endUtc };
}

// 🔐 환경별 세션 서명/검증 유틸리티
function getSessionSecret(): string {
  const secret = process.env.APP_ENV === 'production' 
    ? process.env.SESSION_SECRET 
    : process.env.DEV_SESSION_SECRET;
  
  if (!secret) {
    throw new Error(`Missing session secret for ${process.env.APP_ENV} environment`);
  }
  return secret;
}

function signSessionToken(sessionId: string): string {
  const secret = getSessionSecret();
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(sessionId);
  return hmac.digest('hex');
}

function verifySessionToken(sessionId: string, signature: string): boolean {
  try {
    const expectedSignature = signSessionToken(sessionId);
    return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
  } catch {
    return false;
  }
}

export interface IStorage {
  // Auth methods
  authenticateAdmin(username: string, password: string): Promise<any>;
  authenticateUser(username: string, password: string): Promise<any>;
  authenticateSalesManager(username: string, password: string): Promise<any>;
  authenticateWorker(username: string, password: string): Promise<any>;

  // Session methods
  createSession(userId: number, userType: string): Promise<string>;
  getSession(sid: string): Promise<any>;
  deleteSession(sid: string): Promise<void>;

  // Admin methods
  createAdmin(admin: any): Promise<any>;
  getAdminById(id: number): Promise<any>;
  getAdminByUsername(username: string): Promise<any>;
  getAdmins(): Promise<any[]>;
  updateAdminPassword(id: number, pw: string): Promise<void>;
  getAdminCount(): Promise<number>;
  deleteAdmin(id: number): Promise<any>;
  updateAdmin(id: number, data: any): Promise<any>;

  // User methods
  createUser(user: any): Promise<any>;
  getUserById(id: number): Promise<any>;
  getUsers(): Promise<any[]>;
  updateUserPassword(id: number, password: string): Promise<void>;
  getUserByUsername(username: string): Promise<any>;
  deleteUser(id: number): Promise<any>;

  // Dealer methods
  createDealer(dealer: any): Promise<any>;
  getDealers(): Promise<any[]>;
  getDealerById(id: number): Promise<any>;
  getDealerRegistration(id: number): Promise<any>;
  updateDealer(id: number, data: any): Promise<void>;
  deleteDealer(id: number): Promise<void>;

  // Dealer Registration (원장) methods
  getDealerRegistrations(options?: { search?: string; isHiddenPos?: boolean; isActive?: boolean; includeInactive?: boolean }): Promise<any[]>;
  getDealerRegistrationByDealerCode(dealerCode: string): Promise<any | null>;
  createDealerRegistration(data: any): Promise<any>;
  updateDealerRegistration(id: number, data: any): Promise<any>;
  deleteDealerRegistration(id: number): Promise<void>;
  backfillDealerRegistrationIds(): Promise<{ updated: number; created: number; skipped: number; errors: string[] }>;
  upsertDealerRegistrationByMCode(data: { mCode: string; businessName: string; sourceDealerName?: string; subDealerName?: string; kpNumber?: string; regionName?: string }): Promise<{ action: 'created' | 'updated' | 'review'; reason?: string; record: any }>;

  // Document methods
  createDocument(document: any): Promise<any>;
  getDocuments(filters?: any, userId?: number, userType?: string): Promise<any>;
  getDocumentById(id: number): Promise<any>;
  updateDocument(id: number, data: any): Promise<void>;
  updateDocumentStatus(id: number, status: string, updatedBy?: number): Promise<void>;
  deleteDocument(id: number): Promise<void>;
  getDocumentStatistics(): Promise<any>;

  // Chat methods
  createChatRoom(documentId: number): Promise<any>;
  getChatRoomByDocumentId(documentId: number): Promise<any | null>;
  createChatMessage(message: any): Promise<any>;
  getChatMessages(chatRoomId: number): Promise<any[]>;
  getUnreadMessageCount(userId: number, userType: string): Promise<any>;
  markChatMessagesAsRead(chatRoomId: number, userId: number, userType: string): Promise<void>;

  // Stats methods
  getDashboardStats(): Promise<any>;
  getActivationStats(): Promise<any>;
  getTodayStats(userId?: number, userType?: string): Promise<any>;
  getMonthlyActivationStats(userId?: number, userType?: string): Promise<any[]>;
  getMonthlyStatusStats(userId?: number, userType?: string): Promise<any>;
  getCarrierStats(userId?: number, userType?: string): Promise<any[]>;
  getMonthlyActivationSummary(userId?: number, userType?: string): Promise<any>;
  getWorkerStats(userId?: number, userType?: string): Promise<any[]>;
  getWorkerCarrierStats(workerId: number, workerType: string): Promise<any>;
  getCarrierWorkerStats(carrier: string): Promise<any>;
  getAdminActivationStats(adminId: number): Promise<any>;

  // Service plans methods
  getServicePlans(): Promise<any[]>;
  createServicePlan(plan: any): Promise<any>;
  updateServicePlan(id: number, data: any): Promise<any>;
  deleteServicePlan(id: number): Promise<any>;

  // Contact codes methods
  getContactCodes(carrier?: string, options?: { page?: number; limit?: number; search?: string; dealerRegistrationId?: number; includeRealSalesPOSMatch?: boolean }): Promise<any>;
  getContactCodeByCode(code: string): Promise<any>;
  getContactCodeByCarrierAndCode(carrier: string, code: string): Promise<any>;
  // 개통 매칭 엔진용 — 다건 반환 (LIMIT 없음)
  getContactCodesByMCodeAndCode(mCode: string, code: string): Promise<any[]>;
  getContactCodesByMCodeAndCodeName(mCode: string, codeName: string): Promise<any[]>;
  getContactCodesByCodeAll(code: string): Promise<any[]>;
  getContactCodesByMCode(mCode: string): Promise<any[]>;
  getContactCodesByNameFields(dealerName?: string | null, codeName?: string | null): Promise<any[]>;
  searchContactCodes(query: string, limit?: number): Promise<any[]>;
  getContactCodeAutoMatch(dealerName: string, carrier: string): Promise<any | null>;
  createContactCode(code: any): Promise<any>;
  updateContactCode(id: number, data: { code?: string; dealerName?: string; carrier?: string; salesManagerId?: number | null; salesManagerName?: string | null; realSalesPOS?: string | null; realSalesPosCode?: string | null; memo?: string | null; isActive?: boolean; dealerRegistrationId?: number | null }): Promise<any>;
  upsertContactCode(data: { code: string; dealerName: string; realSalesPOS?: string | null; realSalesPosCode?: string | null; carrier: string; salesManagerName?: string | null; dealerRegistrationId?: number | null; memo?: string | null; isActive?: boolean; mCode?: string | null; channel?: string | null; kpNumber?: string | null; regionName?: string | null; aliasName?: string | null; subDealerName?: string | null; sourceDealerName?: string | null; codeName?: string | null }): Promise<{ action: 'created' | 'updated'; record: any }>;
  bulkCreateContactCodes(codes: any[]): Promise<number>;
  deleteContactCode(id: number): Promise<void>;

  // Carrier methods
  getCarriers(): Promise<any[]>;
  getCarrierById(id: number): Promise<any>;
  createCarrier(carrier: any): Promise<any>;
  updateCarrier(id: number, data: any): Promise<void>;
  deleteCarrier(id: number): Promise<void>;

  // Other business carriers
  getOtherBusinessCarriers(): Promise<any[]>;
  createOtherBusinessCarrier(carrier: any): Promise<any>;
  updateOtherBusinessCarrier(id: number, data: any): Promise<void>;
  deleteOtherBusinessCarrier(id: number): Promise<void>;

  // Hidden prices by pos
  getHiddenPricesByPos(): Promise<any[]>;
  createHiddenPriceByPos(price: any): Promise<any>;
  updateHiddenPriceByPos(id: number, data: any): Promise<void>;
  deleteHiddenPriceByPos(id: number): Promise<void>;

  // Sales teams
  getSalesTeams(): Promise<any[]>;
  createSalesTeam(team: any): Promise<any>;
  updateSalesTeam(id: number, data: any): Promise<void>;
  deleteSalesTeam(id: number): Promise<void>;

  // Sales managers
  getSalesManagers(): Promise<any[]>;
  getSalesManagerById(id: number): Promise<any>;
  createSalesManager(manager: any): Promise<any>;
  updateSalesManager(id: number, data: any): Promise<void>;
  deleteSalesManager(id: number): Promise<void>;

  // Additional services
  getAdditionalServices(carrier?: string): Promise<any[]>;
  createAdditionalService(service: any): Promise<any>;
  updateAdditionalService(id: number, data: any): Promise<void>;
  deleteAdditionalService(id: number): Promise<void>;

  // Settlement unit prices
  getSettlementUnitPrices(): Promise<any[]>;
  createSettlementUnitPrice(price: any): Promise<any>;
  updateSettlementUnitPrice(id: number, data: any): Promise<void>;
  deleteSettlementUnitPrice(id: number): Promise<void>;

  // Carrier service policies
  getCarrierServicePolicies(): Promise<any[]>;
  getCarrierServicePolicyById(id: number): Promise<any>;
  createCarrierServicePolicy(policy: any): Promise<any>;
  updateCarrierServicePolicy(id: number, data: any): Promise<void>;
  deleteCarrierServicePolicy(id: number): Promise<void>;

  // Document templates
  getDocumentTemplates(): Promise<any[]>;
  createDocumentTemplate(template: any): Promise<any>;
  updateDocumentTemplate(id: number, data: any): Promise<void>;
  deleteDocumentTemplate(id: number): Promise<void>;

  // Settlements
  getSettlements(): Promise<any[]>;
  createSettlementsFromActivatedDocuments(): Promise<any>;

  // User filtering
  getUsersByType(type: string): Promise<any[]>;

  // ── 정산 엔진 (STEP 5C) ──────────────────────────────────────

  // Policy versions
  getPolicyVersions(): Promise<any[]>;
  getPolicyVersionById(id: number): Promise<any | null>;
  getActivePolicyVersion(): Promise<any | null>;
  createPolicyVersion(data: any): Promise<any>;
  updatePolicyVersion(id: number, data: any): Promise<any>;
  deletePolicyVersion(id: number): Promise<void>;

  // Policy rows
  getPolicyRowsByVersionId(policyVersionId: number): Promise<any[]>;
  createPolicyRow(data: any): Promise<any>;
  bulkCreatePolicyRows(data: any[]): Promise<number>;
  updatePolicyRow(id: number, data: any): Promise<any>;
  deletePolicyRow(id: number): Promise<void>;
  deletePolicyRowsByVersionId(policyVersionId: number): Promise<number>;

  // Policy files
  getPolicyFilesByVersionId(policyVersionId: number): Promise<any[]>;
  createPolicyFile(data: any): Promise<any>;
  deletePolicyFile(id: number): Promise<void>;

  // Activation records
  getActivationRecords(filters?: {
    dealerRegistrationId?: number;
    channel?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; page: number; limit: number }>;
  getActivationRecordById(id: number): Promise<any | null>;
  createActivationRecord(data: any): Promise<any>;
  updateActivationRecord(id: number, data: any): Promise<any>;
  deleteActivationRecord(id: number): Promise<void>;

  // Settlement items
  getSettlementItems(filters?: {
    dealerRegistrationId?: number;
    status?: string;
    matchStatus?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: any[];
    page: number;
    limit: number;
    summary: { total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number };
    groups: Array<{ dealerName: string; total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number; sumPolicy: number; sumAdjusted: number; sumConfirmed: number; items: any[] }>;
    totalGroups: number;
  }>;
  getSettlementItemById(id: number): Promise<any | null>;
  getSettlementItemByActivationId(activationId: number): Promise<any | null>;
  createSettlementItem(data: any): Promise<any>;
  updateSettlementItem(id: number, data: any): Promise<any>;
  lockSettlementItem(id: number, adminId: number): Promise<any>;
  getSettlementItemsForExport(filters?: {
    status?: string;
    matchStatus?: string;
    dealerRegistrationId?: number;
    from?: Date;
    to?: Date;
  }): Promise<any[]>;

  // Settlement files
  getSettlementFilesByItemId(settlementItemId: number): Promise<any[]>;
  createSettlementFile(data: any): Promise<any>;
  deleteSettlementFile(id: number): Promise<void>;

  // Adjustment rules
  getAdjustmentRulesByVersionId(policyVersionId: number): Promise<any[]>;
  createAdjustmentRule(data: any): Promise<any>;
  updateAdjustmentRule(id: number, data: any): Promise<any>;
  calculateSettlementAdjustments(record: any, policyVersionId: number): Promise<{ addAmount: number; deductAmount: number }>;

  // Hidden policy rows
  getHiddenPolicyRows(filters?: { dealerRegistrationId?: number; isActive?: boolean }): Promise<any[]>;
  createHiddenPolicyRow(data: any): Promise<any>;
  updateHiddenPolicyRow(id: number, data: any): Promise<any>;
  calculateHiddenAmount(record: any): Promise<number>;
  recalculateHiddenAmounts(options: {
    dateFrom?: string;
    dateTo?: string;
    onlyUnsettled?: boolean;
    dryRun?: boolean;
    debugContactCode?: string;
  }): Promise<{
    totalTargets: number;
    updated: number;
    cleared: number;
    skippedLocked: number;
    skippedNoContactCode: number;
    skippedNoDealer: number;
    skippedNotHiddenPos: number;
    skippedNoPolicy: number;
    policyMismatchDetail: { dealerMismatch: number; contactCodeMismatch: number; channelMismatch: number; planNameMismatch: number; customerTypeMismatch: number; periodMismatch: number };
    errors: string[];
    debug?: any;
  }>;
  diagnoseHiddenAmount(contactCode: string, dateFrom?: string, dateTo?: string): Promise<any>;
}

export class PostgreSQLStorage implements IStorage {
  private async withDatabase<T>(operation: (db: any) => Promise<T>): Promise<T> {
    const db = await getDatabase();
    return operation(db);
  }

  // 동일 mCode 행을 직렬화해 SELECT→INSERT race condition 방지
  private readonly _mCodeLocks = new Map<string, Promise<void>>();
  private withMCodeLock<T>(mCode: string, fn: () => Promise<T>): Promise<T> {
    const key = mCode.toLowerCase().trim();
    const prev = this._mCodeLocks.get(key) ?? Promise.resolve();
    let resolve!: () => void;
    const current = new Promise<void>(r => { resolve = r; });
    this._mCodeLocks.set(key, current);
    return prev.then(() => fn()).finally(() => {
      resolve();
      if (this._mCodeLocks.get(key) === current) this._mCodeLocks.delete(key);
    });
  }

  async authenticateAdmin(username: string, password: string) {
    return this.withDatabase(async (db) => {
      const admin = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
      if (admin.length === 0) return null;

      const isValidPassword = await bcrypt.compare(password, admin[0].password);
      if (!isValidPassword) return null;

      return admin[0];
    });
  }

  async authenticateUser(username: string, password: string) {
    return this.withDatabase(async (db) => {
      // First check users table (workers, sales managers, etc)
      const user = await db.select().from(users).where(eq(users.username, username)).limit(1);
      
      if (user.length > 0 && user[0].password) {
        const isValidPassword = await bcrypt.compare(password, user[0].password);
        if (!isValidPassword) return null;

        return {
          id: user[0].id,
          username: user[0].username,
          name: user[0].name,
          userType: user[0].userType,
          dealerId: user[0].dealerId,
          dealerRegistrationId: user[0].dealerRegistrationId,
          role: user[0].role,
          allowedCarriers: user[0].allowedCarriers
        };
      }

      // If no password in users table, check dealer_registrations table
      const dealer = await db.select().from(dealerRegistrations).where(eq(dealerRegistrations.username, username)).limit(1);
      if (dealer.length === 0) return null;

      const isValidPassword = await bcrypt.compare(password, dealer[0].password);
      if (!isValidPassword) return null;

      // Find the corresponding user record by username
      const dealerUser = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (dealerUser.length === 0) return null;

      return {
        id: dealerUser[0].id,
        username: dealer[0].username,
        name: dealer[0].businessName,
        userType: 'user',
        dealerId: dealerUser[0].dealerId,
        dealerRegistrationId: dealerUser[0].dealerRegistrationId,
        role: null,
        allowedCarriers: null
      };
    });
  }

  async authenticateSalesManager(username: string, password: string) {
    return null;
  }

  async authenticateWorker(username: string, password: string) {
    return null;
  }

  async createSession(userId: number, userType: string): Promise<string> {
    const sessionId = nanoid();
    const signature = signSessionToken(sessionId);
    const signedSessionId = `${sessionId}.${signature}`;
    
    console.log(`🔐 Creating session: ${maskSessionToken(signedSessionId)} for user ${userId} (${userType})`);
    console.log(`🔐 Session signed with ${process.env.APP_ENV} secret`);
    
    return this.withDatabase(async (db) => {
      await db.insert(sessions).values({
        sid: signedSessionId,
        userId,
        userType,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        sess: {
          userId,
          userType,
          timestamp: new Date().toISOString(),
          signature
        },
        expire: new Date(Date.now() + 24 * 60 * 60 * 1000)
      });
      
      return signedSessionId;
    });
  }

  async getSession(sid: string) {
    return this.withDatabase(async (db) => {
      const LEGACY_CUTOFF_DATE = new Date('2026-12-31T00:00:00Z');
      const now = new Date();
      
      const parts = sid.split('.');
      if (parts.length === 2) {
        const [sessionId, signature] = parts;
        if (verifySessionToken(sessionId, signature)) {
          const session = await db.select().from(sessions).where(eq(sessions.sid, sid)).limit(1);
          if (session.length > 0) {
            if (now > session[0].expiresAt) {
              await this.deleteSession(sid);
              return null;
            }
            console.log(`✅ Valid signed session: ${maskSessionToken(sid)} (expires at ${session[0].expiresAt.toISOString()})`);
            return session[0];
          }
        } else {
          console.warn(`❌ Session signature verification failed: ${maskSessionToken(sid)}`);
          return null;
        }
      }
      
      if (now < LEGACY_CUTOFF_DATE) {
        console.warn(`⚠️ Legacy session format detected: ${maskSessionToken(sid)} (cutoff: ${LEGACY_CUTOFF_DATE.toISOString()})`);
        
        const legacySession = await db.select().from(sessions).where(eq(sessions.sid, sid)).limit(1);
        if (legacySession.length > 0) {
          if (now > legacySession[0].expiresAt) {
            await this.deleteSession(sid);
            return null;
          }
          console.log(`✅ Valid legacy session: ${maskSessionToken(sid)} (expires at ${legacySession[0].expiresAt.toISOString()})`);
          return legacySession[0];
        }
      } else {
        console.error(`❌ Legacy session support ended on ${LEGACY_CUTOFF_DATE.toISOString()}: ${maskSessionToken(sid)}`);
      }
      
      console.warn(`❌ Session not found or invalid: ${maskSessionToken(sid)}`);
      return null;
    });
  }

  async deleteSession(sid: string): Promise<void> {
    console.log(`🗑️ Deleting session: ${maskSessionToken(sid)}`);
    return this.withDatabase(async (db) => {
      await db.delete(sessions).where(eq(sessions.sid, sid));
    });
  }

  async createAdmin(adminData: any) {
    return this.withDatabase(async (db) => {
      const hashedPassword = await bcrypt.hash(adminData.password, 10);
      const result = await db.insert(admins).values({
        username: adminData.username,
        password: hashedPassword,
        name: adminData.name
      }).returning();
      return result[0];
    });
  }

  async getAdminById(id: number) {
    return this.withDatabase(async (db) => {
      const admin = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
      return admin.length > 0 ? admin[0] : null;
    });
  }

  async getAdminByUsername(username: string) {
    return this.withDatabase(async (db) => {
      const admin = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
      return admin.length > 0 ? admin[0] : null;
    });
  }

  async updateAdminPassword(id: number, password: string): Promise<void> {
    return this.withDatabase(async (db) => {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.update(admins).set({ password: hashedPassword }).where(eq(admins.id, id));
    });
  }

  async getAdminCount(): Promise<number> {
    return this.withDatabase(async (db) => {
      const result = await db.select({ count: count() }).from(admins);
      return result[0].count;
    });
  }

  async deleteAdmin(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const admin = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
      if (admin.length === 0) {
        return null;
      }
      if (admin[0].username === 'kksnan') {
        throw new Error('SUPER ADMIN 계정은 삭제할 수 없습니다.');
      }
      
      const result = await db.delete(admins).where(eq(admins.id, id)).returning();
      return result[0];
    });
  }

  async updateAdmin(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const admin = await db.select().from(admins).where(eq(admins.id, id)).limit(1);
      if (admin.length === 0) {
        return null;
      }
      if (admin[0].username === 'kksnan' && data.username !== undefined && data.username !== 'kksnan') {
        throw new Error('SUPER ADMIN의 아이디는 변경할 수 없습니다.');
      }
      
      const updateData: any = {};
      
      if (data.name !== undefined) updateData.name = data.name;
      if (data.username !== undefined) updateData.username = data.username;
      if (data.password !== undefined) {
        updateData.password = await bcrypt.hash(data.password, 10);
      }
      
      const result = await db.update(admins)
        .set(updateData)
        .where(eq(admins.id, id))
        .returning();
      return result[0];
    });
  }

  async getAdmins(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(admins);
    });
  }

  async createUser(userData: any) {
    return this.withDatabase(async (db) => {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const result = await db.insert(users).values({
        ...userData,
        password: hashedPassword
      }).returning();
      return result[0];
    });
  }

  async getUserById(id: number) {
    return this.withDatabase(async (db) => {
      const user = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return user.length > 0 ? user[0] : null;
    });
  }

  async getUsers(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      const regularUsers = await db.select({
        id: users.id,
        name: users.name,
        username: users.username,
        userType: users.userType
      }).from(users);
      
      const adminUsers = await db.select({
        id: admins.id,
        name: admins.name,
        username: admins.username
      }).from(admins);
      
      // admins와 users를 합쳐서 반환 (admins에 userType 추가)
      const allUsers = [
        ...adminUsers.map((admin: any) => ({
          id: admin.id,
          name: admin.name,
          username: admin.username,
          userType: 'admin'
        })),
        ...regularUsers.map((user: any) => ({
          id: user.id,
          name: user.name,
          username: user.username,
          userType: user.userType
        }))
      ];
      
      return allUsers;
    });
  }

  async updateUserPassword(id: number, password: string): Promise<void> {
    return this.withDatabase(async (db) => {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
    });
  }

  async deleteUser(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.delete(users).where(eq(users.id, id)).returning();
      return result[0];
    });
  }

  async getUserByUsername(username: string) {
    return this.withDatabase(async (db) => {
      const user = await db.select().from(users).where(eq(users.username, username)).limit(1);
      return user.length > 0 ? user[0] : null;
    });
  }

  async createDealer(dealer: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(users).values(dealer).returning();
      return result[0];
    });
  }

  async getDealers(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      // dealerId가 있는 사용자들을 판매점으로 반환
      return await db.select().from(users).where(sql`${users.dealerId} IS NOT NULL`);
    });
  }

  async getDealerById(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const dealer = await db.select().from(dealerRegistrations).where(eq(dealerRegistrations.id, id)).limit(1);
      return dealer.length > 0 ? dealer[0] : null;
    });
  }

  async getDealerRegistration(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(dealerRegistrations)
        .where(eq(dealerRegistrations.id, id))
        .limit(1);
      return result.length > 0 ? result[0] : null;
    });
  }

  async getDealerRegistrationByDealerCode(dealerCode: string): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const rows = await db.select().from(dealerRegistrations)
        .where(eq(dealerRegistrations.dealerCode, dealerCode))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  // 비교용 정규화: 앞 접두어(구), 호), 원), 웅), 협력) 등) 제거 + 공백 정리 + 소문자
  private normalizeDealerName(name: string): string {
    if (!name) return '';
    return name.trim()
      .replace(/^[가-힣]{1,3}[)）]\s*/, '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private async generateDealerCode(db: any): Promise<string> {
    const rows = await db.select({ dealerCode: dealerRegistrations.dealerCode })
      .from(dealerRegistrations)
      .where(sql`${dealerRegistrations.dealerCode} IS NOT NULL`)
      .orderBy(desc(dealerRegistrations.dealerCode))
      .limit(1);

    if (rows.length === 0) return 'MCC0001';

    const last = rows[0].dealerCode as string;
    const num = parseInt(last.replace('MCC', ''), 10);
    if (isNaN(num)) return 'MCC0001';
    return `MCC${String(num + 1).padStart(4, '0')}`;
  }

  async getDealerRegistrations(options?: { search?: string; isHiddenPos?: boolean; isContactPolicyPos?: boolean; isActive?: boolean; includeInactive?: boolean }): Promise<any[]> {
    return this.withDatabase(async (db) => {
      let query = db.select().from(dealerRegistrations);
      const conditions: any[] = [];

      if (options?.search) {
        const term = `%${options.search}%`;
        conditions.push(
          sql`(${dealerRegistrations.businessName} ILIKE ${term}
            OR ${dealerRegistrations.dealerCode} ILIKE ${term}
            OR ${dealerRegistrations.representativeName} ILIKE ${term})`
        );
      }
      if (typeof options?.isHiddenPos === 'boolean') {
        conditions.push(eq(dealerRegistrations.isHiddenPos, options.isHiddenPos));
      }
      if (typeof options?.isContactPolicyPos === 'boolean') {
        conditions.push(eq(dealerRegistrations.isContactPolicyPos, options.isContactPolicyPos));
      }
      if (options?.includeInactive) {
        // 비활성 포함 — isActive 필터 없음
      } else if (typeof options?.isActive === 'boolean') {
        conditions.push(eq(dealerRegistrations.isActive, options.isActive));
      } else {
        // 기본: 활성 레코드만 반환
        conditions.push(eq(dealerRegistrations.isActive, true));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      return await (query as any).orderBy(desc(dealerRegistrations.createdAt));
    });
  }

  async createDealerRegistration(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const dealerCode = await this.generateDealerCode(db);
      const hashedPassword = data.password
        ? await bcrypt.hash(data.password, 10)
        : await bcrypt.hash(nanoid(12), 10);

      const insertData = {
        dealerCode,
        businessName: data.businessName,
        representativeName: data.representativeName,
        businessNumber: data.businessNumber,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail ?? null,
        address: data.address,
        bankAccount: data.bankAccount ?? null,
        bankName: data.bankName ?? null,
        accountHolder: data.accountHolder ?? null,
        username: data.username,
        password: hashedPassword,
        status: data.status ?? '승인',
        isActive: data.isActive ?? true,
        isHiddenPos: data.isHiddenPos ?? false,
        isContactPolicyPos: data.isContactPolicyPos ?? false,
      };

      const result = await db.insert(dealerRegistrations).values(insertData).returning();
      const dealerRegId = result[0].id;

      // users 테이블에 동일 username 계정이 있으면 dealer_registration_id만 연결,
      // 없으면 신규 생성 (userType: 'user' 유지 — 기존 미들웨어 호환)
      const existingUser = await db.select().from(users)
        .where(eq(users.username, data.username))
        .limit(1);
      if (existingUser.length > 0) {
        await db.update(users)
          .set({ dealerRegistrationId: dealerRegId })
          .where(eq(users.username, data.username));
      } else {
        await db.insert(users).values({
          username: data.username,
          password: hashedPassword,
          name: data.businessName,
          userType: 'user',
          dealerRegistrationId: dealerRegId,
        });
      }

      return result[0];
    });
  }

  async updateDealerRegistration(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const updateData: any = { updatedAt: new Date() };

      const fields = [
        'businessName', 'representativeName', 'businessNumber',
        'contactPhone', 'contactEmail', 'address',
        'bankAccount', 'bankName', 'accountHolder',
        'username', 'status', 'isActive', 'isHiddenPos', 'isContactPolicyPos',
        'mCode', 'kpNumber', 'regionName', 'sourceDealerName', 'subDealerName', 'settlementOnly',
      ] as const;

      for (const f of fields) {
        if (data[f] !== undefined) updateData[f] = data[f];
      }

      if (data.password && data.password.trim() !== '') {
        updateData.password = await bcrypt.hash(data.password, 10);
      }

      const result = await db.update(dealerRegistrations)
        .set(updateData)
        .where(eq(dealerRegistrations.id, id))
        .returning();
      return result[0] ?? null;
    });
  }

  async deleteDealerRegistration(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(dealerRegistrations).where(eq(dealerRegistrations.id, id));
    });
  }

  async upsertDealerRegistrationByMCode(data: {
    mCode: string;
    businessName: string;
    sourceDealerName?: string;
    subDealerName?: string;
    kpNumber?: string;
    regionName?: string;
  }): Promise<{ action: 'created' | 'updated' | 'review'; reason?: string; record: any }> {
    return this.withMCodeLock(data.mCode, () =>
    this.withDatabase(async (db) => {
      let existing: any[] = [];

      // ── 0순위: m_code + business_name 완전 일치 (동일 행 재처리 / race 방어) ─
      existing = await db.select().from(dealerRegistrations)
        .where(and(
          eq(dealerRegistrations.mCode, data.mCode),
          eq(dealerRegistrations.businessName, data.businessName),
        ));

      // ── 1순위: m_code + kp_number + sub_dealer_name 완전 일치 ──────────────
      if (existing.length === 0 && data.kpNumber && data.subDealerName) {
        existing = await db.select().from(dealerRegistrations)
          .where(and(
            eq(dealerRegistrations.mCode, data.mCode),
            eq(dealerRegistrations.kpNumber, data.kpNumber),
            eq(dealerRegistrations.subDealerName, data.subDealerName),
          ));
      }

      // ── 2순위~4순위: 같은 m_code 전체를 가져와 정규화 이름 비교 ─────────────
      // KP번호 유무만 다른 동일 판매점이 별개 레코드로 생성되는 것을 방지
      if (existing.length === 0) {
        const candidates = await db.select().from(dealerRegistrations)
          .where(eq(dealerRegistrations.mCode, data.mCode));

        if (candidates.length > 0) {
          const normSource = this.normalizeDealerName(data.sourceDealerName ?? '');
          const normSub    = this.normalizeDealerName(data.subDealerName ?? '');
          const normBiz    = this.normalizeDealerName(data.businessName ?? '');

          // 2순위: normalized source_dealer_name + normalized sub_dealer_name
          if (normSource) {
            existing = candidates.filter(r => {
              const rSource = this.normalizeDealerName(r.sourceDealerName ?? '');
              const rSub    = this.normalizeDealerName(r.subDealerName ?? '');
              return normSub
                ? rSource === normSource && rSub === normSub
                : rSource === normSource && !r.subDealerName;
            });
          }

          // 3순위: normalized business_name (source와 다른 경우)
          if (existing.length === 0 && normBiz && normBiz !== data.mCode.toLowerCase()) {
            existing = candidates.filter(r =>
              this.normalizeDealerName(r.businessName ?? '') === normBiz
            );
          }

          // 4순위: normalized source_dealer_name만 일치 (sub_dealer_name 무시)
          if (existing.length === 0 && normSource) {
            existing = candidates.filter(r =>
              this.normalizeDealerName(r.sourceDealerName ?? '') === normSource
            );
          }
        }
      }

      // 다건 → 활성 여부로 한 번 더 좁히기
      if (existing.length > 1) {
        const activeOnes = existing.filter(r => r.isActive !== false);
        if (activeOnes.length === 1) {
          existing = activeOnes;           // 활성 1개 → 정상 처리
        } else if (activeOnes.length === 0) {
          existing = [existing[0]];        // 전부 비활성 → 첫 번째 사용
        } else {
          // 활성 원장 2개 이상 → 실제 중복, 검토 필요
          const canonical = [...activeOnes].sort((a, b) => {
            if (!!a.kpNumber !== !!b.kpNumber) return a.kpNumber ? -1 : 1;
            return a.id - b.id;
          })[0];
          return { action: 'review', reason: 'M코드+이름 기준 활성 원장 2개 이상 — 정리 필요', record: canonical };
        }
      }

      if (existing.length === 1) {
        // 기존 row의 KP/지역이 비어 있으면 신규 값으로 보완, 기존 값 있으면 유지
        const updateFields = {
          businessName: data.businessName,
          mCode: data.mCode,
          kpNumber:     existing[0].kpNumber     || data.kpNumber     || null,
          regionName:   existing[0].regionName   || data.regionName   || null,
          sourceDealerName: data.sourceDealerName ?? null,
          subDealerName:    data.subDealerName    ?? null,
          updatedAt: new Date(),
        };
        const updated = await db.update(dealerRegistrations)
          .set(updateFields)
          .where(eq(dealerRegistrations.id, existing[0].id))
          .returning();
        return { action: 'updated', record: updated[0] };
      }

      // 신규 생성 (정산전용 레코드 — username 자동 생성)
      // 동시 업로드 시 여러 코루틴이 동일한 MAX dealer_code를 읽어
      // 같은 코드를 생성할 수 있으므로 dealer_code 충돌 시 재시도
      const suffix = nanoid(8);
      const username = `mcc_${data.mCode}_${suffix}`.slice(0, 50).replace(/[^a-zA-Z0-9_]/g, '_');
      const hashedPassword = await bcrypt.hash(nanoid(12), 10);
      const recordValues = {
        businessName: data.businessName || data.mCode,
        representativeName: '-',
        businessNumber: '-',
        contactPhone: '-',
        address: '-',
        username,
        password: hashedPassword,
        status: '승인',
        isActive: true,
        isHiddenPos: false,
        isContactPolicyPos: false,
        settlementOnly: true,
        mCode: data.mCode,
        kpNumber: data.kpNumber ?? null,
        regionName: data.regionName ?? null,
        sourceDealerName: data.sourceDealerName ?? null,
        subDealerName: data.subDealerName ?? null,
      };

      let lastInsertErr: any;
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          const dealerCode = await this.generateDealerCode(db);
          const inserted = await db.insert(dealerRegistrations)
            .values({ dealerCode, ...recordValues })
            .returning();
          return { action: 'created', record: inserted[0] };
        } catch (err: any) {
          // dealer_code unique 충돌 → 다음 번호로 재시도
          if (err.code === '23505' && String(err.constraint ?? err.detail ?? '').includes('dealer_code')) {
            lastInsertErr = err;
            // 짧은 무작위 지연으로 동시 재시도 분산
            await new Promise(r => setTimeout(r, 5 + Math.random() * 30));
            continue;
          }
          throw err;
        }
      }
      throw lastInsertErr ?? new Error('dealer_code 생성 실패: 재시도 한도(20회) 초과');
    }));
  }

  async backfillDealerRegistrationIds(): Promise<{ updated: number; created: number; skipped: number; errors: string[] }> {
    return this.withDatabase(async (db) => {
      const allDealers = await db.select().from(dealerRegistrations);
      let updated = 0, created = 0, skipped = 0;
      const errors: string[] = [];

      for (const dealer of allDealers) {
        try {
          const existing = await db.select().from(users)
            .where(eq(users.username, dealer.username))
            .limit(1);

          if (existing.length > 0) {
            if (existing[0].dealerRegistrationId === dealer.id) {
              skipped++;
            } else {
              await db.update(users)
                .set({ dealerRegistrationId: dealer.id })
                .where(eq(users.username, dealer.username));
              updated++;
            }
          } else {
            await db.insert(users).values({
              username: dealer.username,
              password: dealer.password,
              name: dealer.businessName,
              userType: 'user',
              dealerRegistrationId: dealer.id,
            });
            created++;
          }
        } catch (err: any) {
          errors.push(`${dealer.username}: ${err.message}`);
        }
      }

      return { updated, created, skipped, errors };
    });
  }

  async updateDealer(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      const updateData: any = {
        updatedAt: new Date(),
      };
      
      if (data.name) updateData.businessName = data.name;
      if (data.contactEmail) updateData.contactEmail = data.contactEmail;
      if (data.contactPhone) updateData.contactPhone = data.contactPhone;
      if (data.location) updateData.address = data.location;
      if (data.password) {
        const bcrypt = await import('bcrypt');
        updateData.password = await bcrypt.hash(data.password, 10);
      }
      
      await db.update(dealerRegistrations).set(updateData).where(eq(dealerRegistrations.id, id));
    });
  }

  async deleteDealer(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(users).where(eq(users.id, id));
    });
  }

  async createDocument(document: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(documents).values(document).returning();
      return result[0];
    });
  }

  async getDocuments(filters?: any, userId?: number, userType?: string): Promise<any> {
    return this.withDatabase(async (db) => {
      console.log('[getDocuments] START - filters:', JSON.stringify(filters), 'userId:', userId, 'userType:', userType);

      const isPaginated = filters?.page !== undefined || filters?.limit !== undefined;
      const page = Math.max(1, Number(filters?.page ?? 1));
      const pgLimit = Math.min(Math.max(1, Number(filters?.limit ?? 50)), 500);
      const offset = (page - 1) * pgLimit;

      const docColumns = getTableColumns(documents);
      const { activatedByType, ...filteredDocColumns } = docColumns;
      
      let query;
      
      if (filters?.includeActivatedBy) {
        console.log('[getDocuments] Building query with activatedByName...');
        query = db
          .select({
            ...filteredDocColumns,
            dealerName: contactCodes.dealerName,
            realSalesPOS: contactCodes.realSalesPOS,
            planName: servicePlans.name,
            activatedByName: sql<string>`
              CASE
                WHEN ${documents.activatedByType} = 'admin' THEN COALESCE(${admins.name}, '')
                WHEN ${documents.activatedByType} = 'user'  THEN COALESCE(${users.name},  '')
                ELSE ''
              END
            `,
          })
          .from(documents)
          .leftJoin(contactCodes, eq(documents.contactCode, contactCodes.code))
          .leftJoin(servicePlans, eq(documents.servicePlanId, servicePlans.id))
          .leftJoin(admins, and(eq(documents.activatedBy, admins.id), eq(documents.activatedByType, sql`'admin'`)))
          .leftJoin(users, and(eq(documents.activatedBy, users.id), eq(documents.activatedByType, sql`'user'`)));
      } else {
        query = db
          .select({
            ...docColumns,
            dealerName: contactCodes.dealerName,
            realSalesPOS: contactCodes.realSalesPOS,
            planName: servicePlans.name,
          })
          .from(documents)
          .leftJoin(contactCodes, eq(documents.contactCode, contactCodes.code))
          .leftJoin(servicePlans, eq(documents.servicePlanId, servicePlans.id));
      }
      
      const conditions: any[] = [];

      if (filters) {
        console.log('[getDocuments] Applying filters...');
        if (filters.status) conditions.push(eq(documents.status, filters.status));
        if (filters.search) conditions.push(sql`${documents.customerName} ILIKE ${`%${filters.search}%`}`);

        if (filters.activationStatus) {
          const statuses = filters.activationStatus.split(',').map((s: string) => s.trim());
          if (statuses.length === 1) {
            conditions.push(eq(documents.activationStatus, statuses[0]));
          } else {
            conditions.push(sql`${documents.activationStatus} IN (${sql.raw(statuses.map((s: string) => `'${s}'`).join(','))})`);
          }
        }

        // Exclude work requests if requested
        if (filters.excludeWorkRequests) {
          console.log('[getDocuments] Excluding 업무요청중 status');
          conditions.push(sql`${documents.activationStatus} != '업무요청중'`);
        }

        // dealerRegistrationId 기반 필터 (신규 dealer 계정)
        // Path A: documents.dealer_id = dealerRegistrationId
        // Path B: documents.contact_code IN (SELECT code FROM contact_codes WHERE dealer_registration_id = ?)
        if (filters.userType === 'user' && filters.dealerRegistrationId && !filters.allWorkers) {
          console.log('[getDocuments] Filtering by dealerRegistrationId:', filters.dealerRegistrationId);
          conditions.push(or(
            eq(documents.dealerId, filters.dealerRegistrationId),
            sql`${documents.contactCode} IN (
              SELECT code FROM contact_codes WHERE dealer_registration_id = ${filters.dealerRegistrationId}
            )`
          ));
        }

        // Permission-based filtering: dealers can only see their own documents (기존 dealerId 로직 유지)
        if (filters.userType === 'user' && filters.dealerId && !filters.allWorkers) {
          console.log('[getDocuments] Filtering by dealerId:', filters.dealerId);
          conditions.push(eq(documents.dealerId, filters.dealerId));
        }

        // Fallback: filter by userId when neither dealerRegistrationId nor dealerId is available
        if (filters.userType === 'user' && filters.userId && !filters.dealerId && !filters.dealerRegistrationId && !filters.allWorkers) {
          console.log('[getDocuments] Fallback filtering by userId:', filters.userId);
          conditions.push(eq(documents.userId, filters.userId));
        }
        // Workers (admin/user without dealerId) can see all documents - no filter needed

        // [수정 목적] 개통완료 관리 페이지 검색 기능 수정
        // - 통신사 필터가 작동하지 않는 문제 해결 (carrier 조건 추가)
        // - 작업자구분(근무자/관리자) 필터 추가 (activatedByType 조건 추가)
        if (filters.carrier) {
          console.log('[getDocuments] Filtering by carrier:', filters.carrier);
          conditions.push(eq(documents.carrier, filters.carrier));
        }

        if (filters.activatedByType) {
          console.log('[getDocuments] Filtering by activatedByType:', filters.activatedByType);
          conditions.push(eq(documents.activatedByType, filters.activatedByType));
        }

        if (conditions.length > 0) {
          console.log('[getDocuments] Adding where conditions:', conditions.length);
          query = query.where(and(...conditions));
        }
      }

      // COUNT query for pagination (row-level count before batch grouping)
      let totalRows: number | undefined;
      if (isPaginated) {
        const whereClause = conditions.length > 0 ? and(...conditions) : sql`true`;
        const [countResult] = await db.select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(whereClause);
        totalRows = Number(countResult?.count ?? 0);
      }

      console.log('[getDocuments] Executing query...');
      const results = isPaginated
        ? await query.orderBy(desc(documents.id)).limit(pgLimit).offset(offset)
        : await query.orderBy(desc(documents.id));
      console.log('[getDocuments] Query executed, results count:', results.length);
      
      // Group by batch ID
      const batchGroups = new Map<string, any[]>();
      const standaloneDocuments: any[] = [];
      
      for (const row of results) {
        const rowData = {
          ...row,
          storeName: row.storeName || row.dealerName || null,
        };
        
        // Try to extract batch metadata from notes
        let batchMeta = null;
        if (row.notes && typeof row.notes === 'string') {
          const metaMatch = row.notes.match(/__BATCH_META__:(.+?)(?:\n|$)/);
          if (metaMatch) {
            try {
              batchMeta = JSON.parse(metaMatch[1]);
              // Clean notes by removing batch metadata
              rowData.notes = row.notes.replace(/__BATCH_META__:.+?(?:\n|$)/, '').trim();
            } catch (e) {
              // Parsing failed, treat as standalone
            }
          }
        }
        
        if (batchMeta && batchMeta.batchId) {
          // This document is part of a batch
          if (!batchGroups.has(batchMeta.batchId)) {
            batchGroups.set(batchMeta.batchId, []);
          }
          batchGroups.get(batchMeta.batchId)!.push({ ...rowData, batchMeta });
        } else {
          // Standalone document (no batch)
          standaloneDocuments.push(rowData);
        }
      }
      
      // Process batches: keep only main document, add attachments
      const groupedDocuments: any[] = [];
      
      for (const [batchId, docs] of Array.from(batchGroups.entries())) {
        console.log(`[BATCH_PROCESS] batchId=${batchId} docCount=${docs.length} ids=[${docs.map(d => d.id).join(',')}]`);
        
        // Sort by fileIndex to ensure correct order
        docs.sort((a: any, b: any) => (a.batchMeta?.fileIndex || 0) - (b.batchMeta?.fileIndex || 0));
        
        // Find main document (isChild: false)
        let mainDoc = docs.find((d: any) => !d.batchMeta?.isChild);
        console.log(`[BATCH_PROCESS] mainDoc found=${!!mainDoc} mainDocId=${mainDoc?.id}`);
        
        // Fallback: if no main doc found, promote first document to main
        if (!mainDoc && docs.length > 0) {
          mainDoc = docs[0];
          console.log(`[BATCH_PROCESS] Promoted first doc to main: id=${mainDoc.id}`);
        }
        
        if (mainDoc) {
          // Add all files as attachments
          mainDoc.attachments = docs.map((d: any) => ({
            id: d.id,
            fileName: d.fileName,
            filePath: d.filePath,
            fileSize: d.fileSize,
            fileMimetype: d.fileMimetype,
            originalFilename: d.originalFilename
          }));
          mainDoc.fileCount = docs.length;
          
          console.log(`[BATCH_PROCESS] Created attachments: count=${mainDoc.attachments.length}`);
          
          // Remove batchMeta from final result
          delete mainDoc.batchMeta;
          
          groupedDocuments.push(mainDoc);
        } else {
          // Fallback: no docs at all (shouldn't happen)
          console.log(`[BATCH_PROCESS] ERROR: No main doc found for batchId=${batchId}`);
          groupedDocuments.push(...docs.map((d: any) => {
            delete d.batchMeta;
            return d;
          }));
        }
      }
      
      // Combine grouped and standalone documents
      const finalDocuments = [...groupedDocuments, ...standaloneDocuments];
      
      // Sort by ID descending (maintain original order)
      finalDocuments.sort((a, b) => b.id - a.id);
      
      // Add hasUnreadMessages flag (optimized batch query with role-aware filtering)
      if (finalDocuments.length > 0) {
        const documentIds = finalDocuments.map((d: any) => d.id);
        
        // Get all chat rooms for these documents in one query
        const rooms = await db.select()
          .from(chatRooms)
          .where(inArray(chatRooms.documentId, documentIds));
        
        const roomMap = new Map(rooms.map((r: any) => [r.documentId, r.id]));
        
        if (rooms.length > 0 && userId && userType) {
          const roomIds = rooms.map((r: any) => r.id);
          
          // Determine user role to apply correct senderType filter
          const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
          const isDealer = user.length > 0 && user[0].dealerId !== null && user[0].dealerId !== undefined;
          
          console.log('[hasUnreadMessages] userId:', userId, 'isDealer:', isDealer, 'dealerId:', user[0]?.dealerId, 'role:', user[0]?.role);
          
          // Get unread messages with role-aware senderType filtering
          // Dealers: exclude their own messages (senderType != 'dealer')
          // Workers/Admins: only count dealer messages (senderType = 'dealer')
          let unreadDocs;
          if (isDealer) {
            console.log('[hasUnreadMessages] Dealer filter: excluding senderType = dealer');
            unreadDocs = await db.select({
              roomId: chatMessages.chatRoomId,
            })
            .from(chatMessages)
            .where(and(
              inArray(chatMessages.chatRoomId, roomIds),
              eq(chatMessages.isRead, false),
              sql`${chatMessages.senderType} != 'dealer'`
            ))
            .groupBy(chatMessages.chatRoomId);
          } else {
            console.log('[hasUnreadMessages] Worker/Admin filter: only senderType = dealer');
            unreadDocs = await db.select({
              roomId: chatMessages.chatRoomId,
            })
            .from(chatMessages)
            .where(and(
              inArray(chatMessages.chatRoomId, roomIds),
              eq(chatMessages.isRead, false),
              eq(chatMessages.senderType, 'dealer')
            ))
            .groupBy(chatMessages.chatRoomId);
          }
          
          console.log('[hasUnreadMessages] Unread rooms found:', unreadDocs.length);
          
          const unreadRoomIds = new Set(unreadDocs.map((r: any) => r.roomId));
          
          // Add hasUnreadMessages to each document
          for (const doc of finalDocuments) {
            const roomId = roomMap.get(doc.id);
            doc.hasUnreadMessages = roomId ? unreadRoomIds.has(roomId) : false;
          }
        } else {
          // No chat rooms or no user context, all false
          for (const doc of finalDocuments) {
            doc.hasUnreadMessages = false;
          }
        }
      }
      
      if (isPaginated && totalRows !== undefined) {
        return { data: finalDocuments, total: totalRows, page, limit: pgLimit, totalPages: Math.ceil(totalRows / pgLimit) };
      }
      return finalDocuments;
    });
  }

  async getDocumentById(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const document = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
      return document.length > 0 ? document[0] : null;
    });
  }

  async updateDocument(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      // 날짜 필드를 안전하게 변환하는 헬퍼 함수
      const toSafeDate = (value: any): Date | null => {
        if (!value || value === '') return null;
        if (value instanceof Date) return value;
        if (typeof value === 'string') {
          try {
            const parsed = new Date(value);
            return isNaN(parsed.getTime()) ? null : parsed;
          } catch {
            return null;
          }
        }
        return null;
      };
      
      // 날짜 필드 목록
      const dateFields = [
        'activatedAt', 'cancelledAt', 'updatedAt', 
        'deletedAt', 'discardedAt', 'settledAt'
      ];
      
      // 날짜 필드를 안전하게 변환
      const safeData: any = { ...data };
      for (const field of dateFields) {
        if (field in safeData) {
          safeData[field] = toSafeDate(safeData[field]);
        }
      }
      
      // activationStatus 변경 여부 확인
      const willChangeActivation = Object.prototype.hasOwnProperty.call(safeData, "activationStatus");
      
      // 트랜잭션으로 배치 동기화 처리
      await db.transaction(async (tx: any) => {
        // 1) 현재 문서 조회 (배치 확인용)
        const cur = await tx
          .select({ id: documents.id, notes: documents.notes })
          .from(documents)
          .where(eq(documents.id, id))
          .limit(1);
        
        if (!cur.length) throw new Error("Document not found");
        
        const notes = cur[0]?.notes ?? null;
        const batchId = willChangeActivation ? extractBatchIdFromNotes(notes) : null;
        logBatch("doc=", id, "hasBatchId=", !!batchId, "notesSample=", LOG_BATCH_DEBUG ? String(notes).slice(0, 200) : undefined);

        // 2) updateData/singleOnly 구성
        const updateData: Record<string, any> = {};
        if (Object.prototype.hasOwnProperty.call(safeData, "activationStatus")) {
          updateData.activationStatus = safeData.activationStatus;
          if (Object.prototype.hasOwnProperty.call(safeData, "activatedBy")) {
            updateData.activatedBy = safeData.activatedBy;
          }
          if (Object.prototype.hasOwnProperty.call(safeData, "activatedAt")) {
            updateData.activatedAt = safeData.activatedAt;
          }
        }
        const singleOnly: Record<string, any> = {};
        for (const k of Object.keys(safeData)) {
          if (k === "activationStatus" || k === "activatedBy" || k === "activatedAt") continue;
          // ✅ notes 보존 가드: 빈 문자열/undefined/null이면 SET하지 않음
          if (k === 'notes') {
            const nv = safeData[k];
            if (nv === '' || nv === undefined || nv === null) {
              continue;
            }
          }
          if (safeData[k] !== undefined) {
            singleOnly[k] = safeData[k];
          }
        }

        // 3) 배치 동기화 (activationStatus 변경 + batchId 존재)
        if (willChangeActivation && batchId) {
          const pattern = likePatternForBatchId(batchId);
          logBatch("batchId=", batchId, "likePattern=", pattern);

          // 3-1) 영향 대상 미리 조회 (검증용)
          const willAffect = await tx
            .select({ id: documents.id, notes: documents.notes })
            .from(documents)
            .where(sql`${documents.notes} LIKE ${pattern}`);

          logBatch("preAffectedCount=", willAffect.length, "ids=", willAffect.map((r: any) => r.id).slice(0, 20));

          // 3-2) 상태/처리자/처리시각 등 배치 필드 일괄 업데이트
          if (Object.keys(updateData).length > 0) {
            await tx
              .update(documents)
              .set(updateData)
              .where(sql`${documents.notes} LIKE ${pattern}`);
          }

          // 3-3) 단건에만 적용할 기타 필드 (singleOnly)가 있으면 처리
          if (Object.keys(singleOnly).length > 0) {
            // notes 업데이트가 있으면 배치 전체에 batchMeta 보존하면서 업데이트
            if (singleOnly.notes !== undefined) {
              const { notes: newNotes, ...otherFields } = singleOnly;
              logBatch("[DEBUG] newNotes=", newNotes, "otherFields=", Object.keys(otherFields));
              
              // 각 배치 문서에 대해 개별 처리
              for (const doc of willAffect) {
                const docNotes = doc.notes || '';
                const existingBatchMeta = docNotes.match(/__BATCH_META__:.+?(?=\n|$)/)?.[0];
                
                logBatch("[DEBUG] docId=", doc.id, "docNotes.length=", docNotes.length, "hasBatchMeta=", !!existingBatchMeta);
                
                let updatedNotes = newNotes;
                if (existingBatchMeta && !updatedNotes.includes('__BATCH_META__')) {
                  // 빈 문자열이든 아니든, 기존 batchMeta 보존
                  updatedNotes = updatedNotes && updatedNotes.trim() 
                    ? `${updatedNotes}\n${existingBatchMeta}` 
                    : existingBatchMeta;
                  logBatch("[DEBUG] updatedNotes after merge=", updatedNotes.substring(0, 100));
                }
                
                // 각 문서에 notes 포함 전체 업데이트
                const updatePayload = { ...otherFields, notes: updatedNotes };
                logBatch("[DEBUG] UPDATE docId=", doc.id, "notesLength=", updatedNotes.length, "fieldsCount=", Object.keys(updatePayload).length);
                await tx.update(documents).set(updatePayload).where(eq(documents.id, doc.id));
              }
            } else {
              // notes 업데이트가 없으면 main 문서에만 적용
              await tx.update(documents).set(singleOnly).where(eq(documents.id, id));
            }
          }

          // 3-4) 사후 검증 (실제 반영 수 확인)
          const postAffected = await tx
            .select({ id: documents.id })
            .from(documents)
            .where(sql`${documents.notes} LIKE ${pattern}`);

          logBatch("postAffectedCount=", postAffected.length, "status=", updateData.activationStatus ?? null);

          return; // 배치 처리 후 종료 (중복 업데이트 방지)
        }

        // 4) 배치 조건 아니라면 기존 단건 업데이트
        const merged = { ...updateData, ...singleOnly };
        if (Object.keys(merged).length > 0) {
          await tx.update(documents).set(merged).where(eq(documents.id, id));
          logBatch("singleUpdate", "id=", id, "fields=", Object.keys(merged));
        }
      });
    });
  }

  async updateDocumentStatus(id: number, status: string, updatedBy?: number): Promise<void> {
    return this.withDatabase(async (db) => {
      const updateData: any = { status };
      if (updatedBy) updateData.updatedBy = updatedBy;
      await db.update(documents).set(updateData).where(eq(documents.id, id));
    });
  }

  async deleteDocument(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(documents).where(eq(documents.id, id));
    });
  }

  async getDocumentStatistics(): Promise<any> {
    return this.withDatabase(async (db) => {
      const total = await db.select({ count: count() }).from(documents);
      return { total: total[0].count };
    });
  }

  async createChatRoom(documentId: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const [chatRoom] = await db.insert(chatRooms).values({
        documentId,
        createdAt: new Date()
      }).returning();
      return chatRoom;
    });
  }

  async getChatRoomByDocumentId(documentId: number): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const [chatRoom] = await db.select()
        .from(chatRooms)
        .where(eq(chatRooms.documentId, documentId))
        .limit(1);
      return chatRoom || null;
    });
  }

  async createChatMessage(message: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const [newMessage] = await db.insert(chatMessages).values({
        chatRoomId: message.chatRoomId,
        senderId: message.senderId,
        senderType: message.senderType,
        senderName: message.senderName,
        message: message.message,
        messageType: message.messageType || 'text',
        createdAt: new Date(),
        isRead: false
      }).returning();
      return newMessage;
    });
  }

  async getChatMessages(chatRoomId: number): Promise<any[]> {
    return this.withDatabase(async (db) => {
      const messages = await db.select()
        .from(chatMessages)
        .where(eq(chatMessages.chatRoomId, chatRoomId))
        .orderBy(chatMessages.createdAt);
      return messages;
    });
  }

  async getUnreadMessageCount(userId: number, userType: string): Promise<any> {
    return this.withDatabase(async (db) => {
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user.length) {
        return { total: 0, byDealer: [] };
      }

      const isDealer = user[0].dealerId !== null && user[0].dealerId !== undefined;
      const isWorker = !isDealer && user[0].role === 'dealer_worker';
      const isAdmin = !isDealer && user[0].userType === 'admin';
      
      if (isDealer) {
        // 판매점: 자신이 생성한 문서의 채팅방에서 근무자/관리자가 보낸 읽지 않은 메시지
        const unreadMessages = await db.select({
          count: count(),
        })
        .from(chatMessages)
        .innerJoin(chatRooms, eq(chatMessages.chatRoomId, chatRooms.id))
        .innerJoin(documents, eq(chatRooms.documentId, documents.id))
        .where(
          and(
            eq(documents.dealerId, user[0].dealerId),
            eq(chatMessages.isRead, false),
            sql`${chatMessages.senderType} != 'dealer'`
          )
        );

        return {
          total: unreadMessages[0]?.count || 0,
          byDealer: []
        };
      } else if (isWorker) {
        // 근무자: 자신이 담당자로 할당된 문서의 채팅방에서 판매점이 보낸 읽지 않은 메시지
        const dr = dealerRegistrations;
        const unreadByDealer = await db.select({
          dealerId: documents.dealerId,
          dealerName: sql<string>`COALESCE(${dr.businessName}, '알 수 없음')`.as('dealer_name'),
          count: count(),
        })
        .from(chatMessages)
        .innerJoin(chatRooms, eq(chatMessages.chatRoomId, chatRooms.id))
        .innerJoin(documents, eq(chatRooms.documentId, documents.id))
        .leftJoin(dr, eq(documents.dealerId, dr.id))
        .where(
          and(
            eq(documents.assignedWorkerId, userId),
            eq(chatMessages.senderType, 'dealer'),
            eq(chatMessages.isRead, false)
          )
        )
        .groupBy(documents.dealerId, dr.businessName);

        const total = unreadByDealer.reduce((sum: number, item: any) => sum + Number(item.count), 0);

        return {
          total,
          byDealer: unreadByDealer.map((item: any) => ({
            dealerId: item.dealerId,
            dealerName: item.dealerName,
            count: Number(item.count)
          }))
        };
      } else {
        // 관리자/영업과장: 현재는 읽지 않은 메시지 없음 (필요시 구현)
        return {
          total: 0,
          byDealer: []
        };
      }
    });
  }

  async markChatMessagesAsRead(chatRoomId: number, userId: number, userType: string): Promise<void> {
    return this.withDatabase(async (db) => {
      const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user.length) return;

      const isDealer = user[0].dealerId !== null && user[0].dealerId !== undefined;
      const isWorker = !isDealer && user[0].role === 'dealer_worker';
      
      // 채팅방 확인 및 권한 체크
      const chatRoom = await db.select()
        .from(chatRooms)
        .where(eq(chatRooms.id, chatRoomId))
        .limit(1);
      
      if (!chatRoom.length) return;
      
      // 문서 확인
      const document = await db.select()
        .from(documents)
        .where(eq(documents.id, chatRoom[0].documentId))
        .limit(1);
      
      if (!document.length) return;
      
      // 권한 확인: 판매점은 자신의 문서만, 근무자는 자신이 할당된 문서만
      if (isDealer && document[0].dealerId !== user[0].dealerId) {
        return;
      }
      if (isWorker && document[0].assignedWorkerId !== userId) {
        return;
      }
      
      // 상대방이 보낸 메시지만 읽음 처리
      const excludeSenderType = isDealer ? 'dealer' : 'worker';
      
      await db.update(chatMessages)
        .set({ isRead: true })
        .where(
          and(
            eq(chatMessages.chatRoomId, chatRoomId),
            eq(chatMessages.isRead, false),
            sql`${chatMessages.senderType} != ${excludeSenderType}`
          )
        );
    });
  }

  async getDashboardStats(): Promise<any> {
    return this.withDatabase(async (db) => {
      const total = await db.select({ count: count() }).from(documents);
      return { totalDocuments: total[0].count };
    });
  }

  async getActivationStats(): Promise<any> {
    return this.withDatabase(async (db) => {
      const activatedCount = await db.select({ count: count() })
        .from(documents)
        .where(eq(documents.status, '활성화완료'));
      return { activated: activatedCount[0].count };
    });
  }

  async getTodayStats(userId?: number, userType?: string): Promise<any> {
    return this.withDatabase(async (db) => {
      // 🔥 당일 접수건 (uploaded_at 기준, KST, 당일 0시~다음날 0시, activation_status = '대기')
      let receptionConditions: any[] = [
        sql`(uploaded_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date`,
        eq(documents.activationStatus, '대기')
      ];
      
      if (userType === 'user' && userId) {
        receptionConditions.push(eq(documents.activatedBy, userId));
      }
      
      const receptionResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...receptionConditions));
      const receptionCount = receptionResult[0]?.count || 0;
      
      // 🔥 당일 접수건 - 통신사별 현황
      const receptionByCarrier = await db.select({
        carrier: documents.carrier,
        count: count()
      })
        .from(documents)
        .where(and(...receptionConditions))
        .groupBy(documents.carrier);
      
      // 🔥 당일 개통건 (activated_at 기준, KST, activation_status = '개통') ✅ child 제외
      let activationConditions: any[] = [
        sql`(activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date`,
        eq(documents.activationStatus, '개통'),
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      if (userType === 'user' && userId) {
        activationConditions.push(eq(documents.activatedBy, userId));
        activationConditions.push(eq(documents.activatedByType, 'user'));
      }
      
      const activationResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...activationConditions));
      const activationCount = activationResult[0]?.count || 0;
      
      // 🔥 당일 개통건 - 신규/번호이동 현황
      let newCustomerConditions = [...activationConditions, eq(documents.customerType, 'new')];
      let portInConditions = [...activationConditions, eq(documents.customerType, 'port-in')];
      
      const newCustomerResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...newCustomerConditions));
      const newCustomerCount = newCustomerResult[0]?.count || 0;
      
      const portInResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...portInConditions));
      const portInCount = portInResult[0]?.count || 0;
      
      // 🔥 당일 기타완료건 (activated_at 기준, KST, activation_status = '기타완료') ✅ child 제외
      let otherConditions: any[] = [
        sql`(activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date`,
        eq(documents.activationStatus, '기타완료'),
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      if (userType === 'user' && userId) {
        otherConditions.push(eq(documents.activatedBy, userId));
        otherConditions.push(eq(documents.activatedByType, 'user'));
      }
      
      const otherResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...otherConditions));
      const otherCount = otherResult[0]?.count || 0;
      
      const result = {
        todayReception: receptionCount,
        todayActivation: activationCount,
        todayOtherCompleted: otherCount,
        receptionByCarrier: receptionByCarrier.map((row: any) => ({
          carrier: row.carrier || '알 수 없음',
          count: Number(row.count)
        })),
        newCustomerCount,
        portInCount
      };
      
      console.log(`[getTodayStats] userType=${userType}, userId=${userId}, result:`, result);
      
      return result;
    });
  }

  async getMonthlyActivationStats(userId?: number, userType?: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return [];
    });
  }

  async getCarrierStats(userId?: number, userType?: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      // 통신사별 통계 (activated_at 기준, KST, 당월, activation_status = '개통') ✅ child 제외
      let conditions: any[] = [
        sql`DATE_TRUNC('month', activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')`,
        eq(documents.activationStatus, '개통'),
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      if (userType === 'user' && userId) {
        conditions.push(eq(documents.activatedBy, userId));
        conditions.push(eq(documents.activatedByType, 'user'));
      }
      
      const results = await db.select({
        carrier: documents.carrier,
        count: count()
      })
        .from(documents)
        .where(and(...conditions))
        .groupBy(documents.carrier);
      
      console.log(`[getCarrierStats] userType=${userType}, userId=${userId}, result count=${results.length}`);
      
      return results.map((row: any) => ({
        carrier: row.carrier || '알 수 없음',
        count: row.count
      }));
    });
  }

  async getMonthlyActivationSummary(userId?: number, userType?: string): Promise<any> {
    return this.withDatabase(async (db) => {
      // KST 기준 당월 범위 계산
      const { startUtc, endUtc } = getKstMonthRange();
      
      // 단일 쿼리로 통신사별 개통건 집계 ✅ child 제외
      // 기준: activated_at IS NOT NULL AND activation_status = '개통' (개통만)
      let conditions: any[] = [
        sql`${documents.activatedAt} >= ${startUtc}`,
        sql`${documents.activatedAt} < ${endUtc}`,
        sql`${documents.activatedAt} IS NOT NULL`,
        eq(documents.activationStatus, '개통'),
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      // 권한별 필터링
      if (userType === 'user' && userId) {
        conditions.push(eq(documents.activatedBy, userId));
        conditions.push(eq(documents.activatedByType, 'user'));
      }
      
      const results = await db.select({
        carrier: documents.carrier,
        count: count()
      })
        .from(documents)
        .where(and(...conditions))
        .groupBy(documents.carrier);
      
      // 총계 계산 (동일 조건)
      const total = results.reduce((sum: number, row: any) => sum + Number(row.count), 0);
      
      // 월 정보 (YYYY-MM 형식)
      const month = new Date(startUtc.getTime() + 9 * 60 * 60 * 1000).toISOString().substring(0, 7);
      
      console.log(`[getMonthlyActivationSummary] userType=${userType}, userId=${userId}, month=${month}, total=${total}, carriers=${results.length}, startUtc=${startUtc.toISOString()}, endUtc=${endUtc.toISOString()}`);
      
      return {
        month,
        total,
        carriers: results.map((row: any) => ({
          carrier: row.carrier || '알 수 없음',
          count: Number(row.count)
        }))
      };
    });
  }

  async getWorkerStats(userId?: number, userType?: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      // 관리자만 조회 가능
      if (userType !== 'admin') {
        return [];
      }
      
      // 근무자별 통계 (activated_at 기준, KST, 당월, activation_status = '개통') ✅ child 제외
      const conditions = [
        eq(documents.activationStatus, '개통'),
        sql`DATE_TRUNC('month', activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')`,
        sql`activated_by IS NOT NULL`,
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      // 역할 분기 조인 - 아이디(username) 추가
      const results = await db.select({
        workerId: documents.activatedBy,
        workerRole: documents.activatedByType,
        workerName: sql<string>`
          CASE
            WHEN ${documents.activatedByType} = 'admin' THEN COALESCE(${admins.name}, '')
            WHEN ${documents.activatedByType} = 'user'  THEN COALESCE(${users.name},  '')
            ELSE ''
          END
        `,
        workerUsername: sql<string>`
          CASE
            WHEN ${documents.activatedByType} = 'admin' THEN COALESCE(${admins.username}, '')
            WHEN ${documents.activatedByType} = 'user'  THEN COALESCE(${users.username},  '')
            ELSE ''
          END
        `,
        count: count()
      })
        .from(documents)
        .leftJoin(admins, and(eq(documents.activatedBy, admins.id), eq(documents.activatedByType, sql`'admin'`)))
        .leftJoin(users, and(eq(documents.activatedBy, users.id), eq(documents.activatedByType, sql`'user'`)))
        .where(and(...conditions))
        .groupBy(documents.activatedBy, documents.activatedByType, admins.name, users.name, admins.username, users.username);
      
      const result = results
        .filter((row: any) => row.workerId && row.workerName)
        .map((row: any) => ({
          workerId: row.workerId,
          workerRole: row.workerRole,
          workerName: row.workerName,
          workerUsername: row.workerUsername,
          count: row.count
        }))
        .sort((a: any, b: any) => b.count - a.count);
      
      console.log(`[getWorkerStats] userType=${userType}, userId=${userId}, result count=${result.length}, results:`, result.map((r: any) => `${r.workerUsername}(${r.workerName}): ${r.count}`));
      
      return result;
    });
  }

  async getWorkerCarrierStats(workerId: number, workerType: string): Promise<any> {
    return this.withDatabase(async (db) => {
      // 특정 근무자의 통신사별 개통 통계
      const conditions = [
        eq(documents.activationStatus, '개통'),
        eq(documents.activatedBy, workerId),
        eq(documents.activatedByType, workerType),
        sql`DATE_TRUNC('month', activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')`,
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      const carrierResults = await db.select({
        carrier: documents.carrier,
        count: count()
      })
        .from(documents)
        .where(and(...conditions))
        .groupBy(documents.carrier);
      
      // 근무자 이름 조회
      let workerName = '';
      let workerUsername = '';
      if (workerType === 'admin') {
        const adminResult = await db.select({ name: admins.name, username: admins.username })
          .from(admins)
          .where(eq(admins.id, workerId))
          .limit(1);
        workerName = adminResult[0]?.name || '';
        workerUsername = adminResult[0]?.username || '';
      } else if (workerType === 'user') {
        const userResult = await db.select({ name: users.name, username: users.username })
          .from(users)
          .where(eq(users.id, workerId))
          .limit(1);
        workerName = userResult[0]?.name || '';
        workerUsername = userResult[0]?.username || '';
      }
      
      const carriers = carrierResults.map((row: any) => ({
        carrier: row.carrier || '알 수 없음',
        count: Number(row.count)
      })).sort((a: any, b: any) => b.count - a.count);
      
      console.log(`[getWorkerCarrierStats] workerId=${workerId}, workerType=${workerType}, workerName=${workerName}, carriers count=${carriers.length}`);
      
      return {
        workerId,
        workerType,
        workerName,
        workerUsername,
        carriers
      };
    });
  }

  async getCarrierWorkerStats(carrier: string): Promise<any> {
    return this.withDatabase(async (db) => {
      // 특정 통신사의 근무자별 개통 통계
      const conditions = [
        eq(documents.activationStatus, '개통'),
        eq(documents.carrier, carrier),
        sql`DATE_TRUNC('month', activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')`,
        sql`activated_by IS NOT NULL`,
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      const results = await db.select({
        workerId: documents.activatedBy,
        workerRole: documents.activatedByType,
        workerName: sql<string>`
          CASE
            WHEN ${documents.activatedByType} = 'admin' THEN COALESCE(${admins.name}, '')
            WHEN ${documents.activatedByType} = 'user'  THEN COALESCE(${users.name},  '')
            ELSE ''
          END
        `,
        workerUsername: sql<string>`
          CASE
            WHEN ${documents.activatedByType} = 'admin' THEN COALESCE(${admins.username}, '')
            WHEN ${documents.activatedByType} = 'user'  THEN COALESCE(${users.username},  '')
            ELSE ''
          END
        `,
        count: count()
      })
        .from(documents)
        .leftJoin(admins, and(eq(documents.activatedBy, admins.id), eq(documents.activatedByType, sql`'admin'`)))
        .leftJoin(users, and(eq(documents.activatedBy, users.id), eq(documents.activatedByType, sql`'user'`)))
        .where(and(...conditions))
        .groupBy(documents.activatedBy, documents.activatedByType, admins.name, users.name, admins.username, users.username);
      
      const workers = results
        .filter((row: any) => row.workerId && row.workerName)
        .map((row: any) => ({
          workerId: row.workerId,
          workerRole: row.workerRole,
          workerName: row.workerName,
          workerUsername: row.workerUsername,
          count: Number(row.count)
        }))
        .sort((a: any, b: any) => b.count - a.count);
      
      console.log(`[getCarrierWorkerStats] carrier=${carrier}, workers count=${workers.length}`);
      
      return {
        carrier,
        workers
      };
    });
  }

  async getAdminActivationStats(adminId: number): Promise<any> {
    return this.withDatabase(async (db) => {
      // 당일 개통건 (activated_at 기준, KST, activation_status = '개통') ✅ child 제외
      const todayConditions = [
        sql`(activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date`,
        eq(documents.activationStatus, '개통'),
        eq(documents.activatedBy, adminId),
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      const todayResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...todayConditions));
      const todayCount = todayResult[0]?.count || 0;
      
      // 당월 개통건 (activated_at 기준, KST, activation_status = '개통') ✅ child 제외
      const monthConditions = [
        sql`DATE_TRUNC('month', activated_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')`,
        eq(documents.activationStatus, '개통'),
        eq(documents.activatedBy, adminId),
        sql`${documents.notes} NOT LIKE ${CHILD_LIKE}`
      ];
      
      const monthResult = await db.select({ count: count() })
        .from(documents)
        .where(and(...monthConditions));
      const monthCount = monthResult[0]?.count || 0;
      
      console.log(`[getAdminActivationStats] adminId=${adminId}, todayCount=${todayCount}, monthCount=${monthCount}`);
      
      return {
        todayCount,
        monthCount
      };
    });
  }

  async getMonthlyStatusStats(userId?: number, userType?: string): Promise<any> {
    return this.withDatabase(async (db) => {
      let conditions: any[];
      
      if (userType === 'user' && userId) {
        // 근무자: 자신이 처리한 문서들 (activated_by = userId AND activated_by_type = 'user' 또는 assigned_worker_id = userId)
        // activated_at이 당월이거나, 할당받은 문서 중 아직 미처리 상태인 것들
        conditions = [
          sql`(
            (${documents.activatedBy} = ${userId} AND 
             ${documents.activatedByType} = 'user' AND
             DATE_TRUNC('month', ${documents.activatedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul'))
            OR
            (${documents.assignedWorkerId} = ${userId} AND ${documents.activationStatus} IN ('대기', '진행중', '업무요청중'))
          )`
        ];
      } else {
        // 관리자: uploaded_at 기준 당월 전체 문서
        conditions = [
          sql`DATE_TRUNC('month', uploaded_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul') = DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')`
        ];
      }
      
      const allDocs = await db.select({
        id: documents.id,
        activationStatus: documents.activationStatus
      })
        .from(documents)
        .where(and(...conditions));
      
      const totalDocuments = allDocs.length;
      const pendingActivations = allDocs.filter((doc: any) => doc.activationStatus === '대기').length;
      const inProgressCount = allDocs.filter((doc: any) => ['진행중', '업무요청중'].includes(doc.activationStatus || '')).length;
      const activatedCount = allDocs.filter((doc: any) => doc.activationStatus === '개통').length;
      const otherCompletedCount = allDocs.filter((doc: any) => doc.activationStatus === '기타완료').length;
      const canceledCount = allDocs.filter((doc: any) => doc.activationStatus === '취소').length;
      const discardedCount = allDocs.filter((doc: any) => doc.activationStatus === '폐기').length;
      
      console.log(`[getMonthlyStatusStats] userType=${userType}, userId=${userId}, total=${totalDocuments}, activated=${activatedCount}`);
      
      return {
        totalDocuments,
        pendingActivations,
        inProgressCount,
        activatedCount,
        otherCompletedCount,
        canceledCount,
        discardedCount
      };
    });
  }

  async getServicePlans(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(servicePlans);
    });
  }

  async createServicePlan(plan: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(servicePlans).values(plan).returning();
      return result[0];
    });
  }

  async updateServicePlan(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(servicePlans).set(data).where(eq(servicePlans.id, id)).returning();
      return result[0];
    });
  }

  async deleteServicePlan(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.delete(servicePlans).where(eq(servicePlans.id, id)).returning();
      return result[0];
    });
  }

  async getContactCodes(carrier?: string, options?: { page?: number; limit?: number; search?: string; dealerRegistrationId?: number; includeRealSalesPOSMatch?: boolean }): Promise<any> {
    return this.withDatabase(async (db) => {
      const isPaginated = options?.page !== undefined || options?.limit !== undefined;
      const page = Math.max(1, Number(options?.page ?? 1));
      const limit = Math.min(Math.max(1, Number(options?.limit ?? 50)), 500);
      const offset = (page - 1) * limit;
      const search = options?.search?.trim();

      // includeRealSalesPOSMatch: 선택한 판매점의 businessName과 realSalesPOS가 일치하는 CC도 포함
      let dealerBusinessName: string | null = null;
      if (options?.includeRealSalesPOSMatch && options?.dealerRegistrationId != null) {
        const drRow = await db.select({ businessName: dealerRegistrations.businessName })
          .from(dealerRegistrations)
          .where(eq(dealerRegistrations.id, options.dealerRegistrationId))
          .limit(1);
        dealerBusinessName = drRow[0]?.businessName || null;
      }

      const conditions: any[] = [];
      if (carrier && carrier !== 'all') conditions.push(eq(contactCodes.carrier, carrier));
      if (options?.dealerRegistrationId != null) {
        if (dealerBusinessName) {
          conditions.push(or(
            eq(contactCodes.dealerRegistrationId, options.dealerRegistrationId),
            eq(contactCodes.realSalesPOS, dealerBusinessName)
          ));
        } else {
          conditions.push(eq(contactCodes.dealerRegistrationId, options.dealerRegistrationId));
        }
      }
      if (search) {
        const searchPattern = `%${search}%`;
        conditions.push(
          sql`(${contactCodes.code} ILIKE ${searchPattern} OR ${contactCodes.dealerName} ILIKE ${searchPattern} OR COALESCE(${contactCodes.salesManagerName}, '') ILIKE ${searchPattern})`
        );
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const selectFields = {
        id: contactCodes.id,
        code: contactCodes.code,
        dealerName: contactCodes.dealerName,
        realSalesPOS: contactCodes.realSalesPOS,
        carrier: contactCodes.carrier,
        channel: contactCodes.channel,
        mCode: contactCodes.mCode,
        salesManagerId: contactCodes.salesManagerId,
        salesManagerName: contactCodes.salesManagerName,
        dealerRegistrationId: contactCodes.dealerRegistrationId,
        isActive: contactCodes.isActive,
        createdAt: contactCodes.createdAt,
        updatedAt: contactCodes.updatedAt,
        drDealerCode: dealerRegistrations.dealerCode,
        drBusinessName: dealerRegistrations.businessName,
      };

      const addMatchSource = (rows: any[]): any[] => {
        if (!dealerBusinessName || !options?.dealerRegistrationId) return rows;
        return rows.map(r => {
          const byDr = r.dealerRegistrationId === options.dealerRegistrationId;
          const byPos = r.realSalesPOS === dealerBusinessName;
          return { ...r, matchSource: byDr && byPos ? 'BOTH' : byDr ? 'SETTLEMENT_DEALER' : 'REAL_SALES_POS' };
        });
      };

      if (!isPaginated) {
        const rows = await db.select(selectFields)
          .from(contactCodes)
          .leftJoin(dealerRegistrations, eq(contactCodes.dealerRegistrationId, dealerRegistrations.id))
          .where(whereClause ?? sql`true`)
          .orderBy(desc(contactCodes.updatedAt));
        return addMatchSource(rows);
      }

      const [countResult, data] = await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(contactCodes).where(whereClause ?? sql`true`),
        db.select(selectFields)
          .from(contactCodes)
          .leftJoin(dealerRegistrations, eq(contactCodes.dealerRegistrationId, dealerRegistrations.id))
          .where(whereClause ?? sql`true`)
          .orderBy(desc(contactCodes.updatedAt))
          .limit(limit)
          .offset(offset),
      ]);
      const total = Number(countResult[0]?.count ?? 0);
      return { data: addMatchSource(data), total, page, limit, totalPages: Math.ceil(total / limit) };
    });
  }

  async getContactCodeByCode(code: string): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(contactCodes).where(eq(contactCodes.code, code)).limit(1);
      return result.length > 0 ? result[0] : null;
    });
  }

  async getContactCodeByCarrierAndCode(carrier: string, code: string): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(contactCodes)
        .where(and(eq(contactCodes.carrier, carrier), eq(contactCodes.code, code)))
        .limit(1);
      return result.length > 0 ? result[0] : null;
    });
  }

  async getContactCodesByMCodeAndCode(mCode: string, code: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return db.select().from(contactCodes)
        .where(and(eq(contactCodes.mCode, mCode), eq(contactCodes.code, code)));
    });
  }

  async getContactCodesByMCodeAndCodeName(mCode: string, codeName: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return db.select().from(contactCodes)
        .where(and(
          eq(contactCodes.mCode, mCode),
          or(
            eq(contactCodes.codeName, codeName),
            eq(contactCodes.subDealerName, codeName),
            eq(contactCodes.dealerName, codeName),
          )
        ));
    });
  }

  async getContactCodesByCodeAll(code: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return db.select().from(contactCodes).where(eq(contactCodes.code, code));
    });
  }

  async getContactCodesByMCode(mCode: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return db.select().from(contactCodes).where(eq(contactCodes.mCode, mCode));
    });
  }

  async getContactCodesByNameFields(dealerName?: string | null, codeName?: string | null): Promise<any[]> {
    return this.withDatabase(async (db) => {
      const conditions: any[] = [];
      if (dealerName) {
        conditions.push(eq(contactCodes.dealerName, dealerName));
        conditions.push(eq(contactCodes.realSalesPOS, dealerName));
      }
      if (codeName) {
        conditions.push(eq(contactCodes.codeName, codeName));
        conditions.push(eq(contactCodes.subDealerName, codeName));
      }
      if (!conditions.length) return [];
      return db.select().from(contactCodes).where(or(...conditions));
    });
  }

  async searchContactCodes(query: string, limit: number = 20): Promise<any[]> {
    return this.withDatabase(async (db) => {
      // Prefix search using LOWER() with text_pattern_ops index for optimal performance
      return await db.select({
        id: contactCodes.id,
        code: contactCodes.code,
        dealerName: contactCodes.dealerName,
        carrier: contactCodes.carrier,
        salesManagerId: contactCodes.salesManagerId,
        salesManagerName: contactCodes.salesManagerName,
        realSalesPOS: contactCodes.realSalesPOS,
        isActive: contactCodes.isActive
      })
        .from(contactCodes)
        .where(sql`LOWER(${contactCodes.code}) LIKE LOWER(${query}) || '%'`)
        .orderBy(desc(contactCodes.updatedAt))
        .limit(limit);
    });
  }

  async getContactCodeAutoMatch(dealerName: string, carrier: string): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const result = await db.select()
        .from(contactCodes)
        .where(and(
          eq(contactCodes.dealerName, dealerName),
          eq(contactCodes.carrier, carrier),
          eq(contactCodes.isActive, true)
        ))
        .orderBy(desc(contactCodes.updatedAt))
        .limit(1);
      return result.length > 0 ? result[0] : null;
    });
  }

  async createContactCode(code: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(contactCodes).values(code).returning();
      return result[0];
    });
  }

  async bulkCreateContactCodes(codes: any[]): Promise<number> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(contactCodes).values(codes).returning();
      return result.length;
    });
  }

  async upsertContactCode(data: {
    code: string; dealerName: string; realSalesPOS?: string | null; realSalesPosCode?: string | null;
    carrier: string; salesManagerName?: string | null; dealerRegistrationId?: number | null; memo?: string | null; isActive?: boolean;
    mCode?: string | null; channel?: string | null; kpNumber?: string | null; regionName?: string | null;
    aliasName?: string | null; subDealerName?: string | null; sourceDealerName?: string | null; codeName?: string | null;
  }): Promise<{ action: 'created' | 'updated'; record: any }> {
    return this.withDatabase(async (db) => {
      const existing = await db.select({ id: contactCodes.id })
        .from(contactCodes)
        .where(eq(contactCodes.code, data.code))
        .limit(1);

      const commonFields = {
        dealerName: data.dealerName,
        realSalesPOS: data.realSalesPOS ?? null,
        realSalesPosCode: data.realSalesPosCode ?? null,
        carrier: data.carrier,
        salesManagerName: data.salesManagerName ?? null,
        dealerRegistrationId: data.dealerRegistrationId ?? null,
        memo: data.memo ?? null,
        isActive: data.isActive ?? true,
        mCode: data.mCode ?? null,
        channel: data.channel ?? null,
        kpNumber: data.kpNumber ?? null,
        regionName: data.regionName ?? null,
        aliasName: data.aliasName ?? null,
        subDealerName: data.subDealerName ?? null,
        sourceDealerName: data.sourceDealerName ?? null,
        codeName: data.codeName ?? null,
      };

      if (existing.length > 0) {
        const updated = await db.update(contactCodes)
          .set({ ...commonFields, updatedAt: new Date() })
          .where(eq(contactCodes.code, data.code))
          .returning();
        return { action: 'updated', record: updated[0] };
      }

      // INSERT 시도 — 동시 업로드에서 같은 code가 두 코루틴에 배정되면
      // 한쪽이 먼저 INSERT 성공 후 다른 쪽이 unique 충돌할 수 있음.
      // 충돌 시 UPDATE로 전환 (optimistic insert → fallback update 패턴)
      try {
        const inserted = await db.insert(contactCodes)
          .values({ code: data.code, ...commonFields })
          .returning();
        return { action: 'created', record: inserted[0] };
      } catch (err: any) {
        if (err.code === '23505' && String(err.constraint ?? err.detail ?? '').includes('code')) {
          // 다른 코루틴이 먼저 insert 완료 → UPDATE로 처리
          const updated = await db.update(contactCodes)
            .set({ ...commonFields, updatedAt: new Date() })
            .where(eq(contactCodes.code, data.code))
            .returning();
          return { action: 'updated', record: updated[0] };
        }
        throw err;
      }
    });
  }

  async updateContactCode(id: number, data: { code?: string; dealerName?: string; carrier?: string; salesManagerId?: number | null; salesManagerName?: string | null; realSalesPOS?: string | null; realSalesPosCode?: string | null; memo?: string | null; isActive?: boolean; dealerRegistrationId?: number | null }): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(contactCodes)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(contactCodes.id, id))
        .returning();
      return result[0];
    });
  }

  async deleteContactCode(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(contactCodes).where(eq(contactCodes.id, id));
    });
  }

  async getCarriers(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(carriers);
    });
  }

  async getCarrierById(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const carrier = await db.select().from(carriers).where(eq(carriers.id, id)).limit(1);
      return carrier.length > 0 ? carrier[0] : null;
    });
  }

  async createCarrier(carrier: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(carriers).values(carrier).returning();
      return result[0];
    });
  }

  async updateCarrier(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(carriers).set(data).where(eq(carriers.id, id));
    });
  }

  async deleteCarrier(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(carriers).where(eq(carriers.id, id));
    });
  }

  async getOtherBusinessCarriers(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(otherBusinessCarriers);
    });
  }

  async createOtherBusinessCarrier(carrier: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(otherBusinessCarriers).values(carrier).returning();
      return result[0];
    });
  }

  async updateOtherBusinessCarrier(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(otherBusinessCarriers).set(data).where(eq(otherBusinessCarriers.id, id));
    });
  }

  async deleteOtherBusinessCarrier(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(otherBusinessCarriers).where(eq(otherBusinessCarriers.id, id));
    });
  }

  async getHiddenPricesByPos(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(hiddenPricesByPos);
    });
  }

  async createHiddenPriceByPos(price: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(hiddenPricesByPos).values(price).returning();
      return result[0];
    });
  }

  async updateHiddenPriceByPos(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(hiddenPricesByPos).set(data).where(eq(hiddenPricesByPos.id, id));
    });
  }

  async deleteHiddenPriceByPos(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(hiddenPricesByPos).where(eq(hiddenPricesByPos.id, id));
    });
  }

  async getSalesTeams(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(salesTeams).where(eq(salesTeams.isActive, true));
    });
  }

  async createSalesTeam(team: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(salesTeams).values(team).returning();
      return result[0];
    });
  }

  async updateSalesTeam(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(salesTeams).set({ ...data, updatedAt: new Date() }).where(eq(salesTeams.id, id));
    });
  }

  async deleteSalesTeam(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(salesTeams).set({ isActive: false, updatedAt: new Date() }).where(eq(salesTeams.id, id));
    });
  }

  async getSalesManagers(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(salesManagers).where(eq(salesManagers.isActive, true)).orderBy(desc(salesManagers.createdAt));
    });
  }

  async getSalesManagerById(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const [manager] = await db.select().from(salesManagers).where(and(eq(salesManagers.id, id), eq(salesManagers.isActive, true))).limit(1);
      return manager || null;
    });
  }

  async createSalesManager(manager: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const hashedPassword = await bcrypt.hash(manager.password, 10);
      const result = await db.insert(salesManagers).values({
        ...manager,
        password: hashedPassword
      }).returning();
      return result[0];
    });
  }

  async updateSalesManager(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      const updateData: any = { ...data, updatedAt: new Date() };
      if (data.password) {
        updateData.password = await bcrypt.hash(data.password, 10);
      }
      await db.update(salesManagers).set(updateData).where(eq(salesManagers.id, id));
    });
  }

  async deleteSalesManager(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(salesManagers).set({ isActive: false, updatedAt: new Date() }).where(eq(salesManagers.id, id));
    });
  }

  async getAdditionalServices(carrier?: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      let query = db.select().from(additionalServices);
      
      if (carrier) {
        query = query.where(eq(additionalServices.carrier, carrier)) as any;
      }
      
      const services = await query;
      return services;
    });
  }
  
  async createAdditionalService(service: any): Promise<any> { return service; }
  async updateAdditionalService(id: number, data: any): Promise<void> { }
  async deleteAdditionalService(id: number): Promise<void> { }

  async getSettlementUnitPrices(): Promise<any[]> { return []; }
  async createSettlementUnitPrice(price: any): Promise<any> { return price; }
  async updateSettlementUnitPrice(id: number, data: any): Promise<void> { }
  async deleteSettlementUnitPrice(id: number): Promise<void> { }

  async getCarrierServicePolicies(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(carrierServicePolicies).orderBy(carrierServicePolicies.createdAt);
    });
  }

  async getCarrierServicePolicyById(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(carrierServicePolicies).where(eq(carrierServicePolicies.id, id)).limit(1);
      return result[0] || null;
    });
  }

  async createCarrierServicePolicy(policy: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(carrierServicePolicies).values(policy).returning();
      return result[0];
    });
  }

  async updateCarrierServicePolicy(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(carrierServicePolicies)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(carrierServicePolicies.id, id));
    });
  }

  async deleteCarrierServicePolicy(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(carrierServicePolicies).where(eq(carrierServicePolicies.id, id));
    });
  }

  async getDocumentTemplates(): Promise<any[]> { return []; }
  async createDocumentTemplate(template: any): Promise<any> { return template; }
  async updateDocumentTemplate(id: number, data: any): Promise<void> { }
  async deleteDocumentTemplate(id: number): Promise<void> { }

  async getSettlements(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      const activatedDocs = await db.select().from(documents)
        .where(eq(documents.status, '활성화완료'));
      
      return activatedDocs.map((doc: any) => ({
        id: doc.id,
        customerName: doc.customerName,
        carrier: doc.carrier,
        servicePlan: doc.servicePlan,
        settlementAmount: doc.settlementAmount || 0,
        settlementDate: doc.activationDate,
        documentId: doc.id
      }));
    });
  }

  async createSettlementsFromActivatedDocuments(): Promise<any> {
    return this.withDatabase(async (db) => {
      const activatedDocs = await db.select().from(documents)
        .where(eq(documents.status, '활성화완료'));
      
      const settlementsCreated = activatedDocs.length;
      
      return {
        success: true,
        created: settlementsCreated,
        message: `${settlementsCreated}개의 정산 데이터가 생성되었습니다.`
      };
    });
  }

  async getUsersByType(type: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(users).where(eq(users.userType, type));
    });
  }

  // ── 정산 엔진 구현 (STEP 5C) ─────────────────────────────────

  // ── Policy versions ──────────────────────────────────────────

  async getPolicyVersions(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(policyVersions)
        .orderBy(desc(policyVersions.effectiveFrom));
    });
  }

  async getPolicyVersionById(id: number): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(policyVersions)
        .where(eq(policyVersions.id, id)).limit(1);
      return result[0] || null;
    });
  }

  async getActivePolicyVersion(): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(policyVersions)
        .where(eq(policyVersions.isActive, true))
        .orderBy(desc(policyVersions.effectiveFrom))
        .limit(1);
      return result[0] || null;
    });
  }

  async createPolicyVersion(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(policyVersions).values(data).returning();
      return result[0];
    });
  }

  async updatePolicyVersion(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(policyVersions)
        .set(data)
        .where(eq(policyVersions.id, id))
        .returning();
      return result[0];
    });
  }

  async deletePolicyVersion(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(policyVersions).where(eq(policyVersions.id, id));
    });
  }

  // ── Policy rows ───────────────────────────────────────────────

  async getPolicyRowsByVersionId(policyVersionId: number): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(policyRows)
        .where(eq(policyRows.policyVersionId, policyVersionId))
        .orderBy(policyRows.channel, policyRows.planName);
    });
  }

  async createPolicyRow(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(policyRows).values(data).returning();
      return result[0];
    });
  }

  async bulkCreatePolicyRows(data: any[]): Promise<number> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(policyRows).values(data).returning();
      return result.length;
    });
  }

  async updatePolicyRow(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(policyRows)
        .set(data)
        .where(eq(policyRows.id, id))
        .returning();
      return result[0];
    });
  }

  async deletePolicyRow(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(policyRows).where(eq(policyRows.id, id));
    });
  }

  async deletePolicyRowsByVersionId(policyVersionId: number): Promise<number> {
    return this.withDatabase(async (db) => {
      const result = await db.delete(policyRows)
        .where(eq(policyRows.policyVersionId, policyVersionId))
        .returning();
      return result.length;
    });
  }

  // ── Policy files ──────────────────────────────────────────────

  async getPolicyFilesByVersionId(policyVersionId: number): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(policyFiles)
        .where(eq(policyFiles.policyVersionId, policyVersionId))
        .orderBy(desc(policyFiles.uploadedAt));
    });
  }

  async createPolicyFile(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(policyFiles).values(data).returning();
      return result[0];
    });
  }

  async deletePolicyFile(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(policyFiles).where(eq(policyFiles.id, id));
    });
  }

  // ── Activation records ────────────────────────────────────────

  async getActivationRecords(filters?: {
    dealerRegistrationId?: number;
    channel?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; page: number; limit: number }> {
    return this.withDatabase(async (db) => {
      const conditions: any[] = [];
      if (filters?.dealerRegistrationId) {
        conditions.push(eq(activationRecords.dealerRegistrationId, filters.dealerRegistrationId));
      }
      if (filters?.channel) {
        conditions.push(eq(activationRecords.channel, filters.channel));
      }
      if (filters?.from) {
        conditions.push(gte(activationRecords.activationDatetime, filters.from));
      }
      if (filters?.to) {
        conditions.push(lte(activationRecords.activationDatetime, filters.to));
      }

      const page = filters?.page || 1;
      const limit = filters?.limit || 50;
      const offset = (page - 1) * limit;

      let query = db.select().from(activationRecords) as any;
      if (conditions.length > 0) query = query.where(and(...conditions));
      const data = await query
        .orderBy(desc(activationRecords.activationDatetime))
        .limit(limit)
        .offset(offset);

      return { data, page, limit };
    });
  }

  async getActivationRecordById(id: number): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(activationRecords)
        .where(eq(activationRecords.id, id)).limit(1);
      return result[0] || null;
    });
  }

  async createActivationRecord(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(activationRecords).values(data).returning();
      return result[0];
    });
  }

  async updateActivationRecord(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(activationRecords)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(activationRecords.id, id))
        .returning();
      return result[0];
    });
  }

  async deleteActivationRecord(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(activationRecords).where(eq(activationRecords.id, id));
    });
  }

  // ── Settlement items ──────────────────────────────────────────

  async getSettlementItems(filters?: {
    dealerRegistrationId?: number;
    status?: string;
    matchStatus?: string;
    page?: number;
    limit?: number;
  }): Promise<{
    data: any[];
    page: number;
    limit: number;
    summary: { total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number };
    groups: Array<{ dealerName: string; total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number; sumPolicy: number; sumAdjusted: number; sumConfirmed: number; items: any[] }>;
    totalGroups: number;
  }> {
    return this.withDatabase(async (db) => {
      const conditions: any[] = [];
      if (filters?.dealerRegistrationId) {
        conditions.push(eq(settlementItems.dealerRegistrationId, filters.dealerRegistrationId));
      }
      if (filters?.status) {
        conditions.push(eq(settlementItems.status, filters.status));
      }
      if (filters?.matchStatus) {
        conditions.push(eq(settlementItems.matchStatus, filters.matchStatus));
      }

      const page = filters?.page || 1;
      const limit = filters?.limit || 50;

      // 전체 items 로드 (페이지네이션 없음) — 그룹 기준 페이지네이션을 위해
      let query = db.select({
        ...getTableColumns(settlementItems),
        _ar_activationDatetime: activationRecords.activationDatetime,
        _ar_channel: activationRecords.channel,
        _ar_customerName: activationRecords.customerName,
        _ar_customerPhone: activationRecords.customerPhone,
        _ar_subscriptionNumber: activationRecords.subscriptionNumber,
        _ar_activationNumber: activationRecords.activationNumber,
        _ar_contactCode: activationRecords.contactCode,
        _ar_planName: activationRecords.planName,
        _ar_customerType: activationRecords.customerType,
        _ar_nationalityType: activationRecords.nationalityType,
        _ar_bundleType: activationRecords.bundleType,
        _ar_addService: activationRecords.addService,
        _ar_regFeeType: activationRecords.regFeeType,
        _cc_realSalesPOS: contactCodes.realSalesPOS,
        _cc_dealerName: contactCodes.dealerName,
        _dr_businessName: dealerRegistrations.businessName,
      }).from(settlementItems)
        .leftJoin(activationRecords, eq(settlementItems.activationId, activationRecords.id))
        .leftJoin(contactCodes, eq(activationRecords.contactCode, contactCodes.code))
        .leftJoin(dealerRegistrations, eq(settlementItems.dealerRegistrationId, dealerRegistrations.id)) as any;

      if (conditions.length > 0) query = query.where(and(...conditions));
      const rows = await query.orderBy(desc(settlementItems.createdAt));

      const mapRow = (row: any) => {
        const {
          _ar_activationDatetime, _ar_channel, _ar_customerName, _ar_activationNumber,
          _ar_customerPhone, _ar_subscriptionNumber, _ar_contactCode, _ar_planName, _ar_customerType,
          _ar_nationalityType, _ar_bundleType, _ar_addService, _ar_regFeeType,
          _cc_realSalesPOS, _cc_dealerName, _dr_businessName,
          ...siFields
        } = row;
        // 실제판매점명 폴백: realSalesPOS → cc.dealerName → dr.businessName → null
        const realSalesPOS = _cc_realSalesPOS ?? _cc_dealerName ?? _dr_businessName ?? null;
        return {
          ...siFields,
          activationRecord: {
            activationDatetime: _ar_activationDatetime,
            channel: _ar_channel,
            customerName: _ar_customerName,
            activationNumber: _ar_activationNumber,
            customerPhone: _ar_customerPhone,
            subscriptionNumber: _ar_subscriptionNumber,
            contactCode: _ar_contactCode,
            planName: _ar_planName,
            customerType: _ar_customerType,
            nationalityType: _ar_nationalityType,
            bundleType: _ar_bundleType,
            addService: _ar_addService,
            regFeeType: _ar_regFeeType,
            realSalesPOS,
          },
        };
      };

      const allItems = rows.map(mapRow);

      // dealerName 기준 그룹화 (JS 메모리 내)
      const groupMap = new Map<string, any[]>();
      for (const item of allItems) {
        const key = item.dealerName ?? '(판매점 미확인)';
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(item);
      }

      // 그룹별 집계 후 건수 내림차순 정렬
      const allGroups = Array.from(groupMap.entries())
        .sort(([, a], [, b]) => b.length - a.length)
        .map(([dealerName, items]) => {
          const autoMatch = items.filter(i => i.matchStatus === 'AUTO_MATCH').length;
          const reviewRequired = items.filter(i => i.matchStatus === 'REVIEW_REQUIRED').length;
          const policyNotFound = items.filter(i => i.matchStatus === 'POLICY_NOT_FOUND').length;
          const settlementDone = items.filter(i => i.status === '정산완료').length;
          const sumPolicy = items.reduce((s: number, i: any) => s + (Number(i.rebateAmount) || 0), 0);
          const sumAdjusted = items.reduce((s: number, i: any) => s + (Number(i.adjustedAmount) || 0), 0);
          const sumConfirmed = items.reduce((s: number, i: any) => {
            if (i.lockedAmount != null) return s + (Number(i.lockedAmount) || 0);
            const base = i.adjustedAmount != null ? Number(i.adjustedAmount) : (i.rebateAmount != null ? Number(i.rebateAmount) : null);
            if (base == null) return s;
            return s + base + (i.addAmount != null ? Number(i.addAmount) : 0) - (i.deductAmount != null ? Number(i.deductAmount) : 0) + (i.hiddenAmount != null ? Number(i.hiddenAmount) : 0);
          }, 0);
          return { dealerName, total: items.length, autoMatch, reviewRequired, policyNotFound, settlementDone, sumPolicy, sumAdjusted, sumConfirmed, items };
        });

      const totalGroups = allGroups.length;
      const groupOffset = (page - 1) * limit;
      const groups = allGroups.slice(groupOffset, groupOffset + limit);

      // 요약 집계 (별도 COUNT 쿼리)
      let summaryQuery = db.select({
        total: count(),
        autoMatch: sql<number>`cast(count(case when ${settlementItems.matchStatus} = 'AUTO_MATCH' then 1 end) as integer)`,
        reviewRequired: sql<number>`cast(count(case when ${settlementItems.matchStatus} = 'REVIEW_REQUIRED' then 1 end) as integer)`,
        policyNotFound: sql<number>`cast(count(case when ${settlementItems.matchStatus} = 'POLICY_NOT_FOUND' then 1 end) as integer)`,
        settlementDone: sql<number>`cast(count(case when ${settlementItems.status} = '정산완료' then 1 end) as integer)`,
      }).from(settlementItems) as any;
      if (conditions.length > 0) summaryQuery = summaryQuery.where(and(...conditions));
      const [summaryRow] = await summaryQuery;

      const summary = {
        total: Number(summaryRow?.total ?? 0),
        autoMatch: Number(summaryRow?.autoMatch ?? 0),
        reviewRequired: Number(summaryRow?.reviewRequired ?? 0),
        policyNotFound: Number(summaryRow?.policyNotFound ?? 0),
        settlementDone: Number(summaryRow?.settlementDone ?? 0),
      };

      return { data: [], page, limit, summary, groups, totalGroups };
    });
  }

  async getSettlementItemById(id: number): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(settlementItems)
        .where(eq(settlementItems.id, id)).limit(1);
      return result[0] || null;
    });
  }

  async getSettlementItemByActivationId(activationId: number): Promise<any | null> {
    return this.withDatabase(async (db) => {
      const result = await db.select().from(settlementItems)
        .where(eq(settlementItems.activationId, activationId)).limit(1);
      return result[0] || null;
    });
  }

  async createSettlementItem(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(settlementItems).values(data).returning();
      return result[0];
    });
  }

  async updateSettlementItem(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(settlementItems)
        .set(data)
        .where(eq(settlementItems.id, id))
        .returning();
      return result[0];
    });
  }

  // 정산 확정: (adjustedAmount ?? rebateAmount) + addAmount - deductAmount + hiddenAmount 를 lockedAmount로 고정
  async lockSettlementItem(id: number, adminId: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const rows = await db.select().from(settlementItems)
        .where(eq(settlementItems.id, id)).limit(1);
      if (!rows[0]) throw new Error('정산 항목을 찾을 수 없습니다.');

      const current = rows[0];
      const base = current.adjustedAmount != null ? Number(current.adjustedAmount) : (current.rebateAmount != null ? Number(current.rebateAmount) : null);
      const add = current.addAmount != null ? Number(current.addAmount) : 0;
      const deduct = current.deductAmount != null ? Number(current.deductAmount) : 0;
      const hidden = current.hiddenAmount != null ? Number(current.hiddenAmount) : 0;
      const finalAmount = base != null ? String(base + add - deduct + hidden) : null;

      const result = await db.update(settlementItems)
        .set({
          lockedAmount: finalAmount,
          lockedAt: new Date(),
          lockedBy: adminId,
          status: '정산완료',
        })
        .where(eq(settlementItems.id, id))
        .returning();
      return result[0];
    });
  }

  async getSettlementItemsForExport(filters?: {
    status?: string;
    matchStatus?: string;
    dealerRegistrationId?: number;
    from?: Date;
    to?: Date;
  }): Promise<any[]> {
    return this.withDatabase(async (db) => {
      const conditions: any[] = [];
      if (filters?.status)               conditions.push(eq(settlementItems.status, filters.status));
      if (filters?.matchStatus)          conditions.push(eq(settlementItems.matchStatus, filters.matchStatus));
      if (filters?.dealerRegistrationId) conditions.push(eq(settlementItems.dealerRegistrationId, filters.dealerRegistrationId));
      if (filters?.from)                 conditions.push(gte(activationRecords.activationDatetime, filters.from));
      if (filters?.to)                   conditions.push(lte(activationRecords.activationDatetime, filters.to));

      let q = db.select({
        id:                   settlementItems.id,
        status:               settlementItems.status,
        matchStatus:          settlementItems.matchStatus,
        dealerName:           settlementItems.dealerName,
        rebateAmount:         settlementItems.rebateAmount,
        adjustedAmount:       settlementItems.adjustedAmount,
        addAmount:            settlementItems.addAmount,
        deductAmount:         settlementItems.deductAmount,
        hiddenAmount:         settlementItems.hiddenAmount,
        lockedAmount:         settlementItems.lockedAmount,
        policyVersionId:      settlementItems.policyVersionId,
        forceReason:          settlementItems.forceReason,
        memo:                 settlementItems.memo,
        mccCode:              activationRecords.mccCode,
        channel:              activationRecords.channel,
        customerName:         activationRecords.customerName,
        customerPhone:        activationRecords.customerPhone,
        subscriptionNumber:   activationRecords.subscriptionNumber,
        activationNumber:     activationRecords.activationNumber,
        contactCode:          activationRecords.contactCode,
        planName:             activationRecords.planName,
        customerType:         activationRecords.customerType,
        simCount:             activationRecords.simCount,
        bundleType:           activationRecords.bundleType,
        addService:           activationRecords.addService,
        regFeeType:           activationRecords.regFeeType,
        activationDatetime:   activationRecords.activationDatetime,
        policyName:           policyVersions.policyName,
      })
      .from(settlementItems)
      .leftJoin(activationRecords, eq(settlementItems.activationId, activationRecords.id))
      .leftJoin(policyVersions, eq(settlementItems.policyVersionId, policyVersions.id)) as any;

      if (conditions.length > 0) q = q.where(and(...conditions));
      return await q.orderBy(desc(activationRecords.activationDatetime));
    });
  }

  // ── Settlement files ──────────────────────────────────────────

  async getSettlementFilesByItemId(settlementItemId: number): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(settlementFiles)
        .where(eq(settlementFiles.settlementItemId, settlementItemId))
        .orderBy(desc(settlementFiles.uploadedAt));
    });
  }

  async createSettlementFile(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(settlementFiles).values(data).returning();
      return result[0];
    });
  }

  async deleteSettlementFile(id: number): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.delete(settlementFiles).where(eq(settlementFiles.id, id));
    });
  }

  // ── Adjustment rules ──────────────────────────────────────────

  async getAdjustmentRulesByVersionId(policyVersionId: number): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(adjustmentRules)
        .where(eq(adjustmentRules.policyVersionId, policyVersionId))
        .orderBy(adjustmentRules.channel, adjustmentRules.planName, adjustmentRules.conditionType);
    });
  }

  async createAdjustmentRule(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(adjustmentRules).values(data).returning();
      return result[0];
    });
  }

  async updateAdjustmentRule(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(adjustmentRules)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(adjustmentRules.id, id))
        .returning();
      return result[0];
    });
  }

  async calculateSettlementAdjustments(record: any, policyVersionId: number): Promise<{ addAmount: number; deductAmount: number }> {
    return this.withDatabase(async (db) => {
      const rules = await db.select().from(adjustmentRules)
        .where(and(
          eq(adjustmentRules.policyVersionId, policyVersionId),
          eq(adjustmentRules.isActive, true),
        ));

      const n = (v: any): string => String(v ?? '').trim();

      let addAmount = 0;
      let deductAmount = 0;

      for (const rule of rules) {
        // 채널/요금제/유형이 빈 문자열이면 와일드카드
        if (rule.channel && n(record.channel) !== n(rule.channel)) continue;
        if (rule.planName && n(record.planName) !== n(rule.planName)) continue;
        if (rule.customerType && n(record.customerType) !== n(rule.customerType)) continue;

        const ct = rule.conditionType;
        const cv = n(rule.conditionValue);
        const bundle = n(record.bundleType);
        const addSvc = n(record.addService);
        const regFee = n(record.regFeeType);
        const simCnt = n(record.simCount);

        let match = false;
        switch (ct) {
          case 'BUNDLE_EXISTS':       match = bundle !== ''; break;
          case 'BUNDLE_NONE':         match = bundle === ''; break;
          case 'BUNDLE_MATCH':        match = bundle === cv; break;
          case 'ADD_SERVICE_EXISTS':  match = addSvc !== ''; break;
          case 'ADD_SERVICE_NONE':    match = addSvc === ''; break;
          case 'ADD_SERVICE_MATCH':   match = addSvc === cv; break;
          case 'ADD_SERVICE_NOT_MATCH': match = addSvc !== '' && addSvc !== cv; break;
          case 'REGFEE_EXISTS':       match = regFee !== ''; break;
          case 'REGFEE_NONE':         match = regFee === ''; break;
          case 'REGFEE_MATCH':        match = regFee === cv; break;
          case 'SIM_COUNT_MATCH':     match = simCnt === cv; break;
        }

        if (!match) continue;

        const amt = Number(rule.amount) || 0;
        if (rule.adjustmentType === 'ADD')    addAmount    += amt;
        if (rule.adjustmentType === 'DEDUCT') deductAmount += amt;
      }

      return { addAmount, deductAmount };
    });
  }

  // ── Hidden policy rows ──────────────────────────────────────────

  async getHiddenPolicyRows(filters?: { dealerRegistrationId?: number; isActive?: boolean }): Promise<any[]> {
    return this.withDatabase(async (db) => {
      const conditions: any[] = [];
      if (filters?.dealerRegistrationId != null) conditions.push(eq(hiddenPolicyRows.dealerRegistrationId, filters.dealerRegistrationId));
      if (filters?.isActive != null) conditions.push(eq(hiddenPolicyRows.isActive, filters.isActive));
      let q = db.select().from(hiddenPolicyRows) as any;
      if (conditions.length > 0) q = q.where(and(...conditions));
      return await q.orderBy(desc(hiddenPolicyRows.createdAt));
    });
  }

  async createHiddenPolicyRow(data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(hiddenPolicyRows).values(data).returning();
      return result[0];
    });
  }

  async updateHiddenPolicyRow(id: number, data: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.update(hiddenPolicyRows)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(hiddenPolicyRows.id, id))
        .returning();
      return result[0];
    });
  }

  async calculateHiddenAmount(record: any): Promise<number> {
    const si = getSchemaInfo();
    if (!si.hasHiddenPolicyRows || !si.ccHasExtended) return 0;
    return this.withDatabase(async (db) => {
      if (!record.contactCode) return 0;

      const ccRows = await db.select({
        dealerRegistrationId: contactCodes.dealerRegistrationId,
        realSalesPOS: contactCodes.realSalesPOS,
      }).from(contactCodes)
        .where(and(eq(contactCodes.code, record.contactCode), eq(contactCodes.isActive, true)))
        .limit(1);

      if (!ccRows[0]) return 0;
      const ccDealerRegId = ccRows[0].dealerRegistrationId;
      const realSalesPOS = ccRows[0].realSalesPOS;

      // 유효 DR 결정: realSalesPOS → businessName 우선 매칭, 없으면 cc.dealerRegistrationId fallback
      let effectiveDealerRegId: number | null = null;
      let isHiddenPos = false;

      if (realSalesPOS) {
        const drByPOS = await db.select({ id: dealerRegistrations.id, isHiddenPos: dealerRegistrations.isHiddenPos })
          .from(dealerRegistrations)
          .where(eq(dealerRegistrations.businessName, realSalesPOS))
          .limit(1);
        if (drByPOS[0]) {
          // realSalesPOS DR 발견 → 이 DR 사용, isHiddenPos=false여도 fallback 없음
          effectiveDealerRegId = drByPOS[0].id;
          isHiddenPos = !!drByPOS[0].isHiddenPos;
        } else {
          // realSalesPOS DR 미발견 → cc.dealerRegistrationId fallback
          effectiveDealerRegId = ccDealerRegId;
          if (effectiveDealerRegId) {
            const drFb = await db.select({ isHiddenPos: dealerRegistrations.isHiddenPos })
              .from(dealerRegistrations).where(eq(dealerRegistrations.id, effectiveDealerRegId)).limit(1);
            isHiddenPos = !!drFb[0]?.isHiddenPos;
          }
        }
      } else {
        effectiveDealerRegId = ccDealerRegId;
        if (effectiveDealerRegId) {
          const drRows = await db.select({ isHiddenPos: dealerRegistrations.isHiddenPos })
            .from(dealerRegistrations).where(eq(dealerRegistrations.id, effectiveDealerRegId)).limit(1);
          isHiddenPos = !!drRows[0]?.isHiddenPos;
        }
      }

      if (!effectiveDealerRegId || !isHiddenPos) return 0;

      const rows = await db.select().from(hiddenPolicyRows)
        .where(eq(hiddenPolicyRows.isActive, true));

      const activationDate = record.activationDatetime ? new Date(record.activationDatetime) : null;
      const n = (v: any): string => String(v ?? '').trim();

      let total = 0;
      for (const row of rows) {
        if (row.dealerRegistrationId != null && row.dealerRegistrationId !== effectiveDealerRegId) continue;
        if (row.contactCode && n(row.contactCode) !== n(record.contactCode)) continue;
        if (row.channel && n(row.channel) !== n(record.channel)) continue;
        if (row.planName && n(row.planName) !== n(record.planName)) continue;
        if (row.customerType && n(row.customerType) !== n(record.customerType)) continue;
        if (activationDate && row.effectiveFrom && toKSTDateStr(activationDate) < toKSTDateStr(new Date(row.effectiveFrom))) continue;
        if (activationDate && row.effectiveTo && toKSTDateStr(activationDate) > toKSTDateStr(new Date(row.effectiveTo))) continue;
        total += Number(row.hiddenAmount) || 0;
      }

      return total;
    });
  }

  async recalculateHiddenAmounts(options: {
    dateFrom?: string;
    dateTo?: string;
    onlyUnsettled?: boolean;
    dryRun?: boolean;
    debugContactCode?: string;
  }): Promise<{
    totalTargets: number;
    updated: number;
    cleared: number;
    skippedLocked: number;
    skippedNoContactCode: number;
    skippedNoDealer: number;
    skippedNotHiddenPos: number;
    skippedNoPolicy: number;
    policyMismatchDetail: { dealerMismatch: number; contactCodeMismatch: number; channelMismatch: number; planNameMismatch: number; customerTypeMismatch: number; periodMismatch: number };
    errors: string[];
    debug?: any;
  }> {
    const si = getSchemaInfo();
    if (!si.hasHiddenPolicyRows || !si.ccHasExtended || !si.siHasExtended) {
      return {
        totalTargets: 0, updated: 0, cleared: 0, skippedLocked: 0,
        skippedNoContactCode: 0, skippedNoDealer: 0, skippedNotHiddenPos: 0, skippedNoPolicy: 0,
        policyMismatchDetail: { dealerMismatch: 0, contactCodeMismatch: 0, channelMismatch: 0, planNameMismatch: 0, customerTypeMismatch: 0, periodMismatch: 0 },
        errors: ['스키마 미반영: hidden_policy_rows 또는 settlement_items 신규 컬럼이 DB에 없습니다.'],
      };
    }
    return this.withDatabase(async (db) => {
      const { dateFrom, dateTo, onlyUnsettled = true, dryRun = false, debugContactCode } = options;

      // 대상 settlement_items 조회 (activationRecord JOIN)
      // 날짜 입력은 KST 기준 (YYYY-MM-DD) → DB는 UTC 저장 → +09:00 명시로 UTC 변환
      const toKSTBound = (dateStr: string, time: string) => new Date(`${dateStr}T${time}+09:00`);
      const conditions: any[] = [];
      if (dateFrom) conditions.push(gte(activationRecords.activationDatetime, toKSTBound(dateFrom, '00:00:00')));
      if (dateTo)   conditions.push(lte(activationRecords.activationDatetime, toKSTBound(dateTo,   '23:59:59')));

      let query = db.select({
        siId:               settlementItems.id,
        siLockedAmount:     settlementItems.lockedAmount,
        siStatus:           settlementItems.status,
        siHiddenAmount:     settlementItems.hiddenAmount,
        contactCode:        activationRecords.contactCode,
        channel:            activationRecords.channel,
        planName:           activationRecords.planName,
        customerType:       activationRecords.customerType,
        activationDatetime: activationRecords.activationDatetime,
      }).from(settlementItems)
        .innerJoin(activationRecords, eq(settlementItems.activationId, activationRecords.id)) as any;

      if (conditions.length > 0) query = query.where(and(...conditions));

      const rows: any[] = await query;

      // 활성 히든정책 전체 사전 로드 (N+1 방지)
      const allPolicies = await db.select().from(hiddenPolicyRows).where(eq(hiddenPolicyRows.isActive, true));

      // CC / DR 캐시 (반복 DB 조회 방지)
      const ccDetailCache = new Map<string, { dealerRegistrationId: number | null; realSalesPOS: string | null }>();
      const posCache = new Map<string, { id: number; dealerCode: string | null; businessName: string; isHiddenPos: boolean | null } | null>();
      const drCache = new Map<number, boolean>(); // fallback: dealerRegistrationId → isHiddenPos

      const result = {
        totalTargets: rows.length,
        updated: 0,
        cleared: 0,
        skippedLocked: 0,
        skippedNoContactCode: 0,
        skippedNoDealer: 0,
        skippedNotHiddenPos: 0,
        skippedNoPolicy: 0,
        policyMismatchDetail: { dealerMismatch: 0, contactCodeMismatch: 0, channelMismatch: 0, planNameMismatch: 0, customerTypeMismatch: 0, periodMismatch: 0 },
        errors: [] as string[],
      };

      const n = (v: any): string => String(v ?? '').trim();

      // debugContactCode 추적 객체 (해당 접점코드의 처리 흐름 기록)
      const dbg: any = debugContactCode ? {
        contactCode: debugContactCode,
        inTargetSet: false,
        siId: null as number | null,
        siStatus: null as string | null,
        siLocked: null as any,
        // 현재 흐름 (dealerRegistrationId 기준)
        currentFlow: {
          ccFound: false,
          realSalesPOS: null as string | null,
          dealerRegIdFromCC: null as number | null,
          drByRegId: null as any,
          isHiddenPosByRegId: null as boolean | null,
          skipReason: null as string | null,
          policyTrace: [] as any[],
          matchedCount: 0,
          hiddenAmount: 0,
        },
        // realSalesPOS 기준 흐름 (비교용)
        realSalesPOSFlow: {
          realSalesPOS: null as string | null,
          drByRealSalesPOS: null as any,
          isHiddenPosByRealSalesPOS: null as boolean | null,
          policyTrace: [] as any[],
          matchedCount: 0,
          hiddenAmount: 0,
          note: null as string | null,
        },
      } : null;

      for (const row of rows) {
        const isDbgRow = dbg && row.contactCode === debugContactCode;
        try {
          if (isDbgRow) {
            dbg.inTargetSet = true;
            dbg.siId = row.siId;
            dbg.siStatus = row.siStatus;
            dbg.siLocked = row.siLockedAmount;
          }

          // 확정 건 보호
          if (onlyUnsettled && (row.siLockedAmount != null || row.siStatus === '정산완료')) {
            result.skippedLocked++;
            if (isDbgRow) dbg.currentFlow.skipReason = `locked: status=${row.siStatus}, lockedAmount=${row.siLockedAmount}`;
            continue;
          }

          if (!row.contactCode) {
            result.skippedNoContactCode++;
            if (isDbgRow) dbg.currentFlow.skipReason = 'contactCode가 null/empty';
            continue;
          }

          // CC 조회 (캐시 우선) — dealerRegistrationId + realSalesPOS 함께 캐시
          let ccDealerRegId: number | null;
          let realSalesPOS: string | null;
          if (ccDetailCache.has(row.contactCode)) {
            const cached = ccDetailCache.get(row.contactCode)!;
            ccDealerRegId = cached.dealerRegistrationId;
            realSalesPOS = cached.realSalesPOS;
          } else {
            const ccRows = await db.select({
              dealerRegistrationId: contactCodes.dealerRegistrationId,
              realSalesPOS: contactCodes.realSalesPOS,
            }).from(contactCodes)
              .where(and(eq(contactCodes.code, row.contactCode), eq(contactCodes.isActive, true)))
              .limit(1);
            ccDealerRegId = ccRows[0]?.dealerRegistrationId ?? null;
            realSalesPOS = ccRows[0]?.realSalesPOS ?? null;
            ccDetailCache.set(row.contactCode, { dealerRegistrationId: ccDealerRegId, realSalesPOS });
          }

          // 유효 DR 결정: realSalesPOS → businessName 우선 매칭, 없으면 cc.dealerRegistrationId fallback
          // Rule: realSalesPOS DR 존재 시 isHiddenPos=false여도 fallback 없이 그대로 처리
          let effectiveDealerRegId: number | null = null;
          let isHiddenPos: boolean = false;
          let effectiveDrInfo: any = null;

          if (realSalesPOS) {
            let drByPOS: { id: number; dealerCode: string | null; businessName: string; isHiddenPos: boolean | null } | null;
            if (posCache.has(realSalesPOS)) {
              drByPOS = posCache.get(realSalesPOS)!;
            } else {
              const posDrRows = await db.select({
                id: dealerRegistrations.id,
                dealerCode: dealerRegistrations.dealerCode,
                businessName: dealerRegistrations.businessName,
                isHiddenPos: dealerRegistrations.isHiddenPos,
              }).from(dealerRegistrations)
                .where(eq(dealerRegistrations.businessName, realSalesPOS))
                .limit(1);
              drByPOS = posDrRows[0] ?? null;
              posCache.set(realSalesPOS, drByPOS);
            }

            if (drByPOS) {
              // realSalesPOS DR 발견 → 이 DR 사용, isHiddenPos=false여도 fallback 없음
              effectiveDealerRegId = drByPOS.id;
              isHiddenPos = !!drByPOS.isHiddenPos;
              effectiveDrInfo = drByPOS;
            } else {
              // realSalesPOS DR 미발견 → cc.dealerRegistrationId fallback
              effectiveDealerRegId = ccDealerRegId;
              if (effectiveDealerRegId != null) {
                if (drCache.has(effectiveDealerRegId)) {
                  isHiddenPos = drCache.get(effectiveDealerRegId)!;
                } else {
                  const drFb = await db.select({
                    id: dealerRegistrations.id, dealerCode: dealerRegistrations.dealerCode,
                    businessName: dealerRegistrations.businessName, isHiddenPos: dealerRegistrations.isHiddenPos,
                  }).from(dealerRegistrations).where(eq(dealerRegistrations.id, effectiveDealerRegId)).limit(1);
                  isHiddenPos = !!drFb[0]?.isHiddenPos;
                  effectiveDrInfo = drFb[0] ?? null;
                  drCache.set(effectiveDealerRegId, isHiddenPos);
                }
              }
            }

            if (isDbgRow) {
              dbg.currentFlow.ccFound = true;
              dbg.currentFlow.realSalesPOS = realSalesPOS;
              dbg.currentFlow.dealerRegIdFromCC = ccDealerRegId;
              dbg.currentFlow.drByRegId = effectiveDrInfo ?? { id: effectiveDealerRegId, note: '(캐시)' };
              dbg.currentFlow.isHiddenPosByRegId = isHiddenPos;
              dbg.realSalesPOSFlow.realSalesPOS = realSalesPOS;
              dbg.realSalesPOSFlow.drByRealSalesPOS = drByPOS ?? null;
              dbg.realSalesPOSFlow.isHiddenPosByRealSalesPOS = drByPOS?.isHiddenPos ?? null;
              dbg.realSalesPOSFlow.note = drByPOS
                ? `realSalesPOS="${realSalesPOS}" → DR id=${drByPOS.id} (${drByPOS.dealerCode}) isHiddenPos=${drByPOS.isHiddenPos} → 실제판매점 DR 사용`
                : `realSalesPOS="${realSalesPOS}" → 매칭 DR 없음 → 정산지급처 DR (id=${ccDealerRegId}) fallback`;
            }
          } else {
            // realSalesPOS 없음 → cc.dealerRegistrationId 사용
            effectiveDealerRegId = ccDealerRegId;
            if (effectiveDealerRegId != null) {
              if (drCache.has(effectiveDealerRegId)) {
                isHiddenPos = drCache.get(effectiveDealerRegId)!;
              } else {
                const drRows = await db.select({
                  id: dealerRegistrations.id, dealerCode: dealerRegistrations.dealerCode,
                  businessName: dealerRegistrations.businessName, isHiddenPos: dealerRegistrations.isHiddenPos,
                }).from(dealerRegistrations).where(eq(dealerRegistrations.id, effectiveDealerRegId)).limit(1);
                isHiddenPos = !!drRows[0]?.isHiddenPos;
                effectiveDrInfo = drRows[0] ?? null;
                drCache.set(effectiveDealerRegId, isHiddenPos);
              }
            }

            if (isDbgRow) {
              dbg.currentFlow.ccFound = true;
              dbg.currentFlow.realSalesPOS = null;
              dbg.currentFlow.dealerRegIdFromCC = ccDealerRegId;
              dbg.currentFlow.drByRegId = effectiveDrInfo ?? { id: effectiveDealerRegId, note: '(캐시)' };
              dbg.currentFlow.isHiddenPosByRegId = isHiddenPos;
              dbg.realSalesPOSFlow.note = 'realSalesPOS 없음 → 정산지급처 DR 사용';
            }
          }

          if (effectiveDealerRegId == null) {
            result.skippedNoDealer++;
            if (isDbgRow) dbg.currentFlow.skipReason = `유효 DR 없음: realSalesPOS=${realSalesPOS ?? 'null'}, ccDealerRegId=${ccDealerRegId ?? 'null'}`;
            if (!dryRun) {
              await db.update(settlementItems).set({ hiddenAmount: null }).where(eq(settlementItems.id, row.siId));
            }
            result.cleared++;
            continue;
          }

          if (!isHiddenPos) {
            result.skippedNotHiddenPos++;
            if (isDbgRow) dbg.currentFlow.skipReason = `isHiddenPos=false (DR id=${effectiveDealerRegId})`;
            if (!dryRun) {
              await db.update(settlementItems).set({ hiddenAmount: null }).where(eq(settlementItems.id, row.siId));
            }
            result.cleared++;
            continue;
          }

          // 정책 매칭
          const activationDate = row.activationDatetime ? new Date(row.activationDatetime) : null;
          let total = 0;
          let firstMismatch: string | null = null;
          const dbgPolicyTrace: any[] = [];

          for (const policy of allPolicies) {
            let skipReason: string | null = null;
            if (policy.dealerRegistrationId != null && policy.dealerRegistrationId !== effectiveDealerRegId) {
              if (!firstMismatch) firstMismatch = 'dealerMismatch';
              skipReason = `dealerRegId 불일치: policy=${policy.dealerRegistrationId} vs effective=${effectiveDealerRegId}`;
            } else if (policy.contactCode && n(policy.contactCode) !== n(row.contactCode)) {
              if (!firstMismatch) firstMismatch = 'contactCodeMismatch';
              skipReason = `contactCode 불일치: policy="${policy.contactCode}" vs "${row.contactCode}"`;
            } else if (policy.channel && n(policy.channel) !== n(row.channel)) {
              if (!firstMismatch) firstMismatch = 'channelMismatch';
              skipReason = `channel 불일치: policy="${policy.channel}" vs "${row.channel}"`;
            } else if (policy.planName && n(policy.planName) !== n(row.planName)) {
              if (!firstMismatch) firstMismatch = 'planNameMismatch';
              skipReason = `planName 불일치: policy="${policy.planName}" vs "${row.planName}"`;
            } else if (policy.customerType && n(policy.customerType) !== n(row.customerType)) {
              if (!firstMismatch) firstMismatch = 'customerTypeMismatch';
              skipReason = `customerType 불일치: policy="${policy.customerType}" vs "${row.customerType}"`;
            } else if (activationDate && policy.effectiveFrom && toKSTDateStr(activationDate) < toKSTDateStr(new Date(policy.effectiveFrom))) {
              if (!firstMismatch) firstMismatch = 'periodMismatch';
              skipReason = `기간 전(KST): from=${toKSTDateStr(new Date(policy.effectiveFrom))}, activation=${toKSTDateStr(activationDate)}`;
            } else if (activationDate && policy.effectiveTo && toKSTDateStr(activationDate) > toKSTDateStr(new Date(policy.effectiveTo))) {
              if (!firstMismatch) firstMismatch = 'periodMismatch';
              skipReason = `기간 후(KST): to=${toKSTDateStr(new Date(policy.effectiveTo))}, activation=${toKSTDateStr(activationDate)}`;
            }
            if (skipReason) {
              if (isDbgRow) dbgPolicyTrace.push({ policyId: policy.id, result: 'SKIP', reason: skipReason });
            } else {
              total += Number(policy.hiddenAmount) || 0;
              if (isDbgRow) dbgPolicyTrace.push({ policyId: policy.id, result: 'MATCH', hiddenAmount: policy.hiddenAmount });
            }
          }

          if (isDbgRow) {
            dbg.currentFlow.policyTrace = dbgPolicyTrace;
            dbg.currentFlow.matchedCount = dbgPolicyTrace.filter((t: any) => t.result === 'MATCH').length;
            dbg.currentFlow.hiddenAmount = total;
            if (total === 0) dbg.currentFlow.skipReason = `정책 없음 (firstMismatch: ${firstMismatch ?? 'none'})`;
            // realSalesPOSFlow는 DR 결정 단계에서 이미 채워짐 (별도 시뮬레이션 불필요)
            if (!dbg.realSalesPOSFlow.policyTrace?.length) {
              dbg.realSalesPOSFlow.policyTrace = dbgPolicyTrace;
              dbg.realSalesPOSFlow.matchedCount = dbg.currentFlow.matchedCount;
              dbg.realSalesPOSFlow.hiddenAmount = total;
            }
          }

          // skipReason을 별도 변수로 제거하고 기존 continue 패턴을 복원
          if (total > 0) {
            if (!dryRun) {
              await db.update(settlementItems).set({ hiddenAmount: String(total) }).where(eq(settlementItems.id, row.siId));
            }
            result.updated++;
          } else {
            result.skippedNoPolicy++;
            if (firstMismatch && firstMismatch in result.policyMismatchDetail) {
              (result.policyMismatchDetail as any)[firstMismatch]++;
            }
            if (!dryRun) {
              await db.update(settlementItems).set({ hiddenAmount: null }).where(eq(settlementItems.id, row.siId));
            }
            result.cleared++;
          }
        } catch (e: any) {
          result.errors.push(`siId:${row.siId} - ${e.message}`);
        }
      }

      return { ...result, ...(dbg ? { debug: dbg } : {}) };
    });
  }

  async diagnoseHiddenAmount(contactCode: string, dateFrom?: string, dateTo?: string): Promise<any> {
    return this.withDatabase(async (db) => {
      const n = (v: any): string => String(v ?? '').trim();
      const diag: any = { contactCode, steps: [] };

      // STEP 1: activation_records 조회
      const arConds: any[] = [eq(activationRecords.contactCode, contactCode)];
      if (dateFrom) arConds.push(gte(activationRecords.activationDatetime, new Date(dateFrom)));
      if (dateTo)   arConds.push(lte(activationRecords.activationDatetime, new Date(dateTo + 'T23:59:59')));
      const arRows = await db.select({
        id: activationRecords.id,
        contactCode: activationRecords.contactCode,
        channel: activationRecords.channel,
        planName: activationRecords.planName,
        customerType: activationRecords.customerType,
        activationDatetime: activationRecords.activationDatetime,
      }).from(activationRecords).where(and(...arConds));
      diag.steps.push({ step: 1, label: 'activation_records 조회', count: arRows.length, rows: arRows.slice(0, 5) });

      if (arRows.length === 0) {
        diag.conclusion = '❌ activation_records에 해당 접점코드 건이 없음 (날짜 범위 확인 필요)';
        return diag;
      }

      // STEP 2: settlement_items 연결 확인
      const siRows = await db.select({
        id: settlementItems.id,
        activationId: settlementItems.activationId,
        status: settlementItems.status,
        lockedAmount: settlementItems.lockedAmount,
        hiddenAmount: settlementItems.hiddenAmount,
      }).from(settlementItems)
        .innerJoin(activationRecords, eq(settlementItems.activationId, activationRecords.id))
        .where(eq(activationRecords.contactCode, contactCode));
      diag.steps.push({ step: 2, label: 'settlement_items 연결', count: siRows.length, rows: siRows.slice(0, 5) });

      // STEP 3: contact_codes 조회 (active/inactive 모두)
      const ccAll = await db.select({
        id: contactCodes.id,
        code: contactCodes.code,
        isActive: contactCodes.isActive,
        dealerRegistrationId: contactCodes.dealerRegistrationId,
        dealerName: contactCodes.dealerName,
        realSalesPOS: contactCodes.realSalesPOS,
        carrier: contactCodes.carrier,
      }).from(contactCodes).where(eq(contactCodes.code, contactCode));
      diag.steps.push({ step: 3, label: 'contact_codes 전체 (active포함)', count: ccAll.length, rows: ccAll });

      const ccActive = ccAll.filter((r: any) => r.isActive !== false);
      diag.steps.push({ step: '3a', label: 'contact_codes (isActive=true만)', count: ccActive.length, rows: ccActive });

      if (ccActive.length === 0) {
        diag.conclusion = ccAll.length > 0
          ? '❌ contact_codes에 해당 코드 존재하나 isActive=false → skippedNoDealer 처리됨'
          : '❌ contact_codes에 해당 코드 없음 → skippedNoDealer 처리됨';
        return diag;
      }

      const cc = ccActive[0];
      if (!cc.dealerRegistrationId) {
        diag.conclusion = '❌ contact_codes.dealerRegistrationId가 null → skippedNoDealer 처리됨';
        return diag;
      }

      // STEP 4: dealer_registrations 조회
      const drRows = await db.select({
        id: dealerRegistrations.id,
        businessName: dealerRegistrations.businessName,
        dealerCode: dealerRegistrations.dealerCode,
        isHiddenPos: dealerRegistrations.isHiddenPos,
        isActive: dealerRegistrations.isActive,
      }).from(dealerRegistrations).where(eq(dealerRegistrations.id, cc.dealerRegistrationId));
      diag.steps.push({ step: 4, label: 'dealer_registrations (dealerRegistrationId 기준)', rows: drRows });

      if (!drRows[0]) {
        diag.conclusion = '❌ dealer_registrations 레코드 없음 → skippedNoDealer';
        return diag;
      }
      const dr = drRows[0];
      if (!dr.isHiddenPos) {
        diag.conclusion = `❌ dealer_registrations.isHiddenPos=false (DR: ${dr.businessName}) → skippedNotHiddenPos`;
        return diag;
      }

      // STEP 5: realSalesPOS 기준 DR 조회 (참고용)
      if (cc.realSalesPOS) {
        const drByPOS = await db.select({
          id: dealerRegistrations.id,
          businessName: dealerRegistrations.businessName,
          isHiddenPos: dealerRegistrations.isHiddenPos,
        }).from(dealerRegistrations).where(eq(dealerRegistrations.businessName, cc.realSalesPOS));
        diag.steps.push({ step: 5, label: `realSalesPOS="${cc.realSalesPOS}" 기준 DR 조회 (참고)`, rows: drByPOS });
      }

      // STEP 6: hidden_policy_rows 전체 active 조회
      const allPolicies = await db.select().from(hiddenPolicyRows).where(eq(hiddenPolicyRows.isActive, true));
      diag.steps.push({ step: 6, label: 'hidden_policy_rows (isActive=true)', count: allPolicies.length, rows: allPolicies.slice(0, 20) });

      // STEP 7: 대표 activation_record 1건으로 정책 매칭 시뮬레이션
      const sample = arRows[0];
      const activationDate = sample.activationDatetime ? new Date(sample.activationDatetime) : null;
      const policyTrace: any[] = [];
      let matchCount = 0;

      for (const policy of allPolicies) {
        const trace: any = { policyId: policy.id, dealerRegistrationId: policy.dealerRegistrationId, result: 'PASS', rejectReason: null };
        if (policy.dealerRegistrationId != null && policy.dealerRegistrationId !== cc.dealerRegistrationId) {
          trace.result = 'SKIP'; trace.rejectReason = `dealerRegistrationId 불일치: policy=${policy.dealerRegistrationId} vs cc=${cc.dealerRegistrationId}`;
        } else if (policy.contactCode && n(policy.contactCode) !== n(sample.contactCode)) {
          trace.result = 'SKIP'; trace.rejectReason = `contactCode 불일치: policy="${policy.contactCode}" vs record="${sample.contactCode}"`;
        } else if (policy.channel && n(policy.channel) !== n(sample.channel)) {
          trace.result = 'SKIP'; trace.rejectReason = `channel 불일치: policy="${policy.channel}" vs record="${sample.channel}"`;
        } else if (policy.planName && n(policy.planName) !== n(sample.planName)) {
          trace.result = 'SKIP'; trace.rejectReason = `planName 불일치: policy="${policy.planName}" vs record="${sample.planName}"`;
        } else if (policy.customerType && n(policy.customerType) !== n(sample.customerType)) {
          trace.result = 'SKIP'; trace.rejectReason = `customerType 불일치: policy="${policy.customerType}" vs record="${sample.customerType}"`;
        } else if (activationDate && policy.effectiveFrom && activationDate < new Date(policy.effectiveFrom)) {
          trace.result = 'SKIP'; trace.rejectReason = `기간 전: effectiveFrom=${policy.effectiveFrom} > activationDate=${activationDate.toISOString()}`;
        } else if (activationDate && policy.effectiveTo && activationDate > new Date(policy.effectiveTo)) {
          trace.result = 'SKIP'; trace.rejectReason = `기간 후: effectiveTo=${policy.effectiveTo} < activationDate=${activationDate.toISOString()}`;
        } else {
          matchCount++;
          trace.hiddenAmount = policy.hiddenAmount;
        }
        policyTrace.push(trace);
      }

      diag.steps.push({
        step: 7,
        label: `정책 매칭 시뮬레이션 (샘플: arId=${sample.id}, channel="${sample.channel}", plan="${sample.planName}", customerType="${sample.customerType}", date=${sample.activationDatetime})`,
        matchCount,
        policyTrace,
      });

      if (matchCount === 0) {
        const reasons = policyTrace.filter(t => t.result === 'SKIP').map(t => t.rejectReason);
        const reasonCounts: Record<string, number> = {};
        reasons.forEach(r => { const k = r?.split(':')[0] ?? 'unknown'; reasonCounts[k] = (reasonCounts[k] ?? 0) + 1; });
        diag.conclusion = `❌ 정책 매칭 없음 (allPolicies=${allPolicies.length}개). 탈락 이유 분포: ${JSON.stringify(reasonCounts)}`;
      } else {
        diag.conclusion = `✅ ${matchCount}개 정책 매칭됨. 히든금액 합산이 0보다 크면 updated 처리되어야 함.`;
      }

      return diag;
    });
  }
}

let storage: IStorage | null = null;

export async function initStorage(): Promise<void> {
  if (storage) {
    console.log("Storage already initialized");
    return;
  }
  
  console.log("Initializing Storage...");
  storage = new PostgreSQLStorage();
  console.log("✅ Storage initialization successful");
}

export function getStorage(): IStorage {
  if (!storage) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return storage;
}
