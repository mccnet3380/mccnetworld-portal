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
      {user?.userType === 'admin' && (
        <Route path="/settlements" component={Settlements} />
      )}

      {user?.userType === 'admin' && (
        <>
          <Route path="/admin" component={() => <AdminPanel />} />
          <Route path="/admin-panel" component={() => <AdminPanel />} />
          <Route path="/admin/other-business-carriers" component={() => <AdminPanel defaultTab="other-business-carriers" />} />
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