import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useApiRequest, useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { createUserSchema, createWorkerSchema, updateDocumentStatusSchema, createServicePlanSchema, createCarrierSchema, createAdditionalServiceSchema, createSettlementUnitPriceSchema } from '../../../shared/schema';
import type { User, Document, ServicePlan, Carrier, AdditionalService, SettlementUnitPrice, Dealer } from '../../../shared/sqlite-schema';
import { apiRequest } from '@/lib/queryClient';
import { 
  Building2, 
  Users, 
  Upload, 
  FileText, 
  Calculator,
  Settings,
  Plus,
  Download,
  CheckCircle,
  Clock,
  AlertTriangle,
  TrendingUp,
  Trash2,
  Edit,
  Edit2,
  DollarSign,
  FileSpreadsheet,
  Image as ImageIcon,
  Info,
  Search,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

// 안전한 날짜 포맷팅 유틸리티
function formatDateSafe(value: any, formatStr: string = 'yyyy-MM-dd', options: any = { locale: ko }): string {
  // null, undefined, 빈 문자열 체크
  if (!value || value === '' || value === null || value === undefined) {
    return '-';
  }
  
  // 빈 객체 체크 (Date 객체는 제외)
  if (typeof value === 'object' && !(value instanceof Date) && Object.keys(value).length === 0) {
    return '-';
  }
  
  try {
    const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value;
    if (!date || isNaN(date.getTime())) {
      return '-';
    }
    return format(date, formatStr, options);
  } catch {
    return '-';
  }
}

// 파일 크기 포맷팅 유틸리티
function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return "";
  const sizes = ["B","KB","MB","GB","TB"];
  const i = bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val : val.toFixed(1)} ${sizes[i]}`;
}

// 파일 데이터 타입
type AnyFile = {
  id?: string|number;
  name?: string;
  filename?: string;
  size?: number;
  fileSize?: number;
  url?: string;
  downloadUrl?: string;
  path?: string;
};

// 배치 문서 파일 정규화 유틸리티
function normalizeFiles(doc: any): AnyFile[] {
  // 1) attachments 배열 우선
  if (Array.isArray(doc?.attachments) && doc.attachments.length > 0) {
    return doc.attachments as AnyFile[];
  }
  // 2) 단일 필드 폴백(attachment/file/attachedFile 등)
  const single = doc?.attachment ?? doc?.file ?? doc?.attachedFile;
  if (single) return [single as AnyFile];
  // 3) 최종 폴백 없음
  return [];
}

// 파일명 추출
function fileDisplayName(f: AnyFile): string {
  return (f.name ?? f.filename ?? `file-${f.id ?? ""}`).toString();
}

// 파일 URL 추출
function fileHref(f: AnyFile, doc: any): string | undefined {
  return f.url ?? f.downloadUrl ?? f.path;
}

// 안전한 ISO 문자열 변환 유틸리티
function toISOOrNull(value: any): string | null {
  // null, undefined, 빈 문자열 체크
  if (!value || value === '' || value === null || value === undefined) {
    return null;
  }
  
  // 빈 객체 체크 (Date 객체는 제외)
  if (typeof value === 'object' && !(value instanceof Date) && Object.keys(value).length === 0) {
    return null;
  }
  
  try {
    const date = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value;
    if (!date || isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  } catch {
    return null;
  }
}

type CreateDealerForm = {
  name: string;
  username: string;
  password: string;
  contactEmail: string;
  contactPhone: string;
  location: string;
  carrierCodes: Record<string, string>; // 통신사별 접점코드
};

type CreateUserForm = {
  username: string;
  password: string;
  name: string;
  role: 'dealer_store' | 'dealer_worker';
};

type CreateAdminForm = {
  username: string;
  password: string;
  name: string;
};

type CreateWorkerForm = {
  username: string;
  password: string;
  name: string;
};

// 통신사별 요금제 그룹화 함수
function groupServicePlansByCarrier(servicePlans: ServicePlan[]) {
  return servicePlans.reduce((groups, plan) => {
    const carrier = plan.carrier;
    if (!groups[carrier]) {
      groups[carrier] = [];
    }
    groups[carrier].push(plan);
    return groups;
  }, {} as Record<string, ServicePlan[]>);
}

// 인라인 정산단가 편집 컴포넌트
function ServicePlanPricingRow({ 
  plan, 
  existingPrice, 
  onUpdate 
}: { 
  plan: ServicePlan; 
  existingPrice?: SettlementUnitPrice; 
  onUpdate: () => void;
}) {
  const [newCustomerPrice, setNewCustomerPrice] = useState(existingPrice?.newCustomerPrice || 0);
  const [portInPrice, setPortInPrice] = useState(existingPrice?.portInPrice || 0);
  const [memo, setMemo] = useState(existingPrice?.memo || '');
  const [isEditing, setIsEditing] = useState(false);
  const { toast } = useToast();
  const apiRequest = useApiRequest();

  const updateMutation = useMutation({
    mutationFn: (data: { newCustomerPrice: number; portInPrice: number; memo: string }) => 
      apiRequest('/api/admin/settlement-unit-prices', {
        method: 'POST',
        body: JSON.stringify({
          servicePlanId: plan.id,
          newCustomerPrice: data.newCustomerPrice,
          portInPrice: data.portInPrice,
          memo: data.memo
        })
      }),
    onSuccess: () => {
      setIsEditing(false);
      onUpdate();
      toast({
        title: '성공',
        description: '정산단가가 성공적으로 업데이트되었습니다.',
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

  const handleSave = () => {
    updateMutation.mutate({
      newCustomerPrice,
      portInPrice,
      memo
    });
  };

  const handleCancel = () => {
    setNewCustomerPrice(existingPrice?.newCustomerPrice || 0);
    setPortInPrice(existingPrice?.portInPrice || 0);
    setMemo(existingPrice?.memo || '');
    setIsEditing(false);
  };

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
        {plan.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {isEditing ? (
          <Input
            type="number"
            value={newCustomerPrice}
            onChange={(e) => setNewCustomerPrice(parseInt(e.target.value) || 0)}
            className="w-24"
          />
        ) : (
          <span>{existingPrice?.newCustomerPrice?.toLocaleString() || '-'}</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {isEditing ? (
          <Input
            type="number"
            value={portInPrice}
            onChange={(e) => setPortInPrice(parseInt(e.target.value) || 0)}
            className="w-24"
          />
        ) : (
          <span>{existingPrice?.portInPrice?.toLocaleString() || '-'}</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {isEditing ? (
          <Input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-32"
            placeholder="메모"
          />
        ) : (
          <span>{existingPrice?.memo || '-'}</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
        {isEditing ? (
          <div className="flex space-x-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateMutation.isPending}
            >
              저장
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
            >
              취소
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsEditing(true)}
          >
            <Edit className="h-4 w-4 mr-1" />
            편집
          </Button>
        )}
      </td>
    </tr>
  );
}

type CreateSalesManagerForm = {
  username: string;
  password: string;
  name: string;
  team: string;
};

type UpdateSalesManagerForm = {
  id?: number;
  teamId: number;
  managerName: string;
  managerCode: string;
  username: string;
  password?: string;
  position: string;
  contactPhone?: string;
  email?: string;
};

type ChangeUserRoleForm = {
  userId: number;
  accountType: 'admin' | 'sales_manager' | 'worker';
};

type EditUserForm = {
  username: string;
  password: string;
  name: string;
  role: 'admin' | 'sales_manager' | 'worker';
  userType?: 'admin' | 'sales_manager' | 'user';
  team?: string;
};

type UpdateDocumentStatusForm = {
  status: '접수' | '보완필요' | '완료';
  activationStatus?: '대기' | '개통' | '취소';
  notes?: string;
};

interface ContactCode {
  id?: number;
  carrierId?: string;
  carrierName?: string;
  contactCode?: string;
  code?: string;
  dealerName?: string;
  carrier?: string;
  isActive?: boolean;
};

// 통신사 리스트 (업데이트됨)
const CARRIERS = [
  { id: 'sk-tellink', name: 'SK텔링크' },
  { id: 'sk-pretty', name: 'SK프리티' },
  { id: 'sk-stage5', name: 'SK스테이지파이브' },
  { id: 'kt-telecom', name: 'KT' },
  { id: 'kt-emobile', name: 'KT엠모바일' },
  { id: 'kt-codemore', name: 'KT코드모바일' },
  { id: 'lg-hellomobile', name: 'LG헬로모바일' },
  { id: 'lg-uplus', name: '미디어로그' },
  { id: 'mvno-emobile', name: 'KT스테이지파이브' },
  { id: 'mvno-future', name: 'LG밸류컴' },
  { id: 'mvno-china', name: '중고KT' },
  { id: 'mvno-prepaid', name: 'LG스마텔' },
];

// 메뉴 권한 목록
const MENU_PERMISSIONS = {
  dashboard: { name: '대시보드', id: 'dashboard' },
  documents: { name: '문서 관리', id: 'documents' },
  settlements: { name: '정산 관리', id: 'settlements' },
  admin: { name: '관리자 패널', id: 'admin' },
  downloads: { name: '다운로드', id: 'downloads' },
  workers: { name: '근무자 관리', id: 'workers' },
  carriers: { name: '통신사 관리', id: 'carriers' },
  contact_codes: { name: '접점코드 관리', id: 'contact_codes' },
  reports: { name: '리포트', id: 'reports' },
} as const;

// 사용자 권한 관리 컴포넌트
function UserPermissionsTab() {
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [permissions, setPermissions] = useState<any[]>([]);
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 모든 사용자 조회
  const { data: allUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['/api/admin/users'],
    queryFn: () => apiRequest('/api/admin/users'),
  });

  // 권한 조회
  const loadUserPermissions = async (userId: number, userType: string) => {
    try {
      const userPermissions = await apiRequest(`/api/admin/user-permissions/${userId}/${userType}`);
      setPermissions(userPermissions || []);
    } catch (error) {
      console.error('권한 조회 오류:', error);
      setPermissions([]);
    }
  };

  // 권한 업데이트
  const updatePermissions = useMutation({
    mutationFn: async (data: { userId: number; userType: string; permissions: any[] }) => {
      return apiRequest('/api/admin/user-permissions', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    },
    onSuccess: () => {
      toast({ title: '권한이 성공적으로 업데이트되었습니다.' });
      setPermissionsDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ 
        title: '권한 업데이트 실패',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const handleOpenPermissions = async (user: any) => {
    setSelectedUser(user);
    await loadUserPermissions(user.id, user.userType);
    setPermissionsDialogOpen(true);
  };

  const handlePermissionChange = (menuId: string, permissionType: 'canView' | 'canEdit' | 'canDelete', value: boolean) => {
    setPermissions(prev => {
      const updated = [...prev];
      const existing = updated.find(p => p.menuId === menuId);
      
      if (existing) {
        existing[permissionType] = value;
      } else {
        updated.push({
          menuId,
          canView: permissionType === 'canView' ? value : false,
          canEdit: permissionType === 'canEdit' ? value : false,
          canDelete: permissionType === 'canDelete' ? value : false,
        });
      }
      return updated;
    });
  };

  const handleSavePermissions = () => {
    if (!selectedUser) return;
    
    updatePermissions.mutate({
      userId: selectedUser.id,
      userType: selectedUser.userType,
      permissions: permissions.filter(p => p.canView || p.canEdit || p.canDelete)
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>사용자 권한 관리</CardTitle>
        <CardDescription>
          각 사용자별로 메뉴 접근 권한을 설정할 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {usersLoading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {allUsers.map((user: any) => (
              <div key={user.uniqueKey} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-4">
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-sm text-gray-500">
                      {user.username} ({user.userType === 'admin' ? '관리자' : user.userType === 'sales_manager' ? '영업과장' : '근무자'})
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenPermissions(user)}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  권한 설정
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* 권한 설정 다이얼로그 */}
        <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>
                {selectedUser?.name} 권한 설정
              </DialogTitle>
              <DialogDescription>
                사용자의 메뉴별 접근 권한을 설정합니다.
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4 text-sm font-medium text-gray-700 border-b pb-2">
                <div>메뉴</div>
                <div className="text-center">보기</div>
                <div className="text-center">수정</div>
                <div className="text-center">삭제</div>
              </div>
              
              {Object.entries(MENU_PERMISSIONS).map(([key, menu]) => {
                const permission = permissions.find(p => p.menuId === menu.id) || {
                  canView: false,
                  canEdit: false,
                  canDelete: false
                };

                return (
                  <div key={menu.id} className="grid grid-cols-4 gap-4 items-center py-2 border-b">
                    <div className="font-medium">{menu.name}</div>
                    <div className="text-center">
                      <Checkbox
                        checked={permission.canView}
                        onCheckedChange={(checked) => 
                          handlePermissionChange(menu.id, 'canView', checked === true)
                        }
                      />
                    </div>
                    <div className="text-center">
                      <Checkbox
                        checked={permission.canEdit}
                        onCheckedChange={(checked) => 
                          handlePermissionChange(menu.id, 'canEdit', checked === true)
                        }
                      />
                    </div>
                    <div className="text-center">
                      <Checkbox
                        checked={permission.canDelete}
                        onCheckedChange={(checked) => 
                          handlePermissionChange(menu.id, 'canDelete', checked === true)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setPermissionsDialogOpen(false)}
              >
                취소
              </Button>
              <Button
                onClick={handleSavePermissions}
                disabled={updatePermissions.isPending}
              >
                {updatePermissions.isPending ? '저장 중...' : '저장'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// 통신사 관리 컴포넌트
function CarrierManagement() {
  const [carrierDialogOpen, setCarrierDialogOpen] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<Carrier | null>(null);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  // 업로드 진행율 상태들 - 각 기능별 관리
  const [uploadProgress, setUploadProgress] = useState(0);
  const [contactCodeUploadProgress, setContactCodeUploadProgress] = useState(0);
  const [dealerUploadProgress, setDealerUploadProgress] = useState(0);
  const [servicePlanUploadProgress, setServicePlanUploadProgress] = useState(0);
  const [settlementUploadProgress, setSettlementUploadProgress] = useState(0);
  const [templateUploadProgress, setTemplateUploadProgress] = useState(0);
  const [imageUploadProgress, setImageUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

      xhr.open('POST', url);
      
      // 인증 헤더 추가 (open 후에 호출해야 함)
      const sessionId = useAuth.getState().sessionId;
      if (sessionId) {
        xhr.setRequestHeader('Authorization', `Bearer ${sessionId}`);
      }

      xhr.send(formData);
    });
  };

  // 통신사 목록 조회 (활성화/비활성화 모두 표시 - 관리 목적)
  const { data: carriers = [], isLoading: carriersLoading } = useQuery({
    queryKey: ['/api/carriers'],
    queryFn: () => apiRequest('/api/carriers'),
    staleTime: 1 * 60 * 1000, // 1분간 캐시 유지
    refetchOnWindowFocus: false // 창 포커스 시 새로고침 비활성화
  });

  // 통신사 생성/수정 폼 - 동적 기본값 설정
  const getDefaultValues = () => {
    if (editingCarrier) {
      return {
        name: editingCarrier.name || '',
        code: editingCarrier.code || '',
        displayOrder: Number(editingCarrier.displayOrder) || 0,
        isActive: Boolean(editingCarrier.isActive),
        isWired: Boolean(editingCarrier.isWired),
        bundleNumber: editingCarrier.bundleNumber || '',
        bundleCarrier: editingCarrier.bundleCarrier || '',
        documentRequired: Boolean(editingCarrier.documentRequired),
        requireCustomerName: Boolean(editingCarrier.requireCustomerName),
        requireCustomerPhone: Boolean(editingCarrier.requireCustomerPhone),
        requireCustomerEmail: Boolean(editingCarrier.requireCustomerEmail),
        requireContactCode: Boolean(editingCarrier.requireContactCode),
        requireCarrier: Boolean(editingCarrier.requireCarrier),
        requirePreviousCarrier: Boolean(editingCarrier.requirePreviousCarrier),
        requireDocumentUpload: Boolean(editingCarrier.requireDocumentUpload),
        requireBundleNumber: Boolean(editingCarrier.requireBundleNumber),
        requireBundleCarrier: Boolean(editingCarrier.requireBundleCarrier),
        allowNewCustomer: Boolean(editingCarrier.allowNewCustomer),
        allowPortIn: Boolean(editingCarrier.allowPortIn),
        requireDesiredNumber: Boolean(editingCarrier.requireDesiredNumber)
      };
    }
    return {
      name: '',
      code: '',
      displayOrder: carriers.length,
      isActive: true,
      isWired: false,
      bundleNumber: '',
      bundleCarrier: '',
      documentRequired: false,
      requireCustomerName: true,
      requireCustomerPhone: true,
      requireCustomerEmail: false,
      requireContactCode: true,
      requireCarrier: true,
      requirePreviousCarrier: false,
      requireDocumentUpload: false,
      requireBundleNumber: false,
      requireBundleCarrier: false,
      allowNewCustomer: true,
      allowPortIn: true,
      requireDesiredNumber: false
    };
  };

  const carrierForm = useForm({
    resolver: zodResolver(createCarrierSchema),
    mode: 'onChange',
    defaultValues: getDefaultValues()
  });

  // 통신사 생성
  const createCarrierMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/carriers', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: async () => {
      // 캐시 무효화 및 강제 새로고침
      await queryClient.invalidateQueries({ queryKey: ['/api/carriers'] });
      await queryClient.removeQueries({ queryKey: ['/api/carriers'] }); // 캐시 완전 제거
      await queryClient.refetchQueries({ queryKey: ['/api/carriers'] });
      
      setCarrierDialogOpen(false);
      setEditingCarrier(null);
      // 폼 리셋시 기본값으로 리셋 (활성화 설정 유지)
      carrierForm.reset(getDefaultValues());
      toast({
        title: "통신사 추가",
        description: "새 통신사가 성공적으로 추가되었습니다."
      });
    },
    onError: (error: any) => {
      toast({
        title: "추가 실패",
        description: error.message || "통신사 추가에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  // 통신사 수정
  const updateCarrierMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/admin/carriers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      }),
    onSuccess: async () => {
      // 모든 관련 쿼리 무효화 및 새로고침
      await queryClient.invalidateQueries({ queryKey: ['/api/carriers'] });
      await queryClient.removeQueries({ queryKey: ['/api/carriers'] }); // 캐시 완전 제거
      await queryClient.refetchQueries({ queryKey: ['/api/carriers'] });
      
      // 토글 작업이 아닌 경우에만 대화상자 닫기
      if (carrierDialogOpen) {
        setCarrierDialogOpen(false);
        setEditingCarrier(null);
        // 폼 리셋시 기본값으로 리셋 (활성화 설정 유지)
        carrierForm.reset(getDefaultValues());
        toast({
          title: "통신사 수정",
          description: "통신사가 성공적으로 수정되었습니다."
        });
      } else {
        // 토글 작업 시에는 간단한 알림만
        toast({
          title: "상태 변경",
          description: "통신사 상태가 성공적으로 변경되었습니다."
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "수정 실패",
        description: error.message || "통신사 수정에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  // 통신사 삭제
  const deleteCarrierMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/carriers/${id}`, {
      method: 'DELETE'
    }),
    onSuccess: async () => {
      // 캐시 무효화 및 강제 새로고침
      await queryClient.invalidateQueries({ queryKey: ['/api/carriers'] });
      await queryClient.removeQueries({ queryKey: ['/api/carriers'] }); // 캐시 완전 제거
      await queryClient.refetchQueries({ queryKey: ['/api/carriers'] });
      
      toast({
        title: "통신사 삭제",
        description: "통신사가 성공적으로 삭제되었습니다."
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "통신사 삭제에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleCreateOrUpdate = (data: any) => {
    if (editingCarrier) {
      updateCarrierMutation.mutate({ id: editingCarrier.id, data });
    } else {
      createCarrierMutation.mutate(data);
    }
  };

  const handleEditCarrier = (carrier: Carrier) => {
    console.log('Editing carrier:', carrier); // 디버깅용
    setEditingCarrier(carrier);
    
    // 폼을 기존 값으로 리셋 (정수 값을 Boolean으로 변환)
    const editValues = {
      name: carrier.name || '',
      displayOrder: Number(carrier.displayOrder) || 0,
      isActive: Boolean(carrier.isActive),
      isWired: Boolean(carrier.isWired),
      bundleNumber: carrier.bundleNumber || '',
      bundleCarrier: carrier.bundleCarrier || '',
      documentRequired: Boolean(carrier.documentRequired),
      requireCustomerName: Boolean(carrier.requireCustomerName),
      requireCustomerPhone: Boolean(carrier.requireCustomerPhone),
      requireCustomerEmail: Boolean(carrier.requireCustomerEmail),
      requireContactCode: Boolean(carrier.requireContactCode),
      requireCarrier: Boolean(carrier.requireCarrier),
      requirePreviousCarrier: Boolean(carrier.requirePreviousCarrier),
      requireDocumentUpload: Boolean(carrier.requireDocumentUpload),
      requireBundleNumber: Boolean(carrier.requireBundleNumber),
      requireBundleCarrier: Boolean(carrier.requireBundleCarrier),
      allowNewCustomer: Boolean(carrier.allowNewCustomer),
      allowPortIn: Boolean(carrier.allowPortIn),
      requireDesiredNumber: Boolean(carrier.requireDesiredNumber)
    };
    
    console.log('Setting form values:', editValues); // 디버깅용
    
    // 각 필드에 직접 값 설정
    setTimeout(() => {
      Object.entries(editValues).forEach(([key, value]) => {
        carrierForm.setValue(key as any, value);
      });
    }, 100);
    
    setCarrierDialogOpen(true);
  };

  const handleAddCarrier = () => {
    setEditingCarrier(null);
    
    // 폼을 초기값으로 리셋
    const defaultValues = {
      name: '',
      displayOrder: carriers.length,
      isActive: true,
      isWired: false,
      bundleNumber: '',
      bundleCarrier: '',
      documentRequired: false,
      requireCustomerName: true,
      requireCustomerPhone: true,
      requireCustomerEmail: false,
      requireContactCode: true,
      requireCarrier: true,
      requirePreviousCarrier: false,
      requireDocumentUpload: false,
      requireBundleNumber: false,
      requireBundleCarrier: false,
      allowNewCustomer: true,
      allowPortIn: true,
      requireDesiredNumber: false
    };
    
    carrierForm.reset(defaultValues);
    setCarrierDialogOpen(true);
  };

  const handleDeleteCarrier = (id: number) => {
    if (confirm('정말로 이 통신사를 삭제하시겠습니까?')) {
      deleteCarrierMutation.mutate(id);
    }
  };

  const handleToggleCarrierStatus = (carrier: Carrier) => {
    console.log('Toggle carrier status:', carrier.id, 'from', carrier.isActive, 'to', !carrier.isActive);
    
    // 토글용 별도 mutation 생성
    const toggleData = {
      isActive: !carrier.isActive
    };
    
    updateCarrierMutation.mutate({
      id: carrier.id,
      data: toggleData
    });
  };

  // 엑셀 양식 다운로드
  const handleDownloadTemplate = async () => {
    try {
      // Get session ID from auth store
      let sessionId = null;
      try {
        const authStore = localStorage.getItem('auth-storage');
        if (authStore) {
          const parsed = JSON.parse(authStore);
          sessionId = parsed?.state?.sessionId || null;
        }
      } catch (e) {
        console.warn('Failed to parse auth store:', e);
      }

      const headers: Record<string, string> = {};
      if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
      }

      const response = await fetch('/api/carriers/excel-template', {
        method: 'GET',
        headers,
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('템플릿 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `통신사_업로드_양식_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "다운로드 완료",
        description: "엑셀 양식이 다운로드되었습니다.",
        variant: "default",
      });
    } catch (error: any) {
      console.error('Template download error:', error);
      toast({
        title: "다운로드 실패",
        description: error.message || "템플릿 다운로드에 실패했습니다.",
        variant: "destructive",
      });
    }
  };

  // 엑셀 파일 업로드
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast({
        title: "파일 형식 오류",
        description: "엑셀 파일(.xlsx, .xls)만 업로드 가능합니다.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const result = await uploadWithProgress(
        file,
        '/api/carriers/upload-excel',
        setUploadProgress
      );

      // 성공 메시지 표시
      toast({
        title: "업로드 완료",
        description: `${result.message}`,
        variant: "default",
      });

      // 실패한 항목이 있으면 상세 정보 표시
      if (result.errors && result.errors.length > 0) {
        console.warn('Upload errors:', result.errors);
        toast({
          title: "일부 오류 발생",
          description: `${result.errors.length}개 항목에서 오류가 발생했습니다. 콘솔을 확인하세요.`,
          variant: "destructive",
        });
      }

      // 통신사 목록 새로고침
      await queryClient.invalidateQueries({ queryKey: ['/api/carriers'] });
      
      setUploadDialogOpen(false);
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "업로드 실패",
        description: error.message || "파일 업로드에 실패했습니다.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // 대화상자가 닫힐 때 상태 정리 - 자동 초기화 제거
  // React.useEffect가 폼 데이터를 자동으로 초기화하는 문제를 방지하기 위해 제거

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>통신사 관리</CardTitle>
          <CardDescription>
            통신사를 관리하고 정렬 순서를 설정할 수 있습니다.
          </CardDescription>
        </div>
        <div className="flex space-x-2">
          {/* 엑셀 양식 다운로드 버튼 */}
          <Button
            variant="outline"
            onClick={handleDownloadTemplate}
            className="flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>엑셀 양식</span>
          </Button>
          
          {/* 엑셀 업로드 버튼 */}
          <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="flex items-center space-x-2">
                <Upload className="h-4 w-4" />
                <span>엑셀 업로드</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>통신사 엑셀 업로드</DialogTitle>
                <DialogDescription>
                  엑셀 파일을 업로드하여 통신사 정보를 일괄 등록할 수 있습니다.
                </DialogDescription>
              </DialogHeader>
              
              {/* 엑셀 업로드 사용법 안내 */}
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-blue-800 mb-2">엑셀 업로드 사용법</h4>
                <ol className="space-y-1 text-sm text-blue-700">
                  <li>1. 위의 "양식 다운로드" 버튼을 클릭하여 템플릿을 다운로드하세요.</li>
                  <li>2. 다운로드한 파일에 통신사 데이터를 입력하세요:</li>
                  <ul className="ml-4 mt-1 space-y-1">
                    <li>• <span className="font-medium">통신사명</span>: 통신사 전체 코드 (예: SK텔링크)</li>
                    <li>• <span className="font-medium">번들번호</span>: 번들별 이름</li>
                    <li>• <span className="font-medium">실판매POS</span>: 실제 판매 POS (선택항목)</li>
                    <li>• <span className="font-medium">담당영업자</span>: 담당 영업자명</li>
                  </ul>
                  <li>3. 작성이 완료되면 "엑셀 업로드" 버튼을 클릭하여 파일을 업로드하세요.</li>
                </ol>
              </div>
              
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={isUploading}
                  />
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                    >
                      {isUploading ? '업로드 중...' : '파일 선택'}
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    .xlsx, .xls 파일만 지원됩니다
                  </p>
                </div>
                {isUploading && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>업로드 진행률</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <Progress value={uploadProgress} className="w-full" />
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          {/* 통신사 추가 버튼 */}
          <Dialog open={carrierDialogOpen} onOpenChange={setCarrierDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleAddCarrier}>
                <Plus className="mr-2 h-4 w-4" />
                통신사 추가
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingCarrier ? '통신사 수정' : '새 통신사 추가'}
              </DialogTitle>
            </DialogHeader>
            <Form {...carrierForm}>
              <form onSubmit={carrierForm.handleSubmit(handleCreateOrUpdate)} className="space-y-4">
                <FormField
                  control={carrierForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>통신사명</FormLabel>
                      <FormControl>
                        <Input placeholder="통신사명을 입력하세요" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={carrierForm.control}
                  name="displayOrder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>정렬 순서</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          placeholder="정렬 순서를 입력하세요"
                          {...field}
                          value={field.value?.toString() || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            field.onChange(value === '' ? 0 : parseInt(value) || 0);
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={carrierForm.control}
                  name="isWired"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">유선 통신사</FormLabel>
                        <FormDescription>
                          유선 통신사인 경우 활성화하세요.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <div className="space-y-4">
                  <h3 className="text-lg font-medium">접수 신청 필수 입력 필드 설정</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={carrierForm.control}
                      name="requireCustomerName"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">고객명</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireCustomerPhone"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">연락처</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireCustomerEmail"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">이메일</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireContactCode"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">개통방명 코드</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireCarrier"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">통신사</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requirePreviousCarrier"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">이전통신사</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireDocumentUpload"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">서류 첨부</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireBundleNumber"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">결합번호</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireBundleCarrier"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">결합통신사</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* 고객 유형 설정 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-gray-900">고객 유형별 지원 설정</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={carrierForm.control}
                      name="allowNewCustomer"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">신규</FormLabel>
                            <FormDescription className="text-xs">신규 고객 지원 여부</FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="allowPortIn"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">번호이동</FormLabel>
                            <FormDescription className="text-xs">번호이동 고객 지원 여부</FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={carrierForm.control}
                      name="requireDesiredNumber"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">희망번호</FormLabel>
                            <FormDescription className="text-xs">신규 시 희망번호 입력 필수</FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                
                <FormField
                  control={carrierForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">활성 상태</FormLabel>
                        <FormDescription>
                          비활성화하면 선택 목록에서 제외됩니다.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCarrierDialogOpen(false)}
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    disabled={createCarrierMutation.isPending || updateCarrierMutation.isPending}
                  >
                    {editingCarrier ? '수정' : '추가'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {carriersLoading ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          </div>
        ) : (
          <div className="space-y-4">
            {carriers.length > 0 ? (
              <div className="grid gap-4 max-h-[600px] overflow-y-auto">
                {carriers
                  .sort((a: Carrier, b: Carrier) => (a.displayOrder || 0) - (b.displayOrder || 0))
                  .map((carrier: Carrier) => (
                    <div
                      key={carrier.id}
                      className="flex items-center justify-between p-4 border rounded-lg bg-white"
                    >
                      <div className="flex items-center space-x-4">
                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium">
                          {carrier.displayOrder}
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">{carrier.name}</h4>
                          <div className="text-sm text-gray-500 space-y-1">
                            <p>정렬 순서: {carrier.displayOrder}</p>
                            {carrier.bundleNumber && (
                              <p>결합 번호: {carrier.bundleNumber}</p>
                            )}
                            {carrier.bundleCarrier && (
                              <p>결합 통신사: {carrier.bundleCarrier}</p>
                            )}
                            <p>서류 필수: {carrier.documentRequired ? '예' : '아니오'}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant={carrier.isActive ? "default" : "secondary"}
                          size="sm"
                          onClick={() => handleToggleCarrierStatus(carrier)}
                          className={`min-w-[60px] ${
                            carrier.isActive 
                              ? 'bg-green-600 hover:bg-green-700 text-white' 
                              : 'bg-gray-300 hover:bg-gray-400 text-gray-700'
                          }`}
                        >
                          {carrier.isActive ? '활성' : '비활성'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditCarrier(carrier)}
                        >
                          수정
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteCarrier(carrier.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <Building2 className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-sm font-medium text-gray-900">통신사가 없습니다</h3>
                <p className="mt-1 text-sm text-gray-500">첫 번째 통신사를 추가해보세요.</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ContactCodeManagement({ dealer }: { dealer: Dealer }) {
  const [isEditing, setIsEditing] = useState(false);
  const [contactCodes, setContactCodes] = useState<ContactCode[]>([]);
  const [tempContactCodes, setTempContactCodes] = useState<ContactCode[]>([]);
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 접점 코드 조회
  const { data: dealerContactCodes, isLoading } = useQuery({
    queryKey: [`/api/dealers/${dealer.id}/contact-codes`],
    queryFn: () => apiRequest(`/api/dealers/${dealer.id}/contact-codes`),
  });

  // 초기 데이터 설정
  React.useEffect(() => {
    if (dealerContactCodes && dealerContactCodes.length > 0) {
      setContactCodes(dealerContactCodes);
      setTempContactCodes(dealerContactCodes);
    } else {
      // 기본값: 모든 통신사에 빈 접점 코드
      const defaultCodes = CARRIERS.map((carrier) => ({
        carrierId: carrier.id,
        carrierName: carrier.name,
        contactCode: ''
      }));
      setContactCodes(defaultCodes);
      setTempContactCodes(defaultCodes);
    }
  }, [dealerContactCodes]);

  // 접점 코드 저장
  const saveContactCodesMutation = useMutation({
    mutationFn: (data: ContactCode[]) => 
      apiRequest(`/api/dealers/${dealer.id}/contact-codes`, {
        method: 'POST',
        body: JSON.stringify({ contactCodes: data }),
        headers: { 'Content-Type': 'application/json' }
      }),
    onSuccess: () => {
      setContactCodes(tempContactCodes);
      setIsEditing(false);
      toast({
        title: "저장 완료",
        description: "접점 코드가 성공적으로 저장되었습니다.",
        variant: "default"
      });
      queryClient.invalidateQueries({ queryKey: [`/api/dealers/${dealer.id}/contact-codes`] });
    },
    onError: (error: any) => {
      console.error('Save contact codes error:', error);
      toast({
        title: "저장 실패",
        description: error.message || "접점 코드 저장에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  // 판매점 삭제 mutation
  const deleteDealerMutation = useMutation({
    mutationFn: (dealerId: number) => 
      apiRequest(`/api/admin/dealers/${dealerId}`, {
        method: 'DELETE'
      }),
    onSuccess: () => {
      toast({
        title: "삭제 완료",
        description: "판매점이 성공적으로 삭제되었습니다.",
        variant: "default"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealers'] });
    },
    onError: (error: any) => {
      console.error('Delete dealer error:', error);
      toast({
        title: "삭제 실패",
        description: error.message || "판매점 삭제에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleDeleteDealer = () => {
    if (window.confirm(`정말로 "${dealer.businessName || dealer.name}" 판매점을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 해당 판매점의 모든 접점코드도 함께 삭제됩니다.`)) {
      deleteDealerMutation.mutate(dealer.id);
    }
  };

  const handleSave = () => {
    saveContactCodesMutation.mutate(tempContactCodes);
  };

  const handleCancel = () => {
    setTempContactCodes(contactCodes);
    setIsEditing(false);
  };

  const updateContactCode = (carrierId: string, contactCode: string) => {
    setTempContactCodes(prev => 
      prev.map(code => 
        (code.carrierId || code.carrier) === carrierId 
          ? { ...code, contactCode }
          : code
      )
    );
  };

  if (isLoading) {
    return (
      <div className="border rounded-lg p-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-medium text-gray-900">{dealer.name}</h4>
          <p className="text-sm text-gray-500">{dealer.location}</p>
        </div>
        <div className="flex space-x-2">
          {isEditing ? (
            <>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleCancel}
                disabled={saveContactCodesMutation.isPending}
              >
                취소
              </Button>
              <Button 
                size="sm" 
                onClick={handleSave}
                disabled={saveContactCodesMutation.isPending}
              >
                {saveContactCodesMutation.isPending ? '저장 중...' : '저장'}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => setIsEditing(true)}>
                편집
              </Button>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={handleDeleteDealer}
                disabled={deleteDealerMutation.isPending}
              >
                {deleteDealerMutation.isPending ? '삭제 중...' : '삭제'}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(isEditing ? tempContactCodes : contactCodes).map((code, index) => (
          <div key={code.carrierId || code.carrier || index} className="space-y-2">
            <Label className="text-sm font-medium">{code.carrierName || code.carrier}</Label>
            {isEditing ? (
              <Input
                value={code.contactCode || code.code || ''}
                onChange={(e) => updateContactCode(code.carrierId || code.carrier || '', e.target.value)}
                placeholder="접점 코드 입력"
                className="text-sm"
              />
            ) : (
              <div className="p-2 bg-gray-50 rounded text-sm min-h-[36px] flex items-center">
                {code.contactCode || code.code || '미설정'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// 판매점 코드별 히든 단가 관리 컴포넌트
function HiddenPricingManagement() {
  const [hiddenPriceDialogOpen, setHiddenPriceDialogOpen] = useState(false);
  const [editingHiddenPrice, setEditingHiddenPrice] = useState<any>(null);
  const [excelUploadDialogOpen, setExcelUploadDialogOpen] = useState(false);
  const [uploadingExcel, setUploadingExcel] = useState(false);
  const { toast } = useToast();
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();

  // 판매점 코드별 히든 단가 목록 조회
  const { data: hiddenPrices = [], isLoading: hiddenPricesLoading } = useQuery({
    queryKey: ['/api/hidden-prices-by-pos'],
    queryFn: () => apiRequest('/api/hidden-prices-by-pos'),
  });

  // 서비스 플랜 목록 조회 (히든 단가 설정시 필요)
  const { data: servicePlans = [] } = useQuery({
    queryKey: ['/api/admin/service-plans'],
    queryFn: () => apiRequest('/api/admin/service-plans'),
  });

  // 히든 단가 폼
  const hiddenPriceForm = useForm({
    defaultValues: {
      contactCode: '',
      dealerName: '',
      servicePlanId: 0,
      hiddenPrice: 0,
      effectiveFrom: '',
      effectiveUntil: '',
      memo: '',
      isActive: true
    }
  });

  // 히든 단가 생성
  const createHiddenPriceMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/hidden-prices-by-pos', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/hidden-prices-by-pos'] });
      setHiddenPriceDialogOpen(false);
      hiddenPriceForm.reset();
      toast({
        title: '성공',
        description: '판매점 코드별 히든 단가가 성공적으로 추가되었습니다.'
      });
    },
    onError: (error: any) => {
      toast({
        title: '오류',
        description: error.message || '판매점 코드별 히든 단가 추가에 실패했습니다.',
        variant: 'destructive'
      });
    }
  });

  // 히든 단가 수정
  const updateHiddenPriceMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/hidden-prices-by-pos/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/hidden-prices-by-pos'] });
      setHiddenPriceDialogOpen(false);
      setEditingHiddenPrice(null);
      hiddenPriceForm.reset();
      toast({
        title: '성공',
        description: '판매점 코드별 히든 단가가 성공적으로 수정되었습니다.'
      });
    },
    onError: (error: any) => {
      toast({
        title: '오류',
        description: error.message || '판매점 코드별 히든 단가 수정에 실패했습니다.',
        variant: 'destructive'
      });
    }
  });

  // 히든 단가 삭제
  const deleteHiddenPriceMutation = useMutation({
    mutationFn: (id: number) => 
      apiRequest(`/api/hidden-prices-by-pos/${id}`, {
        method: 'DELETE'
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/hidden-prices-by-pos'] });
      toast({
        title: '성공',
        description: '판매점 코드별 히든 단가가 성공적으로 삭제되었습니다.'
      });
    },
    onError: (error: any) => {
      toast({
        title: '오류',
        description: error.message || '판매점 코드별 히든 단가 삭제에 실패했습니다.',
        variant: 'destructive'
      });
    }
  });

  // 기존 정산 데이터에 히든단가 적용
  const applyHiddenPricesToSettlementsMutation = useMutation({
    mutationFn: () => apiRequest('/api/apply-hidden-prices-to-settlements', {
      method: 'POST'
    }),
    onSuccess: (result: any) => {
      toast({
        title: '적용 완료',
        description: result.message,
        duration: 3000,
      });
    },
    onError: (error: any) => {
      toast({
        title: '오류',
        description: error.message || '기존 정산 데이터에 히든단가 적용에 실패했습니다.',
        variant: 'destructive'
      });
    }
  });

  const handleApplyHiddenPricesToSettlements = () => {
    if (confirm('기존 정산 데이터에 히든단가를 적용하시겠습니까?\n\n이 작업은 기존 정산금액을 변경할 수 있습니다.')) {
      applyHiddenPricesToSettlementsMutation.mutate();
    }
  };

  const handleCreateHiddenPrice = (data: any) => {
    createHiddenPriceMutation.mutate(data);
  };

  const handleUpdateHiddenPrice = (data: any) => {
    if (editingHiddenPrice) {
      updateHiddenPriceMutation.mutate({ id: editingHiddenPrice.id, data });
    }
  };

  const handleDeleteHiddenPrice = (id: number) => {
    if (confirm('정말로 이 히든 단가를 삭제하시겠습니까?')) {
      deleteHiddenPriceMutation.mutate(id);
    }
  };

  // 엑셀 템플릿 다운로드
  const handleDownloadTemplate = async () => {
    try {
      // Get session ID from auth store
      let sessionId = null;
      try {
        const authStore = localStorage.getItem('auth-storage');
        if (authStore) {
          const parsed = JSON.parse(authStore);
          sessionId = parsed?.state?.sessionId || null;
        }
      } catch (e) {
        console.warn('Failed to parse auth store:', e);
      }

      if (!sessionId) {
        throw new Error('로그인이 필요합니다.');
      }

      const response = await fetch('/api/hidden-prices-by-pos/template', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        }
      });

      if (!response.ok) {
        throw new Error('템플릿 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `판매점코드별_히든단가_템플릿_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: '성공',
        description: '엑셀 템플릿이 다운로드되었습니다.'
      });
    } catch (error: any) {
      toast({
        title: '오류',
        description: error.message || '템플릿 다운로드에 실패했습니다.',
        variant: 'destructive'
      });
    }
  };

  // 엑셀 파일 업로드
  const handleExcelUpload = async (file: File) => {
    if (!file) return;

    setUploadingExcel(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      // Get session ID from auth store
      let sessionId = null;
      try {
        const authStore = localStorage.getItem('auth-storage');
        if (authStore) {
          const parsed = JSON.parse(authStore);
          sessionId = parsed?.state?.sessionId || null;
        }
      } catch (e) {
        console.warn('Failed to parse auth store:', e);
      }

      if (!sessionId) {
        throw new Error('로그인이 필요합니다.');
      }

      const response = await fetch('/api/hidden-prices-by-pos/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '업로드에 실패했습니다.');
      }

      queryClient.invalidateQueries({ queryKey: ['/api/hidden-prices-by-pos'] });
      setExcelUploadDialogOpen(false);

      toast({
        title: '성공',
        description: result.message,
        ...(result.errors && result.errors.length > 0 && {
          description: `${result.message}\n\n오류가 발생한 항목:\n${result.errors.join('\n')}`
        })
      });
    } catch (error: any) {
      toast({
        title: '오류',
        description: error.message || '엑셀 파일 업로드에 실패했습니다.',
        variant: 'destructive'
      });
    } finally {
      setUploadingExcel(false);
    }
  };

  const openCreateDialog = () => {
    setEditingHiddenPrice(null);
    hiddenPriceForm.reset({
      contactCode: '',
      dealerName: '',
      servicePlanId: 0,
      hiddenPrice: 0,
      effectiveFrom: new Date().toISOString().split('T')[0],
      effectiveUntil: '',
      memo: '',
      isActive: true
    });
    setHiddenPriceDialogOpen(true);
  };

  const openEditDialog = (hiddenPrice: any) => {
    setEditingHiddenPrice(hiddenPrice);
    hiddenPriceForm.reset({
      contactCode: hiddenPrice.contactCode,
      dealerName: hiddenPrice.dealerName || '',
      servicePlanId: hiddenPrice.servicePlanId,
      hiddenPrice: hiddenPrice.hiddenPrice,
      effectiveFrom: hiddenPrice.effectiveFrom?.split('T')[0] || '',
      effectiveUntil: hiddenPrice.effectiveUntil?.split('T')[0] || '',
      memo: hiddenPrice.memo || '',
      isActive: hiddenPrice.isActive
    });
    setHiddenPriceDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>판매점 코드별 히든 단가 관리</CardTitle>
          <CardDescription>
            판매점 코드별로 서비스 플랜의 히든 단가를 설정하고 관리할 수 있습니다.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleDownloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            양식 다운로드
          </Button>
          <Button variant="outline" onClick={() => setExcelUploadDialogOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            엑셀 업로드
          </Button>
          <Button 
            variant="outline" 
            onClick={handleApplyHiddenPricesToSettlements}
            disabled={applyHiddenPricesToSettlementsMutation.isPending}
          >
            {applyHiddenPricesToSettlementsMutation.isPending ? (
              <>로딩...</>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                기존 정산 데이터에 적용
              </>
            )}
          </Button>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            새 히든 단가 추가
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* 작성 가이드 */}
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">📋 판매점 코드별 히든단가 업로드 가이드</h3>
          <div className="text-sm text-blue-800 space-y-2">
            <p className="text-red-600 font-medium">⚠️ 중요: 판매점 코드는 정산 시스템의 "판매점코드"와 정확히 일치해야 합니다!</p>
            
            <div>
              <p className="font-medium">1. 작성 방법:</p>
              <ul className="ml-4 space-y-1">
                <li>• 판매점 코드: 정산 관리에서 확인한 판매점 코드를 정확히 입력하세요 (예: L미063561)</li>
                <li>• 통신사, 요금제명: 수정하지 마세요 (자동 입력됨)</li>
                <li>• 히든단가: 원하는 히든단가를 숫자로 입력하세요 (예: 30000)</li>
                <li>• 메모: 필요시 추가 설명을 입력하세요</li>
              </ul>
            </div>
            
            <div>
              <p className="font-medium">2. 주의사항:</p>
              <ul className="ml-4 space-y-1">
                <li>• 판매점 코드는 반드시 입력해야 하며, 정산 관리에서 확인한 것과 정확히 일치해야 합니다</li>
                <li>• 대소문자, 특수문자까지 모두 정확해야 합니다 (예: L미063561)</li>
                <li>• 히든단가가 0인 행은 업로드되지 않습니다</li>
                <li>• 통신사, 요금제명은 수정하지 마세요</li>
              </ul>
            </div>
          </div>
        </div>

        {hiddenPricesLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
            <p className="mt-2 text-sm text-gray-500">히든 단가 목록을 불러오는 중...</p>
          </div>
        ) : hiddenPrices.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    판매점 코드
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    판매점명
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    통신사
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    요금제
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    히든 단가
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    적용 기간
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    상태
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    관리
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {hiddenPrices.map((price: any) => (
                  <tr key={price.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 font-mono text-blue-600">
                      {price.contactCode}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <span className="font-medium">{price.dealerName || '미확인'}</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {price.carrier}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {price.servicePlanName || price.name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {price.hiddenPrice?.toLocaleString()}원
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatDateSafe(price.effectiveFrom, 'yyyy-MM-dd')}
                      {price.effectiveUntil && (
                        <> ~ {formatDateSafe(price.effectiveUntil, 'yyyy-MM-dd')}</>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Badge variant={price.isActive ? "default" : "secondary"}>
                        {price.isActive ? '활성' : '비활성'}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex space-x-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditDialog(price)}
                        >
                          편집
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteHiddenPrice(price.id)}
                        >
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <DollarSign className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">히든 단가가 없습니다</h3>
            <p className="mt-1 text-sm text-gray-500">첫 번째 히든 단가를 추가해보세요.</p>
          </div>
        )}

        {/* 히든 단가 추가/수정 다이얼로그 */}
        <Dialog open={hiddenPriceDialogOpen} onOpenChange={setHiddenPriceDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingHiddenPrice ? '히든 단가 수정' : '새 히든 단가 추가'}
              </DialogTitle>
              <DialogDescription>
판매점별로 서비스 플랜의 히든 단가를 설정합니다.
              </DialogDescription>
            </DialogHeader>
            <Form {...hiddenPriceForm}>
              <form 
                onSubmit={hiddenPriceForm.handleSubmit(editingHiddenPrice ? handleUpdateHiddenPrice : handleCreateHiddenPrice)} 
                className="space-y-4"
              >
                <FormField
                  control={hiddenPriceForm.control}
                  name="contactCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>판매점 코드</FormLabel>
                      <FormControl>
                        <Input placeholder="판매점 코드를 입력하세요 (예: L미063561)" {...field} className="font-mono" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={hiddenPriceForm.control}
                  name="dealerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>판매점명</FormLabel>
                      <FormControl>
                        <Input placeholder="판매점명을 입력하세요 (예: 민텔레콤)" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={hiddenPriceForm.control}
                  name="servicePlanId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>서비스 플랜</FormLabel>
                      <Select onValueChange={(value) => field.onChange(Number(value))} value={String(field.value)}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="서비스 플랜을 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {servicePlans.map((plan: any) => (
                            <SelectItem key={plan.id} value={String(plan.id)}>
                              {plan.carrier} - {plan.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={hiddenPriceForm.control}
                  name="hiddenPrice"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>히든 단가 (원)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="히든 단가를 입력하세요"
                          {...field}
                          onChange={(e) => field.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={hiddenPriceForm.control}
                    name="effectiveFrom"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>적용 시작일</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={hiddenPriceForm.control}
                    name="effectiveUntil"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>적용 종료일 (선택사항)</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={hiddenPriceForm.control}
                  name="memo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>메모 (선택사항)</FormLabel>
                      <FormControl>
                        <Input placeholder="메모를 입력하세요" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={hiddenPriceForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                      <div className="space-y-0.5">
                        <FormLabel>활성 상태</FormLabel>
                        <FormDescription>
                          히든 단가를 활성화하거나 비활성화합니다.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setHiddenPriceDialogOpen(false)}>
                    취소
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createHiddenPriceMutation.isPending || updateHiddenPriceMutation.isPending}
                  >
                    {createHiddenPriceMutation.isPending || updateHiddenPriceMutation.isPending 
                      ? '저장 중...' 
                      : editingHiddenPrice ? '수정' : '추가'
                    }
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* 엑셀 업로드 다이얼로그 */}
        <Dialog open={excelUploadDialogOpen} onOpenChange={setExcelUploadDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>판매점 코드별 히든 단가 엑셀 업로드</DialogTitle>
              <DialogDescription>
                엑셀 파일을 업로드하여 여러 서비스 플랜의 히든 단가를 한번에 설정할 수 있습니다.
              </DialogDescription>
            </DialogHeader>
            <ExcelUploadForm 
              onUpload={handleExcelUpload}
              uploading={uploadingExcel}
              onCancel={() => setExcelUploadDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// 엑셀 업로드 폼 컴포넌트
function ExcelUploadForm({ 
  onUpload, 
  uploading, 
  onCancel 
}: { 
  onUpload: (file: File) => void;
  uploading: boolean;
  onCancel: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedFile) {
      onUpload(selectedFile);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="excelFile">엑셀 파일</Label>
        <Input
          id="excelFile"
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileChange}
          required
        />
        {selectedFile && (
          <p className="text-sm text-gray-500 mt-1">
            선택된 파일: {selectedFile.name}
          </p>
        )}
      </div>

      <div className="bg-blue-50 p-4 rounded-lg">
        <h4 className="text-sm font-medium text-blue-900 mb-3 flex items-center">
          <FileSpreadsheet className="w-4 h-4 mr-2" />
          엑셀 업로드 가이드
        </h4>
        
        <div className="space-y-3">
          <div>
            <h5 className="text-sm font-medium text-blue-800 mb-1">1. 양식 다운로드</h5>
            <p className="text-xs text-blue-700">먼저 "양식 다운로드" 버튼을 클릭하여 엑셀 템플릿을 다운로드하세요.</p>
          </div>
          
          <div>
            <h5 className="text-sm font-medium text-blue-800 mb-1">2. 데이터 입력</h5>
            <p className="text-xs text-blue-700 mb-1">다운로드한 엑셀 파일에서 다음과 같이 입력하세요:</p>
            <ul className="text-xs text-blue-600 space-y-0.5 ml-3">
              <li>• 통신사: 요금제의 통신사 (자동 입력됨)</li>
              <li>• 요금제명: 서비스 플랜명 (자동 입력됨)</li>
              <li>• 요금제ID: 시스템 ID (자동 입력됨)</li>
              <li>• 히든단가: 설정할 히든 단가 금액 (숫자만 입력)</li>
              <li>• 메모: 추가 설명 (선택사항)</li>
            </ul>
          </div>
          
          <div>
            <h5 className="text-sm font-medium text-blue-800 mb-1">3. 파일 업로드</h5>
            <p className="text-xs text-blue-700">작성이 완료되면 엑셀 파일을 선택하여 업로드를 진행하세요.</p>
          </div>
          
          <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
            <p className="text-xs text-yellow-800">
              <strong>주의사항:</strong> 동일한 판매점코드와 요금제 조합이 이미 존재하면 기존 데이터가 업데이트됩니다.
            </p>
          </div>
        </div>
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={uploading}>
          취소
        </Button>
        <Button type="submit" disabled={!selectedFile || uploading}>
          {uploading ? '업로드 중...' : '업로드'}
        </Button>
      </div>
    </form>
  );
}

export function AdminPanel({ defaultTab }: { defaultTab?: string } = {}) {
  const { user } = useAuth();
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // URL에서 탭 결정
  const currentPath = window.location.pathname;
  const actualDefaultTab = currentPath === '/admin/other-business-carriers' ? 'other-business-carriers' : (defaultTab || 'contact-codes');

  // Admin-only access check
  if (user?.userType !== 'admin') {
    return (
      <Layout title="접근 권한 없음">
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-yellow-400 mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">접근 권한이 없습니다</h2>
            <p className="text-gray-600">관리자만 접근할 수 있는 페이지입니다.</p>
          </div>
        </div>
      </Layout>
    );
  }
  
  const [dealerDialogOpen, setDealerDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [adminDialogOpen, setAdminDialogOpen] = useState(false);
  const [workerDialogOpen, setWorkerDialogOpen] = useState(false);
  const [salesManagerDialogOpen, setSalesManagerDialogOpen] = useState(false);
  const [editSalesManagerDialogOpen, setEditSalesManagerDialogOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<any>(null);
  const [editUserDialogOpen, setEditUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // 사용자 아이디 중복 확인 상태
  const [adminUsernameCheck, setAdminUsernameCheck] = useState<{ checking: boolean; available: boolean | null }>({ checking: false, available: null });
  const [workerUsernameCheck, setWorkerUsernameCheck] = useState<{ checking: boolean; available: boolean | null }>({ checking: false, available: null });

  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [servicePlanDialogOpen, setServicePlanDialogOpen] = useState(false);
  const [editServicePlanDialogOpen, setEditServicePlanDialogOpen] = useState(false);
  const [editingServicePlan, setEditingServicePlan] = useState<ServicePlan | null>(null);
  const [additionalServiceDialogOpen, setAdditionalServiceDialogOpen] = useState(false);
  const [editAdditionalServiceDialogOpen, setEditAdditionalServiceDialogOpen] = useState(false);
  const [editingAdditionalService, setEditingAdditionalService] = useState<AdditionalService | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [selectedDealerForContactCodes, setSelectedDealerForContactCodes] = useState<Dealer | null>(null);
  const [contactCodeDialogOpen, setContactCodeDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [pricingTitle, setPricingTitle] = useState('');
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateCategory, setTemplateCategory] = useState<'가입서류' | '변경서류'>('가입서류');
  
  // 정산단가 검색 상태
  const [settlementSearchTerm, setSettlementSearchTerm] = useState('');
  const [settlementCarrierFilter, setSettlementCarrierFilter] = useState('all');
  
  // 접점코드 관리 상태
  const [newContactCode, setNewContactCode] = useState('');
  const [newDealerName, setNewDealerName] = useState('');
  const [newRealSalesPOS, setNewRealSalesPOS] = useState('');
  const [newCarrier, setNewCarrier] = useState('');
  const [newSalesManagerName, setNewSalesManagerName] = useState('');
  
  // 접점코드 검색 상태 (접수 신청 페이지와 동일한 방식)
  const [contactCodeSearchTerm, setContactCodeSearchTerm] = useState('');
  const [contactCodeSuggestions, setContactCodeSuggestions] = useState<any[]>([]);
  const [showContactCodeSuggestions, setShowContactCodeSuggestions] = useState(false);
  
  // 접점코드 검색 및 필터링
  const [contactCodeSearch, setContactCodeSearch] = useState('');
  const [contactCodeCarrierFilter, setContactCodeCarrierFilter] = useState('all');
  const [selectedContactCodes, setSelectedContactCodes] = useState<number[]>([]);
  const [selectAllContactCodes, setSelectAllContactCodes] = useState(false);
  const [forceUpdateContactCodes, setForceUpdateContactCodes] = useState(false);
  
  // 업로드 진행율 상태들
  const [contactCodeUploadProgress, setContactCodeUploadProgress] = useState(0);
  const [servicePlanUploadProgress, setServicePlanUploadProgress] = useState(0);
  const [dealerUploadProgress, setDealerUploadProgress] = useState(0);
  const [settlementUploadProgress, setSettlementUploadProgress] = useState(0);
  const [templateUploadProgress, setTemplateUploadProgress] = useState(0);

  // 기타업무통신사 관련 상태
  const [otherBusinessCarrierDialogOpen, setOtherBusinessCarrierDialogOpen] = useState(false);
  const [editOtherBusinessCarrierDialogOpen, setEditOtherBusinessCarrierDialogOpen] = useState(false);
  const [editingOtherBusinessCarrier, setEditingOtherBusinessCarrier] = useState<any>(null);
  const [otherBusinessCarrierForm, setOtherBusinessCarrierForm] = useState({
    businessRequestPoint: '',
    memo: ''
  });

  // 기타업무통신사 엑셀 관련 ref
  const otherBusinessCarrierExcelInputRef = useRef<HTMLInputElement>(null);
  
  // 필요한 ref들 (기존에 정의된 contactCodeExcelInputRef 사용)
  
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

      xhr.open('POST', url);
      
      // 인증 헤더 추가 (open 후에 호출해야 함)
      const sessionId = useAuth.getState().sessionId;
      if (sessionId) {
        xhr.setRequestHeader('Authorization', `Bearer ${sessionId}`);
      }

      xhr.send(formData);
    });
  };
  
  // 접점코드 검색 함수 (접수 신청 페이지와 동일한 방식)
  const searchContactCodes = async (query: string) => {
    if (query.length < 1) {
      setContactCodeSuggestions([]);
      setShowContactCodeSuggestions(false);
      return;
    }

    try {
      const response = await apiRequest(`/api/contact-codes/search?q=${encodeURIComponent(query)}`);
      setContactCodeSuggestions(response || []);
      setShowContactCodeSuggestions(true);
    } catch (error) {
      console.warn('접점코드 검색 실패:', error);
      setContactCodeSuggestions([]);
      setShowContactCodeSuggestions(false);
    }
  };

  // 접점코드 변경 시 실시간 검색
  const handleNewContactCodeChange = async (contactCode: string) => {
    setNewContactCode(contactCode);
    setContactCodeSearchTerm(contactCode);
    
    // 실시간 검색 제안
    if (contactCode.trim()) {
      await searchContactCodes(contactCode);
      
      // 정확한 코드 일치 시 자동 선택
      try {
        const response = await apiRequest(`/api/contact-codes/search/${encodeURIComponent(contactCode)}`);
        if (response?.dealerName) {
          setNewDealerName(response.dealerName);
        }
      } catch (error) {
        console.warn('접점코드 조회 실패:', error);
      }
    } else {
      setContactCodeSuggestions([]);
      setShowContactCodeSuggestions(false);
    }
  };

  // 접점코드 제안 선택
  const selectContactCodeSuggestion = (suggestion: any) => {
    setNewContactCode(suggestion.code);
    setNewDealerName(suggestion.dealerName);
    setContactCodeSearchTerm(suggestion.code);
    setShowContactCodeSuggestions(false);
  };
  
  // 서비스 플랜 검색 및 필터링
  const [servicePlanSearch, setServicePlanSearch] = useState('');
  const [servicePlanCarrierFilter, setServicePlanCarrierFilter] = useState('all');
  const [selectedServicePlans, setSelectedServicePlans] = useState<number[]>([]);
  const [selectAllServicePlans, setSelectAllServicePlans] = useState(false);
  
  const contactCodeExcelInputRef = useRef<HTMLInputElement>(null);
  const dealerExcelInputRef = useRef<HTMLInputElement>(null);
  
  // Analytics dialog states
  const [workerDetailsOpen, setWorkerDetailsOpen] = useState(false);
  const [carrierDetailsOpen, setCarrierDetailsOpen] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<{ id: number; name: string } | null>(null);
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [workerCarrierDetails, setWorkerCarrierDetails] = useState<Array<{ carrier: string; count: number }>>([]);

  // 판매점 생성 폼
  const dealerForm = useForm<CreateDealerForm>({
    resolver: zodResolver(z.object({
      name: z.string().min(1, '판매점명은 필수입니다'),
      username: z.string().min(1, '아이디는 필수입니다'),
      password: z.string().min(6, '비밀번호는 최소 6자 이상이어야 합니다'),
      contactEmail: z.string().email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
      contactPhone: z.string().optional(),
      location: z.string().optional(),
      carrierCodes: z.record(z.string()),
    })),
    defaultValues: {
      name: '',
      username: '',
      password: '',
      contactEmail: '',
      contactPhone: '',
      location: '',
      carrierCodes: {},
    },
  });
  const [carrierDealerDetails, setCarrierDealerDetails] = useState<Array<{ dealerName: string; count: number }>>([]);

  // 메인 테이블에서 판매점 삭제 처리
  const deleteDealerInTableMutation = useMutation({
    mutationFn: (dealerId: number) => 
      apiRequest(`/api/admin/dealers/${dealerId}`, {
        method: 'DELETE'
      }),
    onSuccess: () => {
      toast({
        title: "삭제 완료",
        description: "판매점이 성공적으로 삭제되었습니다.",
        variant: "default"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
    },
    onError: (error: any) => {
      console.error('Delete dealer error:', error);
      toast({
        title: "삭제 실패",
        description: error.message || "판매점 삭제에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleDeleteDealerInTable = (dealerId: number, dealerName: string) => {
    console.log('Delete dealer clicked:', dealerId, dealerName);
    if (window.confirm(`정말로 "${dealerName}" 판매점을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 해당 판매점의 모든 접점코드도 함께 삭제됩니다.`)) {
      deleteDealerInTableMutation.mutate(dealerId);
    }
  };

  // 판매점 편집 관련 상태
  const [editingDealer, setEditingDealer] = useState<any>(null);
  const [editDealerDialogOpen, setEditDealerDialogOpen] = useState(false);

  // 판매점 편집 폼
  const editDealerForm = useForm<CreateDealerForm>({
    resolver: zodResolver(z.object({
      name: z.string().min(1, '판매점명은 필수입니다'),
      username: z.string().min(1, '아이디는 필수입니다'),
      password: z.string().optional(),
      contactEmail: z.string().email('올바른 이메일 형식이 아닙니다').optional().or(z.literal('')),
      contactPhone: z.string().optional(),
      location: z.string().optional(),
      carrierCodes: z.record(z.string()),
    })),
    defaultValues: {
      name: '',
      username: '',
      password: '',
      contactEmail: '',
      contactPhone: '',
      location: '',
      carrierCodes: {},
    },
  });



  // 판매점 수정 뮤테이션
  const updateDealerMutation = useMutation({
    mutationFn: (data: { id: number; updateData: Partial<CreateDealerForm> }) => 
      apiRequest(`/api/admin/dealers/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify(data.updateData)
      }),
    onSuccess: () => {
      editDealerForm.reset();
      setEditingDealer(null);
      setEditDealerDialogOpen(false);
      toast({
        title: '판매점 수정 완료',
        description: '판매점 정보가 성공적으로 수정되었습니다.',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealers'] });
    },
    onError: (error: any) => {
      toast({
        title: '수정 실패',
        description: error.message || '판매점 수정에 실패했습니다.',
        variant: 'destructive',
      });
    },
  });

  const handleUpdateDealer = (data: CreateDealerForm) => {
    if (!editingDealer) return;
    
    const updateData: Partial<CreateDealerForm> = {
      name: data.name,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      location: data.location,
    };
    
    // 비밀번호가 입력된 경우에만 포함
    if (data.password && data.password.trim()) {
      updateData.password = data.password;
    }
    
    updateDealerMutation.mutate({
      id: editingDealer.id,
      updateData
    });
  };

  // 판매점 생성 뮤테이션
  const createDealerMutation = useMutation({
    mutationFn: (data: CreateDealerForm) => apiRequest('POST', '/api/dealers', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealers'] });
      dealerForm.reset();
      setDealerDialogOpen(false);
      toast({
        title: '판매점 생성 완료',
        description: '새 판매점 계정이 성공적으로 생성되었습니다.',
      });
    },
    onError: (error: any) => {
      toast({
        title: '판매점 생성 실패',
        description: error.message || '판매점 생성에 실패했습니다.',
        variant: 'destructive',
      });
    },
  });

  // 판매점 엑셀 일괄 업로드 뮤테이션
  const dealerExcelUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setDealerUploadProgress(0);
      return uploadWithProgress(
        file,
        '/api/admin/dealers/upload',
        setDealerUploadProgress
      );
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealers'] });
      
      let description = data.message || `${data.success?.length || 0}개의 판매점이 성공적으로 생성되었습니다.`;
      
      if (data.errors && data.errors.length > 0) {
        description += `\n\n오류 발생 (${data.errors.length}건):\n`;
        data.errors.slice(0, 5).forEach((err: any) => {
          description += `- 행 ${err.row}: ${err.error}\n`;
        });
        if (data.errors.length > 5) {
          description += `... 외 ${data.errors.length - 5}건 더`;
        }
      }
      
      toast({
        title: "업로드 완료",
        description: description,
      });
      
      if (dealerExcelInputRef.current) {
        dealerExcelInputRef.current.value = '';
      }
    },
    onError: (error: any) => {
      console.error('Dealer upload error:', error);
      
      let description = error.message || "판매점 업로드에 실패했습니다.";
      
      toast({
        title: "업로드 실패",
        description: description,
        variant: "destructive"
      });
      
      if (dealerExcelInputRef.current) {
        dealerExcelInputRef.current.value = '';
      }
    }
  });

  const handleCreateDealer = (data: CreateDealerForm) => {
    createDealerMutation.mutate(data);
  };

  // 기타업무통신사 CRUD 함수들
  const createOtherBusinessCarrierMutation = useMutation({
    mutationFn: (data: any) => 
      apiRequest('/api/admin/other-business-carriers', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({
        title: "성공",
        description: "기타업무통신사가 성공적으로 생성되었습니다.",
      });
      setOtherBusinessCarrierDialogOpen(false);
      setOtherBusinessCarrierForm({
        businessRequestPoint: '',
        memo: ''
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/other-business-carriers'] });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "기타업무통신사 생성에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const updateOtherBusinessCarrierMutation = useMutation({
    mutationFn: ({ id, data }: { id: number, data: any }) => 
      apiRequest(`/api/admin/other-business-carriers/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      toast({
        title: "성공",
        description: "기타업무통신사가 성공적으로 수정되었습니다.",
      });
      setEditOtherBusinessCarrierDialogOpen(false);
      setEditingOtherBusinessCarrier(null);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/other-business-carriers'] });
    },
    onError: (error: any) => {
      toast({
        title: "오류",
        description: error.message || "기타업무통신사 수정에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const deleteOtherBusinessCarrierMutation = useMutation({
    mutationFn: (id: number) => 
      apiRequest(`/api/admin/other-business-carriers/${id}`, {
        method: 'DELETE'
      }),
    onSuccess: () => {
      toast({
        title: "삭제 완료",
        description: "기타업무통신사가 성공적으로 삭제되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/other-business-carriers'] });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "기타업무통신사 삭제에 실패했습니다.",
        variant: "destructive",
      });
    }
  });

  // 기타업무통신사 엑셀 업로드 mutation
  const otherBusinessCarrierExcelUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiRequest('/api/admin/other-business-carriers/excel/upload', {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: (data) => {
      toast({
        title: "업로드 성공",
        description: `${data.count || 0}개의 기타업무통신사가 처리되었습니다.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/other-business-carriers'] });
      if (otherBusinessCarrierExcelInputRef.current) {
        otherBusinessCarrierExcelInputRef.current.value = '';
      }
    },
    onError: (error: any) => {
      toast({
        title: "업로드 실패",
        description: error.message || "엑셀 파일 업로드에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // 기타업무통신사 엑셀 다운로드 mutation
  const otherBusinessCarrierExcelDownloadMutation = useMutation({
    mutationFn: async () => {
      // Get session ID from auth store
      let sessionId = null;
      try {
        const authStore = localStorage.getItem('auth-storage');
        if (authStore) {
          const parsed = JSON.parse(authStore);
          sessionId = parsed?.state?.sessionId || null;
        }
      } catch (e) {
        console.warn('Failed to parse auth store:', e);
      }

      if (!sessionId) {
        throw new Error('로그인이 필요합니다.');
      }

      const response = await fetch('/api/admin/other-business-carriers/excel/download', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionId}`,
        },
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '다운로드 실패' }));
        throw new Error(errorData.error || '다운로드 실패');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `기타업무통신사_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      return true;
    },
    onSuccess: () => {
      toast({
        title: "다운로드 완료",
        description: "엑셀 파일이 성공적으로 다운로드되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "다운로드 실패",
        description: error.message || "엑셀 파일 다운로드에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // 기타업무통신사 핸들러 함수들
  const handleCreateOtherBusinessCarrier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!otherBusinessCarrierForm.businessRequestPoint) {
      toast({
        title: "오류",
        description: "업무 요청점은 필수 입력 사항입니다.",
        variant: "destructive",
      });
      return;
    }
    createOtherBusinessCarrierMutation.mutate(otherBusinessCarrierForm);
  };

  const handleEditOtherBusinessCarrier = (carrier: any) => {
    setEditingOtherBusinessCarrier(carrier);
    setOtherBusinessCarrierForm({
      businessRequestPoint: carrier.businessRequestPoint || '',
      memo: carrier.memo || ''
    });
    setEditOtherBusinessCarrierDialogOpen(true);
  };

  const handleDeleteOtherBusinessCarrier = (id: number, businessRequestPoint: string) => {
    if (window.confirm(`정말로 "${businessRequestPoint}" 기타업무통신사를 삭제하시겠습니까?`)) {
      deleteOtherBusinessCarrierMutation.mutate(id);
    }
  };

  const handleOtherBusinessCarrierExcelDownload = () => {
    otherBusinessCarrierExcelDownloadMutation.mutate();
  };

  // User management states
  
  // 서비스플랜 업로드 관련
  const [selectedExcelFile, setSelectedExcelFile] = useState<File | null>(null);
  const [servicePlanImageForm, setServicePlanImageForm] = useState({
    carrier: '',
    file: null as File | null
  });
  
  // 엑셀 다운로드 관련
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  
  // 엑셀 업로드 관련 상태
  const excelFileInputRef = useRef<HTMLInputElement>(null);

  // Settlement unit pricing states
  const [settlementPriceDialogOpen, setSettlementPriceDialogOpen] = useState(false);
  const [selectedServicePlan, setSelectedServicePlan] = useState<ServicePlan | null>(null);
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  
  // Settlement unit pricing excel upload
  const settlementPricingExcelInputRef = useRef<HTMLInputElement>(null);
  const [settlementPricingFile, setSettlementPricingFile] = useState<File | null>(null);

  // Queries
  const { data: dealers, isLoading: dealersLoading } = useQuery({
    queryKey: ['/api/admin/dealers'],
    queryFn: () => apiRequest('/api/admin/dealers') as Promise<Dealer[]>,
  });

  // 기타업무통신사 데이터 가져오기
  const { data: otherBusinessCarriers, isLoading: otherBusinessCarriersLoading } = useQuery({
    queryKey: ['/api/admin/other-business-carriers'],
    queryFn: async () => {
      const response = await apiRequest('/api/admin/other-business-carriers');
      return response || [];
    },
  });

  const { data: users = [], isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ['/api/admin/users'],
    queryFn: () => apiRequest('/api/admin/users') as Promise<Array<User & { dealerName: string; userType: string; displayName: string; affiliation: string; accountType: string }>>,
  });

  // 통신사 데이터 조회 (서비스 플랜 관리용)
  const { data: carriersData = [], isLoading: carriersLoading } = useQuery({
    queryKey: ['/api/carriers'],
    queryFn: () => apiRequest('/api/carriers') as Promise<Carrier[]>,
    staleTime: 0,
    refetchOnWindowFocus: true
  });

  // 디버깅용 로그 제거 (정상 작동 확인됨)

  // Sales managers data query
  const { data: salesManagers = [] } = useQuery({
    queryKey: ['/api/admin/sales-managers'],
    queryFn: () => apiRequest('/api/admin/sales-managers')
  });

  // Sales teams data query
  const { data: salesTeams = [] } = useQuery({
    queryKey: ['/api/admin/sales-teams'],
    queryFn: () => apiRequest('/api/admin/sales-teams')
  });

  // Combined users list (기존 users + 영업과장)
  // users 배열은 이미 admins + users를 포함 (백엔드 /api/admin/users가 합쳐서 반환)
  // uniqueKey 추가로 ID 충돌 방지 (users와 admins가 같은 ID를 가질 수 있음)
  const allUsers = [
    ...users.map((user: any) => {
      // activatedByType으로 실제 사용자 타입 확인
      const isAdmin = user.activatedByType === 'admin';
      return {
        ...user,
        accountType: isAdmin ? 'admin' : 'user',
        userType: isAdmin ? 'admin' : (user.userType || 'user'),
        uniqueKey: isAdmin ? `admin-${user.id}` : `user-${user.id}`,
        displayName: user.name,
        affiliation: isAdmin ? '시스템' : (user.dealerName || user.affiliation || '-')
      };
    }),
    ...salesManagers.map((manager: any) => ({ 
      ...manager, 
      accountType: 'sales_manager',
      userType: 'sales_manager',
      uniqueKey: `sales_manager-${manager.id}`,
      username: manager.username,
      displayName: manager.managerName,
      affiliation: manager.teamName || '-',
      createdAt: manager.createdAt
    }))
  ];

  const { data: documents, isLoading: documentsLoading } = useQuery({
    queryKey: ['/api/documents'],
    queryFn: () => apiRequest('/api/documents?includeActivatedBy=true') as Promise<Array<Document & { dealerName: string; userName: string; activatedByName?: string }>>,
  });



  const { data: documentTemplates } = useQuery({
    queryKey: ['/api/document-templates'],
    queryFn: () => apiRequest('/api/document-templates') as Promise<Array<{
      id: number;
      title: string;
      fileName: string;
      fileSize: number;
      category: string;
      uploadedAt: Date;
    }>>,
  });

  const { data: workerStats, isLoading: workerStatsLoading } = useQuery({
    queryKey: ['/api/worker-stats'],
    queryFn: () => apiRequest('/api/worker-stats') as Promise<Array<{
      workerName: string;
      totalActivations: number;
      monthlyActivations: number;
      dealerId: number;
    }>>,
  });

  const { data: servicePlans, isLoading: servicePlansLoading } = useQuery({
    queryKey: ['/api/admin/service-plans'],
    queryFn: () => apiRequest('/api/admin/service-plans') as Promise<ServicePlan[]>,
  });

  const { data: additionalServices, isLoading: additionalServicesLoading } = useQuery({
    queryKey: ['/api/admin/additional-services'],
    queryFn: () => apiRequest('/api/admin/additional-services') as Promise<AdditionalService[]>,
  });

  // Contact Codes Query
  const { data: contactCodes, isLoading: contactCodesLoading } = useQuery({
    queryKey: ['/api/contact-codes'],
    queryFn: () => apiRequest('/api/contact-codes') as Promise<ContactCode[]>,
  });

  // Sales Managers Query for contact code assignment
  const { data: salesManagersList } = useQuery({
    queryKey: ['/api/admin/sales-managers'],
    queryFn: () => apiRequest('/api/admin/sales-managers'),
  });

  // Carriers Query for contact code form
  const { data: carriersList = [] } = useQuery({
    queryKey: ['/api/carriers'],
    queryFn: () => apiRequest('/api/carriers'),
  });

  // Settlement unit pricing queries
  const { data: settlementPrices, isLoading: settlementPricesLoading } = useQuery({
    queryKey: ['/api/admin/settlement-unit-prices'],
    queryFn: () => apiRequest('/api/admin/settlement-unit-prices') as Promise<SettlementUnitPrice[]>,
  });



  // Forms
  const userForm = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: '',
      password: '',
      name: '',
      role: 'dealer_store',
    },
  });

  const adminForm = useForm<CreateAdminForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      username: '',
      password: '',
      name: '',
      userType: 'admin',
    },
  });

  const workerForm = useForm<CreateWorkerForm>({
    resolver: zodResolver(createWorkerSchema),
    defaultValues: {
      username: '',
      password: '',
      name: '',
    },
  });

  // 관리자 아이디 중복 확인
  const adminUsername = adminForm.watch('username');
  useEffect(() => {
    if (!adminUsername || adminUsername.length < 3) {
      setAdminUsernameCheck({ checking: false, available: null });
      return;
    }

    const timer = setTimeout(async () => {
      setAdminUsernameCheck({ checking: true, available: null });
      try {
        const response = await apiRequest(`/api/admin/users/check-username/${adminUsername}`);
        setAdminUsernameCheck({ checking: false, available: response.available });
      } catch (error) {
        setAdminUsernameCheck({ checking: false, available: null });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [adminUsername, apiRequest]);

  // 근무자 아이디 중복 확인
  const workerUsername = workerForm.watch('username');
  useEffect(() => {
    if (!workerUsername || workerUsername.length < 3) {
      setWorkerUsernameCheck({ checking: false, available: null });
      return;
    }

    const timer = setTimeout(async () => {
      setWorkerUsernameCheck({ checking: true, available: null });
      try {
        const response = await apiRequest(`/api/admin/users/check-username/${workerUsername}`);
        setWorkerUsernameCheck({ checking: false, available: response.available });
      } catch (error) {
        setWorkerUsernameCheck({ checking: false, available: null });
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [workerUsername, apiRequest]);

  const editUserForm = useForm<EditUserForm>({
    resolver: zodResolver(
      z.object({
        username: z.string().min(1, '아이디를 입력해주세요'),
        password: z.string().optional(),
        name: z.string().min(1, '이름을 입력해주세요'),
        role: z.enum(['admin', 'sales_manager', 'worker']),
        userType: z.enum(['admin', 'sales_manager', 'user']).optional(),
        team: z.string().optional(),
        allowedCarriers: z.array(z.string()).optional(),
      })
    ),
    defaultValues: {
      username: '',
      password: '',
      name: '',
      role: 'worker',
      userType: 'user',
      team: '',
      allowedCarriers: [],
    },
  });

  const salesManagerForm = useForm<CreateSalesManagerForm>({
    defaultValues: {
      username: '',
      password: '',
      name: '',
      team: '',
    },
  });

  const editSalesManagerForm = useForm<UpdateSalesManagerForm>({
    defaultValues: {
      teamId: 1,
      managerName: '',
      managerCode: '',
      username: '',
      password: '',
      position: '과장',
      contactPhone: '',
      email: '',
    },
  });

  const changePasswordForm = useForm({
    defaultValues: {
      newPassword: '',
      confirmPassword: '',
    },
  });



  const statusForm = useForm<UpdateDocumentStatusForm>({
    resolver: zodResolver(updateDocumentStatusSchema),
    defaultValues: {
      status: '접수',
      activationStatus: '대기',
      notes: '',
    },
  });

  const servicePlanForm = useForm({
    resolver: zodResolver(createServicePlanSchema),
    defaultValues: {
      name: '',
      carrier: '',
      planType: '',
      dataAllowance: '',
      monthlyFee: 0,
      combinationEligible: false,
      isActive: true,
    },
  });



  const editServicePlanForm = useForm({
    resolver: zodResolver(createServicePlanSchema),
    defaultValues: {
      name: '',
      carrier: '',
      planType: '',
      dataAllowance: '',
      monthlyFee: 0,
      combinationEligible: false,
      isActive: true,
    },
  });

  const additionalServiceForm = useForm({
    resolver: zodResolver(createAdditionalServiceSchema),
    defaultValues: {
      serviceName: '',
      carrier: '',
      serviceType: '',
      monthlyFee: 0,
      description: '',
      isActive: true,
    },
  });

  const editAdditionalServiceForm = useForm({
    resolver: zodResolver(createAdditionalServiceSchema),
    defaultValues: {
      serviceName: '',
      carrier: '',
      serviceType: '',
      monthlyFee: 0,
      description: '',
      isActive: true,
    },
  });

  const settlementPriceForm = useForm<CreateSettlementUnitPriceForm>({
    resolver: zodResolver(createSettlementUnitPriceSchema),
    defaultValues: {
      servicePlanId: 0,
      newCustomerPrice: 0,
      portInPrice: 0,
      memo: '',
    },
  });

  // Mutations
  const createUserMutation = useMutation({
    mutationFn: (data: CreateUserForm) => apiRequest('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setUserDialogOpen(false);
      userForm.reset();
      toast({
        title: '성공',
        description: '사용자가 성공적으로 생성되었습니다.',
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

  const createAdminMutation = useMutation({
    mutationFn: (data: CreateAdminForm) => apiRequest('/api/admin/create-admin', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/admins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setAdminDialogOpen(false);
      adminForm.reset();
      toast({
        title: '성공',
        description: '관리자 계정이 성공적으로 생성되었습니다.',
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

  const createWorkerMutation = useMutation({
    mutationFn: (data: CreateWorkerForm) => apiRequest('/api/admin/create-worker', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setWorkerDialogOpen(false);
      workerForm.reset();
      toast({
        title: '성공',
        description: '근무자 계정이 성공적으로 생성되었습니다.',
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

  const createSalesManagerMutation = useMutation({
    mutationFn: (data: CreateSalesManagerForm) => apiRequest('/api/admin/create-sales-manager', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-managers'] });
      salesManagerForm.reset({
        username: '',
        password: '',
        name: '',
        team: '',
      });
      setSalesManagerDialogOpen(false);
      toast({
        title: '성공',
        description: '영업과장 계정이 성공적으로 생성되었습니다.',
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

  const changePasswordMutation = useMutation({
    mutationFn: (data: { userId: number; accountType: string; newPassword: string }) => 
      apiRequest('/api/admin/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      setChangePasswordDialogOpen(false);
      changePasswordForm.reset();
      toast({
        title: '성공',
        description: '비밀번호가 성공적으로 변경되었습니다.',
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


  const updateSalesManagerMutation = useMutation({
    mutationFn: (data: UpdateSalesManagerForm & { id: number }) => 
      apiRequest(`/api/admin/sales-managers/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-managers'] });
      setEditSalesManagerDialogOpen(false);
      editSalesManagerForm.reset();
      toast({
        title: '성공',
        description: '영업과장 정보가 성공적으로 수정되었습니다.',
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

  const deleteSalesManagerMutation = useMutation({
    mutationFn: (managerId: number) => apiRequest(`/api/admin/sales-managers/${managerId}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-managers'] });
      toast({
        title: '성공',
        description: '영업과장 계정이 성공적으로 삭제되었습니다.',
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

  const changeUserRoleMutation = useMutation({
    mutationFn: (data: ChangeUserRoleForm) => apiRequest('/api/admin/change-user-role', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-managers'] });
      setEditUserDialogOpen(false);
      editUserForm.reset();
      toast({
        title: '성공',
        description: '사용자 권한이 성공적으로 변경되었습니다.',
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

  const uploadPricingMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch('/api/admin/pricing-tables', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionId}`,
        },
        body: data,
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '업로드에 실패했습니다.' }));
        throw new Error(error.error || '업로드에 실패했습니다.');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/pricing-tables'] });
      setPricingDialogOpen(false);
      setSelectedFile(null);
      setPricingTitle('');
      toast({
        title: '성공',
        description: '단가표가 성공적으로 업로드되었습니다.',
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

  const uploadTemplateMutation = useMutation({
    mutationFn: async (data: FormData) => {
      setTemplateUploadProgress(0);
      // FormData에서 파일을 추출
      const file = data.get('file') as File;
      const title = data.get('title') as string;
      const category = data.get('category') as string;
      
      return uploadWithProgress(
        file,
        '/api/admin/document-templates',
        setTemplateUploadProgress,
        { title, category }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/document-templates'] });
      setTemplateDialogOpen(false);
      setTemplateFile(null);
      setTemplateTitle('');
      setTemplateCategory('가입서류');
      toast({
        title: '성공',
        description: '서식지가 성공적으로 업로드되었습니다.',
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

  // Settlement unit pricing excel upload mutation
  const settlementPricingExcelUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      setSettlementUploadProgress(0);
      return uploadWithProgress(
        file,
        '/api/admin/settlement-pricing/excel-upload',
        setSettlementUploadProgress
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
      queryClient.invalidateQueries({ queryKey: ['/api/settlement-prices'] });
      setSettlementPricingFile(null);
      
      let description = `정산단가 ${data.processed || 0}건이 성공적으로 처리되었습니다.`;
      if (data.duplicatesSkipped > 0) {
        description += ` (${data.duplicatesSkipped}개 중복건 제외)`;
      }
      
      toast({
        title: '성공',
        description,
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

  const updateDocumentStatusMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => 
      apiRequest(`/api/documents/${id}/activation`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/today-stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/monthly-activation-stats'] });
      setStatusDialogOpen(false);
      setSelectedDocument(null);
      statusForm.reset();
      toast({
        title: '성공',
        description: '서류 상태가 업데이트되었습니다.',
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

  // Event handlers
  const handleCreateUser = (data: CreateUserForm) => {
    // role을 userType으로 변환
    const userData = {
      ...data,
      userType: data.role // role 필드를 userType으로 매핑
    };
    createUserMutation.mutate(userData);
  };

  // 관리자 수정 mutation
  const updateAdminMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest(`/api/admin/admins/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/admins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setEditUserDialogOpen(false);
      setEditingUser(null);
      editUserForm.reset();
      toast({
        title: '성공',
        description: '관리자 정보가 업데이트되었습니다.',
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

  // 사용자 수정 뮤테이션
  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { username?: string; password?: string; name?: string; role?: string; userType?: string; team?: string; allowedCarriers?: string[] } }) =>
      apiRequest(`/api/admin/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      setEditUserDialogOpen(false);
      setEditingUser(null);
      editUserForm.reset();
      toast({
        title: '성공',
        description: '사용자 정보가 업데이트되었습니다.',
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



  const handleUpdateUser = (data: EditUserForm) => {
    if (!editingUser) return;
    
    const updateData: any = {};
    if (data.username !== editingUser.username) updateData.username = data.username;
    if (data.password && data.password.trim() !== '') updateData.password = data.password;
    if (data.name !== editingUser.name) updateData.name = data.name;
    if (data.role !== editingUser.role && data.role !== editingUser.userType) updateData.role = data.role;
    if (data.userType && data.userType !== editingUser.userType) updateData.userType = data.userType;
    if (data.team !== editingUser.team) updateData.team = data.team;
    
    // Compare allowedCarriers arrays (using cloned arrays to avoid mutation)
    const currentCarriers = editingUser.allowedCarriers || [];
    const newCarriers = data.allowedCarriers || [];
    if (JSON.stringify([...currentCarriers].sort()) !== JSON.stringify([...newCarriers].sort())) {
      updateData.allowedCarriers = newCarriers;
    }
    
    console.log('handleUpdateUser - editingUser:', editingUser);
    console.log('handleUpdateUser - formData:', data);
    console.log('handleUpdateUser - updateData:', updateData);
    
    if (Object.keys(updateData).length === 0) {
      toast({
        title: '알림',
        description: '변경된 내용이 없습니다.',
      });
      return;
    }
    
    // accountType에 따라 적절한 mutation 호출
    if (editingUser.accountType === 'admin') {
      updateAdminMutation.mutate({ id: editingUser.id, data: updateData });
    } else if (editingUser.accountType === 'sales_manager') {
      updateSalesManagerMutation.mutate({ id: editingUser.id, ...updateData });
    } else {
      updateUserMutation.mutate({ id: editingUser.id, data: updateData });
    }
  };

  const openEditUserDialog = (user: any) => {
    console.log('openEditUserDialog - user:', user);
    setEditingUser(user);
    editUserForm.reset({
      username: user.username || '',
      password: '',
      name: user.name || '',
      role: user.role || user.userType || 'worker',
      userType: user.userType || 'user',
      team: user.team || '',
      allowedCarriers: user.allowedCarriers || [],
    });
    setEditUserDialogOpen(true);
  };

  // 관리자 삭제 mutation
  const deleteAdminMutation = useMutation({
    mutationFn: (adminId: number) => apiRequest(`/api/admin/admins/${adminId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/admins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({
        title: "삭제 완료",
        description: "관리자가 성공적으로 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "관리자 삭제에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  // 사용자 삭제 함수
  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => apiRequest(`/api/admin/users/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/admins'] });
      toast({
        title: "삭제 완료",
        description: "사용자가 성공적으로 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "사용자 삭제에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleDeleteUser = async (userToDelete: any) => {
    if (confirm(`정말로 "${userToDelete.displayName || userToDelete.name}" 계정을 삭제하시겠습니까?`)) {
      // accountType으로 먼저 체크
      if (userToDelete.accountType === 'admin') {
        deleteAdminMutation.mutate(userToDelete.id);
      } else if (userToDelete.accountType === 'sales_manager') {
        deleteSalesManagerMutation.mutate(userToDelete.id);
      } else {
        deleteUserMutation.mutate(userToDelete.id);
      }
    }
  };

  // 접점코드 엑셀 업로드 뮤테이션
  const contactCodeExcelUploadMutation = useMutation({
    mutationFn: async ({ file, forceUpdate }: { file: File; forceUpdate: boolean }) => {
      setContactCodeUploadProgress(0);
      return uploadWithProgress(
        file,
        '/api/admin/contact-codes/bulk-upload',
        setContactCodeUploadProgress,
        { forceUpdate: String(forceUpdate) }
      );
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
      
      let description = `${data.processed || 0}개의 접점코드가 성공적으로 추가되었습니다.`;
      if (data.duplicatesSkipped > 0) {
        description += ` (${data.duplicatesSkipped}개 중복건 제외)`;
      }
      if (data.errors && data.errors.length > 0) {
        description += `\n\n오류가 발생한 행:\n${data.errors.join('\n')}`;
      }
      
      toast({
        title: "업로드 완료",
        description: description,
      });
      // 파일 입력 초기화
      if (contactCodeExcelInputRef.current) {
        contactCodeExcelInputRef.current.value = '';
      }
    },
    onError: (error: any) => {
      console.error('Contact code upload error:', error);
      
      let description = error.message || "접점코드 업로드에 실패했습니다.";
      
      // 상세 에러 정보 추가
      if (error.details) {
        if (Array.isArray(error.details)) {
          const errorCount = error.totalErrors || error.details.length;
          description += `\n\n오류 발생 (총 ${errorCount}건):\n${error.details.slice(0, 5).join('\n')}`;
          if (errorCount > 5) {
            description += `\n... 외 ${errorCount - 5}건 더`;
          }
        } else {
          description += `\n\n오류 상세: ${error.details}`;
        }
      }
      
      // 중복 접점코드 오류인 경우 안내 메시지 추가
      if (description.includes('이미 존재합니다')) {
        description += '\n\n💡 팁: 동일한 파일을 다시 업로드하면 중복 오류가 발생합니다.';
      }
      
      toast({
        title: "업로드 실패",
        description: description,
        variant: "destructive"
      });
      // 파일 입력 초기화
      if (contactCodeExcelInputRef.current) {
        contactCodeExcelInputRef.current.value = '';
      }
    }
  });

  // 엑셀 업로드 뮤테이션
  const excelUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      return apiRequest('/api/admin/contact-codes/bulk-upload', {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: () => {
      toast({
        title: "업로드 완료",
        description: "접점 코드가 성공적으로 업로드되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealers'] });
      // 모든 대리점의 접점 코드 쿼리를 무효화
      dealers?.forEach(dealer => {
        queryClient.invalidateQueries({ queryKey: [`/api/dealers/${dealer.id}/contact-codes`] });
      });
    },
    onError: (error: any) => {
      toast({
        title: "업로드 실패",
        description: error.message || "접점 코드 업로드에 실패했습니다.",
        variant: "destructive"
      });
    }
  });

  const handleExcelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      excelUploadMutation.mutate(file);
    }
    // 파일 입력 초기화
    if (excelFileInputRef.current) {
      excelFileInputRef.current.value = '';
    }
  };

  const handleCreateAdmin = (data: CreateAdminForm) => {
    createAdminMutation.mutate(data);
  };

  const handleCreateWorker = (data: CreateWorkerForm) => {
    createWorkerMutation.mutate(data);
  };

  const handleCreateSalesManager = (data: CreateSalesManagerForm) => {
    createSalesManagerMutation.mutate(data);
  };

  const handleEditSalesManager = (manager: any) => {
    console.log('handleEditSalesManager called with:', manager);
    setEditingManager(manager);
    editSalesManagerForm.reset({
      teamId: manager.teamId || 1,
      managerName: manager.displayName || manager.name || '',
      managerCode: manager.managerCode || '',
      username: manager.username || '',
      password: '',
      position: manager.position || '과장',
      contactPhone: manager.contactPhone || '',
      email: manager.email || '',
    });
    console.log('Setting editSalesManagerDialogOpen to true');
    setEditSalesManagerDialogOpen(true);
  };

  const handleUpdateSalesManager = (data: UpdateSalesManagerForm) => {
    if (editingManager) {
      updateSalesManagerMutation.mutate({ ...data, id: editingManager.id });
    }
  };

  const handleEditUser = (userToEdit: any) => {
    setSelectedUser(userToEdit);
    setEditUserDialogOpen(true);
  };

  const handleChangePassword = (userToEdit: any) => {
    setSelectedUser(userToEdit);
    setChangePasswordDialogOpen(true);
  };



  // Analytics handlers
  const handleWorkerClick = async (worker: { id: number; name: string }) => {
    setSelectedWorker(worker);
    try {
      const response = await apiRequest(`/api/admin/worker-details/${worker.id}`);
      setWorkerCarrierDetails(response);
      setWorkerDetailsOpen(true);
    } catch (error) {
      toast({
        title: '오류',
        description: '근무자 상세 정보를 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  const handleCarrierClick = async (carrier: string) => {
    setSelectedCarrier(carrier);
    try {
      const response = await apiRequest(`/api/admin/carrier-details/${carrier}`);
      setCarrierDealerDetails(response);
      setCarrierDetailsOpen(true);
    } catch (error) {
      toast({
        title: '오류',
        description: '통신사 상세 정보를 불러오는데 실패했습니다.',
        variant: 'destructive',
      });
    }
  };

  const createServicePlanMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/admin/service-plans', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
      setServicePlanDialogOpen(false);
      servicePlanForm.reset();
      toast({
        title: '성공',
        description: '요금제가 성공적으로 생성되었습니다.',
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
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/admin/service-plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
      setEditServicePlanDialogOpen(false);
      setEditingServicePlan(null);
      editServicePlanForm.reset();
      toast({
        title: '성공',
        description: '요금제가 성공적으로 수정되었습니다.',
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

  const deleteServicePlanMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/service-plans/${id}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
      toast({
        title: '성공',
        description: '요금제가 성공적으로 삭제되었습니다.',
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

  const createAdditionalServiceMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/admin/additional-services', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/additional-services'] });
      setAdditionalServiceDialogOpen(false);
      additionalServiceForm.reset();
      toast({
        title: '성공',
        description: '부가서비스가 성공적으로 생성되었습니다.',
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

  const updateAdditionalServiceMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/admin/additional-services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/additional-services'] });
      setEditAdditionalServiceDialogOpen(false);
      setEditingAdditionalService(null);
      editAdditionalServiceForm.reset();
      toast({
        title: '성공',
        description: '부가서비스가 성공적으로 수정되었습니다.',
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

  const deleteAdditionalServiceMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/additional-services/${id}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/additional-services'] });
      toast({
        title: '성공',
        description: '부가서비스가 성공적으로 삭제되었습니다.',
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

  // Service Plan Excel Upload Mutation
  const servicePlanExcelMutation = useMutation({
    mutationFn: async (file: File) => {
      setServicePlanUploadProgress(0);
      return uploadWithProgress(
        file,
        '/api/admin/service-plans/upload-excel',
        setServicePlanUploadProgress
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
      // 파일 입력 초기화
      const fileInput = document.querySelector('#service-plan-excel') as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
      
      let description = `${result.addedPlans || 0}개의 요금제가 성공적으로 추가되었습니다.`;
      if (result.duplicatesSkipped > 0) {
        description += ` (${result.duplicatesSkipped}개 중복건 제외)`;
      }
      
      toast({
        title: '업로드 완료',
        description,
      });
    },
    onError: (error: Error) => {
      toast({
        title: '업로드 실패',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const servicePlanImageMutation = useMutation({
    mutationFn: async (data: { carrier: string; file: File }) => {
      setImageUploadProgress(0);
      return uploadWithProgress(
        data.file,
        '/api/admin/service-plans/upload-image',
        setImageUploadProgress,
        { carrier: data.carrier }
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
      setServicePlanImageForm({ carrier: '', file: null });
      toast({
        title: '성공',
        description: `${result.addedPlans}개의 요금제가 추가되었습니다.`,
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

  // Contact Code Mutations
  const createContactCodeMutation = useMutation({
    mutationFn: (data: { code: string; dealerName: string; carrier: string; salesManagerId?: number | null; salesManagerName?: string | null }) => 
      apiRequest('/api/admin/contact-codes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
      setContactCodeDialogOpen(false);
      setNewContactCode('');
      setNewDealerName('');
      setNewCarrier('');
      setNewSalesManagerName('');
      toast({
        title: '성공',
        description: '접점코드가 성공적으로 생성되었습니다.',
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

  const deleteContactCodeMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/contact-codes/${id}`, {
      method: 'DELETE',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
      toast({
        title: '성공',
        description: '접점코드가 성공적으로 삭제되었습니다.',
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

  // Settlement Unit Pricing Mutations
  const createSettlementPriceMutation = useMutation({
    mutationFn: (data: CreateSettlementUnitPriceForm) => apiRequest('/api/admin/settlement-unit-prices', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement-unit-prices'] });
      setSettlementPriceDialogOpen(false);
      settlementPriceForm.reset();
      toast({
        title: '성공',
        description: '정산단가가 성공적으로 설정되었습니다.',
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

  const updateSettlementPriceMutation = useMutation({
    mutationFn: ({ servicePlanId, data }: { servicePlanId: number; data: UpdateSettlementUnitPriceForm }) => 
      apiRequest(`/api/admin/settlement-unit-prices/${servicePlanId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement-unit-prices'] });
      setSettlementPriceDialogOpen(false);
      settlementPriceForm.reset();
      toast({
        title: '성공',
        description: '정산단가가 성공적으로 수정되었습니다.',
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

  const handleCreateServicePlan = (data: any) => {
    createServicePlanMutation.mutate(data);
  };

  const openEditServicePlanDialog = (plan: ServicePlan) => {
    setEditingServicePlan(plan);
    editServicePlanForm.reset({
      name: plan.name,
      carrier: plan.carrier,
      planType: plan.planType,
      dataAllowance: plan.dataAllowance,
      monthlyFee: plan.monthlyFee,
      combinationEligible: plan.combinationEligible || false,
      isActive: plan.isActive,
    });
    setEditServicePlanDialogOpen(true);
  };

  const handleUpdateServicePlan = (data: any) => {
    if (editingServicePlan) {
      updateServicePlanMutation.mutate({ id: editingServicePlan.id, data });
    }
  };

  const handleDeleteServicePlan = (id: number) => {
    if (confirm('정말로 이 요금제를 삭제하시겠습니까?')) {
      deleteServicePlanMutation.mutate(id);
    }
  };

  const handleCreateAdditionalService = (data: any) => {
    createAdditionalServiceMutation.mutate(data);
  };

  const openEditAdditionalServiceDialog = (service: AdditionalService) => {
    setEditingAdditionalService(service);
    editAdditionalServiceForm.reset({
      serviceName: service.serviceName,
      serviceType: service.serviceType,
      monthlyFee: service.monthlyFee,
      description: service.description,
      isActive: service.isActive,
    });
    setEditAdditionalServiceDialogOpen(true);
  };

  const handleUpdateAdditionalService = (data: any) => {
    if (editingAdditionalService) {
      updateAdditionalServiceMutation.mutate({ id: editingAdditionalService.id, data });
    }
  };

  const handleDeleteAdditionalService = (id: number) => {
    if (confirm('정말로 이 부가서비스를 삭제하시겠습니까?')) {
      deleteAdditionalServiceMutation.mutate(id);
    }
  };

  const handleDownloadServicePlanTemplate = () => {
    // Create Excel template for service plans
    const template = [
      ['요금제명', '통신사', '요금제유형', '데이터제공량', '월요금(원)', '결합가능', '활성여부'],
      ['선)363/1M', 'SK텔링크', 'LTE', '1GB', '36300', 'FALSE', 'TRUE'],
      ['중외)5G 웰컴 5', 'KT엠모바일', '5G', '5GB', '0', 'TRUE', 'TRUE'],
      ['미)이동의즐거움 K', 'LG미디어로그', 'LTE', '무제한', '0', 'FALSE', 'TRUE']
    ];
    
    const csvContent = template.map(row => row.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '요금제_업로드_양식.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast({
      title: '다운로드 완료',
      description: '요금제 업로드 양식이 다운로드되었습니다.',
    });
  };

  const handleServicePlanImageSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!servicePlanImageForm.carrier || !servicePlanImageForm.file) {
      toast({
        title: '오류',
        description: '통신사와 파일을 모두 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }

    servicePlanImageMutation.mutate({
      carrier: servicePlanImageForm.carrier,
      file: servicePlanImageForm.file
    });
  };

  // Contact Code Handlers
  const handleCreateContactCode = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newContactCode || !newDealerName || !newCarrier || !newSalesManagerName) {
      toast({
        title: '오류',
        description: '접점코드, 판매점명, 통신사, 담당 영업과장을 모두 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    createContactCodeMutation.mutate({
      code: newContactCode,
      dealerName: newDealerName,
      carrier: newCarrier,
      salesManagerId: null,
      salesManagerName: newSalesManagerName,
      realSalesPOS: newRealSalesPOS,
    } as any, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
        // 폼 초기화
        setNewContactCode('');
        setNewDealerName('');
        setNewRealSalesPOS('');
        setNewCarrier('');
        setNewSalesManagerName('');
        setContactCodeDialogOpen(false);
      }
    });
  };

  const handleDeleteContactCode = (id: number) => {
    if (confirm('정말로 이 접점코드를 삭제하시겠습니까?')) {
      deleteContactCodeMutation.mutate(id);
    }
  };

  // 접점코드 체크박스 관련 함수들
  const handleSelectContactCode = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedContactCodes(prev => [...prev, id]);
    } else {
      setSelectedContactCodes(prev => prev.filter(codeId => codeId !== id));
    }
  };

  const handleSelectAllContactCodes = (checked: boolean) => {
    setSelectAllContactCodes(checked);
    if (checked) {
      const allIds = filteredContactCodes?.map(code => code.id).filter((id): id is number => id !== undefined) || [];
      setSelectedContactCodes(allIds);
    } else {
      setSelectedContactCodes([]);
    }
  };

  // 선택된 접점코드들 삭제
  const handleDeleteSelectedContactCodes = async () => {
    if (selectedContactCodes.length === 0) return;
    
    if (confirm(`선택된 ${selectedContactCodes.length}개의 접점코드를 삭제하시겠습니까?`)) {
      try {
        await Promise.all(
          selectedContactCodes.map(id => 
            apiRequest(`/api/admin/contact-codes/${id}`, { method: 'DELETE' })
          )
        );
        
        queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
        setSelectedContactCodes([]);
        setSelectAllContactCodes(false);
        
        toast({
          title: "삭제 완료",
          description: `${selectedContactCodes.length}개의 접점코드가 삭제되었습니다.`,
        });
      } catch (error: any) {
        toast({
          title: "삭제 실패",
          description: error.message || "접점코드 삭제에 실패했습니다.",
          variant: "destructive"
        });
      }
    }
  };

  // 접점코드 필터링
  const filteredContactCodes = contactCodes?.filter(code => {
    const matchesSearch = !contactCodeSearch || 
      (code.code && code.code.toLowerCase().includes(contactCodeSearch.toLowerCase())) ||
      (code.dealerName && code.dealerName.toLowerCase().includes(contactCodeSearch.toLowerCase())) ||
      ((code as any).salesManagerName && (code as any).salesManagerName.toLowerCase().includes(contactCodeSearch.toLowerCase()));
    
    const matchesCarrier = !contactCodeCarrierFilter || 
      contactCodeCarrierFilter === 'all' || 
      (code.carrier && code.carrier === contactCodeCarrierFilter);
    
    return matchesSearch && matchesCarrier;
  });

  // 서비스 플랜 체크박스 관련 함수들
  const handleSelectServicePlan = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedServicePlans(prev => [...prev, id]);
    } else {
      setSelectedServicePlans(prev => prev.filter(planId => planId !== id));
    }
  };

  const handleSelectAllServicePlans = (checked: boolean) => {
    setSelectAllServicePlans(checked);
    if (checked) {
      const allIds = filteredServicePlans?.map(plan => plan.id).filter(Boolean) || [];
      setSelectedServicePlans(allIds);
    } else {
      setSelectedServicePlans([]);
    }
  };

  // 선택된 서비스 플랜들 삭제
  const handleDeleteSelectedServicePlans = async () => {
    if (selectedServicePlans.length === 0) return;
    
    if (confirm(`선택된 ${selectedServicePlans.length}개의 서비스 플랜을 삭제하시겠습니까?`)) {
      try {
        await Promise.all(
          selectedServicePlans.map(id => 
            apiRequest(`/api/admin/service-plans/${id}`, { method: 'DELETE' })
          )
        );
        
        queryClient.invalidateQueries({ queryKey: ['/api/admin/service-plans'] });
        setSelectedServicePlans([]);
        setSelectAllServicePlans(false);
        
        toast({
          title: "삭제 완료",
          description: `${selectedServicePlans.length}개의 서비스 플랜이 삭제되었습니다.`,
        });
      } catch (error: any) {
        toast({
          title: "삭제 실패",
          description: error.message || "서비스 플랜 삭제에 실패했습니다.",
          variant: "destructive"
        });
      }
    }
  };

  // 서비스 플랜 필터링
  const filteredServicePlans = servicePlans?.filter(plan => {
    const matchesSearch = !servicePlanSearch || 
      plan.name.toLowerCase().includes(servicePlanSearch.toLowerCase()) ||
      plan.carrier.toLowerCase().includes(servicePlanSearch.toLowerCase());
    
    const matchesCarrier = !servicePlanCarrierFilter || servicePlanCarrierFilter === 'all' || plan.carrier === servicePlanCarrierFilter;
    
    return matchesSearch && matchesCarrier;
  });



  const handleContactCodeExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log('🚀 Starting upload with forceUpdate:', forceUpdateContactCodes);
      contactCodeExcelUploadMutation.mutate({ file, forceUpdate: forceUpdateContactCodes });
    }
  };

  const handleSettlementPricingExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      settlementPricingExcelUploadMutation.mutate(file);
    }
  };

  const handleDownloadSettlementPricingTemplate = () => {
    // 정산단가 엑셀 템플릿 생성
    const csvContent = '\uFEFF' + // BOM for Excel UTF-8 recognition
      '통신사,요금제명,정산단가\n' +
      'SK텔링크,5G100K-스페셜,50000\n' +
      'KT엠모바일,5G110K-셀프,45000\n' +
      'LG미디어로그,LTE베이직,30000\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '정산단가_업로드_양식.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Settlement unit pricing handlers
  const onSubmitSettlementPrice = (data: CreateSettlementUnitPriceForm) => {
    console.log('Settlement price form submitted:', data);
    console.log('Selected service plan:', selectedServicePlan);
    
    if (!selectedServicePlan) {
      toast({
        title: '오류',
        description: '요금제를 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }
    
    const currentPrice = settlementPrices?.find(p => p.servicePlanId === selectedServicePlan.id);
    console.log('Current price:', currentPrice);
    
    if (currentPrice) {
      // Update existing price
      console.log('Updating existing price');
      updateSettlementPriceMutation.mutate({
        servicePlanId: selectedServicePlan.id,
        data: {
          newCustomerPrice: data.newCustomerPrice,
          portInPrice: data.portInPrice,
          hiddenPrice: data.hiddenPrice || 0,
          memo: data.memo,
        }
      });
    } else {
      // Create new price
      console.log('Creating new price with data:', {
        servicePlanId: selectedServicePlan.id,
        newCustomerPrice: data.newCustomerPrice,
        portInPrice: data.portInPrice,
        memo: data.memo,
      });
      createSettlementPriceMutation.mutate({
        servicePlanId: selectedServicePlan.id,
        newCustomerPrice: data.newCustomerPrice,
        portInPrice: data.portInPrice,
        hiddenPrice: data.hiddenPrice || 0,
        memo: data.memo,
      });
    }
  };

  const handleDownloadTemplate = () => {
    // 접점코드 엑셀 템플릿 생성
    const templateData = [
      {
        '접점코드': 'LDI672346',
        '판매점명': '샘플판매점',
        '실판매POS': '실POS명1',
        '통신사': 'LG미디어로그',
        '담당영업과장': '황병준'
      },
      {
        '접점코드': 'SKT123456',
        '판매점명': '테스트판매점',
        '실판매POS': '',
        '통신사': 'SK텔링크',
        '담당영업과장': '김영수'
      }
    ];

    // CSV 형태로 다운로드
    const csvContent = '\uFEFF' + // BOM for Excel UTF-8 recognition
      '접점코드,판매점명,실판매POS,통신사,담당영업과장\n' +
      'LDI672346,샘플판매점,실POS명1,LG미디어로그,황병준\n' +
      'SKT123456,테스트판매점,,SK텔링크,김영수\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '접점코드_업로드_양식.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadDealerTemplate = () => {
    // 판매점 엑셀 템플릿 생성
    const csvContent = '\uFEFF' + // BOM for Excel UTF-8 recognition
      '사업체명,대표자명,사업자번호,아이디,비밀번호,연락처이메일,연락처전화번호,위치,SK접점코드,KT접점코드,LGU+접점코드\n' +
      '샘플판매점1,홍길동,123-45-67890,dealer1,password123,dealer1@example.com,010-1234-5678,서울시 강남구,SK12345,KT67890,LG11111\n' +
      '테스트판매점2,김철수,234-56-78901,dealer2,password456,,010-9876-5432,부산시 해운대구,,KT54321,LG22222\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', '판매점_업로드_양식.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDealerExcelUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      dealerExcelUploadMutation.mutate(file);
    }
    if (dealerExcelInputRef.current) {
      dealerExcelInputRef.current.value = '';
    }
  };

  // 엑셀 다운로드 mutation
  const exportMutation = useMutation({
    mutationFn: async () => {
      const sessionId = useAuth.getState().sessionId;
      const headers: Record<string, string> = {};
      if (sessionId) {
        headers['Authorization'] = `Bearer ${sessionId}`;
      }
      
      const response = await fetch(`/api/admin/export/activated-documents?startDate=${exportStartDate}&endDate=${exportEndDate}`, {
        method: 'GET',
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: '엑셀 파일 생성에 실패했습니다.' }));
        throw new Error(error.error || '엑셀 파일 생성에 실패했습니다.');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `개통서류_${exportStartDate}_${exportEndDate}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onSuccess: () => {
      toast({
        title: '성공',
        description: '엑셀 파일이 다운로드되었습니다.',
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

  const handleExportActivatedDocuments = () => {
    if (!exportStartDate || !exportEndDate) {
      toast({
        title: '오류',
        description: '시작일과 종료일을 선택해주세요.',
        variant: 'destructive',
      });
      return;
    }
    exportMutation.mutate();
  };

  const handleTemplateDownload = async (templateId: number, fileName: string) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch(`/api/document-templates/${templateId}/download`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
      });

      if (!response.ok) {
        throw new Error('다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "다운로드 완료",
        description: `${fileName} 파일이 다운로드되었습니다.`,
      });
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: error instanceof Error ? error.message : "파일 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };

  const handlePricingDownload = async (tableId: number, fileName: string) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch(`/api/files/pricing/${tableId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
      });

      if (!response.ok) {
        throw new Error('파일 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "다운로드 완료",
        description: `${fileName} 파일이 다운로드되었습니다.`,
      });
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: error instanceof Error ? error.message : "파일 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
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

  const handleDocumentDownload = async (documentId: number, fileName: string) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch(`/api/files/documents/${documentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${sessionId}`
        },
      });

      if (!response.ok) {
        throw new Error('파일 다운로드에 실패했습니다.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "다운로드 완료",
        description: `파일이 다운로드되었습니다.`,
      });
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: error instanceof Error ? error.message : "파일 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  };



  const handleUploadTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 파일 업로드는 선택사항으로 변경됨

    const formData = new FormData();
    if (templateFile) {
      formData.append('file', templateFile);
      formData.append('title', templateTitle || templateFile.name);
    } else {
      formData.append('title', templateTitle || 'untitled');
    }
    formData.append('category', templateCategory);

    uploadTemplateMutation.mutate(formData);
  };

  const handleUpdateStatus = (data: UpdateDocumentStatusForm) => {
    if (selectedDocument) {
      const updateData: any = {
        status: data.status,
        activationStatus: data.activationStatus,
        notes: data.notes,
      };
      
      // 개통 상태로 변경 시 개통 시각과 처리자 추가
      if (data.activationStatus === '개통') {
        updateData.activatedAt = new Date().toISOString();
        updateData.activatedBy = user?.id;
      }
      
      updateDocumentStatusMutation.mutate({ id: selectedDocument.id, data: updateData });
    }
  };

  const openStatusDialog = (document: Document) => {
    setSelectedDocument(document);
    statusForm.setValue('status', document.status);
    statusForm.setValue('activationStatus', (document as any).activationStatus || '대기');
    statusForm.setValue('notes', document.notes || '');
    setStatusDialogOpen(true);
  };

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

  const getActivationStatusBadge = (status: string) => {
    switch (status) {
      case '대기':
        return <Badge variant="outline" className="text-yellow-600 border-yellow-600">대기</Badge>;
      case '개통':
        return <Badge variant="outline" className="text-green-600 border-green-600">개통</Badge>;
      case '취소':
        return <Badge variant="outline" className="text-red-600 border-red-600">취소</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case '접수':
        return <Clock className="h-4 w-4 text-warning" />;
      case '완료':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case '보완필요':
        return <AlertTriangle className="h-4 w-4 text-destructive" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  return (
    <Layout title="관리자 패널">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-gray-900">시스템 관리</h3>
            <p className="text-sm text-gray-500">
              대리점, 사용자, 서류 및 단가표를 관리할 수 있습니다.
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <Settings className="h-5 w-5 text-gray-400" />
            <span className="text-sm text-gray-500">관리자 전용</span>
          </div>
        </div>

        {/* Admin Tabs */}
        <Tabs defaultValue={actualDefaultTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-12">
            <TabsTrigger value="contact-codes" className="flex items-center space-x-2">
              <Settings className="h-4 w-4" />
              <span>접점코드</span>
            </TabsTrigger>
            <TabsTrigger value="other-business-carriers" className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>기타업무통신사</span>
            </TabsTrigger>
            <TabsTrigger value="carriers" className="flex items-center space-x-2">
              <Building2 className="h-4 w-4" />
              <span>통신사</span>
            </TabsTrigger>
            <TabsTrigger value="dealers" className="flex items-center space-x-2">
              <Building2 className="h-4 w-4" />
              <span>판매점 관리</span>
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center space-x-2">
              <Users className="h-4 w-4" />
              <span>사용자 관리</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>서류 관리</span>
            </TabsTrigger>
            <TabsTrigger value="service-plans" className="flex items-center space-x-2">
              <Settings className="h-4 w-4" />
              <span>서비스 플랜</span>
            </TabsTrigger>
            <TabsTrigger value="workers" className="flex items-center space-x-2">
              <TrendingUp className="h-4 w-4" />
              <span>근무자 통계</span>
            </TabsTrigger>
            <TabsTrigger value="templates" className="flex items-center space-x-2">
              <Upload className="h-4 w-4" />
              <span>서식지 관리</span>
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex items-center space-x-2">
              <Calculator className="h-4 w-4" />
              <span>정산단가</span>
            </TabsTrigger>
            <TabsTrigger value="hidden-pricing" className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4" />
              <span>히든단가</span>
            </TabsTrigger>
          </TabsList>



          {/* Contact Codes Tab */}
          <TabsContent value="contact-codes">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>접점코드 관리</CardTitle>
                  <CardDescription>
                    개통방명 코드를 관리하여 자동으로 판매점명이 설정되도록 합니다.
                  </CardDescription>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="forceUpdateContactCodes"
                      checked={forceUpdateContactCodes}
                      onCheckedChange={(checked) => setForceUpdateContactCodes(checked === true)}
                    />
                    <Label htmlFor="forceUpdateContactCodes" className="text-sm">
                      기존 접점코드 강제 업데이트 (영업과장 매핑 변경 시)
                    </Label>
                  </div>
                  <div className="space-y-3">
                    <div className="space-x-2">
                      <input
                        ref={contactCodeExcelInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleContactCodeExcelUpload}
                        className="hidden"
                      />
                      <Button
                        variant="outline"
                        onClick={handleDownloadTemplate}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        양식 다운로드
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => contactCodeExcelInputRef.current?.click()}
                        disabled={contactCodeExcelUploadMutation.isPending}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {contactCodeExcelUploadMutation.isPending ? '업로드 중...' : '엑셀/CSV 업로드'}
                      </Button>
                    </div>
                    {contactCodeExcelUploadMutation.isPending && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>업로드 진행률</span>
                          <span>{contactCodeUploadProgress}%</span>
                        </div>
                        <Progress value={contactCodeUploadProgress} className="w-full" />
                      </div>
                    )}
                  </div>
                </div>
                <Dialog open={contactCodeDialogOpen} onOpenChange={setContactCodeDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" />
                      접점코드 추가
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                      <DialogHeader>
                        <DialogTitle>새 접점코드 추가</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleCreateContactCode} className="space-y-4">
                        <div className="relative">
                          <Label htmlFor="contactCodeInput">접점코드</Label>
                          <div className="relative">
                            <Input
                              id="contactCodeInput"
                              value={newContactCode}
                              onChange={(e) => handleNewContactCodeChange(e.target.value)}
                              onFocus={() => {
                                if (contactCodeSuggestions.length > 0) {
                                  setShowContactCodeSuggestions(true);
                                }
                              }}
                              onBlur={() => {
                                // 잠시 지연 후 숨기기 (클릭 이벤트가 먼저 실행되도록)
                                setTimeout(() => setShowContactCodeSuggestions(false), 200);
                              }}
                              placeholder="접점코드를 입력하여 검색..."
                              required
                              data-testid="input-new-contact-code"
                            />
                            
                            {/* 검색 제안 드롭다운 */}
                            {showContactCodeSuggestions && contactCodeSuggestions.length > 0 && (
                              <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-y-auto">
                                {contactCodeSuggestions.map((suggestion, index) => (
                                  <div
                                    key={index}
                                    className="px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                                    onClick={() => selectContactCodeSuggestion(suggestion)}
                                    data-testid={`suggestion-contact-code-${index}`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex flex-col">
                                        <span className="font-medium text-gray-900 dark:text-gray-100">
                                          {suggestion.code}
                                        </span>
                                        <span className="text-sm text-gray-500 dark:text-gray-400">
                                          {suggestion.dealerName}
                                        </span>
                                      </div>
                                      <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                                        {suggestion.carrier}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="dealerName">판매점명</Label>
                          <Input
                            id="dealerName"
                            value={newDealerName}
                            onChange={(e) => setNewDealerName(e.target.value)}
                            placeholder="판매점명을 입력하세요"
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="realSalesPOS">실판매POS</Label>
                          <Input
                            id="realSalesPOS"
                            value={newRealSalesPOS}
                            onChange={(e) => setNewRealSalesPOS(e.target.value)}
                            placeholder="실판매POS를 입력하세요"
                          />
                        </div>
                        <div>
                          <Label htmlFor="carrier">통신사</Label>
                          <Select value={newCarrier} onValueChange={setNewCarrier}>
                            <SelectTrigger>
                              <SelectValue placeholder="통신사를 선택하세요" />
                            </SelectTrigger>
                            <SelectContent>
                              {carriersList && carriersList.map((carrier: any) => (
                                <SelectItem key={carrier.id} value={carrier.name}>
                                  {carrier.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="salesManager">담당 영업과장 *</Label>
                          <Input
                            id="salesManager"
                            value={newSalesManagerName}
                            onChange={(e) => setNewSalesManagerName(e.target.value)}
                            placeholder="담당 영업과장 이름을 입력하세요"
                            required
                          />
                        </div>
                        <div className="flex justify-end space-x-2">
                          <Button type="button" variant="outline" onClick={() => setContactCodeDialogOpen(false)}>
                            취소
                          </Button>
                          <Button type="submit" disabled={createContactCodeMutation.isPending}>
                            {createContactCodeMutation.isPending ? '생성 중...' : '생성'}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
              </CardHeader>
              <CardContent>
                {/* 검색 및 필터 */}
                <div className="mb-6 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                      <Input
                        placeholder="접점코드, 판매점명, 담당자명으로 검색..."
                        value={contactCodeSearch}
                        onChange={(e) => setContactCodeSearch(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="w-full sm:w-48">
                      <Select value={contactCodeCarrierFilter} onValueChange={setContactCodeCarrierFilter}>
                        <SelectTrigger>
                          <SelectValue placeholder="통신사 필터" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">전체 통신사</SelectItem>
                          {carriersList && carriersList.map((carrier: any) => (
                            <SelectItem key={carrier.id} value={carrier.name}>
                              {carrier.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* 선택된 항목 삭제 버튼 */}
                  {selectedContactCodes.length > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                      <span className="text-sm text-red-700 dark:text-red-300">
                        {selectedContactCodes.length}개 항목 선택됨
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleDeleteSelectedContactCodes}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        선택 항목 삭제
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">엑셀 업로드 사용법</h4>
                  <div className="text-sm text-blue-700 dark:text-blue-300">
                    <p className="mb-2">1. 위의 "양식 다운로드" 버튼을 클릭하여 템플릿을 다운로드하세요.</p>
                    <p className="mb-2">2. 다운로드한 파일에 접점코드 데이터를 입력하세요:</p>
                    <ul className="list-disc list-inside ml-4 space-y-1 mb-2">
                      <li><strong>접점코드</strong>: 고유한 접점 코드 (예: 구)이다글로벌)</li>
                      <li><strong>판매점명</strong>: 판매점 이름</li>
                      <li><strong>실판매POS</strong>: 실제 판매 POS명 (선택사항)</li>
                      <li><strong>통신사</strong>: 통신사명 (예: 후불)중고KT)</li>
                      <li><strong>담당영업과장</strong>: 담당 영업과장명</li>
                    </ul>
                    <p>3. 작성이 완료되면 "엑셀 업로드" 버튼을 클릭하여 파일을 업로드하세요.</p>
                  </div>
                </div>
                
                {contactCodesLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-500">접점코드 로딩 중...</p>
                  </div>
                ) : filteredContactCodes && filteredContactCodes.length > 0 ? (
                  <div className="space-y-4">
                    {/* 전체 선택 체크박스 */}
                    <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <input
                        type="checkbox"
                        id="selectAllContactCodes"
                        checked={selectAllContactCodes}
                        onChange={(e) => handleSelectAllContactCodes(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="selectAllContactCodes" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        전체 선택 ({filteredContactCodes.length}개)
                      </label>
                    </div>

                    <div className="max-h-[600px] overflow-y-auto border border-gray-200 rounded-lg p-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredContactCodes.map((code) => (
                        <div key={code.id} className="border rounded-lg p-4 bg-white dark:bg-gray-900 relative">
                          {/* 체크박스 */}
                          <div className="absolute top-2 left-2">
                            <input
                              type="checkbox"
                              checked={selectedContactCodes.includes(code.id || 0)}
                              onChange={(e) => handleSelectContactCode(code.id || 0, e.target.checked)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                          </div>

                          <div className="ml-6">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <h4 className="font-medium text-gray-900 dark:text-gray-100">{code.code}</h4>
                                <p className="text-sm text-gray-500 dark:text-gray-400">{code.dealerName}</p>
                                {(code as any).realSalesPOS && (
                                  <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                                    실판매POS: {(code as any).realSalesPOS}
                                  </p>
                                )}
                                {(code as any).salesManagerName && (
                                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                    담당: {(code as any).salesManagerName}
                                  </p>
                                )}
                                {/* 연결된 판매점 아이디 표시 */}
                                {(() => {
                                  const relatedDealer = dealers?.find((dealer: any) => 
                                    dealer.businessName === code.dealerName || dealer.representativeName === code.dealerName
                                  );
                                  return relatedDealer ? (
                                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                      판매점 ID: {relatedDealer.username}
                                    </p>
                                  ) : null;
                                })()}
                              </div>
                              <Badge variant="outline">{code.carrier}</Badge>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                code.isActive 
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                              }`}>
                                {code.isActive ? '활성' : '비활성'}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteContactCode(code.id || 0)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : contactCodes && contactCodes.length > 0 ? (
                  <div className="text-center py-8">
                    <Settings className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">검색 결과가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">다른 검색어를 시도해보세요.</p>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Settings className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">접점코드가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">첫 번째 접점코드를 추가해보세요.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Other Business Carriers Tab */}
          <TabsContent value="other-business-carriers">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>기타업무통신사 관리</CardTitle>
                  <CardDescription className="space-y-2">
                    <div>기타 신청과 연결되는 업무 요청점을 관리합니다.</div>
                    <div className="text-sm text-blue-600 dark:text-blue-400">
                      💡 <strong>엑셀 업로드 가이드:</strong> 
                      <br />• 파일 형식: .xlsx 또는 .xls 파일만 가능
                      <br />• 필수 컬럼: '업무 요청점' (또는 '업무요청점', '요청점')
                      <br />• 선택 컬럼: '메모' (또는 '비고')
                      <br />• 중복된 업무 요청점은 자동으로 제외됩니다
                      <br />• 다운로드 버튼으로 현재 데이터를 엑셀로 받을 수 있습니다
                    </div>
                  </CardDescription>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    {/* Excel 업로드 */}
                    <input
                      ref={otherBusinessCarrierExcelInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          otherBusinessCarrierExcelUploadMutation.mutate(file);
                        }
                      }}
                      style={{ display: 'none' }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => otherBusinessCarrierExcelInputRef.current?.click()}
                      disabled={otherBusinessCarrierExcelUploadMutation.isPending}
                      data-testid="button-upload-excel-other-business-carriers"
                    >
                      {otherBusinessCarrierExcelUploadMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      Excel 업로드
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleOtherBusinessCarrierExcelDownload}
                      disabled={otherBusinessCarrierExcelDownloadMutation.isPending}
                      data-testid="button-download-excel-other-business-carriers"
                    >
                      {otherBusinessCarrierExcelDownloadMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Excel 다운로드
                    </Button>
                  </div>
                  <Dialog open={otherBusinessCarrierDialogOpen} onOpenChange={setOtherBusinessCarrierDialogOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-add-other-task">
                        <Plus className="mr-2 h-4 w-4" />
                        기타업무통신사 생성
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>새 기타업무통신사 생성</DialogTitle>
                        <DialogDescription>
                          기타 신청과 연결되는 업무 요청점 정보를 입력하세요.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleCreateOtherBusinessCarrier} className="space-y-4">
                        <div>
                          <Label>업무 요청점 *</Label>
                          <Input 
                            value={otherBusinessCarrierForm.businessRequestPoint}
                            onChange={(e) => setOtherBusinessCarrierForm({...otherBusinessCarrierForm, businessRequestPoint: e.target.value})}
                            placeholder="업무 요청점을 입력하세요" 
                            data-testid="input-business-request-point" 
                          />
                        </div>

                        <div>
                          <Label>메모</Label>
                          <Textarea 
                            value={otherBusinessCarrierForm.memo}
                            onChange={(e) => setOtherBusinessCarrierForm({...otherBusinessCarrierForm, memo: e.target.value})}
                            placeholder="메모를 입력하세요" 
                            data-testid="input-memo" 
                          />
                        </div>

                        <div className="flex justify-end space-x-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setOtherBusinessCarrierDialogOpen(false)}
                            data-testid="button-cancel-business-carrier"
                          >
                            취소
                          </Button>
                          <Button
                            type="submit"
                            data-testid="button-save-other-task"
                          >
                            생성
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {otherBusinessCarriersLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : otherBusinessCarriers && otherBusinessCarriers.length > 0 ? (
                  <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                    <table className="min-w-full divide-y divide-gray-300" data-testid="table-business-carriers">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            업무 요청점
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            메모
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            생성일
                          </th>
                          <th scope="col" className="relative px-6 py-3">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {otherBusinessCarriers.map((carrier) => (
                          <tr key={carrier.id} data-testid={`row-business-carrier-${carrier.id}`}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900" data-testid={`text-business-request-point-${carrier.id}`}>
                              {carrier.businessRequestPoint}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" data-testid={`text-memo-${carrier.id}`}>
                              {carrier.memo || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" data-testid={`text-created-${carrier.id}`}>
                              {formatDateSafe(carrier.createdAt, 'yyyy-MM-dd')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEditOtherBusinessCarrier(carrier)}
                                data-testid={`button-edit-carrier-${carrier.id}`}
                              >
                                <Edit2 className="h-4 w-4 mr-1" />
                                편집
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteOtherBusinessCarrier(carrier.id, carrier.businessRequestPoint)}
                                data-testid={`button-delete-carrier-${carrier.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                삭제
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">기타업무통신사가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">첫 번째 기타업무통신사를 생성해보세요.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 기타업무통신사 편집 다이얼로그 */}
            <Dialog open={editOtherBusinessCarrierDialogOpen} onOpenChange={setEditOtherBusinessCarrierDialogOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>기타업무통신사 수정</DialogTitle>
                  <DialogDescription>
                    기타업무통신사 정보를 수정하세요.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={(e) => {
                  e.preventDefault();
                  if (editingOtherBusinessCarrier && !otherBusinessCarrierForm.businessRequestPoint) {
                    toast({
                      title: "오류",
                      description: "업무 요청점은 필수 입력 사항입니다.",
                      variant: "destructive",
                    });
                    return;
                  }
                  if (editingOtherBusinessCarrier) {
                    updateOtherBusinessCarrierMutation.mutate({ id: editingOtherBusinessCarrier.id, data: otherBusinessCarrierForm });
                  }
                }} className="space-y-4">
                  <div>
                    <Label>업무 요청점 *</Label>
                    <Input 
                      value={otherBusinessCarrierForm.businessRequestPoint}
                      onChange={(e) => setOtherBusinessCarrierForm({...otherBusinessCarrierForm, businessRequestPoint: e.target.value})}
                      placeholder="업무 요청점을 입력하세요" 
                      data-testid="input-edit-business-request-point" 
                    />
                  </div>

                  <div>
                    <Label>메모</Label>
                    <Textarea 
                      value={otherBusinessCarrierForm.memo}
                      onChange={(e) => setOtherBusinessCarrierForm({...otherBusinessCarrierForm, memo: e.target.value})}
                      placeholder="메모를 입력하세요" 
                      data-testid="input-edit-memo" 
                    />
                  </div>

                  <div className="flex justify-end space-x-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditOtherBusinessCarrierDialogOpen(false)}
                      data-testid="button-cancel-edit-business-carrier"
                    >
                      취소
                    </Button>
                    <Button
                      type="submit"
                      data-testid="button-save-edit-business-carrier"
                    >
                      수정
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Carriers Tab */}
          <TabsContent value="carriers">
            <CarrierManagement />
          </TabsContent>


          {/* Dealers Management Tab */}
          <TabsContent value="dealers">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>판매점 관리</CardTitle>
                  <CardDescription className="space-y-2">
                    <p>판매점 계정을 관리하고 새로운 판매점을 생성할 수 있습니다.</p>
                    <div className="flex items-start gap-2 text-xs bg-blue-50 dark:bg-blue-950 p-3 rounded-md border border-blue-200 dark:border-blue-800">
                      <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-semibold text-blue-900 dark:text-blue-100">엑셀 일괄 업로드 가이드:</p>
                        <ol className="list-decimal list-inside space-y-0.5 text-blue-800 dark:text-blue-200">
                          <li><strong>엑셀 양식</strong> 버튼을 클릭하여 양식 파일을 다운로드합니다.</li>
                          <li>다운로드한 엑셀 파일을 열고 판매점 정보를 입력합니다. (판매점명, 아이디, 비밀번호는 필수)</li>
                          <li>작성이 완료되면 <strong>엑셀 업로드</strong> 버튼을 클릭하여 파일을 업로드합니다.</li>
                          <li>업로드 결과에서 성공/실패 내역을 확인합니다.</li>
                        </ol>
                      </div>
                    </div>
                  </CardDescription>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    {/* Excel 양식 다운로드 */}
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          const sessionId = localStorage.getItem('auth-storage');
                          const parsed = sessionId ? JSON.parse(sessionId) : null;
                          const token = parsed?.state?.sessionId;
                          
                          const response = await fetch('/api/admin/dealers/template/download', {
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
                          });
                          
                          if (!response.ok) {
                            throw new Error('다운로드 실패');
                          }
                          
                          const blob = await response.blob();
                          const url = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = '판매점_업로드_양식.xlsx';
                          document.body.appendChild(a);
                          a.click();
                          window.URL.revokeObjectURL(url);
                          document.body.removeChild(a);
                          
                          toast({
                            title: "다운로드 완료",
                            description: "엑셀 양식이 다운로드되었습니다.",
                          });
                        } catch (error) {
                          toast({
                            title: "다운로드 실패",
                            description: "양식 다운로드에 실패했습니다.",
                            variant: "destructive",
                          });
                        }
                      }}
                      data-testid="button-download-dealer-template"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      엑셀 양식
                    </Button>
                    {/* Excel 업로드 */}
                    <input
                      ref={dealerExcelInputRef}
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          dealerExcelUploadMutation.mutate(file);
                        }
                      }}
                      className="hidden"
                    />
                    <Button
                      variant="outline"
                      onClick={() => dealerExcelInputRef.current?.click()}
                      disabled={dealerExcelUploadMutation.isPending}
                      data-testid="button-upload-dealers-excel"
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {dealerExcelUploadMutation.isPending ? '업로드 중...' : '엑셀 업로드'}
                    </Button>
                  </div>
                  {dealerExcelUploadMutation.isPending && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>업로드 진행률</span>
                        <span>{dealerUploadProgress}%</span>
                      </div>
                      <Progress value={dealerUploadProgress} className="w-full" />
                    </div>
                  )}

                  {/* 판매점 생성 다이얼로그 */}
                  <Dialog open={dealerDialogOpen} onOpenChange={setDealerDialogOpen}>
                    <DialogTrigger asChild>
                      <Button data-testid="button-add-dealer">
                        <Plus className="mr-2 h-4 w-4" />
                        판매점 생성
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>새 판매점 계정 생성</DialogTitle>
                        <DialogDescription>
                          새로운 판매점의 계정 정보를 입력하세요.
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...dealerForm}>
                        <form onSubmit={dealerForm.handleSubmit(handleCreateDealer)} className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={dealerForm.control}
                              name="name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>판매점명 *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="판매점명을 입력하세요" {...field} data-testid="input-dealer-name" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={dealerForm.control}
                              name="username"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>아이디 *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="로그인 아이디" {...field} data-testid="input-dealer-username" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={dealerForm.control}
                              name="password"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>비밀번호 *</FormLabel>
                                  <FormControl>
                                    <Input type="password" placeholder="비밀번호 (최소 6자)" {...field} data-testid="input-dealer-password" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={dealerForm.control}
                              name="contactEmail"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이메일</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="연락처 이메일" {...field} data-testid="input-dealer-email" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={dealerForm.control}
                              name="contactPhone"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>연락처</FormLabel>
                                  <FormControl>
                                    <Input placeholder="연락처 번호" {...field} data-testid="input-dealer-phone" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={dealerForm.control}
                              name="location"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>위치</FormLabel>
                                  <FormControl>
                                    <Input placeholder="판매점 위치" {...field} data-testid="input-dealer-location" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <div className="flex justify-end space-x-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setDealerDialogOpen(false)}
                              data-testid="button-cancel-dealer"
                            >
                              취소
                            </Button>
                            <Button
                              type="submit"
                              disabled={createDealerMutation.isPending}
                              data-testid="button-save-dealer"
                            >
                              {createDealerMutation.isPending ? '생성 중...' : '생성'}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>

                  {/* 판매점 편집 다이얼로그 */}
                  <Dialog open={editDealerDialogOpen} onOpenChange={setEditDealerDialogOpen}>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle>판매점 정보 수정</DialogTitle>
                        <DialogDescription>
                          판매점의 정보를 수정하세요.
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...editDealerForm}>
                        <form onSubmit={editDealerForm.handleSubmit(handleUpdateDealer)} className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={editDealerForm.control}
                              name="name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>판매점명 *</FormLabel>
                                  <FormControl>
                                    <Input placeholder="판매점명을 입력하세요" {...field} data-testid="input-edit-dealer-name" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editDealerForm.control}
                              name="username"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>아이디</FormLabel>
                                  <FormControl>
                                    <Input placeholder="로그인 아이디" {...field} disabled data-testid="input-edit-dealer-username" />
                                  </FormControl>
                                  <FormMessage />
                                  <FormDescription>아이디는 수정할 수 없습니다.</FormDescription>
                                </FormItem>
                              )}
                            />
                          </div>

                          <FormField
                            control={editDealerForm.control}
                            name="password"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>새 비밀번호 (선택사항)</FormLabel>
                                <FormControl>
                                  <Input type="password" placeholder="새 비밀번호 (변경하려면 입력)" {...field} data-testid="input-edit-dealer-password" />
                                </FormControl>
                                <FormMessage />
                                <FormDescription>비밀번호를 변경하지 않으려면 빈 칸으로 두세요.</FormDescription>
                              </FormItem>
                            )}
                          />

                          <div className="grid grid-cols-2 gap-4">
                            <FormField
                              control={editDealerForm.control}
                              name="contactEmail"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이메일</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="연락처 이메일" {...field} data-testid="input-edit-dealer-email" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editDealerForm.control}
                              name="contactPhone"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>연락처</FormLabel>
                                  <FormControl>
                                    <Input placeholder="연락처 번호" {...field} data-testid="input-edit-dealer-phone" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>

                          <FormField
                            control={editDealerForm.control}
                            name="location"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>위치</FormLabel>
                                <FormControl>
                                  <Input placeholder="판매점 위치" {...field} data-testid="input-edit-dealer-location" />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <div className="flex justify-end space-x-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setEditDealerDialogOpen(false);
                                setEditingDealer(null);
                              }}
                              data-testid="button-cancel-edit-dealer"
                            >
                              취소
                            </Button>
                            <Button
                              type="submit"
                              disabled={updateDealerMutation.isPending}
                              data-testid="button-save-edit-dealer"
                            >
                              {updateDealerMutation.isPending ? '수정 중...' : '수정'}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {dealersLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                ) : dealers && dealers.length > 0 ? (
                  <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                    <table className="min-w-full divide-y divide-gray-300" data-testid="table-dealers">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            판매점명
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            아이디
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            연락처
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            위치
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            생성일
                          </th>
                          <th scope="col" className="relative px-6 py-3">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {dealers.map((dealer) => (
                          <tr key={dealer.id} data-testid={`row-dealer-${dealer.id}`}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900" data-testid={`text-dealer-name-${dealer.id}`}>
                              {dealer.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" data-testid={`text-dealer-username-${dealer.id}`}>
                              {dealer.username}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              <div>
                                {dealer.contactEmail && (
                                  <div data-testid={`text-dealer-email-${dealer.id}`}>{dealer.contactEmail}</div>
                                )}
                                {dealer.contactPhone && (
                                  <div data-testid={`text-dealer-phone-${dealer.id}`}>{dealer.contactPhone}</div>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" data-testid={`text-dealer-location-${dealer.id}`}>
                              {dealer.location || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500" data-testid={`text-dealer-created-${dealer.id}`}>
                              {formatDateSafe(dealer.createdAt, 'yyyy-MM-dd')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setEditingDealer(dealer);
                                  editDealerForm.reset({
                                    name: dealer.name || '',
                                    username: dealer.username || '',
                                    password: '',
                                    contactEmail: dealer.contactEmail || '',
                                    contactPhone: dealer.contactPhone || '',
                                    location: dealer.location || '',
                                    carrierCodes: {},
                                  });
                                  setEditDealerDialogOpen(true);
                                }}
                                data-testid={`button-edit-dealer-${dealer.id}`}
                              >
                                <Edit2 className="h-4 w-4 mr-1" />
                                편집
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteDealerInTable(dealer.id, dealer.name)}
                                disabled={deleteDealerInTableMutation.isPending}
                                data-testid={`button-delete-dealer-${dealer.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                삭제
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Building2 className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">판매점이 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">첫 번째 판매점을 생성해보세요.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users">
            {/* User Management Section */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>사용자 관리</CardTitle>
                  <CardDescription>
                    시스템의 모든 사용자를 관리하고 새로운 계정을 생성할 수 있습니다.
                  </CardDescription>
                </div>
                <div className="flex items-center space-x-2">
                  <Dialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Plus className="mr-2 h-4 w-4" />
                        관리자 생성
                      </Button>
                    </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>새 관리자 계정 생성</DialogTitle>
                        </DialogHeader>
                        <Form {...adminForm}>
                          <form onSubmit={adminForm.handleSubmit(handleCreateAdmin)} className="space-y-4">
                            <FormField
                              control={adminForm.control}
                              name="name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이름</FormLabel>
                                  <FormControl>
                                    <Input placeholder="이름을 입력하세요" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={adminForm.control}
                              name="username"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>아이디</FormLabel>
                                  <FormControl>
                                    <Input type="text" placeholder="아이디를 입력하세요" autoComplete="off" {...field} />
                                  </FormControl>
                                  {adminUsernameCheck.checking && (
                                    <p className="text-sm text-gray-500 mt-1">확인 중...</p>
                                  )}
                                  {!adminUsernameCheck.checking && adminUsernameCheck.available === true && (
                                    <p className="text-sm text-green-600 mt-1">✓ 사용 가능한 아이디입니다</p>
                                  )}
                                  {!adminUsernameCheck.checking && adminUsernameCheck.available === false && (
                                    <p className="text-sm text-red-600 mt-1">✗ 이미 사용 중인 아이디입니다</p>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={adminForm.control}
                              name="password"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>비밀번호</FormLabel>
                                  <FormControl>
                                    <Input type="password" placeholder="비밀번호를 입력하세요" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end space-x-2">
                              <Button type="button" variant="outline" onClick={() => setAdminDialogOpen(false)}>
                                취소
                              </Button>
                              <Button type="submit" disabled={createAdminMutation.isPending}>
                                {createAdminMutation.isPending ? '생성 중...' : '생성'}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  <Dialog open={workerDialogOpen} onOpenChange={setWorkerDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Plus className="mr-2 h-4 w-4" />
                        근무자 생성
                      </Button>
                    </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>새 근무자 계정 생성</DialogTitle>
                        </DialogHeader>
                        <Form {...workerForm}>
                          <form onSubmit={workerForm.handleSubmit(handleCreateWorker)} className="space-y-4">
                            <FormField
                              control={workerForm.control}
                              name="name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이름</FormLabel>
                                  <FormControl>
                                    <Input placeholder="이름을 입력하세요" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={workerForm.control}
                              name="username"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>아이디</FormLabel>
                                  <FormControl>
                                    <Input type="text" placeholder="아이디를 입력하세요" autoComplete="off" {...field} />
                                  </FormControl>
                                  {workerUsernameCheck.checking && (
                                    <p className="text-sm text-gray-500 mt-1">확인 중...</p>
                                  )}
                                  {!workerUsernameCheck.checking && workerUsernameCheck.available === true && (
                                    <p className="text-sm text-green-600 mt-1">✓ 사용 가능한 아이디입니다</p>
                                  )}
                                  {!workerUsernameCheck.checking && workerUsernameCheck.available === false && (
                                    <p className="text-sm text-red-600 mt-1">✗ 이미 사용 중인 아이디입니다</p>
                                  )}
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={workerForm.control}
                              name="password"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>비밀번호</FormLabel>
                                  <FormControl>
                                    <Input type="password" placeholder="비밀번호를 입력하세요" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end space-x-2">
                              <Button type="button" variant="outline" onClick={() => setWorkerDialogOpen(false)}>
                                취소
                              </Button>
                              <Button type="submit" disabled={createWorkerMutation.isPending}>
                                {createWorkerMutation.isPending ? '생성 중...' : '생성'}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  <Dialog open={salesManagerDialogOpen} onOpenChange={(open) => {
                    setSalesManagerDialogOpen(open);
                    if (open) {
                      salesManagerForm.reset({
                        username: '',
                        password: '',
                        name: '',
                        team: '',
                      });
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button variant="outline">
                        <Plus className="mr-2 h-4 w-4" />
                        영업과장 생성
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>새 영업과장 계정 생성</DialogTitle>
                        </DialogHeader>
                        <Form {...salesManagerForm}>
                          <form 
                            onSubmit={salesManagerForm.handleSubmit(handleCreateSalesManager)} 
                            className="space-y-4"
                            autoComplete="off"
                            aria-autocomplete="none"
                          >
                            {/* 크롬 자동완성 차단용 더미 필드 */}
                            <input type="text" style={{display:'none'}} autoComplete="username" tabIndex={-1} />
                            <input type="password" style={{display:'none'}} autoComplete="new-password" tabIndex={-1} />
                            
                            <FormField
                              control={salesManagerForm.control}
                              name="name"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이름</FormLabel>
                                  <FormControl>
                                    <Input 
                                      {...field} 
                                      autoComplete="off"
                                      autoCapitalize="off"
                                      autoCorrect="off"
                                      spellCheck={false}
                                      data-lpignore="true"
                                      data-1p-ignore="true"
                                      name="mcc_manager_name"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={salesManagerForm.control}
                              name="username"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>아이디</FormLabel>
                                  <FormControl>
                                    <Input 
                                      type="text" 
                                      {...field} 
                                      autoComplete="off"
                                      autoCapitalize="off"
                                      autoCorrect="off"
                                      spellCheck={false}
                                      data-lpignore="true"
                                      data-1p-ignore="true"
                                      name="mcc_manager_username"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={salesManagerForm.control}
                              name="password"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>비밀번호</FormLabel>
                                  <FormControl>
                                    <Input 
                                      type="password" 
                                      {...field} 
                                      autoComplete="new-password"
                                      data-lpignore="true"
                                      data-1p-ignore="true"
                                      name="mcc_manager_password"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={salesManagerForm.control}
                              name="team"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>소속 팀</FormLabel>
                                  <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="본사">본사</SelectItem>
                                      <SelectItem value="DX 1팀">DX 1팀</SelectItem>
                                      <SelectItem value="DX 2팀">DX 2팀</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex justify-end space-x-2">
                              <Button type="button" variant="outline" onClick={() => {
                                salesManagerForm.reset({
                                  username: '',
                                  password: '',
                                  name: '',
                                  team: '',
                                });
                                setSalesManagerDialogOpen(false);
                              }}>
                                취소
                              </Button>
                              <Button 
                                type="submit" 
                                disabled={
                                  createSalesManagerMutation.isPending || 
                                  !salesManagerForm.watch('name') || 
                                  !salesManagerForm.watch('username') || 
                                  !salesManagerForm.watch('password') || 
                                  !salesManagerForm.watch('team')
                                }
                              >
                                {createSalesManagerMutation.isPending ? '생성 중...' : '생성'}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>

                    {/* Edit Sales Manager Dialog */}
                    <Dialog open={editSalesManagerDialogOpen} onOpenChange={setEditSalesManagerDialogOpen}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>영업과장 정보 수정</DialogTitle>
                        </DialogHeader>
                        <Form {...editSalesManagerForm}>
                          <form onSubmit={editSalesManagerForm.handleSubmit(handleUpdateSalesManager)} className="space-y-4">
                            <FormField
                              control={editSalesManagerForm.control}
                              name="managerName"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이름</FormLabel>
                                  <FormControl>
                                    <Input placeholder="이름을 입력하세요" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="username"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>아이디</FormLabel>
                                  <FormControl>
                                    <Input type="text" placeholder="kmj_manager" autoComplete="off" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="password"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>새 비밀번호 (변경시에만 입력)</FormLabel>
                                  <FormControl>
                                    <Input type="password" placeholder="••••••••" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="managerCode"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>영업과장 코드</FormLabel>
                                  <FormControl>
                                    <Input placeholder="MGR001" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="position"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>직급</FormLabel>
                                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="직급 선택" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="과장">과장</SelectItem>
                                      <SelectItem value="차장">차장</SelectItem>
                                      <SelectItem value="부장">부장</SelectItem>
                                      <SelectItem value="팀장">팀장</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="teamId"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>소속팀</FormLabel>
                                  <Select onValueChange={(value) => field.onChange(Number(value))} value={field.value?.toString()}>
                                    <FormControl>
                                      <SelectTrigger>
                                        <SelectValue placeholder="팀 선택" />
                                      </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                      <SelectItem value="1">본사</SelectItem>
                                      <SelectItem value="2">DX 1팀</SelectItem>
                                      <SelectItem value="3">DX 2팀</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="contactPhone"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>연락처</FormLabel>
                                  <FormControl>
                                    <Input type="tel" placeholder="010-1234-5678" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={editSalesManagerForm.control}
                              name="email"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>이메일</FormLabel>
                                  <FormControl>
                                    <Input type="email" placeholder="manager@example.com" {...field} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <div className="flex gap-2">
                              <Button type="submit" disabled={updateSalesManagerMutation.isPending}>
                                {updateSalesManagerMutation.isPending ? '수정 중...' : '수정'}
                              </Button>
                              <Button type="button" variant="outline" onClick={() => setEditSalesManagerDialogOpen(false)}>
                                취소
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                  </div>
                ) : users.length > 0 ? (
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="min-w-full divide-y divide-gray-300">
                      <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            이름
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            아이디
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            소속/팀
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            계정 유형
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            생성일
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            관리
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                        {allUsers.map((user, index) => (
                          <tr key={(user as any).uniqueKey} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {(user as any).displayName || user.name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {user.username}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {user.affiliation || '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              <Badge variant="secondary">
                                {(user as any).accountType === 'admin' ? '시스템 관리자' : 
                                 (user as any).accountType === 'sales_manager' ? '영업과장' : 
                                 user.userType === 'worker' ? '근무자' : '기타'}
                              </Badge>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              {formatDateSafe(user.createdAt, 'yyyy-MM-dd')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                              <div className="flex space-x-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    
                                    console.log('Edit button clicked for user:', user);
                                    // 영업과장인 경우 영업과장 편집 다이얼로그 열기
                                    if ((user as any).accountType === 'sales_manager') {
                                      handleEditSalesManager(user);
                                    } else {
                                      // 일반 사용자 편집 - openEditUserDialog 함수 사용
                                      openEditUserDialog(user);
                                    }
                                  }}
                                  className="inline-flex items-center px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 hover:border-blue-300"
                                  title="사용자 정보 수정"
                                >
                                  <Edit className="h-4 w-4" />
                                </button>
                                {user.username !== 'kksnan' && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleDeleteUser(user);
                                    }}
                                    className="inline-flex items-center px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900 hover:border-red-300"
                                    title="사용자 삭제"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Users className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">사용자가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">첫 번째 사용자를 추가해보세요.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 권한 관리 섹션 */}
            <UserPermissionsTab />
          </TabsContent>


          {/* Documents Tab */}
          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>서류 관리</CardTitle>
                  <div className="flex space-x-2">
                    <Input
                      type="date"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                      placeholder="시작일"
                      className="w-40"
                    />
                    <Input
                      type="date"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                      placeholder="종료일"
                      className="w-40"
                    />
                    <Button 
                      onClick={handleExportActivatedDocuments}
                      disabled={!exportStartDate || !exportEndDate || exportMutation.isPending}
                      className="flex items-center space-x-2"
                    >
                      <Download className="h-4 w-4" />
                      <span>{exportMutation.isPending ? '생성 중...' : '개통서류 엑셀 다운로드'}</span>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {documentsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                  </div>
                ) : documents && documents.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-300">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            접수번호
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            고객명
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            판매점명
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            상태
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            개통상태
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            개통처리자
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            판매점 메모
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            업로드일
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            파일
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {documents.map((doc) => (
                          <tr key={doc.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                              {doc.documentNumber}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {doc.customerName}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {doc.dealerName}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center space-x-2">
                                {getStatusIcon(doc.status)}
                                {getStatusBadge(doc.status)}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              {getActivationStatusBadge((doc as any).activationStatus || '대기')}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {(doc as any).activatedByName || ((doc as any).activationStatus === '개통' ? '관리자' : '-')}
                            </td>
                            <td className="px-6 py-4 text-sm">
                              {(doc as any).dealerNotes ? (
                                <div className="max-w-xs">
                                  <div className="p-2 bg-green-50 border-l-4 border-green-400 rounded-r text-xs">
                                    <div className="font-bold text-green-800 mb-1">💼 판매점 메모</div>
                                    <div className="text-green-700 leading-tight truncate">
                                      {(doc as any).dealerNotes}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-xs">메모 없음</span>
                              )}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {formatDateSafe(doc.uploadedAt, 'yyyy-MM-dd HH:mm')}
                            </td>
                            <td className="px-6 py-4 text-sm font-medium">
                              {(() => {
                                const files = normalizeFiles(doc);
                                if (files.length === 0) {
                                  return doc.filePath ? (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleDocumentDownload(doc.id, getCustomerFileName(doc.customerName, doc.fileName || `document_${doc.id}`))}
                                    >
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  ) : null;
                                }
                                
                                // 파일 타입 확인 헬퍼
                                const isImageFile = (fileName: string) => {
                                  const ext = fileName.split('.').pop()?.toLowerCase();
                                  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext || '');
                                };
                                
                                const isPdfFile = (fileName: string) => {
                                  return fileName.toLowerCase().endsWith('.pdf');
                                };
                                
                                return (
                                  <div className="flex flex-wrap gap-2">
                                    {files.map((f, idx) => {
                                      const label = fileDisplayName(f);
                                      const fileUrl = fileHref(f, doc) || '';
                                      const isImage = isImageFile(label);
                                      const isPdf = isPdfFile(label);
                                      
                                      return (
                                        <div 
                                          key={f.id ?? `${doc.id}-att-${idx}`}
                                          className="group relative cursor-pointer"
                                          onClick={() => handleDocumentDownload(typeof f.id === 'number' ? f.id : doc.id, getCustomerFileName(doc.customerName || '', label))}
                                        >
                                          {isImage ? (
                                            // 이미지 썸네일
                                            <div className="relative w-20 h-20 border-2 border-gray-200 rounded-lg overflow-hidden hover:border-blue-500 transition-colors">
                                              <img 
                                                src={fileUrl} 
                                                alt={label}
                                                className="w-full h-full object-cover"
                                                onError={(e) => {
                                                  e.currentTarget.style.display = 'none';
                                                  e.currentTarget.nextElementSibling!.classList.remove('hidden');
                                                }}
                                              />
                                              <div className="hidden absolute inset-0 flex items-center justify-center bg-gray-100">
                                                <FileText className="h-8 w-8 text-gray-400" />
                                              </div>
                                              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-[10px] px-1 py-0.5 truncate">
                                                {label}
                                              </div>
                                            </div>
                                          ) : isPdf ? (
                                            // PDF 아이콘
                                            <div className="w-20 h-20 border-2 border-gray-200 rounded-lg flex flex-col items-center justify-center hover:border-red-500 transition-colors bg-red-50">
                                              <FileText className="h-8 w-8 text-red-500" />
                                              <span className="text-[10px] text-red-600 font-medium mt-1">PDF</span>
                                              <span className="text-[9px] text-gray-500 truncate w-full px-1 text-center">{label}</span>
                                            </div>
                                          ) : (
                                            // 기타 파일
                                            <div className="w-20 h-20 border-2 border-gray-200 rounded-lg flex flex-col items-center justify-center hover:border-green-500 transition-colors bg-gray-50">
                                              <FileText className="h-8 w-8 text-gray-400" />
                                              <span className="text-[9px] text-gray-500 truncate w-full px-1 text-center">{label}</span>
                                            </div>
                                          )}
                                          {/* 호버 시 다운로드 아이콘 */}
                                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all rounded-lg">
                                            <Download className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">서류가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">업로드된 서류가 없습니다.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Status Update Dialog */}
            <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>서류 상태 변경</DialogTitle>
                </DialogHeader>
                {selectedDocument && (
                  <div className="space-y-4">
                    <div className="text-sm text-gray-600">
                      <p><strong>접수번호:</strong> {selectedDocument.documentNumber}</p>
                      <p><strong>고객명:</strong> {selectedDocument.customerName}</p>
                    </div>
                    <Form {...statusForm}>
                      <form onSubmit={statusForm.handleSubmit(handleUpdateStatus)} className="space-y-4">
                        <FormField
                          control={statusForm.control}
                          name="status"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>상태</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="접수">접수</SelectItem>
                                  <SelectItem value="보완필요">보완필요</SelectItem>
                                  <SelectItem value="완료">완료</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={statusForm.control}
                          name="activationStatus"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>개통 상태</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="대기">대기</SelectItem>
                                  <SelectItem value="개통">개통</SelectItem>
                                  <SelectItem value="취소">취소</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={statusForm.control}
                          name="notes"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>메모 (선택사항)</FormLabel>
                              <FormControl>
                                <Input placeholder="메모를 입력하세요" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex justify-end space-x-2">
                          <Button type="button" variant="outline" onClick={() => setStatusDialogOpen(false)}>
                            취소
                          </Button>
                          <Button type="submit" disabled={updateDocumentStatusMutation.isPending}>
                            {updateDocumentStatusMutation.isPending ? '업데이트 중...' : '업데이트'}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Worker Statistics Tab */}
          <TabsContent value="workers">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <TrendingUp className="mr-2 h-5 w-5" />
                  판매점 성과 통계
                </CardTitle>
                <p className="text-sm text-gray-500">
                  판매점별 개통 실적과 월별 통계를 확인할 수 있습니다.
                </p>
              </CardHeader>
              <CardContent>
                {workerStatsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-500">통계 로딩 중...</p>
                  </div>
                ) : workerStats && workerStats.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {workerStats.map((stat, index) => (
                        <div key={`${stat.workerName}-${stat.dealerId}`} className="border rounded-lg p-4 bg-white">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center font-medium">
                                {stat.workerName?.charAt(0) || 'W'}
                              </div>
                              <div>
                                <h4 className="font-medium text-gray-900">{stat.workerName || '근무자 정보 없음'}</h4>
                                <p className="text-sm text-gray-500">
                                  {dealers?.find(d => d.id === stat.dealerId)?.name || '대리점 정보 없음'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-xs text-gray-500">순위</p>
                              <p className="text-lg font-bold text-accent">#{index + 1}</p>
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">이번 달 개통:</span>
                              <span className="font-semibold text-green-600">{stat.monthlyActivations}건</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-sm text-gray-600">총 개통:</span>
                              <span className="font-semibold text-gray-900">{stat.totalActivations}건</span>
                            </div>
                          </div>
                          
                          <div className="mt-3 pt-3 border-t">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div 
                                className="bg-accent h-2 rounded-full" 
                                style={{ 
                                  width: `${Math.min((stat.monthlyActivations / Math.max(...workerStats.map(s => s.monthlyActivations))) * 100, 100)}%` 
                                }}
                              ></div>
                            </div>
                            <p className="text-xs text-gray-500 mt-1 text-center">월별 성과 비율</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <TrendingUp className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">판매점 통계가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">개통 완료된 서류가 있어야 통계가 표시됩니다.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Document Templates Tab */}
          <TabsContent value="templates">
            <Card>
              <CardHeader>
                <CardTitle>서식지 관리</CardTitle>
                <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Upload className="mr-2 h-4 w-4" />
                      서식지 업로드
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>새 서식지 업로드</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleUploadTemplate} className="space-y-4">
                      <div>
                        <Label htmlFor="templateTitle">제목</Label>
                        <Input
                          id="templateTitle"
                          value={templateTitle}
                          onChange={(e) => setTemplateTitle(e.target.value)}
                          placeholder="서식지 제목을 입력하세요"
                        />
                      </div>
                      <div>
                        <Label htmlFor="templateCategory">카테고리</Label>
                        <Select value={templateCategory} onValueChange={(value: '가입서류' | '변경서류') => setTemplateCategory(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="가입서류">가입서류</SelectItem>
                            <SelectItem value="변경서류">변경서류</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="templateFile">파일</Label>
                        <Input
                          id="templateFile"
                          type="file"
                          accept=".pdf,.doc,.docx,.xlsx,.xls,.jpg,.jpeg,.png,.gif,.bmp,.tiff,.webp"
                          onChange={(e) => setTemplateFile(e.target.files?.[0] || null)}
                          required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          PDF, DOC, DOCX, XLSX, XLS, JPG, JPEG, PNG, GIF, BMP, TIFF, WEBP 파일 업로드 가능 (최대 50MB)
                        </p>
                      </div>
                      {uploadTemplateMutation.isPending && (
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>업로드 진행률</span>
                            <span>{templateUploadProgress}%</span>
                          </div>
                          <Progress value={templateUploadProgress} className="w-full" />
                        </div>
                      )}
                      <div className="flex justify-end space-x-2">
                        <Button type="button" variant="outline" onClick={() => setTemplateDialogOpen(false)}>
                          취소
                        </Button>
                        <Button type="submit" disabled={uploadTemplateMutation.isPending}>
                          {uploadTemplateMutation.isPending ? '업로드 중...' : '업로드'}
                        </Button>
                      </div>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {documentTemplates && documentTemplates.length > 0 ? (
                  <div className="space-y-4">
                    {['가입서류', '변경서류'].map((category) => {
                      const categoryTemplates = documentTemplates.filter(t => t.category === category);
                      if (categoryTemplates.length === 0) return null;
                      
                      return (
                        <div key={category} className="space-y-3">
                          <h4 className="font-medium text-gray-900 border-b pb-2">{category}</h4>
                          {categoryTemplates.map((template) => (
                            <div key={template.id} className="border rounded-lg p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4">
                                  <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                                    <FileText className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div>
                                    <h4 className="font-medium text-gray-900">{template.title}</h4>
                                    <p className="text-sm text-gray-500">
                                      {formatDateSafe(template.uploadedAt, 'yyyy-MM-dd HH:mm')}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant="outline"
                                  onClick={() => handleTemplateDownload(template.id, template.fileName)}
                                >
                                  <Download className="w-4 h-4 mr-2" />
                                  다운로드
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <FileText className="mx-auto h-12 w-12 text-gray-400" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">서식지가 없습니다</h3>
                    <p className="mt-1 text-sm text-gray-500">첫 번째 서식지를 업로드해보세요.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>



          {/* Service Plans Tab */}
          <TabsContent value="service-plans">
            <div className="space-y-6">
              {/* Service Plan Upload Cards */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Excel Template Upload Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5" />
                      엑셀 요금제 업로드
                    </CardTitle>
                    <CardDescription>
                      대량 요금제 데이터를 Excel 파일로 한번에 업로드할 수 있습니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Guidelines */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="font-semibold text-blue-900 mb-2">업로드 가이드라인</h4>
                      <ul className="text-sm text-blue-800 space-y-1">
                        <li>• 1단계: 아래 Excel 양식을 다운로드하세요</li>
                        <li>• 2단계: 양식에 맞춰 요금제 정보를 입력하세요</li>
                        <li>• 3단계: 완성된 파일을 업로드하세요</li>
                        <li>• 지원 형식: .xlsx, .xls, .csv</li>
                        <li>• 필수 컬럼: 요금제명, 통신사, 유형, 데이터, 월요금, 결합가능</li>
                      </ul>
                    </div>

                    {/* Template Download */}
                    <div className="flex flex-col space-y-2">
                      <Button 
                        variant="outline" 
                        onClick={handleDownloadServicePlanTemplate}
                        className="w-full"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Excel 양식 다운로드
                      </Button>
                    </div>

                    {/* File Upload */}
                    <div className="space-y-4">
                      <div>
                        <Label>Excel 파일 선택</Label>
                        <Input
                          id="service-plan-excel"
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          className="mt-1"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setSelectedExcelFile(file);
                            }
                          }}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Excel 파일 (XLSX, XLS) 및 CSV 파일 업로드 가능합니다.
                        </p>
                        {selectedExcelFile && (
                          <p className="text-sm text-green-600 mt-2">
                            ✓ 선택된 파일: {selectedExcelFile.name}
                          </p>
                        )}
                      </div>
                      <Button 
                        className="w-full" 
                        onClick={() => {
                          if (selectedExcelFile) {
                            servicePlanExcelMutation.mutate(selectedExcelFile);
                          }
                        }}
                        disabled={!selectedExcelFile || servicePlanExcelMutation.isPending}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        {servicePlanExcelMutation.isPending ? '업로드 중...' : '엑셀 파일 업로드'}
                      </Button>
                      {servicePlanExcelMutation.isPending && (
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>업로드 진행률</span>
                            <span>{servicePlanUploadProgress}%</span>
                          </div>
                          <Progress value={servicePlanUploadProgress} className="w-full" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Image Upload Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <ImageIcon className="h-5 w-5" />
                      이미지 요금제 업로드
                    </CardTitle>
                    <CardDescription>
                      이미지에서 요금제 정보를 읽어 자동으로 추가합니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Guidelines */}
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                      <h4 className="font-semibold text-green-900 mb-2">이미지 업로드 가이드</h4>
                      <ul className="text-sm text-green-800 space-y-1">
                        <li>• 요금제표나 가격표 이미지를 업로드하세요</li>
                        <li>• 텍스트가 선명하고 읽기 쉬운 이미지 권장</li>
                        <li>• 지원 형식: JPG, PNG, GIF, BMP, TIFF, WEBP</li>
                        <li>• 업로드 후 자동으로 텍스트를 분석합니다</li>
                        <li>• 분석 후 수동으로 정보를 검토해주세요</li>
                      </ul>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <Label>통신사 선택</Label>
                        <Select
                          value={servicePlanImageForm.carrier}
                          onValueChange={(value) => setServicePlanImageForm(prev => ({ ...prev, carrier: value }))}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="통신사를 선택하세요" />
                          </SelectTrigger>
                          <SelectContent>
                            {carriersLoading ? (
                              <SelectItem value="loading" disabled>통신사 로딩 중...</SelectItem>
                            ) : carriersData && carriersData.filter(c => c.isActive).length > 0 ? (
                              carriersData.filter(c => c.isActive).map((carrier) => (
                                <SelectItem key={carrier.id} value={carrier.name}>
                                  {carrier.name}
                                </SelectItem>
                              ))
                            ) : (
                              <SelectItem value="none" disabled>활성화된 통신사가 없습니다</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>이미지 파일 선택</Label>
                        <Input
                          type="file"
                          accept="image/*"
                          className="mt-1"
                          onChange={(e) => setServicePlanImageForm(prev => ({ ...prev, file: e.target.files?.[0] || null }))}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          JPG, PNG, GIF, BMP, TIFF, WEBP 파일을 업로드하세요.
                        </p>
                        {servicePlanImageForm.file && (
                          <p className="text-sm text-green-600 mt-2">
                            ✓ 선택된 파일: {servicePlanImageForm.file.name}
                          </p>
                        )}
                      </div>
                      <Button 
                        className="w-full" 
                        onClick={() => {
                          if (servicePlanImageForm.carrier && servicePlanImageForm.file) {
                            servicePlanImageMutation.mutate({
                              carrier: servicePlanImageForm.carrier,
                              file: servicePlanImageForm.file
                            });
                          }
                        }}
                        disabled={!servicePlanImageForm.carrier || !servicePlanImageForm.file || servicePlanImageMutation.isPending}
                      >
                        <ImageIcon className="mr-2 h-4 w-4" />
                        {servicePlanImageMutation.isPending ? '분석 중...' : '이미지 업로드'}
                      </Button>
                      {servicePlanImageMutation.isPending && (
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>업로드 진행률</span>
                            <span>{imageUploadProgress}%</span>
                          </div>
                          <Progress value={imageUploadProgress} className="w-full" />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Service Plans Card */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>요금제 관리</CardTitle>
                    <CardDescription>
                      각 통신사의 요금제를 관리할 수 있습니다.
                    </CardDescription>
                  </div>
                  <Dialog open={servicePlanDialogOpen} onOpenChange={setServicePlanDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        요금제 추가
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>새 요금제 추가</DialogTitle>
                      </DialogHeader>
                      <Form {...servicePlanForm}>
                        <form onSubmit={servicePlanForm.handleSubmit(handleCreateServicePlan)} className="space-y-4">
                          <FormField
                            control={servicePlanForm.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>요금제명</FormLabel>
                                <FormControl>
                                  <Input placeholder="요금제명을 입력하세요" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={servicePlanForm.control}
                            name="carrier"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>통신사</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="통신사를 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {carriersLoading ? (
                                      <SelectItem value="loading" disabled>통신사 로딩 중...</SelectItem>
                                    ) : carriersData && carriersData.filter(c => c.isActive).length > 0 ? (
                                      carriersData.filter(c => c.isActive).map((carrier) => (
                                        <SelectItem key={carrier.id} value={carrier.name}>
                                          {carrier.name}
                                        </SelectItem>
                                      ))
                                    ) : (
                                      <SelectItem value="none" disabled>활성화된 통신사가 없습니다</SelectItem>
                                    )}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={servicePlanForm.control}
                            name="planType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>요금제 유형</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="요금제 유형을 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="5G">5G</SelectItem>
                                    <SelectItem value="LTE">LTE</SelectItem>
                                    <SelectItem value="3G">3G</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={servicePlanForm.control}
                            name="dataAllowance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>데이터 제공량</FormLabel>
                                <FormControl>
                                  <Input placeholder="예: 무제한, 100GB" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={servicePlanForm.control}
                            name="monthlyFee"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>월 요금 (원)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    placeholder="월 요금을 입력하세요"
                                    {...field}
                                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={servicePlanForm.control}
                            name="combinationEligible"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                                <div className="space-y-1 leading-none">
                                  <FormLabel>
                                    결합 가능 요금제
                                  </FormLabel>
                                  <FormDescription>
                                    이 요금제가 결합 상품으로 가입 가능한 경우 체크하세요
                                  </FormDescription>
                                </div>
                              </FormItem>
                            )}
                          />
                          <div className="flex justify-end space-x-2">
                            <Button type="button" variant="outline" onClick={() => setServicePlanDialogOpen(false)}>
                              취소
                            </Button>
                            <Button type="submit" disabled={createServicePlanMutation.isPending}>
                              {createServicePlanMutation.isPending ? '생성 중...' : '생성'}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                  
                  {/* Edit Service Plan Dialog */}
                  <Dialog open={editServicePlanDialogOpen} onOpenChange={setEditServicePlanDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>요금제 편집</DialogTitle>
                      </DialogHeader>
                      <Form {...editServicePlanForm}>
                        <form onSubmit={editServicePlanForm.handleSubmit(handleUpdateServicePlan)} className="space-y-4">
                          <FormField
                            control={editServicePlanForm.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>요금제명</FormLabel>
                                <FormControl>
                                  <Input placeholder="요금제명을 입력하세요" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editServicePlanForm.control}
                            name="carrier"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>통신사</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="통신사를 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {carriersLoading ? (
                                      <SelectItem value="loading" disabled>통신사 로딩 중...</SelectItem>
                                    ) : carriersData && carriersData.filter(c => c.isActive).length > 0 ? (
                                      carriersData.filter(c => c.isActive).map((carrier) => (
                                        <SelectItem key={carrier.id} value={carrier.name}>
                                          {carrier.name}
                                        </SelectItem>
                                      ))
                                    ) : (
                                      <SelectItem value="none" disabled>활성화된 통신사가 없습니다</SelectItem>
                                    )}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editServicePlanForm.control}
                            name="planType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>요금제 유형</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="요금제 유형을 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="5G">5G</SelectItem>
                                    <SelectItem value="LTE">LTE</SelectItem>
                                    <SelectItem value="3G">3G</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editServicePlanForm.control}
                            name="dataAllowance"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>데이터 제공량</FormLabel>
                                <FormControl>
                                  <Input placeholder="예: 무제한, 100GB" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editServicePlanForm.control}
                            name="monthlyFee"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>월 요금 (원)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    placeholder="월 요금을 입력하세요"
                                    {...field}
                                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editServicePlanForm.control}
                            name="combinationEligible"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                                <div className="space-y-1 leading-none">
                                  <FormLabel>
                                    결합 가능 요금제
                                  </FormLabel>
                                  <FormDescription>
                                    이 요금제가 결합 상품으로 가입 가능한 경우 체크하세요
                                  </FormDescription>
                                </div>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editServicePlanForm.control}
                            name="isActive"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                <div className="space-y-0.5">
                                  <FormLabel>활성 상태</FormLabel>
                                  <FormDescription>
                                    요금제를 활성화하거나 비활성화합니다.
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <div className="flex justify-end space-x-2">
                            <Button type="button" variant="outline" onClick={() => setEditServicePlanDialogOpen(false)}>
                              취소
                            </Button>
                            <Button type="submit" disabled={updateServicePlanMutation.isPending}>
                              {updateServicePlanMutation.isPending ? '수정 중...' : '수정'}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {/* 검색 및 필터 */}
                  <div className="mb-6 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-4">
                      <div className="flex-1">
                        <Input
                          placeholder="요금제명, 통신사로 검색..."
                          value={servicePlanSearch}
                          onChange={(e) => setServicePlanSearch(e.target.value)}
                          className="w-full"
                        />
                      </div>
                      <div className="w-full sm:w-48">
                        <Select value={servicePlanCarrierFilter} onValueChange={setServicePlanCarrierFilter}>
                          <SelectTrigger>
                            <SelectValue placeholder="통신사 필터" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">전체 통신사</SelectItem>
                            {carriersData && carriersData.filter((carrier: any) => carrier.name && carrier.name.trim() !== '').map((carrier: any) => (
                              <SelectItem key={carrier.id} value={carrier.name}>
                                {carrier.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* 선택된 항목 삭제 버튼 */}
                    {selectedServicePlans.length > 0 && (
                      <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                        <span className="text-sm text-red-700 dark:text-red-300">
                          {selectedServicePlans.length}개 항목 선택됨
                        </span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleDeleteSelectedServicePlans}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          선택 항목 삭제
                        </Button>
                      </div>
                    )}
                  </div>

                  {servicePlansLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                      <p className="mt-2 text-sm text-gray-500">요금제를 불러오는 중...</p>
                    </div>
                  ) : filteredServicePlans && filteredServicePlans.length > 0 ? (
                    <div className="space-y-6 max-h-[700px] overflow-y-auto">
                      {/* 전체 선택 체크박스 */}
                      <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 border-b mb-4">
                        <input
                          type="checkbox"
                          id="selectAllServicePlans"
                          checked={selectAllServicePlans}
                          onChange={(e) => handleSelectAllServicePlans(e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="selectAllServicePlans" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          전체 선택 ({filteredServicePlans.length}개)
                        </label>
                      </div>

                      {(() => {
                        // 통신사별로 그룹화
                        const plansByCarrier = filteredServicePlans
                          .sort((a, b) => {
                            // undefined 체크 추가
                            const carrierA = a.carrier || '';
                            const carrierB = b.carrier || '';
                            const planNameA = a.name || '';
                            const planNameB = b.name || '';
                            
                            // 먼저 통신사별로 정렬, 그 다음 요금제명으로 정렬
                            if (carrierA !== carrierB) {
                              return carrierA.localeCompare(carrierB);
                            }
                            return planNameA.localeCompare(planNameB);
                          })
                          .reduce((acc, plan) => {
                            if (!acc[plan.carrier]) {
                              acc[plan.carrier] = [];
                            }
                            acc[plan.carrier].push(plan);
                            return acc;
                          }, {} as Record<string, typeof filteredServicePlans>);

                        return Object.entries(plansByCarrier).map(([carrier, plans]) => (
                          <div key={carrier} className="border rounded-lg overflow-hidden">
                            {/* 통신사 헤더 */}
                            <div className="bg-gray-100 px-6 py-3 border-b">
                              <h3 className="text-lg font-semibold text-gray-900">{carrier}</h3>
                              <p className="text-sm text-gray-600">{plans.length}개 요금제</p>
                            </div>
                            
                            {/* 요금제 테이블 */}
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                                      선택
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      요금제명
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      유형
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      데이터
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      월 요금
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      상태
                                    </th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                      관리
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {plans.map((plan) => (
                                    <tr key={plan.id}>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <input
                                          type="checkbox"
                                          checked={selectedServicePlans.includes(plan.id)}
                                          onChange={(e) => handleSelectServicePlan(plan.id, e.target.checked)}
                                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                        {plan.name}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {plan.planType}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {plan.dataAllowance}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        {typeof plan.monthlyFee === 'number' ? plan.monthlyFee.toLocaleString() : parseFloat(plan.monthlyFee || '0').toLocaleString()}원
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <Badge variant={plan.isActive ? "default" : "secondary"}>
                                          {plan.isActive ? '활성' : '비활성'}
                                        </Badge>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                        <div className="flex space-x-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openEditServicePlanDialog(plan)}
                                          >
                                            편집
                                          </Button>
                                          <Button
                                            variant="destructive"
                                            size="sm"
                                            onClick={() => handleDeleteServicePlan(plan.id)}
                                          >
                                            삭제
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  ) : servicePlans && servicePlans.length > 0 ? (
                    <div className="text-center py-8">
                      <Settings className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">검색 결과가 없습니다</h3>
                      <p className="mt-1 text-sm text-gray-500">다른 검색어를 시도해보세요.</p>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Settings className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">요금제가 없습니다</h3>
                      <p className="mt-1 text-sm text-gray-500">첫 번째 요금제를 추가해보세요.</p>
                    </div>
                  )}
                </CardContent>
              </Card>



              {/* Additional Services Card */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>부가서비스 관리</CardTitle>
                    <CardDescription>
                      각종 부가서비스와 결합상품을 관리할 수 있습니다.
                    </CardDescription>
                  </div>
                  <Dialog open={additionalServiceDialogOpen} onOpenChange={setAdditionalServiceDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        부가서비스 추가
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>새 부가서비스 추가</DialogTitle>
                      </DialogHeader>
                      <Form {...additionalServiceForm}>
                        <form onSubmit={additionalServiceForm.handleSubmit(handleCreateAdditionalService)} className="space-y-4">
                          <FormField
                            control={additionalServiceForm.control}
                            name="serviceName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>서비스명</FormLabel>
                                <FormControl>
                                  <Input placeholder="서비스명을 입력하세요" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={additionalServiceForm.control}
                            name="carrier"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>통신사</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="통신사를 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {carriersData?.map((carrier: any) => (
                                      <SelectItem key={carrier.id} value={carrier.name}>
                                        {carrier.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={additionalServiceForm.control}
                            name="serviceType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>서비스 유형</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="서비스 유형을 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="부가서비스">부가서비스</SelectItem>
                                    <SelectItem value="결합상품">결합상품</SelectItem>
                                    <SelectItem value="콘텐츠">콘텐츠</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={additionalServiceForm.control}
                            name="monthlyFee"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>월 요금 (원)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    placeholder="월 요금을 입력하세요 (할인 서비스는 0)"
                                    {...field}
                                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={additionalServiceForm.control}
                            name="description"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>설명</FormLabel>
                                <FormControl>
                                  <Input placeholder="서비스 설명을 입력하세요" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="flex justify-end space-x-2">
                            <Button type="button" variant="outline" onClick={() => setAdditionalServiceDialogOpen(false)}>
                              취소
                            </Button>
                            <Button type="submit" disabled={createAdditionalServiceMutation.isPending}>
                              {createAdditionalServiceMutation.isPending ? '생성 중...' : '생성'}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>

                  {/* Edit Additional Service Dialog */}
                  <Dialog open={editAdditionalServiceDialogOpen} onOpenChange={setEditAdditionalServiceDialogOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>부가서비스 편집</DialogTitle>
                      </DialogHeader>
                      <Form {...editAdditionalServiceForm}>
                        <form onSubmit={editAdditionalServiceForm.handleSubmit(handleUpdateAdditionalService)} className="space-y-4">
                          <FormField
                            control={editAdditionalServiceForm.control}
                            name="serviceName"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>서비스명</FormLabel>
                                <FormControl>
                                  <Input placeholder="서비스명을 입력하세요" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editAdditionalServiceForm.control}
                            name="carrier"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>통신사</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="통신사를 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {carriersData?.map((carrier: any) => (
                                      <SelectItem key={carrier.id} value={carrier.name}>
                                        {carrier.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editAdditionalServiceForm.control}
                            name="serviceType"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>서비스 유형</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="서비스 유형을 선택하세요" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="부가서비스">부가서비스</SelectItem>
                                    <SelectItem value="결합상품">결합상품</SelectItem>
                                    <SelectItem value="콘텐츠">콘텐츠</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editAdditionalServiceForm.control}
                            name="monthlyFee"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>월 요금 (원)</FormLabel>
                                <FormControl>
                                  <Input 
                                    type="number" 
                                    placeholder="월 요금을 입력하세요 (할인 서비스는 0)"
                                    {...field}
                                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editAdditionalServiceForm.control}
                            name="description"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>설명</FormLabel>
                                <FormControl>
                                  <Input placeholder="서비스 설명을 입력하세요" {...field} />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={editAdditionalServiceForm.control}
                            name="isActive"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                <div className="space-y-0.5">
                                  <FormLabel>활성 상태</FormLabel>
                                  <FormDescription>
                                    서비스를 활성화하거나 비활성화합니다.
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <div className="flex justify-end space-x-2">
                            <Button type="button" variant="outline" onClick={() => setEditAdditionalServiceDialogOpen(false)}>
                              취소
                            </Button>
                            <Button type="submit" disabled={updateAdditionalServiceMutation.isPending}>
                              {updateAdditionalServiceMutation.isPending ? '수정 중...' : '수정'}
                            </Button>
                          </div>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
                <CardContent>
                  {additionalServicesLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                      <p className="mt-2 text-sm text-gray-500">부가서비스를 불러오는 중...</p>
                    </div>
                  ) : additionalServices && additionalServices.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              서비스명
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              유형
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              월 요금
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              설명
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              상태
                            </th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                              관리
                            </th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {additionalServices.map((service) => (
                            <tr key={service.id}>
                              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                {service.serviceName}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {service.serviceType}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {service.monthlyFee.toLocaleString()}원
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                {service.description}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <Badge variant={service.isActive ? "default" : "secondary"}>
                                  {service.isActive ? '활성' : '비활성'}
                                </Badge>
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                <div className="flex space-x-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEditAdditionalServiceDialog(service)}
                                  >
                                    편집
                                  </Button>
                                  <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => handleDeleteAdditionalService(service.id)}
                                  >
                                    삭제
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Settings className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">부가서비스가 없습니다</h3>
                      <p className="mt-1 text-sm text-gray-500">첫 번째 부가서비스를 추가해보세요.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Settlement Unit Prices Tab */}
          <TabsContent value="pricing">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>정산단가 관리</CardTitle>
                  <CardDescription>
                    통신사별 요금제의 신규/번호이동/히든 정산 단가를 설정하고 관리할 수 있습니다.
                  </CardDescription>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      onClick={handleDownloadSettlementPricingTemplate}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      엑셀 템플릿 다운로드
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => settlementPricingExcelInputRef.current?.click()}
                      disabled={settlementPricingExcelUploadMutation.isPending}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      {settlementPricingExcelUploadMutation.isPending ? '업로드 중...' : '엑셀 업로드'}
                    </Button>
                    <input
                      type="file"
                      ref={settlementPricingExcelInputRef}
                      accept=".xlsx,.xls,.csv"
                      style={{ display: 'none' }}
                      onChange={handleSettlementPricingExcelUpload}
                    />
                  </div>
                  {settlementPricingExcelUploadMutation.isPending && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>업로드 진행률</span>
                        <span>{settlementUploadProgress}%</span>
                      </div>
                      <Progress value={settlementUploadProgress} className="w-full" />
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {servicePlansLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupServicePlansByCarrier(servicePlans || [])).map(([carrier, plans]) => (
                      <div key={carrier} className="border rounded-lg p-4">
                        <h3 className="text-lg font-semibold mb-4 text-blue-600">{carrier}</h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  요금제명
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  신규 단가 (원)
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  번호이동 단가 (원)
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  메모
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                  작업
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {plans.map((plan) => {
                                const existingPrice = settlementPrices?.find(sp => sp.servicePlanId === plan.id);
                                return (
                                  <ServicePlanPricingRow 
                                    key={plan.id} 
                                    plan={plan} 
                                    existingPrice={existingPrice}
                                    onUpdate={() => {
                                      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement-unit-prices'] });
                                    }}
                                  />
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>




          {/* POS별 히든 단가 관리 탭 */}
          <TabsContent value="hidden-pricing">
            <HiddenPricingManagement />
          </TabsContent>

        </Tabs>

        {/* Edit User Dialog */}
        <Dialog open={editUserDialogOpen} onOpenChange={setEditUserDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>사용자 정보 수정</DialogTitle>
              <DialogDescription>
                사용자 계정 정보를 수정합니다. 관리자만 비밀번호를 변경할 수 있습니다.
              </DialogDescription>
            </DialogHeader>
            <Form {...editUserForm}>
              <form onSubmit={editUserForm.handleSubmit(handleUpdateUser)} className="space-y-4">
                <FormField
                  control={editUserForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이름</FormLabel>
                      <FormControl>
                        <Input placeholder="이름을 입력하세요" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editUserForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>아이디</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="아이디를 입력하세요" 
                          {...field} 
                          disabled={true}
                        />
                      </FormControl>
                      <FormMessage />
                      <p className="text-xs text-gray-500">아이디는 변경할 수 없습니다.</p>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editUserForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>비밀번호</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder={user?.userType === 'admin' ? "새 비밀번호를 입력하세요 (비워두면 변경하지 않음)" : "관리자만 비밀번호를 변경할 수 있습니다"}
                          {...field}
                          disabled={user?.userType !== 'admin'}
                        />
                      </FormControl>
                      <FormMessage />
                      {user?.userType !== 'admin' && (
                        <p className="text-xs text-red-500">관리자 권한이 필요합니다.</p>
                      )}
                    </FormItem>
                  )}
                />
                <FormField
                  control={editUserForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>역할</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="역할을 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin">관리자</SelectItem>
                          <SelectItem value="sales_manager">영업과장</SelectItem>
                          <SelectItem value="worker">근무자</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editUserForm.control}
                  name="userType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>계정 유형</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="계정 유형을 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="admin">관리자</SelectItem>
                          <SelectItem value="sales_manager">영업과장</SelectItem>
                          <SelectItem value="user">일반사용자</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editUserForm.control}
                  name="team"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>소속팀</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="소속팀을 선택하세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">팀 없음</SelectItem>
                          <SelectItem value="DX 1팀">DX 1팀</SelectItem>
                          <SelectItem value="DX 2팀">DX 2팀</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editUserForm.control}
                  name="allowedCarriers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>허용 통신사</FormLabel>
                      <div className="text-sm text-muted-foreground mb-2">
                        선택하지 않으면 모든 통신사에 접근 가능합니다.
                      </div>
                      <div className="max-h-40 overflow-y-auto border rounded-md p-3 space-y-2">
                        {carriersData?.map((carrier) => (
                          <div key={carrier.name} className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id={`carrier-${carrier.name}`}
                              className="rounded border-gray-300"
                              checked={(field.value || []).includes(carrier.name)}
                              onChange={(e) => {
                                const currentValue = field.value || [];
                                if (e.target.checked) {
                                  field.onChange([...currentValue, carrier.name]);
                                } else {
                                  field.onChange(currentValue.filter((c: string) => c !== carrier.name));
                                }
                              }}
                            />
                            <label 
                              htmlFor={`carrier-${carrier.name}`}
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {carrier.name}
                            </label>
                          </div>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => setEditUserDialogOpen(false)}>
                    취소
                  </Button>
                  <Button type="submit" disabled={updateUserMutation.isPending}>
                    {updateUserMutation.isPending ? '수정 중...' : '수정'}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  )
}
