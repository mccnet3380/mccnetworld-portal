// server/auth-routes.ts - Simple authentication routes
import { Router } from "express";
import { z } from "zod";
import { getStorage } from "./storage";
import { loginSchema, AuthResponse } from "../shared/schema";

const authRouter = Router();

// Create admin schema
const createAdminSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username too long'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(1, 'Name is required').max(100, 'Name too long')
});

// 🚨 CRITICAL: 세션 토큰 마스킹 유틸리티
function maskSessionToken(token: string): string {
  if (!token || token.length < 8) return '***';
  return token.substring(0, 4) + '***' + token.substring(token.length - 4);
}

// Password masking utility  
function maskPassword(password: string): string {
  return password ? '***' : 'empty';
}

// Authentication routes
authRouter.post('/login', async (req, res) => {
  try {
    console.log('Login attempt - body:', req.body);
    const { username, password } = loginSchema.parse(req.body);
    console.log('Login attempt - parsed:', { username, password: password ? '***' : 'empty' });
    
    // Try admin login first
    console.log('Authenticating admin:', username);
    const admin = await getStorage().authenticateAdmin(username, password);
    console.log('Admin found:', admin ? 'yes' : 'no');
    console.log('Admin auth result:', admin ? 'success' : 'failed');
    
    if (admin) {
      const sessionId = await getStorage().createSession(admin.id, 'admin');
      console.log('Session created:', maskSessionToken(sessionId));
      
      const response: AuthResponse = {
        success: true,
        user: {
          id: admin.id,
          name: admin.name,
          username: admin.username,
          userType: 'admin'
        },
        sessionId
      };
      return res.json(response);
    }

    // Try user login (includes workers, sales managers, and other users)
    console.log('Authenticating user:', username);
    const userResult = await getStorage().authenticateUser(username, password);
    console.log('User found:', userResult ? 'yes' : 'no');
    console.log('User auth result:', userResult ? 'success' : 'failed');
    
    if (userResult) {
      // Verify that this is NOT a dealer (dealers must use dealer-login)
      if (userResult.dealerId) {
        console.log('Worker login rejected - user is a dealer:', username, 'dealerId:', userResult.dealerId);
        return res.status(403).json({ 
          success: false, 
          error: '판매점 계정입니다. 판매점 로그인 페이지를 이용해주세요.' 
        });
      }
      
      const sessionId = await getStorage().createSession(
        userResult.id, 
        userResult.userType || 'user'
      );
      console.log('User session created:', sessionId, 'Type:', userResult.userType);
      
      const response: AuthResponse = {
        success: true,
        user: {
          id: userResult.id,
          name: userResult.name || username,
          username: username,
          userType: userResult.userType || 'user'
        },
        sessionId
      };
      return res.json(response);
    }

    res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// Dealer login route
authRouter.post('/dealer-login', async (req, res) => {
  try {
    console.log('Dealer login attempt - body:', req.body);
    const { username, password } = loginSchema.parse(req.body);
    console.log('Dealer login attempt - parsed:', { username, password: password ? '***' : 'empty' });
    
    // Authenticate dealer (stored as user with userType='user' and dealerId set)
    console.log('Authenticating dealer:', username);
    const userResult = await getStorage().authenticateUser(username, password);
    console.log('Dealer found:', userResult ? 'yes' : 'no');
    console.log('Dealer auth result:', userResult ? 'success' : 'failed');
    
    if (userResult) {
      // Verify that this is actually a dealer (must have dealerId)
      if (!userResult.dealerId) {
        console.log('Dealer login rejected - user does not have dealerId:', username);
        return res.status(403).json({ 
          success: false, 
          error: '판매점 계정이 아닙니다. 직원 로그인 페이지를 이용해주세요.' 
        });
      }
      
      const sessionId = await getStorage().createSession(
        userResult.id, 
        userResult.userType || 'user'
      );
      console.log('Dealer session created:', maskSessionToken(sessionId), 'Type:', userResult.userType, 'DealerId:', userResult.dealerId);
      
      const response: AuthResponse = {
        success: true,
        user: {
          id: userResult.id,
          name: userResult.name || username,
          username: username,
          userType: userResult.userType || 'user',
          dealerId: userResult.dealerId,
          userRole: userResult.role
        },
        sessionId
      };
      return res.json(response);
    }

    res.status(401).json({ success: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  } catch (error: any) {
    console.error('Dealer login error:', error);
    res.status(400).json({ success: false, error: error.message });
  }
});

// 🚨 CRITICAL: 부트스트랩 게이트로 보호된 관리자 생성 엔드포인트
// 관리자가 없을 때만 첫 관리자 생성을 허용 (보안 필수)
authRouter.post('/create-admin', async (req, res) => {
  try {
    console.log('🔒 Create admin attempt - checking bootstrap gate');
    
    // 🚨 CRITICAL: 부트스트랩 게이트 - 관리자가 이미 존재하면 차단
    const adminCount = await getStorage().getAdminCount();
    console.log(`Admin count check: ${adminCount} existing admins`);
    
    if (adminCount > 0) {
      console.log('🚨 SECURITY BLOCK: Admin creation attempt blocked - admin already exists');
      return res.status(403).json({
        error: 'Forbidden: Admin already exists. Admin creation is only allowed during initial setup.',
        code: 'BOOTSTRAP_GATE_BLOCKED',
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('✅ Bootstrap gate passed - no existing admins, allowing creation');
    
    const { username, password, name } = createAdminSchema.parse(req.body);
    console.log('Create admin - parsed:', { username, name, password: maskPassword(password) });
    
    // Check if username already exists (secondary check)
    console.log('Checking for existing admin by username:', username);
    const existingAdmin = await getStorage().getAdminByUsername(username);
    
    if (existingAdmin) {
      console.log('Admin creation failed - username already exists:', username);
      return res.status(409).json({
        error: 'Username already exists'
      });
    }
    
    // Create new admin (only allowed during bootstrap)
    console.log('Creating first admin:', username);
    const newAdmin = await getStorage().createAdmin({
      username,
      password,
      name
    });
    
    console.log('✅ Bootstrap admin created successfully:', { id: newAdmin.id, username: newAdmin.username, name: newAdmin.name });
    
    return res.status(201).json({
      success: true,
      adminId: newAdmin.id,
      message: 'Bootstrap admin created successfully',
      isBootstrap: true
    });
    
  } catch (error) {
    console.error('Create admin error:', error);
    
    // Handle validation errors
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: error.errors[0]?.message || 'Invalid input data'
      });
    }
    
    // Handle other errors
    return res.status(500).json({
      error: 'Internal server error while creating admin'
    });
  }
});

// 현재 사용자 정보 조회 API
authRouter.get('/me', async (req, res) => {
  // 캐시 금지 헤더 추가 (CDN/프록시/브라우저 캐싱 방지)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Cookie, Authorization');
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '인증이 필요합니다.' });
  }
  
  const sessionId = authHeader.replace('Bearer ', '');
  const session = await getStorage().getSession(sessionId);
  
  if (!session) {
    return res.status(401).json({ success: false, error: '유효하지 않은 세션입니다.' });
  }

  try {
    const userId = session.userId;
    const userType = session.userType;
    
    if (userType === 'admin') {
      const admin = await getStorage().getAdminById(userId);
      if (admin) {
        return res.json({
          success: true,
          user: {
            id: admin.id,
            name: admin.name,
            username: admin.username,
            userType: 'admin'
          }
        });
      }
    } else if (userType === 'sales_manager') {
      const manager = await getStorage().getSalesManagerById(userId);
      if (manager) {
        return res.json({
          success: true,
          user: {
            id: manager.id,
            name: manager.managerName,
            userType: 'sales_manager'
          }
        });
      }
    } else {
      const user = await getStorage().getUserById(userId);
      if (user) {
        return res.json({
          success: true,
          user: {
            id: user.id,
            name: user.name,
            username: user.username,
            userType: user.userType || 'user',
            dealerId: user.dealerId,
            userRole: user.role
          }
        });
      }
    }
    
    res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.' });
  } catch (error: any) {
    console.error('Auth me error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 로그아웃 API
authRouter.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  
  const sessionId = authHeader.replace('Bearer ', '');
  
  try {
    await getStorage().deleteSession(sessionId);
    console.log(`✅ Session deleted: ${maskSessionToken(sessionId)}`);
    res.json({ success: true, message: 'Successfully logged out' });
  } catch (error: any) {
    console.error('Logout error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default authRouter;
