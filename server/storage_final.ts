// server/storage.ts - 환경 분리 최종본 (세션 서명 + 레거시 호환)
import { eq, count, sql, and, gte, lte, inArray, isNull, desc, or } from "drizzle-orm";
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
  contactCodes,
  hiddenPricesByPos,
  otherBusinessCarriers
} from "../shared/schema";
import { getDatabase } from "./db";

// 🚨 CRITICAL: 세션 토큰 마스킹 유틸리티
function maskSessionToken(token: string): string {
  if (!token || token.length < 8) return '***';
  return token.substring(0, 4) + '***' + token.substring(token.length - 4);
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
  getAdmins(): Promise<any[]>;
  getAdminByUsername(username: string): Promise<any>;
  updateAdminPassword(id: number, pw: string): Promise<void>;
  getAdminCount(): Promise<number>;

  // User methods
  createUser(user: any): Promise<any>;
  getUserById(id: number): Promise<any>;
  getUsers(): Promise<any[]>;
  updateUserPassword(id: number, password: string): Promise<void>;
  getUserByUsername(username: string): Promise<any>;

  // Document methods
  createDocument(document: any): Promise<any>;
  getDocuments(filters?: any): Promise<any[]>;
  getDocumentById(id: number): Promise<any>;
  updateDocument(id: number, data: any): Promise<void>;
  updateDocumentStatus(id: number, status: string, updatedBy?: number): Promise<void>;
  deleteDocument(id: number): Promise<void>;
  getDocumentStatistics(): Promise<any>;

  // Chat methods
  createChatMessage(message: any): Promise<any>;
  getChatMessages(params: any): Promise<any[]>;

  // Stats methods
  getDashboardStats(): Promise<any>;
  getActivationStats(): Promise<any>;

  // Service plans methods
  getServicePlans(): Promise<any[]>;
  createServicePlan(plan: any): Promise<any>;
  updateServicePlan(id: number, data: any): Promise<void>;

  // Contact codes methods
  getContactCodes(): Promise<any[]>;
  searchContactCodes(query: string): Promise<any[]>;
  createContactCode(code: any): Promise<any>;
  bulkCreateContactCodes(codes: any[]): Promise<number>;

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

  // Additional placeholder methods for completeness
  getSalesTeams(): Promise<any[]>;
  createSalesTeam(team: any): Promise<any>;
  updateSalesTeam(id: number, data: any): Promise<void>;
  deleteSalesTeam(id: number): Promise<void>;
  getSalesManagers(): Promise<any[]>;
  getSalesManagerById(id: number): Promise<any>;
  createSalesManager(manager: any): Promise<any>;
  updateSalesManager(id: number, data: any): Promise<void>;
  deleteSalesManager(id: number): Promise<void>;
  getAdditionalServices(): Promise<any[]>;
  createAdditionalService(service: any): Promise<any>;
  updateAdditionalService(id: number, data: any): Promise<void>;
  deleteAdditionalService(id: number): Promise<void>;
  getSettlementUnitPrices(): Promise<any[]>;
  createSettlementUnitPrice(price: any): Promise<any>;
  updateSettlementUnitPrice(id: number, data: any): Promise<void>;
  deleteSettlementUnitPrice(id: number): Promise<void>;
  getDocumentTemplates(): Promise<any[]>;
  createDocumentTemplate(template: any): Promise<any>;
  updateDocumentTemplate(id: number, data: any): Promise<void>;
  deleteDocumentTemplate(id: number): Promise<void>;
  createDealer(dealer: any): Promise<any>;
  getDealers(): Promise<any[]>;
  getDealerById(id: number): Promise<any>;
  updateDealer(id: number, data: any): Promise<void>;
  deleteDealer(id: number): Promise<void>;
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
      const user = await db.select().from(users).where(eq(users.username, username)).limit(1);
      if (user.length === 0) return null;

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
    });
  }

  async authenticateSalesManager(username: string, password: string) {
    // 영업과장 인증 로직
    return null;
  }

  async authenticateWorker(username: string, password: string) {
    // 작업자 인증 로직
    return null;
  }

  // 🔐 세션 관리 - 환경별 시크릿 서명 적용 + 레거시 호환
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
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24시간
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
      // 🔐 레거시 세션 지원 종료일: 2025-10-03 (Must-fix 1번 적용)
      const LEGACY_CUTOFF_DATE = new Date('2025-10-03T00:00:00Z');
      const now = new Date();
      
      // 1️⃣ 서명된 세션 형식 우선 검증 (sessionId.signature)
      const parts = sid.split('.');
      if (parts.length === 2) {
        const [sessionId, signature] = parts;
        if (verifySessionToken(sessionId, signature)) {
          const session = await db.select().from(sessions).where(eq(sessions.sid, sid)).limit(1);
          if (session.length > 0) {
            // 세션 만료 확인
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
      
      // 2️⃣ 레거시 세션 형식 (서명 없음) - 한시적 허용
      if (now < LEGACY_CUTOFF_DATE) {
        console.warn(`⚠️ Legacy session format detected: ${maskSessionToken(sid)} (cutoff: ${LEGACY_CUTOFF_DATE.toISOString()})`);
        
        const legacySession = await db.select().from(sessions).where(eq(sessions.sid, sid)).limit(1);
        if (legacySession.length > 0) {
          // 세션 만료 확인
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

  // 관리자 관련 메서드들
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

  async getAdmins(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(admins);
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

  // 사용자 관련 메서드들
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
      return await db.select().from(users);
    });
  }

  async updateUserPassword(id: number, password: string): Promise<void> {
    return this.withDatabase(async (db) => {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
    });
  }

  async getUserByUsername(username: string) {
    return this.withDatabase(async (db) => {
      const user = await db.select().from(users).where(eq(users.username, username)).limit(1);
      return user.length > 0 ? user[0] : null;
    });
  }

  // 나머지 메서드들은 기존 구현을 유지하면서 Promise 타입만 추가
  async createDealer(dealer: any): Promise<any> {
    return this.withDatabase(async (db) => {
      const result = await db.insert(users).values(dealer).returning();
      return result[0];
    });
  }

  async getDealers(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(users).where(eq(users.userType, 'dealer'));
    });
  }

  async getDealerById(id: number): Promise<any> {
    return this.withDatabase(async (db) => {
      const dealer = await db.select().from(users).where(and(eq(users.id, id), eq(users.userType, 'dealer'))).limit(1);
      return dealer.length > 0 ? dealer[0] : null;
    });
  }

  async updateDealer(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(users).set(data).where(eq(users.id, id));
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

  async getDocuments(filters?: any): Promise<any[]> {
    return this.withDatabase(async (db) => {
      let query = db.select().from(documents);
      
      if (filters) {
        const conditions = [];
        if (filters.status) conditions.push(eq(documents.status, filters.status));
        if (filters.search) conditions.push(sql`${documents.customerName} ILIKE ${`%${filters.search}%`}`);
        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }
      }
      
      return await query.orderBy(desc(documents.id));
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
      await db.update(documents).set(data).where(eq(documents.id, id));
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
      // 기본 통계 구현
      const total = await db.select({ count: count() }).from(documents);
      return { total: total[0].count };
    });
  }

  async createChatMessage(message: any): Promise<any> {
    // 채팅 메시지는 별도 테이블이 필요하므로 임시 구현
    return Promise.resolve({ id: 1, ...message });
  }

  async getChatMessages(params: any): Promise<any[]> {
    // 채팅 메시지 조회 임시 구현
    return Promise.resolve([]);
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

  async updateServicePlan(id: number, data: any): Promise<void> {
    return this.withDatabase(async (db) => {
      await db.update(servicePlans).set(data).where(eq(servicePlans.id, id));
    });
  }

  async getContactCodes(): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(contactCodes);
    });
  }

  async searchContactCodes(query: string): Promise<any[]> {
    return this.withDatabase(async (db) => {
      return await db.select().from(contactCodes)
        .where(sql`${contactCodes.code} ILIKE ${`%${query}%`}`)
        .limit(50);
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

  // 나머지 메서드들은 기본 구현만 제공 (실제 테이블이 없는 경우)
  async getSalesTeams(): Promise<any[]> { return []; }
  async createSalesTeam(team: any): Promise<any> { return team; }
  async updateSalesTeam(id: number, data: any): Promise<void> { }
  async deleteSalesTeam(id: number): Promise<void> { }

  async getSalesManagers(): Promise<any[]> { return []; }
  async getSalesManagerById(id: number): Promise<any> { return null; }
  async createSalesManager(manager: any): Promise<any> { return manager; }
  async updateSalesManager(id: number, data: any): Promise<void> { }
  async deleteSalesManager(id: number): Promise<void> { }

  async getAdditionalServices(): Promise<any[]> { return []; }
  async createAdditionalService(service: any): Promise<any> { return service; }
  async updateAdditionalService(id: number, data: any): Promise<void> { }
  async deleteAdditionalService(id: number): Promise<void> { }

  async getSettlementUnitPrices(): Promise<any[]> { return []; }
  async createSettlementUnitPrice(price: any): Promise<any> { return price; }
  async updateSettlementUnitPrice(id: number, data: any): Promise<void> { }
  async deleteSettlementUnitPrice(id: number): Promise<void> { }

  async getDocumentTemplates(): Promise<any[]> { return []; }
  async createDocumentTemplate(template: any): Promise<any> { return template; }
  async updateDocumentTemplate(id: number, data: any): Promise<void> { }
  async deleteDocumentTemplate(id: number): Promise<void> { }
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