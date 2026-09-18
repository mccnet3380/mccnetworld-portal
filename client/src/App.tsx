import { useEffect, useState } from 'react';
import { Route, Switch, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuth } from '@/lib/auth';

// Pages
import { Login } from '@/pages/Login';
import { Dashboard } from '@/pages/Dashboard';
import { Documents } from '@/pages/Documents';
import { CompletedActivations } from '@/pages/CompletedActivations';
import { CancelledActivations } from '@/pages/CancelledActivations';
import { DiscardedDocuments } from '@/pages/DiscardedDocuments';
import { OtherCompletions } from '@/pages/OtherCompletions';
import { SubmitApplication } from '@/pages/SubmitApplication';
import { OtherApplication } from '@/pages/OtherApplication';
import { Downloads } from '@/pages/Downloads';
import { AdminPanel } from '@/pages/AdminPanel';
import { Settlements } from '@/pages/Settlements';
import { PerformanceManagement } from '@/pages/PerformanceManagement';
import { DailyPerformanceBoard } from '@/pages/DailyPerformanceBoard';
import { PerformanceClosing } from '@/pages/PerformanceClosing';
import { LgActivationAudit } from '@/pages/LgActivationAudit';
import { KtActivationAudit } from '@/pages/KtActivationAudit';

// 판매점 관련 페이지
import { DealerRegistration } from '@/pages/DealerRegistration';
import { DealerLogin } from '@/pages/DealerLogin';
import { DealerDashboard } from '@/pages/DealerDashboard';
import { DealerChat } from '@/pages/DealerChat';

import { TestPage } from '@/pages/TestPage';
import WorkRequests from '@/pages/WorkRequests';
import { WorkerChatList } from '@/pages/WorkerChatList';
import NotFound from '@/pages/not-found';
import SalesTeamManagement from '@/pages/SalesTeamManagement';

import SalesManagerDashboard from '@/pages/SalesManagerDashboard';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppRoutes() {
  const { isAuthenticated, user, checkAuth, sessionId } = useAuth();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initAuth = async () => {
      // 새로고침 시 기존 세션이 있으면 인증 확인
      if (sessionId && !isAuthenticated) {
        console.log('App init: Checking existing session');
        await checkAuth();
      }
      setIsLoading(false);
    };
    initAuth();
  }, [sessionId, isAuthenticated, checkAuth]); // sessionId와 isAuthenticated 변경 감지

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  // 영업과장은 실적 대시보드로 리다이렉트
  if (user && 'userType' in user && user.userType === 'sales_manager') {
    return (
      <Switch>
        <Route path="/" component={() => <Redirect to="/sales-manager-dashboard" />} />
        <Route path="/sales-manager-dashboard" component={SalesManagerDashboard} />
        {/* [LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1] 영업과장도 LG 검수 접근 허용 —
            이 분기는 sales_manager를 그 외 모든 경로에서 대시보드로 강제 리다이렉트하므로
            /lg-audit도 명시적으로 뚫어줘야 실제로 도달 가능하다. */}
        <Route path="/lg-audit" component={LgActivationAudit} />
        {/* [KT_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1] 영업과장도 KT 검수 접근 허용 — LG와 동일 이유 */}
        <Route path="/kt-audit" component={KtActivationAudit} />
        <Route component={() => <Redirect to="/sales-manager-dashboard" />} />
      </Switch>
    );
  }

  // 판매점은 판매점 전용 대시보드로 리다이렉트 (dealerId가 있는 사용자)
  if (user && 'dealerId' in user && user.dealerId) {
    return (
      <Switch>
        <Route path="/" component={() => <Redirect to="/dealer-dashboard" />} />
        <Route path="/dealer-dashboard" component={DealerDashboard} />
        <Route path="/submit" component={SubmitApplication} />
        <Route path="/submit-application" component={SubmitApplication} />
        <Route path="/other-application" component={OtherApplication} />
        <Route path="/dealer-chat/:documentId" component={DealerChat} />
        <Route component={() => <Redirect to="/dealer-dashboard" />} />
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/submit-application" component={SubmitApplication} />
      <Route path="/submit" component={SubmitApplication} />
      <Route path="/other-application" component={OtherApplication} />
      <Route path="/documents" component={Documents} />

      <Route path="/work-requests" component={WorkRequests} />
      <Route path="/chat" component={WorkerChatList} />
      <Route path="/completed" component={CompletedActivations} />
      <Route path="/completed-activations" component={CompletedActivations} />
      <Route path="/cancelled" component={CancelledActivations} />
      <Route path="/discarded" component={DiscardedDocuments} />
      <Route path="/other-completions" component={OtherCompletions} />
      <Route path="/downloads" component={Downloads} />

      {/* MCC_SETTLEMENT_RESULT_COMPACT_UI_AND_SELECT_DELETE_1: 정산 관리 화면 미사용으로 라우트 숨김 (복원 시 아래 블록 주석 해제)
      {user?.userType === 'admin' && (
        <Route path="/settlements" component={Settlements} />
      )}
      */}

      {/* MCC_PERFORMANCE_SITE_INTEGRATION_1: 실적관리/전사 공지용 당일실적 — admin/worker 등 내부 사용자 조회 가능 */}
      <Route path="/performance" component={PerformanceManagement} />
      <Route path="/performance/daily" component={DailyPerformanceBoard} />

      {/* [PERFORMANCE_CLOSING_WORKER_ACCESS_FIX_1] 마감보고 · 공지텍스트는 관리자 전용이
          아니라 내부 WORKER가 실제 업무에서 쓰는 화면이다 — admin뿐 아니라 내부 user(worker)도
          접근 가능해야 한다. 이 블록에는 dealer(위에서 이미 별도 라우트로 분리됨)와
          sales_manager(위에서 이미 별도 라우트로 분리됨)는 도달하지 않으므로, userType이
          'admin' 또는 'user'(worker)인 경우에만 허용한다. 화면/기능/계산/JPG는 무변경. */}
      {(user?.userType === 'admin' || user?.userType === 'user') && (
        <Route path="/performance/closing" component={PerformanceClosing} />
      )}

      {/* [LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1] LG 검수: admin/sales_manager/내부
          WORKER만 허용, dealer 차단. dealer 계정도 userType='user'로 저장되므로 userType만으로는
          내부 WORKER를 구분할 수 없다(감사에서 확인) — dealerId/dealerRegistrationId가 둘 다
          없어야 내부 WORKER로 취급한다. 실제 게이트는 server/routes/lg-audit.ts의
          requireLgAuditAccess이며, 이 조건은 화면 노출용 UX일 뿐이다. */}
      {(user?.userType === 'admin' ||
        user?.userType === 'sales_manager' ||
        (user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId)) && (
        <Route path="/lg-audit" component={LgActivationAudit} />
      )}

      {/* [KT_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1] KT 검수: LG와 동일한 권한 조건.
          실제 게이트는 server/routes/kt-audit.ts의 requireInternalOrAdminAccess. */}
      {(user?.userType === 'admin' ||
        user?.userType === 'sales_manager' ||
        (user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId)) && (
        <Route path="/kt-audit" component={KtActivationAudit} />
      )}

      {user?.userType === 'admin' && (
        <>
          <Route path="/admin" component={() => <AdminPanel />} />
          <Route path="/admin-panel" component={() => <AdminPanel />} />
          <Route
            path="/admin/other-business-carriers"
            component={() => <AdminPanel defaultTab="other-business-carriers" />}
          />

          <Route path="/sales-team-management" component={SalesTeamManagement} />
          <Route path="/test" component={TestPage} />
        </>
      )}

      <Route component={NotFound} />
    </Switch>
  );
}

// 영업과장 전용 라우터 (인증 없이 접근 가능)
function SalesManagerRoutes() {
  return (
    <Switch>
      <Route path="/sales-manager-dashboard" component={SalesManagerDashboard} />
      <Route component={() => <Redirect to="/sales-manager-dashboard" />} />
    </Switch>
  );
}

// 메인 앱 라우터
function MainApp() {
  return (
    <Switch>
      {/* 판매점 관련 라우트 (인증 없이 접근 가능) */}
      <Route path="/dealer-registration" component={DealerRegistration} />
      <Route path="/dealer-login" component={DealerLogin} />

      {/* 영업과장 대시보드 (인증 우회) */}
      <Route path="/sales-manager-dashboard" component={SalesManagerDashboard} />

      {/* 기존 인증이 필요한 라우트 */}
      <Route>
        <AuthGuard fallback={<Login />}>
          <AppRoutes />
        </AuthGuard>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MainApp />
      <Toaster />
    </QueryClientProvider>
  );
}
