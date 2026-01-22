import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useApiRequest, useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import type { Document } from '../../../shared/schema';
import { FileText, Search, Calendar, CheckCircle, X, Download, Edit, Loader2, MessageSquare } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { ko } from 'date-fns/locale';

// API 엔드포인트 상수화
const API_ENDPOINTS = {
  UPDATE_DOC_INFO: (documentId: number) => `/api/documents/${documentId}`,
  UPDATE_ACTIVATION_STATUS: (documentId: number) => `/api/documents/${documentId}/activation-status`
};

interface DeviceEditDialogProps {
  document: Document | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
}

function DeviceEditDialog({ document, isOpen, onClose, onSave }: DeviceEditDialogProps) {
  const { user } = useAuth();
  const [activationStatus, setActivationStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [deviceSerialNumber, setDeviceSerialNumber] = useState('');
  const [servicePlanId, setServicePlanId] = useState('');
  const [subscriptionNumber, setSubscriptionNumber] = useState('');
  const [currentMonthServicePlan, setCurrentMonthServicePlan] = useState('none');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  // 서비스 플랜 목록 조회
  const { data: servicePlans = [] } = useQuery({
    queryKey: ['/api/service-plans'],
    queryFn: () => useApiRequest()('/api/service-plans'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // 당월요금제 변경용 통신사별 필터링된 서비스 플랜
  const filteredServicePlans = useMemo(() => {
    if (!document?.carrier || !servicePlans.length) return [];
    return servicePlans.filter((plan: any) => plan.carrier === document.carrier);
  }, [servicePlans, document?.carrier]);

  // 다이얼로그가 열릴 때 기존 값으로 초기화
  useEffect(() => {
    if (document && isOpen) {
      try {
        setIsLoading(true);
        setActivationStatus(document.activationStatus || '개통');
        setDeviceModel((document as any).deviceModel || '');
        setDeviceSerialNumber((document as any).deviceSerialNumber || '');
        setServicePlanId((document as any).servicePlanId?.toString() || 'none');
        setSubscriptionNumber((document as any).subscriptionNumber || '');
        
        // notes 필드에서 메모 및 당월요금제 정보 추출
        const notesData = (document as any).notes;
        let extractedCurrentMonthServicePlan = 'none';
        
        try {
          if (notesData && notesData.startsWith('{')) {
            const parsed = JSON.parse(notesData);
            const allMemos = [parsed.originalMemo, parsed.memo].filter(Boolean);
            setNotes(allMemos.join('\n\n'));
            
            // 기존 당월요금제 값 추출
            if (parsed.currentMonthServicePlan && parsed.currentMonthServicePlan !== 'none') {
              extractedCurrentMonthServicePlan = String(parsed.currentMonthServicePlan);
            } else if (parsed.currentMonthServicePlanId) {
              extractedCurrentMonthServicePlan = String(parsed.currentMonthServicePlanId);
            }
          } else {
            setNotes(notesData || '');
          }
        } catch {
          setNotes(notesData || '');
        }
        
        setCurrentMonthServicePlan(extractedCurrentMonthServicePlan);
      } catch (error) {
        console.error('문서 정보 로드 중 오류:', error);
        toast({
          title: "문서 로드 실패",
          description: "문서 정보를 불러오는 중 오류가 발생했습니다.",
          variant: "destructive",
        });
        onClose();
      } finally {
        setIsLoading(false);
      }
    }
  }, [document, isOpen, toast, onClose]);

  const handleSave = async () => {
    try {
      if (!document) {
        toast({
          title: "저장 실패",
          description: "문서 정보가 없습니다.",
          variant: "destructive",
        });
        return;
      }

      setIsLoading(true);
      
      // 기존 notes 파싱하여 병합
      let existingNotesData: any = {};
      try {
        const notesData = (document as any).notes;
        if (notesData && notesData.startsWith('{')) {
          existingNotesData = JSON.parse(notesData);
        }
      } catch {
        // 파싱 실패 시 빈 객체
      }
      
      // 당월 요금제 이름 찾기
      let currentMonthServicePlanName = null;
      if (currentMonthServicePlan && currentMonthServicePlan !== 'none') {
        const selectedPlan = filteredServicePlans.find((plan: any) => String(plan.id) === currentMonthServicePlan);
        if (selectedPlan) {
          currentMonthServicePlanName = selectedPlan.name;
        }
      }
      
      // notes JSON 병합 (기존 데이터 보존)
      const mergedNotes = {
        ...existingNotesData,
        originalMemo: notes || existingNotesData.originalMemo || '',
        memo: notes || existingNotesData.memo || '',
        currentMonthServicePlanId: currentMonthServicePlan !== 'none' ? currentMonthServicePlan : null,
        currentMonthServicePlanName: currentMonthServicePlanName,
        changedById: user?.id || null,
        changedByName: user?.name || null,
        changedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
      };
      
      const updateData: any = {
        deviceModel,
        deviceSerialNumber,
        servicePlanId: servicePlanId ? parseInt(servicePlanId) : null,
        subscriptionNumber,
        notes: JSON.stringify(mergedNotes)
      };

      // 개통 상태로 변경 시 개통 시각과 처리자 추가
      if (activationStatus === '개통' && document.activationStatus !== '개통') {
        updateData.activationStatus = '개통';
        updateData.activatedAt = new Date().toISOString();
        updateData.activatedBy = user?.id;
      }
      
      onSave(updateData);
      onClose();
    } catch (error) {
      console.error('저장 중 오류:', error);
      toast({
        title: "저장 실패",
        description: "정보 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = async () => {
    try {
      if (!document) {
        toast({
          title: "취소 실패",
          description: "문서 정보가 없습니다.",
          variant: "destructive",
        });
        return;
      }

      setIsLoading(true);
      const cancelData = {
        activationStatus: '취소',
        cancelledAt: new Date().toISOString(),
        notes: JSON.stringify({
          originalMemo: notes,
          memo: '개통취소 처리됨',
          currentMonthServicePlanId: null,
          currentMonthServicePlanName: null,
          lastUpdated: new Date().toISOString()
        })
      };
      onSave(cancelData);
      onClose();
    } catch (error) {
      console.error('취소 중 오류:', error);
      toast({
        title: "취소 실패",
        description: "개통취소 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // document가 없으면 렌더링하지 않음
  if (!document) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]" data-testid="dialog-device-edit">
        <DialogHeader>
          <DialogTitle>고객 정보 수정</DialogTitle>
          <DialogDescription>
            {document?.customerName || '고객'} 고객의 정보를 수정합니다.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="ml-2">로딩 중...</span>
          </div>
        ) : (
          <>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="deviceModel" className="text-right">
                  단말기기종
                </Label>
                <Input
                  id="deviceModel"
                  data-testid="input-device-model"
                  value={deviceModel}
                  onChange={(e) => setDeviceModel(e.target.value)}
                  className="col-span-3"
                  placeholder="단말기기종을 입력하세요"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="deviceSerialNumber" className="text-right">
                  단말 일련번호
                </Label>
                <Input
                  id="deviceSerialNumber"
                  data-testid="input-device-serial"
                  value={deviceSerialNumber}
                  onChange={(e) => setDeviceSerialNumber(e.target.value)}
                  className="col-span-3"
                  placeholder="단말 일련번호를 입력하세요"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="subscriptionNumber" className="text-right">
                  가입번호
                </Label>
                <Input
                  id="subscriptionNumber"
                  data-testid="input-subscription-number"
                  value={subscriptionNumber}
                  onChange={(e) => setSubscriptionNumber(e.target.value)}
                  className="col-span-3"
                  placeholder="가입번호를 입력하세요"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="currentMonthServicePlan" className="text-right">
                  당월 요금제 변경
                </Label>
                <Select 
                  value={currentMonthServicePlan} 
                  onValueChange={setCurrentMonthServicePlan}
                >
                  <SelectTrigger className="col-span-3" data-testid="select-current-month-plan">
                    <SelectValue placeholder="당월요금제를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">선택 안 함</SelectItem>
                    {filteredServicePlans.length > 0 ? (
                      filteredServicePlans.map((plan: any) => (
                        <SelectItem key={plan.id} value={String(plan.id)}>
                          {plan.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem disabled value="__no_plans__">
                        해당 통신사 요금제가 없습니다
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="activationStatus" className="text-right">
                  개통상태
                </Label>
                <Select 
                  value={activationStatus} 
                  onValueChange={setActivationStatus}
                >
                  <SelectTrigger className="col-span-3" data-testid="select-activation-status">
                    <SelectValue placeholder="개통상태를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="개통">개통</SelectItem>
                    <SelectItem value="취소">취소</SelectItem>
                    <SelectItem value="대기">대기</SelectItem>
                    <SelectItem value="진행중">진행중</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="notes" className="text-right">
                  메모
                </Label>
                <textarea
                  id="notes"
                  data-testid="textarea-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="col-span-3 p-2 border border-gray-300 rounded-md resize-y min-h-[80px]"
                  placeholder="메모를 입력하세요"
                />
              </div>
            </div>
            <DialogFooter className="flex justify-between">
              <Button
                type="button"
                variant="destructive"
                onClick={handleCancel}
                data-testid="button-cancel-activation"
                disabled={isLoading}
              >
                개통취소
              </Button>
              <div className="space-x-2">
                <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel" disabled={isLoading}>
                  취소
                </Button>
                <Button type="button" onClick={handleSave} data-testid="button-save" disabled={isLoading}>
                  저장
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CompletedActivations() {
  const apiRequest = useApiRequest();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // [수정 목적] 개통완료 관리 페이지 검색 기능 수정
  // - activatedByType 필터 추가하여 작업자구분(근무자/관리자) 검색 지원
  const [filters, setFilters] = useState({
    search: '',
    startDate: '',
    endDate: '',
    carrier: '',
    activatedByType: ''
  });
  
  // 메모 팝업 상태
  const [memoPopupOpen, setMemoPopupOpen] = useState(false);
  const [selectedMemoDocument, setSelectedMemoDocument] = useState<Document | null>(null);

  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  // 사용자 이름 캐시 (userId → name)
  const [userCache, setUserCache] = useState(new Map());

  // 등록된 통신사 목록 조회 (문서에서 사용된 통신사만)
  const { data: rawCarriers = [] } = useQuery({
    queryKey: ['/api/carriers/from-documents'],
    queryFn: () => apiRequest('/api/carriers/from-documents') as Promise<any[]>,
    staleTime: 5 * 60 * 1000
  });

  // 통신사 이름만 추출 (안전한 문자열 배열로 변환)
  const carriers = useMemo(() => {
    if (!Array.isArray(rawCarriers)) return [];
    return rawCarriers
      .map((carrier: any) => {
        // carrier가 객체면 name 추출, 문자열이면 그대로 사용
        if (typeof carrier === 'string') return carrier;
        if (carrier && typeof carrier === 'object' && carrier.name) {
          return String(carrier.name);
        }
        return null;
      })
      .filter((name): name is string => name !== null);
  }, [rawCarriers]);

  // 개통완료 문서 조회 - 기타완료 제외
  const { data: rawDocuments = [], isLoading, error } = useQuery({
    queryKey: ['/api/documents', 'completed', filters, user?.id],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('activationStatus', '개통');
      params.append('includeActivatedBy', 'true');
      
      // 권한별 필터 처리
      if (user?.userType === 'admin') {
        params.append('allWorkers', 'true');
      } else if (user?.userRole === 'dealer_worker') {
        // 근무자는 자신이 처리한 개통완료 건만 조회
        params.append('workerFilter', 'my');
      } else {
        params.append('allWorkers', 'true');
      }
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'all' && value !== '') {
          params.append(key, value);
        }
      });
      return apiRequest(`/api/documents?${params}`) as Promise<Document[]>;
    },
    staleTime: 0, // 실시간 업데이트
    refetchOnWindowFocus: true,
    refetchInterval: 30000, // 30초마다 자동 새로고침
    retry: 3
  });

  // 데이터 정규화 및 디버깅
  const documents = useMemo(() => {
    if (!Array.isArray(rawDocuments)) return [];
    
    const normalized = rawDocuments.map((doc: any) => {
      // 객체 필드를 안전하게 변환
      const normalizedDoc = { ...doc };
      
      // contactCode가 객체면 문자열로 변환
      if (normalizedDoc.contactCode && typeof normalizedDoc.contactCode === 'object') {
        console.warn('ContactCode is object:', normalizedDoc.contactCode);
        normalizedDoc.contactCode = normalizedDoc.contactCode.code || String(normalizedDoc.contactCode) || null;
      }
      
      // servicePlanId가 객체면 ID 추출
      if (normalizedDoc.servicePlanId && typeof normalizedDoc.servicePlanId === 'object') {
        console.warn('ServicePlanId is object:', normalizedDoc.servicePlanId);
        normalizedDoc.servicePlanId = normalizedDoc.servicePlanId.id || null;
      }
      
      // 모든 필드를 안전하게 처리
      Object.keys(normalizedDoc).forEach(key => {
        const value = normalizedDoc[key];
        // 객체나 배열이지만 명시적으로 허용되지 않은 필드는 JSON.stringify
        if (value && typeof value === 'object' && value !== null && !Array.isArray(value) &&
            !['notes', 'createdAt', 'updatedAt', 'activatedAt', 'uploadedAt', 'cancelledAt', 'assignedAt', 'supplementRequiredAt'].includes(key)) {
          console.warn(`Field ${key} is object:`, value);
          normalizedDoc[key] = JSON.stringify(value);
        }
      });
      
      return normalizedDoc;
    });

    // 중복 제거: id 기준으로 유일한 문서만 유지
    const uniqueDocuments = normalized.reduce((acc: any[], doc: any) => {
      if (!acc.some(d => d.id === doc.id)) {
        acc.push(doc);
      }
      return acc;
    }, []);

    return uniqueDocuments;
  }, [rawDocuments]);

  // Contact codes 조회 (판매점명 표시용)
  const { data: contactCodes = [] } = useQuery({
    queryKey: ['/api/contact-codes'],
    queryFn: () => apiRequest('/api/contact-codes') as Promise<any[]>,
    staleTime: 5 * 60 * 1000
  });

  // 사용자 목록 조회 (개통처리자 이름 표시용) - 권한 처리 추가
  const { data: users = [] } = useQuery({
    queryKey: ['/api/admin/users'],
    queryFn: () => apiRequest('/api/admin/users'),
    staleTime: 5 * 60 * 1000,
    enabled: user?.userType === 'admin', // 관리자만 사용자 목록 조회
    retry: false // 403 에러시 재시도하지 않음
  });

  // 권한이 없는 경우 기본 사용자 정보만 조회
  const { data: basicUsers = [] } = useQuery({
    queryKey: ['/api/users/basic'],
    queryFn: () => apiRequest('/api/users/basic'),
    staleTime: 5 * 60 * 1000,
    enabled: user?.userType !== 'admin', // 관리자가 아닌 경우
    retry: false
  });

  // 서비스 플랜 목록 조회 (요금제 이름 표시용)
  const { data: allServicePlans = [] } = useQuery({
    queryKey: ['/api/service-plans'],
    queryFn: () => apiRequest('/api/service-plans'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  // 단말 정보 수정 mutation
  const updateDeviceInfoMutation = useMutation({
    mutationFn: ({ documentId, data }: { documentId: number; data: any }) => {
      return apiRequest(API_ENDPOINTS.UPDATE_DOC_INFO(documentId), {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast({
        title: "정보 수정 완료",
        description: "고객 정보가 성공적으로 수정되었습니다.",
      });
      // 즉시 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/monthly-activation-stats'] });
    },
    onError: (error: any) => {
      let errorMessage = "정보 수정 중 오류가 발생했습니다.";
      let showRetry = false;
      
      if (error?.status === 403) {
        errorMessage = "수정 권한이 없습니다.";
      } else if (error?.status === 404) {
        errorMessage = "존재하지 않는 문서입니다.";
        showRetry = false;
      } else if (error?.status === 409) {
        errorMessage = "데이터 충돌이 발생했습니다. 다시 시도해주세요.";
        showRetry = true;
      } else if (error?.status === 422) {
        errorMessage = "입력된 데이터가 올바르지 않습니다.";
      } else if (!navigator.onLine) {
        errorMessage = "네트워크 연결을 확인해주세요.";
        showRetry = true;
      }
      
      toast({
        title: "정보 수정 실패",
        description: errorMessage,
        variant: "destructive",
        action: showRetry ? (
          <Button variant="outline" size="sm" onClick={() => {
            // 재시도 로직은 기존과 동일하게 유지
          }}>
            다시 시도
          </Button>
        ) : undefined,
      });
    }
  });

  // 개통취소 mutation
  const cancelActivationMutation = useMutation({
    mutationFn: (documentId: number) => {
      return apiRequest(API_ENDPOINTS.UPDATE_ACTIVATION_STATUS(documentId), {
        method: 'PUT',
        body: JSON.stringify({
          activationStatus: '취소',
          cancelledAt: new Date().toISOString(),
          notes: JSON.stringify({
            originalMemo: '', // 개통취소시에는 기존 메모 보존하지 않음
            memo: '개통취소 처리됨',
            currentMonthServicePlanId: null,
            currentMonthServicePlanName: null,
            lastUpdated: new Date().toISOString()
          })
        })
      });
    },
    onSuccess: () => {
      toast({
        title: "개통취소 완료",
        description: "문서가 개통취소로 변경되었습니다.",
      });
      // 즉시 캐시 무효화
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-stats'] });
    },
    onError: () => {
      toast({
        title: "개통취소 실패",
        description: "개통취소 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const handleCustomerNameClick = (document: Document) => {
    try {
      if (!document) {
        toast({
          title: "문서 오류",
          description: "문서 정보를 찾을 수 없습니다.",
          variant: "destructive",
        });
        return;
      }
      setSelectedDocument(document);
      setIsEditDialogOpen(true);
    } catch (error) {
      console.error('고객명 클릭 처리 중 오류:', error);
      toast({
        title: "오류 발생",
        description: "문서를 열 수 없습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  const handleDeviceInfoSave = (data: any) => {
    try {
      if (!selectedDocument?.id) {
        toast({
          title: "저장 실패",
          description: "문서 ID가 없습니다.",
          variant: "destructive",
        });
        return;
      }
      updateDeviceInfoMutation.mutate({
        documentId: selectedDocument.id,
        data
      });
    } catch (error) {
      console.error('저장 처리 중 오류:', error);
      toast({
        title: "저장 실패",
        description: "저장 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleExportToExcel = async () => {
    try {
      const params = new URLSearchParams();
      params.append('activationStatus', '개통');
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });
      
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch(`/api/documents/export/excel?${params}`, {
        headers: {
          'Authorization': `Bearer ${sessionId}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Export failed: ${response.status} ${errorText}`);
      }
      
      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('다운로드할 데이터가 없습니다.');
      }
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `개통완료_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "내보내기 완료",
        description: "엑셀 파일이 다운로드되었습니다.",
      });
    } catch (error) {
      toast({
        title: "내보내기 실패",
        description: error instanceof Error ? error.message : "엑셀 파일 생성 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  // 판매점명 조회 함수 (안전한 문자열 반환 보장)
  const getDealerNameFromContactCode = (contactCode: string) => {
    try {
      if (!contactCode || !contactCodes?.length) return '-';
      const contact = contactCodes.find(cc => cc.code === contactCode);
      return String(contact?.dealerName || contactCode || '-');
    } catch {
      return '-';
    }
  };

  // 개통완료시간 포맷팅 함수 (MM/dd HH:mm 형식, activated_at 우선 → uploaded_at 폴백)
  const formatActivationTime = (doc: any) => {
    try {
      // activated_at 우선 확인
      const activatedAt = doc.activatedAt || doc.activated_at;
      if (activatedAt) {
        const date = new Date(activatedAt);
        if (!isNaN(date.getTime())) {
          return format(date, 'MM/dd HH:mm', { locale: ko });
        }
      }
      
      // uploaded_at 폴백
      const uploadedAt = doc.uploadedAt || doc.uploaded_at;
      if (uploadedAt) {
        const date = new Date(uploadedAt);
        if (!isNaN(date.getTime())) {
          return format(date, 'MM/dd HH:mm', { locale: ko });
        }
      }
      
      return '-';
    } catch {
      return '-';
    }
  };

  // 사용자 이름 조회 개선 - activated_by_type 활용
  const getActivatedByNameSync = (doc: any) => {
    try {
      // 1순위: 이름 필드 직접 사용
      if (doc?.activated_by_name) {
        return String(doc.activated_by_name);
      }
      if (doc?.processedByName) {
        return String(doc.processedByName);
      }
      if (doc?.activatedByName) {
        return String(doc.activatedByName);
      }
      
      // 2순위: ID를 통한 사용자 조회 (activated_by_type 기반 정확한 매칭)
      const activatorId = doc?.activated_by ?? doc?.activatedBy ?? doc?.activatorId ?? doc?.processed_by ?? doc?.processedBy ?? null;
      const activatedByType = doc?.activated_by_type ?? doc?.activatedByType;
      
      if (activatorId != null) {
        const normalizedId = String(activatorId);
        
        // 캐시 키: activatedByType이 있으면 "type:id", 없으면 "id"만
        const cacheKey = activatedByType ? `${activatedByType}:${normalizedId}` : normalizedId;
        
        // 캐시 조회
        if (userCache.has(cacheKey)) {
          return String(userCache.get(cacheKey));
        }
        
        // activated_by_type이 있으면 정확한 테이블에서 찾기
        if (activatedByType && users && Array.isArray(users)) {
          const user = users.find((u: any) => 
            (String(u.id) === normalizedId || u.id === activatorId) && 
            u.activatedByType === activatedByType
          );
          if (user?.name) {
            const foundUserName = String(user.name);
            setUserCache(prev => new Map(prev).set(cacheKey, foundUserName));
            return foundUserName;
          }
        }
        
        // basicUsers에서 찾기 (activated_by_type 기반)
        if (activatedByType && basicUsers && Array.isArray(basicUsers)) {
          const user = basicUsers.find((u: any) => 
            (String(u.id) === normalizedId || u.id === activatorId) &&
            u.activatedByType === activatedByType
          );
          if (user?.name) {
            const foundUserName = String(user.name);
            setUserCache(prev => new Map(prev).set(cacheKey, foundUserName));
            return foundUserName;
          }
        }
        
        // activated_by_type이 없으면 기존 방식 (폴백)
        if (!activatedByType) {
          // 관리자용 사용자 목록에서 찾기
          if (users && Array.isArray(users)) {
            const user = users.find((u: any) => String(u.id) === normalizedId || u.id === activatorId);
            if (user?.name) {
              const foundUserName = String(user.name);
              setUserCache(prev => new Map(prev).set(cacheKey, foundUserName));
              return foundUserName;
            }
          }
          
          // 기본 사용자 목록에서 찾기 (권한 없는 경우)
          if (basicUsers && Array.isArray(basicUsers)) {
            const user = basicUsers.find((u: any) => String(u.id) === normalizedId || u.id === activatorId);
            if (user?.name) {
              const foundUserName = String(user.name);
              setUserCache(prev => new Map(prev).set(cacheKey, foundUserName));
              return foundUserName;
            }
          }
        }
        
        // 사용자를 찾지 못한 경우 ID 표시
        return `근무자#${normalizedId}`;
      }
      
      return '-';
    } catch (error) {
      console.warn('사용자 이름 조회 실패:', error);
      return '-';
    }
  };

  // 요금제 이름 조회 함수 (안전한 문자열 반환 보장)
  const getServicePlanName = (servicePlanId: any) => {
    try {
      if (!servicePlanId || !allServicePlans?.length) return '-';
      const plan = allServicePlans.find((p: any) => p.id === servicePlanId || p.id === parseInt(servicePlanId));
      return String(plan?.name || '-');
    } catch {
      return '-';
    }
  };

  // 당월 요금제 변경 이름 조회 함수
  const getCurrentMonthServicePlanName = (doc: any) => {
    try {
      const notesData = doc?.notes;
      if (!notesData) return '-';
      
      // notes JSON 파싱
      if (notesData.startsWith('{')) {
        const parsed = JSON.parse(notesData);
        
        // 1순위: currentMonthServicePlanName 직접 반환
        if (parsed.currentMonthServicePlanName) {
          return String(parsed.currentMonthServicePlanName);
        }
        
        // 2순위: currentMonthServicePlanId로 조회
        if (parsed.currentMonthServicePlanId && parsed.currentMonthServicePlanId !== 'none') {
          if (allServicePlans?.length) {
            const planId = parseInt(parsed.currentMonthServicePlanId);
            const plan = allServicePlans.find((p: any) => p.id === planId);
            if (plan?.name) {
              return String(plan.name);
            }
          }
        }
        
        // 3순위: 구 방식 currentMonthServicePlan으로 조회
        if (parsed.currentMonthServicePlan && parsed.currentMonthServicePlan !== 'none') {
          if (allServicePlans?.length) {
            const planId = parseInt(parsed.currentMonthServicePlan);
            const plan = allServicePlans.find((p: any) => p.id === planId);
            if (plan?.name) {
              return String(plan.name);
            }
          }
        }
      }
      
      return '-';
    } catch (error) {
      console.warn('당월 요금제 조회 실패:', error);
      return '-';
    }
  };

  // 메모 클릭 핸들러
  const handleMemoClick = (document: Document) => {
    try {
      setSelectedMemoDocument(document);
      setMemoPopupOpen(true);
    } catch (error) {
      console.error('메모 팝업 오류:', error);
      toast({
        title: "메모 오류",
        description: "메모를 표시할 수 없습니다.",
        variant: "destructive",
      });
    }
  };

  // 에러 상태 처리
  if (error) {
    return (
      <Layout title="개통완료 관리">
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <div className="text-center">
              <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">데이터 로드 실패</h3>
              <p className="text-gray-500 mb-4">개통완료 문서를 불러올 수 없습니다.</p>
              <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['/api/documents'] })}>
                다시 시도
              </Button>
            </div>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout title="개통완료 관리">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center">
                <CheckCircle className="mr-2 h-5 w-5 text-green-600" />
                개통완료 문서 ({documents.length}건)
              </CardTitle>
              <div className="flex items-center space-x-2">
                {user?.userType === 'admin' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportToExcel}
                    data-testid="button-export-excel"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Excel 다운로드
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 검색 및 필터 */}
            {/* [수정 목적] 개통완료 관리 페이지 검색 기능 수정 - 작업자구분 필터 UI 추가 */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label htmlFor="search">검색</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                  <Input
                    id="search"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    placeholder="고객명, 연락처 검색"
                    className="pl-8"
                    data-testid="input-search"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="carrier">통신사</Label>
                <Select
                  value={filters.carrier}
                  onValueChange={(value) => setFilters({ ...filters, carrier: value === 'all' ? '' : value })}
                >
                  <SelectTrigger data-testid="select-carrier">
                    <SelectValue placeholder="모든 통신사" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">모든 통신사</SelectItem>
                    {carriers.map(carrier => (
                      <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="activatedByType">작업자구분</Label>
                <Select
                  value={filters.activatedByType || 'all'}
                  onValueChange={(value) => setFilters({ ...filters, activatedByType: value === 'all' ? '' : value })}
                >
                  <SelectTrigger data-testid="select-activated-by-type">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="user">근무자</SelectItem>
                    <SelectItem value="admin">관리자</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="startDate">시작일</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                  data-testid="input-start-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="endDate">종료일</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                  data-testid="input-end-date"
                />
              </div>
            </div>

            {/* 문서 목록 */}
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                <p className="mt-2 text-gray-500">데이터를 불러오는 중...</p>
              </div>
            ) : documents && documents.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse border border-gray-200 text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">개통완료시간</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">고객명</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">연락처</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">통신사</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">유형</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">판매점명</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">요금제</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">당월 요금제 변경</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">처리자</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc: any) => (
                      <tr key={doc.id} className="hover:bg-gray-50">
                        <td className="border border-gray-200 px-3 py-2 text-sm text-blue-600 font-medium">
                          {formatActivationTime(doc)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2">
                          <button
                            onClick={() => handleCustomerNameClick(doc)}
                            className="text-blue-600 hover:text-blue-800 underline font-medium"
                            data-testid={`button-customer-${doc.id}`}
                          >
                            {doc.customerName}
                          </button>
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.customerPhone}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.carrier || '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.customerType === 'new' ? '신규' : (doc.previousCarrier ?? '-')}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {getDealerNameFromContactCode(doc.contactCode)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {getServicePlanName(doc.servicePlanId)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {getCurrentMonthServicePlanName(doc)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {getActivatedByNameSync(doc)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm">
                          {doc.notes && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleMemoClick(doc)}
                                    data-testid={`button-memo-${doc.id}`}
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>메모 보기</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <CheckCircle className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p>개통완료된 문서가 없습니다.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 단말 정보 수정 다이얼로그 */}
      <DeviceEditDialog
        document={selectedDocument}
        isOpen={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
          setSelectedDocument(null);
        }}
        onSave={handleDeviceInfoSave}
      />

      {/* 메모 팝업 다이얼로그 */}
      <Dialog open={memoPopupOpen} onOpenChange={setMemoPopupOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>메모 내용</DialogTitle>
            <DialogDescription>
              {selectedMemoDocument?.customerName} 고객의 메모
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="p-3 bg-gray-50 rounded-md">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {(() => {
                  const notes = (selectedMemoDocument as any)?.notes;
                  if (!notes) return '메모가 없습니다.';
                  
                  try {
                    if (notes.startsWith('{')) {
                      const parsed = JSON.parse(notes);
                      return parsed.originalMemo || parsed.memo || '메모가 없습니다.';
                    }
                    return notes;
                  } catch {
                    return notes;
                  }
                })()}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMemoPopupOpen(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
