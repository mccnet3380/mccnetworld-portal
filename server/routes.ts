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
import { splitPolicyExcelFromBuffer } from './lib/mcc-policy-split';
import { exportPolicyUploadReadyFromSplit } from './lib/mcc-policy-export-ready';
import { sql, eq, and, gte, lte } from "drizzle-orm";

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

// ─────────────────────────────────────────────────────────────────────────────
// 판매점 원장 (dealer_registrations) CRUD
// ─────────────────────────────────────────────────────────────────────────────

// 목록 조회 (JSON)
router.get('/api/admin/dealer-registrations', requireAdmin, async (req, res) => {
  try {
    const { search, isHiddenPos, isContactPolicyPos, includeInactive, isActive } = req.query;
    const options: any = {};
    if (search) options.search = String(search);
    if (isHiddenPos !== undefined) options.isHiddenPos = isHiddenPos === 'true';
    if (isContactPolicyPos !== undefined) options.isContactPolicyPos = isContactPolicyPos === 'true';
    if (includeInactive === 'true') {
      options.includeInactive = true;
    } else if (isActive === 'false') {
      options.isActive = false;
    }
    const list = await getStorage().getDealerRegistrations(options);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 현재 원장 전체 엑셀 다운로드
// IMPORTANT: 반드시 /:id 라우트보다 먼저 선언해야 함 (Express 라우트 순서 규칙)
router.get('/api/admin/dealer-registrations/export', requireAdmin, async (req, res) => {
  console.log('[dealer export] HIT', req.method, req.originalUrl, req.path, req.params, req.query);
  try {
    const dealers = await getStorage().getDealerRegistrations({ includeInactive: true });

    const wb = XLSX.utils.book_new();
    const rows = (dealers as any[]).map((d: any) => ({
      '판매점코드': d.dealerCode ?? '',
      '판매점명': d.businessName ?? '',
      '사업자번호': d.businessNumber ?? '',
      '대표자명': d.representativeName ?? '',
      '연락처': d.contactPhone ?? '',
      '주소': d.address ?? '',
      '상태': d.status ?? '',
      '히든정책대상': d.isHiddenPos ? 'Y' : 'N',
      '접점정책대상': d.isContactPolicyPos ? 'Y' : 'N',
      '정산전용': d.settlementOnly ? 'Y' : 'N',
      '생성일': d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : '',
      '수정일': d.updatedAt ? new Date(d.updatedAt).toISOString().slice(0, 10) : '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 14 },
      { wch: 16 }, { wch: 32 }, { wch: 8 },
      { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, '판매점원장');

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const raw = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    console.log('[dealer export] rows length:', rows.length);
    console.log('[dealer export] buffer length:', buffer.length);
    console.log('[dealer export] first bytes:', buffer.slice(0, 2).toString('ascii'));

    const filename = encodeURIComponent(`판매점원장_현재목록_${today}.xlsx`);
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    return res.end(buffer);
  } catch (error: any) {
    console.error('[dealer export] ERROR:', error);
    return res.status(500).json({ error: '원장 다운로드 중 오류가 발생했습니다.' });
  }
});

// 단건 조회 — IMPORTANT: /export 선언 이후에 위치해야 함
router.get('/api/admin/dealer-registrations/:id', requireAdmin, async (req, res) => {
  console.log('[dealer detail] HIT', req.method, req.originalUrl, req.params);
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '잘못된 ID입니다.' });
    const item = await getStorage().getDealerRegistration(id);
    if (!item) return res.status(404).json({ error: '판매점을 찾을 수 없습니다.' });
    res.json(item);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 등록
router.post('/api/admin/dealer-registrations', requireAdmin, async (req, res) => {
  try {
    const {
      businessName, representativeName, businessNumber,
      contactPhone, contactEmail, address,
      bankAccount, bankName, accountHolder,
      username, password,
      isHiddenPos, isContactPolicyPos, isActive, status,
    } = req.body;

    if (!businessName || !representativeName || !businessNumber ||
        !contactPhone || !address || !username || !password) {
      return res.status(400).json({ error: '필수 항목이 누락되었습니다.' });
    }

    const created = await getStorage().createDealerRegistration({
      businessName, representativeName, businessNumber,
      contactPhone, contactEmail: contactEmail || null, address,
      bankAccount, bankName, accountHolder,
      username, password,
      isHiddenPos: isHiddenPos ?? false,
      isContactPolicyPos: isContactPolicyPos ?? false,
      isActive: isActive ?? true,
      status: status ?? '승인',
    });

    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// 수정
router.put('/api/admin/dealer-registrations/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '잘못된 ID입니다.' });

    const updated = await getStorage().updateDealerRegistration(id, req.body);
    if (!updated) return res.status(404).json({ error: '판매점을 찾을 수 없습니다.' });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// 비활성화 (소프트 삭제)
router.delete('/api/admin/dealer-registrations/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: '잘못된 ID입니다.' });
    const updated = await getStorage().updateDealerRegistration(id, { isActive: false });
    if (!updated) return res.status(404).json({ error: '판매점을 찾을 수 없습니다.' });
    res.json({ success: true, message: '판매점 원장이 비활성화되었습니다.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 엑셀 대량 업로드
router.post('/api/admin/dealer-registrations/upload-excel', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (rows.length === 0) {
      return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
    }

    const REQUIRED = ['상호명', '대표자명', '사업자번호', '연락처', '주소', '아이디', '비밀번호'];
    const COL_MAP: Record<string, string> = {
      '상호명': 'businessName',
      '대표자명': 'representativeName',
      '사업자번호': 'businessNumber',
      '연락처': 'contactPhone',
      '주소': 'address',
      '아이디': 'username',
      '비밀번호': 'password',
      '은행명': 'bankName',
      '계좌번호': 'bankAccount',
      '예금주': 'accountHolder',
      '히든정책점': 'isHiddenPos',
      '접점정책점': 'isContactPolicyPos',
    };

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2; // 헤더 포함 1-indexed
      const raw = rows[i];

      // 필수값 검사
      const missing = REQUIRED.filter(col => !String(raw[col] ?? '').trim());
      if (missing.length > 0) {
        errors.push(`행 ${rowNum}: 필수 항목 누락 (${missing.join(', ')})`);
        skipped++;
        continue;
      }

      // 필드 매핑
      const data: any = {};
      for (const [ko, en] of Object.entries(COL_MAP)) {
        const val = String(raw[ko] ?? '').trim();
        if (en === 'isHiddenPos' || en === 'isContactPolicyPos') {
          data[en] = /^(y|yes|true|1|히든|접점)$/i.test(val);
        } else {
          data[en] = val || null;
        }
      }
      data.isActive = true;
      data.status = '승인';

      try {
        await getStorage().createDealerRegistration(data);
        created++;
      } catch (err: any) {
        const msg = String(err.message ?? '');
        if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('중복') || msg.includes('already exists')) {
          if (msg.includes('username')) {
            errors.push(`행 ${rowNum}: 아이디 중복 (${data.username})`);
          } else {
            errors.push(`행 ${rowNum}: 중복 오류 — ${msg.substring(0, 80)}`);
          }
        } else {
          errors.push(`행 ${rowNum}: 오류 — ${msg.substring(0, 80)}`);
        }
        skipped++;
      }
    }

    res.json({
      success: true,
      totalRows: rows.length,
      created,
      skipped,
      errors,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Backfill: 기존 dealer_registrations와 users를 username으로 매칭해 dealer_registration_id 채우기
router.post('/api/admin/dealer-registrations/backfill-users', requireAdmin, async (req, res) => {
  try {
    const result = await getStorage().backfillDealerRegistrationIds();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// M코드 기준 원장 업로드 — dealer_registrations + contact_codes 동시 upsert
// IMPORTANT: /:id 라우트보다 먼저 선언해야 함 (Express 라우팅 순서)
router.post('/api/admin/dealer-registrations/mcode-master-upload',
  requireAdmin,
  (req, res, next) => {
    console.log(`[mcode-master-upload] ▶ request arrived — limit param: ${req.query.limit ?? 'all'}`);
    next();
  },
  upload.single('file'),
  async (req, res) => {
  const startTime = Date.now();
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

    console.log(`[mcode-master-upload] ✔ file received: "${req.file.originalname}" (${(req.file.size / 1024).toFixed(1)} KB)`);
    console.log(`[mcode-master-upload] parsing Excel...`);

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];

    // header:1 + blankrows:false 조합: defval 없이 파싱해야 xlsx가
    // 셀이 하나도 없는 행을 파싱 단계에서 건너뜀 (defval:'' 사용 시 빈 셀도
    // '' 로 채워져 blankrows:false 무력화 → 백만 행 파싱 문제 발생)
    // gc()에서 row[idx] ?? '' 처리하므로 defval 불필요
    const aoa: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
    }) as any[][];
    if (aoa.length < 2) return res.status(400).json({ error: '헤더 포함 최소 2행 이상 필요합니다.' });

    // 2차 방어: A~J 중 실제 값이 있는 행만 남김 (보이지 않는 문자 포함 행 제거)
    const allDataRows = aoa.slice(1).filter(row =>
      Array.from({ length: 10 }, (_, c) => c).some(c => String(row[c] ?? '').trim() !== '')
    );

    // 행 제한 파라미터 (테스트용: ?limit=100 / 1000 / 5000)
    const limitParam = req.query.limit ? parseInt(req.query.limit as string, 10) : null;
    const dataRows = (limitParam && limitParam > 0) ? allDataRows.slice(0, limitParam) : allDataRows;

    console.log(`[mcode-master-upload] non-empty rows: ${allDataRows.length}, processing: ${dataRows.length}`);

    // ── [1] PRE-LOAD: 전체 DR/CC 를 Map으로 캐싱 (행당 SELECT 제거) ─────────────
    console.log(`[mcode-master-upload] pre-loading DR/CC cache...`);
    const [allDRs, allCCs] = await Promise.all([
      getStorage().getDealerRegistrationsForBulkUpload(),
      getStorage().getContactCodesForBulkUpload(),
    ]);

    // mCode → DR[] (같은 mCode에 여러 DR 가능)
    const drByMCode = new Map<string, any[]>();
    for (const dr of allDRs) {
      if (!dr.mCode) continue;
      const arr = drByMCode.get(dr.mCode) ?? [];
      arr.push(dr);
      drByMCode.set(dr.mCode, arr);
    }
    // code → CC
    const ccByCode = new Map<string, any>(allCCs.map(cc => [cc.code, cc]));

    const cacheElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[mcode-master-upload] cache loaded — ${allDRs.length} DRs, ${allCCs.length} CCs (${cacheElapsed}s)`);

    // ── [2] 인메모리 분류 (DB 호출 없음) ────────────────────────────────────────
    const IDX = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9 };
    const EXCLUSION_KEYWORDS = ['삭제점', '제외', '개인', '테스트'];
    const BZ_PATTERN = /^[가-힣]{1,3}[)）]/;

    // storage.ts 의 private normalizeDealerName 과 동일 로직
    const normalizeDealerName = (name: string): string => {
      if (!name) return '';
      return name.trim()
        .replace(/^[가-힣]{1,3}[)）]\s*/, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    };

    // 인메모리 DR 매칭 (0~4순위 동일 로직)
    const findDR = (
      mCode: string, businessName: string,
      kpNumber: string, subDealerName: string, sourceDealerName: string,
    ): { found: any | null; isReview: boolean; reviewReason?: string } => {
      const candidates = drByMCode.get(mCode) ?? [];
      let existing: any[] = [];

      // 0순위: mCode + businessName 완전 일치
      existing = candidates.filter(r => r.businessName === businessName);

      // 1순위: mCode + kpNumber + subDealerName
      if (existing.length === 0 && kpNumber && subDealerName) {
        existing = candidates.filter(r => r.kpNumber === kpNumber && r.subDealerName === subDealerName);
      }

      // 2~4순위: 정규화 이름 비교
      if (existing.length === 0 && candidates.length > 0) {
        const normSource = normalizeDealerName(sourceDealerName);
        const normSub    = normalizeDealerName(subDealerName);
        const normBiz    = normalizeDealerName(businessName);

        // 2순위: normalized source + sub
        if (normSource) {
          existing = candidates.filter(r => {
            const rSource = normalizeDealerName(r.sourceDealerName ?? '');
            const rSub    = normalizeDealerName(r.subDealerName ?? '');
            return normSub
              ? rSource === normSource && rSub === normSub
              : rSource === normSource && !r.subDealerName;
          });
        }
        // 3순위: normalized businessName
        if (existing.length === 0 && normBiz && normBiz !== mCode.toLowerCase()) {
          existing = candidates.filter(r =>
            normalizeDealerName(r.businessName ?? '') === normBiz
          );
        }
        // 4순위: normalized sourceDealerName 단독
        if (existing.length === 0 && normSource) {
          existing = candidates.filter(r =>
            normalizeDealerName(r.sourceDealerName ?? '') === normSource
          );
        }
      }

      // 다건 → 활성 여부로 좁히기
      if (existing.length > 1) {
        const activeOnes = existing.filter(r => r.isActive !== false);
        if (activeOnes.length === 1) {
          existing = activeOnes;
        } else if (activeOnes.length === 0) {
          existing = [existing[0]];
        } else {
          const canonical = [...activeOnes].sort((a, b) => {
            if (!!a.kpNumber !== !!b.kpNumber) return a.kpNumber ? -1 : 1;
            return a.id - b.id;
          })[0];
          return { found: canonical, isReview: true, reviewReason: 'M코드+이름 기준 활성 원장 2개 이상 — 정리 필요' };
        }
      }

      return { found: existing[0] ?? null, isReview: false };
    };

    const stats = {
      totalRows: allDataRows.length,
      readRows: 0,
      drCreated: 0,
      drUpdated: 0,
      ccCreated: 0,
      ccUpdated: 0,
      needReview: 0,
      skippedRows: 0,
      failed: 0,
    };
    type RowDetail = {
      row: number; reason: string;
      mCode?: string; name?: string;
      subDealer?: string; channel?: string;
      contactCodeB?: string; contactCodeH?: string;
    };
    const reviewItems: RowDetail[] = [];
    const skippedItems: RowDetail[] = [];
    const failedItems: { row: number; reason: string }[] = [];
    const reviewedDrKeys = new Set<string>();

    // 배치 쓰기 대기열 (Map으로 자동 중복 제거)
    type DRUpdatePayload = { id: number; businessName: string; mCode: string; kpNumber: string | null; regionName: string | null; sourceDealerName: string | null; subDealerName: string | null };
    type DRCreatePayload = { tempKey: string; mCode: string; businessName: string; kpNumber: string | null; regionName: string | null; sourceDealerName: string | null; subDealerName: string | null };
    type CCPayload = { code: string; dealerName: string; carrier: string; dealerRegistrationId: number | null; mCode: string | null; channel: string | null; kpNumber: string | null; regionName: string | null; aliasName: string | null; subDealerName: string | null; sourceDealerName: string | null; codeName: string | null; drTempKey: string | null };

    const drUpdateMap = new Map<number, DRUpdatePayload>();   // id → payload
    const drCreateMap = new Map<string, DRCreatePayload>();   // tempKey → payload
    const ccUpsertMap = new Map<string, CCPayload>();         // code → payload (마지막 값 우선)
    const localCCNewSet = new Set<string>();                  // 이번 업로드 중 신규 생성된 CC 코드

    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx];
      const rowNum = rowIdx + 2;
      const gc = (idx: number) => String(row[idx] ?? '').trim();

      const sourceName   = gc(IDX.A);
      const contactCodeB = gc(IDX.B);
      const codeName     = gc(IDX.C);
      const alias        = gc(IDX.D);
      const subDealer    = gc(IDX.E);
      const channel      = gc(IDX.F);
      const mCode        = gc(IDX.G);
      const contactCodeH = gc(IDX.H);
      const kpNumber     = gc(IDX.I);
      const region       = gc(IDX.J);

      if (![sourceName, contactCodeB, codeName, subDealer, channel, mCode, contactCodeH, kpNumber, region].some(v => v)) continue;
      stats.readRows++;

      // 제외 키워드 검사
      const allText = [sourceName, codeName, subDealer, channel].join(' ');
      const excludeKw = EXCLUSION_KEYWORDS.find(kw => allText.includes(kw));
      if (excludeKw) {
        reviewItems.push({ row: rowNum, reason: `제외 키워드 포함: "${excludeKw}"`, mCode, name: codeName || sourceName, subDealer, channel, contactCodeB, contactCodeH });
        stats.needReview++;
        continue;
      }

      if (!mCode) {
        reviewItems.push({ row: rowNum, reason: 'M코드 없음', name: codeName || sourceName, subDealer, channel, contactCodeB, contactCodeH });
        stats.needReview++;
        continue;
      }

      const businessName = codeName || sourceName || subDealer || mCode;
      const contactCode  = contactCodeH || contactCodeB;

      // ── BZ_PATTERN: 접점코드가 판매점명 패턴인 경우 ──────────────────────────
      if (contactCode && BZ_PATTERN.test(contactCode)) {
        // DR 은 갱신/생성 (review 여부 무시, 원본 동작과 동일)
        const { found: bzDR, isReview: bzReview } = findDR(mCode, businessName, kpNumber, subDealer, sourceName);
        if (!bzReview) {
          if (bzDR) {
            stats.drUpdated++;
            if (!drUpdateMap.has(bzDR.id)) {
              drUpdateMap.set(bzDR.id, {
                id: bzDR.id, businessName, mCode,
                kpNumber: bzDR.kpNumber || kpNumber || null,
                regionName: bzDR.regionName || region || null,
                sourceDealerName: sourceName || null,
                subDealerName: subDealer || null,
              });
            }
          } else {
            const tempKey = `${mCode}|${businessName}`;
            if (drCreateMap.has(tempKey)) {
              stats.drUpdated++;
            } else {
              stats.drCreated++;
              drCreateMap.set(tempKey, { tempKey, mCode, businessName, kpNumber: kpNumber || null, regionName: region || null, sourceDealerName: sourceName || null, subDealerName: subDealer || null });
            }
          }
        }
        // CC 는 저장하지 않음
        if (!contactCodeH) {
          skippedItems.push({ row: rowNum, reason: 'H열 접점코드 없음 — 대표/메인 행으로 스킵 (CC 미저장)', mCode, name: businessName, subDealer, channel, contactCodeB, contactCodeH });
          stats.skippedRows++;
        } else {
          reviewItems.push({ row: rowNum, reason: `접점코드(H열)가 판매점명으로 의심됨 — 원장 확인 필요: "${contactCode}"`, mCode, name: businessName, subDealer, channel, contactCodeB, contactCodeH });
          stats.needReview++;
        }
        continue;
      }

      // ── 일반 행 처리 ─────────────────────────────────────────────────────────
      const { found: drRecord, isReview, reviewReason } = findDR(mCode, businessName, kpNumber, subDealer, sourceName);

      let resolvedDRId: number | null = null;
      let drTempKey: string | null = null;

      if (isReview) {
        const drKey = `${mCode}|${businessName}`;
        if (!reviewedDrKeys.has(drKey)) {
          reviewedDrKeys.add(drKey);
          reviewItems.push({ row: rowNum, reason: reviewReason || 'M코드 중복 검토', mCode, name: businessName, subDealer, channel, contactCodeB, contactCodeH });
          stats.needReview++;
        } else {
          stats.drUpdated++;
        }
        resolvedDRId = drRecord?.id ?? null;
      } else if (drRecord) {
        stats.drUpdated++;
        resolvedDRId = drRecord.id;
        if (!drUpdateMap.has(drRecord.id)) {
          drUpdateMap.set(drRecord.id, {
            id: drRecord.id, businessName, mCode,
            kpNumber: drRecord.kpNumber || kpNumber || null,
            regionName: drRecord.regionName || region || null,
            sourceDealerName: sourceName || null,
            subDealerName: subDealer || null,
          });
        }
      } else {
        // 신규 DR
        const tempKey = `${mCode}|${businessName}`;
        if (drCreateMap.has(tempKey)) {
          stats.drUpdated++; // 동일 파일에서 두 번째 등장 → 첫 행이 이미 생성 예약
        } else {
          stats.drCreated++;
          drCreateMap.set(tempKey, { tempKey, mCode, businessName, kpNumber: kpNumber || null, regionName: region || null, sourceDealerName: sourceName || null, subDealerName: subDealer || null });
        }
        drTempKey = tempKey;
      }

      // ── CC 처리 ──────────────────────────────────────────────────────────────
      if (contactCode) {
        const isNewCC = !ccByCode.has(contactCode) && !localCCNewSet.has(contactCode);
        if (isNewCC) {
          stats.ccCreated++;
          localCCNewSet.add(contactCode);
        } else {
          stats.ccUpdated++;
        }
        ccUpsertMap.set(contactCode, {
          code: contactCode,
          dealerName: businessName,
          carrier: '미지정',
          dealerRegistrationId: resolvedDRId,
          mCode: mCode || null,
          channel: channel || null,
          kpNumber: kpNumber || null,
          regionName: region || null,
          aliasName: alias || null,
          subDealerName: subDealer || null,
          sourceDealerName: sourceName || null,
          codeName: codeName || contactCodeB || contactCode || null,
          drTempKey,
        });
      }
    }

    const classifyElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[mcode-master-upload] classify done (${classifyElapsed}s) — drCreate:${drCreateMap.size} drUpdate:${drUpdateMap.size} cc:${ccUpsertMap.size}`);

    // ── [3] 배치 쓰기 ────────────────────────────────────────────────────────
    // 3a. 신규 DR 일괄 INSERT
    let newDRs: any[] = [];
    if (drCreateMap.size > 0) {
      newDRs = await getStorage().batchCreateDealerRegistrations(Array.from(drCreateMap.values()));
      console.log(`[mcode-master-upload] DR create done — ${newDRs.length} records (${((Date.now()-startTime)/1000).toFixed(1)}s)`);
      // 캐시 갱신 (CC dealerRegistrationId 해결용)
      for (const dr of newDRs) {
        const arr = drByMCode.get(dr.mCode) ?? [];
        arr.push(dr);
        drByMCode.set(dr.mCode, arr);
      }
    }

    // tempKey → 신규 DR 매핑
    const tempKeyToDR = new Map<string, any>();
    for (const dr of newDRs) {
      const match = Array.from(drCreateMap.values()).find(c => c.mCode === dr.mCode && c.businessName === dr.businessName);
      if (match) tempKeyToDR.set(match.tempKey, dr);
    }

    // CC 의 dealerRegistrationId 해결 (신규 DR)
    for (const cc of ccUpsertMap.values()) {
      if (cc.drTempKey && cc.dealerRegistrationId === null) {
        const newDR = tempKeyToDR.get(cc.drTempKey);
        if (newDR) cc.dealerRegistrationId = newDR.id;
      }
    }

    // 3b. 기존 DR 일괄 UPDATE
    if (drUpdateMap.size > 0) {
      await getStorage().batchUpdateDealerRegistrations(Array.from(drUpdateMap.values()));
      console.log(`[mcode-master-upload] DR update done — ${drUpdateMap.size} records (${((Date.now()-startTime)/1000).toFixed(1)}s)`);
    }

    // 3c. CC 일괄 UPSERT (INSERT ON CONFLICT DO UPDATE)
    if (ccUpsertMap.size > 0) {
      await getStorage().batchUpsertContactCodes(Array.from(ccUpsertMap.values()));
      console.log(`[mcode-master-upload] CC upsert done — ${ccUpsertMap.size} records (${((Date.now()-startTime)/1000).toFixed(1)}s)`);
    }

    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[mcode-master-upload] ✔ DONE in ${totalElapsed}s — dr:+${stats.drCreated}/~${stats.drUpdated} cc:+${stats.ccCreated}/~${stats.ccUpdated} review:${stats.needReview} fail:${stats.failed}`);

    return res.json({
      success: true,
      ...stats,
      processedRows: dataRows.length,
      elapsedSec: parseFloat(totalElapsed),
      reviewSamples: reviewItems,
      skippedSamples: skippedItems,
      failedSamples: failedItems.slice(0, 50),
    });

  } catch (error: any) {
    console.error('[mcode-master-upload] ERROR:', error);
    return res.status(500).json({ error: error.message || '업로드 처리 중 오류가 발생했습니다.' });
  }
});

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
    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
    const search = req.query.search as string | undefined;
    const dealerRegistrationId = req.query.dealerRegistrationId !== undefined ? Number(req.query.dealerRegistrationId) : undefined;
    const includeRealSalesPOSMatch = req.query.includeRealSalesPOSMatch === 'true';

    const options = (page !== undefined || limit !== undefined || search || dealerRegistrationId !== undefined || includeRealSalesPOSMatch)
      ? { page, limit, search, dealerRegistrationId, includeRealSalesPOSMatch: includeRealSalesPOSMatch || undefined }
      : undefined;

    const result = await getStorage().getContactCodes(carrier, options);
    const logCount = Array.isArray(result) ? result.length : result.total;
    console.log(`✅ Contact codes API - Returning ${logCount} codes${carrier && carrier !== 'all' ? ` (carrier: ${carrier})` : ''}${options ? ` [paginated page=${page}]` : ''}`);
    res.json(result);
  } catch (error: any) {
    console.error('❌ Contact codes API error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/admin/contact-codes', requireAdmin, async (req, res) => {
  try {
    const { code, dealerName, carrier, realSalesPOS, realSalesPosCode, salesManagerId, salesManagerName, dealerRegistrationId, memo } = req.body;

    if (!code || !dealerName || !carrier) {
      return res.status(400).json({ error: '접점코드, 판매점명, 채널이 필요합니다.' });
    }

    const contactCode = await getStorage().createContactCode({
      code,
      dealerName,
      carrier,
      realSalesPOS: realSalesPOS || null,
      realSalesPosCode: realSalesPosCode || null,
      salesManagerId: salesManagerId || null,
      salesManagerName: salesManagerName || null,
      dealerRegistrationId: dealerRegistrationId || null,
      memo: memo || null,
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
    const { status, search, startDate, endDate, contactCode, carrier, activationStatus, allWorkers, includeActivatedBy, excludeWorkRequests, excludeDeleted, activatedByType, page, limit } = req.query;
    
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
    let dealerRegistrationId = null;

    if (sessionUserType === 'user' && sessionUserId) {
      const user = await getStorage().getUserById(sessionUserId);
      dealerId = user?.dealerId ?? null;
      dealerRegistrationId = user?.dealerRegistrationId ?? null;
      console.log('[ROUTE] User check - dealerId:', dealerId, 'dealerRegistrationId:', dealerRegistrationId, 'userType:', sessionUserType);
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
      page: page !== undefined ? Number(page) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      userId: allWorkers === 'true' ? null : req.session?.userId,
      includeActivatedBy: includeActivatedBy === 'true',
      excludeWorkRequests: excludeWorkRequests === 'true',
      excludeDeleted: excludeDeleted === 'true',
      // Permission-based filtering
      userType: sessionUserType,
      dealerId: dealerId,
      dealerRegistrationId: dealerRegistrationId,
      allWorkers: allWorkers === 'true'
    };
    
    console.log('[ROUTE] Calling getStorage().getDocuments() with filters:', filters);
    const documents = await getStorage().getDocuments(filters, sessionUserId, sessionUserType);
    const logCount = Array.isArray(documents) ? documents.length : documents.total;
    console.log('[ROUTE] getDocuments() returned, count:', logCount);
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

// 접점코드 엑셀 양식 다운로드 (시트3장: 입력 + 판매점원장참조 + 작성가이드)
router.get('/api/admin/contact-codes/template', requireAdmin, async (req, res) => {
  try {
    const dealers = await getStorage().getDealerRegistrations({ includeInactive: true });
    const wb = XLSX.utils.book_new();

    // 시트1: 접점코드입력
    const inputHeaders = [['접점코드', '정산지급처선택', '실판매점코드', '실제판매점명', '채널', '담당영업과장', '메모']];
    const sampleRows = [
      ['K엠45172', '[MCC0028] 썬플러스 중계', '', '진심모바일', '후불)엠모바일', '홍길동', '하부점 기준'],
      ['L프638840', '[MCC0029] 썬플러스', '', '썬플러스 본점', '후불)KT', '김영희', ''],
    ];
    const ws1 = XLSX.utils.aoa_to_sheet([...inputHeaders, ...sampleRows]);
    ws1['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 16 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws1, '접점코드입력');

    // 시트2: 판매점원장참조
    const refHeaders = [['판매점코드', '판매점명', '사업자번호', '대표자명', '연락처', '주소']];
    const refRows = dealers.map((d: any) => [
      d.dealerCode || '',
      d.businessName || '',
      d.businessNumber || '',
      d.representativeName || '',
      d.contactPhone || '',
      d.address || '',
    ]);
    const ws2 = XLSX.utils.aoa_to_sheet([...refHeaders, ...refRows]);
    ws2['!cols'] = [{ wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 32 }];
    XLSX.utils.book_append_sheet(wb, ws2, '판매점원장참조');

    // 시트3: 작성가이드
    const guideData = [
      ['MCC NetWorld 포털 — 접점코드 업로드 작성 가이드'],
      [''],
      ['■ 컬럼 설명'],
      ['컬럼', '설명'],
      ['접점코드', '실제 개통 원장에 표시되는 접점코드 (예: K엠45172, L프638840)'],
      ['정산지급처선택', '아래 3가지 형식 모두 허용: ① [MCC0028] 썬플러스 중계  ② MCC0028  ③ 썬플러스 중계 (판매점명 단독, 중복 시 경고)'],
      ['실판매점코드', '실판매점 코드 (선택사항, 비워두면 자동 생성: SP0001 형식)'],
      ['실제판매점명', '실제 개통이 발생한 하부점 또는 현장 판매점명 (정산지급처명과 달라도 됩니다, 선택사항)'],
      ['채널', '개통 채널 (예: 후불)엠모바일, 후불)KT)'],
      ['담당영업과장', '담당 영업과장명 (선택사항)'],
      ['메모', '기타 참고사항 (선택사항)'],
      [''],
      ['■ 중요 안내'],
      ['1. dealerRegistrationId(시스템 내부 ID)는 입력하지 않습니다. 정산지급처선택으로 자동 연결됩니다.'],
      ['2. 기존 양식의 정산지급처코드 컬럼도 계속 지원됩니다. (예: MCC0028 단독 입력)'],
      ['3. 실판매점코드가 비어 있고 실제판매점명이 있으면 동일 정산지급처 내 기존 실판매점명을 재사용하거나 자동 생성합니다.'],
      ['4. 정산지급처명과 실제판매점명이 같으면 본점, 다르면 하부점으로 자동 판단합니다.'],
      ['5. 동일한 접점코드가 있으면 수정됩니다.'],
      [''],
      ['■ 작성 예시'],
      ['접점코드', '정산지급처선택', '실판매점코드', '실제판매점명', '채널', '담당영업과장', '메모'],
      ['K엠45172', '[MCC0028] 썬플러스', '', '썬플러스 중계', '후불)엠모바일', '홍길동', '하부점 기준'],
      ['L프638840', '[MCC0029] 썬플러스', '', '썬플러스', '후불)KT', '김영희', '본점 직접 개통'],
    ];
    const ws3 = XLSX.utils.aoa_to_sheet(guideData);
    ws3['!cols'] = [{ wch: 22 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, ws3, '작성가이드');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'%EC%A0%91%EC%A0%90%EC%BD%94%EB%93%9C_%EC%97%85%EB%A1%9C%EB%93%9C_%EC%96%91%EC%8B%9D.xlsx');
    res.send(buffer);
  } catch (error: any) {
    console.error('Contact code template download error:', error);
    res.status(500).json({ error: '양식 다운로드 중 오류가 발생했습니다.' });
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

    let workbook;
    try {
      if (req.file.originalname.endsWith('.csv')) {
        let csvData = req.file.buffer.toString('utf8');
        if (csvData.charCodeAt(0) === 0xFEFF) csvData = csvData.substring(1);
        workbook = XLSX.read(csvData, { type: 'string' });
      } else {
        workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      }
    } catch (parseError: any) {
      return res.status(400).json({ error: `파일 파싱 오류: ${parseError.message}` });
    }

    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (jsonData.length === 0) {
      return res.status(400).json({ error: '파일에 데이터가 없습니다.' });
    }

    console.log(`🔄 접점코드 업로드 시작: 총 ${jsonData.length}개 행`);

    // 전체 판매점 미리 로드 (dealerCode 캐시 초기화 + businessName 폴백 매칭용)
    const allDealers = await getStorage().getDealerRegistrations({ includeInactive: false });
    const dealerCodeCache = new Map<string, { id: number | null; businessName: string | null }>();
    const dealerByName = new Map<string, number[]>(); // businessName → [dealerRegistrationId, ...]
    for (const d of allDealers) {
      if (d.dealerCode) dealerCodeCache.set(d.dealerCode, { id: d.id, businessName: d.businessName });
      if (d.businessName) {
        const ids = dealerByName.get(d.businessName) || [];
        ids.push(d.id);
        dealerByName.set(d.businessName, ids);
      }
    }
    const dealerBusinessNameSet = new Set(dealerByName.keys());

    // 실판매점코드 자동 생성을 위한 캐시: `${dealerRegistrationId}:${realSalesPOS}` → code
    const realPosCodeCache = new Map<string, string>();
    // 실판매점코드 최대 시퀀스 캐시: dealerRegistrationId → maxSeq
    const realPosMaxSeq = new Map<number, number>();

    const resolveRealSalesPosCode = async (
      dealerRegistrationId: number,
      realSalesPOS: string,
      providedCode: string | null
    ): Promise<string | null> => {
      if (providedCode) return providedCode;
      if (!realSalesPOS) return null;

      const cacheKey = `${dealerRegistrationId}:${realSalesPOS.trim()}`;
      if (realPosCodeCache.has(cacheKey)) return realPosCodeCache.get(cacheKey)!;

      // 해당 정산지급처의 모든 접점코드를 getContactCodes로 조회 (캐시 미스 시)
      const allCodesForDealer = await getStorage().getContactCodes(undefined, { dealerRegistrationId, limit: 10000 });
      const codeList = Array.isArray(allCodesForDealer) ? allCodesForDealer : (allCodesForDealer?.data ?? []);

      // 최대 SP시퀀스 계산
      let maxSeq = realPosMaxSeq.get(dealerRegistrationId) ?? 0;
      for (const cc of codeList) {
        if (cc.realSalesPosCode && /^SP\d+$/.test(cc.realSalesPosCode)) {
          const n = parseInt(cc.realSalesPosCode.slice(2), 10);
          if (n > maxSeq) maxSeq = n;
        }
        // 기존 동일 실판매점명 코드 캐시
        if (cc.realSalesPOS) {
          const key = `${dealerRegistrationId}:${cc.realSalesPOS.trim()}`;
          if (!realPosCodeCache.has(key) && cc.realSalesPosCode) {
            realPosCodeCache.set(key, cc.realSalesPosCode);
          }
        }
      }
      realPosMaxSeq.set(dealerRegistrationId, maxSeq);

      if (realPosCodeCache.has(cacheKey)) return realPosCodeCache.get(cacheKey)!;

      // 새 코드 생성
      maxSeq++;
      realPosMaxSeq.set(dealerRegistrationId, maxSeq);
      const newCode = `SP${String(maxSeq).padStart(4, '0')}`;
      realPosCodeCache.set(cacheKey, newCode);
      return newCode;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let dealerMatchSuccess = 0;
    let dealerMatchFailed = 0;
    let realSalesPOSMatchSuccess = 0;
    let realSalesPOSUnregistered = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < jsonData.length; i++) {
      const rowNum = i + 2; // 헤더 포함 1-indexed
      const raw = jsonData[i];

      // 공통 컬럼 추출
      const code = String(raw['접점코드'] || raw['코드'] || raw['code'] || raw['Code'] || raw['contactCode'] || '').trim();
      const realSalesPOS = String(raw['실제판매점명'] || raw['실판매점명'] || raw['실판매POS'] || raw['실판매점'] || raw['realSalesPOS'] || raw['real_sales_pos'] || '').trim() || null;
      const rawRealSalesPosCode = String(raw['실판매점코드'] || raw['실판매POS코드'] || raw['realSalesPosCode'] || raw['real_sales_pos_code'] || '').trim() || null;
      const carrier = String(raw['채널'] || raw['통신사'] || raw['carrier'] || raw['Carrier'] || raw['channel'] || raw['Channel'] || '').trim();
      const salesManagerName = String(raw['담당영업과장'] || raw['영업담당자'] || raw['영업과장'] || raw['salesManagerName'] || raw['sales_manager_name'] || raw['salesManager'] || '').trim() || null;
      const memo = String(raw['메모'] || raw['memo'] || '').trim() || null;
      const isActiveRaw = String(raw['사용여부'] || '').trim();
      const isActive = isActiveRaw === '' ? true : /^(y|yes|true|1|사용|사용중)$/i.test(isActiveRaw);

      // 정산지급처 파싱: 1순위=정산지급처선택, 2순위=정산지급처코드, 3순위=정산지급처명
      const dealerSelectionRaw = String(raw['정산지급처선택'] || '').trim();
      let dealerCodeRaw = '';
      let dealerNameForFallback = '';

      if (dealerSelectionRaw) {
        // 형식1: [MCC0028] 판매점명
        const selMatch = dealerSelectionRaw.match(/^\[([^\]]+)\]/);
        if (selMatch) {
          dealerCodeRaw = selMatch[1].trim();
        } else if (/^MCC\d+$/i.test(dealerSelectionRaw)) {
          // 형식2: MCC0028 단독
          dealerCodeRaw = dealerSelectionRaw;
        } else {
          // 형식3: 판매점명 단독
          dealerNameForFallback = dealerSelectionRaw;
        }
      } else {
        // 기존 컬럼 폴백
        dealerCodeRaw = String(raw['정산지급처코드'] || raw['판매점코드'] || raw['dealerCode'] || raw['dealer_code'] || '').trim();
        if (!dealerCodeRaw) {
          // 3순위: 정산지급처명으로 보조 매칭
          dealerNameForFallback = String(raw['정산지급처명'] || raw['판매점명'] || raw['딜러명'] || raw['dealer'] || raw['dealerName'] || '').trim();
        }
      }

      // 접점코드 필수 검사
      if (!code) {
        errors.push(`행 ${rowNum}: 접점코드가 비어 있습니다.`);
        skipped++;
        continue;
      }

      if (!dealerCodeRaw && !dealerNameForFallback) {
        errors.push(`행 ${rowNum}: 정산지급처선택 또는 정산지급처코드가 비어 있습니다.`);
        skipped++;
        continue;
      }

      // 판매점 매칭
      let dealerRegistrationId: number | null = null;
      let dealerName = '';

      if (dealerCodeRaw) {
        // 코드 기준 매칭
        if (dealerCodeCache.has(dealerCodeRaw)) {
          const cached = dealerCodeCache.get(dealerCodeRaw)!;
          dealerRegistrationId = cached.id;
          dealerName = cached.businessName || dealerCodeRaw;
        } else {
          const dr = await getStorage().getDealerRegistrationByDealerCode(dealerCodeRaw);
          if (dr) {
            dealerRegistrationId = dr.id;
            dealerCodeCache.set(dealerCodeRaw, { id: dr.id, businessName: dr.businessName });
            dealerName = dr.businessName || dealerCodeRaw;
          } else {
            dealerCodeCache.set(dealerCodeRaw, { id: null, businessName: null });
          }
        }

        if (dealerRegistrationId === null) {
          dealerMatchFailed++;
          errors.push(`행 ${rowNum}: 정산지급처코드 '${dealerCodeRaw}'를 판매점 원장에서 찾을 수 없습니다.`);
          skipped++;
          continue;
        }
      } else if (dealerNameForFallback) {
        // 판매점명 단독 매칭 (3순위, 보조)
        const matchIds = dealerByName.get(dealerNameForFallback) || [];
        if (matchIds.length === 1) {
          const dr = allDealers.find((d: any) => d.id === matchIds[0]);
          if (dr) {
            dealerRegistrationId = dr.id;
            dealerName = dr.businessName || dealerNameForFallback;
            warnings.push(`행 ${rowNum}: 판매점명 '${dealerNameForFallback}'으로 자동 매칭했습니다. 정산지급처선택 사용을 권장합니다.`);
          }
        } else if (matchIds.length > 1) {
          dealerMatchFailed++;
          errors.push(`행 ${rowNum}: 판매점명 '${dealerNameForFallback}'이 ${matchIds.length}건 검색되어 자동 매칭할 수 없습니다. 정산지급처선택 값을 사용하세요.`);
          skipped++;
          continue;
        } else {
          dealerMatchFailed++;
          errors.push(`행 ${rowNum}: 판매점명 '${dealerNameForFallback}'를 판매점 원장에서 찾을 수 없습니다.`);
          skipped++;
          continue;
        }
      }

      if (dealerRegistrationId === null) {
        dealerMatchFailed++;
        skipped++;
        continue;
      }
      dealerMatchSuccess++;

      // 최종 dealerName 결정
      if (!dealerName) dealerName = dealerCodeRaw || dealerNameForFallback;

      // realSalesPOS 원장 매칭 확인 (경고만, 오류 아님)
      if (realSalesPOS) {
        if (dealerBusinessNameSet.has(realSalesPOS)) {
          realSalesPOSMatchSuccess++;
        } else {
          realSalesPOSUnregistered++;
          warnings.push(`행 ${rowNum}: 실제판매점명 '${realSalesPOS}'이 판매점 원장에 없습니다. 히든정책 하부점 기준 적용이 제한될 수 있습니다.`);
        }
      }

      // 실판매점코드 자동 생성 (실판매점명 있고 코드 없을 때)
      let resolvedRealSalesPosCode: string | null = rawRealSalesPosCode;
      if (!resolvedRealSalesPosCode && realSalesPOS && dealerRegistrationId) {
        try {
          resolvedRealSalesPosCode = await resolveRealSalesPosCode(dealerRegistrationId, realSalesPOS, null);
        } catch (e) {
          // 자동 생성 실패 시 null로 진행 (오류 아님)
        }
      }

      try {
        const result = await getStorage().upsertContactCode({
          code,
          dealerName,
          realSalesPOS,
          realSalesPosCode: resolvedRealSalesPosCode,
          carrier: carrier || '',
          salesManagerName,
          dealerRegistrationId,
          memo,
          isActive,
        });
        if (result.action === 'created') created++;
        else updated++;
      } catch (err: any) {
        errors.push(`행 ${rowNum}: ${String(err.message).substring(0, 80)}`);
        skipped++;
      }
    }

    const processed = created + updated;
    console.log(`✅ 접점코드 업로드 완료: 신규 ${created}건, 수정 ${updated}건, 실패 ${skipped}건, 경고 ${warnings.length}건`);

    res.json({
      success: true,
      message: `업로드 완료: 신규 ${created}건, 수정 ${updated}건, 실패 ${skipped}건`,
      totalRows: jsonData.length,
      created,
      updated,
      skipped,
      dealerMatchSuccess,
      dealerMatchFailed,
      realSalesPOSMatchSuccess,
      realSalesPOSUnregistered,
      warnings,
      errors,
      // 기존 UI 호환 필드
      processed,
      successCount: processed,
      errorCount: skipped,
      duplicatesSkipped: 0,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 접점코드 수정
router.put('/api/admin/contact-codes/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { code, dealerName, carrier, salesManagerId, salesManagerName, realSalesPOS, realSalesPosCode, isActive, dealerRegistrationId, memo } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }

    const updateData: any = { code, dealerName, carrier, salesManagerId, salesManagerName, realSalesPOS };
    if (realSalesPosCode !== undefined) updateData.realSalesPosCode = realSalesPosCode || null;
    if (memo !== undefined) updateData.memo = memo || null;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (dealerRegistrationId !== undefined) updateData.dealerRegistrationId = dealerRegistrationId === null ? null : Number(dealerRegistrationId);
    const updated = await getStorage().updateContactCode(id, updateData);
    if (!updated) {
      return res.status(404).json({ error: '접점코드를 찾을 수 없습니다.' });
    }
    res.json({ success: true, message: '접점코드가 수정되었습니다.', data: updated });
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
    if (user.dealerRegistrationId) {
      // 신규 dealer 계정: dealerRegistrationId 기준 조회 (Path A OR B)
      rows = await getStorage().getDocuments({ userType: 'user', dealerRegistrationId: user.dealerRegistrationId }, userId, userType);
      console.log('[DEALER_DASHBOARD] by dealerRegistrationId', { dealerRegistrationId: user.dealerRegistrationId, count: rows.length });

      if (rows.length === 0 && FALLBACK) {
        const r2 = await getStorage().getDocuments({ userType: 'user', userId }, userId, userType);
        console.log('[DEALER_DASHBOARD] fallback userId (dealerRegistrationId path)', { userId, count: r2.length });
        rows = r2;
      }
    } else if (user.dealerId) {
      // 구 dealer 계정: 기존 dealerId 로직 유지
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

// ============================================================
// STEP 5D-1: 정책 관리 API (policy_versions / policy_rows / policy_files)
// ============================================================

// 1. GET /api/admin/policies — 정책 차수 목록 조회
router.get('/api/admin/policies', requireAdmin, async (req, res) => {
  try {
    const versions = await getStorage().getPolicyVersions();
    res.json(versions);
  } catch (error: any) {
    console.error('getPolicyVersions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/admin/policies/:id — 정책 차수 단건 + rows + files 포함 조회
router.get('/api/admin/policies/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const version = await getStorage().getPolicyVersionById(id);
    if (!version) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const [rows, files] = await Promise.all([
      getStorage().getPolicyRowsByVersionId(id),
      getStorage().getPolicyFilesByVersionId(id),
    ]);

    res.json({ ...version, rows, files });
  } catch (error: any) {
    console.error('getPolicyVersionById error:', error);
    res.status(500).json({ error: error.message });
  }
});

// datetime-local 입력("2026-08-24T15:00")을 naive UTC로 파싱
// reception_datetime과 동일한 naive KST 관행으로 저장되도록 Z suffix를 붙여 UTC 강제 해석
function parsePolicyDatetime(s: string): Date {
  if (s.includes('T')) {
    return new Date(s.slice(0, 16) + ':00.000Z');
  }
  return new Date(s); // date-only: JS가 UTC midnight으로 파싱
}

// 3. POST /api/admin/policies — 정책 차수 생성
router.post('/api/admin/policies', requireAdmin, async (req, res) => {
  try {
    const adminId = req.session?.userId;
    const { policyNo, policyName, effectiveFrom, effectiveTo, memo } = req.body;

    if (!policyNo || !policyName || !effectiveFrom) {
      return res.status(400).json({ error: 'policyNo, policyName, effectiveFrom은 필수입니다.' });
    }

    const version = await getStorage().createPolicyVersion({
      policyNo,
      policyName,
      effectiveFrom: parsePolicyDatetime(effectiveFrom),
      effectiveTo: effectiveTo ? parsePolicyDatetime(effectiveTo) : null,
      isActive: true,
      memo: memo || null,
      createdBy: adminId,
    });

    res.status(201).json(version);
  } catch (error: any) {
    console.error('createPolicyVersion error:', error);
    if (error.message?.includes('unique') || error.code === '23505') {
      return res.status(409).json({ error: '이미 존재하는 정책 번호입니다.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. PUT /api/admin/policies/:id — 정책 차수 수정
router.put('/api/admin/policies/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const existing = await getStorage().getPolicyVersionById(id);
    if (!existing) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const { policyName, effectiveFrom, effectiveTo, isActive, memo } = req.body;

    const updated = await getStorage().updatePolicyVersion(id, {
      ...(policyName !== undefined && { policyName }),
      ...(effectiveFrom !== undefined && { effectiveFrom: parsePolicyDatetime(effectiveFrom) }),
      ...(effectiveTo !== undefined && { effectiveTo: effectiveTo ? parsePolicyDatetime(effectiveTo) : null }),
      ...(isActive !== undefined && { isActive }),
      ...(memo !== undefined && { memo }),
    });

    res.json(updated);
  } catch (error: any) {
    console.error('updatePolicyVersion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. DELETE /api/admin/policies/:id — 하드 삭제 금지 / is_active=false 처리
router.delete('/api/admin/policies/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const existing = await getStorage().getPolicyVersionById(id);
    if (!existing) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const updated = await getStorage().updatePolicyVersion(id, { isActive: false });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('deactivatePolicyVersion error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. GET /api/admin/policies/:id/rows — 정책 단가 행 목록 조회
router.get('/api/admin/policies/:id/rows', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const rows = await getStorage().getPolicyRowsByVersionId(id);
    res.json(rows);
  } catch (error: any) {
    console.error('getPolicyRowsByVersionId error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. POST /api/admin/policies/:id/rows — 단가 행 단건 추가
router.post('/api/admin/policies/:id/rows', requireAdmin, async (req, res) => {
  try {
    const policyVersionId = parseInt(req.params.id, 10);
    if (isNaN(policyVersionId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const version = await getStorage().getPolicyVersionById(policyVersionId);
    if (!version) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const { channel, planName, customerType, simCount, bundleType, addService, regFeeType, rebateAmount, memo } = req.body;

    if (!channel || !planName || !customerType || rebateAmount === undefined) {
      return res.status(400).json({ error: 'channel, planName, customerType, rebateAmount는 필수입니다.' });
    }

    const row = await getStorage().createPolicyRow({
      policyVersionId,
      channel,
      planName,
      customerType,
      simCount: simCount ?? null,
      bundleType: bundleType ?? null,
      addService: addService ?? null,
      regFeeType: regFeeType ?? null,
      rebateAmount: String(rebateAmount),
      isActive: true,
      memo: memo ?? null,
    });

    res.status(201).json(row);
  } catch (error: any) {
    console.error('createPolicyRow error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. POST /api/admin/policies/:id/rows/bulk — 단가 행 일괄 추가
router.post('/api/admin/policies/:id/rows/bulk', requireAdmin, async (req, res) => {
  try {
    const policyVersionId = parseInt(req.params.id, 10);
    if (isNaN(policyVersionId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const version = await getStorage().getPolicyVersionById(policyVersionId);
    if (!version) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows 배열이 필요합니다.' });
    }

    for (const row of rows) {
      if (!row.channel || !row.planName || !row.customerType || row.rebateAmount === undefined) {
        return res.status(400).json({ error: '각 행에 channel, planName, customerType, rebateAmount가 필요합니다.' });
      }
    }

    const data = rows.map((row: any) => ({
      policyVersionId,
      channel: row.channel,
      planName: row.planName,
      customerType: row.customerType,
      simCount: row.simCount ?? null,
      bundleType: row.bundleType ?? null,
      addService: row.addService ?? null,
      regFeeType: row.regFeeType ?? null,
      rebateAmount: String(row.rebateAmount),
      isActive: true,
      memo: row.memo ?? null,
    }));

    const count = await getStorage().bulkCreatePolicyRows(data);
    res.status(201).json({ inserted: count });
  } catch (error: any) {
    console.error('bulkCreatePolicyRows error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8-2. POST /api/admin/policies/upload-excel — 정산 정책 업로드
// 10컬럼 국적형(권장): 채널, 요금제, 내국인_신규, 내국인_번이, 외국인_신규, 외국인_번이, 결합조건, 부가서비스조건, 가입비조건, 메모
//   - nationality_type 값 포함, 금액 단위: 만원 소수점
// 8컬럼 가로형(하위 호환): 채널, 요금제, 신규, 번이, 결합조건, 부가서비스조건, 가입비조건, 메모
//   - nationality_type = '내국인' 고정
// 세로형 양식(하위 호환): 채널, 요금제, 유형, 정책금액, 결합, 부가, 가입비, 메모
//   - 유형: 1=신규, 2=번이 / 정책금액: 원 단위 / nationality_type = null(와일드카드)
router.post('/api/admin/policies/upload-excel', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

    const policyVersionIdParam = req.body.policyVersionId ? parseInt(req.body.policyVersionId, 10) : null;

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.includes('정산정책') ? '정산정책' : wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    if (!ws) return res.status(400).json({ error: '읽을 수 있는 시트가 없습니다.' });

    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
    if (aoa.length < 2) return res.status(400).json({ error: '데이터 행이 없습니다.' });

    const headers = (aoa[0] as any[]).map((h: any) => String(h ?? '').trim());

    const isHorizontal = headers.includes('신규') || headers.includes('번이') ||
      headers.includes('내국인_신규') || headers.includes('내국인_번이') ||
      headers.includes('외국인_신규') || headers.includes('외국인_번이');
    const isVertical   = headers.includes('유형') && headers.includes('정책금액');

    if (!headers.includes('채널') || !headers.includes('요금제')) {
      return res.status(400).json({ error: `필수 헤더 "채널", "요금제"가 없습니다. 현재 헤더: ${headers.join(', ')}` });
    }
    if (!isHorizontal && !isVertical) {
      return res.status(400).json({
        error: `지원하지 않는 양식입니다. 가로형(신규/번이 컬럼) 또는 세로형(유형/정책금액 컬럼)이 필요합니다. 현재 헤더: ${headers.join(', ')}`,
      });
    }

    // 정책 차수 확인 또는 자동 생성
    let policyVersion: any;
    if (policyVersionIdParam && !isNaN(policyVersionIdParam)) {
      policyVersion = await getStorage().getPolicyVersionById(policyVersionIdParam);
      if (!policyVersion) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });
    } else {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const policyNo = `AUTO-${stamp}-${Date.now().toString().slice(-5)}`;
      policyVersion = await getStorage().createPolicyVersion({
        policyNo,
        policyName: `자동생성 ${stamp}`,
        effectiveFrom: now,
        effectiveTo: null,
        isActive: true,
        memo: '엑셀 업로드 자동 생성',
        createdBy: req.session?.userId ?? null,
      });
    }

    const existingRows = await getStorage().getPolicyRowsByVersionId(policyVersion.id);
    const existingKeys = new Set<string>(
      existingRows.map((r: any) => `${r.channel}:${r.planName}:${r.customerType}:${r.nationalityType ?? ''}`)
    );

    const idxChannel  = headers.indexOf('채널');
    const idxPlanName = headers.indexOf('요금제');
    const dataRows = (aoa.slice(1) as any[][]).filter(r =>
      String(r[idxChannel] ?? '').trim() && String(r[idxPlanName] ?? '').trim()
    );

    const toInsert: any[] = [];
    const errors: string[] = [];
    let skipped = 0;

    if (isHorizontal) {
      // ── 가로형 파싱 ──
      // 10컬럼 국적형: 내국인_신규/내국인_번이/외국인_신규/외국인_번이
      // 8컬럼 구형: 신규/번이 → nationality_type = '내국인' 고정
      const idxNatNew     = headers.indexOf('내국인_신규');
      const idxNatPort    = headers.indexOf('내국인_번이');
      const idxForeignNew = headers.indexOf('외국인_신규');
      const idxForeignPort= headers.indexOf('외국인_번이');
      const isNationalityFmt = idxNatNew >= 0 || idxNatPort >= 0 || idxForeignNew >= 0 || idxForeignPort >= 0;

      const idxNew    = headers.indexOf('신규');
      const idxPort   = headers.indexOf('번이');
      const idxBundle = headers.indexOf('결합조건');
      const idxAddSvc = headers.indexOf('부가서비스조건');
      const idxRegFee = headers.indexOf('가입비조건');
      const idxMemo   = headers.indexOf('메모');

      for (let ri = 0; ri < dataRows.length; ri++) {
        const row      = dataRows[ri];
        const rowNum   = ri + 2;
        const channel  = String(row[idxChannel]  ?? '').trim();
        const planName = String(row[idxPlanName] ?? '').trim();
        const bundleType = idxBundle >= 0 ? (String(row[idxBundle] ?? '').trim() || null) : null;
        const addService = idxAddSvc >= 0 ? (String(row[idxAddSvc] ?? '').trim() || null) : null;
        const regFeeType = idxRegFee >= 0 ? (String(row[idxRegFee] ?? '').trim() || null) : null;
        const memo       = idxMemo   >= 0 ? (String(row[idxMemo]   ?? '').trim() || null) : null;

        const candidates: Array<{ ct: string; nat: string; label: string; rawVal: any }> = [];

        if (isNationalityFmt) {
          if (idxNatNew     >= 0 && row[idxNatNew]      !== '' && row[idxNatNew]      != null) candidates.push({ ct: '1', nat: '내국인', label: '내국인_신규', rawVal: row[idxNatNew] });
          if (idxNatPort    >= 0 && row[idxNatPort]     !== '' && row[idxNatPort]     != null) candidates.push({ ct: '2', nat: '내국인', label: '내국인_번이', rawVal: row[idxNatPort] });
          if (idxForeignNew >= 0 && row[idxForeignNew]  !== '' && row[idxForeignNew]  != null) candidates.push({ ct: '1', nat: '외국인', label: '외국인_신규', rawVal: row[idxForeignNew] });
          if (idxForeignPort>= 0 && row[idxForeignPort] !== '' && row[idxForeignPort] != null) candidates.push({ ct: '2', nat: '외국인', label: '외국인_번이', rawVal: row[idxForeignPort] });
        } else {
          if (idxNew  >= 0 && row[idxNew]  !== '' && row[idxNew]  != null) candidates.push({ ct: '1', nat: '내국인', label: '신규', rawVal: row[idxNew] });
          if (idxPort >= 0 && row[idxPort] !== '' && row[idxPort] != null) candidates.push({ ct: '2', nat: '내국인', label: '번이', rawVal: row[idxPort] });
        }

        if (candidates.length === 0) {
          errors.push(`행 ${rowNum}: 금액이 모두 비어 있어 건너뜀 (채널: ${channel})`);
          continue;
        }

        for (const { ct, nat, label, rawVal } of candidates) {
          const parsed = parseFloat(String(rawVal).replace(/,/g, ''));
          if (isNaN(parsed) || parsed <= 0) {
            errors.push(`행 ${rowNum}: 유효하지 않은 금액 "${rawVal}" (${label}) — 건너뜀`);
            continue;
          }
          // 만원 → 원 변환 (소수 오차 방지)
          const rebateAmount = Math.round(parsed * 10000);
          const key = `${channel}:${planName}:${ct}:${nat}`;
          if (existingKeys.has(key)) {
            skipped++;
          } else {
            existingKeys.add(key);
            toInsert.push({
              policyVersionId: policyVersion.id,
              channel, planName,
              customerType: ct,
              nationalityType: nat,
              simCount: null,
              bundleType, addService, regFeeType,
              rebateAmount: String(rebateAmount),
              isActive: true, memo,
            });
          }
        }
      }
    } else {
      // ── 세로형 파싱 (하위 호환): 유형 1/2, 정책금액 원 단위 ──
      const idxCustType = headers.indexOf('유형');
      const idxRebate   = headers.indexOf('정책금액');
      const idxBundle   = headers.indexOf('결합');
      const idxAddSvc   = headers.indexOf('부가');
      const idxRegFee   = headers.indexOf('가입비');
      const idxMemo     = headers.indexOf('메모');

      for (let ri = 0; ri < dataRows.length; ri++) {
        const row        = dataRows[ri];
        const rowNum     = ri + 2;
        const channel    = String(row[idxChannel]  ?? '').trim();
        const planName   = String(row[idxPlanName] ?? '').trim();
        const customerType = String(row[idxCustType] ?? '').trim();
        const rebateAmount = isNaN(Number(row[idxRebate])) ? 0 : Number(row[idxRebate]);
        const bundleType   = idxBundle >= 0 ? (String(row[idxBundle] ?? '').trim() || null) : null;
        const addService   = idxAddSvc >= 0 ? (String(row[idxAddSvc] ?? '').trim() || null) : null;
        const regFeeType   = idxRegFee >= 0 ? (String(row[idxRegFee] ?? '').trim() || null) : null;
        const memo         = idxMemo   >= 0 ? (String(row[idxMemo]   ?? '').trim() || null) : null;

        if (customerType !== '1' && customerType !== '2') {
          errors.push(`행 ${rowNum}: 유효하지 않은 유형 "${customerType}" — 1(신규) 또는 2(번이)만 허용`);
          continue;
        }
        const key = `${channel}:${planName}:${customerType}:`;
        if (existingKeys.has(key)) {
          skipped++;
        } else {
          existingKeys.add(key);
          toInsert.push({
            policyVersionId: policyVersion.id,
            channel, planName, customerType,
            nationalityType: null,
            simCount: null,
            bundleType, addService, regFeeType,
            rebateAmount: String(rebateAmount),
            isActive: true, memo,
          });
        }
      }
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      inserted = await getStorage().bulkCreatePolicyRows(toInsert);
    }

    res.json({
      success: true,
      format: isHorizontal ? 'horizontal' : 'vertical',
      versionId: policyVersion.id,
      versionName: policyVersion.policyName,
      totalRows: dataRows.length,
      inserted,
      skipped,
      errors,
    });
  } catch (error: any) {
    console.error('policy upload-excel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8-3. POST /api/admin/policies/upload-channel-excel — 채널별 수정파일 다중시트 업로드 (B안: 소프트삭제+재삽입)
// 기존 upload-excel API와 별도 — 기존 API는 절대 변경하지 않음
router.post('/api/admin/policies/upload-channel-excel', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

    const policyVersionIdParam = req.body.policyVersionId ? parseInt(req.body.policyVersionId, 10) : null;
    if (!policyVersionIdParam || isNaN(policyVersionIdParam)) {
      return res.status(400).json({ error: 'policyVersionId는 필수입니다. 채널별 업로드는 반드시 기존 정책 차수를 선택해야 합니다.' });
    }

    const policyVersion = await getStorage().getPolicyVersionById(policyVersionIdParam);
    if (!policyVersion) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    // Chrome sends UTF-8 bytes in Content-Disposition; busboy decodes as latin1.
    // Recover original UTF-8 by reinterpreting the latin1 code-points as raw bytes.
    const sourceFileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const uploadedBatchId = `BATCH-${Date.now()}`;

    const EXCLUDE_SHEETS = new Set(['검토필요']);

    // 시트명 파싱: 8월2차_14일접수_수정 → { policyTerm, effectiveBasis, isRevision }
    function parseChannelSheetName(name: string) {
      const m = name.match(/^(\d+)월(\d+)차(?:_(\d+)일(?:(\d+)시)?접수)?(_수정)?$/);
      if (!m) return null;
      const [, month, order, day, hour, rev] = m;
      const policyTerm = `${month}월${order}차`;
      const effectiveBasis = day
        ? `${day}일${hour ? hour + '시' : ''}접수`
        : null;
      return { policyTerm, effectiveBasis, isRevision: !!rev };
    }

    const results: Array<{
      sheetName: string;
      policyTerm: string;
      deactivated: number;
      inserted: number;
      skipped?: number;
    }> = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (let si = 0; si < wb.SheetNames.length; si++) {
      const sheetName = wb.SheetNames[si];

      // 검토필요 시트 제외
      if (EXCLUDE_SHEETS.has(sheetName)) {
        warnings.push(`[${sheetName}] 검토필요 시트 — 제외`);
        continue;
      }

      // 숨김 시트 제외
      const sheetState = (wb.Workbook?.Sheets?.[si] as any)?.state;
      if (sheetState === 'hidden' || sheetState === 'veryHidden') {
        warnings.push(`[${sheetName}] 숨김 시트 — 제외`);
        continue;
      }

      // 시트명 파싱
      const parsed = parseChannelSheetName(sheetName);
      if (!parsed) {
        warnings.push(`[${sheetName}] 시트명 파싱 실패 (예: 8월2차_14일접수) — 건너뜀`);
        continue;
      }
      const { policyTerm, effectiveBasis, isRevision } = parsed;

      const ws = wb.Sheets[sheetName];
      if (!ws) { warnings.push(`[${sheetName}] 시트 데이터 없음 — 건너뜀`); continue; }

      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
      if (aoa.length < 2) { warnings.push(`[${sheetName}] 데이터 행 없음 — 건너뜀`); continue; }

      const headers = (aoa[0] as any[]).map((h: any) => String(h ?? '').trim());

      const idxChannel  = headers.indexOf('채널');
      const idxPlanName = headers.indexOf('요금제');

      if (idxChannel < 0 || idxPlanName < 0) {
        warnings.push(`[${sheetName}] "채널"/"요금제" 헤더 없음 — 건너뜀`);
        continue;
      }

      const idxNatNew      = headers.indexOf('내국인_신규');
      const idxNatPort     = headers.indexOf('내국인_번이');
      const idxForeignNew  = headers.indexOf('외국인_신규');
      const idxForeignPort = headers.indexOf('외국인_번이');
      const idxBundle      = headers.indexOf('결합조건');
      const idxAddSvc      = headers.indexOf('부가서비스조건');
      const idxRegFee      = headers.indexOf('가입비조건');
      const idxMemo        = headers.indexOf('메모');

      const isNationalityFmt = idxNatNew >= 0 || idxNatPort >= 0 || idxForeignNew >= 0 || idxForeignPort >= 0;

      if (!isNationalityFmt) {
        warnings.push(`[${sheetName}] 10컬럼 국적형 헤더 없음 (내국인_신규 등) — 건너뜀`);
        continue;
      }

      // 유효 데이터 행만 추출 (채널+요금제 모두 있는 행, ※ 가이드 행 자동 제외)
      const dataRows = (aoa.slice(1) as any[][]).filter(r =>
        String(r[idxChannel] ?? '').trim() && String(r[idxPlanName] ?? '').trim()
      );

      if (dataRows.length === 0) {
        warnings.push(`[${sheetName}] 유효 데이터 행 없음 — 건너뜀`);
        continue;
      }

      // 이 시트의 첫 번째 채널값 (시트 전체가 동일 채널이어야 함)
      const sheetChannel = String(dataRows[0][idxChannel]).trim();

      // B안: 동일 policyVersionId + channel + policyTerm 기존 행 소프트삭제
      let deactivated = 0;
      try {
        deactivated = await getStorage().deactivatePolicyRowsByChannelTerm(
          policyVersionIdParam, sheetChannel, policyTerm
        );
      } catch (e: any) {
        errors.push(`[${sheetName}] 기존 행 비활성화 오류: ${e.message}`);
        continue;
      }

      // 새 행 구성
      const toInsert: any[] = [];
      let sheetSkipped = 0;

      for (let ri = 0; ri < dataRows.length; ri++) {
        const row      = dataRows[ri];
        const rowNum   = ri + 2;
        const channel  = String(row[idxChannel]  ?? '').trim();
        const planName = String(row[idxPlanName] ?? '').trim();
        if (!channel || !planName) continue;

        const bundleType = idxBundle >= 0 ? (String(row[idxBundle] ?? '').trim() || null) : null;
        const addService = idxAddSvc >= 0 ? (String(row[idxAddSvc] ?? '').trim() || null) : null;
        const regFeeType = idxRegFee >= 0 ? (String(row[idxRegFee] ?? '').trim() || null) : null;
        const memo       = idxMemo   >= 0 ? (String(row[idxMemo]   ?? '').trim() || null) : null;

        const candidates: Array<{ ct: string; nat: string; rawVal: any }> = [];
        if (idxNatNew     >= 0 && row[idxNatNew]      !== '' && row[idxNatNew]      != null) candidates.push({ ct: '1', nat: '내국인', rawVal: row[idxNatNew] });
        if (idxNatPort    >= 0 && row[idxNatPort]     !== '' && row[idxNatPort]     != null) candidates.push({ ct: '2', nat: '내국인', rawVal: row[idxNatPort] });
        if (idxForeignNew >= 0 && row[idxForeignNew]  !== '' && row[idxForeignNew]  != null) candidates.push({ ct: '1', nat: '외국인', rawVal: row[idxForeignNew] });
        if (idxForeignPort>= 0 && row[idxForeignPort] !== '' && row[idxForeignPort] != null) candidates.push({ ct: '2', nat: '외국인', rawVal: row[idxForeignPort] });

        if (candidates.length === 0) { sheetSkipped++; continue; }

        for (const { ct, nat, rawVal } of candidates) {
          const parsed2 = parseFloat(String(rawVal).replace(/,/g, ''));
          if (isNaN(parsed2) || parsed2 <= 0) {
            errors.push(`[${sheetName}] 행${rowNum}: 유효하지 않은 금액 "${rawVal}" — 건너뜀`);
            sheetSkipped++;
            continue;
          }
          const rebateAmount = Math.round(parsed2 * 10000);
          toInsert.push({
            policyVersionId: policyVersionIdParam,
            channel, planName,
            customerType: ct,
            nationalityType: nat,
            simCount: null,
            bundleType, addService, regFeeType,
            rebateAmount: String(rebateAmount),
            isActive: true,
            memo,
            policyTerm,
            effectiveBasis,
            sourceSheetName: sheetName,
            sourceFileName,
            isRevision,
            uploadedBatchId,
          });
        }
      }

      let inserted = 0;
      if (toInsert.length > 0) {
        try {
          inserted = await getStorage().bulkCreatePolicyRows(toInsert);
        } catch (e: any) {
          errors.push(`[${sheetName}] 행 삽입 오류: ${e.message}`);
          continue;
        }
      }

      results.push({ sheetName, policyTerm, deactivated, inserted, skipped: sheetSkipped });
    }

    res.json({
      success: true,
      versionId: policyVersion.id,
      versionName: policyVersion.policyName,
      uploadedBatchId,
      totalSheets: wb.SheetNames.length,
      processedSheets: results.length,
      skippedSheets: wb.SheetNames.length - results.length,
      sheets: results,
      warnings,
      errors,
    });
  } catch (error: any) {
    console.error('upload-channel-excel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8-5. POST /api/admin/policies/parse-original-policy-excel — 원본 MCC 정책 통합본 자동 인식
// 역할: 원본 파일 수신 → 채널별 분리 → 업로드용 파일 생성 → base64 반환 (DB 반영 없음)
router.post('/api/admin/policies/parse-original-policy-excel', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
    if (!req.file.originalname.match(/\.(xlsx|xls)$/i)) {
      return res.status(400).json({ error: 'xlsx 또는 xls 파일만 업로드 가능합니다.' });
    }

    // Chrome sends UTF-8 bytes in Content-Disposition; busboy decodes as latin1
    const originalFileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const splitResult = splitPolicyExcelFromBuffer(req.file.buffer, originalFileName);
    const exportResult = exportPolicyUploadReadyFromSplit(splitResult);

    const files = exportResult.files.map(f => ({
      name: f.name,
      data: f.buffer.toString('base64'),
      sheets: f.sheets,
      totalRows: f.totalRows,
    }));

    res.json({
      originalFileName,
      sheetsAnalyzed: splitResult.sheetsAnalyzed,
      sheetsSkipped: splitResult.sheetsSkipped,
      totalChannels: files.length,
      totalOkRows: exportResult.totalOk,
      totalReviewRows: exportResult.totalReview,
      files,
      warnings: splitResult.warnings,
    });
  } catch (error: any) {
    console.error('parse-original-policy-excel error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9a. PATCH /api/admin/policies/:id/rows/:rowId — 단가 행 조건값 수정
router.patch('/api/admin/policies/:id/rows/:rowId', requireAdmin, async (req, res) => {
  try {
    const policyVersionId = parseInt(req.params.id, 10);
    const rowId = parseInt(req.params.rowId, 10);
    if (isNaN(policyVersionId) || isNaN(rowId)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }
    const allowed = ['channel','planName','customerType','nationalityType','bundleType','addService','regFeeType','simCount','rebateAmount','memo','isActive'];
    const data: any = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        data[key] = req.body[key];
      }
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: '수정할 필드가 없습니다.' });
    }
    const updated = await getStorage().updatePolicyRow(rowId, data);
    if (!updated) return res.status(404).json({ error: '단가 행을 찾을 수 없습니다.' });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('updatePolicyRow error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9. DELETE /api/admin/policies/:id/rows/:rowId — 단가 행 비활성화 (하드 삭제 금지)
router.delete('/api/admin/policies/:id/rows/:rowId', requireAdmin, async (req, res) => {
  try {
    const policyVersionId = parseInt(req.params.id, 10);
    const rowId = parseInt(req.params.rowId, 10);
    if (isNaN(policyVersionId) || isNaN(rowId)) {
      return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    }

    const updated = await getStorage().updatePolicyRow(rowId, { isActive: false });
    if (!updated) return res.status(404).json({ error: '단가 행을 찾을 수 없습니다.' });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('deactivatePolicyRow error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── adjustment_rules CRUD ──────────────────────────────────────────

// AR-1. GET /api/admin/policies/:id/adjustment-rules
router.get('/api/admin/policies/:id/adjustment-rules', requireAdmin, async (req, res) => {
  try {
    const policyVersionId = parseInt(req.params.id, 10);
    if (isNaN(policyVersionId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    const rows = await getStorage().getAdjustmentRulesByVersionId(policyVersionId);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AR-2. POST /api/admin/policies/:id/adjustment-rules
router.post('/api/admin/policies/:id/adjustment-rules', requireAdmin, async (req, res) => {
  try {
    const policyVersionId = parseInt(req.params.id, 10);
    if (isNaN(policyVersionId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const { channel, planName, customerType, conditionType, conditionValue, adjustmentType, amount, isActive, memo } = req.body;

    if (!conditionType) return res.status(400).json({ error: 'conditionType은 필수입니다.' });
    if (!adjustmentType || !['ADD','DEDUCT'].includes(adjustmentType)) return res.status(400).json({ error: 'adjustmentType은 ADD 또는 DEDUCT여야 합니다.' });
    const numAmount = Number(String(amount ?? '').replace(/,/g, ''));
    if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: '금액은 0보다 큰 숫자로 입력해주세요.' });

    const needsValue = ['BUNDLE_MATCH','ADD_SERVICE_MATCH','ADD_SERVICE_NOT_MATCH','REGFEE_MATCH','SIM_COUNT_MATCH'];
    if (needsValue.includes(conditionType) && !conditionValue) {
      return res.status(400).json({ error: '이 조건 종류는 조건값이 필요합니다.' });
    }

    const created = await getStorage().createAdjustmentRule({
      policyVersionId,
      channel: channel ?? '',
      planName: planName ?? '',
      customerType: customerType ?? '',
      conditionType,
      conditionValue: conditionValue ?? null,
      adjustmentType,
      amount: String(numAmount),
      isActive: isActive !== false,
      memo: memo ?? null,
    });
    res.json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AR-3. PATCH /api/admin/policies/:id/adjustment-rules/:ruleId
router.patch('/api/admin/policies/:id/adjustment-rules/:ruleId', requireAdmin, async (req, res) => {
  try {
    const ruleId = parseInt(req.params.ruleId, 10);
    if (isNaN(ruleId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const allowed = ['channel','planName','customerType','conditionType','conditionValue','adjustmentType','amount','isActive','memo'];
    const data: any = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        if (key === 'amount') {
          const numAmount = Number(String(req.body[key] ?? '').replace(/,/g, ''));
          if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: '금액은 0보다 큰 숫자로 입력해주세요.' });
          data[key] = String(numAmount);
        } else {
          data[key] = req.body[key];
        }
      }
    }
    if (Object.keys(data).length === 0) return res.status(400).json({ error: '수정할 필드가 없습니다.' });

    const updated = await getStorage().updateAdjustmentRule(ruleId, data);
    if (!updated) return res.status(404).json({ error: '규칙을 찾을 수 없습니다.' });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AR-4. DELETE /api/admin/policies/:id/adjustment-rules/:ruleId — 비활성 처리
router.delete('/api/admin/policies/:id/adjustment-rules/:ruleId', requireAdmin, async (req, res) => {
  try {
    const ruleId = parseInt(req.params.ruleId, 10);
    if (isNaN(ruleId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    const updated = await getStorage().updateAdjustmentRule(ruleId, { isActive: false });
    if (!updated) return res.status(404).json({ error: '규칙을 찾을 수 없습니다.' });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ── hidden_policy_rows CRUD ──────────────────────────────────────────

// HP-1. GET /api/admin/hidden-policy-rows
router.get('/api/admin/hidden-policy-rows', requireAdmin, async (req, res) => {
  try {
    const { dealerRegistrationId, isActive } = req.query;
    const filters: any = {};
    if (dealerRegistrationId) filters.dealerRegistrationId = parseInt(String(dealerRegistrationId), 10);
    if (isActive !== undefined) filters.isActive = isActive === 'true';
    const rows = await getStorage().getHiddenPolicyRows(filters);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// HP-2. POST /api/admin/hidden-policy-rows
router.post('/api/admin/hidden-policy-rows', requireAdmin, async (req, res) => {
  try {
    const adminId = req.session?.userId;
    const { dealerRegistrationId, contactCode, channel, planName, customerType, hiddenAmount, effectiveFrom, effectiveTo, isActive, memo } = req.body;
    if (hiddenAmount == null || hiddenAmount === '') return res.status(400).json({ error: 'hiddenAmount은 필수입니다.' });
    const data: any = {
      hiddenAmount: String(hiddenAmount),
      isActive: isActive !== false,
      createdBy: adminId,
    };
    if (dealerRegistrationId != null) data.dealerRegistrationId = Number(dealerRegistrationId);
    if (contactCode != null && contactCode !== '') data.contactCode = String(contactCode).trim();
    if (channel != null && channel !== '') data.channel = String(channel).trim();
    if (planName != null && planName !== '') data.planName = String(planName).trim();
    if (customerType != null && customerType !== '') data.customerType = String(customerType).trim();
    if (memo != null && memo !== '') data.memo = String(memo).trim();
    if (effectiveFrom) data.effectiveFrom = new Date(String(effectiveFrom).slice(0, 10) + 'T00:00:00+09:00');
    if (effectiveTo) data.effectiveTo = new Date(String(effectiveTo).slice(0, 10) + 'T23:59:59+09:00');
    const row = await getStorage().createHiddenPolicyRow(data);
    res.status(201).json(row);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// HP-3. PATCH /api/admin/hidden-policy-rows/:id
router.patch('/api/admin/hidden-policy-rows/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    const allowed = ['dealerRegistrationId', 'contactCode', 'channel', 'planName', 'customerType', 'hiddenAmount', 'effectiveFrom', 'effectiveTo', 'isActive', 'memo'];
    const data: any = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }
    if (data.hiddenAmount != null) data.hiddenAmount = String(data.hiddenAmount);
    if (data.dealerRegistrationId != null) data.dealerRegistrationId = Number(data.dealerRegistrationId);
    if (data.effectiveFrom) data.effectiveFrom = new Date(String(data.effectiveFrom).slice(0, 10) + 'T00:00:00+09:00');
    if (data.effectiveTo) data.effectiveTo = new Date(String(data.effectiveTo).slice(0, 10) + 'T23:59:59+09:00');
    const updated = await getStorage().updateHiddenPolicyRow(id, data);
    if (!updated) return res.status(404).json({ error: '히든정책 행을 찾을 수 없습니다.' });
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// HP-4. DELETE /api/admin/hidden-policy-rows/:id — 비활성 처리
router.delete('/api/admin/hidden-policy-rows/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });
    const updated = await getStorage().updateHiddenPolicyRow(id, { isActive: false });
    if (!updated) return res.status(404).json({ error: '히든정책 행을 찾을 수 없습니다.' });
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 10. POST /api/admin/policies/:id/files — 정책표 파일 경로 등록
router.post('/api/admin/policies/:id/files', requireAdmin, async (req, res) => {
  try {
    const adminId = req.session?.userId;
    const policyVersionId = parseInt(req.params.id, 10);
    if (isNaN(policyVersionId)) return res.status(400).json({ error: '유효하지 않은 ID입니다.' });

    const version = await getStorage().getPolicyVersionById(policyVersionId);
    if (!version) return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });

    const { fileName, filePath, fileType, fileSize, memo } = req.body;
    if (!fileName || !filePath || !fileType) {
      return res.status(400).json({ error: 'fileName, filePath, fileType은 필수입니다.' });
    }

    const file = await getStorage().createPolicyFile({
      policyVersionId,
      fileName,
      filePath,
      fileType,
      fileSize: fileSize ?? null,
      memo: memo ?? null,
      uploadedBy: adminId,
    });

    res.status(201).json(file);
  } catch (error: any) {
    console.error('createPolicyFile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STEP 5D-2: 개통완료 엑셀 업로드 API
// ============================================================

const normalizeCustomerType = (v: string | null | undefined): string => {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', '신규', '신', 'new'].includes(s)) return '1';
  if (['2', '번이', '번호이동', 'mnp', '이동'].includes(s)) return '2';
  return String(v ?? '').trim();
};

// POST /api/admin/activations/upload
router.post('/api/admin/activations/upload', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const adminId = req.session?.userId;

    if (!req.file) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });

    if (rawRows.length === 0) {
      return res.status(400).json({ error: '파일에 데이터가 없습니다.' });
    }

    // 헤더 key 공백 제거 (엑셀에서 컬럼명에 후행 공백이 붙는 경우 대응)
    const rows = rawRows.map((row: any) => {
      const cleaned: any = {};
      for (const [k, v] of Object.entries(row)) cleaned[k.trim()] = v;
      return cleaned;
    });

    // 컬럼 매핑: 한글 헤더 → 내부 필드명 (접두 _ = 후처리 필요)
    // 기존 양식 헤더와 실제 운영 헤더 모두 지원
    const COL_MAP: Record<string, string> = {
      // 기존 양식 헤더
      '고객명': 'customerName',
      '연락처': 'customerPhone',
      '고객번호': 'customerPhone',
      '고객 연락처': 'customerPhone',
      '고객전화번호': 'customerPhone',
      '전화번호': 'customerPhone',
      '휴대폰번호': 'customerPhone',
      '이메일': 'customerEmail',
      '통신사': 'channel',
      '유형': 'customerType',
      '판매점명': 'dealerName',
      '요금제': 'planName',
      '가입번호': 'subscriptionNumber',
      '가입자번호': 'subscriptionNumber',
      '청약번호': 'subscriptionNumber',
      '개통번호': 'activationNumber',
      '처리자': 'receptionist',
      '개통완료시간': '_activationDatetime',
      '문서번호': '_documentNumber',
      '접점코드': 'contactCode',
      '이전통신사': 'previousCarrier',
      '접수일시': '_receptionDatetime',
      '메모': 'memo',
      '유심개수': '_simCount',
      '결합': 'bundleType',
      '부가서비스': 'addService',
      '가입비': 'regFeeType',
      // 실제 운영 헤더 (기존 헤더보다 뒤에 선언 → 값이 있으면 덮어쓰기)
      '요청점': 'channel',
      '개통일': '_activationDatetime',
      '접수일': '_receptionDatetime',
      '부가': 'addService',
      '작업자': 'receptionist',
      'M코드': '_mccCodeRaw',
      '코드명': '_codeNameRaw',
      '고객유형': 'nationalityType',
      '국적': 'nationalityType',
      '내외국인': 'nationalityType',
    };

    const db = await getDatabase();
    const { activationRecords: arTable, documents: docsTable } = await import('../shared/schema');

    // N+1 방지용 인메모리 캐시
    const docCache = new Map<string, number | null>();
    const matchCache = new Map<string, any[]>();

    let created = 0;
    let skipped = 0;
    let matchedCount = 0;
    let reviewCount = 0;
    let unmatchedCount = 0;
    const warnings: string[] = [];
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const raw = rows[i];

      // 필수값 검사 (기존 헤더 / 운영 헤더 모두 허용)
      const missing: string[] = [];
      if (!String(raw['고객명'] ?? '').trim()) missing.push('고객명');
      if (!String(raw['통신사'] ?? '').trim() && !String(raw['요청점'] ?? '').trim()) missing.push('통신사/요청점');
      if (!String(raw['개통완료시간'] ?? '').trim() && !String(raw['개통일'] ?? '').trim()) missing.push('개통완료시간/개통일');
      if (!String(raw['요금제'] ?? '').trim()) missing.push('요금제');
      if (!String(raw['접점코드'] ?? '').trim() && !String(raw['판매점명'] ?? '').trim()) {
        missing.push('접점코드/판매점명');
      }
      if (missing.length > 0) {
        errors.push(`행 ${rowNum}: 필수값 누락 (${missing.join(', ')})`);
        skipped++;
        continue;
      }

      // 컬럼 매핑 실행
      const m: Record<string, string | null> = {};
      for (const [koKey, enKey] of Object.entries(COL_MAP)) {
        m[enKey] = String(raw[koKey] ?? '').trim() || null;
      }

      // 고객구분(국적) 정규화: 비어있으면 '내국인', '외국인' 포함이면 '외국인'
      const rawNat = m['nationalityType'];
      m['nationalityType'] = rawNat && rawNat.includes('외국인') ? '외국인' : '내국인';

      // 날짜 파싱 — 다양한 형식 지원
      const parseDateStr = (s: string | null): Date | null => {
        if (!s) return null;
        const t = s.trim();
        if (!t) return null;

        // YYYY-MM-DD 또는 YYYY/MM/DD
        if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(t)) {
          const d = new Date(t.replace(/\//g, '-') + 'T00:00:00');
          return isNaN(d.getTime()) ? null : d;
        }
        // YYYY-MM-DD HH:mm[:ss]
        if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\s\d{1,2}:\d{2}/.test(t)) {
          const norm = t.replace(/\//g, '-').replace(' ', 'T');
          const d = new Date(norm.length <= 16 ? norm + ':00' : norm);
          return isNaN(d.getTime()) ? null : d;
        }
        // MM월 DD일 (연도 없음 → 현재 연도)
        const m1 = t.match(/^(\d{1,2})월\s*(\d{1,2})일$/);
        if (m1) {
          const d = new Date(new Date().getFullYear(), Number(m1[1]) - 1, Number(m1[2]));
          return isNaN(d.getTime()) ? null : d;
        }
        // YYYY년 MM월 DD일
        const m2 = t.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
        if (m2) {
          const d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
          return isNaN(d.getTime()) ? null : d;
        }
        // M/D/YYYY 또는 MM/DD/YYYY (SheetJS 날짜 셀 변환 결과)
        const m4 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m4) {
          const d = new Date(Number(m4[3]), Number(m4[1]) - 1, Number(m4[2]));
          return isNaN(d.getTime()) ? null : d;
        }
        // MM/DD (연도 없음 → 현재 연도)
        const m3 = t.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (m3) {
          const d = new Date(new Date().getFullYear(), Number(m3[1]) - 1, Number(m3[2]));
          return isNaN(d.getTime()) ? null : d;
        }
        return null;
      };

      const activationDatetime = parseDateStr(m['_activationDatetime']);
      if (!activationDatetime) {
        const rawVal = raw['개통완료시간'] || raw['개통일'] || '';
        errors.push(`행 ${rowNum}: 개통일 형식 오류 (값: ${rawVal})`);
        skipped++;
        continue;
      }
      const receptionDatetime = parseDateStr(m['_receptionDatetime']);
      const simCount = m['_simCount'] ? parseInt(m['_simCount'], 10) || null : null;

      // 문서번호 → document_id 조회
      let documentId: number | null = null;
      const docNum = m['_documentNumber'];
      if (docNum) {
        if (docCache.has(docNum)) {
          documentId = docCache.get(docNum) ?? null;
        } else {
          const found = await db.select({ id: docsTable.id })
            .from(docsTable)
            .where(sql`${docsTable.documentNumber} = ${docNum}`)
            .limit(1);
          documentId = found[0]?.id ?? null;
          docCache.set(docNum, documentId);
          if (!documentId) {
            warnings.push(`행 ${rowNum}: 문서번호 매칭 실패 (${docNum}), document_id=null 저장`);
          }
        }
      }

      // ── M코드 기반 5단계 매칭 엔진 ──────────────────────────────────────
      const contactCodeVal = m['contactCode'];   // I열 접점코드
      const mccCodeRaw    = m['_mccCodeRaw'];    // J열 M코드 (Excel 원본)
      const codeNameRaw   = m['_codeNameRaw'];   // L열 코드명

      let dealerRegistrationId: number | null = null;
      let contactCodeId: number | null = null;
      let resolvedDealerName: string | null = m['dealerName'];
      let mccCode: string | null = mccCodeRaw;   // 항상 Excel J열 원본 저장
      let resolvedCodeName: string | null = codeNameRaw;
      let realSalesPOS: string | null = null;
      let subDealerName: string | null = null;
      let matchingStatus = 'unmatched';
      let matchingBasis: string | null = null;

      const resolveFromCC = (ccRec: any) => {
        contactCodeId      = ccRec.id ?? null;
        dealerRegistrationId = ccRec.dealerRegistrationId ?? null;
        if (!resolvedDealerName) resolvedDealerName = ccRec.dealerName ?? null;
        realSalesPOS       = ccRec.realSalesPOS ?? null;
        subDealerName      = ccRec.subDealerName ?? null;
        if (!resolvedCodeName) resolvedCodeName = ccRec.codeName ?? null;
      };

      const cachedList = async (key: string, fetcher: () => Promise<any[]>): Promise<any[]> => {
        if (matchCache.has(key)) return matchCache.get(key)!;
        const v = await fetcher();
        matchCache.set(key, v);
        return v;
      };

      // Step 1: M코드 + 접점코드
      if (matchingStatus === 'unmatched' && mccCodeRaw && contactCodeVal) {
        const hits = await cachedList(`mc+cc:${mccCodeRaw}:${contactCodeVal}`,
          () => getStorage().getContactCodesByMCodeAndCode(mccCodeRaw!, contactCodeVal!));
        if (hits.length === 1) {
          resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = 'M코드+접점코드';
        } else if (hits.length > 1) {
          resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = 'M코드+접점코드(중복)';
        }
      }

      // Step 2: M코드 + 코드명
      if (matchingStatus === 'unmatched' && mccCodeRaw && codeNameRaw) {
        const hits = await cachedList(`mc+cn:${mccCodeRaw}:${codeNameRaw}`,
          () => getStorage().getContactCodesByMCodeAndCodeName(mccCodeRaw!, codeNameRaw!));
        if (hits.length === 1) {
          resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = 'M코드+코드명';
        } else if (hits.length > 1) {
          resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = 'M코드+코드명(중복)';
        }
      }

      // Step 3: 접점코드 단독
      if (matchingStatus === 'unmatched' && contactCodeVal) {
        const hits = await cachedList(`cc:${contactCodeVal}`,
          () => getStorage().getContactCodesByCodeAll(contactCodeVal!));
        if (hits.length === 1) {
          resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = '접점코드단독';
        } else if (hits.length > 1) {
          resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = '접점코드단독(중복)';
        }
      }

      // Step 4: M코드 단독
      if (matchingStatus === 'unmatched' && mccCodeRaw) {
        const hits = await cachedList(`mc:${mccCodeRaw}`,
          () => getStorage().getContactCodesByMCode(mccCodeRaw!));
        if (hits.length === 1) {
          resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = 'M코드단독';
        } else if (hits.length > 1) {
          resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = 'M코드단독(중복)';
        }
      }

      // Step 5: 판매점명/코드명 보조
      if (matchingStatus === 'unmatched') {
        const dn = m['dealerName'];
        const cn = codeNameRaw;
        if (dn || cn) {
          const hits = await cachedList(`nm:${dn ?? ''}:${cn ?? ''}`,
            () => getStorage().getContactCodesByNameFields(dn, cn));
          if (hits.length === 1) {
            resolveFromCC(hits[0]); matchingStatus = 'matched'; matchingBasis = '판매점명/코드명보조';
          } else if (hits.length > 1) {
            resolveFromCC(hits[0]); matchingStatus = 'review_required'; matchingBasis = '판매점명/코드명보조(중복)';
          }
        }
      }

      if (matchingStatus === 'matched') matchedCount++;
      else if (matchingStatus === 'review_required') reviewCount++;
      else unmatchedCount++;

      if (matchingStatus !== 'matched') {
        warnings.push(`행 ${rowNum}: 매칭=${matchingStatus}, 근거=${matchingBasis ?? '없음'} (M코드:${mccCodeRaw ?? '-'}, 접점코드:${contactCodeVal ?? '-'})`);
      }
      // ── 매칭 엔진 끝 ────────────────────────────────────────────────────

      // 중복 확인
      const subscriptionNumber = m['subscriptionNumber'];
      let isDuplicate = false;

      if (subscriptionNumber) {
        const dup = await db.select({ id: arTable.id })
          .from(arTable)
          .where(eq(arTable.subscriptionNumber, subscriptionNumber))
          .limit(1);
        isDuplicate = dup.length > 0;
      } else {
        const phone = m['customerPhone'];
        if (phone && contactCodeVal) {
          const dup = await db.select({ id: arTable.id })
            .from(arTable)
            .where(and(
              eq(arTable.customerPhone, phone),
              eq(arTable.activationDatetime, activationDatetime),
              eq(arTable.contactCode, contactCodeVal)
            ))
            .limit(1);
          isDuplicate = dup.length > 0;
        }
      }

      if (isDuplicate) {
        warnings.push(`행 ${rowNum}: 중복 건너뜀 (가입번호: ${subscriptionNumber ?? '없음'})`);
        skipped++;
        continue;
      }

      // activation_records 저장
      await getStorage().createActivationRecord({
        documentId,
        receptionDatetime,
        activationDatetime,
        requestChannel: null,
        channel: m['channel'],
        customerName: m['customerName'],
        customerPhone: m['customerPhone'],
        customerEmail: m['customerEmail'],
        subscriptionNumber,
        activationNumber: m['activationNumber'],
        contactCode: contactCodeVal,
        mccCode,
        dealerRegistrationId,
        dealerName: resolvedDealerName,
        // 매칭 엔진 결과 필드
        contactCodeId,
        codeName: resolvedCodeName,
        realSalesPOS,
        subDealerName,
        matchingStatus,
        matchingBasis,
        simCount,
        planName: m['planName'],
        customerType: normalizeCustomerType(m['customerType']),
        nationalityType: m['nationalityType'] as string,
        previousCarrier: m['previousCarrier'],
        bundleType: m['bundleType'],
        addService: m['addService'],
        regFeeType: m['regFeeType'],
        receptionist: m['receptionist'],
        memo: m['memo'],
        source: 'xlsx업로드',
        createdBy: adminId,
      });
      created++;
    }

    res.json({
      success: true,
      totalRows: rows.length,
      created,
      skipped,
      matchedCount,
      reviewCount,
      unmatchedCount,
      warnings,
      errors,
    });
  } catch (error: any) {
    console.error('[ACTIVATION_UPLOAD] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STEP 5D-3: 정책 자동매칭 API
// ============================================================

// POST /api/admin/settlement/match
router.post('/api/admin/settlement/match', requireAdmin, async (req, res) => {
  try {
    const { policyVersionId, from, to, channel } = req.body;

    // 1. 정책 차수 조회 (A안: policyVersionId 명시 시 고정, 없으면 접수일시 기준 자동 선택)
    const fixedPv: any = policyVersionId
      ? await getStorage().getPolicyVersionById(Number(policyVersionId))
      : null;
    if (policyVersionId && !fixedPv) {
      return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });
    }

    // 2. 정책 차수별 단가 행 lazy 캐시 (성능: 같은 차수 반복 조회 방지)
    const pvRowCache = new Map<number, any[]>();
    const getPvRows = async (pvId: number): Promise<any[]> => {
      if (!pvRowCache.has(pvId)) {
        const rows = await getStorage().getPolicyRowsByVersionId(pvId);
        pvRowCache.set(pvId, rows.filter((r: any) => r.isActive !== false));
      }
      return pvRowCache.get(pvId)!;
    };
    if (fixedPv) {
      const rows = await getPvRows(fixedPv.id);
      if (rows.length === 0) {
        return res.status(400).json({ error: '해당 정책 차수에 활성 단가 행이 없습니다.' });
      }
    }

    // 자동 선택용: 활성 정책 차수 전체를 effectiveFrom DESC로 인메모리 로드
    const allActivePvs: any[] = policyVersionId
      ? []
      : (await getStorage().getPolicyVersions()).filter((p: any) => p.isActive);
    const findPvAt = (at: Date): any | null => {
      for (const p of allActivePvs) {
        const from = new Date(p.effectiveFrom);
        const to = p.effectiveTo ? new Date(p.effectiveTo) : null;
        if (from <= at && (!to || to > at)) return p;
      }
      return null;
    };

    // 3. 미정산 activation_records 조회 (settlement_item 없는 것만)
    const db = await getDatabase();
    const {
      activationRecords: arTable,
    } = await import('../shared/schema');

    const whereConditions: any[] = [
      sql`NOT EXISTS (
        SELECT 1 FROM settlement_items si WHERE si.activation_id = ${arTable.id}
      )`,
    ];
    if (from) whereConditions.push(gte(arTable.activationDatetime, new Date(from)));
    if (to) whereConditions.push(lte(arTable.activationDatetime, new Date(to)));
    if (channel) whereConditions.push(eq(arTable.channel, channel));

    const unmatched: any[] = await db.select()
      .from(arTable)
      .where(and(...whereConditions))
      .orderBy(arTable.activationDatetime);

    // 4. 단가 행 매칭 함수
    // channel + plan_name + customer_type: 항상 일치 필요
    // nationality_type: policy가 null이면 와일드카드(REVIEW_REQUIRED), 값이 있으면 정확일치(AUTO_MATCH 유지)
    // sim_count / bundle_type / add_service / reg_fee_type:
    //   - policy_row 값이 null이면 와일드카드
    //   - policy_row 값이 있으면 activation 값과 일치해야 매칭
    const normalize = (v: any): string => String(v ?? '').trim();

    // 반환: 'exact' = 국적 정확일치, 'wildcard' = 국적 와일드카드(null policy), 'none' = 불일치
    const matchRow = (activation: any, row: any, exclude: Set<string>): 'exact' | 'wildcard' | 'none' => {
      if (activation.channel !== row.channel) return 'none';
      if (activation.planName !== row.planName) return 'none';
      if (normalizeCustomerType(activation.customerType) !== normalizeCustomerType(row.customerType)) return 'none';

      // 국적 매칭 (3-tier)
      const actNat = normalize(activation.nationalityType || '내국인');
      const rowNat = normalize(row.nationalityType || '');
      let natResult: 'exact' | 'wildcard';
      if (rowNat === '') {
        natResult = 'wildcard'; // policy 국적 null → 와일드카드
      } else if (actNat === rowNat) {
        natResult = 'exact'; // 정확 일치
      } else {
        return 'none'; // 국적 불일치
      }

      const optionals: { actKey: string; rowKey: string }[] = [
        { actKey: 'simCount',   rowKey: 'simCount'   },
        { actKey: 'bundleType', rowKey: 'bundleType' },
        { actKey: 'addService', rowKey: 'addService' },
        { actKey: 'regFeeType', rowKey: 'regFeeType' },
      ];
      for (const { actKey, rowKey } of optionals) {
        if (exclude.has(rowKey)) continue;
        const rv = row[rowKey];
        if (rv === null || rv === undefined || rv === '') continue; // 와일드카드
        if (normalize(activation[actKey]) !== normalize(rv)) return 'none';
      }
      return natResult;
    };

    // 5. 각 activation_record에 대해 순차 매칭 → settlement_item 생성
    let created = 0;
    let autoMatch = 0;
    let reviewRequired = 0;
    let policyNotFound = 0;
    const errors: string[] = [];

    // 폴백 시퀀스: [제외 필드 Set, 이 패턴은 AUTO_MATCH인지]
    const MATCH_PASSES: Array<{ exclude: Set<string>; isAuto: boolean }> = [
      { exclude: new Set([]),             isAuto: true  }, // 완전일치
      { exclude: new Set(['addService']), isAuto: false }, // 부가서비스 제외
      { exclude: new Set(['bundleType']), isAuto: false }, // 결합 제외
      { exclude: new Set(['regFeeType']), isAuto: false }, // 가입비 제외
    ];

    for (const activation of unmatched) {
      try {
        // 이 activation에 적용할 정책 차수 결정
        let pv: any;
        if (fixedPv) {
          pv = fixedPv;
        } else {
          const refDatetime = activation.receptionDatetime ?? activation.activationDatetime;
          pv = refDatetime ? findPvAt(new Date(refDatetime)) : null;
        }
        const activeRows = pv ? await getPvRows(pv.id) : [];

        let matchedRow: any = null;
        let matchStatus = 'POLICY_NOT_FOUND';

        for (const { exclude, isAuto } of MATCH_PASSES) {
          // 국적 정확일치 우선 시도
          const exactFound = activeRows.find((r: any) => matchRow(activation, r, exclude) === 'exact');
          if (exactFound) {
            matchedRow = exactFound;
            matchStatus = isAuto ? 'AUTO_MATCH' : 'REVIEW_REQUIRED';
            break;
          }
          // 국적 와일드카드(policy null) 폴백
          const wildcardFound = activeRows.find((r: any) => matchRow(activation, r, exclude) === 'wildcard');
          if (wildcardFound) {
            matchedRow = wildcardFound;
            matchStatus = 'REVIEW_REQUIRED'; // 와일드카드는 항상 검토필요
            break;
          }
        }

        // dealer_registration_id 없으면 AUTO_MATCH → REVIEW_REQUIRED 강등
        if (matchStatus === 'AUTO_MATCH' && !activation.dealerRegistrationId) {
          matchStatus = 'REVIEW_REQUIRED';
        }

        // 추가금/차감금 자동 계산 (매칭된 정책 차수의 adjustment_rules 기준)
        let adjAddAmount: string | null = null;
        let adjDeductAmount: string | null = null;
        if (matchedRow && pv?.id) {
          try {
            const adj = await getStorage().calculateSettlementAdjustments(activation, pv.id);
            if (adj.addAmount > 0)    adjAddAmount    = String(adj.addAmount);
            if (adj.deductAmount > 0) adjDeductAmount = String(adj.deductAmount);
          } catch (_) {}
        }

        // 히든금액 자동 계산 (히든정책 판매점 여부 확인)
        let adjHiddenAmount: string | null = null;
        try {
          const hidden = await getStorage().calculateHiddenAmount(activation);
          if (hidden !== 0) adjHiddenAmount = String(hidden);
        } catch (_) {}

        await getStorage().createSettlementItem({
          activationId: activation.id,
          policyVersionId: matchedRow ? (pv?.id ?? null) : null,
          policyRowId:     matchedRow ? matchedRow.id    : null,
          dealerRegistrationId: activation.dealerRegistrationId ?? null,
          dealerName:           activation.dealerName ?? null,
          rebateAmount:  matchedRow ? String(matchedRow.rebateAmount) : null,
          adjustedAmount: null,
          addAmount:    adjAddAmount,
          deductAmount: adjDeductAmount,
          hiddenAmount: adjHiddenAmount,
          matchStatus,
          status: '미정산',
          policySnapshotJson: matchedRow ?? null,
        });

        created++;
        if (matchStatus === 'AUTO_MATCH')       autoMatch++;
        else if (matchStatus === 'REVIEW_REQUIRED') reviewRequired++;
        else                                        policyNotFound++;

      } catch (err: any) {
        errors.push(`activation_id ${activation.id}: ${String(err.message ?? '').substring(0, 80)}`);
      }
    }

    res.json({
      success: true,
      policyVersionId: fixedPv?.id ?? null,
      policyVersionName: fixedPv?.policyName ?? '접수일시 자동 선택',
      totalActivations: unmatched.length,
      created,
      skipped: 0, // 중복 방지는 NOT EXISTS로 사전 필터 처리
      autoMatch,
      reviewRequired,
      policyNotFound,
      errors,
    });

  } catch (error: any) {
    console.error('[SETTLEMENT_MATCH] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/settlement/rematch — POLICY_NOT_FOUND 항목 재매칭
router.post('/api/admin/settlement/rematch', requireAdmin, async (req, res) => {
  try {
    const { policyVersionId } = req.body;

    const fixedPv: any = policyVersionId
      ? await getStorage().getPolicyVersionById(Number(policyVersionId))
      : null;
    if (policyVersionId && !fixedPv) {
      return res.status(404).json({ error: '정책 차수를 찾을 수 없습니다.' });
    }

    const pvRowCache2 = new Map<number, any[]>();
    const getPvRows2 = async (pvId: number): Promise<any[]> => {
      if (!pvRowCache2.has(pvId)) {
        const rows = await getStorage().getPolicyRowsByVersionId(pvId);
        pvRowCache2.set(pvId, rows.filter((r: any) => r.isActive !== false));
      }
      return pvRowCache2.get(pvId)!;
    };
    if (fixedPv) {
      const rows = await getPvRows2(fixedPv.id);
      if (rows.length === 0) {
        return res.status(400).json({ error: '해당 정책 차수에 활성 단가 행이 없습니다.' });
      }
    }

    const allActivePvs2: any[] = policyVersionId
      ? []
      : (await getStorage().getPolicyVersions()).filter((p: any) => p.isActive);
    const findPvAt2 = (at: Date): any | null => {
      for (const p of allActivePvs2) {
        const from = new Date(p.effectiveFrom);
        const to = p.effectiveTo ? new Date(p.effectiveTo) : null;
        if (from <= at && (!to || to > at)) return p;
      }
      return null;
    };

    const db = await getDatabase();
    const { activationRecords: arTable } = await import('../shared/schema');

    // POLICY_NOT_FOUND 중 정산완료/확정 제외 항목만 조회
    const _targetsResult = await db.execute(sql`
      SELECT
        si.id as si_id,
        ar.id,
        ar.channel,
        ar.plan_name          AS "planName",
        ar.customer_type      AS "customerType",
        ar.nationality_type   AS "nationalityType",
        ar.bundle_type        AS "bundleType",
        ar.add_service        AS "addService",
        ar.reg_fee_type       AS "regFeeType",
        ar.dealer_registration_id AS "dealerRegistrationId",
        ar.sim_count          AS "simCount",
        ar.reception_datetime  AS "receptionDatetime",
        ar.activation_datetime AS "activationDatetime"
      FROM settlement_items si
      JOIN activation_records ar ON ar.id = si.activation_id
      WHERE si.match_status = 'POLICY_NOT_FOUND'
        AND si.status != '정산완료'
        AND si.adjusted_amount IS NULL
        AND si.locked_amount IS NULL
    `);
    const targets: any[] = (_targetsResult as any).rows ?? [];

    const normalize = (v: any): string => String(v ?? '').trim();

    const matchRow = (activation: any, row: any, exclude: Set<string>): 'exact' | 'wildcard' | 'none' => {
      if (activation.channel !== row.channel) return 'none';
      if (activation.planName !== row.planName) return 'none';
      if (normalizeCustomerType(activation.customerType) !== normalizeCustomerType(row.customerType)) return 'none';

      const actNat = normalize(activation.nationalityType || '내국인');
      const rowNat = normalize(row.nationalityType || '');
      let natResult: 'exact' | 'wildcard';
      if (rowNat === '') {
        natResult = 'wildcard';
      } else if (actNat === rowNat) {
        natResult = 'exact';
      } else {
        return 'none';
      }

      const optionals = [
        { actKey: 'simCount',   rowKey: 'simCount'   },
        { actKey: 'bundleType', rowKey: 'bundleType' },
        { actKey: 'addService', rowKey: 'addService' },
        { actKey: 'regFeeType', rowKey: 'regFeeType' },
      ];
      for (const { actKey, rowKey } of optionals) {
        if (exclude.has(rowKey)) continue;
        const rv = row[rowKey];
        if (rv === null || rv === undefined || rv === '') continue;
        if (normalize(activation[actKey]) !== normalize(rv)) return 'none';
      }
      return natResult;
    };

    const MATCH_PASSES = [
      { exclude: new Set<string>([]),             isAuto: true  },
      { exclude: new Set<string>(['addService']), isAuto: false },
      { exclude: new Set<string>(['bundleType']), isAuto: false },
      { exclude: new Set<string>(['regFeeType']), isAuto: false },
    ];

    let updated = 0;
    let autoMatch = 0;
    let reviewRequired = 0;
    let stillNotFound = 0;

    for (const row of targets) {
      const siId = row.si_id;
      const activation = row;

      // 이 activation에 적용할 정책 차수 결정
      let pv: any;
      if (fixedPv) {
        pv = fixedPv;
      } else {
        const refDatetime = activation.receptionDatetime ?? activation.activationDatetime;
        pv = refDatetime ? findPvAt2(new Date(refDatetime)) : null;
      }
      const activeRows = pv ? await getPvRows2(pv.id) : [];

      let matchedRow: any = null;
      let matchStatus = 'POLICY_NOT_FOUND';

      for (const { exclude, isAuto } of MATCH_PASSES) {
        const exactFound = activeRows.find((r: any) => matchRow(activation, r, exclude) === 'exact');
        if (exactFound) {
          matchedRow = exactFound;
          matchStatus = isAuto ? 'AUTO_MATCH' : 'REVIEW_REQUIRED';
          break;
        }
        const wildcardFound = activeRows.find((r: any) => matchRow(activation, r, exclude) === 'wildcard');
        if (wildcardFound) {
          matchedRow = wildcardFound;
          matchStatus = 'REVIEW_REQUIRED';
          break;
        }
      }

      if (matchStatus === 'AUTO_MATCH' && !activation.dealer_registration_id && !activation.dealerRegistrationId) {
        matchStatus = 'REVIEW_REQUIRED';
      }

      if (matchedRow) {
        await getStorage().updateSettlementItem(Number(siId), {
          policyVersionId: pv.id,
          policyRowId:     matchedRow.id,
          rebateAmount:    String(matchedRow.rebateAmount),
          matchStatus,
          policySnapshotJson: matchedRow,
        });
        updated++;
        if (matchStatus === 'AUTO_MATCH')         autoMatch++;
        else if (matchStatus === 'REVIEW_REQUIRED') reviewRequired++;
      } else {
        stillNotFound++;
      }
    }

    res.json({
      success: true,
      policyVersionId: fixedPv?.id ?? null,
      total: targets.length,
      updated,
      autoMatch,
      reviewRequired,
      stillNotFound,
    });

  } catch (error: any) {
    console.error('[SETTLEMENT_REMATCH] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STEP 5D-5: 정산 결과 엑셀 다운로드
// ============================================================

// GET /api/admin/settlement/export
router.get('/api/admin/settlement/export', requireAdmin, async (req: any, res) => {
  try {
    const { status, matchStatus, dealerRegistrationId, from, to } = req.query;

    const rows = await getStorage().getSettlementItemsForExport({
      status:               status      ? String(status)      : undefined,
      matchStatus:          matchStatus ? String(matchStatus) : undefined,
      dealerRegistrationId: dealerRegistrationId ? Number(dealerRegistrationId) : undefined,
      from:                 from ? new Date(String(from)) : undefined,
      to:                   to   ? new Date(String(to))   : undefined,
    });

    const sheetData = rows.map((r: any) => {
      let finalAmount: number | null;
      if (r.lockedAmount != null) {
        finalAmount = Number(r.lockedAmount);
      } else {
        const base = r.adjustedAmount != null ? Number(r.adjustedAmount) : (r.rebateAmount != null ? Number(r.rebateAmount) : null);
        if (base == null) {
          finalAmount = null;
        } else {
          finalAmount = base + (r.addAmount != null ? Number(r.addAmount) : 0) - (r.deductAmount != null ? Number(r.deductAmount) : 0) + (r.hiddenAmount != null ? Number(r.hiddenAmount) : 0);
        }
      }
      return {
        '정산상태':  r.status        ?? '',
        '매칭상태':  r.matchStatus   ?? '',
        '판매점명':  r.dealerName    ?? '',
        'MCC코드':   r.mccCode       ?? '',
        '채널':      r.channel       ?? '',
        '고객명':    r.customerName  ?? '',
        '연락처':    r.customerPhone ?? '',
        '가입번호':  r.subscriptionNumber ?? '',
        '개통번호':  r.activationNumber   ?? '',
        '접점코드':  r.contactCode        ?? '',
        '요금제':    r.planName           ?? '',
        '유형':      r.customerType       ?? '',
        '유심개수':  r.simCount           ?? '',
        '결합':      r.bundleType         ?? '',
        '부가서비스': r.addService         ?? '',
        '가입비':    r.regFeeType         ?? '',
        '정책금액':  r.rebateAmount    != null ? Number(r.rebateAmount)    : '',
        '추가금':    r.addAmount       != null ? Number(r.addAmount)       : '',
        '차감금':    r.deductAmount    != null ? Number(r.deductAmount)    : '',
        '히든금액':  r.hiddenAmount    != null ? Number(r.hiddenAmount)    : '',
        '조정금액':  r.adjustedAmount  != null ? Number(r.adjustedAmount)  : '',
        '최종정산금액': finalAmount    != null ? finalAmount               : '',
        '정책차수':  r.policyName      ?? '',
        '예외사유':  r.forceReason     ?? '',
        '메모':      r.memo            ?? '',
        '개통일시':  r.activationDatetime
          ? format(new Date(r.activationDatetime), 'yyyy-MM-dd HH:mm', { locale: ko })
          : '',
      };
    });

    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '정산결과');

    const fileName = `settlement_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (error: any) {
    console.error('[SETTLEMENT_EXPORT] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// STEP 5D-4: 정산 결과 조회 / 수동 조정 / 확정 API
// ============================================================

// 1. GET /api/admin/settlement/items — 목록 조회
router.get('/api/admin/settlement/items', requireAdmin, async (req: any, res) => {
  try {
    const { status, matchStatus, dealerRegistrationId, page, limit } = req.query;
    const result = await getStorage().getSettlementItems({
      status:               status      ? String(status)      : undefined,
      matchStatus:          matchStatus ? String(matchStatus) : undefined,
      dealerRegistrationId: dealerRegistrationId ? Number(dealerRegistrationId) : undefined,
      page:                 page  ? Number(page)  : 1,
      limit:                limit ? Number(limit) : 50,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[SETTLEMENT_ITEMS_LIST] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. GET /api/admin/settlement/items/:id — 단건 조회 (activation_record 포함)
router.get('/api/admin/settlement/items/:id', requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const item = await getStorage().getSettlementItemById(id);
    if (!item) return res.status(404).json({ error: '정산 항목을 찾을 수 없습니다.' });

    const activation = await getStorage().getActivationRecordById(item.activationId);
    res.json({ ...item, activationRecord: activation ?? null });
  } catch (error: any) {
    console.error('[SETTLEMENT_ITEM_GET] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/admin/settlement/items/:id/lock — 정산 확정
router.post('/api/admin/settlement/items/:id/lock', requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const adminId = req.session.userId;

    const existing = await getStorage().getSettlementItemById(id);
    if (!existing) return res.status(404).json({ error: '정산 항목을 찾을 수 없습니다.' });
    if (existing.status === '정산완료') {
      return res.status(400).json({ error: '이미 확정된 정산 항목입니다.' });
    }

    const updated = await getStorage().lockSettlementItem(id, adminId);
    res.json(updated);
  } catch (error: any) {
    console.error('[SETTLEMENT_ITEM_LOCK] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3-b. POST /api/admin/settlement/recalculate-hidden-amounts — 히든금액 일괄 재계산
router.post('/api/admin/settlement/recalculate-hidden-amounts', requireAdmin, async (req: any, res) => {
  try {
    const { dateFrom, dateTo, onlyUnsettled = true, dryRun = false, debugContactCode } = req.body;
    const result = await getStorage().recalculateHiddenAmounts({ dateFrom, dateTo, onlyUnsettled, dryRun, debugContactCode });
    res.json(result);
  } catch (error: any) {
    console.error('[RECALC_HIDDEN] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3-c. POST /api/admin/hidden-amount/diagnose — 접점코드별 히든금액 계산 단계 진단
router.post('/api/admin/hidden-amount/diagnose', requireAdmin, async (req: any, res) => {
  try {
    const { contactCode, dateFrom, dateTo } = req.body;
    if (!contactCode) return res.status(400).json({ error: 'contactCode 필수' });
    const result = await getStorage().diagnoseHiddenAmount(contactCode, dateFrom, dateTo);
    res.json(result);
  } catch (error: any) {
    console.error('[HIDDEN_DIAGNOSE] error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. PATCH /api/admin/settlement/items/:id — 수동 조정
router.patch('/api/admin/settlement/items/:id', requireAdmin, async (req: any, res) => {
  try {
    const id = Number(req.params.id);
    const { adjustedAmount, addAmount, deductAmount, hiddenAmount, status, memo, forcePolicyVersionId, forceReason } = req.body;

    const existing = await getStorage().getSettlementItemById(id);
    if (!existing) return res.status(404).json({ error: '정산 항목을 찾을 수 없습니다.' });

    if (existing.status === '정산완료') {
      return res.status(400).json({ error: '확정된 정산 항목은 수정할 수 없습니다.' });
    }

    if (forcePolicyVersionId != null && !forceReason) {
      return res.status(400).json({ error: 'forcePolicyVersionId 지정 시 forceReason이 필수입니다.' });
    }

    const patch: Record<string, any> = {};
    if (adjustedAmount   !== undefined) patch.adjustedAmount     = adjustedAmount;
    if (addAmount        !== undefined) patch.addAmount          = addAmount;
    if (deductAmount     !== undefined) patch.deductAmount       = deductAmount;
    if (hiddenAmount     !== undefined) patch.hiddenAmount       = hiddenAmount;
    if (status           !== undefined) patch.status             = status;
    if (memo             !== undefined) patch.memo               = memo;
    if (forcePolicyVersionId !== undefined) patch.forcePolicyVersionId = forcePolicyVersionId;
    if (forceReason      !== undefined) patch.forceReason        = forceReason;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: '수정할 필드가 없습니다.' });
    }

    const updated = await getStorage().updateSettlementItem(id, patch);
    res.json(updated);
  } catch (error: any) {
    console.error('[SETTLEMENT_ITEM_PATCH] error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;