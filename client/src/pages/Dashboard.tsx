import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useApiRequest } from '@/lib/auth';
import { useAuth } from '@/lib/auth';
import { useState } from 'react';
import type { Document } from '../../../shared/schema';
import {
  FileText,
  Clock,
  CheckCircle,
  Upload,
  Download,
  Calculator,
  TrendingUp,
  Calendar
} from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// ============================================================================
// 유틸리티 함수 (컴포넌트 외부)
// ============================================================================
const DASH_DEBUG = false;

const normalizeName = (s?: string) =>
  (s ?? "").trim().replace(/\s+/g, " ");

type CarrierItem = { carrierId?: string | number; carrierName?: string; carrier?: string; count?: number };

function aggregateReceptionByCarrier(raw?: CarrierItem[]) {
  const arr = Array.isArray(raw) ? raw : [];
  const map = new Map<string | number, { name: string; count: number }>();

  for (const item of arr) {
    const id = item?.carrierId;
    const name = normalizeName(item?.carrierName || item?.carrier);
    const key = (id ?? name) as string | number;
    if (!key) continue;

    const prev = map.get(key);
    const cnt = Number(item?.count ?? 0);
    map.set(key, { name, count: (prev?.count ?? 0) + (isFinite(cnt) ? cnt : 0) });
  }

  return Array.from(map.entries())
    .map(([k, v]) => ({ key: k, name: v.name, count: v.count }))
    .sort((a, b) => b.count - a.count);
}

function pickNumber(...candidates: Array<any>): number {
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function Dashboard() {
  const apiRequest = useApiRequest();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();

  // 안전한 날짜 포맷팅 함수
  const formatSafeDate = (dateString: string | null | undefined, formatString: string = 'yyyy-MM-dd HH:mm') => {
    if (!dateString) return '-';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '-';
      return format(date, formatString, { locale: ko });
    } catch (error) {
      console.error('Date formatting error:', error, 'for date:', dateString);
      return '-';
    }
  };
  
  // Date filter states for general dashboard
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Separate date filter states for carrier and worker stats
  const [carrierStartDate, setCarrierStartDate] = useState('');
  const [carrierEndDate, setCarrierEndDate] = useState('');
  const [workerStartDate, setWorkerStartDate] = useState('');
  const [workerEndDate, setWorkerEndDate] = useState('');
  
  // Dialog states for analytics
  const [carrierDetailsOpen, setCarrierDetailsOpen] = useState(false);
  const [workerDetailsOpen, setWorkerDetailsOpen] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<{ id: number; name: string; username: string } | null>(null);
  const [carrierWorkerDetails, setCarrierWorkerDetails] = useState<Array<{ workerId: number; workerUsername: string; workerName: string; count: number }>>([]);
  const [workerCarrierDetails, setWorkerCarrierDetails] = useState<Array<{ carrier: string; count: number }>>([]);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/dashboard/stats', startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      const url = `/api/dashboard/stats${params.toString() ? '?' + params.toString() : ''}`;
      return apiRequest(url) as Promise<any>;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 5000
  });

  // 당월 개통 현황 통계 (자동으로 현재 월 데이터 조회, 근무자는 자신이 처리한 건만)
  // 단일 쿼리로 총계와 통신사별 합계를 동시에 가져옴
  const { data: monthlyActivationSummary, isLoading: monthlyStatsLoading } = useQuery({
    queryKey: ['/api/dashboard/monthly-activation-summary'],
    queryFn: () => apiRequest('/api/dashboard/monthly-activation-summary') as Promise<{ month: string; total: number; carriers: Array<{ carrier: string; count: number }> }>,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 10000
  });

  // 당월 상태별 통계 (근무자는 자신이 처리한 건만)
  const { data: monthlyStatusStats, isLoading: monthlyStatusStatsLoading } = useQuery({
    queryKey: ['/api/dashboard/monthly-status-stats'],
    queryFn: () => apiRequest('/api/dashboard/monthly-status-stats') as Promise<any>,
  });
  const { data: carrierStats, isLoading: carrierStatsLoading } = useQuery({
    queryKey: ['/api/dashboard/carrier-stats', carrierStartDate, carrierEndDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (carrierStartDate) params.append('startDate', carrierStartDate);
      if (carrierEndDate) params.append('endDate', carrierEndDate);
      const url = `/api/dashboard/carrier-stats${params.toString() ? '?' + params.toString() : ''}`;
      return apiRequest(url) as Promise<any[]>;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 10000
  });

  const { data: workerStats, isLoading: workerStatsLoading } = useQuery({
    queryKey: ['/api/dashboard/worker-stats', workerStartDate, workerEndDate],
    queryFn: () => {
      const params = new URLSearchParams();
      if (workerStartDate) params.append('startDate', workerStartDate);
      if (workerEndDate) params.append('endDate', workerEndDate);
      const url = `/api/dashboard/worker-stats${params.toString() ? '?' + params.toString() : ''}`;
      return apiRequest(url) as Promise<any[]>;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 10000
  });

  // 관리자 개통 실적 조회 (admin만)
  const { data: adminActivationStats, isLoading: adminStatsLoading } = useQuery({
    queryKey: ['/api/dashboard/admin-activation-stats'],
    queryFn: () => apiRequest('/api/dashboard/admin-activation-stats') as Promise<{
      todayCount: number;
      monthCount: number;
    }>,
    enabled: user?.userType === 'admin',
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 5000
  });

  // 당일 통계 조회
  const { data: todayStats, isLoading: todayStatsLoading } = useQuery({
    queryKey: ['/api/dashboard/today-stats'],
    queryFn: async () => {
      const result = await apiRequest('/api/dashboard/today-stats') as any;
      if (DASH_DEBUG) {
        console.log('[DASH] todayStats raw response:', result);
      }
      return result;
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 5000
  });

  const { data: activePricingTable } = useQuery({
    queryKey: ['/api/pricing-tables/active'],
    queryFn: () => apiRequest('/api/pricing-tables/active') as Promise<any | null>,
  });

  // ============================================================================
  // 데이터 안전 파싱 (집계/중복 제거)
  // ============================================================================
  const receptionRaw =
    todayStats?.today?.receptionByCarrier ??
    todayStats?.receptionByCarrier ??
    todayStats?.todayStats?.receptionByCarrier;

  const receptionAgg = aggregateReceptionByCarrier(receptionRaw);

  const newCount = pickNumber(
    todayStats?.today?.activations?.new,
    todayStats?.activations?.today?.new,
    todayStats?.todayActivations?.newCustomerCount,
    todayStats?.newCustomerCount
  );

  const portInCount = pickNumber(
    todayStats?.today?.activations?.portIn,
    todayStats?.activations?.today?.portIn,
    todayStats?.todayActivations?.portInCount,
    todayStats?.portInCount
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case '접수':
        return <Badge className="status-badge-pending">접수</Badge>;
      case '완료':
        return <Badge className="status-badge-completed">완료</Badge>;
      case '보완필요':
        return <Badge className="status-badge-needs-review">보완필요</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const handleUploadDocument = () => {
    // Navigate to document upload page
    window.location.href = '/documents';
  };

  const handleDownloadPricing = async () => {
    // Navigate to downloads page instead of downloading pricing table directly
    window.location.href = '/downloads';
  };

  const handleCarrierClick = async (carrier: string) => {
    try {
      setSelectedCarrier(carrier);
      const response = await apiRequest(`/api/dashboard/carrier-worker-stats?carrier=${encodeURIComponent(carrier)}`) as { carrier: string; workers: Array<{ workerId: number; workerRole: string; workerName: string; workerUsername: string; count: number }> };
      setCarrierWorkerDetails(response.workers);
      setCarrierDetailsOpen(true);
    } catch (error) {
      console.error('Error fetching carrier details:', error);
    }
  };

  const handleWorkerClick = async (worker: { id: number; name: string; username: string; type: string }) => {
    try {
      setSelectedWorker({ id: worker.id, name: worker.name, username: worker.username });
      const response = await apiRequest(`/api/dashboard/worker-carrier-stats?workerId=${worker.id}&workerType=${worker.type}`) as { workerId: number; workerType: string; workerName: string; workerUsername: string; carriers: Array<{ carrier: string; count: number }> };
      setWorkerCarrierDetails(response.carriers);
      setWorkerDetailsOpen(true);
    } catch (error) {
      console.error('Error fetching worker details:', error);
    }
  };

  return (
    <Layout title="대시보드">
      <div className="space-y-6">

        {/* 당월 개통 수량 카드 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CheckCircle className="mr-2 h-5 w-5" />
              당월 개통 수량
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
              <div className="flex items-start justify-between gap-6">
                {/* 왼쪽: 총 개통수량 */}
                <div className="flex-shrink-0">
                  <p className="text-sm text-green-700 mb-1">
                    {format(new Date(), 'yyyy년 MM월', { locale: ko })} 총 개통
                  </p>
                  <div className="flex items-baseline gap-2">
                    <div className="text-4xl font-bold text-green-600">
                      {monthlyStatsLoading ? (
                        <Skeleton className="h-12 w-20" />
                      ) : (
                        monthlyActivationSummary?.total || 0
                      )}
                    </div>
                    <span className="text-lg text-green-600">건</span>
                  </div>
                  <TrendingUp className="h-8 w-8 text-green-400 mt-2" />
                </div>
                
                {/* 오른쪽: 통신사별 개통 */}
                {!monthlyStatsLoading && monthlyActivationSummary?.carriers && monthlyActivationSummary.carriers.length > 0 && (
                  <div className="flex-1 pl-6 border-l border-green-200">
                    <p className="text-xs text-green-700 mb-2">통신사별 개통</p>
                    <div className="space-y-1">
                      {monthlyActivationSummary.carriers.map((stat) => (
                        <div key={stat.carrier} className="flex justify-between items-center py-1 px-2 hover:bg-green-100/50 rounded">
                          <span className="text-sm text-gray-700">{stat.carrier}</span>
                          <span className="text-sm font-semibold text-green-600">{stat.count}건</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Content Grid - 당일 현황을 전체 너비로 확장 */}
        <div className="space-y-6">
          {/* Today's Statistics - 전체 너비로 확장 */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>당일 현황</CardTitle>
                <Button 
                  variant="link" 
                  size="sm"
                  onClick={() => window.location.href = '/documents'}
                >
                  전체보기
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 당일 접수건 */}
                  <div className="bg-blue-50 rounded-lg p-5 border border-blue-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-blue-900 mb-2">당일 접수건</h3>
                        <p className="text-sm text-blue-700">오늘 새로 접수된 건수</p>
                      </div>
                      <Upload className="h-8 w-8 text-blue-600" />
                    </div>
                    <div className="mt-3">
                      {todayStatsLoading ? (
                        <Skeleton className="h-10 w-16" />
                      ) : (
                        <>
                          <div className="text-2xl font-bold text-blue-600">
                            {todayStats?.todayReception || 0}
                          </div>
                          <div className="text-sm text-blue-600 mt-1">건</div>
                          
                          {/* 통신사별 접수 현황 */}
                          {receptionAgg.length > 0 && (
                            <div className="mt-3 space-y-1">
                              <div className="text-xs font-medium text-blue-700 mb-1">통신사별 현황:</div>
                              {receptionAgg.map((item) => (
                                <div key={String(item.key)} className="flex justify-between items-center p-1 px-2 rounded bg-blue-100 border border-blue-200">
                                  <span className="text-xs text-blue-700">{item.name || "미상"}</span>
                                  <span className="text-xs font-medium text-blue-900">{item.count}건</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 당일 개통건 */}
                  <div className="bg-green-50 rounded-lg p-5 border border-green-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-green-900 mb-2">당일 개통건</h3>
                        <p className="text-sm text-green-700">오늘 개통 완료된 건수</p>
                      </div>
                      <CheckCircle className="h-8 w-8 text-green-600" />
                    </div>
                    <div className="mt-3">
                      {todayStatsLoading ? (
                        <Skeleton className="h-10 w-16" />
                      ) : (
                        <>
                          <div className="text-2xl font-bold text-green-600">
                            {todayStats?.todayActivation || 0}
                          </div>
                          <div className="text-sm text-green-600 mt-1">건</div>
                          
                          {/* 신규/번호이동 세부사항 */}
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="p-2 rounded bg-green-100 border border-green-200">
                              <div className="text-sm font-medium text-green-700">
                                신규: {newCount}건
                              </div>
                            </div>
                            <div className="p-2 rounded bg-blue-100 border border-blue-200">
                              <div className="text-sm font-medium text-blue-700">
                                번호이동: {portInCount}건
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* 당일 기타완료건 - 항상 표시되는 작은 박스 */}
                <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-purple-900 mb-1">기타 업무 처리건</h4>
                      <p className="text-xs text-purple-700">기타 처리 완료된 건수</p>
                    </div>
                    <div className="text-xl font-bold text-purple-600">
                      {todayStatsLoading ? (
                        <Skeleton className="h-6 w-10" />
                      ) : (
                        `${todayStats?.todayOtherCompleted || 0}건`
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 당월 통신사별 개통 현황 */}
              <div className="mt-6">
                <h4 className="text-sm font-medium text-gray-900 mb-3">
                  당월 개통현황 ({format(new Date(), 'MM월', { locale: ko })})
                  {user?.userType === 'user' && (
                    <span className="text-xs text-blue-600 ml-2">(내가 처리한 건만)</span>
                  )}
                </h4>
                {monthlyStatsLoading ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : monthlyActivationSummary?.carriers && monthlyActivationSummary.carriers.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                    {monthlyActivationSummary.carriers.map((stat: { carrier: string; count: number }, index: number) => (
                      <div 
                        key={stat.carrier} 
                        className="bg-white border rounded-lg p-3 text-center hover:shadow-sm transition-shadow"
                      >
                        <div className="text-lg font-bold text-gray-900">{stat.count}</div>
                        <div className="text-xs text-gray-600 mt-1 break-words leading-tight">
                          {stat.carrier}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>이번 달 개통 실적이 없습니다.</p>
                  </div>
                )}
              </div>

              {/* 통신사별 개통 현황 (기존 당일 현황은 숨김 처리) */}
              {/* 당일 개통 현황은 위의 "당일 개통건"에서 이미 표시되므로 별도 섹션 제거 */}

              {/* 추가 정보 */}
              <div className="mt-6 p-4 bg-gray-50 rounded-lg border">
                <div className="flex items-center justify-center space-x-8 text-sm text-gray-600">
                  <div className="flex items-center space-x-2">
                    <Calendar className="h-4 w-4" />
                    <span>{format(new Date(), 'yyyy년 MM월 dd일', { locale: ko })}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Clock className="h-4 w-4" />
                    <span>실시간 업데이트</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 관리자 개통 실적 */}
        {user?.userType === 'admin' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <TrendingUp className="mr-2 h-5 w-5" />
                관리자 개통 실적
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 당일 개통 실적 */}
                <div className="bg-blue-50 rounded-lg p-5 border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-blue-900 mb-2">당일 개통</h3>
                      <p className="text-sm text-blue-700">오늘 내가 개통한 건수</p>
                    </div>
                    <CheckCircle className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="mt-3">
                    {adminStatsLoading ? (
                      <Skeleton className="h-10 w-16" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-blue-600">
                          {adminActivationStats?.todayCount || 0}
                        </div>
                        <div className="text-sm text-blue-600 mt-1">건</div>
                      </>
                    )}
                  </div>
                </div>

                {/* 당월 개통 실적 */}
                <div className="bg-green-50 rounded-lg p-5 border border-green-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-green-900 mb-2">당월 개통</h3>
                      <p className="text-sm text-green-700">이번 달 내가 개통한 건수</p>
                    </div>
                    <Calendar className="h-8 w-8 text-green-600" />
                  </div>
                  <div className="mt-3">
                    {adminStatsLoading ? (
                      <Skeleton className="h-10 w-16" />
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-green-600">
                          {adminActivationStats?.monthCount || 0}
                        </div>
                        <div className="text-sm text-green-600 mt-1">건</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 당월 개통 현황 - 영업과장은 접근 불가 */}
        {user?.userType !== 'sales_manager' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Calculator className="mr-2 h-5 w-5" />
                당월 개통 현황
                {user?.userType === 'user' && (
                  <span className="text-xs text-blue-600 ml-2">(내가 처리한 건만)</span>
                )}
              </CardTitle>
            </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-7">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.totalDocuments || 0
                  )}
                </div>
                <div className="text-sm text-blue-800 mt-1">총 서류</div>
              </div>
              
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.pendingActivations || 0
                  )}
                </div>
                <div className="text-sm text-yellow-800 mt-1">업무 대기</div>
                <div className="text-xs text-yellow-700 mt-1">(대기 상태 문서)</div>
              </div>
              
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.inProgressCount || 0
                  )}
                </div>
                <div className="text-sm text-orange-800 mt-1">진행중</div>
              </div>
              
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.activatedCount || 0
                  )}
                </div>
                <div className="text-sm text-green-800 mt-1">개통완료</div>
              </div>
              
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.otherCompletedCount || 0
                  )}
                </div>
                <div className="text-sm text-purple-800 mt-1">기타완료</div>
              </div>
              
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.canceledCount || 0
                  )}
                </div>
                <div className="text-sm text-red-800 mt-1">취소</div>
              </div>
              
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-600">
                  {monthlyStatusStatsLoading ? (
                    <Skeleton className="h-8 w-12 mx-auto" />
                  ) : (
                    monthlyStatusStats?.discardedCount || 0
                  )}
                </div>
                <div className="text-sm text-gray-800 mt-1">폐기</div>
              </div>
            </div>
          </CardContent>
          </Card>
        )}

        {/* Worker personal stats - 판매점 근무자용은 별도 Dashboard 사용 */}

        {/* Role-based additional stats for admin only - 영업과장은 접근 불가 */}
        {user?.userType === 'admin' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">통신사별 · 근무자별 개통 수량</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* 통신사별 개통 수량 */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-medium">통신사별 개통 수량</h3>
                    <div className="flex items-center space-x-2">
                      <Input
                        type="date"
                        value={carrierStartDate}
                        onChange={(e) => setCarrierStartDate(e.target.value)}
                        className="h-8 text-xs w-32"
                        placeholder="시작일"
                      />
                      <span className="text-xs text-gray-500">~</span>
                      <Input
                        type="date"
                        value={carrierEndDate}
                        onChange={(e) => setCarrierEndDate(e.target.value)}
                        className="h-8 text-xs w-32"
                        placeholder="종료일"
                      />
                      {(carrierStartDate || carrierEndDate) && (
                        <Button 
                          onClick={() => {
                            setCarrierStartDate('');
                            setCarrierEndDate('');
                          }}
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                        >
                          초기화
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {carrierStatsLoading ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-8 w-full" />
                        ))}
                      </div>
                    ) : carrierStats && carrierStats.length > 0 ? (
                      carrierStats.map((carrier: any, index: number) => (
                        <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm">
                          <button 
                            onClick={() => handleCarrierClick(carrier.carrier)}
                            className="font-medium text-blue-600 hover:text-blue-800 underline"
                          >
                            {carrier.carrier}
                          </button>
                          <Badge variant="secondary" className="text-xs">{carrier.count}건</Badge>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-gray-500 text-sm">
                        통신사별 개통 데이터가 없습니다.
                      </div>
                    )}
                  </div>
                </div>

                {/* 근무자별 개통 수량 - 관리자만 표시 */}
                {user?.userType === 'admin' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-base font-medium">근무자별 개통 수량</h3>
                    <div className="flex items-center space-x-2">
                      <Input
                        type="date"
                        value={workerStartDate}
                        onChange={(e) => setWorkerStartDate(e.target.value)}
                        className="h-8 text-xs w-32"
                        placeholder="시작일"
                      />
                      <span className="text-xs text-gray-500">~</span>
                      <Input
                        type="date"
                        value={workerEndDate}
                        onChange={(e) => setWorkerEndDate(e.target.value)}
                        className="h-8 text-xs w-32"
                        placeholder="종료일"
                      />
                      {(workerStartDate || workerEndDate) && (
                        <Button 
                          onClick={() => {
                            setWorkerStartDate('');
                            setWorkerEndDate('');
                          }}
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                        >
                          초기화
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {workerStatsLoading ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map((i) => (
                          <Skeleton key={i} className="h-8 w-full" />
                        ))}
                      </div>
                    ) : workerStats && workerStats.length > 0 ? (
                      workerStats.map((worker: any, index: number) => (
                        <div key={index} className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm">
                          <button 
                            onClick={() => handleWorkerClick({ id: worker.workerId, name: worker.workerName, username: worker.workerUsername, type: worker.workerRole })}
                            className="font-medium text-blue-600 hover:text-blue-800 underline"
                          >
                            {worker.workerUsername} ({worker.workerName})
                          </button>
                          <Badge variant="secondary" className="text-xs">{worker.count}건</Badge>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-gray-500 text-sm">
                        근무자별 개통 데이터가 없습니다.
                      </div>
                    )}
                  </div>
                </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 단가표 최신 공지 & 빠른 기능 - 가로 배치 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 단가표 최신 공지 */}
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <Calculator className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg font-semibold">단가표 최신 공지</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {activePricingTable ? (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="text-sm font-medium text-blue-900 mb-1">
                        최신 업로드된 단가표
                      </div>
                      <div className="text-base font-semibold text-blue-800 mb-2">
                        {activePricingTable.title}
                      </div>
                      <div className="text-xs text-blue-700">
                        {formatSafeDate(activePricingTable.uploadedAt, 'yyyy-MM-dd') + ' 게시'}
                      </div>
                    </div>
                    <div className="flex flex-col items-center ml-4">
                      <div className="bg-blue-100 p-2 rounded-full mb-2">
                        <Download className="h-6 w-6 text-blue-600" />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={handleDownloadPricing}
                      >
                        다운로드
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="bg-gray-100 p-3 rounded-full w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                    <Calculator className="h-8 w-8 text-gray-400" />
                  </div>
                  <p className="text-sm text-gray-500">등록된 단가표가 없습니다.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 빠른 기능 */}
          <Card>
            <CardHeader>
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  <Upload className="h-4 w-4 text-gray-600" />
                  <Download className="h-4 w-4 text-gray-600" />
                </div>
                <CardTitle className="text-lg font-semibold">빠른 기능</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="text-sm text-gray-600 mb-4">자주 사용하는 메뉴</div>
                
                <Button 
                  onClick={() => setLocation('/submit-application')}
                  className="w-full justify-start"
                  variant="outline"
                >
                  <Upload className="mr-3 h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">접수 신청</div>
                    <div className="text-xs text-gray-500">새로운 서류 접수</div>
                  </div>
                </Button>
                
                <Button 
                  onClick={() => setLocation('/downloads')}
                  className="w-full justify-start"
                  variant="outline"
                >
                  <Download className="mr-3 h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">서식지 다운로드</div>
                    <div className="text-xs text-gray-500">서류 양식 다운로드</div>
                  </div>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dialog modals */}

        {/* Carrier Details Dialog */}
        <Dialog open={carrierDetailsOpen} onOpenChange={setCarrierDetailsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{selectedCarrier} 근무자별 개통 현황</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {carrierWorkerDetails.length > 0 ? (
                carrierWorkerDetails.map((detail, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                    <span className="font-medium">{detail.workerUsername} ({detail.workerName})</span>
                    <Badge variant="secondary">{detail.count}건</Badge>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-500">
                  개통 내역이 없습니다.
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Worker Details Dialog */}
        <Dialog open={workerDetailsOpen} onOpenChange={setWorkerDetailsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{selectedWorker?.username} ({selectedWorker?.name}) 통신사별 개통 현황</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {workerCarrierDetails.length > 0 ? (
                workerCarrierDetails.map((detail, index) => (
                  <div key={index} className="flex justify-between items-center p-3 bg-gray-50 rounded">
                    <span className="font-medium">{detail.carrier}</span>
                    <Badge variant="secondary">{detail.count}건</Badge>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-500">
                  개통 내역이 없습니다.
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
