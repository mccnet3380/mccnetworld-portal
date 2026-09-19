import { Link, useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
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
  TrendingUp
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import logoImage from '@assets/KakaoTalk_20250626_162541112-removebg-preview_1751604392501.png';

const navigation = [
  { name: '대시보드', href: '/dashboard', icon: LayoutDashboard },
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
  // MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1: 개인 실적 — 로그인 계정에 연결된
  // 실적 작업자 기준 본인 실적만 표시. sales_manager는 이 기능 대상이 아니라 아래
  // isSalesManager 필터에서 제외한다(요구사항). dealer는 dealerAllowedMenus로 제외.
  { name: '개인 실적', href: '/performance/me', icon: TrendingUp },
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
];

const adminNavigation = [
  { name: '관리자', href: '/admin-panel', icon: Settings },
  { name: '영업 조직', href: '/sales-team-management', icon: Users },
];

// MCC_PERSONAL_PERFORMANCE_ACCESS_AND_MAPPING_FIX_1: 실적관리(전체 근무자 실적)는
// 관리자만 볼 수 있다 — 일반 navigation에는 넣지 않고 isAdmin일 때만 앞에 붙인다.
const performanceManagementNavItem = { name: '실적관리', href: '/performance', icon: BarChart3 };

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = true, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  

  const isAdmin = user?.userType === 'admin';
  const isSalesManager = user?.userType === 'sales_manager';
  const isWorker = user?.userType === 'user' && user?.userRole === 'dealer_worker';
  const isDealer = user?.dealerId !== undefined && user?.dealerId !== null && !isWorker;
  
  // 딜러용 메뉴 (접수 관리, 업무 진행, 서식지만)
  const dealerAllowedMenus = ['접수 관리', '업무 진행', '서식지'];
  
  // 메뉴 필터링
  let baseNavigation = navigation;
  if (isAdmin) {
    // 관리자는 모든 메뉴 접근 가능
    baseNavigation = navigation;
  } else if (isSalesManager) {
    // 영업과장은 읽기 전용 메뉴만 (정산 관리 제외)
    // MCC_PERSONAL_PERFORMANCE_DASHBOARD_IMPLEMENTATION_1: 개인 실적은 내부 개통 근무자
    // 실적용 기능이라 sales_manager 대상이 아니다(요구사항) — 기본 노출 제외.
    baseNavigation = navigation.filter(item =>
      item.name !== '정산 관리' && item.name !== '개인 실적'
    );
  } else if (isWorker) {
    // 근무자는 전체 메뉴 접근 가능
    baseNavigation = navigation;
  } else if (isDealer) {
    // 판매점(딜러)은 제한된 메뉴만 접근
    baseNavigation = navigation.filter(item => dealerAllowedMenus.includes(item.name));
  } else {
    // 기타 사용자는 전체 메뉴 접근 가능
    baseNavigation = navigation;
  }
  
  // 관리자만 관리자 패널 접근 가능. 실적관리(전체 근무자 실적)도 관리자만 — 맨 앞에 붙인다.
  const currentNavigation = isAdmin
    ? [performanceManagementNavItem, ...baseNavigation, ...adminNavigation]
    : baseNavigation;

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
            {currentNavigation.map((item) => {
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
