-- SQLite 데이터베이스 초기화 스크립트

-- 세션 테이블
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire TEXT NOT NULL
);

-- 영업팀 테이블
CREATE TABLE IF NOT EXISTS sales_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_name TEXT NOT NULL,
    team_code TEXT NOT NULL UNIQUE,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 영업과장 테이블
CREATE TABLE IF NOT EXISTS sales_managers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL REFERENCES sales_teams(id),
    manager_name TEXT NOT NULL,
    manager_code TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT '대리',
    contact_phone TEXT,
    email TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 접점 코드 테이블
CREATE TABLE IF NOT EXISTS contact_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    dealer_name TEXT NOT NULL,
    carrier TEXT NOT NULL,
    sales_manager_id INTEGER REFERENCES sales_managers(id),
    sales_manager_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 관리자 테이블
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    userType TEXT NOT NULL DEFAULT 'admin',
    role TEXT DEFAULT 'admin',
    is_active INTEGER DEFAULT 1,
    can_change_password INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    userType TEXT NOT NULL DEFAULT 'user',
    role TEXT DEFAULT 'worker',
    team TEXT,
    is_active INTEGER DEFAULT 1,
    can_change_password INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 딜러 테이블
CREATE TABLE IF NOT EXISTS dealers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    userType TEXT NOT NULL DEFAULT 'dealer',
    dealerCode TEXT,
    contactPhone TEXT,
    email TEXT,
    address TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 문서 테이블
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_id INTEGER NOT NULL REFERENCES dealers(id),
    customer_name TEXT NOT NULL,
    customer_type TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    carrier TEXT NOT NULL,
    activation_status TEXT DEFAULT '대기',
    file_path TEXT,
    notes TEXT,
    supplement_notes TEXT,
    dealer_notes TEXT,
    device_model TEXT,
    sim_number TEXT,
    subscription_number TEXT,
    service_plan_id TEXT,
    additional_service_ids TEXT,
    settlement_amount REAL DEFAULT 0,
    registration_fee_prepaid INTEGER DEFAULT 0,
    registration_fee_postpaid INTEGER DEFAULT 0,
    registration_fee_installment INTEGER DEFAULT 0,
    sim_fee_prepaid INTEGER DEFAULT 0,
    sim_fee_postpaid INTEGER DEFAULT 0,
    bundle_applied INTEGER DEFAULT 0,
    bundle_not_applied INTEGER DEFAULT 0,
    assigned_worker_id INTEGER,
    assigned_at TEXT,
    activated_by INTEGER,
    cancelled_by INTEGER,
    discard_reason TEXT,
    uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
    activated_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 서비스 플랜 테이블
CREATE TABLE IF NOT EXISTS service_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_name TEXT NOT NULL,
    carrier TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    data_allowance TEXT,
    monthly_fee INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 기본 관리자 계정 생성
INSERT OR IGNORE INTO admins (name, username, password, userType, role) 
VALUES ('시스템 관리자', 'admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 'admin');

-- 기본 근무자 계정 생성  
INSERT OR IGNORE INTO users (name, username, password, userType, role, team) 
VALUES ('L)수정', 'mcclg01', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'worker', 'worker', 'DX 1팀');

-- 기본 딜러 계정 생성
INSERT OR IGNORE INTO dealers (name, username, password, userType, dealerCode) 
VALUES ('테스트 딜러', 'dealer01', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'dealer', 'D001');

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire);
CREATE INDEX IF NOT EXISTS IDX_documents_dealer_id ON documents(dealer_id);
CREATE INDEX IF NOT EXISTS IDX_documents_activation_status ON documents(activation_status);
CREATE INDEX IF NOT EXISTS IDX_documents_uploaded_at ON documents(uploaded_at);
CREATE INDEX IF NOT EXISTS IDX_documents_activated_at ON documents(activated_at);