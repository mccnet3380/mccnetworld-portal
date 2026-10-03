import { Link, useLocation } from 'wouter';
import { useAuth, useApiRequest } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  FileText,
  Download,
  BarChart3,
  Settings,
  TestTube,
  Calculator,
  CheckCircle,
  X,
  Clock,
  Star,
  Trash2,
  Users,
  FileEditIcon,
  MessageCircle,
  Megaphone,
  ClipboardCheck,
  FileSearch,
  TrendingUp,
  GraduationCap,
  FileSpreadsheet,
  LayoutTemplate
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import logoImage from '@assets/KakaoTalk_20250626_162541112-removebg-preview_1751604392501.png';

// [MCC_PERFORMANCE_CALCULATION_AND_WORKER_LIFECYCLE_FINAL_FIX_1] "대시보드" 메뉴를
// navigation 목록에서 제거해 Sidebar에서만 숨긴다 — Dashboard 컴포넌트/라우트/API는
// 전혀 삭제하지 않았다(App.tsx의 "/dashboard" 라우트는 그대로 유지, 직접 URL 접근 가능).
const navigation = [
  // [MCC_SIDEBAR_REORDER_AND_REMAINING_DATE_PREFIX_MATCH_ROOT_FIX_1] "개인 실적"을
  // navigation 배열의 맨 앞으로 이동(요구사항 — 표시 위치만 변경). 아래 role별
  // filter(sales_manager 제외/dealer 허용목록)는 이름 기준으로 동작해서 배열 순서와
  // 무관하게 그대로 유지된다 — 권한/라우트/아이콘/active 스타일은 전혀 건드리지 않았다.
  // MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1: 로그인 계정에 연결된 실적
  // 작업자 기준 본인 실적만 표시. sales_manager는 이 기능 대상이 아니라 아래
  // isSalesManager 필터에서 제외한다(요구사항). dealer는 dealerAllowedMenus로 제외.
  { name: '개인 실적', href: '/performance/me', icon: TrendingUp },
  // [MCC_SIDEBAR_MENU_VISIBILITY_LIVE_APPLY_LAYOUT_OWNER_ONLY_FIX_1] 아래 7개는
  // 과거 MCC_SIDEBAR_UNUSED_MENU_HIDE_1에서 정적 hidden:true로 숨겼던 항목이다.
  // "사이드바 메뉴 관리"(DB 기반 visibility)가 생긴 이후로는 그 정적 플래그를
  // 완전히 대체한다 — 더 이상 hidden 속성을 두지 않고, 아래 role 필터링도
  // hidden을 더 이상 참조하지 않는다. 표시/숨김은 전부 sidebar_menu_visibility
  // 테이블(관리자 패널 "사이드바 메뉴 관리")로만 제어한다. 페이지/App.tsx
  // 라우트/서버 API/권한/컴포넌트는 전혀 삭제하지 않았다.
  { name: '접수 관리', href: '/documents', icon: FileText },
  { name: '업무 진행', href: '/work-requests', icon: Clock },
  { name: '개통 완료', href: '/completed', icon: CheckCircle },
  { name: '기타 완료', href: '/other-completions', icon: Star },
  { name: '개통 취소', href: '/cancelled', icon: X },
  { name: '폐기', href: '/discarded', icon: Trash2 },
  { name: '서식지', href: '/downloads', icon: Download },
  // MCC_SETTLEMENT_RESULT_COMPACT_UI_AND_SELECT_DELETE_1: 정산 관리 화면 미사용으로 메뉴 숨김 (복원 시 아래 줄 주석 해제)
  // { name: '정산 관리', href: '/settlements', icon: Calculator },
  // MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1: '실적관리'(/performance, 전체
  // 근무자 실적)는 이 공통 navigation에서 제거했다 — 관리자 전용 메뉴로 별도
  // performanceManagementNavItem으로 분리해서 isAdmin일 때만 currentNavigation 맨 앞에
  // 붙인다(아래 참고). 일반 worker/딜러는 여기 남아있는 목록에 실적관리가 없으므로
  // 자동으로 노출되지 않는다.
  { name: '전사 공지용 당일실적', href: '/performance/daily', icon: Megaphone },
  // [PERFORMANCE_CLOSING_WORKER_ACCESS_FIX_1] 마감보고 · 공지텍스트는 관리자 전용 기능이
  // 아니라 내부 WORKER가 실제 업무에서 쓰는 화면이다 — admin-only 목록에서 제거하고
  // 여기(관리자/워커 공통, dealer는 dealerAllowedMenus로 별도 필터링되어 노출 안 됨)로 옮겼다.
  // 화면 기능/계산/JPG는 전혀 건드리지 않았다 — 메뉴 노출 위치만 이동.
  { name: '마감보고 · 공지텍스트', href: '/performance/closing', icon: ClipboardCheck },
  // LG_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1: LG 검수 — 내부 작업자용 업무 기능(관리자
  // 설정이 아님). admin/worker/sales_manager 공통 navigation에 배치하고, dealer는 아래
  // dealerAllowedMenus 필터링으로 계속 제외된다. 실제 권한 게이트는 서버
  // (server/routes/lg-audit.ts의 requireLgAuditAccess)이며 이 메뉴 노출은 UX일 뿐이다.
  { name: 'LG 검수', href: '/lg-audit', icon: FileSearch },
  // KT_ACTIVATION_AUDIT_MCC_SITE_IMPLEMENTATION_1: KT 검수 — LG 검수와 동일한 위상의
  // 내부 작업자용 업무 기능. LG 검수 바로 아래 배치, dealer는 dealerAllowedMenus로 계속 제외.
  { name: 'KT 검수', href: '/kt-audit', icon: FileSearch },
  // MCC_TRAINING_CENTER_CHANNEL_SEPARATION_AND_ADMIN_EDITOR_1: 교육자료 — 중립과 완전히
  // 독립된 사내 교육센터. LG/KT 검수와 동일한 위상(admin/sales_manager/내부 worker,
  // dealer는 dealerAllowedMenus로 계속 제외)이라 바로 아래 배치. 실제 권한 게이트는
  // server/routes/training.ts의 requireTrainingViewer/requireTrainingAdmin.
  { name: '교육자료', href: '/training', icon: GraduationCap },
  // MCC_TYPING_VERSION_MANAGER_CURRENT_PREVIOUS_DRAFT_INTEGRATION_1: 타이핑 — 별도
  // MCCNETWORLD/public 프로젝트의 기존 타이핑 사이트를 CURRENT/PREVIOUS/DRAFT로
  // 버전관리하며 그대로 재사용. LG/KT 검수·교육자료와 동일한 위상(admin/sales_manager/
  // 내부 worker, dealer는 dealerAllowedMenus로 계속 제외). 실제 게이트는
  // server/routes/typing-versions.ts의 requireTypingViewer/requireTypingAdmin.
  { name: '타이핑', href: '/typing', icon: LayoutTemplate },
  // [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 개통현황 조회가 개통 후
  // 자동검수 센터로 확장되면서 권한을 admin/내부 middle_manager로 좁혔다(기존: admin/
  // sales_manager/내부 worker 전원). 아래 role별 filter에서 sales_manager/일반 WORKER는
  // 이 항목을 제외하고, middle_manager(role='middle_manager')만 남긴다. 실제 게이트는
  // server/routes/sheet-viewer.ts의 requireSheetViewerAccess.
  { name: '개통현황 조회', href: '/sheet-viewer', icon: FileSpreadsheet },
];

const adminNavigation = [
  { name: '관리자', href: '/admin-panel', icon: Settings },
  // [MCC_SIDEBAR_MENU_VISIBILITY_LIVE_APPLY_LAYOUT_OWNER_ONLY_FIX_1] 과거 정적
  // hidden:true 대신 "사이드바 메뉴 관리"(DB) 설정으로 표시 여부를 제어한다.
  // /sales-team-management 라우트/권한/컴포넌트는 그대로 유지.
  { name: '영업 조직', href: '/sales-team-management', icon: Users },
];

// MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1: 실적관리(전체 근무자 실적)는
// 관리자만 볼 수 있다 — 일반 navigation에는 넣지 않고 isAdmin일 때만 앞에 붙인다.
const performanceManagementNavItem = { name: '실적관리', href: '/performance', icon: BarChart3 };

// [MCC_SIDEBAR_MENU_VISIBILITY_ADMIN_CONTROL_1] 메뉴 이름(화면 표시 문자열) → 안정적인
// 내부 menuKey 매핑. menuKey는 server/routes.ts의 SIDEBAR_MENU_KEYS와 1:1 대응한다.
// 이 맵은 "표시 여부"만 조회하는 데 쓰이며, 기존 role 기반 필터링(canViewMenu에 해당하는
// 위 baseNavigation/currentNavigation 로직)은 전혀 건드리지 않는다 — 그 결과 위에
// AND 조건으로 한 번 더 좁히는 용도.
const SIDEBAR_MENU_KEY_BY_NAME: Record<string, string> = {
  '실적관리': 'performance',
  '개인 실적': 'personal_performance',
  '접수 관리': 'reception',
  '업무 진행': 'work_progress',
  '개통 완료': 'activation_complete',
  '기타 완료': 'other_complete',
  '개통 취소': 'activation_cancel',
  '폐기': 'discard',
  '서식지': 'forms',
  '전사 공지용 당일실적': 'company_daily_performance',
  '마감보고 · 공지텍스트': 'closing_report',
  'LG 검수': 'lg_audit',
  'KT 검수': 'kt_audit',
  '교육자료': 'education',
  '타이핑': 'typing',
  '개통현황 조회': 'activation_lookup',
  '관리자': 'admin',
  '영업 조직': 'sales_organization',
};

interface SidebarMenuVisibilitySetting {
  menuKey: string;
  adminVisible: boolean;
  workerVisible: boolean;
}

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const apiRequest = useApiRequest();

  // [MCC_SIDEBAR_MENU_VISIBILITY_ADMIN_CONTROL_1] 관리자 패널에서 저장한 "사이드바 메뉴
  // 표시/숨김" 설정. 기존 권한(ROLE) 체크(아래 baseNavigation/currentNavigation)는 전혀
  // 바꾸지 않는다 — 이 데이터는 그 결과를 한 번 더 좁히는 용도로만 쓴다.
  // FAIL-SAFE: 조회 실패/로딩 중(data===undefined)이면 필터링 자체를 하지 않는다 —
  // DB/API 장애 때문에 사이드바 메뉴가 전부 사라지는 사고를 막기 위함(§6 요구사항).
  const { data: sidebarVisibilityData } = useQuery<{ settings: SidebarMenuVisibilitySetting[] }>({
    queryKey: ['/api/sidebar-menu-settings'],
    queryFn: () => apiRequest('/api/sidebar-menu-settings'),
    staleTime: 60 * 1000,
    retry: false,
  });


  const isAdmin = user?.userType === 'admin';
  const isSalesManager = user?.userType === 'sales_manager';
  const isWorker = user?.userType === 'user' && user?.userRole === 'dealer_worker';
  const isDealer = user?.dealerId !== undefined && user?.dealerId !== null && !isWorker;
  // [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] '개통현황 조회'가 개통 후
  // 자동검수 센터로 확장되면서, 이 메뉴만 admin/내부 middle_manager 전용으로 좁혔다.
  const isMiddleManager = user?.userType === 'user' && user?.userRole === 'middle_manager';

  // 딜러용 메뉴 (접수 관리, 업무 진행, 서식지만)
  const dealerAllowedMenus = ['접수 관리', '업무 진행', '서식지'];

  // 메뉴 필터링 — role(권한) 기준. hidden:true 정적 플래그는 더 이상 사용하지 않음
  // (§ 위 설명 — "사이드바 메뉴 관리" DB 설정으로 완전히 대체됨).
  let baseNavigation = navigation;
  if (isAdmin) {
    // 관리자는 모든 메뉴 접근 가능
    baseNavigation = navigation;
  } else if (isSalesManager) {
    // 영업과장은 읽기 전용 메뉴만 (정산 관리 제외)
    // MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1: 개인 실적은 내부 개통 근무자
    // 실적용 기능이라 sales_manager 대상이 아니다(요구사항) — 기본 노출 제외.
    // [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 개통현황 조회도 이번에
    // sales_manager 대상에서 제외했다(§7 — 중간관리자 검수 권한 자동 부여 금지).
    baseNavigation = navigation.filter(item =>
      item.name !== '정산 관리' && item.name !== '개인 실적' && item.name !== '개통현황 조회'
    );
  } else if (isWorker) {
    // 근무자는 전체 메뉴 접근 가능
    baseNavigation = navigation;
  } else if (isDealer) {
    // 판매점(딜러)은 제한된 메뉴만 접근. 이 allowlist는 "사이드바 메뉴 관리"(DB
    // visibility)와 완전히 독립 — 아래 visibleNavigation 계산에서도 isDealer는
    // DB 필터를 적용하지 않고 그대로 통과시킨다(딜러의 실사용 기능 보호).
    baseNavigation = navigation.filter(item => dealerAllowedMenus.includes(item.name));
  } else if (isMiddleManager) {
    // [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 중간관리자: 일반 근무 메뉴 +
    // 개통현황 조회(전체 검수) 모두 노출. 관리자 전용 메뉴(adminNavigation)는 아래에서
    // isAdmin일 때만 붙으므로 자동으로 제외된다.
    baseNavigation = navigation;
  } else {
    // [MCC_ACTIVATION_STATUS_POST_ACTIVATION_AUDIT_CENTER_1] 일반 WORKER(중간관리자 아님):
    // 개통현황 조회 메뉴 노출 안 함(서버도 동일하게 차단 — sheet-viewer.ts 참고).
    baseNavigation = navigation.filter(item => item.name !== '개통현황 조회');
  }

  // 관리자만 관리자 패널 접근 가능. 실적관리(전체 근무자 실적)도 관리자만 — 맨 앞에 붙인다.
  const currentNavigation = isAdmin
    ? [performanceManagementNavItem, ...baseNavigation, ...adminNavigation]
    : baseNavigation;

  // [MCC_SIDEBAR_MENU_VISIBILITY_ADMIN_CONTROL_1] 위에서 계산된 기존 권한 기반
  // currentNavigation(canViewMenu에 해당) 위에 "표시 설정"을 AND 조건으로 추가한다.
  // 핵심 원칙: SIDEBAR_VISIBILITY ≠ PERMISSION — 이 필터는 currentNavigation에 이미
  // 포함된 항목만 추가로 숨길 수 있고, 여기 없던 항목을 새로 보이게 할 수는 없다.
  // isAdmin에는 admin_visible, 그 외 모든 role(sales_manager/worker/
  // middle_manager)에는 worker_visible을 적용한다 — "작업자" 표시설정 그룹이 관리자
  // 전용 메뉴 권한을 임의로 만들어내지 않는다는 점은 위 role 필터가 이미 보장한다.
  // [MCC_SIDEBAR_MENU_VISIBILITY_LIVE_APPLY_LAYOUT_OWNER_ONLY_FIX_1] isDealer는 이
  // DB visibility 필터에서 완전히 제외한다 — 딜러는 접수관리/업무진행/서식지 3개를
  // dealerAllowedMenus로 이미 고정 노출 중이며, 이 3개는 "작업자" 표시설정(내부
  // 근무자 기준, 기본값 OFF)과 의미가 다르다. 같은 worker_visible 컬럼을 그대로
  // 적용하면 관리자가 내부 근무자 기준으로 OFF를 유지해도 딜러의 유일한 메뉴가
  // 사라지는 회귀가 생기므로, 과거 hidden:true 때와 동일하게 딜러는 예외로 둔다.
  const visibilitySettings = sidebarVisibilityData?.settings;
  const visibleNavigation = isDealer
    ? currentNavigation
    : visibilitySettings
    ? currentNavigation.filter(item => {
        const menuKey = SIDEBAR_MENU_KEY_BY_NAME[item.name];
        if (!menuKey) return true; // 매핑되지 않은 항목은 영향받지 않음(안전한 기본값)
        const setting = visibilitySettings.find(s => s.menuKey === menuKey);
        if (!setting) return true; // 설정 없음 = 기본 표시
        return isAdmin ? setting.adminVisible : setting.workerVisible;
      })
    : currentNavigation; // FAIL-SAFE: 설정 로딩/실패 시 기존 동작 그대로

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && onClose && (
        <div 
          className="fixed inset-0 bg-gray-600 bg-opacity-75 z-20 md:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-30 w-auto min-w-64 max-w-80 bg-primary transform transition-transform duration-300 ease-in-out md:static md:inset-0",
        isOpen ? "translate-x-0 md:transform-none" : "-translate-x-full md:translate-x-0 md:transform-none"
      )}>
        <div className="flex flex-col h-full overflow-hidden">
          {/* Logo */}
          <div className="flex flex-col items-center flex-shrink-0 px-4 py-6 border-b border-gray-700">
            <Link href="/dashboard" className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity">
              <img 
                src={logoImage} 
                alt="MCC네트월드 로고" 
                className="h-12 w-auto mb-3"
              />
              <div className="text-center">
                <h1 className="text-lg font-semibold text-white leading-tight whitespace-nowrap">MCC네트월드</h1>
              </div>
            </Link>
          </div>
          
          {/* Mobile close button */}
          {onClose && (
            <div className="absolute top-4 right-4 md:hidden">
              <button
                type="button"
                className="text-gray-300 hover:text-white"
                onClick={onClose}
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 px-3 pb-4 space-y-1 overflow-y-auto overflow-x-hidden sidebar-scroll">
            {visibleNavigation.map((item) => {
              const isActive = location === item.href;
              
              return (
                <Link key={item.name} href={item.href}>
                  <div
                    className={cn(
                      "group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap relative",
                      isActive
                        ? "bg-accent text-white"
                        : "text-gray-300 hover:bg-gray-700 hover:text-white"
                    )}
                    onClick={onClose}
                  >
                    <item.icon
                      className={cn(
                        "mr-3 flex-shrink-0 h-6 w-6",
                        isActive ? "text-white" : "text-gray-400"
                      )}
                    />
                    <span className="flex-1">{item.name}</span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </>
  );
}
