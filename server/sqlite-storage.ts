import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { eq, and, desc, asc, sql, or, like, gte, lte, lt, inArray, count, isNull, isNotNull, ne } from 'drizzle-orm';
import { getSQLiteDatabase, getSQLiteClient } from './sqlite-db';
import * as schema from '../shared/sqlite-schema';
import type { IStorage } from './storage';
import type {
  Admin,
  User,
  Carrier,
  ServicePlan,
  AdditionalService,
  Document,
  SalesTeam,
  SalesManager,
  ContactCode,
  SettlementUnitPrice,
  OtherCarrier,
  Dealer,
  DealerRegistration,
  AppSession
} from '../shared/sqlite-schema';

// 타입 변환 유틸리티 함수들
function transformCarrier(carrier: any): Carrier {
  return {
    ...carrier,
    bundleNumber: carrier.bundleNumber ?? undefined,
    bundleCarrier: carrier.bundleCarrier ?? undefined,
  };
}

function transformServicePlan(plan: any): ServicePlan {
  return {
    ...plan,
    dataAllowance: plan.dataAllowance ?? undefined,
  };
}

function transformAdditionalService(service: any): AdditionalService {
  return {
    ...service,
    isActive: service.isActive ?? true,
  };
}

// SQLite 기반 저장소 구현
export class SQLiteStorage implements IStorage {
  private db: any;
  private sqliteClient: any;
  
  constructor() {
    this.db = getSQLiteDatabase();
    this.sqliteClient = getSQLiteClient();
  }
  
  // 관리자 관련 메서드
  async createAdmin(admin: { username: string; password: string; name: string }): Promise<Admin> {
    const hashedPassword = await bcrypt.hash(admin.password, 10);
    const [result] = await this.db.insert(schema.admins).values({
      ...admin,
      password: hashedPassword,
      isActive: true
    }).returning();
    return result;
  }
  
  async getAdminByUsername(username: string): Promise<Admin | undefined> {
    const [admin] = await this.db.select()
      .from(schema.admins)
      .where(and(eq(schema.admins.username, username), eq(schema.admins.isActive, true)))
      .limit(1);
    return admin;
  }
  
  async getAdminById(id: number): Promise<Admin | undefined> {
    const [admin] = await this.db.select()
      .from(schema.admins)
      .where(eq(schema.admins.id, id))
      .limit(1);
    return admin;
  }
  
  async authenticateAdmin(username: string, password: string): Promise<Admin | null> {
    const admin = await this.getAdminByUsername(username);
    if (!admin || !admin.isActive) return null;
    
    const isValidPassword = await bcrypt.compare(password, admin.password);
    return isValidPassword ? admin : null;
  }
  
  async authenticateUser(username: string, password: string): Promise<any> {
    // 먼저 관리자 확인
    const admin = await this.authenticateAdmin(username, password);
    if (admin) {
      return { ...admin, userType: 'admin' };
    }
    
    // 영업과장 확인
    const manager = await this.authenticateSalesManager(username, password);
    if (manager) {
      return { ...manager, userType: 'sales_manager' };
    }
    
    // 일반 사용자 확인
    const worker = await this.authenticateWorker(username, password);
    if (worker) {
      return { ...worker, userType: 'user' };
    }
    
    return null;
  }
  
  async authenticateSalesManager(username: string, password: string): Promise<SalesManager | null> {
    const [manager] = await this.db.select()
      .from(schema.salesManagers)
      .where(and(eq(schema.salesManagers.username, username), eq(schema.salesManagers.isActive, true)))
      .limit(1);
    
    if (!manager) return null;
    
    const isValidPassword = await bcrypt.compare(password, manager.password);
    return isValidPassword ? manager : null;
  }
  
  async authenticateWorker(username: string, password: string): Promise<User | null> {
    const [user] = await this.db.select()
      .from(schema.users)
      .where(and(eq(schema.users.username, username), eq(schema.users.isActive, true)))
      .limit(1);
    
    if (!user) return null;
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    return isValidPassword ? user : null;
  }
  
  // 접점 코드 관련 메서드
  async getContactCodes(): Promise<ContactCode[]> {
    return await this.db.select().from(schema.contactCodes).orderBy(schema.contactCodes.code);
  }
  
  async getContactCodeByCode(code: string): Promise<ContactCode | undefined> {
    const [contactCode] = await this.db.select()
      .from(schema.contactCodes)
      .where(eq(schema.contactCodes.code, code))
      .limit(1);
    return contactCode;
  }
  
  async createContactCode(data: any): Promise<ContactCode> {
    const [result] = await this.db.insert(schema.contactCodes).values(data).returning();
    return result;
  }
  
  async updateContactCode(id: number, data: any): Promise<ContactCode> {
    const [result] = await this.db.update(schema.contactCodes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.contactCodes.id, id))
      .returning();
    
    if (!result) throw new Error('접점코드를 찾을 수 없습니다');
    return result;
  }
  
  // 누락된 deleteContactCode 메서드 추가
  async deleteContactCode(id: number): Promise<void> {
    await this.db.delete(schema.contactCodes).where(eq(schema.contactCodes.id, id));
  }
  
  async bulkCreateContactCodes(codes: any[]): Promise<ContactCode[]> {
    const results = await this.db.insert(schema.contactCodes).values(codes).returning();
    return results;
  }
  
  // 통신사 관련 메서드 (타입 변환 적용)
  async getCarriers(): Promise<Carrier[]> {
    const carriers = await this.db.select().from(schema.carriers).orderBy(schema.carriers.displayOrder);
    return carriers.map(transformCarrier);
  }
  
  async createCarrier(data: any): Promise<Carrier> {
    const [result] = await this.db.insert(schema.carriers).values(data).returning();
    return transformCarrier(result);
  }
  
  async updateCarrier(id: number, data: any): Promise<Carrier> {
    const [result] = await this.db.update(schema.carriers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.carriers.id, id))
      .returning();
    
    if (!result) throw new Error('통신사를 찾을 수 없습니다');
    return transformCarrier(result);
  }
  
  async deleteCarrier(id: number): Promise<void> {
    await this.db.delete(schema.carriers).where(eq(schema.carriers.id, id));
  }
  
  async getCarrierById(id: number): Promise<Carrier | undefined> {
    const [carrier] = await this.db.select()
      .from(schema.carriers)
      .where(eq(schema.carriers.id, id))
      .limit(1);
    return carrier ? transformCarrier(carrier) : undefined;
  }
  
  async getCarrierByName(name: string): Promise<Carrier | undefined> {
    const [carrier] = await this.db.select()
      .from(schema.carriers)
      .where(eq(schema.carriers.name, name))
      .limit(1);
    return carrier ? transformCarrier(carrier) : undefined;
  }
  
  // 영업팀 관련 메서드
  async getSalesTeams(): Promise<SalesTeam[]> {
    return await this.db.select().from(schema.salesTeams).orderBy(schema.salesTeams.teamName);
  }
  
  async createSalesTeam(data: any): Promise<SalesTeam> {
    const [result] = await this.db.insert(schema.salesTeams).values(data).returning();
    return result;
  }
  
  async updateSalesTeam(id: number, data: any): Promise<SalesTeam> {
    const [result] = await this.db.update(schema.salesTeams)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.salesTeams.id, id))
      .returning();
    
    if (!result) throw new Error('영업팀을 찾을 수 없습니다');
    return result;
  }
  
  async deleteSalesTeam(id: number): Promise<void> {
    await this.db.delete(schema.salesTeams).where(eq(schema.salesTeams.id, id));
  }
  
  async getSalesTeamById(id: number): Promise<SalesTeam | undefined> {
    const [team] = await this.db.select()
      .from(schema.salesTeams)
      .where(eq(schema.salesTeams.id, id))
      .limit(1);
    return team;
  }
  
  // 영업과장 관련 메서드
  async getSalesManagers(): Promise<SalesManager[]> {
    return await this.db.select().from(schema.salesManagers).orderBy(schema.salesManagers.managerName);
  }
  
  async createSalesManager(data: any): Promise<SalesManager> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const [result] = await this.db.insert(schema.salesManagers).values({
      ...data,
      password: hashedPassword
    }).returning();
    return result;
  }
  
  async updateSalesManager(id: number, data: any): Promise<SalesManager> {
    let updateData = { ...data, updatedAt: new Date() };
    
    // 비밀번호가 있으면 해시화
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }
    
    const [result] = await this.db.update(schema.salesManagers)
      .set(updateData)
      .where(eq(schema.salesManagers.id, id))
      .returning();
    
    if (!result) throw new Error('영업과장을 찾을 수 없습니다');
    return result;
  }
  
  async deleteSalesManager(id: number): Promise<void> {
    await this.db.delete(schema.salesManagers).where(eq(schema.salesManagers.id, id));
  }
  
  async getSalesManagerById(id: number): Promise<SalesManager | undefined> {
    const [manager] = await this.db.select()
      .from(schema.salesManagers)
      .where(eq(schema.salesManagers.id, id))
      .limit(1);
    return manager;
  }
  
  async getSalesManagerByName(name: string): Promise<SalesManager | undefined> {
    const [manager] = await this.db.select()
      .from(schema.salesManagers)
      .where(eq(schema.salesManagers.managerName, name))
      .limit(1);
    return manager;
  }
  
  // 접점코드 매핑 관련 메서드
  async getContactCodeMappings(): Promise<any[]> {
    return await this.db.select().from(schema.contactCodeMappings);
  }
  
  async createContactCodeMapping(data: any): Promise<any> {
    const [result] = await this.db.insert(schema.contactCodeMappings).values(data).returning();
    return result;
  }
  
  async updateContactCodeMapping(id: number, data: any): Promise<any> {
    const [result] = await this.db.update(schema.contactCodeMappings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.contactCodeMappings.id, id))
      .returning();
    
    if (!result) throw new Error('접점코드 매핑을 찾을 수 없습니다');
    return result;
  }
  
  async deleteContactCodeMapping(id: number): Promise<void> {
    await this.db.delete(schema.contactCodeMappings).where(eq(schema.contactCodeMappings.id, id));
  }
  
  // 근무자 관리
  async createWorker(data: any): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const [result] = await this.db.insert(schema.users).values({
      ...data,
      password: hashedPassword,
      userType: 'user'
    }).returning();
    return result;
  }
  
  // 세션 관련 메서드
  async createSession(userId: number, userType: string, managerId?: number, teamId?: number, userRole?: string): Promise<string> {
    const sessionId = nanoid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일 후 만료
    
    await this.db.insert(schema.appSessions).values({
      id: sessionId,
      userId,
      userType,
      expiresAt
    });
    
    return sessionId;
  }
  
  async getSession(sessionId: string): Promise<any> {
    const [session] = await this.db.select()
      .from(schema.appSessions)
      .where(and(
        eq(schema.appSessions.id, sessionId),
        gte(schema.appSessions.expiresAt, new Date())
      ))
      .limit(1);
    
    if (!session) return undefined;
    
    // 사용자 정보 조회
    let user = null;
    if (session.userType === 'admin') {
      user = await this.getAdminById(session.userId);
    } else if (session.userType === 'sales_manager') {
      user = await this.getSalesManagerById(session.userId);
    } else {
      const [u] = await this.db.select()
        .from(schema.users)
        .where(eq(schema.users.id, session.userId))
        .limit(1);
      user = u;
    }
    
    if (!user) return undefined;
    
    return {
      id: sessionId,
      userId: session.userId,
      userType: session.userType,
      username: user.username,
      name: user.name,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };
  }
  
  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(schema.appSessions).where(eq(schema.appSessions.id, sessionId));
  }
  
  // 사용자 관리 관련 메서드들
  async getUsers(): Promise<User[]> {
    return await this.db.select().from(schema.users);
  }

  // 모든 사용자 조회 (관리자, 영업과장, 일반 사용자 포함)
  async getAllUsersForPermissions(): Promise<any[]> {
    const allUsers = [];
    
    // 관리자 계정들 조회
    const admins = await this.db.select().from(schema.admins).where(eq(schema.admins.isActive, true));
    for (const admin of admins) {
      allUsers.push({
        id: admin.id,
        username: admin.username,
        displayName: admin.name,
        userType: 'admin',
        accountType: '관리자',
        affiliation: '시스템 관리자',
        createdAt: admin.createdAt
      });
    }
    
    // 영업과장 계정들 조회
    const managers = await this.db.select().from(schema.salesManagers).where(eq(schema.salesManagers.isActive, true));
    for (const manager of managers) {
      allUsers.push({
        id: manager.id,
        username: manager.username,
        displayName: manager.managerName || manager.name,
        userType: 'sales_manager',
        accountType: '영업과장',
        affiliation: manager.teamName || '미지정',
        createdAt: manager.createdAt
      });
    }
    
    // 일반 사용자 계정들 조회
    const users = await this.db.select().from(schema.users).where(eq(schema.users.isActive, true));
    for (const user of users) {
      allUsers.push({
        id: user.id,
        username: user.username,
        displayName: user.name,
        userType: user.userType || 'user',
        accountType: user.userType === 'admin' ? '관리자' : '일반 사용자',
        affiliation: user.role || '미지정',
        createdAt: user.createdAt
      });
    }
    
    return allUsers.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }
  
  async getUserById(id: number): Promise<User | undefined> {
    const [user] = await this.db.select()
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1);
    return user;
  }
  
  async createUser(data: any): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const [result] = await this.db.insert(schema.users).values({
      ...data,
      password: hashedPassword
    }).returning();
    return result;
  }
  
  async updateUser(id: number, data: any): Promise<User> {
    let updateData = { ...data };
    
    // 비밀번호가 있으면 해시화
    if (data.password) {
      updateData.password = await bcrypt.hash(data.password, 10);
    }
    
    const [result] = await this.db.update(schema.users)
      .set(updateData)
      .where(eq(schema.users.id, id))
      .returning();
    
    if (!result) throw new Error('사용자를 찾을 수 없습니다');
    return result;
  }
  
  async deleteUser(id: number): Promise<void> {
    await this.db.delete(schema.users).where(eq(schema.users.id, id));
  }
  
  // 서비스 플랜 관련 메서드 (타입 변환 적용)
  async getServicePlans(): Promise<ServicePlan[]> {
    const plans = await this.db.select().from(schema.servicePlans).orderBy(schema.servicePlans.name);
    return plans.map(transformServicePlan);
  }
  
  async getServicePlansByCarrier(carrier: string): Promise<ServicePlan[]> {
    const plans = await this.db.select()
      .from(schema.servicePlans)
      .where(eq(schema.servicePlans.carrier, carrier))
      .orderBy(schema.servicePlans.name);
    return plans.map(transformServicePlan);
  }
  
  async getServicePlanById(id: number): Promise<ServicePlan | undefined> {
    const [plan] = await this.db.select()
      .from(schema.servicePlans)
      .where(eq(schema.servicePlans.id, id))
      .limit(1);
    return plan ? transformServicePlan(plan) : undefined;
  }
  
  async createServicePlan(data: any): Promise<ServicePlan> {
    const [result] = await this.db.insert(schema.servicePlans).values(data).returning();
    return transformServicePlan(result);
  }
  
  async updateServicePlan(id: number, data: any): Promise<ServicePlan> {
    const [result] = await this.db.update(schema.servicePlans)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.servicePlans.id, id))
      .returning();
    
    if (!result) throw new Error('서비스 플랜을 찾을 수 없습니다');
    return transformServicePlan(result);
  }
  
  async deleteServicePlan(id: number): Promise<void> {
    await this.db.delete(schema.servicePlans).where(eq(schema.servicePlans.id, id));
  }
  
  // 부가서비스 관련 메서드 (타입 변환 적용)
  async getAdditionalServices(): Promise<AdditionalService[]> {
    const services = await this.db.select().from(schema.additionalServices).orderBy(schema.additionalServices.name);
    return services.map(transformAdditionalService);
  }
  
  async getAdditionalServicesByCarrier(carrier: string): Promise<AdditionalService[]> {
    const services = await this.db.select()
      .from(schema.additionalServices)
      .where(eq(schema.additionalServices.carrier, carrier))
      .orderBy(schema.additionalServices.name);
    return services.map(transformAdditionalService);
  }
  
  async createAdditionalService(data: any): Promise<AdditionalService> {
    const [result] = await this.db.insert(schema.additionalServices).values(data).returning();
    return transformAdditionalService(result);
  }
  
  async updateAdditionalService(id: number, data: any): Promise<AdditionalService> {
    const [result] = await this.db.update(schema.additionalServices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.additionalServices.id, id))
      .returning();
    
    if (!result) throw new Error('부가서비스를 찾을 수 없습니다');
    return transformAdditionalService(result);
  }
  
  async deleteAdditionalService(id: number): Promise<void> {
    await this.db.delete(schema.additionalServices).where(eq(schema.additionalServices.id, id));
  }
  
  // 문서 관련 메서드
  async getDocuments(): Promise<Document[]> {
    return await this.db.select()
      .from(schema.documents)
      .orderBy(desc(schema.documents.createdAt));
  }
  
  async getDocumentById(id: number): Promise<Document | undefined> {
    const [doc] = await this.db.select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id))
      .limit(1);
    return doc;
  }
  
  async createDocument(data: any): Promise<Document> {
    const [result] = await this.db.insert(schema.documents).values(data).returning();
    return result;
  }
  
  async updateDocument(id: number, data: any): Promise<Document> {
    const [result] = await this.db.update(schema.documents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.documents.id, id))
      .returning();
    
    if (!result) throw new Error('문서를 찾을 수 없습니다');
    return result;
  }
  
  async deleteDocument(id: number): Promise<void> {
    await this.db.delete(schema.documents).where(eq(schema.documents.id, id));
  }
  
  async getDocumentsByDealerId(dealerId: number): Promise<Document[]> {
    return await this.db.select()
      .from(schema.documents)
      .where(eq(schema.documents.dealerId, dealerId))
      .orderBy(desc(schema.documents.createdAt));
  }
  
  async getDocumentsByStatus(status: string): Promise<Document[]> {
    return await this.db.select()
      .from(schema.documents)
      .where(eq(schema.documents.status, status))
      .orderBy(desc(schema.documents.createdAt));
  }
  
  async searchDocuments(query: any): Promise<Document[]> {
    const conditions = [];
    
    if (query.status) {
      conditions.push(eq(schema.documents.status, query.status));
    }
    
    if (query.carrier) {
      conditions.push(eq(schema.documents.carrier, query.carrier));
    }
    
    if (query.customerName) {
      conditions.push(like(schema.documents.customerName, `%${query.customerName}%`));
    }
    
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    return await this.db.select()
      .from(schema.documents)
      .where(whereClause)
      .orderBy(desc(schema.documents.createdAt));
  }
  
  // 기타 필요한 스텁 메서드들
  async getSettlementUnitPrices(): Promise<SettlementUnitPrice[]> {
    return await this.db.select().from(schema.settlementUnitPrices);
  }
  
  async createSettlementUnitPrice(data: any): Promise<SettlementUnitPrice> {
    const [result] = await this.db.insert(schema.settlementUnitPrices).values(data).returning();
    return result;
  }
  
  async updateSettlementUnitPrice(id: number, data: any): Promise<SettlementUnitPrice> {
    const [result] = await this.db.update(schema.settlementUnitPrices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.settlementUnitPrices.id, id))
      .returning();
    
    if (!result) throw new Error('정산 단가를 찾을 수 없습니다');
    return result;
  }
  
  async deleteSettlementUnitPrice(id: number): Promise<void> {
    await this.db.delete(schema.settlementUnitPrices).where(eq(schema.settlementUnitPrices.id, id));
  }
  
  // 딜러 관련 메서드
  async getDealers(): Promise<Dealer[]> {
    return await this.db.select().from(schema.dealers);
  }
  
  async getDealerById(id: number): Promise<Dealer | undefined> {
    const [dealer] = await this.db.select()
      .from(schema.dealers)
      .where(eq(schema.dealers.id, id))
      .limit(1);
    return dealer;
  }
  
  async createDealer(data: any): Promise<Dealer> {
    const [result] = await this.db.insert(schema.dealers).values(data).returning();
    return result;
  }
  
  async updateDealer(id: number, data: any): Promise<Dealer> {
    const [result] = await this.db.update(schema.dealers)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(schema.dealers.id, id))
      .returning();
    
    if (!result) throw new Error('딜러를 찾을 수 없습니다');
    return result;
  }
  
  async deleteDealer(id: number): Promise<void> {
    await this.db.delete(schema.dealers).where(eq(schema.dealers.id, id));
  }
  
  // 🚨 CRITICAL: getTodayStats 완전 구현
  async getTodayStats(workerId?: number, salesManagerId?: number): Promise<any> {
    try {
      console.log('📊 SQLiteStorage.getTodayStats 호출됨 - workerId:', workerId, 'salesManagerId:', salesManagerId);
      
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
      
      // 기본 조건 설정
      let whereConditions = [
        gte(schema.documents.createdAt, startOfDay),
        lt(schema.documents.createdAt, endOfDay)
      ];

      // workerId가 있으면 해당 근무자의 문서만
      if (workerId) {
        whereConditions.push(eq(schema.documents.workerId, workerId));
      }

      // salesManagerId가 있으면 해당 영업과장 소속 문서만
      if (salesManagerId) {
        whereConditions.push(eq(schema.documents.salesManagerId, salesManagerId));
      }

      // 전체 문서 수 조회
      const [totalDocsResult] = await this.db
        .select({ count: count() })
        .from(schema.documents)
        .where(and(...whereConditions));

      // 상태별 집계
      const statusCounts = await this.db
        .select({ 
          status: schema.documents.status, 
          count: count() 
        })
        .from(schema.documents)
        .where(and(...whereConditions))
        .groupBy(schema.documents.status);

      // 활성화 상태별 집계
      const activationCounts = await this.db
        .select({ 
          activationStatus: schema.documents.activationStatus, 
          count: count() 
        })
        .from(schema.documents)
        .where(and(...whereConditions))
        .groupBy(schema.documents.activationStatus);

      // 결과 가공
      const statusMap = statusCounts.reduce((acc, { status, count }) => {
        acc[status || 'unknown'] = Number(count);
        return acc;
      }, {} as Record<string, number>);

      const activationMap = activationCounts.reduce((acc, { activationStatus, count }) => {
        acc[activationStatus || 'unknown'] = Number(count);
        return acc;
      }, {} as Record<string, number>);

      const result = {
        todaySubmissions: statusMap['접수'] || statusMap['submitted'] || 0,
        todayActivations: activationMap['개통완료'] || activationMap['activated'] || statusMap['approved'] || 0,
        todayReturns: statusMap['반송'] || statusMap['returned'] || statusMap['rejected'] || 0,
        todayPending: statusMap['대기'] || statusMap['pending'] || statusMap['processing'] || 0,
        todayDocuments: Number(totalDocsResult?.count) || 0,
        todayCompletions: activationMap['개통완료'] || activationMap['completed'] || 0,
        todayOtherCompleted: statusMap['기타완료'] || statusMap['other_completed'] || 0,
        // 추가 필드들
        todayReception: statusMap['접수'] || statusMap['reception'] || 0,
        todayActivation: activationMap['개통완료'] || activationMap['activation'] || 0,
        todayApproved: statusMap['승인'] || statusMap['approved'] || 0,
        todayRejected: statusMap['거절'] || statusMap['rejected'] || 0,
        todayProcessing: statusMap['처리중'] || statusMap['processing'] || 0
      };

      console.log('📊 SQLiteStorage getTodayStats 반환값:', result);
      return result;
    } catch (error) {
      console.error('💥 SQLiteStorage getTodayStats 오류:', error);
      // 오류 발생 시 기본값 반환
      const fallbackResult = {
        todaySubmissions: 0,
        todayActivations: 0,
        todayReturns: 0,
        todayPending: 0,
        todayDocuments: 0,
        todayCompletions: 0,
        todayOtherCompleted: 0,
        todayReception: 0,
        todayActivation: 0,
        todayApproved: 0,
        todayRejected: 0,
        todayProcessing: 0
      };
      console.log('📊 SQLiteStorage getTodayStats 오류 시 기본값 반환:', fallbackResult);
      return fallbackResult;
    }
  }

  // 통계 관련 스텁 메서드들
  async getActivationStats(): Promise<any> {
    return { total: 0, pending: 0, approved: 0, rejected: 0 };
  }
  
  async getMonthlyActivationStats(): Promise<any> {
    return [];
  }
  
  async getCarrierStats(): Promise<any> {
    return [];
  }
  
  async getWorkerStats(): Promise<any> {
    return [];
  }
  
  async getMonthlyStatusStats(): Promise<any> {
    return [];
  }
  
  async getAllCarrierCodeCombinations(): Promise<any> {
    return [];
  }
  
  async getActivatedDocumentsCount(): Promise<any> {
    return { count: 0 };
  }
  
  async getDocumentsForExport(): Promise<any[]> {
    return [];
  }

  // ── 정산 엔진 스텁 (STEP 5C — SQLiteStorage는 미사용, PostgreSQLStorage에서 구현) ──

  async getPolicyVersions(): Promise<any[]> { return []; }
  async getPolicyVersionById(_id: number): Promise<any | null> { return null; }
  async getActivePolicyVersion(): Promise<any | null> { return null; }
  async createPolicyVersion(data: any): Promise<any> { return data; }
  async updatePolicyVersion(_id: number, data: any): Promise<any> { return data; }
  async deletePolicyVersion(_id: number): Promise<void> { }

  async getPolicyRowsByVersionId(_policyVersionId: number): Promise<any[]> { return []; }
  async createPolicyRow(data: any): Promise<any> { return data; }
  async bulkCreatePolicyRows(_data: any[]): Promise<number> { return 0; }
  async updatePolicyRow(_id: number, data: any): Promise<any> { return data; }
  async deletePolicyRow(_id: number): Promise<void> { }
  async deletePolicyRowsByVersionId(_policyVersionId: number): Promise<number> { return 0; }

  async getPolicyFilesByVersionId(_policyVersionId: number): Promise<any[]> { return []; }
  async createPolicyFile(data: any): Promise<any> { return data; }
  async deletePolicyFile(_id: number): Promise<void> { }

  async getActivationRecords(_filters?: any): Promise<{ data: any[]; page: number; limit: number }> {
    return { data: [], page: 1, limit: 50 };
  }
  async getActivationRecordById(_id: number): Promise<any | null> { return null; }
  async createActivationRecord(data: any): Promise<any> { return data; }
  async updateActivationRecord(_id: number, data: any): Promise<any> { return data; }
  async deleteActivationRecord(_id: number): Promise<void> { }

  async getSettlementItems(_filters?: any): Promise<{ data: any[]; page: number; limit: number; summary: { total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number }; groups: any[]; totalGroups: number }> {
    return { data: [], page: 1, limit: 50, summary: { total: 0, autoMatch: 0, reviewRequired: 0, policyNotFound: 0, settlementDone: 0 }, groups: [], totalGroups: 0 };
  }
  async getSettlementItemById(_id: number): Promise<any | null> { return null; }
  async getSettlementItemByActivationId(_activationId: number): Promise<any | null> { return null; }
  async createSettlementItem(data: any): Promise<any> { return data; }
  async updateSettlementItem(_id: number, data: any): Promise<any> { return data; }
  async lockSettlementItem(_id: number, _adminId: number): Promise<any> { return null; }

  async getSettlementFilesByItemId(_settlementItemId: number): Promise<any[]> { return []; }
  async createSettlementFile(data: any): Promise<any> { return data; }
  async deleteSettlementFile(_id: number): Promise<void> { }

  async getAdjustmentRulesByVersionId(_policyVersionId: number): Promise<any[]> { return []; }
  async createAdjustmentRule(data: any): Promise<any> { return data; }
  async updateAdjustmentRule(_id: number, data: any): Promise<any> { return data; }
  async calculateSettlementAdjustments(_record: any, _policyVersionId: number): Promise<{ addAmount: number; deductAmount: number }> { return { addAmount: 0, deductAmount: 0 }; }

  async getHiddenPolicyRows(_filters?: any): Promise<any[]> { return []; }
  async createHiddenPolicyRow(data: any): Promise<any> { return data; }
  async updateHiddenPolicyRow(_id: number, data: any): Promise<any> { return data; }
  async calculateHiddenAmount(_record: any): Promise<number> { return 0; }
  async recalculateHiddenAmounts(_options: any): Promise<any> { return { totalTargets: 0, updated: 0, cleared: 0, skippedLocked: 0, skippedNoContactCode: 0, skippedNoDealer: 0, skippedNotHiddenPos: 0, skippedNoPolicy: 0, policyMismatchDetail: { dealerMismatch: 0, contactCodeMismatch: 0, channelMismatch: 0, planNameMismatch: 0, customerTypeMismatch: 0, periodMismatch: 0 }, errors: [], debug: null }; }
  async diagnoseHiddenAmount(_contactCode: string, _dateFrom?: string, _dateTo?: string): Promise<any> { return { error: 'SQLite storage does not support this operation' }; }
}