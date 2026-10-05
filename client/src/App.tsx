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
import { PersonalPerformance } from '@/pages/PersonalPerformance';
import { WorkerPerformanceOverview } from '@/pages/WorkerPerformanceOverview';
import { DailyPerformanceBoard } from '@/pages/DailyPerformanceBoard';
import { PerformanceClosing } from '@/pages/PerformanceClosing';
import { LgActivationAudit } from '@/pages/LgActivationAudit';
import { KtActivationAudit } from '@/pages/KtActivationAudit';
import { TrainingCenter } from '@/pages/TrainingCenter';
import { TrainingArticleDetail } from '@/pages/TrainingArticleDetail';
import { TypingVersions } from '@/pages/TypingVersions';
import { SheetViewer } from '@/pages/SheetViewer';

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
        {/* [MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1] 영업과장도 교육자료
            접근 허용 — LG/KT 검수와 동일한 "내부 직원" 위상으로 취급(Sidebar/백엔드와 일관). */}
        <Route path="/training" component={TrainingCenter} />
        <Route path="/training/:id" component={TrainingArticleDetail} />
        {/* [MCC_TYPING_VERSION_MANAGER_CURRENT_PREVIOUS_DRAFT_INTEGRATION_1] 영업과장도 타이핑
            버전관리 접근 허용 — LG/KT 검수·교육자료와 동일한 "내부 직원" 위상. */}
        <Route path="/typing" component={TypingVersions} />
        {/* [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 개통현황 조회가 개통 후
            자동검수 센터로 확장되면서 sales_manager 접근을 제거했다(감사 지시 §7 — 중간관리자
            검수 권한은 sales_manager 전체에 자동 부여하지 않는다). 서버 권한도 동일하게
            좁혔다(server/routes/sheet-viewer.ts requireSheetViewerAccess). */}
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

  // [MCC_PERFORMANCE_CALCULATION_AND_WORKER_LIFECYCLE_FINAL_FIX_1] 기본 landing을
  // ADMIN은 /performance, 내부 WORKER는 /performance/me로 변경(요구사항). /performance/me
  // 라우트 조건(아래)과 동일한 기준(admin 또는 dealerId/dealerRegistrationId가 없는
  // user)을 그대로 재사용한다.
  // [MCC_SIDEBAR_HIERARCHY_AND_LEGACY_DASHBOARD_REMOVAL_1] 과거에는 이 조건에 해당하지
  // 않는 예외 케이스를 /dashboard(레거시 Dashboard)로 보냈으나, 이번 작업에서 /dashboard를
  // "렌더링"이 아니라 "리다이렉트"로 바꾸므로 그 폴백이 더 이상 /dashboard를 가리키면 안
  // 된다(자기 자신으로 리다이렉트되어 무한루프가 날 수 있는 유일한 경로 — 예: dealerId 없이
  // dealerRegistrationId만 있는 신규 판매점 계정처럼 위 두 분기 중 어느 것에도 안 걸리는
  // 극히 드문 경우). 새 기준을 만들지 않고, 이미 모든 계정 유형에 안전하게 열려있는 기존
  // 라우트 /documents로 폴백한다(접수관리 — admin/내부근무자/현재 이 분기에 도달하는 모든
  // 계정이 실제로 접근 가능한 기존 페이지).
  const isInternalWorker = user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId;
  const landingPath = user?.userType === 'admin' ? '/performance' : isInternalWorker ? '/performance/me' : '/documents';

  return (
    <Switch>
      <Route path="/" component={() => <Redirect to={landingPath} />} />
      {/* [MCC_SIDEBAR_HIERARCHY_AND_LEGACY_DASHBOARD_REMOVAL_1] 레거시 Dashboard 직접
          접근 차단 — 주소창에 /dashboard를 직접 입력해도 더 이상 구 Dashboard가 뜨지 않고
          사용자 유형별 정상 진입 페이지로 리다이렉트한다("/" 라우트와 동일한 landingPath
          재사용, 새 기준 생성 금지). Dashboard 컴포넌트/import·관련 API는 삭제하지 않았다
          (복원이 필요하면 아래 Route를 component={Dashboard}로 되돌리기만 하면 됨). */}
      <Route path="/dashboard" component={() => <Redirect to={landingPath} />} />
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

      {/* [MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1] 실적관리(/performance, 전체
          근무자 실적 + 월별 인원·목표)는 관리자 전용으로 변경 — 일반 worker는 다른 근무자의
          실적/목표/매핑을 볼 수 없어야 한다(요구사항). Sidebar에서도 이미 숨김 처리했지만,
          여기서도 admin이 아니면 라우트 자체를 등록하지 않아 직접 URL 접근도 NotFound로
          막는다. 실제 데이터 보호는 server/routes/performance.ts의 requireInternalSession +
          비관리자 응답 redaction(dataset.workers/workerMatrix 제거)이 진짜 게이트다. */}
      {user?.userType === 'admin' && (
        <Route path="/performance" component={PerformanceManagement} />
      )}
      {/* MCC_PERFORMANCE_SITE_INTEGRATION_1: 전사 공지용 당일실적 — admin/worker 등 내부 사용자 조회 가능 */}
      <Route path="/performance/daily" component={DailyPerformanceBoard} />

      {/* [MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1] 개인 실적: admin/내부 WORKER만.
          sales_manager는 이 기능(내부 개통 근무자 실적) 대상이 아니라 제외한다(요구사항).
          dealer는 dealerId/dealerRegistrationId 재조회 기준으로 제외. 실제 게이트는
          server/routes/personal-performance.ts의 requirePersonalPerformanceSession. */}
      {(user?.userType === 'admin' ||
        (user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId)) && (
        <Route path="/performance/me" component={PersonalPerformance} />
      )}

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

      {/* [MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1] 교육자료: LG/KT 검수와
          동일한 권한 조건(admin/sales_manager/내부 WORKER, dealer 차단). 실제 게이트는
          server/routes/training.ts의 requireTrainingViewer/requireTrainingAdmin. */}
      {(user?.userType === 'admin' ||
        user?.userType === 'sales_manager' ||
        (user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId)) && (
        <>
          <Route path="/training" component={TrainingCenter} />
          <Route path="/training/:id" component={TrainingArticleDetail} />
        </>
      )}

      {/* [MCC_TYPING_VERSION_MANAGER_CURRENT_PREVIOUS_DRAFT_INTEGRATION_1] 타이핑 버전관리:
          LG/KT 검수·교육자료와 동일한 권한 조건(admin/sales_manager/내부 WORKER, dealer
          차단). 실제 게이트는 server/routes/typing-versions.ts의
          requireTypingViewer/requireTypingAdmin(쓰기/개발도구/운영적용은 admin 전용). */}
      {(user?.userType === 'admin' ||
        user?.userType === 'sales_manager' ||
        (user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId)) && (
        <Route path="/typing" component={TypingVersions} />
      )}

      {/* [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 개통현황 조회가 개통 후
          자동검수 센터로 확장되면서 권한을 좁혔다: admin 또는 내부 middle_manager
          (userRole==='middle_manager')만. 일반 WORKER·sales_manager·dealer는 차단.
          실제 게이트는 server/routes/sheet-viewer.ts의 requireSheetViewerAccess(서버에서도
          동일하게 강제, 사이드바 숨김만으로 끝내지 않음). */}
      {(user?.userType === 'admin' ||
        (user?.userType === 'user' && !user?.dealerId && !user?.dealerRegistrationId && user?.userRole === 'middle_manager')) && (
        <Route path="/sheet-viewer" component={SheetViewer} />
      )}

      {user?.userType === 'admin' && (
        <>
          <Route path="/admin" component={() => <AdminPanel />} />
          <Route path="/admin-panel" component={() => <AdminPanel />} />
          <Route
            path="/admin/other-business-carriers"
            component={() => <AdminPanel defaultTab="other-business-carriers" />}
          />
          {/* [MCC_SIDEBAR_HIERARCHY_AND_LEGACY_DASHBOARD_REMOVAL_1] 정산 결과/정산 정책 —
              AdminPanel.tsx의 기존 TabsContent(value="settlement-results"/"policy-versions")를
              그대로 재사용한다. 위 /admin/other-business-carriers와 동일한 패턴으로, 새
              component/계산/API를 만들지 않고 진입 경로(route)만 추가했다. */}
          <Route
            path="/settlement/results"
            component={() => <AdminPanel defaultTab="settlement-results" />}
          />
          <Route
            path="/settlement/policies"
            component={() => <AdminPanel defaultTab="policy-versions" />}
          />
          {/* [MCC_ADMIN_WORKER_PERFORMANCE_OVERVIEW_1] 근무자 실적(관리자 전용) — 메뉴
              숨김만으로 끝내지 않고, 이 Route 자체가 user?.userType === 'admin' 블록
              안에만 등록되어 있어 admin이 아니면 이 경로는 존재하지 않는다(NotFound로
              떨어짐). 서버도 별도로 requireAdminSession으로 admin만 허용(서버 §13). */}
          <Route path="/admin/worker-performance" component={WorkerPerformanceOverview} />

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
