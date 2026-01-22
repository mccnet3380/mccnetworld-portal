import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building, FileText, MessageCircle, Clock, CheckCircle, AlertCircle, Bell, Download } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ChatDialog } from "@/components/ChatDialog";

interface DealerApplication {
  id: number;
  documentNumber: string;
  customerName: string;
  carrier: string;
  serviceType: string;
  status: string;
  submittedAt: string;
  lastUpdated: string;
  hasUnreadMessages?: boolean;
  servicePlanName?: string;
  dealerNotes?: string;
  planName?: string;
  notes?: string;
  supplementNotes?: string;
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case "대기":
      return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />대기</Badge>;
    case "진행중":
      return <Badge className="bg-blue-600 text-white hover:bg-blue-700"><AlertCircle className="w-3 h-3 mr-1" />진행중</Badge>;
    case "개통":
    case "개통완료":
      return <Badge className="bg-green-600 text-white hover:bg-green-700">
        <CheckCircle className="w-3 h-3 mr-1" />개통
      </Badge>;
    case "취소":
    case "개통취소":
      return <Badge className="bg-red-600 text-white hover:bg-red-700">취소</Badge>;
    case "폐기":
      return <Badge className="bg-black text-white hover:bg-gray-900">폐기</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

export function DealerDashboard() {
  const { logout, user } = useAuth();
  const [, setLocation] = useLocation();
  const [selectedApp, setSelectedApp] = useState<DealerApplication | null>(null);
  
  console.log('[DealerDashboard] mount');
  
  const { data, isLoading, error } = useQuery<any[]>({
    queryKey: ["/api/dealer/applications"],
    queryFn: async () => {
      console.log('[DIRECT] Fetching dealer applications');
      
      let sessionId = null;
      try {
        const authStore = localStorage.getItem('auth-storage');
        if (authStore) {
          const parsed = JSON.parse(authStore);
          sessionId = parsed?.state?.sessionId || null;
        }
      } catch (e) {
        console.warn('[DIRECT] Failed to parse auth store:', e);
      }
      
      const headers: Record<string, string> = {};
      if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
        console.log('[DIRECT] Adding Authorization header');
      }
      
      const res = await fetch("/api/dealer/applications", {
        headers,
        credentials: "include",
      });
      console.log('[DIRECT] Response:', res.status, res.ok);
      if (!res.ok) {
        const errorText = await res.text();
        console.error('[DIRECT] Error response:', errorText);
        throw new Error(`Failed to fetch: ${res.status}`);
      }
      const json = await res.json();
      console.log('[DIRECT] Data received:', Array.isArray(json) ? `${json.length} documents` : json);
      return json;
    },
    refetchInterval: 3000,
  });

  const { data: unreadCount } = useQuery<{
    total: number;
    byDealer: Array<{
      dealerId: number;
      dealerName: string;
      count: number;
    }>;
  }>({
    queryKey: ['/api/chat/unread-count'],
    enabled: !!user,
    refetchInterval: 2000,
  });
  
  const documents = Array.isArray(data) ? data : [];
  console.log('[DealerDashboard] query status:', { isLoading, hasError: !!error, dataReceived: !!data, count: documents.length });
  if (error) console.error('[DealerDashboard] query error:', error);

  const handleLogout = async () => {
    await logout();
    setLocation('/');
  };

  const applications: DealerApplication[] = documents.map((doc: any) => ({
    id: doc.id,
    documentNumber: doc.documentNumber,
    customerName: doc.customerName,
    carrier: doc.carrier,
    serviceType: doc.planName || "-",
    status: doc.activationStatus,
    submittedAt: doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleString('ko-KR', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    }) : "-",
    lastUpdated: doc.updatedAt ? new Date(doc.updatedAt).toLocaleString('ko-KR', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    }) : "-",
    hasUnreadMessages: doc.hasUnreadMessages || false,
    servicePlanName: doc.planName,
    dealerNotes: doc.dealerNotes,
    planName: doc.planName,
    notes: doc.notes,
    supplementNotes: doc.supplementNotes,
  }));

  const getStatusCount = (status: string) => {
    return applications.filter(app => app.status === status).length;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-white dark:bg-gray-800 border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Building className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-xl font-semibold">판매점 대시보드</h1>
                <p className="text-sm text-muted-foreground">{user?.name || 'MCC네트월드 접수 포털'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {unreadCount && unreadCount.total > 0 && (
                <div className="relative">
                  <Button variant="ghost" size="icon" className="relative">
                    <Bell className="h-5 w-5" />
                    <Badge 
                      variant="destructive" 
                      className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                    >
                      {unreadCount.total}
                    </Badge>
                  </Button>
                </div>
              )}
              <Button onClick={() => setLocation("/submit")} data-testid="button-submit-application">
                <FileText className="h-4 w-4 mr-2" />
                접수 신청
              </Button>
              <Button variant="outline" onClick={() => setLocation("/other-application")} data-testid="button-other-application">
                <FileText className="h-4 w-4 mr-2" />
                기타 신청
              </Button>
              <Button variant="outline" onClick={() => setLocation("/downloads")} data-testid="button-downloads">
                <Download className="h-4 w-4 mr-2" />
                서식지
              </Button>
              <Button variant="outline" onClick={handleLogout} data-testid="button-logout">
                로그아웃
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">전체 신청</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{applications.length}</div>
              <p className="text-xs text-muted-foreground">총 신청 건수</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">대기중</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{getStatusCount("대기")}</div>
              <p className="text-xs text-muted-foreground">처리 대기</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">진행중</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{getStatusCount("진행중")}</div>
              <p className="text-xs text-muted-foreground">처리 진행중</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">완료</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{getStatusCount("개통")}</div>
              <p className="text-xs text-muted-foreground">개통 완료</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>신청 현황</CardTitle>
            <CardDescription>
              고객 신청서 처리 현황을 확인하실 수 있습니다
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">전체 ({applications.length})</TabsTrigger>
                <TabsTrigger value="pending">대기 ({getStatusCount("대기")})</TabsTrigger>
                <TabsTrigger value="processing">진행중 ({getStatusCount("진행중")})</TabsTrigger>
                <TabsTrigger value="completed">완료 ({getStatusCount("개통")})</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="space-y-4">
                <ApplicationList applications={applications} onViewDetails={setSelectedApp} />
              </TabsContent>

              <TabsContent value="pending" className="space-y-4">
                <ApplicationList applications={applications.filter(app => app.status === "대기")} onViewDetails={setSelectedApp} />
              </TabsContent>

              <TabsContent value="processing" className="space-y-4">
                <ApplicationList applications={applications.filter(app => app.status === "진행중")} onViewDetails={setSelectedApp} />
              </TabsContent>

              <TabsContent value="completed" className="space-y-4">
                <ApplicationList applications={applications.filter(app => app.status === "개통")} onViewDetails={setSelectedApp} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedApp} onOpenChange={() => setSelectedApp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>신청서 상세 정보</DialogTitle>
            <DialogDescription>
              고객 신청서의 상세 정보를 확인하실 수 있습니다
            </DialogDescription>
          </DialogHeader>
          {selectedApp && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">고객명</p>
                  <p className="text-base font-semibold">{selectedApp.customerName}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">통신사</p>
                  <p className="text-base font-semibold">{selectedApp.carrier}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">개통 상태</p>
                  <div data-testid="status-activation">{getStatusBadge(selectedApp.status)}</div>
                </div>
              </div>
              
              {selectedApp.planName && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">요금제</p>
                  <p className="text-base font-semibold text-blue-600">{selectedApp.planName}</p>
                </div>
              )}

              {selectedApp.notes && (() => {
                // JSON 형식인지 확인하고 파싱 시도
                let displayText = selectedApp.notes;
                try {
                  const parsed = JSON.parse(selectedApp.notes);
                  if (parsed && typeof parsed === 'object') {
                    // memo 필드가 있으면 해당 내용만 표시
                    displayText = parsed.memo || parsed.originalMemo || selectedApp.notes;
                  }
                } catch (e) {
                  // JSON이 아니면 원본 그대로 표시
                  displayText = selectedApp.notes;
                }
                
                return displayText ? (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">업무 메모</p>
                    <p className="text-sm whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                      {displayText}
                    </p>
                  </div>
                ) : null;
              })()}

              {selectedApp.supplementNotes && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">보완 메모</p>
                  <p className="text-sm whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                    {selectedApp.supplementNotes}
                  </p>
                </div>
              )}

              {selectedApp.dealerNotes && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">딜러 메모</p>
                  <p className="text-sm whitespace-pre-wrap bg-gray-50 dark:bg-gray-800 p-3 rounded-md border border-gray-200 dark:border-gray-700">
                    {selectedApp.dealerNotes}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-2 border-t">
                <div>
                  <p className="text-xs text-muted-foreground">신청일시</p>
                  <p className="text-sm">{selectedApp.submittedAt}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">최종 업데이트</p>
                  <p className="text-sm">{selectedApp.lastUpdated}</p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                {selectedApp.status === "진행중" && (
                  <ChatDialog
                    documentId={selectedApp.id}
                    dealerId={user?.dealerId || 0}
                    trigger={
                      <Button size="sm">
                        <MessageCircle className="w-4 h-4 mr-1" />
                        채팅하기
                      </Button>
                    }
                  />
                )}
                <Button size="sm" variant="outline" onClick={() => setSelectedApp(null)}>
                  닫기
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ApplicationListProps {
  applications: DealerApplication[];
  onViewDetails: (app: DealerApplication) => void;
}

function ApplicationList({ applications, onViewDetails }: ApplicationListProps) {
  const { user } = useAuth();
  
  if (applications.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        해당하는 신청이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {applications.map((app) => (
        <Card key={app.id} className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{app.customerName}</span>
                  {getStatusBadge(app.status)}
                  {app.hasUnreadMessages && (
                    <Badge variant="destructive" className="text-xs">
                      <MessageCircle className="w-3 h-3 mr-1" />
                      새 메시지
                    </Badge>
                  )}
                </div>
                <div className="text-base font-medium text-blue-600 dark:text-blue-400">
                  {app.carrier} {app.serviceType && `· ${app.serviceType}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  신청: {app.submittedAt} | 최종 업데이트: {app.lastUpdated}
                </div>
              </div>
              <div className="flex gap-2">
                {app.status === "진행중" && (
                  <ChatDialog
                    documentId={app.id}
                    dealerId={user?.dealerId || 0}
                    trigger={
                      <Button 
                        size="sm" 
                        variant="outline"
                        className={cn("relative", app.hasUnreadMessages && "animate-glow-red")}
                        data-testid={`button-chat-${app.id}`}
                      >
                        <MessageCircle className="w-4 h-4 mr-1" />
                        채팅
                        {app.hasUnreadMessages && (
                          <span className="absolute -top-1 -right-1 h-2 w-2 bg-red-500 rounded-full animate-pulse-red"></span>
                        )}
                      </Button>
                    }
                  />
                )}
                <Button size="sm" variant="outline" onClick={() => onViewDetails(app)} data-testid={`button-detail-${app.id}`}>
                  상세보기
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
