// [MCC_SIDEBAR_MENU_VISIBILITY_ADMIN_CONTROL_1]
// 사이드바 메뉴 "표시/숨김" 전용 관리 화면. 기존 ROLE/권한 체크를 절대 대체하지
// 않는다 — 여기서 바꾸는 값은 Sidebar.tsx에서 기존 권한 필터 결과에 AND 조건으로만
// 추가되며, 이 화면 자체도 AdminPanel의 기존 requireAdmin 게이트 안에서만 보인다.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { useApiRequest } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';

interface SidebarMenuVisibilitySetting {
  menuKey: string;
  adminVisible: boolean;
  workerVisible: boolean;
}

// Sidebar.tsx의 실제 메뉴와 1:1 대응하는 고정 목록(표시 순서 = 관리자 패널 화면 순서).
// menuKey는 server/routes.ts의 SIDEBAR_MENU_KEYS, Sidebar.tsx의
// SIDEBAR_MENU_KEY_BY_NAME과 동일해야 한다.
const MENU_ROWS: { menuKey: string; label: string }[] = [
  { menuKey: 'performance', label: '실적관리' },
  { menuKey: 'personal_performance', label: '개인 실적' },
  { menuKey: 'reception', label: '접수 관리' },
  { menuKey: 'work_progress', label: '업무 진행' },
  { menuKey: 'activation_complete', label: '개통 완료' },
  { menuKey: 'other_complete', label: '기타 완료' },
  { menuKey: 'activation_cancel', label: '개통 취소' },
  { menuKey: 'discard', label: '폐기' },
  { menuKey: 'forms', label: '서식지' },
  { menuKey: 'company_daily_performance', label: '전사 공지용 당일실적' },
  { menuKey: 'closing_report', label: '마감보고 · 공지텍스트' },
  { menuKey: 'lg_audit', label: 'LG 검수' },
  { menuKey: 'kt_audit', label: 'KT 검수' },
  { menuKey: 'education', label: '교육자료' },
  { menuKey: 'typing', label: '타이핑' },
  { menuKey: 'activation_lookup', label: '개통현황 조회' },
  { menuKey: 'admin', label: '관리자' },
  { menuKey: 'sales_organization', label: '영업 조직' },
];

const SIDEBAR_SETTINGS_QUERY_KEY = ['/api/sidebar-menu-settings'];

export function SidebarMenuVisibilityPanel() {
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ settings: SidebarMenuVisibilitySetting[] }>({
    queryKey: SIDEBAR_SETTINGS_QUERY_KEY,
    queryFn: () => apiRequest('/api/sidebar-menu-settings'),
  });

  const settingsByKey = new Map((data?.settings ?? []).map(s => [s.menuKey, s]));

  const handleToggle = async (menuKey: string, field: 'adminVisible' | 'workerVisible', nextValue: boolean) => {
    const current = settingsByKey.get(menuKey) ?? { menuKey, adminVisible: true, workerVisible: true };

    // [§9 UI 안전장치] 관리자가 자기 자신의 "관리자" 메뉴(관리자 열)를 끄려고 하면
    // 가벼운 확인만 받는다 — 관리자 페이지/권한 자체는 사라지지 않는다는 점을 안내.
    if (menuKey === 'admin' && field === 'adminVisible' && !nextValue) {
      const ok = window.confirm(
        '관리자 메뉴를 사이드바에서 숨깁니다.\n관리자 페이지 자체나 권한은 사라지지 않지만, 설정을 다시 켜기 전까지 사이드바에서 "관리자" 링크가 보이지 않습니다.\n계속하시겠습니까?'
      );
      if (!ok) return;
    }

    const updated: SidebarMenuVisibilitySetting = { ...current, [field]: nextValue };

    try {
      await apiRequest('/api/admin/sidebar-menu-settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: [updated] }),
      });
      // Sidebar.tsx와 동일한 queryKey를 무효화해 새로고침 없이 즉시 반영한다.
      queryClient.invalidateQueries({ queryKey: SIDEBAR_SETTINGS_QUERY_KEY });
    } catch (error: any) {
      toast({
        title: '저장 실패',
        description: error?.message || '사이드바 메뉴 설정을 저장하지 못했습니다.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>사이드바 메뉴 관리</CardTitle>
        <CardDescription>
          메뉴를 사이드바에 보여줄지 숨길지만 관리합니다. 메뉴 표시 설정은 기존 접근
          권한을 변경하지 않습니다 — 기존 권한상 볼 수 없는 메뉴는 이 설정을 켜도
          나타나지 않고, 직접 URL 접근은 기존 권한 규칙을 그대로 따릅니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> 불러오는 중...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4 font-medium">메뉴</th>
                  <th className="py-2 px-4 font-medium text-center">관리자</th>
                  <th className="py-2 px-4 font-medium text-center">작업자</th>
                </tr>
              </thead>
              <tbody>
                {MENU_ROWS.map(({ menuKey, label }) => {
                  const setting = settingsByKey.get(menuKey);
                  const adminVisible = setting ? setting.adminVisible : true;
                  const workerVisible = setting ? setting.workerVisible : true;
                  return (
                    <tr key={menuKey} className="border-b last:border-b-0">
                      <td className="py-3 pr-4">{label}</td>
                      <td className="py-3 px-4 text-center">
                        <Switch
                          checked={adminVisible}
                          onCheckedChange={(checked) => handleToggle(menuKey, 'adminVisible', checked)}
                        />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Switch
                          checked={workerVisible}
                          onCheckedChange={(checked) => handleToggle(menuKey, 'workerVisible', checked)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
