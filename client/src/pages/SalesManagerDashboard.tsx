import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { useAuth, useApiRequest } from '@/lib/auth';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { 
  TrendingUp, 
  PhoneCall, 
  ShoppingCart, 
  Award,
  ChevronRight,
  ArrowLeft,
  LogOut,
  User,
  BarChart3,
  Calendar
} from 'lucide-react';
import logoImage from '@assets/KakaoTalk_20250626_162541112-removebg-preview_1751604392501.png';

interface TodayStats {
  todayReception: number;
  todayActivation: number;
  todayOtherCompleted: number;
  carrierStats: any[];
}

interface CarrierStats {
  carrier: string;
  newCustomer: number;
  portIn: number;
  total: number;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8'];

export default function SalesManagerDashboard() {
  const { user, logout } = useAuth();
  const apiRequest = useApiRequest();
  const [statsView, setStatsView] = useState<'today' | 'monthly'>('today');

  // 당일 실적 데이터 조회
  const { data: todayStats, isLoading: todayLoading, error: todayError } = useQuery({
    queryKey: ['/api/dashboard/today-stats'],
    queryFn: () => apiRequest('/api/dashboard/today-stats', { method: 'GET' }),
    enabled: !!user,
  });

  // 통신사별 실적 데이터 조회 (당일)
  const { data: carrierStats, isLoading: carrierLoading, error: carrierError } = useQuery({
    queryKey: ['/api/dashboard/carrier-stats'],
    queryFn: () => apiRequest('/api/dashboard/carrier-stats', { method: 'GET' }),
    enabled: !!user,
  });

  // 통신사별 실적 데이터 조회 (당월)
  const { data: monthlyCarrierStats, isLoading: monthlyCarrierLoading } = useQuery({
    queryKey: ['/api/dashboard/carrier-stats', 'monthly'],
    queryFn: () => {
      const currentDate = new Date();
      const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
        .toISOString().split('T')[0];
      const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
        .toISOString().split('T')[0];
      
      return apiRequest(`/api/dashboard/carrier-stats?startDate=${startDate}&endDate=${endDate}`, { method: 'GET' });
    },
    enabled: !!user,
  });

  const handleLogout = async () => {
    await logout();
    window.location.href = '/';
  };

  if (todayLoading || carrierLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex">
        <div className="flex-1 p-6">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
            <p className="mt-2 text-sm text-gray-500">실적 데이터 로딩 중...</p>
          </div>
        </div>
      </div>
    );
  }

  if (todayError || carrierError) {
    console.error('Dashboard errors:', { todayError, carrierError });
  }

  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const carrierChartData = carrierStats?.map((stat: any) => ({
    carrier: stat.carrier,
    신규: stat.newCustomer || 0,
    번호이동: stat.portIn || 0,
    전체: stat.total || 0
  })) || [];

  const renderTodayStats = () => (
    <div className="space-y-6">
      {/* 당일 실적 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">오늘 접수</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayStats?.todayReception || 0}</div>
            <p className="text-xs text-muted-foreground">건</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">오늘 개통</CardTitle>
            <PhoneCall className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayStats?.todayActivation || 0}</div>
            <p className="text-xs text-muted-foreground">건</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">기타 완료</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayStats?.todayOtherCompleted || 0}</div>
            <p className="text-xs text-muted-foreground">건</p>
          </CardContent>
        </Card>
      </div>

      {/* 통신사별 상세 현황 - 당일/당월 탭 */}
      <Card>
        <CardHeader>
          <CardTitle>통신사별 상세 현황</CardTitle>
          <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
            <button
              onClick={() => setStatsView('today')}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                statsView === 'today'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              당일
            </button>
            <button
              onClick={() => setStatsView('monthly')}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                statsView === 'monthly'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              당월
            </button>
          </div>
        </CardHeader>
        <CardContent>
          {statsView === 'today' ? (
            <div className="space-y-4">
              {carrierStats?.map((stat: any, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">{stat.carrier}</h4>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-green-50 p-3 rounded-lg text-center">
                      <div className="text-sm text-gray-600">신규</div>
                      <div className="text-xl font-bold text-green-700">{stat.newCustomer || 0}건</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg text-center">
                      <div className="text-sm text-gray-600">번호이동</div>
                      <div className="text-xl font-bold text-blue-700">{stat.portIn || 0}건</div>
                    </div>
                  </div>
                  
                  {stat.dealers && stat.dealers.length > 0 && (
                    <details className="group">
                      <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                        판매점별 상세 ({stat.dealers.length}개 판매점)
                        <span className="ml-2 transform group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {stat.dealers.map((dealer: any, dealerIndex: number) => (
                          <div key={dealerIndex} className="bg-gray-50 p-2 rounded text-xs">
                            <div className="font-medium text-gray-800 mb-1 truncate" title={dealer.contactCode}>
                              {dealer.contactCode}
                            </div>
                            <div className="flex justify-between text-gray-600">
                              <span>신규 {dealer.newCustomer}</span>
                              <span>번이 {dealer.portIn}</span>
                              <span className="font-semibold">계 {dealer.total}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
              
              {(!carrierStats || carrierStats.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  오늘 판매 데이터가 없습니다.
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {monthlyCarrierStats?.map((stat: any, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <h4 className="text-lg font-semibold text-gray-800 mb-3">{stat.carrier}</h4>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-green-50 p-3 rounded-lg text-center">
                      <div className="text-sm text-gray-600">신규</div>
                      <div className="text-xl font-bold text-green-700">{stat.newCustomer || 0}건</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg text-center">
                      <div className="text-sm text-gray-600">번호이동</div>
                      <div className="text-xl font-bold text-blue-700">{stat.portIn || 0}건</div>
                    </div>
                  </div>
                  
                  {stat.dealers && stat.dealers.length > 0 && (
                    <details className="group">
                      <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                        판매점별 상세 ({stat.dealers.length}개 판매점)
                        <span className="ml-2 transform group-open:rotate-180 transition-transform">▼</span>
                      </summary>
                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                        {stat.dealers.map((dealer: any, dealerIndex: number) => (
                          <div key={dealerIndex} className="bg-gray-50 p-2 rounded text-xs">
                            <div className="font-medium text-gray-800 mb-1 truncate" title={dealer.contactCode}>
                              {dealer.contactCode}
                            </div>
                            <div className="flex justify-between text-gray-600">
                              <span>신규 {dealer.newCustomer}</span>
                              <span>번이 {dealer.portIn}</span>
                              <span className="font-semibold">계 {dealer.total}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
              
              {(!monthlyCarrierStats || monthlyCarrierStats.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  이번 달 판매 데이터가 없습니다.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 사이드바 */}
      <div className="w-64 bg-white shadow-lg">
        <div className="p-6">
          <div className="flex items-center space-x-3">
            <img src={logoImage} alt="MCC네트월드" className="h-8 w-8" />
            <h1 className="text-lg font-bold text-gray-800">MCC네트월드</h1>
          </div>
        </div>
        
        <div className="p-6 border-t">
          <div className="space-y-3">
            <div className="text-sm text-gray-600">로그인 사용자</div>
            <div className="flex items-center space-x-3">
              <User className="h-5 w-5 text-gray-400" />
              <div>
                <div className="font-medium">{user?.name}</div>
                <div className="text-sm text-gray-500">{user?.role || '영업과장'}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 border-t">
          <Button 
            variant="outline" 
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            로그아웃
          </Button>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
            <p className="text-gray-600">판매점 현황 정보</p>
          </div>

          {renderTodayStats()}
        </div>
      </div>
    </div>
  );
}