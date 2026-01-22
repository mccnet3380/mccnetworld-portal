import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiRequest, useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  Calendar, 
  Filter, 
  CheckCircle,
  Clock,
  AlertTriangle,
  FileText,
  User,
  Building2,
  Phone,
  Star,
  X,
  Trash2
} from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// 상태 변경 가능한 상태 목록
const STATUS_OPTIONS = [
  { value: '대기', label: '대기', color: 'bg-yellow-100 text-yellow-800' },
  { value: '진행중', label: '진행중', color: 'bg-blue-100 text-blue-800' },
  { value: '업무요청중', label: '업무요청중', color: 'bg-orange-100 text-orange-800' },
  { value: '개통완료', label: '개통완료', color: 'bg-green-100 text-green-800' },
  { value: '취소', label: '취소', color: 'bg-red-100 text-red-800' },
  { value: '보완필요', label: '보완필요', color: 'bg-purple-100 text-purple-800' },
  { value: '기타완료', label: '기타완료', color: 'bg-gray-100 text-gray-800' },
  { value: '폐기', label: '폐기', color: 'bg-black text-white' }
];

export function StatusChange() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedDocument, setSelectedDocument] = useState<any>(null);
  const [newStatus, setNewStatus] = useState('');
  const [remarks, setRemarks] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  // 상태 변경 가능한 문서 조회 (접수관리에서 담당자 할당된 문서들)
  const { data: documents = [], isLoading, refetch } = useQuery({
    queryKey: ['/api/documents', 'status-change'],
    queryFn: () => apiRequest('/api/documents?includeActivatedBy=true'),
  });

  // 상태 변경 뮤테이션
  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, remarks }: { id: number; status: string; remarks?: string }) => {
      return apiRequest(`/api/documents/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, remarks })
      });
    },
    onSuccess: () => {
      toast({ title: '문서 상태가 성공적으로 변경되었습니다.' });
      setSelectedDocument(null);
      setNewStatus('');
      setRemarks('');
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      refetch();
    },
    onError: (error: any) => {
      toast({ 
        title: '상태 변경 실패', 
        description: error.message, 
        variant: 'destructive' 
      });
    }
  });

  // 필터링된 문서 목록
  const filteredDocuments = documents.filter((doc: any) => {
    const matchesSearch = !searchTerm || 
      doc.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.customerPhone?.includes(searchTerm) ||
      doc.contactCode?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.id?.toString().includes(searchTerm);
    
    const matchesStatus = statusFilter === 'all' || doc.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const handleStatusUpdate = () => {
    if (!selectedDocument || !newStatus) return;
    
    setIsUpdating(true);
    updateStatusMutation.mutate({
      id: selectedDocument.id,
      status: newStatus,
      remarks: remarks.trim() || undefined
    });
    setIsUpdating(false);
  };

  const getStatusBadge = (status: string) => {
    const statusOption = STATUS_OPTIONS.find(opt => opt.value === status);
    return (
      <Badge className={statusOption?.color || 'bg-gray-100 text-gray-800'}>
        {statusOption?.label || status}
      </Badge>
    );
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case '대기':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case '진행중':
        return <FileText className="h-4 w-4 text-blue-500" />;
      case '업무요청중':
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case '개통완료':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case '취소':
        return <X className="h-4 w-4 text-red-500" />;
      case '보완필요':
        return <AlertTriangle className="h-4 w-4 text-purple-500" />;
      case '기타완료':
        return <Star className="h-4 w-4 text-gray-500" />;
      case '폐기':
        return <Trash2 className="h-4 w-4 text-gray-800" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  return (
    <Layout title="상태 변경">
      <div className="space-y-6">
        {/* 상단 검색 및 필터 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              문서 상태 변경
            </CardTitle>
            <CardDescription>
              접수된 문서의 상태를 변경할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="고객명, 전화번호, 접점코드, 문서번호로 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="w-full md:w-48">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="상태 필터" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체 상태</SelectItem>
                    {STATUS_OPTIONS.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 문서 목록 */}
        <Card>
          <CardHeader>
            <CardTitle>문서 목록</CardTitle>
            <CardDescription>
              상태를 변경할 문서를 선택하세요. (총 {filteredDocuments.length}건)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="text-center py-8">
                <FileText className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">문서가 없습니다</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {searchTerm || statusFilter !== 'all' ? '검색 조건에 맞는 문서를 찾을 수 없습니다.' : '아직 접수된 문서가 없습니다.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredDocuments.map((doc: any) => (
                  <div 
                    key={doc.id} 
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      selectedDocument?.id === doc.id 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedDocument(doc)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        {getStatusIcon(doc.status)}
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-medium">#{doc.id}</span>
                            <span className="text-gray-600">{doc.customerName}</span>
                            {getStatusBadge(doc.status)}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {doc.customerPhone}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-sm text-gray-500">
                        <div>
                          {doc.createdAt ? (
                            (() => {
                              try {
                                return format(new Date(doc.createdAt), 'yyyy-MM-dd HH:mm', { locale: ko });
                              } catch {
                                return '날짜 오류';
                              }
                            })()
                          ) : '날짜 없음'}
                        </div>
                        {doc.contactCode && (
                          <div className="text-xs text-gray-400">{doc.contactCode}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 상태 변경 폼 */}
        {selectedDocument && (
          <Card>
            <CardHeader>
              <CardTitle>상태 변경</CardTitle>
              <CardDescription>
                선택된 문서: #{selectedDocument.id} - {selectedDocument.customerName}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    현재 상태
                  </label>
                  <div className="flex items-center space-x-2">
                    {getStatusIcon(selectedDocument.status)}
                    {getStatusBadge(selectedDocument.status)}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    변경할 상태 *
                  </label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="새로운 상태를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          <div className="flex items-center space-x-2">
                            {getStatusIcon(status.value)}
                            <span>{status.label}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    변경 사유 (선택사항)
                  </label>
                  <Textarea
                    placeholder="상태 변경 사유를 입력하세요..."
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="flex justify-end space-x-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedDocument(null);
                      setNewStatus('');
                      setRemarks('');
                    }}
                  >
                    취소
                  </Button>
                  <Button
                    onClick={handleStatusUpdate}
                    disabled={!newStatus || isUpdating || updateStatusMutation.isPending}
                  >
                    {isUpdating || updateStatusMutation.isPending ? '변경 중...' : '상태 변경'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}