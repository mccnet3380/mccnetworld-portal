import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageCircle } from 'lucide-react';
import { ChatDialog } from '@/components/ChatDialog';
import { useAuth } from '@/lib/auth';

interface Document {
  id: number;
  documentNumber: string;
  customerName: string;
  dealerId: number;
  activationStatus: string;
  carrier: string;
  assignedWorkerId?: number;
}

export function WorkerChatList() {
  const { user } = useAuth();
  
  const { data: documents, isLoading } = useQuery<Document[]>({
    queryKey: ['/api/documents?activationStatus=업무요청중,진행중&excludeWorkRequests=false'],
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
    refetchInterval: 2000,
  });

  // 진행 중인 문서 필터링 (담당자 할당 여부 무관)
  const inProgressDocs = documents?.filter(doc => 
    doc.activationStatus === '업무요청중' || doc.activationStatus === '진행중'
  ) || [];

  return (
    <Layout title="채팅">
      {isLoading ? (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">채팅 목록</h2>
          {unreadCount && unreadCount.total > 0 && (
            <Badge variant="destructive" className="text-lg px-4 py-2">
              읽지 않은 메시지 {unreadCount.total}개
            </Badge>
          )}
        </div>

        {unreadCount && unreadCount.byDealer.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">판매점별 미확인 메시지</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {unreadCount.byDealer.map(dealer => (
                  <div key={dealer.dealerId} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <span className="font-medium">{dealer.dealerName}</span>
                    <Badge variant="destructive">{dealer.count}개</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>진행 중인 문서</CardTitle>
          </CardHeader>
          <CardContent>
            {inProgressDocs.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">진행 중인 문서가 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {inProgressDocs.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex-1">
                      <div className="font-medium text-lg">{doc.customerName}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {doc.carrier} • {doc.activationStatus}
                      </div>
                    </div>
                    <ChatDialog documentId={doc.id} dealerId={doc.dealerId} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}
    </Layout>
  );
}
