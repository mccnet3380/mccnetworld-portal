import { useState, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { useAuth, useApiRequest } from '@/lib/auth';
import { useLocation } from 'wouter';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FileEditIcon, Search, Check, ChevronsUpDown, Lock, Unlock } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OtherApplication() {
  const { user } = useAuth();
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // 영업과장은 읽기 전용이므로 접수 신청 불가  
  if (user && 'userType' in user && user.userType === 'sales_manager') {
    return (
      <Layout title="기타 신청" showSidebar={false}>
        <div className="flex flex-col items-center justify-center h-64">
          <FileEditIcon className="h-16 w-16 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">접근 권한이 없습니다</h3>
          <p className="text-sm text-gray-500">영업과장은 읽기 전용 권한입니다.</p>
        </div>
      </Layout>
    );
  }
  
  // 폼 데이터 상태
  const [formData, setFormData] = useState({
    customerName: '',
    customerPhone: '',
    contactCode: '',
    storeName: '',
    requestPoint: '',
    notes: ''
  });

  // 접점코드 관련 상태
  const [contactCodeSuggestions, setContactCodeSuggestions] = useState<any[]>([]);
  const [showContactCodeSuggestions, setShowContactCodeSuggestions] = useState(false);
  const [contactCodeOpen, setContactCodeOpen] = useState(false);
  const [contactCodeSearchValue, setContactCodeSearchValue] = useState('');
  
  // 자동 매칭 상태
  const [autoMatched, setAutoMatched] = useState(false);
  const [autoMatchedPOS, setAutoMatchedPOS] = useState('');
  const [posOptions, setPosOptions] = useState<any[]>([]);
  const [showPOSModal, setShowPOSModal] = useState(false);
  const [isAutoMatching, setIsAutoMatching] = useState(false);

  // Dealer 정보를 가져와서 판매점명 자동 입력
  useEffect(() => {
    async function loadDealerInfo() {
      if (user && 'dealerId' in user && user.dealerId) {
        try {
          const dealer = await apiRequest(`/api/dealers/${user.dealerId}`);
          if (dealer && dealer.businessName) {
            setFormData(prev => ({
              ...prev,
              storeName: dealer.businessName
            }));
          }
        } catch (error) {
          console.warn('Dealer 정보 로드 실패:', error);
        }
      }
    }
    
    loadDealerInfo();
  }, [user]);

  // 기타업무통신사 데이터 가져오기
  const { data: otherBusinessCarriersResponse, isLoading: isLoadingCarriers } = useQuery({
    queryKey: ['/api/other-business-carriers'],
    queryFn: () => apiRequest('/api/other-business-carriers'),
  });

  // 기타업무통신사에서 업무 요청점 목록 추출 (중복 제거 및 정렬)
  const otherBusinessCarriers = otherBusinessCarriersResponse || [];
  const availableRequestPoints: string[] = Array.from(new Set(
    otherBusinessCarriers
      .map((carrier: any) => carrier.businessRequestPoint)
      .filter((point: any) => point && typeof point === 'string' && point.trim() !== '') as string[]
  )).sort();

  // 접점코드 데이터 가져오기
  const { data: contactCodesResponse } = useQuery({
    queryKey: ['/api/contact-codes'],
    queryFn: () => apiRequest('/api/contact-codes'),
  });

  // 전체 접점코드 목록 (검색용)
  const allContactCodes = contactCodesResponse || [];

  // 접점코드 검색 함수
  const searchContactCodes = async (query: string) => {
    if (query.length < 1) {
      // 검색어가 없으면 전체 목록 표시
      setContactCodeSuggestions(allContactCodes.slice(0, 20)); // 성능을 위해 처음 20개만
      return;
    }

    try {
      const response = await apiRequest(`/api/contact-codes/search?q=${encodeURIComponent(query)}`);
      setContactCodeSuggestions(response || []);
    } catch (error) {
      console.warn('접점코드 검색 실패:', error);
      setContactCodeSuggestions([]);
    }
  };

  // 드롭다운 열릴 때 초기 목록 로드
  const handleContactCodeOpen = (open: boolean) => {
    setContactCodeOpen(open);
    if (open && contactCodeSuggestions.length === 0) {
      setContactCodeSuggestions(allContactCodes.slice(0, 20));
    }
  };

  // requestPoint 변경 시 자동 매칭 시도
  useEffect(() => {
    async function autoMatchPOS() {
      if (!formData.requestPoint) return;
      
      const getCarrierFromRequestPoint = (requestPoint: string) => {
        if (requestPoint.includes('KT')) return 'KT';
        if (requestPoint.includes('LG') || requestPoint.includes('유플러스')) return 'LG유플러스';
        if (requestPoint.includes('SK')) return 'SKT';
        if (requestPoint.includes('수협')) return '수협';
        if (requestPoint.includes('엠모바일')) return '엠모바일';
        if (requestPoint.includes('헬로')) return '헬로모바일';
        if (requestPoint.includes('프리티')) return '프리티';
        if (requestPoint.includes('텔링크')) return '텔링크';
        return '기타';
      };
      
      const carrier = getCarrierFromRequestPoint(formData.requestPoint);
      const posHint = localStorage.getItem('lastSelectedPOS') || undefined;
      
      setIsAutoMatching(true);
      try {
        const url = `/api/contact-codes/auto-by-pos?carrier=${encodeURIComponent(carrier)}${posHint ? `&posHint=${encodeURIComponent(posHint)}` : ''}`;
        const result = await apiRequest(url);
        
        if (result.matched) {
          // 단일 매칭 성공
          setFormData(prev => ({
            ...prev,
            contactCode: result.code,
            storeName: result.realSalesPOS || result.dealerName
          }));
          setAutoMatched(true);
          setAutoMatchedPOS(result.realSalesPOS || result.dealerName);
          localStorage.setItem('lastSelectedPOS', result.realSalesPOS || result.dealerName);
        } else if (result.reason === 'MULTI_POS') {
          // 다중 POS - 선택 모달 표시
          setPosOptions(result.options || []);
          setShowPOSModal(true);
        } else if (result.reason === 'NO_MATCH') {
          // 매칭 결과 없음
          toast({
            title: "자동 매칭 실패",
            description: "실판매 POS 기준 자동매칭 결과가 없습니다. POS 또는 개통방명코드를 수동 선택해 주세요.",
            variant: "default",
          });
        }
      } catch (error) {
        console.error('Auto-match error:', error);
      } finally {
        setIsAutoMatching(false);
      }
    }
    
    autoMatchPOS();
  }, [formData.requestPoint]);
  
  // POS 선택
  const handlePOSSelect = async (selectedPOS: string) => {
    const carrier = formData.requestPoint.includes('KT') ? 'KT' :
                   formData.requestPoint.includes('LG') ? 'LG유플러스' :
                   formData.requestPoint.includes('SK') ? 'SKT' : '기타';
    
    try {
      const url = `/api/contact-codes/auto-by-pos?carrier=${encodeURIComponent(carrier)}&posHint=${encodeURIComponent(selectedPOS)}`;
      const result = await apiRequest(url);
      
      if (result.matched) {
        setFormData(prev => ({
          ...prev,
          contactCode: result.code,
          storeName: result.realSalesPOS || result.dealerName
        }));
        setAutoMatched(true);
        setAutoMatchedPOS(result.realSalesPOS || result.dealerName);
        localStorage.setItem('lastSelectedPOS', result.realSalesPOS || result.dealerName);
        setShowPOSModal(false);
      }
    } catch (error) {
      console.error('POS select error:', error);
    }
  };
  
  // 접점코드 선택
  const selectContactCode = (contactCode: any) => {
    setFormData(prev => ({
      ...prev,
      contactCode: contactCode.code,
      storeName: contactCode.realSalesPOS || contactCode.dealerName || ''
    }));
    setContactCodeOpen(false);
    setContactCodeSearchValue('');
    setAutoMatched(false); // 수동 선택 시 자동 매칭 해제
    localStorage.setItem('lastSelectedPOS', contactCode.realSalesPOS || contactCode.dealerName || '');
  };

  // 기존 통신사 API는 제거하고 기타업무접점에서 통신사 목록 사용

  // 접수 제출 mutation
  const submitMutation = useMutation({
    mutationFn: async (data: any) => {
      const formData = new FormData();
      
      // 업무 요청점을 기반으로 통신사명 결정
      const getCarrierFromRequestPoint = (requestPoint: string) => {
        if (requestPoint.includes('KT')) return 'KT';
        if (requestPoint.includes('LG') || requestPoint.includes('유플러스')) return 'LG유플러스';
        if (requestPoint.includes('SK')) return 'SKT';
        if (requestPoint.includes('수협')) return '수협';
        if (requestPoint.includes('엠모바일')) return '엠모바일';
        if (requestPoint.includes('헬로')) return '헬로모바일';
        if (requestPoint.includes('프리티')) return '프리티';
        if (requestPoint.includes('텔링크')) return '텔링크';
        return '기타';
      };
      
      const carrierName = getCarrierFromRequestPoint(data.requestPoint || '');
      
      // 기본 필드들 추가
      formData.append('customerName', data.customerName);
      formData.append('customerPhone', data.customerPhone);
      formData.append('contactCode', data.contactCode);
      formData.append('storeName', data.storeName);
      formData.append('notes', data.notes);
      formData.append('customerType', 'other');
      formData.append('activationStatus', '대기');
      formData.append('carrier', carrierName);
      
      // 기타업무 요청점 추가
      if (data.requestPoint) {
        formData.append('requestPoint', data.requestPoint);
      }
      
      const response = await apiRequest('/api/documents', {
        method: 'POST',
        body: formData
      });
      
      return response;
    },
    onSuccess: () => {
      toast({
        title: "기타 접수 완료",
        description: "기타 접수가 등록되었습니다.",
      });
      
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dealer/applications'] });
      
      if (user && 'dealerId' in user && user.dealerId) {
        setLocation('/dealer-dashboard');
      } else {
        setLocation('/documents');
      }
    },
    onError: (error: any) => {
      toast({
        title: "접수 실패",
        description: error.message || "기타 신청 처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.customerName?.trim()) {
      toast({
        title: "입력 오류",
        description: "고객명을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    
    if (!formData.contactCode?.trim()) {
      toast({
        title: "입력 오류", 
        description: "개통방명코드를 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    submitMutation.mutate(formData);
  };

  return (
    <Layout title="기타 신청">
      <div className="space-y-6">
        <div className="flex items-center space-x-4">
          <FileEditIcon className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-3xl font-bold">기타 신청</h1>
            <p className="text-gray-600">기타 업무에 대한 신청서를 작성합니다.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 업무 요청점 선택 */}
          <Card>
            <CardHeader>
              <CardTitle>업무 요청점 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="requestPoint">업무 요청점</Label>
                <Select 
                  value={formData.requestPoint} 
                  onValueChange={(value) => setFormData({...formData, requestPoint: value})}
                  disabled={isLoadingCarriers}
                >
                  <SelectTrigger data-testid="select-request-point">
                    <SelectValue 
                      placeholder={
                        isLoadingCarriers 
                          ? "업무 요청점 로딩 중..." 
                          : availableRequestPoints.length === 0
                          ? "사용 가능한 업무 요청점이 없습니다"
                          : "업무 요청점을 선택하세요"
                      } 
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {availableRequestPoints.length === 0 && !isLoadingCarriers ? (
                      <SelectItem value="no-data" disabled>
                        사용 가능한 업무 요청점이 없습니다
                      </SelectItem>
                    ) : (
                      availableRequestPoints
                        .filter(point => point && point.trim() !== '')
                        .map((requestPoint: string) => (
                          <SelectItem key={requestPoint} value={requestPoint}>
                            {requestPoint}
                          </SelectItem>
                        ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* 고객 정보 */}
          <Card>
            <CardHeader>
              <CardTitle>고객 정보</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="customerName">고객명 *</Label>
                  <Input
                    id="customerName"
                    data-testid="input-customer-name"
                    value={formData.customerName}
                    onChange={(e) => setFormData({...formData, customerName: e.target.value})}
                    placeholder="고객명을 입력하세요"
                    required
                  />
                </div>
                
                <div>
                  <Label htmlFor="customerPhone">연락처</Label>
                  <Input
                    id="customerPhone"
                    data-testid="input-customer-phone"
                    value={formData.customerPhone}
                    onChange={(e) => setFormData({...formData, customerPhone: e.target.value})}
                    placeholder="연락처를 입력하세요"
                  />
                </div>
              </div>

            </CardContent>
          </Card>

          {/* 개통방명코드 */}
          <Card>
            <CardHeader>
              <CardTitle>개통방명코드</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>개통방명코드 *</Label>
                <Popover open={contactCodeOpen} onOpenChange={handleContactCodeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={contactCodeOpen}
                      className="w-full justify-between"
                      data-testid="button-contact-code-dropdown"
                    >
                      {formData.contactCode || "개통방명코드를 선택하세요"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0">
                    <Command>
                      <CommandInput 
                        placeholder="접점코드 검색..."
                        value={contactCodeSearchValue}
                        onValueChange={(value) => {
                          setContactCodeSearchValue(value);
                          searchContactCodes(value);
                        }}
                      />
                      <CommandList>
                        <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                        <CommandGroup>
                          {contactCodeSuggestions.map((contactCode) => (
                            <CommandItem
                              key={contactCode.id}
                              value={`${contactCode.code} ${contactCode.dealerName}`}
                              onSelect={() => selectContactCode(contactCode)}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  formData.contactCode === contactCode.code ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span className="font-medium">{contactCode.code}</span>
                                <span className="text-sm text-gray-500">{contactCode.dealerName}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="storeName">판매점명</Label>
                  {autoMatched && autoMatchedPOS && (
                    <Badge variant="secondary" className="text-xs">
                      <Lock className="h-3 w-3 mr-1" />
                      자동매칭: {autoMatchedPOS}
                    </Badge>
                  )}
                  {isAutoMatching && (
                    <Badge variant="outline" className="text-xs">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      자동매칭 중...
                    </Badge>
                  )}
                </div>
                <Input
                  id="storeName"
                  data-testid="input-store-name"
                  value={formData.storeName}
                  onChange={(e) => setFormData({...formData, storeName: e.target.value})}
                  placeholder="판매점명 (자동입력됨)"
                  readOnly
                />
              </div>
            </CardContent>
          </Card>

          {/* 비고 */}
          <Card>
            <CardHeader>
              <CardTitle>비고</CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <Label htmlFor="notes">기타 사항</Label>
                <Textarea
                  id="notes"
                  data-testid="textarea-notes"
                  value={formData.notes}
                  onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  placeholder="기타 신청에 대한 상세 내용을 입력하세요"
                  rows={4}
                />
              </div>
            </CardContent>
          </Card>

          {/* 제출 버튼 */}
          <div className="flex justify-end">
            <Button 
              type="submit" 
              data-testid="button-submit"
              disabled={submitMutation.isPending}
              className="min-w-32"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  처리중...
                </>
              ) : (
                '기타 접수'
              )}
            </Button>
          </div>
        </form>

        {submitMutation.error && (
          <Alert variant="destructive">
            <AlertDescription>
              {submitMutation.error.message || '기타 신청 처리 중 오류가 발생했습니다.'}
            </AlertDescription>
          </Alert>
        )}
        
        {/* POS 선택 모달 */}
        <Dialog open={showPOSModal} onOpenChange={setShowPOSModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>실판매 POS 선택</DialogTitle>
              <DialogDescription>
                여러 개의 실판매 POS가 발견되었습니다. 하나를 선택해주세요.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {posOptions.map((option, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => handlePOSSelect(option.realSalesPOS)}
                >
                  <div className="flex flex-col items-start">
                    <span className="font-medium">{option.realSalesPOS}</span>
                    <span className="text-xs text-gray-500">
                      {option.dealerName} ({option.code})
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}