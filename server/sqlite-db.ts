import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../shared/sqlite-schema';
import bcrypt from 'bcrypt';
import path from 'path';
import fs from 'fs';

// SQLite 데이터베이스 파일 경로
const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

let db: any = null;
let sqliteClient: Database.Database | null = null;
let isInitialized = false;

// 운영 안전: SQLite 데이터베이스 초기화 (Idempotent 방식)
export function initializeSQLiteDatabase() {
  if (isInitialized && db && sqliteClient) {
    console.log('SQLite 데이터베이스 이미 초기화됨 - 기존 인스턴스 재사용');
    return db;
  }

  try {
    // data 디렉토리 생성
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log('Initializing SQLite database at:', DB_PATH);
    
    // SQLite 클라이언트 생성 (운영 안전 설정)
    sqliteClient = new Database(DB_PATH);
    
    // 성능 및 안정성 최적화
    sqliteClient.pragma('journal_mode = WAL');    // 동시성 향상
    sqliteClient.pragma('synchronous = NORMAL');  // 균형잡힌 안전성
    sqliteClient.pragma('cache_size = 1000');     // 캐시 크기
    sqliteClient.pragma('foreign_keys = ON');     // 참조 무결성
    sqliteClient.pragma('temp_store = MEMORY');   // 임시 저장소 메모리 사용
    
    db = drizzle(sqliteClient, { schema });
    
    // 운영 안전: Idempotent 방식으로 테이블 및 초기 데이터 생성
    createTablesAndInitialDataSafely();
    
    isInitialized = true;
    console.log('SQLite database initialized successfully');
    
    return db;
  } catch (error) {
    console.error('Failed to initialize SQLite database:', error);
    isInitialized = false;
    db = null;
    sqliteClient = null;
    throw error;
  }
}

// 운영 안전: Idempotent 테이블 및 초기 데이터 생성
async function createTablesAndInitialDataSafely() {
  if (!sqliteClient) throw new Error('SQLite client not initialized');

  try {
    console.log('Creating SQLite tables...');
    
    // Idempotent 테이블 생성 SQL (ON CONFLICT 사용)
    const createTablesSQL = `
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS app_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        user_type TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS carriers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_wired INTEGER NOT NULL DEFAULT 0,
        bundle_number TEXT,
        bundle_carrier TEXT,
        document_required INTEGER NOT NULL DEFAULT 0,
        require_customer_name INTEGER NOT NULL DEFAULT 1,
        require_customer_phone INTEGER NOT NULL DEFAULT 1,
        require_customer_email INTEGER NOT NULL DEFAULT 0,
        require_contact_code INTEGER NOT NULL DEFAULT 1,
        require_carrier INTEGER NOT NULL DEFAULT 1,
        require_previous_carrier INTEGER NOT NULL DEFAULT 0,
        require_document_upload INTEGER NOT NULL DEFAULT 0,
        require_bundle_number INTEGER NOT NULL DEFAULT 0,
        require_bundle_carrier INTEGER NOT NULL DEFAULT 0,
        allow_new_customer INTEGER NOT NULL DEFAULT 1,
        allow_port_in INTEGER NOT NULL DEFAULT 1,
        require_desired_number INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS service_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        carrier TEXT NOT NULL,
        plan_type TEXT NOT NULL,
        data_allowance TEXT,
        monthly_fee REAL NOT NULL,
        combination_eligible INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS additional_services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        carrier TEXT NOT NULL,
        monthly_fee REAL NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dealer_id INTEGER,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        customer_email TEXT,
        customer_birthdate TEXT,
        customer_gender TEXT,
        contact_code TEXT,
        carrier TEXT,
        previous_carrier TEXT,
        service_plan TEXT,
        selected_services TEXT,
        bundle_number TEXT,
        bundle_carrier TEXT,
        desired_number TEXT,
        file_path TEXT,
        file_name TEXT,
        file_size INTEGER,
        status TEXT DEFAULT 'pending',
        submitted_by INTEGER,
        processed_by INTEGER,
        processed_at INTEGER,
        rejection_reason TEXT,
        memo TEXT,
        is_new_customer INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dealer_id INTEGER,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        user_type TEXT NOT NULL DEFAULT 'user',
        role TEXT,
        allowed_carriers TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS contact_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        dealer_name TEXT NOT NULL,
        real_sales_pos TEXT,
        carrier TEXT NOT NULL,
        sales_manager_id INTEGER,
        sales_manager_name TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS sales_managers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        team_name TEXT,
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS settlement_unit_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        service_plan_id INTEGER NOT NULL,
        new_customer_price REAL NOT NULL,
        port_in_price REAL NOT NULL,
        hidden_price REAL DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        effective_from TEXT,
        effective_until TEXT,
        memo TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        created_by INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_documents_customer_name ON documents(customer_name);
      CREATE INDEX IF NOT EXISTS idx_documents_contact_code ON documents(contact_code);
      CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
      CREATE INDEX IF NOT EXISTS idx_settlement_unit_prices_service_plan ON settlement_unit_prices(service_plan_id);
      CREATE INDEX IF NOT EXISTS idx_contact_codes_code ON contact_codes(code);
    `;

    // 테이블 생성 (Idempotent)
    sqliteClient.exec(createTablesSQL);
    console.log('SQLite tables created successfully');

    // 운영 안전: Idempotent 방식으로 기본 관리자 계정 생성
    await createDefaultAdminSafely();

    console.log('SQLite tables and initial data ready');
  } catch (error) {
    console.error('Error creating tables and initial data:', error);
    throw error;
  }
}

// 운영 안전: Idempotent 기본 관리자 계정 생성
async function createDefaultAdminSafely() {
  if (!sqliteClient) return;

  try {
    // 관리자 계정 존재 확인
    const existingAdmin = sqliteClient.prepare(
      'SELECT COUNT(*) as count FROM admins WHERE username = ?'
    ).get('kksnan') as { count: number };
    
    if (existingAdmin.count === 0) {
      console.log('Creating default admin account (username: kksnan, password: 123456)...');
      const hashedPassword = await bcrypt.hash('123456', 10);
      
      // INSERT OR IGNORE를 사용하여 중복 방지
      sqliteClient.prepare(`
        INSERT OR IGNORE INTO admins (username, password, name, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('kksnan', hashedPassword, '관리자', 1, Date.now(), Date.now());
      
      console.log('Default admin account created successfully');
    } else {
      console.log('Default admin account already exists - skipping creation');
    }
  } catch (error) {
    console.warn('Warning: Could not create/verify default admin account:', error);
    // 치명적 오류가 아니므로 계속 진행
  }
}

// 데이터베이스 인스턴스 반환 (단일 인스턴스 보장)
export function getSQLiteDatabase() {
  if (!db || !isInitialized) {
    return initializeSQLiteDatabase();
  }
  return db;
}

// SQLite 클라이언트 반환
export function getSQLiteClient() {
  if (!sqliteClient) {
    initializeSQLiteDatabase();
  }
  return sqliteClient;
}

// 운영 안전: 향상된 SQLite 헬스체크
export async function checkSQLiteHealth(): Promise<{
  ok: boolean;
  latencyMs?: number;
  errorCode?: string;
  step?: string;
  dbPath?: string;
  size?: string;
}> {
  if (!sqliteClient || !isInitialized) {
    return { 
      ok: false, 
      errorCode: 'NO_CLIENT', 
      step: 'initialization',
      dbPath: DB_PATH
    };
  }
  
  try {
    const startTime = Date.now();
    
    // 기본 연결 테스트
    const healthResult = sqliteClient.prepare('SELECT 1 as health_check').get();
    
    // 테이블 존재 확인
    const tableResult = sqliteClient.prepare(`
      SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='admins'
    `).get();
    
    const latencyMs = Date.now() - startTime;
    
    if (healthResult && (healthResult as any).health_check === 1 && 
        tableResult && (tableResult as any).count > 0) {
      
      // 파일 크기 확인
      let fileSize = '0KB';
      try {
        const stats = fs.statSync(DB_PATH);
        fileSize = `${Math.round(stats.size / 1024)}KB`;
      } catch (e) {
        // 파일 크기 확인 실패는 무시
      }

      return { 
        ok: true, 
        latencyMs,
        dbPath: DB_PATH.replace(process.cwd(), '.'),
        size: fileSize
      };
    } else {
      return { 
        ok: false, 
        errorCode: 'INVALID_RESPONSE', 
        step: 'query_execution',
        dbPath: DB_PATH
      };
    }
  } catch (error: any) {
    return {
      ok: false,
      errorCode: error.code || error.name || 'UNKNOWN_ERROR',
      step: 'query_execution',
      dbPath: DB_PATH
    };
  }
}

// 개발 환경에서만 자동 초기화 (운영 환경에서는 명시적 호출)
if (process.env.NODE_ENV !== 'production' && !db) {
  try {
    console.log('🔧 개발 환경: SQLite 자동 초기화');
    initializeSQLiteDatabase();
  } catch (error) {
    console.error('SQLite database initialization failed:', error);
  }
}

export { db };