import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth, useApiRequest } from '@/lib/auth';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { Upload, Loader2, FileText, Phone, User, AlertTriangle, Search, ChevronDown, X } from 'lucide-react';
import { Carrier } from '@shared/schema';
import { useLocation } from 'wouter';
import { AutocompleteInput } from '@/components/AutocompleteInput';
import { CODE_PREFIX_MAP, getCodePrefix, hasCodePrefix } from '@shared/constants';

const UI_VERSION = 'dev-20251015-v3';
const UI_LOCK_KEY = 'submit-application-ui-structure';

const REQUIRED_UI_SECTIONS = [
  'customer-info-section',
  'carrier-info-section', 
  'document-upload-section',
  'additional-info-section'
];

const CACHE_BUSTER = Date.now();

const formatPrice = (price: number | undefined): string => {
  if (!price) return '';
  if (price % 1 === 0) {
    return Math.floor(price).toLocaleString();
  } else {
    return price.toLocaleString();
  }
};

export function SubmitApplication() {
  console.warn(`[UI_LOCK] SubmitApplication 컴포넌트 렌더링 시작 - ${new Date().toISOString()}`);
  console.warn(`[UI_LOCK] 컴포넌트 UI Version: ${UI_VERSION}`);
  
  const { user } = useAuth();
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location] = useLocation();
  
  useEffect(() => {
    console.warn(`[UI_LOCK] 접수 신청 페이지 로드 - UI Version: ${UI_VERSION}`);
    console.warn(`[UI_LOCK] useEffect 실행 시작 - 타임스탬프: ${Date.now()}`);
    
    if (import.meta.env.DEV) {
      setTimeout(() => {
        console.warn(`[UI_LOCK] DOM 검증 시작`);
        const missingSections = REQUIRED_UI_SECTIONS.filter(sectionId => {
          const element = document.querySelector(`[data-ui-section="${sectionId}"]`);
          console.warn(`[UI_LOCK] 섹션 검증: ${sectionId} = ${element ? '존재' : '누락'}`);
          return !element;
        });
        
        if (missingSections.length > 0) {
          console.warn(`[UI_DRIFT_DETECTED] 누락된 UI 섹션:`, missingSections);
        } else {
          console.warn(`[UI_LOCK] UI 구조 검증 완료 - 모든 필수 섹션 존재`);
        }
      }, 500);
    }
    
    setTimeout(async () => {
      try {
        console.warn(`[UI_LOCK] Beacon 전송 시도 중...`);
        const response = await apiRequest(`/api/health/db?ui_lock=${UI_VERSION}`);
        console.warn(`[UI_LOCK] Beacon 전송 완료:`, response);
      } catch (error) {
        console.warn(`[UI_LOCK] Beacon 전송 실패:`, error);
      }
    }, 1000);
  }, []);

  if (user?.userType === 'sales_manager') {
    return (
      <Layout title="접수 신청" showSidebar={true}>
        <div className="flex flex-col items-center justify-center h-64">
          <FileText className="h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">접근 권한이 없습니다</h3>
          <p className="text-sm text-gray-500">영업과장은 읽기 전용 권한입니다.</p>
        </div>
      </Layout>
    );
  }
  
  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    contactCode: '',
    storeName: '',
    carrier: '',
    previousCarrier: '',
    bundleNumber: '',
    bundleCarrier: '',
    customerType: 'new' as 'new' | 'port-in',
    desiredNumber: '',
    servicePlan: '',
    notes: '',
    activationStatus: '대기',
    deviceModel: '',
    simNumber: '',
    subscriptionNumber: '',
    servicePlanId: '',
    registrationFeePrepaid: false,
    registrationFeePostpaid: false,
    registrationFeeInstallment: false,
    simFeePrepaid: false,
    simFeePostpaid: false,
    bundleApplied: false,
    bundleNotApplied: false
  });

  // 통신사 자동완성용 상태
  const [carrierId, setCarrierId] = useState<string | number | null>(null);
  const [carrierName, setCarrierName] = useState('');

  // 접두어 자동입력 방식용 상태
  const [codePrefix, setCodePrefix] = useState('');
  const [codeSuffix, setCodeSuffix] = useState('');
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [contactCodeError, setContactCodeError] = useState('');
  
  // 딜러 자동 매칭용 상태
  const [isContactCodeLocked, setIsContactCodeLocked] = useState(false);
  const isMatchingRef = useRef(false);
  const lastCarrierKeyRef = useRef<string>('');

  const [selectedServicePlan, setSelectedServicePlan] = useState<any>(null);

  // 자동완성 최적화: AbortController, 로컬 캐시, 디바운스
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchCacheRef = useRef<Map<string, { data: any[], timestamp: number }>>(new Map());
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const CACHE_DURATION = 60000; // 60초
  const DEBOUNCE_DELAY = 250; // 250ms

  const searchContactCodes = useCallback(async (query: string) => {
    // 최소 2자 검증
    if (query.length < 2) {
      setContactCodeSuggestions([]);
      setShowContactCodeSuggestions(false);
      return;
    }

    // 로컬 캐시 확인
    const cacheKey = query.toLowerCase();
    const cached = searchCacheRef.current.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      setContactCodeSuggestions(cached.data);
      setShowContactCodeSuggestions(true);
      return;
    }

    // 이전 요청 취소
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }

    // 새 AbortController 생성
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;

    try {
      const response = await fetch(
        `/api/contact-codes/search?q=${encodeURIComponent(query)}&limit=20`,
        {
          signal: controller.signal,
          headers: {
            'Authorization': `Bearer ${useAuth.getState().sessionId}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();
      
      // 캐시에 저장
      searchCacheRef.current.set(cacheKey, { data, timestamp: now });
      
      setContactCodeSuggestions(data || []);
      setShowContactCodeSuggestions(true);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        // 정상적인 요청 취소, 무시
        return;
      }
      console.warn('접점코드 검색 실패:', error);
      setContactCodeSuggestions([]);
      setShowContactCodeSuggestions(false);
    }
  }, []);

  // 디바운스된 검색 함수
  const debouncedSearchContactCodes = useCallback((query: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchContactCodes(query);
    }, DEBOUNCE_DELAY);
  }, [searchContactCodes]);

  const handleContactCodeChange = async (contactCode: string) => {
    setFormData(prev => {
      const newData = { ...prev, contactCode };
      
      if (newData.carrier.includes('기타') && contactCode.trim()) {
        newData.storeName = contactCode;
      }
      
      return newData;
    });
    
    setContactCodeSearchTerm(contactCode);
    
    if (contactCode.trim() && !formData.carrier.includes('기타')) {
      // 디바운스된 자동완성 검색
      debouncedSearchContactCodes(contactCode);
      
      // 정확한 코드 조회 (통신사 필터 포함)
      try {
        const carrier = formData.carrier;
        const url = carrier 
          ? `/api/contact-codes/search/${encodeURIComponent(contactCode)}?carrier=${encodeURIComponent(carrier)}`
          : `/api/contact-codes/search/${encodeURIComponent(contactCode)}`;
        
        const response = await apiRequest(url);
        if (response?.dealerName) {
          setFormData(prev => ({ ...prev, storeName: response.dealerName }));
        }
      } catch (error) {
        console.warn('접점코드 조회 실패:', error);
      }
    } else {
      setContactCodeSuggestions([]);
      setShowContactCodeSuggestions(false);
    }
  };

  const selectContactCodeSuggestion = (suggestion: any) => {
    setFormData(prev => ({ 
      ...prev, 
      contactCode: suggestion.code, 
      storeName: suggestion.dealerName 
    }));
    setContactCodeSearchTerm(suggestion.code);
    setShowContactCodeSuggestions(false);
  };
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadWithProgress = (
    files: File[], 
    url: string, 
    progressCallback: (progress: number) => void,
    formDataFields?: Record<string, string>
  ): Promise<any> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      
      files.forEach(file => {
        formData.append('files', file);
      });
      
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

      xhr.open('POST', url);
      
      const sessionId = useAuth.getState().sessionId;
      if (sessionId) {
        xhr.setRequestHeader('Authorization', `Bearer ${sessionId}`);
      }

      xhr.send(formData);
    });
  };
  
  const [duplicateCheckDialog, setDuplicateCheckDialog] = useState(false);
  const [duplicateData, setDuplicateData] = useState<any[]>([]);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { data: allCarriers = [], isLoading: carriersLoading } = useQuery<Carrier[]>({
    queryKey: ['/api/carriers'],
    queryFn: () => apiRequest('/api/carriers'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const { data: currentUserInfo } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: () => apiRequest('/api/auth/me'),
    staleTime: 5 * 60 * 1000,
    enabled: !!user
  });

  const { data: otherCarriers = [], isLoading: otherCarriersLoading } = useQuery({
    queryKey: ['/api/other-carriers'],
    queryFn: () => apiRequest('/api/other-carriers'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const { data: allServicePlans = [], isLoading: servicePlansLoading } = useQuery({
    queryKey: ['/api/service-plans'],
    queryFn: () => apiRequest('/api/service-plans'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false
  });

  const activeCarriers = allCarriers.filter(carrier => {
    if (!carrier.isActive) return false;
    
    const allowedCarriers = currentUserInfo?.user?.allowedCarriers || currentUserInfo?.allowedCarriers;
    if (!allowedCarriers || allowedCarriers.length === 0) {
      return true;
    }
    
    return allowedCarriers.includes(carrier.name);
  });

  const activeOtherCarriers = otherCarriers
    .filter((carrier: any) => {
      if (!carrier.isActive) return false;
      
      const allowedCarriers = currentUserInfo?.user?.allowedCarriers || currentUserInfo?.allowedCarriers;
      if (!allowedCarriers || allowedCarriers.length === 0) {
        return true;
      }
      
      return allowedCarriers.includes(carrier.name);
    })
    .map((carrier: any) => ({
      ...carrier,
      name: carrier.name,
      isActive: true,
      requireDocumentUpload: false,
      isWired: false,
      requireCustomerName: true,
      requireCustomerPhone: true,
      requireCustomerEmail: false,
      requireContactCode: true,
      requireCarrier: true,
      requirePreviousCarrier: false,
      requireBundleNumber: false,
      requireBundleCarrier: false,
      requireDesiredNumber: false,
      allowNewCustomer: true,
      allowPortIn: true
    }));

  const carriers = [...activeCarriers, ...activeOtherCarriers];
  
  console.log('Active carriers:', activeCarriers.length, activeCarriers.map((c: any) => c.name));
  console.log('Active other carriers:', activeOtherCarriers.length, activeOtherCarriers.map((c: any) => c.name));
  console.log('Total carriers:', carriers.length, carriers.map((c: any) => c.name));

  const [carrierSearchTerm, setCarrierSearchTerm] = useState('');
  const [contactCodeSearchTerm, setContactCodeSearchTerm] = useState('');
  const [contactCodeSuggestions, setContactCodeSuggestions] = useState<any[]>([]);
  const [showContactCodeSuggestions, setShowContactCodeSuggestions] = useState(false);
  const [servicePlanSearchTerm, setServicePlanSearchTerm] = useState('');
  
  const isLoadingCarriers = carriersLoading || otherCarriersLoading;

  const filteredCarriers = carriers.filter(carrier => 
    carrier.name.toLowerCase().includes(carrierSearchTerm.toLowerCase())
  );

  // 중복 제거 유틸 함수
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ');
  const uniqById = <T extends { id: any; name: string }>(arr: T[]) =>
    Array.from(new Map(arr.map(a => [a.id, { ...a, name: normalize(a.name) }])).values());

  // 통신사 검색 함수 (중복 제거)
  const searchCarriers = async (query: string) => {
    if (!query || query.trim().length === 0) {
      return [];
    }
    const filtered = carriers.filter(carrier => 
      carrier.name.toLowerCase().includes(query.toLowerCase())
    );
    return uniqById(filtered.map(c => ({ id: c.id || c.name, name: c.name })));
  };

  const filteredServicePlans = allServicePlans.filter((plan: any) => {
    const baseCarrier = formData.carrier?.includes(')') 
      ? formData.carrier.split(')').pop()?.trim() 
      : formData.carrier;
    
    let normalizedCarrier = baseCarrier;
    if (baseCarrier?.includes('카카오KT')) {
      normalizedCarrier = 'KT';
    } else if (baseCarrier?.includes('KT')) {
      normalizedCarrier = 'KT';
    } else if (baseCarrier?.includes('SK')) {
      normalizedCarrier = 'SK';
    } else if (baseCarrier?.includes('LG')) {
      normalizedCarrier = 'LG';
    }
    
    if (!baseCarrier) {
      return false;
    }
    
    const matchesCarrier = plan.carrier === formData.carrier;
    const matchesSearch = !servicePlanSearchTerm || 
      plan.name.toLowerCase().includes(servicePlanSearchTerm.toLowerCase());
    const isActivePlan = plan.isActive !== false;
    return matchesCarrier && matchesSearch && isActivePlan;
  });

  console.log('Service Plans Debug:', {
    allServicePlansCount: allServicePlans.length,
    servicePlansLoading,
    formDataCarrier: formData.carrier,
    servicePlanSearchTerm,
    filteredServicePlansCount: filteredServicePlans.length,
    samplePlans: allServicePlans.slice(0, 3).map((p: any) => ({ name: p.name, carrier: p.carrier, isActive: p.isActive }))
  });
  
  const previousCarriers = [
    'SK', 'KT', 'LG', 'SK알뜰', 'KT알뜰', 'LG알뜰'
  ];
  
  const selectedCarrier = carriers.find(c => c.name === formData.carrier);
  const carrierSettings = selectedCarrier ? {
    ...selectedCarrier,
    requireCustomerName: Boolean(selectedCarrier.requireCustomerName),
    requireCustomerPhone: Boolean(selectedCarrier.requireCustomerPhone),
    requireCustomerEmail: Boolean(selectedCarrier.requireCustomerEmail),
    requireContactCode: Boolean(selectedCarrier.requireContactCode),
    requireCarrier: Boolean(selectedCarrier.requireCarrier),
    requirePreviousCarrier: Boolean(selectedCarrier.requirePreviousCarrier),
    requireDocumentUpload: Boolean(selectedCarrier.requireDocumentUpload),
    requireBundleNumber: Boolean(selectedCarrier.requireBundleNumber),
    requireBundleCarrier: Boolean(selectedCarrier.requireBundleCarrier),
    requireDesiredNumber: Boolean(selectedCarrier.requireDesiredNumber),
    allowNewCustomer: Boolean(selectedCarrier.allowNewCustomer),
    allowPortIn: Boolean(selectedCarrier.allowPortIn)
  } : null;

  const getFieldStyle = (isRequired: boolean) => {
    return isRequired 
      ? "border-red-500 focus:border-red-600 focus:ring-red-500" 
      : "border-input focus:border-primary focus:ring-primary";
  };

  const getLabelStyle = (isRequired: boolean) => {
    return isRequired 
      ? "text-red-700 dark:text-red-400 font-medium" 
      : "text-foreground";
  };
  
  const availableCustomerTypes = {
    new: carrierSettings?.allowNewCustomer !== false,
    portIn: carrierSettings?.allowPortIn !== false
  };

  const handleCustomerTypeChange = (newType: 'new' | 'port-in') => {
    setFormData(prev => ({ ...prev, customerType: newType }));
  };

  const checkDuplicate = async () => {
    if (!formData.customerName || !formData.customerPhone || !formData.carrier || !formData.storeName) {
      return false;
    }

    setIsCheckingDuplicate(true);
    try {
      const response = await apiRequest('/api/documents/check-duplicate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          customerName: formData.customerName,
          customerPhone: formData.customerPhone,
          carrier: formData.carrier,
          storeName: formData.storeName,
          contactCode: formData.contactCode
        })
      });

      if (response.duplicates && response.duplicates.length > 0) {
        setDuplicateData(response.duplicates);
        setDuplicateCheckDialog(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('중복 체크 오류:', error);
      return false;
    } finally {
      setIsCheckingDuplicate(false);
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (data: FormData) => {
      console.log('[MUTATION] 🚀 Upload mutation started');
      console.log('[MUTATION] isPending:', uploadMutation.isPending);
      
      setUploadProgress(0);
      
      const files: File[] = [];
      data.getAll('files').forEach(item => {
        if (item instanceof File) {
          files.push(item);
        }
      });
      
      console.log('[MUTATION] Files count:', files.length);
      
      const fields: Record<string, string> = {};
      data.forEach((value, key) => {
        if (key !== 'files' && typeof value === 'string') {
          fields[key] = value;
        }
      });
      
      console.log('[MUTATION] Fields:', { customerName: fields.customerName, carrier: fields.carrier, contactCode: fields.contactCode });
      
      return uploadWithProgress(
        files,
        '/api/documents',
        setUploadProgress,
        fields
      );
    },
    onSuccess: () => {
      setIsSubmitting(false);
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      
      toast({
        title: "접수 완료",
        description: "서류가 성공적으로 접수되었습니다.",
      });

      setSelectedFiles([]);
      
      setDuplicateCheckDialog(false);
      setDuplicateData([]);
      
      // 상태 초기화
      setFormData({
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        contactCode: '',
        storeName: '',
        carrier: '',
        previousCarrier: '',
        bundleNumber: '',
        bundleCarrier: '',
        customerType: 'new',
        desiredNumber: '',
        servicePlan: '',
        notes: '',
        activationStatus: '대기',
        deviceModel: '',
        simNumber: '',
        subscriptionNumber: '',
        servicePlanId: '',
        registrationFeePrepaid: false,
        registrationFeePostpaid: false,
        registrationFeeInstallment: false,
        simFeePrepaid: false,
        simFeePostpaid: false,
        bundleApplied: false,
        bundleNotApplied: false
      });
      
      setCarrierId(null);
      setCarrierName('');
      setSelectedServicePlan(null);
    },
    onError: (error: Error) => {
      setIsSubmitting(false);
      const isFileUploadError = error.message.includes('Upload failed') || error.message.includes('status 400');
      
      toast({
        title: "접수 실패",
        description: isFileUploadError 
          ? "서류 접수 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." 
          : error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent, activationStatus: string = '대기') => {
    e.preventDefault();
    
    console.log('[SUBMIT_V2] 🔘 Submit button clicked - Version 2025-11-06');
    console.log('[SUBMIT_V2] activationStatus:', activationStatus);
    console.log('[SUBMIT_V2] isSubmitting:', isSubmitting, 'isPending:', uploadMutation.isPending);
    
    // 🔒 중복 제출 방지 가드 (2중 체크)
    if (isSubmitting || uploadMutation.isPending) {
      console.log('[SUBMIT_V2] ⛔ Blocked - already submitting');
      return;
    }
    
    // carrierId 검증 추가
    if (!carrierId) {
      toast({
        title: "입력 오류",
        description: "목록에서 통신사를 선택해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    if (selectedCarrier) {
      const errors: string[] = [];
      
      if (selectedCarrier.requireCustomerName && !formData.customerName) {
        errors.push("고객명");
      }
      if (selectedCarrier.requireCustomerPhone && !formData.customerPhone) {
        errors.push("연락처");
      }
      if (selectedCarrier.requireCustomerEmail && !formData.customerEmail) {
        errors.push("이메일");
      }
      if (selectedCarrier.requireContactCode && !formData.contactCode) {
        errors.push("개통방명 코드");
      }
      if (selectedCarrier.requireCarrier && !formData.carrier) {
        errors.push("통신사");
      }
      if (selectedCarrier.requirePreviousCarrier && formData.customerType === 'port-in' && !formData.previousCarrier) {
        errors.push("이전통신사");
      }
      if (selectedCarrier.requireBundleNumber && !formData.bundleNumber) {
        errors.push("결합번호");
      }
      if (selectedCarrier.requireBundleCarrier && !formData.bundleCarrier) {
        errors.push("결합통신사");
      }
      if (selectedCarrier.requireDesiredNumber && formData.customerType === 'new' && !formData.desiredNumber) {
        errors.push("희망번호");
      }
      
      if (errors.length > 0) {
        toast({
          title: "입력 오류",
          description: `다음 필수 항목을 입력해주세요: ${errors.join(', ')}`,
          variant: "destructive",
        });
        return;
      }
    }
    
    const hasDuplicate = await checkDuplicate();
    if (hasDuplicate) {
      return;
    }
    
    submitForm(activationStatus);
  };

  const submitForm = (activationStatus: string = '대기') => {
    if (isSubmitting) {
      console.log('[SUBMIT_FORM_V2] ⛔ Already submitting, ignoring');
      return;
    }
    
    console.log('[SUBMIT_FORM_V2] 📝 Building FormData - Version 2025-11-06');
    console.log('[SUBMIT_FORM_V2] activationStatus:', activationStatus);
    setIsSubmitting(true);
    
    const data = new FormData();
    
    // 🔑 멱등키 추가 (requestId)
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    data.append('requestId', requestId);
    console.log('[SUBMIT_FORM_V2] 🔑 Request ID:', requestId);
    
    data.append('customerName', formData.customerName);
    data.append('customerPhone', formData.customerPhone);
    data.append('customerEmail', formData.customerEmail);
    data.append('contactCode', formData.contactCode);
    data.append('storeName', formData.storeName);
    data.append('carrier', formData.carrier);
    data.append('previousCarrier', formData.previousCarrier);
    data.append('bundleNumber', formData.bundleNumber);
    data.append('bundleCarrier', formData.bundleCarrier);
    data.append('customerType', formData.customerType);
    data.append('desiredNumber', formData.desiredNumber);
    // data.append('servicePlan', formData.servicePlan); // 요금제 필드 제거
    data.append('notes', formData.notes);
    
    // 작업 내용 필드 추가
    data.append('activationStatus', activationStatus);
    data.append('deviceModel', formData.deviceModel || '');
    data.append('simNumber', formData.simNumber || '');
    data.append('subscriptionNumber', formData.subscriptionNumber || '');
    data.append('servicePlanId', formData.servicePlanId || '');
    data.append('registrationFeePrepaid', formData.registrationFeePrepaid.toString());
    data.append('registrationFeePostpaid', formData.registrationFeePostpaid.toString());
    data.append('registrationFeeInstallment', formData.registrationFeeInstallment.toString());
    data.append('simFeePrepaid', formData.simFeePrepaid.toString());
    data.append('simFeePostpaid', formData.simFeePostpaid.toString());
    data.append('bundleApplied', formData.bundleApplied.toString());
    data.append('bundleNotApplied', formData.bundleNotApplied.toString());
    
    console.log('[SUBMIT_FORM_V2] FormData keys:');
    Array.from(data.entries()).forEach(([key, value]) => {
      console.log(`  ${key}:`, value);
    });
    
    if (selectedFiles.length > 0) {
      console.log('[SUBMIT_FORM_V2] Adding files:', selectedFiles.length);
      selectedFiles.forEach(file => {
        data.append('files', file);
      });
    } else {
      console.log('[SUBMIT_FORM_V2] No files selected');
    }
    
    console.log('[SUBMIT_FORM_V2] 🚀 Calling mutation.mutate()');
    uploadMutation.mutate(data);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // "mcc_" 접두어 제거 (자동완성 차단용 접두어)
    const fieldName = name.startsWith('mcc_') ? name.replace('mcc_', '') : name;
    const camelCaseName = fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    setFormData(prev => ({ ...prev, [camelCaseName]: value }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    
    const files = Array.from(e.dataTransfer.files);
    validateAndSetFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      validateAndSetFiles(files);
    }
  };

  const validateAndSetFiles = (files: File[]) => {
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    
    if (pdfFiles.length > 1) {
      toast({
        title: "파일 선택 오류",
        description: "PDF는 1개만 업로드 가능합니다.",
        variant: "destructive",
      });
      return;
    }
    
    if (pdfFiles.length === 1 && imageFiles.length > 0) {
      toast({
        title: "파일 선택 오류",
        description: "PDF는 단독 1개만 업로드 가능합니다.",
        variant: "destructive",
      });
      return;
    }
    
    if (imageFiles.length > 10) {
      toast({
        title: "파일 선택 오류",
        description: "이미지는 최대 10개까지 업로드 가능합니다.",
        variant: "destructive",
      });
      return;
    }
    
    setSelectedFiles(files);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Layout title="접수 신청" showSidebar={true}>
      <div className="container mx-auto p-6 space-y-6">
        {uploadMutation.isPending && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg w-80">
              <h3 className="text-lg font-semibold mb-4">접수 처리 중...</h3>
              <Progress value={uploadProgress} className="mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-400">{uploadProgress}% 완료</p>
            </div>
          </div>
        )}

        <form 
          onSubmit={handleSubmit} 
          className="space-y-6"
          autoComplete="off"
          data-form="no-autosave"
        >
          {/* 크롬 자동완성 완전 차단용 더미 필드 */}
          <input type="text" style={{display:'none'}} autoComplete="username" tabIndex={-1} />
          <input type="password" style={{display:'none'}} autoComplete="new-password" tabIndex={-1} />
          <Card data-ui-section="carrier-info-section">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Phone className="mr-2 h-5 w-5" />
                통신사 정보
              </CardTitle>
              <CardDescription>
                통신사 및 개통 관련 정보를 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="carrier" className={getLabelStyle(carrierSettings?.requireCarrier ?? true)}>
                    통신사 {(carrierSettings?.requireCarrier ?? true) && <span className="text-red-500">*</span>}
                  </Label>
                  <AutocompleteInput
                    placeholder="통신사 검색..."
                    value={carrierName}
                    onChange={(text) => {
                      setCarrierName(text);
                      setCarrierId(null);
                      setFormData(prev => ({ ...prev, carrier: '', contactCode: '', storeName: '' }));
                      setCodePrefix('');
                      setCodeSuffix('');
                      setContactCodeError('');
                      setIsContactCodeLocked(false);
                    }}
                    onSelect={async (option) => {
                      const timestamp = Date.now();
                      console.log(`[AutoMatch] carrierSelected: ${option.name} at ${timestamp}`);
                      
                      setCarrierId(option.id);
                      setCarrierName(option.name);
                      setFormData(prev => ({ ...prev, carrier: option.name, contactCode: '', storeName: '' }));
                      
                      // 딜러 사용자인 경우 자동 매칭 시도
                      if (user?.dealerId) {
                        // 중복 호출 방지: 이미 처리 중이거나 같은 carrier라면 스킵
                        if (isMatchingRef.current || lastCarrierKeyRef.current === option.name) {
                          console.log(`[AutoMatch] Skipping duplicate call: ${option.name}`);
                          return;
                        }
                        
                        isMatchingRef.current = true;
                        lastCarrierKeyRef.current = option.name;
                        
                        console.log(`[AutoMatch] start: carrier=${option.name}`);
                        
                        try {
                          const result = await apiRequest(`/api/contact-codes/auto-match?carrier=${encodeURIComponent(option.name)}`);
                          console.log(`[AutoMatch] end: result=${result?.success}`);
                          
                          if (result.success && result.result) {
                            // 자동 매칭 성공 - 조용히 처리 (토스트 없음)
                            setFormData(prev => ({
                              ...prev,
                              contactCode: result.result.code,
                              storeName: result.result.dealerName
                            }));
                            setIsContactCodeLocked(true);
                            setCodePrefix('');
                            setCodeSuffix('');
                            setContactCodeError('');
                            console.log(`[AutoMatch] Success: code=${result.result.code}, store=${result.result.dealerName}`);
                            isMatchingRef.current = false;
                            return; // 자동 매칭 성공 시 기존 로직 스킵
                          } else {
                            // 자동 매칭 결과 없음 - 1회만 토스트
                            toast({
                              title: "자동 매칭 실패",
                              description: "매칭 가능한 접점코드가 없습니다. 수동 입력하세요.",
                              variant: "default",
                            });
                            setIsContactCodeLocked(false);
                            console.log(`[AutoMatch] No match found`);
                          }
                        } catch (error: any) {
                          console.error('[AutoMatch] Error:', error);
                          setIsContactCodeLocked(false);
                          // 1회만 토스트
                          toast({
                            title: "자동 매칭 오류",
                            description: "접점코드 조회에 실패했습니다. 수동으로 입력해주세요.",
                            variant: "default",
                          });
                        } finally {
                          isMatchingRef.current = false;
                        }
                      }
                      
                      // 기존 로직: 접두어 자동 설정 (딜러가 아니거나 자동 매칭 실패 시)
                      const prefix = getCodePrefix(option.name);
                      if (prefix) {
                        setCodePrefix(prefix);
                      } else {
                        setCodePrefix('');
                        setShowSearchModal(true); // 접두어가 없으면 검색 모달 표시
                      }
                      setCodeSuffix('');
                      setContactCodeError('');
                    }}
                    fetchOptions={searchCarriers}
                    disabled={isLoadingCarriers}
                    className={getFieldStyle(carrierSettings?.requireCarrier ?? true)}
                    data-testid="input-carrier-autocomplete"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactCode" className={getLabelStyle(carrierSettings?.requireContactCode ?? true)}>
                    개통방법 코드 {(carrierSettings?.requireContactCode ?? true) && <span className="text-red-500">*</span>}
                  </Label>
                  {codePrefix ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          id="contactCodeSuffix"
                          name="contactCodeSuffix"
                          value={codeSuffix}
                          onChange={(e) => {
                            setCodeSuffix(e.target.value);
                            setContactCodeError('');
                          }}
                          onBlur={async () => {
                            if (codeSuffix && formData.carrier) {
                              const fullCode = codePrefix + codeSuffix;
                              try {
                                const result = await apiRequest(`/api/contact-codes/by-code?carrier=${encodeURIComponent(formData.carrier)}&code=${encodeURIComponent(fullCode)}`);
                                setFormData(prev => ({
                                  ...prev,
                                  contactCode: result.code,
                                  storeName: result.dealerName
                                }));
                                setContactCodeError('');
                              } catch (error: any) {
                                setContactCodeError('해당 코드가 없습니다. 코드를 확인하거나 검색 버튼을 사용해주세요.');
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          placeholder="코드 뒤자리 입력 (숫자만)"
                          className={`${getFieldStyle(carrierSettings?.requireContactCode ?? true)} ${contactCodeError ? 'border-red-500 focus:border-red-500' : ''}`}
                          data-testid="input-contact-code-suffix"
                          autoComplete="off"
                          inputMode="numeric"
                          disabled={!formData.carrier}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowSearchModal(true)}
                          title="코드 검색"
                          disabled={!formData.carrier}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                      {contactCodeError && (
                        <p className="text-sm text-red-500">{contactCodeError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex gap-2">
                        <Input
                          id="contactCode"
                          name="contactCode"
                          value={formData.contactCode}
                          onChange={(e) => {
                            handleContactCodeChange(e.target.value);
                            setContactCodeError('');
                          }}
                          placeholder={isContactCodeLocked ? "자동 매칭된 접점코드" : "먼저 통신사를 선택하세요"}
                          className={`${getFieldStyle(carrierSettings?.requireContactCode ?? true)} ${contactCodeError ? 'border-red-500 focus:border-red-500' : ''} ${isContactCodeLocked ? 'bg-gray-50' : ''}`}
                          data-testid="input-contact-code"
                          autoComplete="off"
                          disabled={!formData.carrier || isContactCodeLocked}
                          readOnly={isContactCodeLocked}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowSearchModal(true)}
                          disabled={!formData.carrier || isContactCodeLocked}
                          title={isContactCodeLocked ? "자동 매칭됨" : "코드 검색"}
                        >
                          <Search className="h-4 w-4" />
                        </Button>
                      </div>
                      {isContactCodeLocked && (
                        <p className="text-sm text-green-600">✓ 판매점 기준으로 자동 매칭된 접점코드입니다</p>
                      )}
                      {contactCodeError && (
                        <p className="text-sm text-red-500">{contactCodeError}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="storeName">판매점명</Label>
                <Input
                  id="storeName"
                  name="storeName"
                  value={formData.storeName}
                  onChange={handleInputChange}
                  placeholder="판매점명"
                  className="border-input focus:border-primary focus:ring-primary bg-gray-50"
                  readOnly
                  data-testid="input-store-name"
                />
              </div>

              <div className="space-y-2">
                <Label>고객 유형</Label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="customerType"
                      value="new"
                      checked={formData.customerType === 'new'}
                      onChange={() => handleCustomerTypeChange('new')}
                      disabled={!availableCustomerTypes.new}
                      className="mr-2"
                      data-testid="radio-customer-type-new"
                    />
                    <span className={!availableCustomerTypes.new ? 'text-gray-400' : ''}>신규</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="customerType"
                      value="port-in"
                      checked={formData.customerType === 'port-in'}
                      onChange={() => handleCustomerTypeChange('port-in')}
                      disabled={!availableCustomerTypes.portIn}
                      className="mr-2"
                      data-testid="radio-customer-type-port-in"
                    />
                    <span className={!availableCustomerTypes.portIn ? 'text-gray-400' : ''}>번호이동</span>
                  </label>
                </div>
              </div>

              {formData.customerType === 'port-in' && (
                <div className="space-y-2">
                  <Label htmlFor="previousCarrier" className={getLabelStyle(carrierSettings?.requirePreviousCarrier ?? false)}>
                    이전통신사 {carrierSettings?.requirePreviousCarrier && <span className="text-red-500">*</span>}
                  </Label>
                  <Select
                    value={formData.previousCarrier}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, previousCarrier: value }))}
                    data-testid="select-previous-carrier"
                  >
                    <SelectTrigger className={getFieldStyle(carrierSettings?.requirePreviousCarrier ?? false)}>
                      <SelectValue placeholder="이전 통신사를 선택하세요" />
                    </SelectTrigger>
                    <SelectContent>
                      {previousCarriers.map((carrier) => (
                        <SelectItem key={carrier} value={carrier} data-testid={`previous-carrier-${carrier}`}>
                          {carrier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.customerType === 'new' && carrierSettings?.requireDesiredNumber && (
                <div className="space-y-2">
                  <Label htmlFor="desiredNumber" className={getLabelStyle(true)}>
                    희망번호 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="desiredNumber"
                    name="desiredNumber"
                    value={formData.desiredNumber}
                    onChange={handleInputChange}
                    placeholder="희망번호를 입력하세요"
                    className={getFieldStyle(true)}
                    data-testid="input-desired-number"
                  />
                </div>
              )}

              {carrierSettings?.requireBundleNumber && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="bundleNumber" className={getLabelStyle(true)}>
                      결합번호 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="bundleNumber"
                      name="bundleNumber"
                      value={formData.bundleNumber}
                      onChange={handleInputChange}
                      placeholder="결합할 번호를 입력하세요"
                      className={getFieldStyle(true)}
                      data-testid="input-bundle-number"
                    />
                  </div>
                  {carrierSettings?.requireBundleCarrier && (
                    <div className="space-y-2">
                      <Label htmlFor="bundleCarrier" className={getLabelStyle(true)}>
                        결합통신사 <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="bundleCarrier"
                        name="bundleCarrier"
                        value={formData.bundleCarrier}
                        onChange={handleInputChange}
                        placeholder="결합 서비스 통신사를 입력하세요"
                        className={getFieldStyle(true)}
                        data-testid="input-bundle-carrier"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 요금제 필드 - 접수 신청에서 제거 (롤백 대비 주석 처리)
              <div className="space-y-2">
                <Label htmlFor="servicePlan">요금제</Label>
                <div className="relative">
                  <Select
                    value={formData.servicePlan}
                    onValueChange={(value) => {
                      const selectedPlan = filteredServicePlans.find((plan: any) => plan.id.toString() === value);
                      setFormData(prev => ({ ...prev, servicePlan: value }));
                      setSelectedServicePlan(selectedPlan);
                    }}
                    disabled={!formData.carrier}
                    data-testid="select-service-plan"
                  >
                    <SelectTrigger className="border-input focus:border-primary focus:ring-primary">
                      <SelectValue placeholder={formData.carrier ? "요금제를 선택하세요" : "먼저 통신사를 선택하세요"} />
                    </SelectTrigger>
                    <SelectContent>
                      <div className="p-2">
                        <Input
                          placeholder="요금제 검색..."
                          value={servicePlanSearchTerm}
                          onChange={(e) => setServicePlanSearchTerm(e.target.value)}
                          className="mb-2"
                          data-testid="input-service-plan-search"
                        />
                      </div>
                      {servicePlansLoading ? (
                        <div className="p-4 text-center">
                          <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                          <span className="text-sm text-gray-500">요금제 목록 로딩 중...</span>
                        </div>
                      ) : filteredServicePlans.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                          {servicePlanSearchTerm ? '검색 결과가 없습니다' : formData.carrier ? '사용 가능한 요금제가 없습니다' : '통신사를 먼저 선택하세요'}
                        </div>
                      ) : (
                        filteredServicePlans.map((plan: any) => (
                          <SelectItem key={plan.id} value={plan.id.toString()} data-testid={`service-plan-${plan.id}`}>
                            {plan.name} {plan.monthlyFee && `(${formatPrice(plan.monthlyFee)}원)`}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              */}
            </CardContent>
          </Card>

          <Card data-ui-section="customer-info-section">
            <CardHeader>
              <CardTitle className="flex items-center">
                <User className="mr-2 h-5 w-5" />
                고객 정보
              </CardTitle>
              <CardDescription>
                고객의 기본 정보를 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customerName" className={getLabelStyle(carrierSettings?.requireCustomerName ?? true)}>
                    고객명 {(carrierSettings?.requireCustomerName ?? true) && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id="customerName"
                    name="mcc_customer_name"
                    value={formData.customerName}
                    onChange={handleInputChange}
                    placeholder="고객명을 입력하세요"
                    className={getFieldStyle(carrierSettings?.requireCustomerName ?? true)}
                    data-testid="input-customer-name"
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customerPhone" className={getLabelStyle(carrierSettings?.requireCustomerPhone ?? true)}>
                    연락처 {(carrierSettings?.requireCustomerPhone ?? true) && <span className="text-red-500">*</span>}
                  </Label>
                  <Input
                    id="customerPhone"
                    name="mcc_customer_phone"
                    value={formData.customerPhone}
                    onChange={handleInputChange}
                    placeholder="연락처를 입력하세요"
                    className={getFieldStyle(carrierSettings?.requireCustomerPhone ?? true)}
                    data-testid="input-customer-phone"
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    data-lpignore="true"
                    data-1p-ignore="true"
                    inputMode="tel"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerEmail" className={getLabelStyle(carrierSettings?.requireCustomerEmail ?? false)}>
                  이메일 {carrierSettings?.requireCustomerEmail && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="customerEmail"
                  name="mcc_customer_email"
                  type="email"
                  value={formData.customerEmail}
                  onChange={handleInputChange}
                  placeholder="이메일을 입력하세요"
                  className={getFieldStyle(carrierSettings?.requireCustomerEmail ?? false)}
                  data-testid="input-customer-email"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  inputMode="email"
                />
              </div>
            </CardContent>
          </Card>

          <Card data-ui-section="document-upload-section">
            <CardHeader>
              <CardTitle className="flex items-center">
                <Upload className="mr-2 h-5 w-5" />
                서류 첨부 {carrierSettings?.requireDocumentUpload && <span className="text-red-500 ml-1">*</span>}
              </CardTitle>
              <CardDescription>
                필요한 서류를 첨부하세요 (JPG/PNG 최대 10개, PDF 1개만)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : selectedFiles.length > 0
                    ? 'border-green-500 bg-green-50 dark:bg-green-950'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                data-testid="file-upload-zone"
              >
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  multiple
                  onChange={handleFileSelect}
                  data-testid="file-input"
                />
                
                {selectedFiles.length > 0 ? (
                  <div className="space-y-2">
                    <FileText className="h-12 w-12 text-green-500 mx-auto" />
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">
                      {selectedFiles.length}개 파일 선택됨
                    </p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {selectedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-800 rounded border">
                          <span className="text-sm truncate flex-1">{file.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                            className="ml-2"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById('file-upload')?.click()}
                      data-testid="select-file-button"
                    >
                      파일 추가
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-12 w-12 text-gray-400 mx-auto" />
                    <div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        파일을 드래그하거나 클릭하여 업로드하세요
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        JPG/PNG 최대 10개, PDF 1개만 (최대 10MB)
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => document.getElementById('file-upload')?.click()}
                      data-testid="select-file-button"
                    >
                      파일 선택
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card data-ui-section="additional-info-section">
            <CardHeader>
              <CardTitle>작업 내용</CardTitle>
              <CardDescription>
                개통 처리에 필요한 정보를 입력하세요
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="deviceModel">단말기기종</Label>
                  <Input
                    id="deviceModel"
                    name="deviceModel"
                    value={formData.deviceModel}
                    onChange={handleInputChange}
                    placeholder="단말기기종을 입력하세요"
                    data-testid="input-device-model"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="simNumber">유심번호</Label>
                  <Input
                    id="simNumber"
                    name="simNumber"
                    value={formData.simNumber}
                    onChange={handleInputChange}
                    placeholder="유심번호를 입력하세요"
                    data-testid="input-sim-number"
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="subscriptionNumber">가입번호</Label>
                  <Input
                    id="subscriptionNumber"
                    name="subscriptionNumber"
                    value={formData.subscriptionNumber}
                    onChange={handleInputChange}
                    placeholder="가입번호를 입력하세요"
                    data-testid="input-subscription-number"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="servicePlanId">요금제 선택</Label>
                <Select
                  value={formData.servicePlanId}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, servicePlanId: value }))}
                  disabled={!formData.carrier}
                >
                  <SelectTrigger data-testid="select-service-plan-id">
                    <SelectValue placeholder={formData.carrier ? "요금제를 선택하세요..." : "먼저 통신사를 선택하세요"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredServicePlans
                      .filter((plan: any) => plan.carrier === formData.carrier)
                      .map((plan: any) => (
                        <SelectItem key={plan.id} value={plan.id.toString()}>
                          {plan.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>가입비</Label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.registrationFeePrepaid}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          registrationFeePrepaid: checked,
                          registrationFeePostpaid: checked ? false : prev.registrationFeePostpaid,
                          registrationFeeInstallment: checked ? false : prev.registrationFeeInstallment
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-registration-fee-prepaid"
                    />
                    <span className="text-sm">선납</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.registrationFeePostpaid}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          registrationFeePrepaid: checked ? false : prev.registrationFeePrepaid,
                          registrationFeePostpaid: checked,
                          registrationFeeInstallment: checked ? false : prev.registrationFeeInstallment
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-registration-fee-postpaid"
                    />
                    <span className="text-sm">후납</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.registrationFeeInstallment}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          registrationFeePrepaid: checked ? false : prev.registrationFeePrepaid,
                          registrationFeePostpaid: checked ? false : prev.registrationFeePostpaid,
                          registrationFeeInstallment: checked
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-registration-fee-installment"
                    />
                    <span className="text-sm">분납</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>유심비</Label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.simFeePrepaid}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          simFeePrepaid: checked,
                          simFeePostpaid: checked ? false : prev.simFeePostpaid
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-sim-fee-prepaid"
                    />
                    <span className="text-sm">선납</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.simFeePostpaid}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          simFeePrepaid: checked ? false : prev.simFeePrepaid,
                          simFeePostpaid: checked
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-sim-fee-postpaid"
                    />
                    <span className="text-sm">후납</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label>결합</Label>
                <div className="flex space-x-4">
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.bundleApplied}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          bundleApplied: checked,
                          bundleNotApplied: checked ? false : prev.bundleNotApplied
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-bundle-applied"
                    />
                    <span className="text-sm">결합</span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      checked={formData.bundleNotApplied}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setFormData(prev => ({
                          ...prev,
                          bundleApplied: checked ? false : prev.bundleApplied,
                          bundleNotApplied: checked
                        }));
                      }}
                      className="rounded"
                      data-testid="checkbox-bundle-not-applied"
                    />
                    <span className="text-sm">미결합</span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">메모</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  value={formData.notes}
                  onChange={handleInputChange}
                  placeholder="작업 관련 메모를 입력하세요"
                  rows={4}
                  data-testid="textarea-notes"
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3">
            <Button
              type="submit"
              size="lg"
              variant="outline"
              disabled={isSubmitting || uploadMutation.isPending || isCheckingDuplicate}
              className={`min-w-32 ${(isSubmitting || uploadMutation.isPending) ? 'pointer-events-none opacity-60' : ''}`}
              onClick={(e) => handleSubmit(e, '대기')}
              data-testid="submit-button"
            >
              {(isSubmitting || uploadMutation.isPending) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  접수 중...
                </>
              ) : isCheckingDuplicate ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  중복 확인 중...
                </>
              ) : (
                '접수 신청'
              )}
            </Button>
            {!user?.dealerId && (
              <Button
                type="button"
                size="lg"
                disabled={isSubmitting || uploadMutation.isPending || isCheckingDuplicate}
                className={`min-w-32 bg-green-600 hover:bg-green-700 ${(isSubmitting || uploadMutation.isPending) ? 'pointer-events-none opacity-60' : ''}`}
                onClick={(e) => handleSubmit(e, '개통')}
                data-testid="submit-activated-button"
              >
                {(isSubmitting || uploadMutation.isPending) ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    접수 중...
                  </>
                ) : isCheckingDuplicate ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    중복 확인 중...
                  </>
                ) : (
                  '개통 완료'
                )}
              </Button>
            )}
          </div>
        </form>

        <Dialog open={duplicateCheckDialog} onOpenChange={setDuplicateCheckDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center">
                <AlertTriangle className="mr-2 h-5 w-5 text-yellow-500" />
                중복 접수 확인
              </DialogTitle>
              <DialogDescription>
                동일한 고객 정보로 이번 달에 접수된 문서가 있습니다.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {duplicateData.map((doc: any, index) => (
                <div key={index} className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800">
                  <div className="text-sm space-y-1">
                    <p><strong>접수일:</strong> {new Date(doc.createdAt).toLocaleDateString()}</p>
                    <p><strong>상태:</strong> {doc.status}</p>
                    <p><strong>통신사:</strong> {doc.carrier}</p>
                  </div>
                </div>
              ))}
              
              <div className="flex space-x-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setDuplicateCheckDialog(false)}
                  data-testid="duplicate-cancel-button"
                >
                  취소
                </Button>
                <Button
                  onClick={() => {
                    setDuplicateCheckDialog(false);
                    submitForm();
                  }}
                  data-testid="duplicate-proceed-button"
                >
                  계속 진행
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
