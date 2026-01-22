import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, useApiRequest } from '@/lib/auth';

import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { useForm } from 'react-hook-form';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, FileText, User, Calendar, Phone, Building, CheckCircle } from 'lucide-react';
import { Document } from '@shared/schema';

export default function WorkRequests() {
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [showCompletionMessage, setShowCompletionMessage] = useState(false);
  const [statusFilter, setStatusFilter] = useState('업무요청중');
  const { user } = useAuth();
  const apiRequest = useApiRequest();

  // 영업과장은 읽기 전용이므로 업무 요청 처리 불가
  if (user?.userType === 'sales_manager') {
    return (
      <Layout title="업무 요청중">
        <div className="flex flex-col items-center justify-center h-64">
          <MessageSquare className="h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">접근 권한이 없습니다</h3>
          <p className="text-sm text-gray-500">영업과장은 읽기 전용 권한입니다.</p>
        </div>
      </Layout>
    );
  }

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 선택된 상태의 서류들 조회
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['/api/documents', { activationStatus: statusFilter }],
    queryFn: () => apiRequest(`/api/documents?activationStatus=${encodeURIComponent(statusFilter)}`)
  });

  // 서비스 플랜 조회
  const { data: servicePlans = [] } = useQuery({
    queryKey: ['/api/service-plans'],
    queryFn: () => apiRequest('/api/service-plans')
  });

  // 부가 서비스 조회 (통신망별 필터링)
  const { data: additionalServices = [] } = useQuery({
    queryKey: ['/api/additional-services', selectedDocument?.carrier],
    queryFn: () => {
      const carrier = selectedDocument?.carrier;
      const params = carrier ? `?carrier=${encodeURIComponent(carrier)}` : '';
      return apiRequest(`/api/additional-services${params}`);
    },
    enabled: statusDialogOpen, // 상태 변경 다이얼로그가 열렸을 때만 실행
  });

  // 활성화 상태 변경 폼
  const statusForm = useForm<any>({
    defaultValues: {
      activationStatus: '개통',
      notes: '',
      deviceModel: '',
      simNumber: '',
      subscriptionNumber: '',
      servicePlanId: undefined,
      additionalServices: [],
      registrationFeePrepaid: false,
      registrationFeePostpaid: false,
      registrationFeeInstallment: false,
      simFeePrepaid: false,
      simFeePostpaid: false,
      bundleApplied: false,
      bundleNotApplied: false
    }
  });

  // 활성화 상태 변경 mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => {
      return apiRequest(`/api/documents/${id}/activation-status`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
      setStatusDialogOpen(false);
      setSelectedDocument(null);
      statusForm.reset();
      toast({
        title: "처리 완료",
        description: "업무가 성공적으로 처리되었습니다."
      });
    },
    onError: (error: any) => {
      toast({
        title: "처리 실패",
        description: error.message || "업무 처리에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleStatusUpdate = (document: Document) => {
    setSelectedDocument(document);
    statusForm.reset({
      activationStatus: '개통',
      notes: '',
      deviceModel: document.deviceModel || '',
      simNumber: document.simNumber || '',
      subscriptionNumber: document.subscriptionNumber || '',
      servicePlanId: document.servicePlanId || undefined,
      additionalServices: [],
      registrationFeePrepaid: document.registrationFeePrepaid || false,
      registrationFeePostpaid: document.registrationFeePostpaid || false,
      registrationFeeInstallment: document.registrationFeeInstallment || false,
      simFeePrepaid: document.simFeePrepaid || false,
      simFeePostpaid: document.simFeePostpaid || false,
      bundleApplied: document.bundleApplied || false,
      bundleNotApplied: document.bundleNotApplied || false
    });
    setStatusDialogOpen(true);
  };

  const onSubmitStatus = (data: any) => {
    if (!selectedDocument) return;
    
    const payload = {
      ...data,
      status: '개통완료',
      activatedBy: user?.id
    };
    
    updateStatusMutation.mutate({
      id: selectedDocument.id,
      data: payload
    });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case '대기': return 'secondary';
      case '진행중': return 'default';
      case '업무요청중': return 'destructive';
      case '개통완료': return 'default';
      case '취소': return 'secondary';
      case '보완필요': return 'destructive';
      case '기타완료': return 'default';
      case '폐기': return 'secondary';
      default: return 'default';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">업무 요청 목록을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout title="작업">
      <div className="space-y-6">
        {/* 상태 필터 */}
        <Card>
          <CardHeader>
            <CardTitle>유선 접수 현황</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium">상태:</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="대기,진행중">대기,진행중</SelectItem>
                    <SelectItem value="업무요청중">업무요청중</SelectItem>
                    <SelectItem value="개통완료">개통완료</SelectItem>
                    <SelectItem value="취소">취소</SelectItem>
                    <SelectItem value="보완필요">보완필요</SelectItem>
                    <SelectItem value="기타완료">기타완료</SelectItem>
                    <SelectItem value="폐기">폐기</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Badge variant="outline" className="text-lg px-3 py-1">
                  총 {documents.length}건
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

      {documents.length === 0 ? (
        <Card>
          <CardContent className="py-16">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">서류가 없습니다</h3>
              <p className="mt-1 text-sm text-gray-500">선택한 상태의 서류가 없습니다.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {documents.map((document: Document) => (
            <Card key={document.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center space-x-3">
                      <Badge variant={getStatusBadgeVariant(document.activationStatus)}>
                        {document.activationStatus}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(document.uploadedAt), { 
                          addSuffix: true, 
                          locale: ko 
                        })}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="flex items-center space-x-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{document.customerName}</p>
                          <p className="text-xs text-muted-foreground">고객명</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{document.customerPhone}</p>
                          <p className="text-xs text-muted-foreground">연락처</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Building className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{document.carrier}</p>
                          <p className="text-xs text-muted-foreground">통신사</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">
                            {new Date(document.uploadedAt).toLocaleDateString('ko-KR')}
                          </p>
                          <p className="text-xs text-muted-foreground">접수일</p>
                        </div>
                      </div>
                    </div>

                    {document.dealerNotes && (
                      <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
                        <div className="flex items-start space-x-2">
                          <MessageSquare className="h-4 w-4 text-green-600 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-green-800">판매점 메모</p>
                            <p className="text-sm text-green-700 mt-1">{document.dealerNotes}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="ml-4">
                    <Button 
                      onClick={() => handleStatusUpdate(document)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="mr-2 h-4 w-4" />
                      완료 처리
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 완료 처리 다이얼로그 */}
      {selectedDocument && (
        <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>업무 완료 처리</DialogTitle>
            </DialogHeader>
            
            <Form {...statusForm}>
              <form onSubmit={statusForm.handleSubmit(onSubmitStatus)} className="space-y-6">
                <div className="bg-gray-50 p-4 rounded-lg">
                  <h3 className="text-lg font-medium mb-2">고객 정보</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><strong>고객명:</strong> {selectedDocument.customerName}</div>
                    <div><strong>연락처:</strong> {selectedDocument.customerPhone}</div>
                    <div><strong>통신사:</strong> {selectedDocument.carrier}</div>
                    <div><strong>접수일:</strong> {new Date(selectedDocument.uploadedAt).toLocaleDateString('ko-KR')}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <FormField
                    control={statusForm.control}
                    name="deviceModel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>기기 모델</FormLabel>
                        <FormControl>
                          <Input placeholder="기기 모델을 입력하세요" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={statusForm.control}
                    name="simNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>유심 번호</FormLabel>
                        <FormControl>
                          <Input placeholder="유심 번호를 입력하세요" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={statusForm.control}
                    name="subscriptionNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>가입 번호 *</FormLabel>
                        <FormControl>
                          <Input placeholder="가입 번호를 입력하세요" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 요금제 선택 */}
                <FormField
                  control={statusForm.control}
                  name="servicePlanId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>요금제 선택</FormLabel>
                      <FormControl>
                        <Select value={field.value?.toString()} onValueChange={(value) => field.onChange(parseInt(value))}>
                          <SelectTrigger>
                            <SelectValue placeholder="요금제를 선택하세요..." />
                          </SelectTrigger>
                          <SelectContent>
                            {servicePlans
                              ?.filter((plan: any) => plan.carrier === selectedDocument?.carrier)
                              ?.map((plan: any) => (
                                <SelectItem key={plan.id} value={plan.id.toString()}>
                                  {plan.planName || plan.name}
                                </SelectItem>
                              )) || []}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* 부가서비스 선택 */}
                <div>
                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    부가서비스 (복수 선택 가능)
                  </label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {additionalServices?.length > 0 && additionalServices.map((service: any) => (
                      <FormField
                        key={service.id}
                        control={statusForm.control}
                        name="additionalServices"
                        render={({ field }) => {
                          const currentValue = field.value || [];
                          return (
                            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                              <FormControl>
                                <Checkbox
                                  checked={currentValue.includes(service.id)}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      field.onChange([...currentValue, service.id]);
                                    } else {
                                      field.onChange(currentValue.filter((id: number) => id !== service.id));
                                    }
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal">
                                {service.serviceName || service.name}
                              </FormLabel>
                            </FormItem>
                          );
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* 가입비 */}
                <div>
                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    가입비
                  </label>
                  <div className="flex space-x-4 mt-2">
                    <FormField
                      control={statusForm.control}
                      name="registrationFeePrepaid"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('registrationFeePostpaid', false);
                                  statusForm.setValue('registrationFeeInstallment', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">선납</FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={statusForm.control}
                      name="registrationFeePostpaid"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('registrationFeePrepaid', false);
                                  statusForm.setValue('registrationFeeInstallment', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">후납</FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={statusForm.control}
                      name="registrationFeeInstallment"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('registrationFeePrepaid', false);
                                  statusForm.setValue('registrationFeePostpaid', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">분납</FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* 유심비 */}
                <div>
                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    유심비
                  </label>
                  <div className="flex space-x-4 mt-2">
                    <FormField
                      control={statusForm.control}
                      name="simFeePrepaid"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('simFeePostpaid', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">선납</FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={statusForm.control}
                      name="simFeePostpaid"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('simFeePrepaid', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">후납</FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* 번들 */}
                <div>
                  <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    번들
                  </label>
                  <div className="flex space-x-4 mt-2">
                    <FormField
                      control={statusForm.control}
                      name="bundleApplied"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('bundleNotApplied', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">적용</FormLabel>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={statusForm.control}
                      name="bundleNotApplied"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={(checked) => {
                                field.onChange(checked);
                                if (checked) {
                                  statusForm.setValue('bundleApplied', false);
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-sm font-normal">미적용</FormLabel>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <FormField
                  control={statusForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>완료 메모</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="완료 처리 관련 메모를 입력하세요 (선택사항)"
                          className="min-h-[100px]"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setStatusDialogOpen(false)}
                  >
                    취소
                  </Button>
                  <Button 
                    type="button"
                    disabled={updateStatusMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      const formData = statusForm.getValues();
                      onSubmitStatus(formData);
                    }}
                  >
                    {updateStatusMutation.isPending ? '처리 중...' : '개통완료 변경'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}
      </div>
    </Layout>
  );
}
