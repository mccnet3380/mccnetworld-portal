import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthResponse } from '../../../shared/schema';

interface AuthState {
  user: AuthResponse['user'] | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  login: (credentials: { username: string; password: string }) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionId: null,
      isAuthenticated: false,

      login: async (credentials) => {
        try {
          console.log('Attempting login with credentials');
          
          // 통합 로그인 API 호출 (관리자, 근무자, 영업과장 모두 처리)
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(credentials),
          });

          console.log('Login response status:', response.status, response.ok);

          if (response.ok) {
            const data: AuthResponse = await response.json();
            console.log('Login response data:', data);
            
            if (data.success && data.user && data.sessionId) {
              console.log('Setting auth state:', {
                user: data.user,
                sessionId: data.sessionId?.substring(0, 8) + '...',
                isAuthenticated: true,
              });
              
              set({
                user: data.user,
                sessionId: data.sessionId,
                isAuthenticated: true,
              });
              return true;
            }
          }

          // 로그인 실패
          const errorData = await response.json().catch(() => ({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }));
          console.error('Login failed:', errorData);
          throw new Error(errorData.error || '아이디 또는 비밀번호가 올바르지 않습니다.');

        } catch (error) {
          console.error('Login error:', error);
          return false;
        }
      },

      logout: async () => {
        const { sessionId } = get();
        if (sessionId) {
          try {
            await fetch('/api/auth/logout', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${sessionId}`,
              },
              credentials: 'include',
            });
          } catch (error) {
            console.error('Logout error:', error);
          }
        }

        set({
          user: null,
          sessionId: null,
          isAuthenticated: false,
        });
      },

      checkAuth: async () => {
        const { sessionId } = get();
        if (!sessionId) {
          console.log('No sessionId found - clearing auth state');
          set({
            user: null,
            sessionId: null,
            isAuthenticated: false,
          });
          return false;
        }

        try {
          console.log('Checking auth with sessionId:', sessionId ? 'exists' : 'missing');
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${sessionId}`,
            },
            credentials: 'include',
          });

          console.log('Auth check response:', response.status, response.ok);

          if (response.ok) {
            const data: AuthResponse = await response.json();
            console.log('Auth check data:', data);
            if (data.success && data.user) {
              set({
                user: data.user,
                sessionId: sessionId,
                isAuthenticated: true,
              });
              return true;
            }
          }
          
          // 401/403 응답 시 세션 무효 - 즉시 로그아웃 처리
          if (response.status === 401 || response.status === 403) {
            console.log('Auth failed (401/403) - clearing all session data');
            set({
              user: null,
              sessionId: null,
              isAuthenticated: false,
            });
            return false;
          }
          
          // 기타 오류 (500, 네트워크 등) - 인증 상태만 false로 설정하고 세션 유지
          console.log('Auth check failed with status:', response.status, '- keeping session for retry');
          set({
            isAuthenticated: false,
          });
          return false;
        } catch (error) {
          console.error('Auth check error:', error);
          // 네트워크 오류 시에는 세션 정보를 유지하고 인증 상태만 false
          set({
            isAuthenticated: false,
          });
          return false;
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        sessionId: state.sessionId,
        isAuthenticated: state.isAuthenticated,
      }),
      // 세션 복원시 자동으로 인증 확인하도록 설정
      onRehydrateStorage: () => (state) => {
        if (state?.sessionId) {
          // 페이지 로드 시 세션이 있으면 자동으로 인증 확인
          console.log('Rehydrating auth state - verifying session');
          setTimeout(() => {
            state.checkAuth();
          }, 100);
        }
      },
    }
  )
);

// Custom hook for API requests with authentication
export const useApiRequest = () => {
  const sessionId = useAuth((state) => state.sessionId);

  const apiRequest = async (url: string, options: RequestInit = {}) => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
    };

    // Only add Content-Type for non-FormData requests
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    if (sessionId) {
      headers['Authorization'] = `Bearer ${sessionId}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    console.log('API Response:', {
      url,
      status: response.status,
      ok: response.ok,
      statusText: response.statusText
    });

    if (!response.ok) {
      console.error('API request failed:', {
        url,
        status: response.status,
        statusText: response.statusText
      });
      const errorData = await response.json().catch(() => ({ error: '요청에 실패했습니다.' }));
      const error = new Error(errorData.error || '요청에 실패했습니다.') as any;
      // 상세 정보를 에러 객체에 포함
      error.details = errorData.details;
      error.totalErrors = errorData.totalErrors;
      error.addedCodes = errorData.addedCodes;
      throw error;
    }

    return response.json();
  };

  return apiRequest;
};
