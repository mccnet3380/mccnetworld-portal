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
  dealerRegistrations
} from "../shared/schema";
import { getDatabase } from "./db";

// 🔍 배치 동기화 디버그 로깅 제어
// 개발에서는 기본 on, 운영에서는 기본 off (운영에서도 LOG_BATCH_DEBUG=true로 임시 활성 가능)
const LOG_BATCH_DEBUG =
  (process.env.LOG_BATCH_DEBUG ?? "").toLowerCase() === "true" ||
  (process.env.APP_ENV ?? "development") !== "production";

// ✅ child 문서 판별용 SQL 패턴: notes LIKE %\"isChild\":true%
const CHILD_LIKE = `%\\"isChild\\":true%`;

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
  updateDealer(id: number, data: any): Promise<void>;
  deleteDealer(id: number): Promise<void>;

  // Document methods
  createDocument(document: any): Promise<any>;
  getDocuments(filters?: any, userId?: number, userType?: string): Promise<any[]>;
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
  getContactCodes(carrier?: string): Promise<any[]>;
  getContactCodeByCode(code: string): Promise<any>;
  getContactCodeByCarrierAndCode(carrier: string, code: string): Promise<any>;
  searchContactCodes(query: string, limit?: number): Promise<any[]>;
  getContactCodeAutoMatch(dealerName: string, carrier: string): Promise<any | null>;
  createContactCode(code: any): Promise<any>;
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
}

export class PostgreSQLStorage implements IStorage {
  private async withDatabase<T>(operation: (db: any) => Promise<T>): Promise<T> {
    const db = await getDatabase();
    return operation(db);
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

  async getDocuments(filters?: any, userId?: number, userType?: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      console.log('[getDocuments] START - filters:', JSON.stringify(filters), 'userId:', userId, 'userType:', userType);
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
      
      if (filters) {
        console.log('[getDocuments] Applying filters...');
        const conditions = [];
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
        
        // Permission-based filtering: dealers can only see their own documents
        if (filters.userType === 'user' && filters.dealerId && !filters.allWorkers) {
          console.log('[getDocuments] Filtering by dealerId:', filters.dealerId);
          conditions.push(eq(documents.dealerId, filters.dealerId));
        }
        
        // Fallback: filter by userId when dealerId is not available (for dealers without dealer_id)
        if (filters.userType === 'user' && filters.userId && !filters.dealerId && !filters.allWorkers) {
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
      
      console.log('[getDocuments] Executing query...');
      const results = await query.orderBy(desc(documents.id));
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

  async getContactCodes(carrier?: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      if (carrier && carrier !== 'all') {
        return await db.select().from(contactCodes).where(eq(contactCodes.carrier, carrier));
      }
      return await db.select().from(contactCodes);
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
