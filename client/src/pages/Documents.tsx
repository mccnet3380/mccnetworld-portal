import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { Progress } from '@/components/ui/progress';

import { useApiRequest, useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import type { Document } from '../../../shared/schema';
import { FileText, Upload, Search, Download, Calendar, Settings, Check, ChevronsUpDown, Calculator, MessageCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ChatDialog } from '@/components/ChatDialog';
import { cn } from '@/lib/utils';

export function Documents() {
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  

  const [filters, setFilters] = useState({
    status: 'all',
    search: '',
    contactCode: 'all',
    startDate: '',
    endDate: ''
  });
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    customerName: '',
    customerPhone: '',
    notes: ''
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // 공통 업로드 함수 - 진행율 표시 포함
  const uploadWithProgress = (
    file: File, 
    url: string, 
    progressCallback: (progress: number) => void,
    formDataFields?: Record<string, string>
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);
      
      // 추가 필드 있으면 추가
      if (formDataFields) {
        Object.entries(formDataFields).forEach(([key, value]) => {
          formData.append(key, value);
        });
      }

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          progressCallback(Math.round(percentComplete));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      // 인증 헤더 추가
      const sessionId = useAuth.getState().sessionId;
      if (sessionId) {
        xhr.setRequestHeader('Authorization', `Bearer ${sessionId}`);
      }

      xhr.open('POST', url);
      xhr.send(formData);
    });
  };
  const [activationDialogOpen, setActivationDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [activationForm, setActivationForm] = useState({
    activationStatus: '',
    notes: '',
    supplementNotes: '',
    dealerNotes: '',
    deviceModel: '',
    simNumber: '',
    subscriptionNumber: '',
    servicePlanId: '',
    servicePlanName: '', // 요금제 이름 (자동완성용)
    additionalServiceIds: [] as string[],
    registrationFeePrepaid: false,
    registrationFeePostpaid: false,
    registrationFeeInstallment: false,
    simFeePrepaid: false,
    simFeePostpaid: false,
    bundleApplied: false,
    bundleNotApplied: false,
    discardReason: ''
  });
  
  const [servicePlanDialogOpen, setServicePlanDialogOpen] = useState(false);
  // 개통 다이얼로그용 상태
  const [activationServicePlanComboboxOpen, setActivationServicePlanComboboxOpen] = useState(false);
  const [activationServicePlanSearchValue, setActivationServicePlanSearchValue] = useState('');
  // 기본 요금제 선택용 상태
  const [servicePlanComboboxOpen, setServicePlanComboboxOpen] = useState(false);
  const [servicePlanSearchValue, setServicePlanSearchValue] = useState('');
  const [servicePlanForm, setServicePlanForm] = useState({
    servicePlanId: '',
    additionalServiceIds: [] as string[],
    registrationFeePrepaid: false, // 가입비 선납
    registrationFeePostpaid: false, // 가입비 후납
    registrationFeeInstallment: false, // 가입비 분납
    simFeePrepaid: false, // 유심 선납
    simFeePostpaid: false, // 유심 후납
    bundleApplied: false, // 결합
    bundleNotApplied: false, // 미결합
    deviceModel: '',
    simNumber: '',
    subscriptionNumber: ''
  });

  // 현재 URL 경로에 따라 필터링 결정
  const isOtherCompletions = window.location.pathname === '/other-completions';

  // 사용자 목록 가져오기 (처리자 이름 매핑용)
  const { data: allUsers } = useQuery({
    queryKey: ['/api/users'],
    queryFn: () => apiRequest('/api/users'),
    enabled: isOtherCompletions, // 기타완료 페이지에서만 로드
  });

  const { data: documents, isLoading } = useQuery({
    queryKey: ['/api/documents', filters, user?.id, isOtherCompletions],
    queryFn: () => {
      const params = new URLSearchParams();
      
      // URL 경로에 따라 activationStatus 설정
      if (isOtherCompletions) {
        params.append('activationStatus', '기타완료');
      } else {
        // 접수 관리는 대기/진행중 상태만 표시 (업무요청중 제외)
        params.append('activationStatus', '대기,진행중');
        params.append('excludeDeleted', 'true');
        params.append('excludeWorkRequests', 'true'); // 업무요청중 제외
        
        // 근무자는 자신이 접수한 문서만 조회, 관리자는 모든 문서 조회
        if (user?.userRole === 'dealer_worker') {
          params.append('workerFilter', 'my'); // 자신이 접수한 문서만
        } else {
          params.append('allWorkers', 'true'); // 관리자는 모든 문서
        }
      }
      
      Object.entries(filters).forEach(([key, value]) => {
        if (value && value !== 'all' && key !== 'activationStatus') {
          params.append(key, value);
        }
      });
      return apiRequest(`/api/documents?${params}`);
    },
    refetchInterval: 3000,
  });

  // 클라이언트 사이드 필터링 추가 - 접수 관리에서는 대기/진행중만 표시 (업무요청중 확실히 제외)
  const filteredDocuments = documents ? (
    isOtherCompletions 
      ? documents
      : documents.filter((doc: any) => 
          ['대기', '진행중'].includes(doc.activationStatus) && 
          doc.activationStatus !== '업무요청중' // 업무요청중 확실히 제외
        )
  ) : [];

  // 중복 제거: id 기준으로 유일한 문서만 유지
  const uniqueDocuments = filteredDocuments.reduce((acc: any[], doc: any) => {
    if (!acc.some(d => d.id === doc.id)) {
      acc.push(doc);
    }
    return acc;
  }, []);

  const { data: servicePlans, isLoading: servicePlansLoading } = useQuery({
    queryKey: ['/api/service-plans'],
    queryFn: () => apiRequest('/api/service-plans'),
    enabled: activationDialogOpen || servicePlanDialogOpen || activationServicePlanComboboxOpen, // 다이얼로그나 콤보박스가 열렸을 때 실행
    staleTime: 5 * 60 * 1000, // 5분간 캐시 유지
    refetchOnWindowFocus: false, // 창 포커스 시 새로고침 비활성화
    refetchInterval: false, // 자동 새로고침 비활성화
    refetchIntervalInBackground: false // 백그라운드 자동 새로고침 비활성화
  });

  // servicePlans 로드 후 servicePlanName 업데이트
  useEffect(() => {
    if (activationForm.servicePlanId && servicePlans && servicePlans.length > 0) {
      const planName = servicePlans.find((plan: any) => 
        plan.id.toString() === activationForm.servicePlanId
      )?.name || '';
      
      if (planName && planName !== activationForm.servicePlanName) {
        setActivationForm(prev => ({ ...prev, servicePlanName: planName }));
      }
    }
  }, [activationForm.servicePlanId, servicePlans]);

  // 부가서비스 API 데이터 (통신망별 필터링)
  const { data: additionalServices = [] } = useQuery({
    queryKey: ['/api/additional-services', selectedDocument?.carrier],
    queryFn: () => {
      const carrier = selectedDocument?.carrier;
      const params = carrier ? `?carrier=${encodeURIComponent(carrier)}` : '';
      return apiRequest(`/api/additional-services${params}`);
    },
    enabled: activationDialogOpen, // 활성화 대화상자가 열렸을 때만 실행
  });

  const uploadMutation = useMutation({
    mutationFn: async (data: FormData) => {
      setUploadProgress(0);
      // FormData에서 파일과 데이터 추출
      const file = data.get('file') as File;
      const customerName = data.get('customerName') as string;
      const customerPhone = data.get('customerPhone') as string;
      const notes = data.get('notes') as string;
      
      return uploadWithProgress(
        file,
        '/api/documents',
        setUploadProgress,
        { customerName, customerPhone, notes }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-stats'] });
      setUploadDialogOpen(false);
      setUploadForm({ customerName: '', customerPhone: '', notes: '' });
      setSelectedFile(null);
      toast({
        title: '성공',
        description: '서류가 성공적으로 업로드되었습니다.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: '오류',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-stats'] });
      toast({
        title: '성공',
        description: '서류가 삭제되었습니다.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: '오류',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // 일괄 정산 생성 뮤테이션
  const bulkCreateSettlementMutation = useMutation({
    mutationFn: () => apiRequest('/api/settlements/bulk-from-activated', { method: 'POST' }),
    onSuccess: (data: any) => {
      toast({
        title: "정산 생성 완료",
        description: data.message || "개통 완료된 문서들이 정산으로 변환되었습니다.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "정산 생성 실패",
        description: error.message || "일괄 정산 생성에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  // Helper function to format date for reception number
  const formatReceptionDateTime = (dateInput: any) => {
    try {
      // null, undefined, empty string 체크
      if (!dateInput || dateInput === '' || dateInput === null || dateInput === undefined) {
        return '-';
      }
      
      let date: Date;
      
      // 타입별 처리
      if (typeof dateInput === 'string') {
        // 문자열인 경우 ISO 문자열로 파싱
        date = new Date(dateInput);
      } else if (typeof dateInput === 'number') {
        // 숫자인 경우 timestamp로 파싱
        date = new Date(dateInput);
      } else if (dateInput instanceof Date) {
        // 이미 Date 객체인 경우
        date = dateInput;
      } else {
        // 기타 타입은 문자열로 변환 후 파싱 시도
        date = new Date(String(dateInput));
      }
      
      // 유효하지 않은 날짜 체크
      if (isNaN(date.getTime()) || !isFinite(date.getTime())) {
        return '-';
      }
      
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const minute = String(date.getMinutes()).padStart(2, '0');
      
      return `${month}/${day} ${hour}:${minute}`;
    } catch (error) {
      return '-';
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 파일 업로드는 선택사항으로 변경됨

    const formData = new FormData();
    // 파일이 있을 때만 추가
    if (selectedFile) {
      formData.append('file', selectedFile);
    }
    formData.append('customerName', uploadForm.customerName);
    formData.append('customerPhone', uploadForm.customerPhone);
    formData.append('notes', uploadForm.notes);

    uploadMutation.mutate(formData);
  };

  const getCustomerFileName = (customerName: string, originalFileName: string) => {
    // 파일 확장자 추출
    const fileExtension = originalFileName.includes('.') 
      ? originalFileName.substring(originalFileName.lastIndexOf('.'))
      : '';
    
    // 고객명을 파일명에 안전하게 사용할 수 있도록 처리
    const safeCustomerName = customerName.replace(/[^가-힣a-zA-Z0-9]/g, '_');
    
    return `${safeCustomerName}_서류${fileExtension}`;
  };

  const handlePreview = async (documentId: number) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      
      // Get document info to check for attachments
      const currentDoc = uniqueDocuments?.find((doc: any) => doc.id === documentId);
      const attachments = currentDoc?.attachments || [];
      
      // Load the first file for preview
      const response = await fetch(`/api/files/documents/${documentId}?disposition=inline`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        toast({
          title: "파일 열기 실패",
          description: errorText.slice(0, 200) || '파일을 불러오는데 실패했습니다.',
          variant: "destructive",
        });
        return;
      }

      const contentType = response.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream';
      const contentDisposition = response.headers.get('Content-Disposition');
      const fileName = contentDisposition 
        ? decodeURIComponent(contentDisposition.split('filename=')[1]?.replace(/"/g, '') || 'document')
        : 'document';

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      const isImage = contentType.startsWith('image/');
      const isPdf = contentType === 'application/pdf';
      const canPreview = isImage || isPdf;
      
      setPreviewFile({
        url: objectUrl,
        type: contentType,
        name: fileName,
        canPreview,
        documentId,
        attachments,
        currentIndex: 0
      });
      setPreviewDialogOpen(true);
    } catch (error) {
      toast({
        title: "파일 열기 실패",
        description: error instanceof Error ? error.message : "파일을 여는 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = async (documentId: number) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      
      // 현재 문서의 정보 가져오기
      const currentDoc = uniqueDocuments?.find((doc: any) => doc.id === documentId);
      const mimeType = currentDoc?.fileMimetype || '';
      const isImage = mimeType.startsWith('image/');
      
      // 이미지 파일은 PDF로 변환해서 다운로드
      const queryParam = isImage ? '?format=pdf' : '';
      
      const response = await fetch(`/api/files/documents/${documentId}${queryParam}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
      });

      if (!response.ok) {
        throw new Error('파일 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      const originalFileName = contentDisposition 
        ? decodeURIComponent(contentDisposition.split('filename=')[1]?.replace(/"/g, '') || `document_${documentId}`)
        : `document_${documentId}`;
      
      // 현재 문서의 고객명 찾기
      const customerFileName = currentDoc 
        ? getCustomerFileName(currentDoc.customerName, originalFileName)
        : originalFileName;
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = customerFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "다운로드 완료",
        description: `${customerFileName} 파일이 다운로드되었습니다.${isImage ? ' (PDF로 변환됨)' : ''}`,
      });
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: error instanceof Error ? error.message : "파일 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = (documentId: number) => {
    if (confirm('정말 이 서류를 삭제하시겠습니까?')) {
      deleteMutation.mutate(documentId);
    }
  };

  const handleActivationStatusChange = (doc: Document) => {
    setSelectedDocument(doc);
    
    // additionalServiceIds 안전 파싱
    let parsedServiceIds: string[] = [];
    try {
      const serviceIds = (doc as any).additionalServiceIds;
      console.log('Parsing additionalServiceIds for doc:', doc.id, 'serviceIds:', serviceIds, 'type:', typeof serviceIds);
      
      if (Array.isArray(serviceIds)) {
        parsedServiceIds = serviceIds.map(id => id.toString());
      } else if (typeof serviceIds === 'string' && serviceIds.trim()) {
        parsedServiceIds = JSON.parse(serviceIds);
      }
      
      console.log('Parsed service IDs:', parsedServiceIds);
    } catch (error) {
      console.warn('Failed to parse additionalServiceIds:', (doc as any).additionalServiceIds, error);
      parsedServiceIds = [];
    }
    
    // 기존 요금제 이름 찾기
    const currentPlanName = servicePlans?.find((plan: any) => plan.id.toString() === (doc as any).servicePlanId?.toString())?.name || '';
    
    setActivationForm({
      activationStatus: (doc as any).activationStatus || '대기',
      notes: (doc as any).notes || '',
      supplementNotes: (doc as any).supplementNotes || '',
      dealerNotes: (doc as any).dealerNotes || '',
      deviceModel: (doc as any).deviceModel || '',
      simNumber: (doc as any).simNumber || '',
      subscriptionNumber: (doc as any).subscriptionNumber || '',
      servicePlanId: (doc as any).servicePlanId?.toString() || '',
      servicePlanName: currentPlanName,
      additionalServiceIds: parsedServiceIds,
      registrationFeePrepaid: (doc as any).registrationFeePrepaid || false,
      registrationFeePostpaid: (doc as any).registrationFeePostpaid || false,
      registrationFeeInstallment: (doc as any).registrationFeeInstallment || false,
      simFeePrepaid: (doc as any).simFeePrepaid || false,
      simFeePostpaid: (doc as any).simFeePostpaid || false,
      bundleApplied: (doc as any).bundleApplied || false,
      bundleNotApplied: (doc as any).bundleNotApplied || false,
      discardReason: (doc as any).discardReason || ''
    });
    setActivationDialogOpen(true);
  };

  const canSetServicePlan = (document: Record<string, any>) => {
    // 영업과장은 읽기 전용이므로 요금제 설정 불가
    return (document.activationStatus === '개통' || document.activationStatus === '개통완료') && user?.userType !== 'sales_manager';
  };

  const handleServicePlanChange = (doc: any) => {
    setSelectedDocument(doc);
    setServicePlanForm({
      servicePlanId: doc.servicePlanId?.toString() || '',
      additionalServiceIds: doc.additionalServiceIds || [],
      registrationFeePrepaid: doc.registrationFeePrepaid || false,
      registrationFeePostpaid: doc.registrationFeePostpaid || false,
      registrationFeeInstallment: doc.registrationFeeInstallment || false,
      simFeePrepaid: doc.simFeePrepaid || false,
      simFeePostpaid: doc.simFeePostpaid || false,
      bundleApplied: doc.bundleApplied || false,
      bundleNotApplied: doc.bundleNotApplied || false,
      deviceModel: doc.deviceModel || '',
      simNumber: doc.simNumber || '',
      subscriptionNumber: doc.subscriptionNumber || ''
    });
    setServicePlanDialogOpen(true);
  };

  const handleActivationSubmit = () => {
    if (!selectedDocument) return;
    
    // 개통완료 선택 시 가입번호 필수 체크
    if (activationForm.activationStatus === '개통' && !activationForm.subscriptionNumber?.trim()) {
      toast({
        title: "오류",
        description: "개통완료 처리 시 가입번호는 필수 입력 사항입니다.",
        variant: "destructive"
      });
      return;
    }

    // 폐기 시 폐기 사유 검증
    if (activationForm.activationStatus === '폐기' && !activationForm.discardReason?.trim()) {
      toast({
        title: "오류",
        description: "폐기 처리 시 폐기 사유는 필수 입력 사항입니다.",
        variant: "destructive"
      });
      return;
    }
    
    updateActivationMutation.mutate({
      id: selectedDocument.id,
      data: activationForm
    });
  };

  // Permission check functions
  const canUploadDocuments = () => {
    // 판매점만 접수 가능, 관리자와 근무자는 업로드 불가 (처리만 담당)
    // 영업과장은 읽기 전용이므로 업로드 불가
    return user?.userRole === 'dealer_store' && user?.userType !== 'sales_manager';
  };

  const canManageActivationStatus = () => {
    // 관리자는 모든 권한, 근무자도 개통상태 관리 가능
    // 영업과장은 읽기 전용이므로 상태 변경 불가
    if (user?.userType === 'sales_manager') return false;
    
    return user?.userType === 'admin' || 
           user?.userType === 'user' || 
           user?.userType === 'dealer';
  };

  const canDeleteDocuments = () => {
    // 관리자만 삭제 가능, 영업과장은 읽기 전용이므로 삭제 불가
    return user?.userType === 'admin';
  };

  const canManageSettlements = () => {
    // 관리자만 정산 관리 가능, 영업과장은 읽기 전용이므로 정산 생성 불가
    return user?.userType === 'admin';
  };

  const canExportToExcel = () => {
    // 관리자만 Excel 다운로드 가능 - 수정됨
    return user?.userType === 'admin';
  };

  const handleExportToExcel = async () => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch('/api/export/documents', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
      });

      if (!response.ok) {
        throw new Error('Excel 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `접수관리_${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "다운로드 완료",
        description: "Excel 파일이 다운로드되었습니다.",
      });
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: error instanceof Error ? error.message : "Excel 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  // Helper functions for the new table

  const updateActivationMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => {
      // 데이터 타입 변환
      const payload = {
        ...data,
        servicePlanId: data.servicePlanId ? Number(data.servicePlanId) : undefined,
        additionalServiceIds: data.additionalServiceIds?.length ? data.additionalServiceIds.join(',') : undefined,
        settlementAmount: data.settlementAmount ? Number(data.settlementAmount) : undefined,
        manualSettlementAmount: data.manualSettlementAmount ? Number(data.manualSettlementAmount) : undefined,
      };
      
      console.log('Activation payload:', payload); // 디버깅용 로그
      
      return apiRequest(`/api/documents/${id}/activation`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/monthly-activation-stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/monthly-status-stats'] });
      setActivationDialogOpen(false);
      setSelectedDocument(null);
      toast({
        title: '성공',
        description: '개통 상태가 업데이트되었습니다.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: '오류',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const updateServicePlanMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/documents/${id}/service-plan`, {
        method: 'PATCH',
        body: JSON.stringify(data)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      setServicePlanDialogOpen(false);
      toast({
        title: '성공',
        description: '요금제 정보가 업데이트되었습니다.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: '오류',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline', label: string }> = {
      '대기': { variant: 'secondary', label: '대기' },
      '진행중': { variant: 'default', label: '진행중' },
      '업무요청중': { variant: 'outline', label: '업무요청중' },
      '개통': { variant: 'default', label: '개통완료' },
      '폐기': { variant: 'destructive', label: '폐기' },
    };

    const config = statusConfig[status] || { variant: 'outline' as const, label: status };
    return <Badge variant={config.variant} className="text-xs px-1 py-0.5">{config.label}</Badge>;
  };

  const getActivationStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline', label: string }> = {
      '대기': { variant: 'secondary', label: '대기' },
      '진행중': { variant: 'default', label: '진행중' },
      '업무요청중': { variant: 'outline', label: '업무요청중' },
      '개통': { variant: 'default', label: '개통' },
      '폐기': { variant: 'destructive', label: '폐기' },
    };

    const config = statusConfig[status] || { variant: 'outline' as const, label: status };
    return <Badge variant={config.variant} className="text-xs px-1 py-0.5">{config.label}</Badge>;
  };

  // 통신사에 맞는 요금제 필터링
  const filteredServicePlans = servicePlans?.filter((plan: any) => {
    if (!selectedDocument?.carrier) return true;
    return plan.carrier === selectedDocument.carrier;
  }) || [];

  // 통신사에 맞는 부가서비스 필터링
  const filteredAdditionalServices = additionalServices?.filter((service: any) => {
    if (!selectedDocument?.carrier) return true;
    return service.carrier === selectedDocument.carrier;
  }) || [];

  // 요금제 검색 함수 (자동완성용)
  const fetchServicePlans = async (query: string) => {
    // 빈 쿼리일 때도 전체 필터링된 요금제 반환 (포커스 시 전체 목록 표시용)
    const lowerQuery = query.toLowerCase();
    const filtered = filteredServicePlans.filter((plan: any) =>
      !query || plan.name.toLowerCase().includes(lowerQuery)
    );
    
    return filtered.map((plan: any) => ({
      id: plan.id.toString(),
      name: plan.name
    }));
  };

  // Preview modal states
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<{
    url: string;
    type: string;
    name: string;
    canPreview: boolean;
    documentId: number;
    attachments?: any[];
    currentIndex?: number;
  } | null>(null);

  // Chat related states
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [chatDocumentId, setChatDocumentId] = useState<number | null>(null);

  const handleChatOpen = (documentId: number) => {
    setChatDocumentId(documentId);
    setChatDialogOpen(true);
  };

  return (
    <Layout title="접수 관리">
      <div className="space-y-6">
        {/* Header */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="text-2xl font-bold">접수 관리</CardTitle>
            <div className="flex space-x-2">
              {(user?.userType === 'admin' || user?.userType === 'user') && !user?.dealerId && (
                <Button 
                  variant="default" 
                  onClick={() => setLocation('/submit-application')}
                  data-testid="button-new-request"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  신규 접수
                </Button>
              )}
              {(user?.userType === 'admin' || user?.userType === 'user') && !user?.dealerId && (
                <Button 
                  variant="outline" 
                  onClick={() => setLocation('/other-application')}
                  data-testid="button-other-application"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  기타 신청
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
              <div>
                <Label htmlFor="search">검색</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
                  <Input
                    id="search"
                    placeholder="고객명 또는 연락처"
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    className="pl-8"
                    data-testid="input-search"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="contactCode">접점코드</Label>
                <Select
                  value={filters.contactCode}
                  onValueChange={(value) => setFilters({ ...filters, contactCode: value })}
                >
                  <SelectTrigger id="contactCode" data-testid="select-contact-code">
                    <SelectValue placeholder="전체" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    {/* 여기에 접점코드 목록 추가 */}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="startDate">시작일</Label>
                <div className="relative">
                  <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
                  <Input
                    id="startDate"
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                    className="pl-8"
                    data-testid="input-start-date"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="endDate">종료일</Label>
                <div className="relative">
                  <Calendar className="absolute left-2 top-2.5 h-4 w-4 text-gray-500" />
                  <Input
                    id="endDate"
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                    className="pl-8"
                    data-testid="input-end-date"
                  />
                </div>
              </div>
            </div>

            {/* Documents Table */}
            {isLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                <p className="mt-2 text-gray-500">데이터를 불러오는 중...</p>
              </div>
            ) : uniqueDocuments && uniqueDocuments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse border border-gray-200 text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">접수번호</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">고객명</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">연락처</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">접점코드</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">판매점명</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">통신사</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">이전통신사</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">고객유형</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">상태</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">개통상태</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">접수 일시</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">메모</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-medium text-gray-900">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueDocuments.map((doc: any) => (
                      <tr key={doc.id} className="hover:bg-gray-50">
                        <td className="border border-gray-200 px-3 py-2 text-sm text-blue-600 font-medium">
                          {formatReceptionDateTime(doc.createdAt)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm font-medium text-gray-900">
                          {doc.customerName}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.customerPhone}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.contactCode || '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500 min-w-[200px]">
                          {doc.storeName || '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.carrier || '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {doc.previousCarrier || '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm">
                          <Badge variant={doc.customerType === 'new' ? 'default' : 'secondary'} className="text-xs px-1 py-0.5">
                            {doc.customerType === 'new' ? '신규' : '번호이동'}
                          </Badge>
                        </td>
                        <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">
                          {getStatusBadge(doc.status)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">
                          {getActivationStatusBadge(doc.activationStatus)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500">
                          {formatReceptionDateTime(doc.updatedAt)}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 text-sm text-gray-500 max-w-[120px] truncate" title={doc.notes || ''}>
                          {doc.notes || '-'}
                        </td>
                        <td className="border border-gray-200 px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center space-x-1">
                            {canManageActivationStatus() && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleActivationStatusChange(doc)}
                                data-testid={`button-activation-${doc.id}`}
                              >
                                <Settings className="h-4 w-4" />
                              </Button>
                            )}
                            {doc.activationStatus === '진행중' && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleChatOpen(doc.id)}
                                className={cn("relative", (doc as any).hasUnreadMessages && "animate-glow-red")}
                                data-testid={`button-chat-${doc.id}`}
                              >
                                <MessageCircle className="h-4 w-4" />
                                {(doc as any).hasUnreadMessages && (
                                  <span className="absolute -top-1 -right-1 h-2 w-2 bg-red-500 rounded-full animate-pulse-red"></span>
                                )}
                              </Button>
                            )}
                            {((doc as any).filePath || (doc as any).file_path) && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handlePreview(doc.id)}
                                  data-testid={`button-view-${doc.id}`}
                                >
                                  <FileText className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDownload(doc.id)}
                                  data-testid={`button-download-${doc.id}`}
                                >
                                  <Download className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p>등록된 서류가 없습니다.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 개통 상태 변경 다이얼로그 */}
      <Dialog open={activationDialogOpen} onOpenChange={setActivationDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>개통 상태 변경</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* 고객 정보 표시 */}
            {selectedDocument && (
              <div className="bg-gray-50 p-4 rounded-md">
                <h3 className="text-sm font-medium text-gray-900 mb-2">고객 정보</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">고객명:</span> {selectedDocument.customerName}
                  </div>
                  <div>
                    <span className="text-gray-500">연락처:</span> {selectedDocument.customerPhone}
                  </div>
                  <div>
                    <span className="text-gray-500">대리점 코드:</span> {(selectedDocument as any).contactCode || '-'}
                  </div>
                  <div>
                    <span className="text-gray-500">통신사:</span> {(selectedDocument as any).carrier || '-'}
                  </div>
                </div>
              </div>
            )}

            {/* 개통 상태 선택 */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="activationStatus">개통 상태</Label>
                <Select
                  value={activationForm.activationStatus}
                  onValueChange={(value) => setActivationForm({ ...activationForm, activationStatus: value })}
                >
                  <SelectTrigger id="activationStatus">
                    <SelectValue placeholder="상태를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="대기">대기</SelectItem>
                    <SelectItem value="진행중">진행중</SelectItem>
                    <SelectItem value="업무요청중">업무요청중</SelectItem>
                    <SelectItem value="개통">개통</SelectItem>
                    <SelectItem value="기타완료">기타완료</SelectItem>
                    <SelectItem value="폐기">폐기</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 폐기 사유 입력 (폐기 선택시에만 표시) */}
              {activationForm.activationStatus === '폐기' && (
                <div className="space-y-2">
                  <Label htmlFor="discardReason">폐기 사유 *</Label>
                  <Textarea
                    id="discardReason"
                    value={activationForm.discardReason}
                    onChange={(e) => setActivationForm({ ...activationForm, discardReason: e.target.value })}
                    placeholder="폐기 사유를 입력하세요"
                    required
                  />
                </div>
              )}

              {/* 요금제 선택 */}
              <div className="space-y-2">
                <Label htmlFor="servicePlan">요금제 선택</Label>
                <AutocompleteInput
                  value={activationForm.servicePlanName}
                  onChange={(value) => setActivationForm({ ...activationForm, servicePlanName: value })}
                  onSelect={(option) => {
                    setActivationForm({
                      ...activationForm,
                      servicePlanId: option.id.toString(),
                      servicePlanName: option.name
                    });
                  }}
                  fetchOptions={fetchServicePlans}
                  placeholder="요금제를 검색하세요..."
                  data-testid="input-service-plan"
                />
              </div>

              {/* 부가서비스 선택 - 제거됨 */}
              {/* <div className="space-y-2">
                <Label>부가서비스</Label>
                <div className="border rounded-md p-3 max-h-32 overflow-y-auto">
                  {filteredAdditionalServices.length > 0 ? (
                    <div className="space-y-2">
                      {filteredAdditionalServices.map((service: any) => (
                        <div key={service.id} className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`service-${service.id}`}
                            checked={activationForm.additionalServiceIds.includes(service.id.toString())}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setActivationForm({
                                  ...activationForm,
                                  additionalServiceIds: [...activationForm.additionalServiceIds, service.id.toString()]
                                });
                              } else {
                                setActivationForm({
                                  ...activationForm,
                                  additionalServiceIds: activationForm.additionalServiceIds.filter(id => id !== service.id.toString())
                                });
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          <label htmlFor={`service-${service.id}`} className="text-sm">
                            {service.name}
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">부가서비스가 없습니다.</p>
                  )}
                </div>
              </div> */}

              {/* 가입번호 */}
              <div className="space-y-2">
                <Label htmlFor="subscriptionNumber">
                  가입번호 {activationForm.activationStatus === '개통' && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="subscriptionNumber"
                  value={activationForm.subscriptionNumber}
                  onChange={(e) => setActivationForm({ ...activationForm, subscriptionNumber: e.target.value })}
                  placeholder="가입번호를 입력하세요"
                />
              </div>

              {/* 단말기기종 */}
              <div className="space-y-2">
                <Label htmlFor="deviceModel">단말기기종</Label>
                <Input
                  id="deviceModel"
                  value={activationForm.deviceModel}
                  onChange={(e) => setActivationForm({ ...activationForm, deviceModel: e.target.value })}
                  placeholder="단말기기종을 입력하세요"
                />
              </div>

              {/* 유심번호 */}
              <div className="space-y-2">
                <Label htmlFor="simNumber">유심번호</Label>
                <Input
                  id="simNumber"
                  value={activationForm.simNumber}
                  onChange={(e) => setActivationForm({ ...activationForm, simNumber: e.target.value })}
                  placeholder="유심번호를 입력하세요"
                />
              </div>

              {/* 가입비 옵션 */}
              <div className="space-y-2">
                <Label>가입비</Label>
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.registrationFeePrepaid}
                      onChange={(e) => setActivationForm({ ...activationForm, registrationFeePrepaid: e.target.checked })}
                    />
                    <span className="text-sm">선납</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.registrationFeePostpaid}
                      onChange={(e) => setActivationForm({ ...activationForm, registrationFeePostpaid: e.target.checked })}
                    />
                    <span className="text-sm">후납</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.registrationFeeInstallment}
                      onChange={(e) => setActivationForm({ ...activationForm, registrationFeeInstallment: e.target.checked })}
                    />
                    <span className="text-sm">분납</span>
                  </label>
                </div>
              </div>

              {/* 유심비 옵션 */}
              <div className="space-y-2">
                <Label>유심비</Label>
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.simFeePrepaid}
                      onChange={(e) => setActivationForm({ ...activationForm, simFeePrepaid: e.target.checked })}
                    />
                    <span className="text-sm">선납</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.simFeePostpaid}
                      onChange={(e) => setActivationForm({ ...activationForm, simFeePostpaid: e.target.checked })}
                    />
                    <span className="text-sm">후납</span>
                  </label>
                </div>
              </div>

              {/* 결합 옵션 */}
              <div className="space-y-2">
                <Label>결합</Label>
                <div className="flex gap-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.bundleApplied}
                      onChange={(e) => setActivationForm({ ...activationForm, bundleApplied: e.target.checked })}
                    />
                    <span className="text-sm">결합</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={activationForm.bundleNotApplied}
                      onChange={(e) => setActivationForm({ ...activationForm, bundleNotApplied: e.target.checked })}
                    />
                    <span className="text-sm">미결합</span>
                  </label>
                </div>
              </div>

              {/* 업무 메모 */}
              <div className="space-y-2">
                <Label htmlFor="notes">업무 메모</Label>
                <Textarea
                  id="notes"
                  value={activationForm.notes}
                  onChange={(e) => setActivationForm({ ...activationForm, notes: e.target.value })}
                  placeholder="업무 메모를 입력하세요"
                  rows={3}
                />
              </div>

              {/* 보완 메모 */}
              <div className="space-y-2">
                <Label htmlFor="supplementNotes">보완 메모</Label>
                <Textarea
                  id="supplementNotes"
                  value={activationForm.supplementNotes}
                  onChange={(e) => setActivationForm({ ...activationForm, supplementNotes: e.target.value })}
                  placeholder="보완 메모를 입력하세요"
                  rows={3}
                />
              </div>

              {/* 딜러 메모 */}
              <div className="space-y-2">
                <Label htmlFor="dealerNotes">딜러 메모</Label>
                <Textarea
                  id="dealerNotes"
                  value={activationForm.dealerNotes}
                  onChange={(e) => setActivationForm({ ...activationForm, dealerNotes: e.target.value })}
                  placeholder="딜러 메모를 입력하세요"
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={() => setActivationDialogOpen(false)}
              >
                취소
              </Button>
              <Button
                onClick={handleActivationSubmit}
                disabled={updateActivationMutation.isPending}
              >
                {updateActivationMutation.isPending ? '저장 중...' : '저장'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Chat Dialog */}
      {chatDialogOpen && chatDocumentId && (
        <ChatDialog
          documentId={chatDocumentId}
          dealerId={user?.dealerId || 0}
        />
      )}

      {/* Preview Dialog */}
      <Dialog open={previewDialogOpen} onOpenChange={(open) => {
        setPreviewDialogOpen(open);
        if (!open && previewFile) {
          if (previewFile.url.startsWith('blob:')) {
            URL.revokeObjectURL(previewFile.url);
          }
          setPreviewFile(null);
        }
      }}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {previewFile?.name || '문서 미리보기'}
              {previewFile?.attachments && previewFile.attachments.length > 1 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({(previewFile.currentIndex || 0) + 1} / {previewFile.attachments.length})
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto relative">
            {previewFile?.canPreview ? (
              previewFile.type.startsWith('image/') ? (
                <img 
                  src={previewFile.url} 
                  alt={previewFile.name}
                  className="w-full h-auto"
                />
              ) : (
                <iframe
                  src={previewFile.url}
                  className="w-full h-[70vh]"
                  title={previewFile.name}
                />
              )
            ) : (
              <div className="text-center py-8">
                <FileText className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-gray-600 mb-4">이 파일은 미리보기를 지원하지 않습니다.</p>
              </div>
            )}
            
            {/* Navigation buttons for multiple files */}
            {previewFile?.attachments && previewFile.attachments.length > 1 && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute left-4 top-1/2 -translate-y-1/2"
                  onClick={async () => {
                    if (!previewFile || !previewFile.attachments) return;
                    const currentIdx = previewFile.currentIndex || 0;
                    const prevIdx = currentIdx > 0 ? currentIdx - 1 : previewFile.attachments.length - 1;
                    const prevFile = previewFile.attachments[prevIdx];
                    
                    // Load previous file
                    const sessionId = useAuth.getState().sessionId;
                    const response = await fetch(`/api/files/documents/${prevFile.id}?disposition=inline`, {
                      method: 'GET',
                      credentials: 'include',
                      headers: {
                        'Authorization': `Bearer ${sessionId}`
                      },
                    });
                    
                    if (response.ok) {
                      const contentType = response.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream';
                      const blob = await response.blob();
                      
                      // Revoke old URL
                      if (previewFile.url.startsWith('blob:')) {
                        URL.revokeObjectURL(previewFile.url);
                      }
                      
                      const objectUrl = URL.createObjectURL(blob);
                      const isImage = contentType.startsWith('image/');
                      const isPdf = contentType === 'application/pdf';
                      
                      setPreviewFile({
                        ...previewFile,
                        url: objectUrl,
                        type: contentType,
                        name: prevFile.originalFilename || prevFile.fileName || 'document',
                        canPreview: isImage || isPdf,
                        documentId: prevFile.id,
                        currentIndex: prevIdx
                      });
                    }
                  }}
                  disabled={!previewFile.attachments || previewFile.attachments.length <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  onClick={async () => {
                    if (!previewFile || !previewFile.attachments) return;
                    const currentIdx = previewFile.currentIndex || 0;
                    const nextIdx = currentIdx < previewFile.attachments.length - 1 ? currentIdx + 1 : 0;
                    const nextFile = previewFile.attachments[nextIdx];
                    
                    // Load next file
                    const sessionId = useAuth.getState().sessionId;
                    const response = await fetch(`/api/files/documents/${nextFile.id}?disposition=inline`, {
                      method: 'GET',
                      credentials: 'include',
                      headers: {
                        'Authorization': `Bearer ${sessionId}`
                      },
                    });
                    
                    if (response.ok) {
                      const contentType = response.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream';
                      const blob = await response.blob();
                      
                      // Revoke old URL
                      if (previewFile.url.startsWith('blob:')) {
                        URL.revokeObjectURL(previewFile.url);
                      }
                      
                      const objectUrl = URL.createObjectURL(blob);
                      const isImage = contentType.startsWith('image/');
                      const isPdf = contentType === 'application/pdf';
                      
                      setPreviewFile({
                        ...previewFile,
                        url: objectUrl,
                        type: contentType,
                        name: nextFile.originalFilename || nextFile.fileName || 'document',
                        canPreview: isImage || isPdf,
                        documentId: nextFile.id,
                        currentIndex: nextIdx
                      });
                    }
                  }}
                  disabled={!previewFile.attachments || previewFile.attachments.length <= 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="outline"
              onClick={() => setPreviewDialogOpen(false)}
            >
              닫기
            </Button>
            <Button
              onClick={() => {
                if (previewFile) {
                  handleDownload(previewFile.documentId);
                }
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              다운로드
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
