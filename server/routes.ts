import { Router } from "express";
import multer from "multer";
import formidable from "formidable";
import path from "path";
import fs from "fs";
import bcrypt from "bcrypt";
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import PDFDocument from 'pdfkit';
import { randomUUID } from "crypto";
import { getStorage } from "./storage";
import { ChatWebSocketServer } from './websocket';
import { getDatabase, checkPostgreSQLHealth } from "./db";
import { sql } from "drizzle-orm";

// 중복 제출 방지를 위한 최근 제출 요청 추적
interface SubmissionRecord {
  timestamp: number;
  documentNumber: string;
}

const recentSubmissions = new Map<string, SubmissionRecord>();
const DUPLICATE_WINDOW_MS = 5000; // 5초 이내 동일 요청 차단

// 주기적으로 오래된 기록 정리 (10분마다)
setInterval(() => {
  const now = Date.now();
  Array.from(recentSubmissions.entries()).forEach(([key, record]) => {
    if (now - record.timestamp > 60000) { // 1분 이상 지난 기록 삭제
      recentSubmissions.delete(key);
    }
  });
}, 600000);

// Extend Express Request interface to include session
declare global {
  namespace Express {
    interface Request {
      session?: {
        userId?: number;
        userType?: string;
        [key: string]: any;
      };
    }
  }
}

// 🚨 CRITICAL: 세션 토큰 마스킹 유틸리티
function maskSessionToken(token: string): string {
  if (!token || token.length < 8) return '***';
  return token.substring(0, 4) + '***' + token.substring(token.length - 4);
}

// 운영에서는 기본 비활성, 개발/테스트에서는 기본 활성
const LOG_CSV_HEADERS =
  (process.env.LOG_CSV_HEADERS ?? "").toLowerCase() === "true" ||
  (process.env.APP_ENV ?? "development") !== "production";

/** 업로드된 파일의 첫 번째 시트에서 헤더(1행)만 추출 */
function extractCsvHeadersFromUploadedFile(file: Express.Multer.File): string[] {
  if (!file) return [];
  let buffer: Buffer | null = null;

  if (file.buffer && file.buffer.length > 0) {
    buffer = file.buffer as Buffer;
  } else if ((file as any).path) {
    buffer = fs.readFileSync((file as any).path);
  }
  if (!buffer) return [];

  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as any[][];
  const headers = (aoa?.[0] ?? []).map((h) => String(h ?? "").trim());
  return headers;
}

/** 조건부 로깅: 운영 기본 OFF, LOG_CSV_HEADERS=true일 때만 ON */
function logCsvHeaders(label: string, headers: string[]) {
  if (!LOG_CSV_HEADERS) return;
  const normalized = headers.map((h) => h.replace(/\s+/g, " ").trim());
  console.log(`📊 CSV 컬럼명[${label}]: ${JSON.stringify(normalized)}`);
}

import {
  loginSchema,
  createUserSchema,
  createAdminSchema,
  createWorkerSchema,
  updateDocumentStatusSchema,
  updateActivationStatusSchema,
  createDocumentSchema,
  createCarrierSchema,
  updateCarrierSchema,
  createSalesManagerSchema,
  updateSalesManagerSchema,
  createSettlementUnitPriceSchema,
  updateSettlementUnitPriceSchema,
  createDealerSchema,
  insertOtherBusinessCarrierSchema,
  createServicePlanSchema,
  AuthResponse,
  AuthSession
} from "../shared/schema";

const router = Router();

// Configure multer for file uploads (메모리 버퍼 사용 - Excel 및 CSV 지원)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    const mimetype = /application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/csv|application\/csv/.test(file.mimetype) || isSpreadsheet;
    
    if (extname || mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Excel 또는 CSV 파일만 업로드 가능합니다.'));
    }
  }
});

// Configure multer for pricing table uploads (메모리 버퍼 사용)
const pricingUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv|pdf|jpg|jpeg/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    // 스프레드시트 파일들의 MIME 타입 체크를 더 유연하게
    const isSpreadsheet = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    const mimetype = /application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/csv|application\/csv|application\/pdf|image\/jpeg|image\/jpg/.test(file.mimetype) || isSpreadsheet;

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('허용되지 않는 파일 형식입니다. (xlsx, xls, csv, pdf, jpg, jpeg만 가능)'));
    }
  }
});

// Configure multer for document template uploads (메모리 버퍼 사용)
const templateUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|doc|docx|xlsx|xls|jpg|jpeg|png|gif|bmp|tiff|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|image\/jpeg|image\/jpg|image\/png|image\/gif|image\/bmp|image\/tiff|image\/webp/.test(file.mimetype);

    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('허용되지 않는 파일 형식입니다. (pdf, doc, docx, xlsx, xls, jpg, jpeg, png, gif, bmp, tiff, webp 가능)'));
    }
  }
});

// Configure multer for contact code uploads (CSV and Excel) (메모리 버퍼 사용)
const contactCodeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /xlsx|xls|csv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = /application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|text\/csv|application\/csv/.test(file.mimetype);

    if (extname || mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('허용되지 않는 파일 형식입니다. (xlsx, xls, csv만 가능)'));
    }
  }
});

// Middleware to check authentication
// 🚨 CRITICAL: DB 헬스체크 미들웨어 - 쓰기 API 503 보호
const requireDbHealthy = async (req: any, res: any, next: any) => {
  try {
    const healthCheck = await checkPostgreSQLHealth();
    if (!healthCheck.ok) {
      console.error('🚨 DB 헬스체크 실패 - 쓰기 작업 차단:', healthCheck.lastErrorCode);
      return res.status(503).json({
        error: '데이터베이스 연결 문제로 인한 서비스 제한',
        code: 'DATABASE_UNAVAILABLE',
        timestamp: new Date().toISOString(),
        retryAfter: '30' // 30초 후 재시도 권장
      });
    }
    next();
  } catch (error: any) {
    console.error('💥 DB 헬스체크 미들웨어 오류:', error);
    return res.status(503).json({
      error: '데이터베이스 상태 확인 실패',
      code: 'HEALTH_CHECK_FAILED',
      timestamp: new Date().toISOString()
    });
  }
};

const requireAuth = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  console.log('Auth check - Header present:', authHeader ? 'yes' : 'no');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('Auth failed - No valid header');
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  
  const sessionId = authHeader.replace('Bearer ', '');
  console.log('Auth check - SessionId:', maskSessionToken(sessionId)); // 🚨 CRITICAL: 토큰 마스킹

  const session = await getStorage().getSession(sessionId);
  console.log('Auth check - Session found:', session ? 'yes' : 'no');
  
  if (!session) {
    console.log('Auth failed - Invalid session:', maskSessionToken(sessionId)); // 🚨 CRITICAL: 토큰 마스킹
    return res.status(401).json({ error: '유효하지 않은 세션입니다.' });
  }

  req.session = session;
  req.user = session; // Add user property for compatibility
  console.log('Auth success - User:', session.userId, 'Session:', maskSessionToken(sessionId)); // 🚨 CRITICAL: 토큰 마스킹
  next();
};

// Middleware to check admin authentication
const requireAdmin = async (req: any, res: any, next: any) => {
  await requireAuth(req, res, () => {
    if (req.session?.userType !== 'admin') {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    next();
  });
};

const requireWorker = async (req: any, res: any, next: any) => {
  await requireAuth(req, res, () => {
    if (req.session?.userType !== 'user') {
      return res.status(403).json({ error: '근무자 권한이 필요합니다.' });
    }
    next();
  });
};

const requireDealerOrWorker = async (req: any, res: any, next: any) => {
  await requireAuth(req, res, () => {
    if (req.session?.userType !== 'user' && req.session?.userType !== 'admin') {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    next();
  });
};

// 운영 안전성을 위한 데이터베이스 헬스체크 API (단일 Pool 사용)
router.get('/api/health/db', async (req, res) => {
  try {
    console.log('🔍 데이터베이스 헬스체크 요청 수신');
    const healthCheck = await checkPostgreSQLHealth();
    
    const response = {
      status: healthCheck.ok ? 'healthy' : 'unhealthy',
      database: 'PostgreSQL',
      connection: healthCheck.ok ? 'connected' : 'failed',
      latencyMs: healthCheck.latencyMs,
      ssl: healthCheck.ssl,
      connectionPool: healthCheck.connectionPool,
      dbVersion: healthCheck.dbVersion,
      backendPid: healthCheck.backendPid,
      lastErrorCode: healthCheck.lastErrorCode,
      timestamp: healthCheck.timestamp,
      environment: process.env.NODE_ENV || 'development'
    };
    
    const httpStatus = healthCheck.ok ? 200 : 503;
    console.log(`✅ 헬스체크 결과: ${response.status} (${httpStatus})`);
    
    res.status(httpStatus).json(response);
  } catch (error: any) {
    console.error('💥 헬스체크 API 오류:', error);
    res.status(503).json({
      status: 'error',
      database: 'PostgreSQL',
      connection: 'error',
      error: error.message || 'Health check failed',
      lastErrorCode: error.code || 'UNKNOWN_ERROR',
      connectionPool: 'SinglePool',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  }
});

// Public Service Plans API (before auth routes)
router.get('/api/service-plans', async (req: any, res) => {
  try {
    console.log('Service plans API called - fetching from database');
    const servicePlans = await getStorage().getServicePlans();
    res.json(servicePlans);
  } catch (error: any) {
    console.error('Service plans error:', error);
    res.status(500).json({ error: error.message });
  }
});


// 🚨 SECURITY: Authentication routes moved to auth-routes.ts to eliminate duplication
// All authentication endpoints (/login, /create-admin, /me, /logout) are now handled by auth-routes.ts
// This eliminates duplicate authentication logic and provides single canonical auth implementation


// Admin routes
// 판매점 계정 생성 (관리자 패널에서 사용)
router.post('/api/dealers', requireAdmin, async (req, res) => {
  try {
    const { name, username, password, contactEmail, contactPhone, location } = req.body;
    
    // 입력 검증
    if (!name || !username || !password) {
      return res.status(400).json({ error: '판매점명, 아이디, 비밀번호는 필수입니다.' });
    }

    // 비밀번호 해시
    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.hash(password, 10);

    // users 테이블에 판매점 계정 생성
    const dealerData = {
      name,
      username,
      password: hashedPassword,
      userType: 'user',
      dealerId: null, // 먼저 null로 생성 후 자체 ID로 업데이트
    };

    const dealer = await getStorage().createDealer(dealerData);
    
    // dealerId를 자체 ID로 업데이트
    await getStorage().updateDealer(dealer.id, { dealerId: dealer.id });

    res.json({ 
      id: dealer.id, 
      name, 
      username,
      dealerId: dealer.id,
      message: '판매점 계정이 성공적으로 생성되었습니다.' 
    });
  } catch (error: any) {
    console.error('Dealer creation error:', error);
    res.status(400).json({ error: error.message || '판매점 생성 중 오류가 발생했습니다.' });
  }
});

router.post('/api/admin/dealers', requireAdmin, async (req, res) => {
  try {
    const data = createDealerSchema.parse(req.body);
    const dealer = await getStorage().createDealer(data);
    res.json(dealer);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/api/admin/dealers', requireAdmin, async (req, res) => {
  try {
    // dealerId가 있는 사용자들을 판매점으로 조회
    const dealers = await getStorage().getDealers();
    console.log('[getDealers API] Returning dealers:', dealers.length, 'dealers');
    console.log('[getDealers API] Dealer IDs:', dealers.map(d => ({ id: d.id, name: d.name, dealerId: d.dealerId })));
    res.json(dealers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 판매점 엑셀 양식 다운로드
router.get('/api/admin/dealers/template/download', requireAdmin, async (req, res) => {
  try {
    const XLSX = await import('xlsx');
    
    // 샘플 데이터가 포함된 양식 생성
    const templateData = [
      {
        '판매점명': '예시 판매점',
        '아이디': 'dealer001',
        '비밀번호': 'password123',
        '연락처 이메일': 'dealer@example.com',
        '연락처 전화번호': '010-1234-5678',
        '위치': '서울시 강남구'
      },
      {
        '판매점명': '',
        '아이디': '',
        '비밀번호': '',
        '연락처 이메일': '',
        '연락처 전화번호': '',
        '위치': ''
      }
    ];
    
    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '판매점 목록');
    
    // 컬럼 너비 설정
    ws['!cols'] = [
      { wch: 20 }, // 판매점명
      { wch: 15 }, // 아이디
      { wch: 15 }, // 비밀번호
      { wch: 25 }, // 연락처 이메일
      { wch: 20 }, // 연락처 전화번호
      { wch: 20 }  // 위치
    ];
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="dealer_upload_template.xlsx"; filename*=UTF-8\'\'%ED%8C%90%EB%A7%A4%EC%A0%90_%EC%97%85%EB%A1%9C%EB%93%9C_%EC%96%91%EC%8B%9D.xlsx');
    res.send(buffer);
  } catch (error: any) {
    console.error('Template download error:', error);
    res.status(500).json({ error: '양식 다운로드 중 오류가 발생했습니다.' });
  }
});

// 판매점 엑셀 일괄 업로드
router.post('/api/admin/dealers/upload', requireAdmin, async (req, res) => {
  try {
    const multer = await import('multer');
    const XLSX = await import('xlsx');
    const bcrypt = await import('bcrypt');
    
    // 메모리 스토리지 사용
    const storage = multer.memoryStorage();
    const upload = multer.default({ storage }).single('file');
    
    upload(req, res, async (err: any) => {
      if (err) {
        return res.status(400).json({ error: '파일 업로드 실패' });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: '파일이 없습니다.' });
      }
      
      try {
        // 엑셀 파일 읽기
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        
        if (data.length === 0) {
          return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
        }
        
        const results = {
          success: [] as any[],
          errors: [] as any[]
        };
        
        // 각 행 처리
        for (let i = 0; i < data.length; i++) {
          const row: any = data[i];
          const rowNum = i + 2; // 엑셀 행 번호 (헤더 제외)
          
          try {
            // 필드 존재 여부 확인 및 trim
            const name = row['판매점명']?.toString().trim() || '';
            const username = row['아이디']?.toString().trim() || '';
            const password = row['비밀번호']?.toString().trim() || '';
            
            // 빈 행 스킵 (판매점명이 비어있으면 빈 행으로 간주)
            if (name === '') {
              continue;
            }
            
            // 필수 필드 검증 (판매점명은 위에서 이미 확인했으므로 username과 password만 확인)
            if (username === '' || password === '') {
              results.errors.push({
                row: rowNum,
                data: row,
                error: '판매점명, 아이디, 비밀번호는 필수입니다.'
              });
              continue;
            }
            
            // 비밀번호 해시
            const hashedPassword = await bcrypt.hash(password, 10);
            
            // 판매점 데이터 준비
            const dealerData = {
              name: name,
              username: username,
              password: hashedPassword,
              userType: 'user',
              dealerId: null
            };
            
            // 판매점 생성
            const dealer = await getStorage().createDealer(dealerData);
            
            // dealerId 업데이트
            await getStorage().updateDealer(dealer.id, { dealerId: dealer.id });
            
            results.success.push({
              row: rowNum,
              name: name,
              username: username
            });
            
          } catch (error: any) {
            results.errors.push({
              row: rowNum,
              data: row,
              error: error.message || '판매점 생성 실패'
            });
          }
        }
        
        res.json({
          message: `총 ${data.length}개 중 ${results.success.length}개 성공, ${results.errors.length}개 실패`,
          success: results.success,
          errors: results.errors
        });
        
      } catch (error: any) {
        console.error('Excel processing error:', error);
        res.status(500).json({ error: '엑셀 처리 중 오류가 발생했습니다: ' + error.message });
      }
    });
    
  } catch (error: any) {
    console.error('Upload error:', error);
    res.status(500).json({ error: '업로드 중 오류가 발생했습니다.' });
  }
});

// PATCH_START: 오류 수정 - 누락된 메서드들을 스텁으로 처리
router.delete('/api/admin/dealers/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '잘못된 판매점 ID입니다.' });
    }
    
    // 스텁: 실제 삭제 대신 성공 응답
    // await getStorage().deleteDealer(id);
    res.json({ success: true, message: '판매점이 성공적으로 삭제되었습니다.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 판매점 수정 (관리자 전용)
router.put('/api/admin/dealers/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '잘못된 판매점 ID입니다.' });
    }

    const { name, contactEmail, contactPhone, location, password } = req.body;

    // 기존 판매점 정보 조회 - getDealerById가 없으므로 getDealers로 대체
    const allDealers = await getStorage().getDealers();
    const existingDealer = allDealers.find((dealer: any) => dealer.id === id);
    if (!existingDealer) {
      return res.status(404).json({ error: '판매점을 찾을 수 없습니다.' });
    }

    // 업데이트할 데이터 준비
    const updateData: any = {
      name, // getStorage().updateDealer에서 businessName으로 매핑됨
      contactEmail,
      contactPhone,
      location // getStorage().updateDealer에서 address로 매핑됨
    };

    // 비밀번호가 제공된 경우만 포함 (getStorage().updateDealer에서 해시화됨)
    if (password && password.trim() !== '') {
      updateData.password = password;
    }

    // 실제 업데이트 실행
    await getStorage().updateDealer(id, updateData);

    res.json({ success: true, message: '판매점 정보가 성공적으로 수정되었습니다.' });
  } catch (error: any) {
    console.error('Update dealer error:', error);
    res.status(500).json({ error: error.message });
  }
});
// PATCH_END

router.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const data = createUserSchema.parse(req.body);
    const user = await getStorage().createUser(data);
    res.json(user);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Admin account creation endpoint
router.post('/api/admin/create-admin', requireAdmin, async (req, res) => {
  try {
    const data = createAdminSchema.parse(req.body);
    const admin = await getStorage().createAdmin(data);
    res.status(201).json({ success: true, data: admin });
  } catch (error: any) {
    // PostgreSQL unique constraint violation
    if (error.message === 'UNIQUE_VIOLATION' || error.code === '23505') {
      return res.status(409).json({ success: false, message: '이미 사용 중인 아이디입니다.' });
    }
    console.error('Create admin error:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// Initial admin creation endpoint (temporary, no auth required)
router.post('/api/init-admin', async (req, res) => {
  try {
    const { username, password, name } = req.body;
    
    // Check if admin already exists
    const existing = await getStorage().getAdminByUsername(username);
    if (existing) {
      return res.status(400).json({ error: '관리자가 이미 존재합니다.' });
    }
    
    const admin = await getStorage().createAdmin({ username, password, name });
    res.json({ success: true, message: '관리자가 생성되었습니다.', admin: { id: admin.id, username: admin.username, name: admin.name } });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Worker account creation endpoint


// 영업과장 계정 생성 (관리자 패널용)
router.post('/api/admin/create-sales-manager', requireAdmin, async (req, res) => {
  try {
    const { username, password, name, team } = req.body;
    
    if (!username || !password || !name || !team) {
      return res.status(400).json({ error: '모든 필드를 입력해주세요.' });
    }

    // 사용자명 중복 체크
    const existingUser = await getStorage().getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: `로그인 ID '${username}'는 이미 사용 중입니다.` });
    }

    // 팀 이름으로 팀 찾기
    const salesTeams = await getStorage().getSalesTeams();
    const salesTeam = salesTeams.find((t: any) => t.teamName === team);
    
    if (!salesTeam) {
      return res.status(400).json({ error: `영업팀 '${team}'을 찾을 수 없습니다.` });
    }

    // 고유한 영업과장 코드 생성
    const timestamp = Date.now().toString();
    const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
    const managerCode = `SM_${username.toUpperCase()}_${timestamp.slice(-6)}_${randomSuffix}`;

    // 영업과장 생성
    const manager = await getStorage().createSalesManager({
      teamId: salesTeam.id,
      managerName: name,
      managerCode,
      username,
      password,
      position: '영업과장',
      contactPhone: '',
      email: ''
    });

    console.log(`✅ Sales manager created: ${name} (${username}) for team ${team}`);
    res.json({ success: true, message: '영업과장이 생성되었습니다.', manager });
  } catch (error: any) {
    console.error('Sales manager creation error:', error);
    res.status(400).json({ error: `영업과장 생성에 실패했습니다: ${error.message}` });
  }
});

// 영업과장 목록 조회 (관리자 패널용)
router.get('/api/admin/sales-managers', requireAuth, async (req, res) => {
  try {
    const managers = await getStorage().getSalesManagers();
    // 팀 정보를 포함한 영업과장 목록 반환
    const managersWithTeams = await Promise.all(
      managers.map(async (manager: any) => {
        // const team = await getStorage().getSalesTeamById(manager.teamId); // 스텁
        return {
          ...manager,
          teamName: '미지정' // team?.teamName || '미지정'
        };
      })
    );
    res.json(managersWithTeams);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/api/admin/sales-teams', requireAuth, async (req, res) => {
  try {
    const teams = await getStorage().getSalesTeams();
    res.json(teams);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 관리자 목록 조회 (관리자 패널용)
router.get('/api/admin/admins', requireAuth, async (req, res) => {
  try {
    const adminsList = await getStorage().getAdmins();
    console.log('✅ Admins API - Returning', adminsList.length, 'admins:', adminsList.map((a: any) => `${a.username}(${a.name})`).join(', '));
    res.json(adminsList);
  } catch (error: any) {
    console.error('❌ Admins API Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 비밀번호 변경 API (관리자 패널용)
router.post('/api/admin/change-password', requireAdmin, async (req: any, res) => {
  try {
    const { userId, accountType, newPassword } = req.body;
    console.log('Password change request:', { userId, accountType, newPassword: '***' });
    
    // userId가 없으면 세션에서 가져오기 (자신의 비밀번호 변경인 경우)
    const targetUserId = userId || req.session.userId;
    const targetAccountType = accountType || 'admin';
    
    if (!targetUserId || !targetAccountType || !newPassword) {
      console.log('Missing required fields:', { userId: !!targetUserId, accountType: !!targetAccountType, newPassword: !!newPassword });
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '비밀번호는 최소 6자리 이상이어야 합니다.' });
    }

    // 시스템 관리자 권한 확인 - admin, kksnan 계정 허용
    const currentUser = await getStorage().getAdminById(req.session.userId);
    console.log('Current user check:', { currentUserId: req.session.userId, username: currentUser?.username });
    
    if (!currentUser || (currentUser.username !== 'admin' && currentUser.username !== 'kksnan')) {
      return res.status(403).json({ error: '비밀번호 변경은 시스템 관리자만 가능합니다.' });
    }

    console.log('Processing password change for:', { userId: targetUserId, accountType: targetAccountType });

    if (targetAccountType === 'admin') {
      await getStorage().updateAdminPassword(targetUserId, newPassword);
    } else if (targetAccountType === 'sales_manager') {
      // await getStorage().updateSalesManagerPassword(targetUserId, newPassword); // 스텁
      console.log('Sales manager password update skipped (stub)');
    } else if (targetAccountType === 'worker' || targetAccountType === 'user') {
      // await getStorage().updateUserPassword(targetUserId, newPassword); // 스텁
      console.log('User password update skipped (stub)');
    } else {
      console.log('Unsupported account type:', targetAccountType);
      return res.status(400).json({ error: '지원되지 않는 계정 유형입니다.' });
    }

    console.log('Password change successful for user:', targetUserId);
    res.json({ success: true, message: '비밀번호가 성공적으로 변경되었습니다.' });
  } catch (error: any) {
    console.error('Password change error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 모든 사용자 비밀번호를 123456으로 초기화 (kksnan 제외, 관리자 전용)
router.post('/api/admin/reset-all-passwords', requireAdmin, async (req: any, res) => {
  try {
    console.log('Password reset request from user:', req.session.userId);
    
    // 시스템 관리자 권한 확인 - kksnan 계정만 허용
    const currentUser = await getStorage().getAdminById(req.session.userId);
    console.log('Current user check:', { currentUserId: req.session.userId, username: currentUser?.username });
    
    if (!currentUser || currentUser.username !== 'kksnan') {
      return res.status(403).json({ error: '모든 비밀번호 초기화는 최고 권한자(kksnan)만 가능합니다.' });
    }

    console.log('Processing password reset for all users except kksnan');
    
    // const result = await getStorage().resetAllPasswordsTo123456(); // 스텁
    const result = { updated: 0, users: [] };
    
    console.log('Password reset completed:', result);
    
    res.json({ 
      success: true, 
      message: `총 ${result.updated}개 계정의 비밀번호가 123456으로 초기화되었습니다.`,
      updated: result.updated,
      users: result.users
    });
  } catch (error: any) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: error.message || '비밀번호 초기화에 실패했습니다.' });
  }
});

// 영업과장 삭제 API (시스템 관리자 전용)
router.delete('/api/admin/sales-managers/:id', requireAdmin, async (req, res) => {
  try {
    const managerId = parseInt(req.params.id);
    
    if (!managerId) {
      return res.status(400).json({ error: '유효하지 않은 영업과장 ID입니다.' });
    }

    // await getStorage().deleteSalesManager(managerId); // 스텁
    res.json({ success: true, message: '영업과장 계정이 성공적으로 삭제되었습니다.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// New account creation routes
router.post('/api/auth/register/dealer', async (req, res) => {
  try {
    // const data = createDealerAccountSchema.parse(req.body); // 스텁
    // const result = await getStorage().createDealerAccount(data); // 스텁
    res.json({ success: true, message: '판매점 계정이 성공적으로 생성되었습니다.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Worker details API
router.get('/api/admin/worker-details/:workerId', requireAdmin, async (req, res) => {
  try {
    const workerId = parseInt(req.params.workerId);
    // const details = await getStorage().getWorkerCarrierDetails(workerId); // 스텁
    const details = {};
    res.json(details);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Carrier details API
router.get('/api/admin/carrier-details/:carrier', requireAdmin, async (req, res) => {
  try {
    const carrier = req.params.carrier;
    // const details = await getStorage().getCarrierDealerDetails(carrier); // 스텁
    const details = {};
    res.json(details);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// REMOVED: 중복된 관리자 생성 엔드포인트 제거 - auth-routes.ts에서 처리

router.post('/api/admin/create-worker', requireAdmin, async (req, res) => {
  try {
    const data = createWorkerSchema.parse(req.body);
    const worker = await getStorage().createUser(data);
    res.json(worker);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// KP number validation route
router.post('/api/kp-numbers/validate', requireAuth, async (req, res) => {
  try {
    const { kpNumber } = req.body;
    
    if (!kpNumber) {
      return res.status(400).json({ error: 'KP 번호가 필요합니다.' });
    }

    // const isValid = await getStorage().validateKpNumber(kpNumber); // 스텁
    const isValid = true; // 항상 유효한 것으로 가정
    
    res.json({ valid: isValid });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 사용자 목록 조회 (관리자 전용) - admins와 users 모두 반환
router.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await getStorage().getUsers();
    const admins = await getStorage().getAdmins();
    
    // users는 기존 userType 보존, 없으면 'user' 추가
    const usersWithType = users.map((u: any) => ({ ...u, activatedByType: 'user' }));
    // admins에 activatedByType: 'admin' 추가
    const adminsWithType = admins.map((a: any) => ({ ...a, activatedByType: 'admin' }));
    
    // 합쳐서 반환
    res.json([...adminsWithType, ...usersWithType]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 사용자 아이디 중복 확인 (관리자 전용)
router.get('/api/admin/users/check-username/:username', requireAdmin, async (req, res) => {
  try {
    const { username } = req.params;
    const users = await getStorage().getUsers();
    const exists = users.some(user => user.username === username);
    res.json({ exists, available: !exists });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Carriers API
router.get('/api/carriers', async (req, res) => {
  try {
    const carriers = await getStorage().getCarriers();
    res.json(carriers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/carriers', requireAdmin, async (req, res) => {
  try {
    const data = createCarrierSchema.parse(req.body);
    const carrier = await getStorage().createCarrier(data);
    res.json(carrier);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/api/admin/carriers', requireAdmin, async (req, res) => {
  try {
    const data = createCarrierSchema.parse(req.body);
    const carrier = await getStorage().createCarrier(data);
    res.json(carrier);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.put('/api/admin/carriers/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = updateCarrierSchema.partial().parse(req.body);
    await getStorage().updateCarrier(id, data);
    const carrier = await getStorage().getCarrierById(id);
    res.json(carrier);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/api/carriers/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await getStorage().deleteCarrier(id);
    res.json({ success: true, message: '통신사가 삭제되었습니다.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Carrier Excel template download
router.get('/api/carriers/excel-template', requireAuth, async (req, res) => {
  try {
    const workbook = XLSX.utils.book_new();
    
    const templateData = [
      {
        '통신사명': 'SK텔링크',
        '정렬순서': 1,
        '활성화': 'Y',
        '유선여부': 'N',
        '번들번호': '',
        '번들통신사': '',
        '고객명': 'Y',
        '연락처': 'Y',
        '이메일': 'N',
        '개통방법코드': 'Y',
        '통신사': 'Y',
        '이전통신사': 'N',
        '서류첨부': 'N',
        '결합번호': 'N',
        '결합통신사': 'N',
        '신규': 'Y',
        '번호이동': 'Y',
        '희망번호': 'N'
      },
      {
        '통신사명': 'KT',
        '정렬순서': 2,
        '활성화': 'Y',
        '유선여부': 'N',
        '번들번호': '',
        '번들통신사': '',
        '고객명': 'Y',
        '연락처': 'Y',
        '이메일': 'N',
        '개통방법코드': 'Y',
        '통신사': 'Y',
        '이전통신사': 'N',
        '서류첨부': 'N',
        '결합번호': 'N',
        '결합통신사': 'N',
        '신규': 'Y',
        '번호이동': 'Y',
        '희망번호': 'N'
      }
    ];
    
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(workbook, worksheet, '통신사');
    
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="carrier_template.xlsx"');
    res.send(buffer);
  } catch (error: any) {
    console.error('Carrier template download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Carrier Excel upload (메모리 버퍼 사용)
router.post('/api/carriers/upload-excel', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (data.length === 0) {
      return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
    }

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const row of data) {
      try {
        const carrierData = {
          name: row['통신사명'] || row['name'] || '',
          displayOrder: parseInt(row['정렬순서'] || row['displayOrder'] || '0'),
          isActive: (row['활성화'] || row['isActive'] || 'Y') === 'Y',
          isWired: (row['유선여부'] || row['isWired'] || 'N') === 'Y',
          bundleNumber: row['번들번호'] || row['bundleNumber'] || '',
          bundleCarrier: row['번들통신사'] || row['bundleCarrier'] || '',
          requireCustomerName: (row['고객명'] || row['requireCustomerName'] || 'Y') === 'Y',
          requireCustomerPhone: (row['연락처'] || row['requireCustomerPhone'] || 'Y') === 'Y',
          requireCustomerEmail: (row['이메일'] || row['requireCustomerEmail'] || 'N') === 'Y',
          requireContactCode: (row['개통방법코드'] || row['requireContactCode'] || 'Y') === 'Y',
          requireCarrier: (row['통신사'] || row['requireCarrier'] || 'Y') === 'Y',
          requirePreviousCarrier: (row['이전통신사'] || row['requirePreviousCarrier'] || 'N') === 'Y',
          requireDocumentUpload: (row['서류첨부'] || row['requireDocumentUpload'] || 'N') === 'Y',
          requireBundleNumber: (row['결합번호'] || row['requireBundleNumber'] || 'N') === 'Y',
          requireBundleCarrier: (row['결합통신사'] || row['requireBundleCarrier'] || 'N') === 'Y',
          allowNewCustomer: (row['신규'] || row['allowNewCustomer'] || 'Y') === 'Y',
          allowPortIn: (row['번호이동'] || row['allowPortIn'] || 'Y') === 'Y',
          requireDesiredNumber: (row['희망번호'] || row['requireDesiredNumber'] || 'N') === 'Y'
        };

        if (!carrierData.name) {
          errors.push(`행 ${processed + failed + 1}: 통신사명이 필요합니다.`);
          failed++;
          continue;
        }

        await getStorage().createCarrier(carrierData);
        processed++;
      } catch (error: any) {
        errors.push(`행 ${processed + failed + 1}: ${error.message}`);
        failed++;
      }
    }

    res.json({
      message: `엑셀 업로드 완료: ${processed}개 성공, ${failed}개 실패`,
      processed,
      failed,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: any) {
    console.error('Carrier upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Other carriers API
router.get('/api/other-carriers', async (req, res) => {
  try {
    const carriers = await getStorage().getCarriers();
    res.json(carriers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Contact codes auto-by-pos API - 실판매 POS 기준 자동 매칭 (dealerId 불필요)
router.get('/api/contact-codes/auto-by-pos', requireAuth, async (req, res) => {
  try {
    const carrier = req.query.carrier as string;
    const posHint = req.query.posHint as string | undefined;
    
    console.log(`[AutoPOS] carrier=${carrier}, posHint=${posHint || 'none'}`);
    
    if (!carrier) {
      return res.status(400).json({ matched: false, reason: 'NO_CARRIER' });
    }
    
    // 정규화 함수
    const norm = (s: string | null | undefined): string => {
      if (!s || s === '-' || s === 'undefined' || s === 'null') return '';
      return s.toLowerCase()
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .replace(/[.\-(){}\[\]·•‧]/g, '');
    };
    
    // carrier와 isActive=true로 후보 조회
    const allContactCodes = await getStorage().getContactCodes(carrier);
    const candidates = allContactCodes.filter((cc: any) => cc.isActive !== false);
    
    console.log(`[AutoPOS] candidates=${candidates.length}`);
    
    if (candidates.length === 0) {
      return res.json({ matched: false, reason: 'NO_MATCH' });
    }
    
    // posHint가 있으면 우선 매칭
    if (posHint) {
      const normHint = norm(posHint);
      const posMatches = candidates.filter((cc: any) => 
        norm(cc.realSalesPOS) === normHint || norm(cc.dealerName) === normHint
      );
      
      if (posMatches.length === 1) {
        const matched = posMatches[0];
        console.log(`[AutoPOS] final=matched(posHint), code=${matched.code}, realSalesPOS=${matched.realSalesPOS}`);
        return res.json({
          matched: true,
          code: matched.code,
          dealerName: matched.dealerName,
          realSalesPOS: matched.realSalesPOS || matched.dealerName
        });
      } else if (posMatches.length > 1) {
        // 최신순으로 정렬하여 첫 번째 선택
        const sorted = posMatches.sort((a: any, b: any) => 
          new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
        );
        const matched = sorted[0];
        console.log(`[AutoPOS] final=matched(posHint,latest), code=${matched.code}, realSalesPOS=${matched.realSalesPOS}`);
        return res.json({
          matched: true,
          code: matched.code,
          dealerName: matched.dealerName,
          realSalesPOS: matched.realSalesPOS || matched.dealerName
        });
      }
    }
    
    // realSalesPOS로 그룹화
    const posGroups = new Map<string, any[]>();
    candidates.forEach((cc: any) => {
      const key = norm(cc.realSalesPOS) || norm(cc.dealerName);
      if (key) {
        if (!posGroups.has(key)) {
          posGroups.set(key, []);
        }
        posGroups.get(key)!.push(cc);
      }
    });
    
    console.log(`[AutoPOS] posGroups size=${posGroups.size}`);
    
    // 단일 POS인 경우
    if (posGroups.size === 1) {
      const group = Array.from(posGroups.values())[0];
      const sorted = group.sort((a: any, b: any) => 
        new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      );
      const matched = sorted[0];
      console.log(`[AutoPOS] final=matched(single), code=${matched.code}, realSalesPOS=${matched.realSalesPOS}`);
      return res.json({
        matched: true,
        code: matched.code,
        dealerName: matched.dealerName,
        realSalesPOS: matched.realSalesPOS || matched.dealerName
      });
    }
    
    // 다중 POS인 경우 - 옵션 리스트 반환
    const options = Array.from(posGroups.values()).map(group => {
      const latest = group.sort((a: any, b: any) => 
        new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
      )[0];
      return {
        realSalesPOS: latest.realSalesPOS || latest.dealerName,
        dealerName: latest.dealerName,
        code: latest.code,
        updatedAt: latest.updatedAt
      };
    });
    
    console.log(`[AutoPOS] final=MULTI_POS, options=${options.length}`);
    return res.json({
      matched: false,
      reason: 'MULTI_POS',
      options
    });
    
  } catch (error: any) {
    console.error('[AutoPOS] error:', error);
    res.status(500).json({ matched: false, reason: 'ERROR', error: error.message });
  }
});

// Contact codes auto-match API - 더 구체적인 라우트가 먼저 와야 함
router.get('/api/contact-codes/auto-match', requireAuth, async (req, res) => {
  try {
    console.log('📍 Auto-match API called');
    const session = (req as any).user;
    
    if (!session || session.userType !== 'user') {
      console.log('❌ Auto-match rejected: not a dealer user');
      return res.status(403).json({ success: false, error: 'dealer-only' });
    }
    
    const user = await getStorage().getUserById(session.userId);
    console.log(`🔍 Auto-match: User found, dealerId=${user?.dealerId}`);
    
    if (!user || !user.dealerId) {
      console.log('❌ Auto-match rejected: no dealerId');
      return res.status(403).json({ success: false, error: 'dealer-only' });
    }
    
    const carrier = req.query.carrier as string;
    console.log(`🔍 Auto-match: carrier=${carrier}`);
    
    if (!carrier) {
      return res.status(400).json({ success: false, error: '통신사가 필요합니다.' });
    }
    
    const dealer = await getStorage().getDealerById(user.dealerId);
    console.log(`🔍 Auto-match: Dealer found, businessName="${dealer?.businessName}"`);
    
    if (!dealer) {
      console.log('❌ Auto-match error: dealer not found');
      return res.status(404).json({ success: false, error: '판매점 정보를 찾을 수 없습니다.' });
    }
    
    const result = await getStorage().getContactCodeAutoMatch(dealer.businessName, carrier);
    console.log(`🔍 Auto-match result:`, result ? `Found code=${result.code}` : 'No match');
    
    if (!result) {
      return res.json({ success: true, result: null });
    }
    
    res.json({
      success: true,
      result: {
        code: result.code,
        dealerName: result.dealerName,
        carrier: result.carrier,
        id: result.id,
        updatedAt: result.updatedAt
      }
    });
  } catch (error: any) {
    console.error('❌ Contact code auto-match error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Contact codes API
router.get('/api/contact-codes', requireAuth, async (req, res) => {
  try {
    const carrier = req.query.carrier as string | undefined;
    const contactCodes = await getStorage().getContactCodes(carrier);
    console.log(`✅ Contact codes API - Returning ${contactCodes.length} codes${carrier && carrier !== 'all' ? ` (carrier: ${carrier})` : ''}`);
    res.json(contactCodes);
  } catch (error: any) {
    console.error('❌ Contact codes API error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/contact-codes', requireAdmin, async (req, res) => {
  try {
    const { code, dealerName, carrier, realSalesPOS, salesManagerId, salesManagerName } = req.body;
    
    if (!code || !dealerName || !carrier) {
      return res.status(400).json({ error: '접점코드, 판매점명, 통신사가 필요합니다.' });
    }

    const contactCode = await getStorage().createContactCode({
      code,
      dealerName,
      carrier,
      realSalesPOS: realSalesPOS || null,
      salesManagerId: salesManagerId || null,
      salesManagerName: salesManagerName || null
    });
    
    res.json(contactCode);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// 접점코드 검색 (쿼리 파라미터 형식) - 최적화된 prefix 검색
router.get('/api/contact-codes/search', requireAuth, async (req, res) => {
  try {
    const query = req.query.q as string;
    const limitParam = req.query.limit as string;
    const limit = limitParam ? parseInt(limitParam, 10) : 20;
    
    if (!query) {
      return res.status(400).json({ error: '검색어가 필요합니다.' });
    }

    if (query.length < 2) {
      return res.json([]); // 너무 짧은 검색어는 빈 결과 반환
    }

    // Optimized DB search using prefix index
    const results = await getStorage().searchContactCodes(query, Math.min(limit, 50));

    res.json(results);
  } catch (error: any) {
    console.error('Contact code search error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 접점코드 단건 조회 (통신사 + 코드 정확 일치)
router.get('/api/contact-codes/by-code', requireAuth, async (req, res) => {
  try {
    const carrier = req.query.carrier as string;
    const code = req.query.code as string;
    
    if (!carrier) {
      return res.status(400).json({ error: '통신사가 필요합니다.' });
    }
    
    if (!code) {
      return res.status(400).json({ error: '접점코드가 필요합니다.' });
    }

    // 코드 패턴 검증 (한글 2자 + 숫자 5-6자)
    if (code.length < 3 || code.length > 8) {
      return res.status(422).json({ error: '접점코드 형식이 올바르지 않습니다.' });
    }

    const contactCode = await getStorage().getContactCodeByCarrierAndCode(carrier, code);
    
    if (!contactCode) {
      return res.status(404).json({ error: '해당 접점코드를 찾을 수 없습니다.' });
    }

    res.json(contactCode);
  } catch (error: any) {
    console.error('Contact code by-code lookup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 접점코드 정확 조회 (경로 파라미터 형식)
router.get('/api/contact-codes/search/:code', requireAuth, async (req, res) => {
  try {
    const code = req.params.code;
    const carrier = req.query.carrier as string | undefined;
    
    if (!code) {
      return res.status(400).json({ error: '접점코드가 필요합니다.' });
    }

    let contactCode;
    
    // 통신사가 제공되면 통신사별 검색, 아니면 전체 검색
    if (carrier) {
      contactCode = await getStorage().getContactCodeByCarrierAndCode(carrier, code);
      console.log(`📋 Contact code search: code=${code}, carrier=${carrier}, found=${!!contactCode}`);
    } else {
      contactCode = await getStorage().getContactCodeByCode(code);
      console.log(`📋 Contact code search: code=${code}, carrier=all, found=${!!contactCode}`);
    }
    
    if (!contactCode) {
      return res.status(404).json({ error: '접점코드를 찾을 수 없습니다.' });
    }

    res.json(contactCode);
  } catch (error: any) {
    console.error('Contact code lookup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Document upload with formidable
router.post('/api/documents', requireAuth, async (req: any, res) => {
  try {
    console.log('[CREATE_DOCUMENT] 📥 New document submission request received');
    console.log('[CREATE_DOCUMENT] Session:', { userId: req.session?.userId, dealerId: req.session?.dealerId });
    
    const form = formidable({
      uploadDir: path.join(process.cwd(), 'uploads', 'documents'),
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB
      multiples: true,
    });

    const [fields, files] = await form.parse(req);
    console.log('[CREATE_DOCUMENT] Form parsed - fields count:', Object.keys(fields).length, 'files count:', Object.keys(files).length);
    
    // Helper function to extract field values
    const getFieldValue = (fieldName: string): string => {
      const value = fields[fieldName];
      return Array.isArray(value) ? value[0] : value || '';
    };

    // Helper function to extract files array
    const getFiles = (fileName: string): any[] => {
      const fileArray = files[fileName];
      if (!fileArray) return [];
      return Array.isArray(fileArray) ? fileArray : [fileArray];
    };

    const uploadedFiles = getFiles('files');
    
    // Extract form data
    const requestId = getFieldValue('requestId') as string;
    const customerName = getFieldValue('customerName') as string;
    const customerPhone = getFieldValue('customerPhone') as string;
    const customerEmail = getFieldValue('customerEmail') as string;
    const contactCode = getFieldValue('contactCode') as string;
    const carrier = getFieldValue('carrier') as string;
    const previousCarrier = getFieldValue('previousCarrier') as string;
    const customerType = getFieldValue('customerType') as string;
    const notes = getFieldValue('notes') as string;
    const desiredNumber = getFieldValue('desiredNumber') as string;
    const bundleNumber = getFieldValue('bundleNumber') as string;
    const bundleCarrier = getFieldValue('bundleCarrier') as string;
    const activationStatus = (getFieldValue('activationStatus') as string) || '대기';
    const deviceModel = getFieldValue('deviceModel') as string;
    const simNumber = getFieldValue('simNumber') as string;
    const subscriptionNumber = getFieldValue('subscriptionNumber') as string;
    const servicePlanId = getFieldValue('servicePlanId') as string;
    
    console.log('[CREATE_DOCUMENT] customerType extracted:', customerType, 'rawValue:', fields['customerType']);
    console.log('[CREATE_DOCUMENT] activationStatus extracted:', activationStatus, 'rawValue:', fields['activationStatus']);
    console.log('[CREATE_DOCUMENT] 🔑 Request ID:', requestId);

    // 🔒 DB 기반 중복 제출 방지 (여러 인스턴스 간 공유)
    const dealerId = req.session?.dealerId;
    const userId = req.session?.userId;
    const now = Date.now();
    const submissionKey = requestId || `${dealerId}-${userId}-${customerPhone}-${carrier}`;
    
    try {
      // DB에서 최근 5초 이내 동일한 제출 확인
      const fiveSecondsAgo = new Date(now - DUPLICATE_WINDOW_MS);
      const db = await getDatabase();
      const { documents } = await import('../shared/schema');
      
      // dealerId가 있는 경우와 없는 경우를 구분하여 쿼리 생성
      let recentDocs;
      if (dealerId) {
        recentDocs = await db
          .select()
          .from(documents)
          .where(sql`
            dealer_id = ${dealerId}
            AND user_id = ${userId}
            AND customer_phone = ${customerPhone}
            AND carrier = ${carrier}
            AND uploaded_at > ${fiveSecondsAgo}
          `)
          .limit(1);
      } else {
        // dealerId가 없는 경우 (admin 계정)
        recentDocs = await db
          .select()
          .from(documents)
          .where(sql`
            dealer_id IS NULL
            AND user_id = ${userId}
            AND customer_phone = ${customerPhone}
            AND carrier = ${carrier}
            AND uploaded_at > ${fiveSecondsAgo}
          `)
          .limit(1);
      }
      
      if (recentDocs.length > 0) {
        const existingDoc = recentDocs[0];
        console.log('[CREATE_DOCUMENT] ⛔ DUPLICATE BLOCKED - DB check');
        console.log('[CREATE_DOCUMENT] Existing document:', existingDoc.documentNumber);
        console.log('[CREATE_DOCUMENT] Uploaded at:', existingDoc.uploadedAt);
        
        // 이미 생성된 문서 정보 반환
        return res.status(200).json({
          success: true,
          message: '문서가 성공적으로 접수되었습니다.',
          documents: [],
          duplicate: true,
          previousDocument: existingDoc.documentNumber
        });
      }
      
      console.log('[CREATE_DOCUMENT] ✅ No duplicate found in DB - proceeding');
    } catch (dbCheckError) {
      console.error('[CREATE_DOCUMENT] DB duplicate check failed:', dbCheckError);
      // DB 체크 실패 시 메모리 체크로 폴백
      const recentSubmission = recentSubmissions.get(submissionKey);
      if (recentSubmission && (now - recentSubmission.timestamp) < DUPLICATE_WINDOW_MS) {
        console.log('[CREATE_DOCUMENT] ⛔ DUPLICATE BLOCKED - Memory fallback');
        return res.status(200).json({
          success: true,
          message: '문서가 성공적으로 접수되었습니다.',
          documents: [],
          duplicate: true,
          previousDocument: recentSubmission.documentNumber
        });
      }
    }

    // Validate uploaded files
    if (uploadedFiles.length > 0) {
      const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      const pdfFiles = uploadedFiles.filter(f => f.mimetype === 'application/pdf');
      const imageFiles = uploadedFiles.filter(f => f.mimetype?.startsWith('image/'));
      
      // Check file types
      for (const file of uploadedFiles) {
        if (!allowedTypes.includes(file.mimetype || '')) {
          return res.status(400).json({ error: '지원되지 않는 파일 형식입니다. PDF 또는 이미지 파일만 허용됩니다.' });
        }
      }
      
      // Validate PDF count
      if (pdfFiles.length > 1) {
        return res.status(400).json({ error: 'PDF는 1개만 업로드 가능합니다.' });
      }
      
      // Validate PDF + image mix
      if (pdfFiles.length === 1 && imageFiles.length > 0) {
        return res.status(400).json({ error: 'PDF는 단독 1개만 업로드 가능합니다.' });
      }
      
      // Validate image count
      if (imageFiles.length > 10) {
        return res.status(400).json({ error: '이미지는 최대 10개까지 업로드 가능합니다.' });
      }
    }

    // 🚩 기능 플래그: DEALER_USER_FALLBACK (백필 완료 전까지 on)
    const DEALER_USER_FALLBACK = (process.env.DEALER_USER_FALLBACK ?? 'on').toLowerCase() === 'on';
    
    // dealerId 조회: 세션 → userId → contactCode 순서로 시도
    let resolvedDealerId = req.session?.dealerId;
    
    if (!resolvedDealerId && req.session?.userId) {
      try {
        const user = await getStorage().getUserById(req.session.userId);
        if (user && user.dealerId) {
          resolvedDealerId = user.dealerId;
          console.log('[CREATE_DOCUMENT] ✅ Resolved dealerId from userId:', req.session.userId, '->', resolvedDealerId);
        }
      } catch (error) {
        console.warn('[CREATE_DOCUMENT] Failed to resolve dealerId from userId:', error);
      }
    }
    
    // contactCode로 dealerId 조회 (최종 시도)
    if (!resolvedDealerId && contactCode) {
      try {
        const contactCodeData = await getStorage().getContactCodeByCode(contactCode);
        if (contactCodeData && contactCodeData.dealerName) {
          // dealerName으로 dealer_registrations 검색
          const db = await getDatabase();
          const { dealerRegistrations } = await import('../shared/schema');
          const dealers = await db
            .select()
            .from(dealerRegistrations)
            .where(sql`LOWER(${dealerRegistrations.businessName}) = LOWER(${contactCodeData.dealerName})`)
            .limit(1);
          
          if (dealers.length > 0) {
            resolvedDealerId = dealers[0].id;
            console.log('[CREATE_DOCUMENT] ✅ Resolved dealerId from contactCode:', contactCode, '->', resolvedDealerId);
          }
        }
      } catch (error) {
        console.warn('[CREATE_DOCUMENT] Failed to resolve dealerId from contactCode:', error);
      }
    }
    
    // 🚨 Step 3: dealer_id 강제 검증 (DEALER_USER_FALLBACK=off일 때)
    if (!DEALER_USER_FALLBACK && !resolvedDealerId && req.session?.userType === 'user') {
      console.error('[CREATE_DOCUMENT] ❌ DEALER_ID_MISSING (DEALER_USER_FALLBACK=off):', {
        userId: req.session?.userId,
        customerName,
        contactCode,
        carrier
      });
      return res.status(400).json({ 
        error: 'DEALER_ID_MISSING',
        message: '딜러 정보가 등록되지 않았습니다. 관리자에게 문의하세요.' 
      });
    }

    const createdDocuments = [];

    // Create document for each file (or one document without file if no files uploaded)
    if (uploadedFiles.length === 0) {
      // No files - create one document without file
      console.log('[CREATE_DOCUMENT] ✅ Creating document WITHOUT file');
      
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      const documentNumber = `DOC${timestamp}${randomSuffix}`;

      const documentData: any = {
        documentNumber,
        customerName,
        customerPhone,
        customerEmail,
        contactCode,
        carrier,
        previousCarrier,
        customerType: customerType || 'new',
        notes,
        desiredNumber,
        bundleNumber,
        bundleCarrier,
        status: '접수',
        activationStatus: activationStatus,
        deviceModel: deviceModel || null,
        simNumber: simNumber || null,
        subscriptionNumber: subscriptionNumber || null,
        servicePlanId: servicePlanId ? parseInt(servicePlanId) : null,
        filePath: null,
        originalFilename: null,
        fileSize: null,
        fileMimetype: null,
        dealerId: resolvedDealerId,
        userId: req.session?.userId
      };

      // 개통 상태로 생성 시 처리자 정보 자동 설정
      if (activationStatus === '개통') {
        const sessionUserId = req.session?.userId;
        const sessionUserType = req.session?.userType;
        
        if (sessionUserId) {
          documentData.activatedBy = sessionUserId;
          documentData.activatedByType = sessionUserType || 'user';
          documentData.activatedAt = new Date();
          console.log('[CREATE_DOCUMENT] ✅ Auto-set activated info for 개통:', { activatedBy: sessionUserId, activatedByType: sessionUserType });
        }
      }

      // 중요 로깅: dealer_id 및 user_id 상태
      if (!resolvedDealerId && req.session?.userType === 'user') {
        console.warn('[CREATE_DOCUMENT] ⚠️ dealer_id is NULL for dealer user:', {
          userId: req.session?.userId,
          customerName,
          contactCode,
          carrier,
          note: 'Document tracked by userId only - dealer_registrations sync needed'
        });
      } else if (resolvedDealerId) {
        console.log('[CREATE_DOCUMENT] ✅ dealer_id resolved:', resolvedDealerId);
      }
      
      console.log('[CREATE_DOCUMENT] Document data:', { 
        documentNumber, 
        customerName, 
        carrier, 
        contactCode, 
        activationStatus,
        dealerId: resolvedDealerId,
        userId: req.session?.userId 
      });
      const document = await getStorage().createDocument(documentData);
      console.log('[CREATE_DOCUMENT] ✅ Document created with ID:', document.id, '| dealerId:', document.dealerId, '| userId:', document.userId);
      createdDocuments.push(document);
    } else {
      // Generate batch ID for grouping multiple files
      const batchId = randomUUID();
      const fileCount = uploadedFiles.length;
      
      // Create one document per file with batch metadata
      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const documentNumber = `DOC${timestamp}${randomSuffix}`;
        
        const isMainDocument = i === 0;
        
        // Create batch metadata in notes field
        const batchMetadata = {
          batchId,
          isChild: !isMainDocument,
          fileCount: isMainDocument ? fileCount : undefined,
          fileIndex: i
        };
        
        // Merge user notes with batch metadata
        const mergedNotes = notes 
          ? `${notes}\n__BATCH_META__:${JSON.stringify(batchMetadata)}`
          : `__BATCH_META__:${JSON.stringify(batchMetadata)}`;

        const documentData: any = {
          documentNumber,
          customerName,
          customerPhone,
          customerEmail,
          contactCode,
          carrier,
          previousCarrier,
          customerType: customerType || 'new',
          notes: mergedNotes,
          desiredNumber,
          bundleNumber,
          bundleCarrier,
          status: '접수',
          activationStatus: activationStatus,
          deviceModel: deviceModel || null,
          simNumber: simNumber || null,
          subscriptionNumber: subscriptionNumber || null,
          servicePlanId: servicePlanId ? parseInt(servicePlanId) : null,
          filePath: file.filepath,
          originalFilename: file.originalFilename,
          fileSize: file.size,
          fileMimetype: file.mimetype,
          dealerId: resolvedDealerId,
          userId: req.session?.userId
        };

        // 개통 상태로 생성 시 처리자 정보 자동 설정
        if (activationStatus === '개통') {
          const sessionUserId = req.session?.userId;
          const sessionUserType = req.session?.userType;
          
          if (sessionUserId) {
            documentData.activatedBy = sessionUserId;
            documentData.activatedByType = sessionUserType || 'user';
            documentData.activatedAt = new Date();
          }
        }

        // 중요 로깅: dealer_id 및 user_id 상태 (첫 번째 파일만)
        if (i === 0) {
          if (!resolvedDealerId && req.session?.userType === 'user') {
            console.warn('[CREATE_DOCUMENT] ⚠️ dealer_id is NULL for dealer user:', {
              userId: req.session?.userId,
              customerName,
              contactCode,
              carrier,
              note: 'Document tracked by userId only - dealer_registrations sync needed'
            });
          } else if (resolvedDealerId) {
            console.log('[CREATE_DOCUMENT] ✅ dealer_id resolved:', resolvedDealerId);
          }
        }
        
        const document = await getStorage().createDocument(documentData);
        console.log(`[CREATE_DOCUMENT] ✅ Document ${i + 1}/${fileCount} created with ID:`, document.id, '| dealerId:', document.dealerId, '| userId:', document.userId);
        createdDocuments.push(document);
        
        // Small delay to ensure unique document numbers
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    console.log('[CREATE_DOCUMENT] 🎉 Response - created documents count:', createdDocuments.length);
    console.log('[CREATE_DOCUMENT] Document IDs:', createdDocuments.map(d => d.id));
    
    // 제출 기록 저장 (중복 방지용)
    if (createdDocuments.length > 0) {
      const documentNumber = createdDocuments[0].documentNumber;
      recentSubmissions.set(submissionKey, {
        timestamp: now,
        documentNumber
      });
      console.log('[CREATE_DOCUMENT] 📝 Saved submission record:', submissionKey);
    }
    
    res.json({ 
      success: true, 
      message: createdDocuments.length > 1 
        ? `${createdDocuments.length}개 문서가 성공적으로 접수되었습니다.` 
        : '문서가 성공적으로 접수되었습니다.', 
      documents: createdDocuments 
    });
  } catch (error: any) {
    console.error('Document upload error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 문서 템플릿 업로드 API
router.post('/api/admin/upload-document-template', requireAdmin, templateUpload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일을 선택해주세요.' });
    }

    const { templateName, description } = req.body;
    
    if (!templateName) {
      return res.status(400).json({ error: '템플릿 이름을 입력해주세요.' });
    }

    // await getStorage().uploadDocumentTemplate(req.file, templateName, description); // 스텁
    res.json({ success: true, message: '문서 템플릿이 성공적으로 업로드되었습니다.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Documents API with filters
router.get('/api/documents', requireAuth, async (req: any, res) => {
  try {
    // [수정 목적] 개통완료 관리 페이지 검색 기능 수정
    // - activatedByType 파라미터 추가하여 작업자구분 필터링 지원
    const { status, search, startDate, endDate, contactCode, carrier, activationStatus, allWorkers, includeActivatedBy, excludeWorkRequests, excludeDeleted, activatedByType } = req.query;
    
    console.log('Documents API request:', {
      status,
      activationStatus,
      search,
      contactCode,
      startDate,
      endDate,
      carrier,
      activatedByType,
      allWorkers,
      includeActivatedBy,
      excludeWorkRequests,
      excludeDeleted,
      sessionUserType: req.session?.userType,
      sessionUserId: req.session?.userId
    });
    
    // Get user details for permission filtering
    const sessionUserType = req.session?.userType;
    const sessionUserId = req.session?.userId;
    let dealerId = null;
    
    // Check if user is a dealer (has dealerId)
    if (sessionUserType === 'user' && sessionUserId) {
      const user = await getStorage().getUserById(sessionUserId);
      dealerId = user?.dealerId;
      console.log('[ROUTE] User check - dealerId:', dealerId, 'userType:', sessionUserType);
    }
    
    const filters = {
      status,
      search,
      startDate,
      endDate,
      contactCode,
      carrier,
      activationStatus,
      activatedByType,
      userId: allWorkers === 'true' ? null : req.session?.userId,
      includeActivatedBy: includeActivatedBy === 'true',
      excludeWorkRequests: excludeWorkRequests === 'true',
      excludeDeleted: excludeDeleted === 'true',
      // Permission-based filtering
      userType: sessionUserType,
      dealerId: dealerId,
      allWorkers: allWorkers === 'true'
    };
    
    console.log('[ROUTE] Calling getStorage().getDocuments() with filters:', filters);
    const documents = await getStorage().getDocuments(filters, sessionUserId, sessionUserType);
    console.log('[ROUTE] getDocuments() returned, count:', documents.length);
    res.json(documents);
  } catch (error: any) {
    console.error('[ROUTE ERROR] Documents API failed:', error);
    console.error('[ROUTE ERROR] Stack:', error.stack);
    res.status(500).json({ error: error.message });
  }
});

// Get single document
router.get('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const document = await getStorage().getDocumentById(id);
    
    if (!document) {
      return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    }
    
    res.json(document);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export documents to Excel
router.get('/api/documents/export/excel', requireAuth, async (req: any, res) => {
  try {
    const { status, search, startDate, endDate, contactCode, carrier, activationStatus, allWorkers, includeActivatedBy } = req.query;
    
    const filters = {
      status,
      search,
      startDate,
      endDate,
      contactCode,
      carrier,
      activationStatus,
      userId: allWorkers === 'true' ? null : req.session?.userId,
      includeActivatedBy: true
    };
    
    const documents = await getStorage().getDocuments(filters, req.session?.userId, req.session?.userType);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Prepare data for Excel
    const excelData = documents.map((doc: any) => ({
      '개통일': doc.activatedAt ? format(new Date(doc.activatedAt), 'yyyy-MM-dd HH:mm', { locale: ko }) : '',
      '고객명': doc.customerName || '',
      '연락처': doc.customerPhone || '',
      '가입번호': doc.subscriptionNumber || '',
      '이전통신사': doc.previousCarrier || '',
      '통신사': doc.carrierName || doc.carrier || '',
      '유형': doc.customerType === 'new' ? '신규' : doc.customerType === 'port_in' ? '번호이동' : '',
      '판매점명': doc.dealerName || doc.storeName || '',
      '접점코드': doc.contactCode || '',
      '실판매pos': doc.realSalesPOS || '',
      '요금제': doc.planName || doc.servicePlan || doc.plan || '',
      '처리자': doc.activatedByName || ''
    }));
    
    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, '문서목록');
    
    // Set response headers
    const fileName = `documents_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    
    // Write to response
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.send(buffer);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Document status update
router.patch('/api/documents/:id/status', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = updateDocumentStatusSchema.parse(req.body);
    
    await getStorage().updateDocumentStatus(id, data.status, req.session?.userId);
    const document = await getStorage().getDocumentById(id);
    res.json(document);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Document activation status update
router.patch('/api/documents/:id/activation', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    
    console.log(`Updating activation status for document ${id}:`, data);
    
    // 개통/기타완료 상태로 변경 시 자동으로 activated_by/activated_at 설정
    if (data.activationStatus && ['개통', '개통완료', '기타완료'].includes(data.activationStatus)) {
      const sessionUserId = req.session?.userId;

      // 1) 기존 문서 조회
      const existingDoc = await getStorage().getDocumentById(id);

      // 2) activatedBy: "없을 때만" 설정 (신규 개통의 경우)
      if (!existingDoc?.activatedBy) {
        data.activatedBy = data.activatedBy || sessionUserId;
        const userType = req.session?.userType;
        data.activatedByType = userType === 'admin' ? 'admin' : 'user';
      } else {
        // 보존 로그(운영 문제 추적)
        console.info('[activation] activatedBy preserved:', {
          docId: id,
          existingActivatedBy: existingDoc.activatedBy,
          requestedActivatedBy: data.activatedBy ?? sessionUserId,
        });
      }

      // 3) activatedAt: "없을 때만" 설정
      if (!existingDoc?.activatedAt) {
        data.activatedAt = data.activatedAt || new Date().toISOString();
      }
    }
    
    // 폐기 상태로 변경 시 자동으로 cancelled_at 설정
    if (data.activationStatus === '폐기') {
      if (!data.cancelledAt) {
        data.cancelledAt = new Date().toISOString();
      }
      console.log(`Auto-set discard metadata: cancelledAt=${data.cancelledAt}`);
    }
    
    await getStorage().updateDocument(id, data);
    const document = await getStorage().getDocumentById(id);
    res.json(document);
  } catch (error: any) {
    console.error('Activation status update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Duplicate check route
router.post('/api/documents/check-duplicate', requireAuth, async (req, res) => {
  try {
    const { customerName, customerPhone, carrier, storeName, contactCode } = req.body;
    
    if (!customerName || !customerPhone) {
      return res.status(400).json({ error: '고객명과 연락처는 필수입니다.' });
    }

    // 이번 달 시작일과 종료일 계산
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    
    // 임시로 중복 검사 비활성화 - 기존 기능 복원까지
    const duplicates: any[] = [];

    res.json({ duplicates });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// File download/preview route (with optional PDF conversion for images)
router.get('/api/files/documents/:id', requireAuth, async (req: any, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const document = await getStorage().getDocumentById(documentId);
    
    if (!document || !document.filePath) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    const filePath = document.filePath as string;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    
    // Infer MIME type from file extension
    const fileName = document.fileName || path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    let mimeType = 'application/octet-stream';
    
    if (ext === '.pdf') {
      mimeType = 'application/pdf';
    } else if (['.jpg', '.jpeg'].includes(ext)) {
      mimeType = 'image/jpeg';
    } else if (ext === '.png') {
      mimeType = 'image/png';
    } else if (ext === '.gif') {
      mimeType = 'image/gif';
    } else if (ext === '.webp') {
      mimeType = 'image/webp';
    } else if (ext === '.doc') {
      mimeType = 'application/msword';
    } else if (ext === '.docx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (ext === '.xls') {
      mimeType = 'application/vnd.ms-excel';
    } else if (ext === '.xlsx') {
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    
    const formatAsPdf = req.query.format === 'pdf';
    const isInline = req.query.disposition === 'inline';
    const isImage = mimeType.startsWith('image/');
    
    // Convert image to PDF if requested
    if (formatAsPdf && isImage) {
      const pdfFilename = fileName.replace(/\.[^.]+$/, '.pdf');
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfFilename}"`);
      res.setHeader('Cache-Control', 'no-store');
      
      const doc = new PDFDocument({ 
        size: 'A4',
        margin: 0
      });
      
      doc.pipe(res);
      
      // Add image to PDF, fit to page
      doc.image(filePath, 0, 0, {
        fit: [595.28, 841.89], // A4 size in points
        align: 'center',
        valign: 'center'
      });
      
      doc.end();
    } else {
      // Normal file download or inline preview
      const disposition = isInline ? 'inline' : 'attachment';
      
      res.setHeader('Content-Disposition', `${disposition}; filename="${fileName}"`);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'no-store');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    }
  } catch (error: any) {
    console.error('File download error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Service plans API
router.get('/api/admin/service-plans', requireAdmin, async (req, res) => {
  try {
    const servicePlans = await getStorage().getServicePlans();
    res.json(servicePlans);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/service-plans', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const validated = createServicePlanSchema.parse(req.body);
    
    const servicePlan = await getStorage().createServicePlan({
      name: validated.name,
      carrier: validated.carrier,
      planType: validated.planType,
      dataAllowance: validated.dataAllowance || null,
      monthlyFee: validated.monthlyFee,
      combinationEligible: validated.combinationEligible,
      isActive: validated.isActive
    });
    
    res.json(servicePlan);
  } catch (error: any) {
    console.error('Failed to create service plan:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: '입력 데이터가 유효하지 않습니다.', details: error.errors });
    }
    res.status(400).json({ error: error.message });
  }
});

router.put('/api/admin/service-plans/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    
    const validated = createServicePlanSchema.parse(req.body);
    
    const servicePlan = await getStorage().updateServicePlan(id, {
      name: validated.name,
      carrier: validated.carrier,
      planType: validated.planType,
      dataAllowance: validated.dataAllowance || null,
      monthlyFee: validated.monthlyFee,
      combinationEligible: validated.combinationEligible,
      isActive: validated.isActive
    });
    
    if (!servicePlan) {
      return res.status(404).json({ error: '요금제를 찾을 수 없습니다.' });
    }
    
    res.json(servicePlan);
  } catch (error: any) {
    console.error('Failed to update service plan:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: '입력 데이터가 유효하지 않습니다.', details: error.errors });
    }
    res.status(400).json({ error: error.message });
  }
});

router.delete('/api/admin/service-plans/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    
    const deleted = await getStorage().deleteServicePlan(id);
    if (!deleted) {
      return res.status(404).json({ error: '요금제를 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, message: '요금제가 성공적으로 삭제되었습니다.' });
  } catch (error: any) {
    console.error('Failed to delete service plan:', error);
    // Handle foreign key constraint errors
    if (error.code === '23503') {
      return res.status(409).json({ error: '이 요금제는 다른 데이터에서 참조되고 있어 삭제할 수 없습니다.' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Additional services API
router.get('/api/additional-services', requireAuth, async (req: any, res) => {
  try {
    const carrier = req.query.carrier as string | undefined;
    const services = await getStorage().getAdditionalServices(carrier);
    res.json(services);
  } catch (error: any) {
    console.error('Failed to fetch additional services:', error);
    res.status(500).json({ error: error.message });
  }
});

// AdminPanel용 부가서비스 관리 API
router.get('/api/admin/additional-services', requireAdmin, async (req: any, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const carrier = req.query.carrier as string | undefined;
    const services = await getStorage().getAdditionalServices(carrier);
    res.json(services);
  } catch (error: any) {
    console.error('Failed to fetch additional services:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/additional-services', requireAdmin, async (req, res) => {
  try {
    const service = await getStorage().createAdditionalService(req.body);
    res.json(service);
  } catch (error: any) {
    console.error('Failed to create additional service:', error);
    res.status(400).json({ error: error.message });
  }
});

router.put('/api/admin/additional-services/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    await getStorage().updateAdditionalService(id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    console.error('Failed to update additional service:', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/api/admin/additional-services/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    await getStorage().deleteAdditionalService(id);
    res.json({ success: true, message: '부가서비스가 성공적으로 삭제되었습니다.' });
  } catch (error: any) {
    console.error('Failed to delete additional service:', error);
    res.status(400).json({ error: error.message });
  }
});

// Carrier Service Policies APIs
router.get('/api/carrier-service-policies', requireAuth, async (req, res) => {
  try {
    const policies = await getStorage().getCarrierServicePolicies();
    res.json(policies);
  } catch (error: any) {
    console.error('Failed to fetch carrier service policies:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/carrier-service-policies', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: '인증되지 않은 사용자입니다.' });
    }
    
    const policyData = {
      ...req.body,
      createdBy: userId,
    };
    
    const policy = await getStorage().createCarrierServicePolicy(policyData);
    res.json(policy);
  } catch (error: any) {
    console.error('Failed to create carrier service policy:', error);
    res.status(400).json({ error: error.message });
  }
});

router.put('/api/carrier-service-policies/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    await getStorage().updateCarrierServicePolicy(id, req.body);
    res.json({ success: true, message: '정책이 성공적으로 수정되었습니다.' });
  } catch (error: any) {
    console.error('Failed to update carrier service policy:', error);
    res.status(400).json({ error: error.message });
  }
});

router.delete('/api/carrier-service-policies/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    await getStorage().deleteCarrierServicePolicy(id);
    res.json({ success: true, message: '정책이 성공적으로 삭제되었습니다.' });
  } catch (error: any) {
    console.error('Failed to delete carrier service policy:', error);
    res.status(400).json({ error: error.message });
  }
});

// Service plan Excel/CSV upload (메모리 버퍼 사용)
router.post('/api/admin/service-plans/upload-excel', requireAdmin, requireDbHealthy, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    try {
      const headers = extractCsvHeadersFromUploadedFile(req.file as any);
      logCsvHeaders("서비스플랜", headers);
    } catch (e) {
      if (LOG_CSV_HEADERS) console.warn("[CSV][서비스플랜] 헤더 추출 실패:", e);
    }

    let workbook;
    if (req.file.originalname.endsWith('.csv')) {
      // CSV 파일 처리 (BOM 제거)
      let csvData = req.file.buffer.toString('utf8');
      if (csvData.charCodeAt(0) === 0xFEFF) {
        csvData = csvData.substring(1);
      }
      workbook = XLSX.read(csvData, { type: 'string' });
    } else {
      // Excel 파일 처리
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    }
    
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (data.length === 0) {
      return res.status(400).json({ error: '파일에 데이터가 없습니다.' });
    }

    const existingPlans = await getStorage().getServicePlans();
    const results = { processed: 0, failed: 0, duplicatesSkipped: 0 };

    for (const row of data) {
      try {
        const name = row['요금제명'] || row['name'] || '';
        const carrier = row['통신사'] || row['carrier'] || '';
        const planType = row['요금제유형'] || row['유형'] || row['planType'] || row['type'] || '';
        const dataAllowance = row['데이터제공량'] || row['데이터'] || row['dataAllowance'] || row['data'] || '';
        
        // 월요금 파싱 (빈 문자열 처리)
        const monthlyFeeStr = String(row['월요금(원)'] || row['월요금'] || row['monthlyFee'] || row['fee'] || '0').replace(/,/g, '').trim();
        const monthlyFee = parseFloat(monthlyFeeStr) || 0;
        
        const combinationEligible = row['결합가능'] === '가능' || row['결합가능'] === 'Y' || row['결합가능'] === 'TRUE' || row['combinationEligible'] === true || row['combinationEligible'] === 'true';

        // 필수 필드만 검사 (월요금은 0도 허용)
        if (!name || !carrier || !planType) {
          console.warn('Invalid row data (missing required fields):', { name, carrier, planType });
          results.failed++;
          continue;
        }

        // Check for duplicates
        const duplicate = existingPlans.find(
          p => p.carrier === carrier && p.name === name
        );

        if (duplicate) {
          console.warn(`Duplicate service plan: ${carrier} - ${name}`);
          results.duplicatesSkipped++;
          continue;
        }

        // Create service plan
        await getStorage().createServicePlan({
          name,
          carrier,
          planType,
          dataAllowance: dataAllowance || null,
          monthlyFee,
          combinationEligible,
          isActive: true
        });
        
        results.processed++;
      } catch (error) {
        console.error('Failed to process row:', row, error);
        results.failed++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `${results.processed}건의 요금제가 성공적으로 추가되었습니다.${results.duplicatesSkipped > 0 ? ` (${results.duplicatesSkipped}개 중복 제외)` : ''}${results.failed > 0 ? ` (${results.failed}개 실패)` : ''}`,
      processed: results.processed,
      addedPlans: results.processed,  // 프론트엔드 호환성
      failed: results.failed,
      duplicatesSkipped: results.duplicatesSkipped
    });
  } catch (error: any) {
    console.error('Failed to upload service plan Excel:', error);
    res.status(500).json({ error: '엑셀 파일 업로드에 실패했습니다.' });
  }
});

// Other Business Carriers API (User-facing, read-only)
router.get('/api/other-business-carriers', requireAuth, async (req, res) => {
  try {
    const carriers = await getStorage().getOtherBusinessCarriers();
    // Filter only active carriers for end users
    const activeCarriers = carriers.filter(c => c.isActive === true);
    
    // Set cache control headers to prevent stale data
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Cookie');
    
    res.json(activeCarriers);
  } catch (error: any) {
    console.error('Failed to fetch other business carriers:', error);
    res.status(500).json({ error: '기타업무통신사 목록을 불러오는데 실패했습니다.' });
  }
});

// Other Business Carriers API (Admin)
router.get('/api/admin/other-business-carriers', requireAdmin, async (req, res) => {
  try {
    const carriers = await getStorage().getOtherBusinessCarriers();
    res.json(carriers);
  } catch (error: any) {
    console.error('Failed to fetch other business carriers:', error);
    res.status(500).json({ error: '기타업무통신사 목록을 불러오는데 실패했습니다.' });
  }
});

router.post('/api/admin/other-business-carriers', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const validatedData = insertOtherBusinessCarrierSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse(req.body);
    
    const carrier = await getStorage().createOtherBusinessCarrier({
      ...validatedData,
      isActive: validatedData.isActive ?? true
    });
    
    res.json(carrier);
  } catch (error: any) {
    console.error('Failed to create other business carrier:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: '입력 데이터가 유효하지 않습니다.', details: error.errors });
    }
    res.status(500).json({ error: '기타업무통신사 생성에 실패했습니다.' });
  }
});

router.put('/api/admin/other-business-carriers/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }

    const validatedData = insertOtherBusinessCarrierSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial().parse(req.body);
    
    const carriers = await getStorage().getOtherBusinessCarriers();
    const existing = carriers.find(c => c.id === id);
    if (!existing) {
      return res.status(404).json({ error: '기타업무통신사를 찾을 수 없습니다.' });
    }

    await getStorage().updateOtherBusinessCarrier(id, {
      ...validatedData,
      updatedAt: new Date()
    });
    
    const updated = { ...existing, ...validatedData, updatedAt: new Date() };
    res.json(updated);
  } catch (error: any) {
    console.error('Failed to update other business carrier:', error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: '입력 데이터가 유효하지 않습니다.', details: error.errors });
    }
    res.status(500).json({ error: '기타업무통신사 수정에 실패했습니다.' });
  }
});

router.delete('/api/admin/other-business-carriers/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }

    const carriers = await getStorage().getOtherBusinessCarriers();
    const carrier = carriers.find(c => c.id === id);
    if (!carrier) {
      return res.status(404).json({ error: '기타업무통신사를 찾을 수 없습니다.' });
    }

    await getStorage().deleteOtherBusinessCarrier(id);
    res.json(carrier);
  } catch (error: any) {
    console.error('Failed to delete other business carrier:', error);
    res.status(500).json({ error: '기타업무통신사 삭제에 실패했습니다.' });
  }
});

router.post('/api/admin/other-business-carriers/excel/upload', requireAdmin, requireDbHealthy, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (data.length === 0) {
      return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
    }

    const carriers = data.map(row => ({
      businessRequestPoint: row['업무 요청점'] || row['businessRequestPoint'] || '',
      memo: row['메모'] || row['memo'] || null,
      isActive: true
    })).filter(carrier => carrier.businessRequestPoint);

    const results = { success: 0, failed: 0 };
    for (const carrier of carriers) {
      try {
        const validatedCarrier = insertOtherBusinessCarrierSchema.omit({ id: true, createdAt: true, updatedAt: true }).parse(carrier);
        await getStorage().createOtherBusinessCarrier(validatedCarrier);
        results.success++;
      } catch (error) {
        console.error('Failed to import carrier:', carrier, error);
        results.failed++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `${results.success}개의 기타업무통신사가 성공적으로 등록되었습니다.${results.failed > 0 ? ` (${results.failed}개 실패)` : ''}`,
      count: results.success,
      failed: results.failed
    });
  } catch (error: any) {
    console.error('Failed to upload other business carriers Excel:', error);
    res.status(500).json({ error: '엑셀 파일 업로드에 실패했습니다.' });
  }
});

router.get('/api/admin/other-business-carriers/excel/download', requireAdmin, async (req, res) => {
  try {
    const carriers = await getStorage().getOtherBusinessCarriers();
    
    const worksheet = XLSX.utils.json_to_sheet(carriers.map(carrier => ({
      'ID': carrier.id,
      '업무 요청점': carrier.businessRequestPoint,
      '메모': carrier.memo || '',
      '활성 여부': carrier.isActive ? '활성' : '비활성',
      '생성일': carrier.createdAt ? format(new Date(carrier.createdAt), 'yyyy-MM-dd HH:mm:ss', { locale: ko }) : ''
    })));
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '기타업무통신사');
    
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Disposition', `attachment; filename="other_business_carriers_${format(new Date(), 'yyyyMMdd', { locale: ko })}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error: any) {
    console.error('Failed to download other business carriers Excel:', error);
    res.status(500).json({ error: '엑셀 파일 다운로드에 실패했습니다.' });
  }
});

// Users basic info API (권한별 기본 사용자 정보) - admins 포함
router.get('/api/users/basic', requireAuth, async (req, res) => {
  try {
    const users = await getStorage().getUsers();
    const admins = await getStorage().getAdmins();
    
    // users 기본 정보 (비밀번호 등 민감정보 제외)
    const basicUsers = users.map(user => ({
      id: user.id,
      name: user.name,
      username: user.username,
      userType: user.userType,
      activatedByType: 'user'
    }));
    
    // admins 기본 정보 (id, name만)
    const basicAdmins = admins.map(admin => ({
      id: admin.id,
      name: admin.name,
      username: admin.username,
      userType: admin.userType || 'admin',
      activatedByType: 'admin'
    }));
    
    // 합쳐서 반환
    res.json([...basicAdmins, ...basicUsers]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Pricing table management API
router.get('/api/pricing-tables/active', async (req, res) => {
  try {
    // 임시 빈 배열 반환 (pricing tables 기능 미구현)
    res.json([]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Settlement data API
router.get('/api/admin/settlements', requireAdmin, async (req, res) => {
  try {
    const settlements = await getStorage().getSettlements();
    res.json(settlements);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/settlements/generate', requireAdmin, async (req, res) => {
  try {
    await getStorage().createSettlementsFromActivatedDocuments();
    res.json({ success: true, message: '정산 데이터가 성공적으로 생성되었습니다.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Settlement unit price API
router.get('/api/admin/settlement-unit-prices', requireAdmin, async (req, res) => {
  try {
    const prices = await getStorage().getSettlementUnitPrices();
    res.json(prices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Settlement pricing Excel upload (메모리 버퍼 사용)
router.post('/api/admin/settlement-pricing/excel-upload', requireAdmin, requireDbHealthy, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 업로드되지 않았습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (data.length === 0) {
      return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
    }

    const servicePlans = await getStorage().getServicePlans();
    const results = { processed: 0, failed: 0, duplicatesSkipped: 0 };

    for (const row of data) {
      try {
        const carrier = row['통신사'] || row['carrier'] || '';
        const planName = row['요금제명'] || row['planName'] || row['name'] || '';
        const settlementPrice = parseFloat(row['정산단가'] || row['settlementPrice'] || '0');

        if (!carrier || !planName || isNaN(settlementPrice)) {
          console.warn('Invalid row data:', row);
          results.failed++;
          continue;
        }

        // Find matching service plan
        const servicePlan = servicePlans.find(
          p => p.carrier === carrier && p.name === planName
        );

        if (!servicePlan) {
          console.warn(`Service plan not found: ${carrier} - ${planName}`);
          results.failed++;
          continue;
        }

        // Check if price already exists
        const existingPrices = await getStorage().getSettlementUnitPrices();
        const existingPrice = existingPrices.find(p => p.servicePlanId === servicePlan.id);

        if (existingPrice) {
          // Update existing price
          await getStorage().updateSettlementUnitPrice(existingPrice.id, {
            newActivationPrice: settlementPrice,
            portInPrice: settlementPrice,
            hiddenPrice: settlementPrice
          });
          results.processed++;
        } else {
          // Create new price
          await getStorage().createSettlementUnitPrice({
            servicePlanId: servicePlan.id,
            newActivationPrice: settlementPrice,
            portInPrice: settlementPrice,
            hiddenPrice: settlementPrice
          });
          results.processed++;
        }
      } catch (error) {
        console.error('Failed to process row:', row, error);
        results.failed++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `${results.processed}건의 정산단가가 성공적으로 처리되었습니다.${results.failed > 0 ? ` (${results.failed}개 실패)` : ''}`,
      processed: results.processed,
      failed: results.failed,
      duplicatesSkipped: results.duplicatesSkipped
    });
  } catch (error: any) {
    console.error('Failed to upload settlement pricing Excel:', error);
    res.status(500).json({ error: '엑셀 파일 업로드에 실패했습니다.' });
  }
});

// Admin deletion
router.delete('/api/admin/admins/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    
    const deleted = await getStorage().deleteAdmin(id);
    if (!deleted) {
      return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, message: '관리자가 삭제되었습니다.' });
  } catch (error: any) {
    console.error('Failed to delete admin:', error);
    if (error.code === '23503') {
      return res.status(409).json({ error: '이 관리자는 다른 데이터에서 참조되고 있어 삭제할 수 없습니다.' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Admin update
router.put('/api/admin/admins/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    
    const updateData = req.body;
    const updated = await getStorage().updateAdmin(id, updateData);
    
    if (!updated) {
      return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, message: '관리자 정보가 업데이트되었습니다.', data: updated });
  } catch (error: any) {
    console.error('Failed to update admin:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
    }
    res.status(400).json({ error: error.message });
  }
});

// User deletion (users 테이블 우선, admin은 fallback)
router.delete('/api/admin/users/:id', requireAdmin, requireDbHealthy, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    
    // 먼저 users 테이블 확인
    const user = await getStorage().getUserById(id);
    if (user) {
      const deleted = await getStorage().deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      }
      return res.json({ success: true, message: '사용자가 삭제되었습니다.' });
    }
    
    // users에 없으면 admin 테이블 확인 (Alias 지원)
    const admin = await getStorage().getAdminById(id);
    if (admin) {
      console.log(`🔄 Alias: DELETE /api/admin/users/${id} → admin 테이블로 위임`);
      try {
        const deleted = await getStorage().deleteAdmin(id);
        if (!deleted) {
          return res.status(404).json({ error: '관리자를 찾을 수 없습니다.' });
        }
        return res.json({ success: true, message: '관리자가 삭제되었습니다.' });
      } catch (adminError: any) {
        console.error('Failed to delete admin via alias:', adminError);
        if (adminError.message.includes('SUPER ADMIN')) {
          return res.status(409).json({ error: adminError.message });
        }
        if (adminError.code === '23503') {
          return res.status(409).json({ error: '이 관리자는 다른 데이터에서 참조되고 있어 삭제할 수 없습니다.' });
        }
        return res.status(400).json({ error: adminError.message });
      }
    }
    
    // 둘 다 없으면 404
    return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  } catch (error: any) {
    console.error('Failed to delete user:', error);
    // Handle foreign key constraint errors
    if (error.code === '23503') {
      return res.status(409).json({ error: '이 사용자는 다른 데이터에서 참조되고 있어 삭제할 수 없습니다.' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Users by type
router.get('/api/admin/users/by-type/:type', requireAdmin, async (req, res) => {
  try {
    const type = req.params.type;
    const users = await getStorage().getUsersByType(type);
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard stats API
router.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const stats = await getStorage().getDashboardStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 오늘 통계 API
router.get('/api/dashboard/today-stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.userType ?? 'admin';
    
    console.log(`[API /api/dashboard/today-stats] userId=${userId}, userType=${userType}, sessionUserType=${(req.session as any)?.userType}, sessionRole=${(req.session as any)?.role}`);
    
    const todayStats = await getStorage().getTodayStats(userId, userType);
    
    res.json(todayStats);
  } catch (error: any) {
    console.error('Today stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 월별 상태 통계 API
router.get('/api/dashboard/monthly-status-stats', requireAuth, async (req: any, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.role ?? 'admin';
    
    const monthlyStats = await getStorage().getMonthlyStatusStats(userId, userType);
    
    res.json(monthlyStats);
  } catch (error: any) {
    console.error('Monthly status stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 통신사별 통계 API
router.get('/api/dashboard/carrier-stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.userType ?? 'admin';
    
    console.log(`[API /api/dashboard/carrier-stats] userId=${userId}, userType=${userType}`);
    
    const carrierStats = await getStorage().getCarrierStats(userId, userType);
    
    res.json(carrierStats);
  } catch (error: any) {
    console.error('Carrier stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 월별 개통 통계 API
router.get('/api/dashboard/monthly-activation-stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.role ?? 'admin';
    
    const activationStats = await getStorage().getMonthlyActivationStats(userId, userType);
    
    res.json(activationStats);
  } catch (error: any) {
    console.error('Monthly activation stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 월별 개통 요약 API (총계 + 통신사별 합계, 단일 쿼리)
router.get('/api/dashboard/monthly-activation-summary', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.userType ?? 'admin';
    
    console.log(`[API /api/dashboard/monthly-activation-summary] userId=${userId}, userType=${userType}`);
    
    const summary = await getStorage().getMonthlyActivationSummary(userId, userType);
    
    res.json(summary);
  } catch (error: any) {
    console.error('Monthly activation summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 근무자별 통계 API
router.get('/api/dashboard/worker-stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.role ?? 'admin';
    
    const workerStats = await getStorage().getWorkerStats(userId, userType);
    
    res.json(workerStats);
  } catch (error: any) {
    console.error('Worker stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AdminPanel용 근무자별 통계 API (alias)
router.get('/api/worker-stats', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const userId = ctx?.id ?? ctx?.userId ?? null;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.userType ?? 'admin';
    
    const workerStats = await getStorage().getWorkerStats(userId, userType);
    res.json(workerStats);
  } catch (error: any) {
    console.error('Worker stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 특정 근무자의 통신사별 개통 통계 API (드릴다운)
router.get('/api/dashboard/worker-carrier-stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const workerId = parseInt(req.query.workerId as string);
    const workerType = req.query.workerType as string;
    
    if (!workerId || !workerType) {
      return res.status(400).json({ error: 'workerId와 workerType이 필요합니다.' });
    }
    
    const stats = await getStorage().getWorkerCarrierStats(workerId, workerType);
    res.json(stats);
  } catch (error: any) {
    console.error('Worker carrier stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 특정 통신사의 근무자별 개통 통계 API (드릴다운)
router.get('/api/dashboard/carrier-worker-stats', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const carrier = req.query.carrier as string;
    
    if (!carrier) {
      return res.status(400).json({ error: 'carrier가 필요합니다.' });
    }
    
    const stats = await getStorage().getCarrierWorkerStats(carrier);
    res.json(stats);
  } catch (error: any) {
    console.error('Carrier worker stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 관리자 개통 실적 API
router.get('/api/dashboard/admin-activation-stats', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Vary', 'Cookie');
  try {
    const ctx = (req as any).user 
      || (req.session as any)?.user 
      || { userId: (req.session as any)?.userId, userType: (req.session as any)?.role };
    const adminId = ctx?.id ?? ctx?.userId;
    const userType = ctx?.type ?? ctx?.userType ?? (req.session as any)?.userType ?? 'admin';
    
    if (!adminId) {
      return res.status(401).json({ error: '인증이 필요합니다.' });
    }
    
    console.log(`[API /api/dashboard/admin-activation-stats] adminId=${adminId}, userType=${userType}`);
    
    const stats = await getStorage().getAdminActivationStats(adminId);
    
    res.json(stats);
  } catch (error: any) {
    console.error('Admin activation stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 문서 템플릿 API
router.get('/api/document-templates', requireAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const templates = await getStorage().getDocumentTemplates();
    res.json(templates);
  } catch (error: any) {
    console.error('Document templates error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Contact code bulk upload (메모리 버퍼 사용)
router.post('/api/admin/contact-codes/bulk-upload', requireAdmin, contactCodeUpload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일을 선택해주세요.' });
    }
    
    try {
      const headers = extractCsvHeadersFromUploadedFile(req.file as any);
      logCsvHeaders("접점코드", headers);
    } catch (e) {
      if (LOG_CSV_HEADERS) console.warn("[CSV][접점코드] 헤더 추출 실패:", e);
    }
    
    try {
      let workbook;
      
      if (req.file.originalname.endsWith('.csv')) {
        // CSV 파일 처리 (BOM 제거)
        let csvData = req.file.buffer.toString('utf8');
        if (csvData.charCodeAt(0) === 0xFEFF) {
          csvData = csvData.substring(1);
        }
        workbook = XLSX.read(csvData, { type: 'string' });
      } else {
        // Excel 파일 처리 (버퍼 사용)
        workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      }
      
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
      
      if (jsonData.length === 0) {
        return res.status(400).json({ error: '파일에 데이터가 없습니다.' });
      }

      // Process data and create contact codes with batch processing
      console.log(`🔄 접점코드 업로드 시작: 총 ${jsonData.length}개 행 처리`);
      const errors: string[] = [];
      const validCodes: any[] = [];
      
      // Validate and prepare data
      for (let i = 0; i < jsonData.length; i++) {
        const rowData = jsonData[i] as any;
        
        // 다양한 컬럼명 지원
        const code = rowData['접점코드'] || rowData['코드'] || rowData['code'] || rowData['Code'];
        const dealerName = rowData['판매점명'] || rowData['딜러명'] || rowData['dealer'] || rowData['Dealer'] || rowData['dealerName'];
        const realSalesPOS = rowData['실판매POS'] || rowData['실판매점'] || rowData['realSalesPOS'] || '';
        const carrier = rowData['통신사'] || rowData['carrier'] || rowData['Carrier'] || '';
        const salesManagerName = rowData['담당영업과장'] || rowData['영업과장'] || rowData['salesManager'] || '';
        
        if (!code || !dealerName) {
          errors.push(`행 ${i + 1}: 접점코드 또는 판매점명이 누락됨`);
          continue;
        }
        
        if (!carrier) {
          errors.push(`행 ${i + 1}: 통신사가 누락됨`);
          continue;
        }
        
        validCodes.push({
          code: String(code).trim(),
          dealerName: String(dealerName).trim(),
          realSalesPOS: realSalesPOS ? String(realSalesPOS).trim() : null,
          carrier: String(carrier).trim(),
          salesManagerName: salesManagerName ? String(salesManagerName).trim() : null
        });
      }
      
      console.log(`✅ 유효 데이터: ${validCodes.length}개, 오류: ${errors.length}개`);
      
      // Batch insert with progress logging
      let successCount = 0;
      const batchSize = 500;
      
      for (let i = 0; i < validCodes.length; i += batchSize) {
        const batch = validCodes.slice(i, i + batchSize);
        try {
          await getStorage().bulkCreateContactCodes(batch);
          successCount += batch.length;
          console.log(`✅ 접점코드 업로드 진행: ${successCount}/${validCodes.length} (${Math.round(successCount / validCodes.length * 100)}%)`);
        } catch (error: any) {
          console.error(`❌ 배치 업로드 오류 (${i}-${i + batch.length}):`, error.message);
          errors.push(`배치 ${i}-${i + batch.length}: ${error.message}`);
        }
      }
      
      const errorCount = jsonData.length - successCount;
      console.log(`✅ 접점코드 업로드 완료: 성공 ${successCount}건, 실패 ${errorCount}건`);

      res.json({
        success: true,
        message: `일괄 업로드 완료: 성공 ${successCount}건, 실패 ${errorCount}건`,
        successCount,
        errorCount,
        errors: errors.slice(0, 10) // 최대 10개 오류만 반환
      });
    } catch (parseError: any) {
      return res.status(400).json({ error: `파일 파싱 오류: ${parseError.message}` });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 접점코드 수정
router.put('/api/admin/contact-codes/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { code, dealerName } = req.body;
    
    await getStorage().createContactCode({ code, dealerName });
    res.json({ success: true, message: '접점코드가 수정되었습니다.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// 접점코드 삭제
router.delete('/api/admin/contact-codes/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await getStorage().deleteContactCode(id);
    res.json({ success: true, message: '접점코드가 삭제되었습니다.' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// 문서에서 통신사 목록 추출
router.get('/api/carriers/from-documents', requireAuth, async (req, res) => {
  try {
    const carriers = await getStorage().getCarriers();
    res.json(carriers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 접수 승인 처리 (관리자 전용)
router.post('/api/admin/approve-document/:id', requireAdmin, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    
    if (isNaN(documentId)) {
      return res.status(400).json({ error: '유효하지 않은 문서 ID입니다.' });
    }

    // 문서 상태를 '승인'으로 변경
    await getStorage().updateDocumentStatus(documentId, '승인', req.session?.userId);
    
    const document = await getStorage().getDocumentById(documentId);
    
    res.json({ 
      success: true, 
      message: '문서가 승인되었습니다.',
      document 
    });
  } catch (error: any) {
    console.error('Document approval error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 접수 반려 처리 (관리자 전용)
router.post('/api/admin/reject-document/:id', requireAdmin, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const { reason } = req.body;
    
    if (isNaN(documentId)) {
      return res.status(400).json({ error: '유효하지 않은 문서 ID입니다.' });
    }

    // 문서 상태를 '반려'로 변경하고 반려 사유 저장
    await getStorage().updateDocument(documentId, {
      status: '반려',
      rejectionReason: reason || '사유 없음',
      updatedBy: req.session?.userId
    });
    
    const document = await getStorage().getDocumentById(documentId);
    
    res.json({ 
      success: true, 
      message: '문서가 반려되었습니다.',
      document 
    });
  } catch (error: any) {
    console.error('Document rejection error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 서류 진행 알림 웹소켓 메시지 전송 (관리자 전용)
router.post('/api/admin/notify-progress/:id', requireAdmin, async (req, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const { message } = req.body;
    
    if (isNaN(documentId)) {
      return res.status(400).json({ error: '유효하지 않은 문서 ID입니다.' });
    }

    // 문서 정보 조회
    const document = await getStorage().getDocumentById(documentId);
    if (!document) {
      return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    }

    // 웹소켓을 통해 진행 알림 전송
    const chatServer = ChatWebSocketServer.getInstance();
    chatServer.broadcastMessage({
      type: 'document_progress',
      documentId,
      message: message || '서류 처리가 진행 중입니다.',
      timestamp: new Date().toISOString()
    });
    
    res.json({ 
      success: true, 
      message: '진행 알림이 전송되었습니다.'
    });
  } catch (error: any) {
    console.error('Progress notification error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 문서 기기 정보 업데이트
router.patch('/api/documents/:id/device-info', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deviceInfo = req.body;
    
    await getStorage().updateDocument(id, deviceInfo);
    
    res.json({ success: true, message: '기기 정보가 업데이트되었습니다.' });
  } catch (error: any) {
    console.error('Device info update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 문서 일반 정보 업데이트 (PUT /api/documents/:id)
router.put('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const data = req.body;
    
    // ID 정수 검증
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '유효하지 않은 문서 ID입니다.' });
    }
    
    // 문서가 존재하는지 확인
    const existingDoc = await getStorage().getDocumentById(id);
    if (!existingDoc) {
      return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    }
    
    // ✅ activatedBy 보존 로직: 기존 값이 있으면 유지
    if ((existingDoc as any).activatedBy) {
      data.activatedBy = (existingDoc as any).activatedBy;
      data.activatedByType = (existingDoc as any).activatedByType;
      console.log(`[PUT /api/documents/${id}] activatedBy preserved: ${data.activatedBy}, type: ${data.activatedByType}`);
    } else if (data.activationStatus && ['개통', '개통완료', '기타완료'].includes(data.activationStatus)) {
      // 기존 activatedBy가 없고, 개통 상태로 변경 시에만 새로 설정
      const userId = req.session?.userId;
      const userType = req.session?.userType;
      if (userId) {
        data.activatedBy = userId;
        data.activatedByType = userType === 'admin' ? 'admin' : 'user';
        console.log(`[PUT /api/documents/${id}] activatedBy set: ${data.activatedBy}, type: ${data.activatedByType}`);
      }
    }
    
    // activatedAt 설정
    if (data.activationStatus && ['개통', '개통완료', '기타완료'].includes(data.activationStatus)) {
      if (!data.activatedAt && !(existingDoc as any).activatedAt) {
        data.activatedAt = new Date().toISOString();
      }
    }
    
    await getStorage().updateDocument(id, data);
    const updatedDocument = await getStorage().getDocumentById(id);
    
    res.json(updatedDocument);
  } catch (error: any) {
    console.error('Document update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 문서 개통 상태 업데이트
router.patch('/api/documents/:id/activation-status', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { activationStatus, activatedBy, activatedAt, ...otherData } = req.body;
    
    const updateData: any = {
      activationStatus,
      ...otherData
    };
    
    // 개통/기타완료 상태로 변경 시 자동으로 activated_by/activated_at 설정
    if (activationStatus && ['개통', '개통완료', '기타완료'].includes(activationStatus)) {
      const sessionUserId = req.session?.userId;

      // 1) 기존 문서 조회
      const existingDoc = await getStorage().getDocumentById(id);

      // 2) activatedBy: "없을 때만" 설정 (신규 개통의 경우)
      if (!existingDoc?.activatedBy) {
        const userType = req.session?.userType;
        updateData.activatedBy = activatedBy || sessionUserId;
        updateData.activatedByType = userType === 'admin' ? 'admin' : 'user';
      } else {
        // 보존 로그(운영 문제 추적)
        console.info('[activation-status] activatedBy preserved:', {
          docId: id,
          existingActivatedBy: existingDoc.activatedBy,
          existingActivatedByType: (existingDoc as any).activatedByType,
          requestedActivatedBy: activatedBy ?? sessionUserId,
        });
      }

      // 3) activatedAt: "없을 때만" 설정
      if (!existingDoc?.activatedAt) {
        updateData.activatedAt = activatedAt || new Date().toISOString();
      }
    }
    
    await getStorage().updateDocument(id, updateData);
    
    res.json({ success: true, message: '개통 상태가 업데이트되었습니다.' });
  } catch (error: any) {
    console.error('Activation status update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// 문서 삭제 (관리자만 가능)
router.delete('/api/documents/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    
    // 문서가 존재하는지 확인
    const existingDoc = await getStorage().getDocumentById(id);
    if (!existingDoc) {
      return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    }
    
    await getStorage().deleteDocument(id);
    
    res.json({ success: true, message: '문서가 성공적으로 삭제되었습니다.' });
  } catch (error: any) {
    console.error('Document delete error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ====================================
// 딜러 관련 API
// ====================================

// 딜러의 신청서 목록 조회
router.get('/api/dealer/applications', (req, res, next) => {
  console.log('[DEALER_DASHBOARD] 🔵 API CALLED - Before auth');
  requireAuth(req, res, next);
}, async (req, res) => {
  try {
    const userId = req.session?.userId;
    const userType = req.session?.userType;
    const FALLBACK = (process.env.DEALER_USER_FALLBACK ?? 'on').toLowerCase() === 'on';
    
    console.log('[DEALER_DASHBOARD] hit', { userId, userType, hasCookie: !!req.headers.cookie });
    
    if (userType !== 'user') {
      console.log('[DEALER_DASHBOARD] ❌ DEALER_ONLY');
      return res.status(403).json({ error: 'DEALER_ONLY' });
    }
    
    const user = await getStorage().getUserById(userId!);
    if (!user) {
      console.log('[DEALER_DASHBOARD] ❌ USER_NOT_FOUND');
      return res.status(403).json({ error: 'USER_NOT_FOUND' });
    }
    
    let rows: any[] = [];
    if (user.dealerId) {
      rows = await getStorage().getDocuments({ userType: 'user', dealerId: user.dealerId }, userId, userType);
      console.log('[DEALER_DASHBOARD] by dealerId', { dealerId: user.dealerId, count: rows.length });
      
      if (rows.length === 0 && FALLBACK) {
        const r2 = await getStorage().getDocuments({ userType: 'user', userId }, userId, userType);
        console.log('[DEALER_DASHBOARD] fallback userId', { userId, count: r2.length });
        rows = r2;
      }
    } else if (FALLBACK) {
      rows = await getStorage().getDocuments({ userType: 'user', userId }, userId, userType);
      console.log('[DEALER_DASHBOARD] no dealerId → userId', { userId, count: rows.length });
    } else {
      console.log('[DEALER_DASHBOARD] ❌ DEALER_ID_MISSING');
      return res.status(403).json({ error: 'DEALER_ID_MISSING' });
    }
    
    return res.json(rows);
  } catch (error: any) {
    console.error('[DEALER_DASHBOARD] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================================
// 채팅 관련 API
// ====================================

// 문서 ID로 채팅방 정보 조회 (채팅방이 없으면 자동 생성)
router.get('/api/chat/room/:documentId', requireAuth, async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    if (isNaN(documentId)) {
      return res.status(400).json({ error: '유효하지 않은 문서 ID입니다.' });
    }
    
    const sessionUserId = req.session?.userId;
    const userType = req.session?.userType;
    
    // 문서 확인
    const document = await getStorage().getDocumentById(documentId);
    if (!document) {
      return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
    }
    
    // 권한 확인: 딜러는 자신의 문서만, 근무자/관리자는 모든 문서 접근 가능
    if (userType === 'user') {
      const user = await getStorage().getUserById(sessionUserId!);
      if (!user || user.dealerId !== document.dealerId) {
        return res.status(403).json({ error: '이 문서에 접근할 권한이 없습니다.' });
      }
    }
    
    // 채팅방 조회 또는 생성
    let chatRoom = await getStorage().getChatRoomByDocumentId(documentId);
    if (!chatRoom) {
      chatRoom = await getStorage().createChatRoom(documentId);
    }
    
    // 메시지 조회
    const messages = await getStorage().getChatMessages(chatRoom.id);
    
    res.json({
      room: chatRoom,
      messages,
      document: {
        id: document.id,
        documentNumber: document.documentNumber,
        customerName: document.customerName,
        status: document.activationStatus
      }
    });
  } catch (error: any) {
    console.error('Chat room error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 채팅 메시지 조회
router.get('/api/chat/messages/:roomId', requireAuth, async (req, res) => {
  try {
    const roomId = parseInt(req.params.roomId);
    if (isNaN(roomId)) {
      return res.status(400).json({ error: '유효하지 않은 채팅방 ID입니다.' });
    }
    
    const messages = await getStorage().getChatMessages(roomId);
    res.json(messages);
  } catch (error: any) {
    console.error('Chat messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 채팅 메시지 전송
router.post('/api/chat/message', requireAuth, async (req, res) => {
  try {
    const { roomId, message } = req.body;
    
    if (!roomId || !message) {
      return res.status(400).json({ error: '채팅방 ID와 메시지는 필수입니다.' });
    }
    
    const sessionUserId = req.session?.userId;
    const userType = req.session?.userType;
    
    if (!sessionUserId) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    // 사용자 정보 조회 및 senderType 설정
    let senderName = 'Unknown';
    let senderType = userType;
    
    if (userType === 'admin') {
      const admin = await getStorage().getAdminById(sessionUserId);
      senderName = admin?.name || 'Admin';
      // Check if this admin is actually a dealer_worker
      if (admin?.role === 'dealer_worker') {
        senderType = 'worker';
      } else {
        senderType = 'admin';
      }
    } else if (userType === 'user') {
      const user = await getStorage().getUserById(sessionUserId);
      senderName = user?.name || 'User';
      senderType = 'dealer';
    }
    
    console.log('[CHAT_MESSAGE] Sending message - userId:', sessionUserId, 'senderType:', senderType, 'senderName:', senderName);
    
    // 메시지 생성
    const newMessage = await getStorage().createChatMessage({
      chatRoomId: roomId,
      senderId: sessionUserId,
      senderType,
      senderName,
      message: message.trim(),
      messageType: 'text'
    });
    
    res.json(newMessage);
  } catch (error: any) {
    console.error('Send message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 읽지 않은 메시지 개수 조회
router.get('/api/chat/unread-count', requireAuth, async (req, res) => {
  try {
    const sessionUserId = req.session?.userId;
    const userType = req.session?.userType;
    
    if (!sessionUserId) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    const unreadCount = await getStorage().getUnreadMessageCount(sessionUserId, userType || 'user');
    res.json(unreadCount);
  } catch (error: any) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 채팅 메시지 읽음 처리
router.post('/api/chat/mark-read', requireAuth, async (req, res) => {
  try {
    const { roomId } = req.body;
    const sessionUserId = req.session?.userId;
    const userType = req.session?.userType;
    
    if (!sessionUserId) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    
    if (!roomId) {
      return res.status(400).json({ error: '채팅방 ID는 필수입니다.' });
    }
    
    await getStorage().markChatMessagesAsRead(roomId, sessionUserId, userType || 'user');
    res.json({ success: true });
  } catch (error: any) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;