import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
import { McodeMasterUploadPanel } from '@/components/admin/mcode/McodeMasterUploadPanel';
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
  Loader2,
  ChevronDown,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import * as XLSX from 'xlsx';

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

const CONDITION_TYPE_OPTIONS = [
  { value: 'BUNDLE_EXISTS',        label: '결합 있음 (BUNDLE_EXISTS)' },
  { value: 'BUNDLE_NONE',          label: '결합 없음 (BUNDLE_NONE)' },
  { value: 'BUNDLE_MATCH',         label: '결합명 일치 (BUNDLE_MATCH)' },
  { value: 'ADD_SERVICE_EXISTS',   label: '부가서비스 있음 (ADD_SERVICE_EXISTS)' },
  { value: 'ADD_SERVICE_NONE',     label: '부가서비스 없음 (ADD_SERVICE_NONE)' },
  { value: 'ADD_SERVICE_MATCH',    label: '부가서비스 일치 (ADD_SERVICE_MATCH)' },
  { value: 'ADD_SERVICE_NOT_MATCH', label: '부가서비스 불일치 (ADD_SERVICE_NOT_MATCH)' },
  { value: 'REGFEE_EXISTS',        label: '가입비 있음 (REGFEE_EXISTS)' },
  { value: 'REGFEE_NONE',          label: '가입비 없음 (REGFEE_NONE)' },
  { value: 'REGFEE_MATCH',         label: '가입비 일치 (REGFEE_MATCH)' },
  { value: 'SIM_COUNT_MATCH',      label: '유심개수 일치 (SIM_COUNT_MATCH)' },
];
const NEEDS_CONDITION_VALUE = ['BUNDLE_MATCH','ADD_SERVICE_MATCH','ADD_SERVICE_NOT_MATCH','REGFEE_MATCH','SIM_COUNT_MATCH'];

function ArRuleForm({ form, setForm, carriersData }: { form: any; setForm: any; carriersData: any[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1">
        <Label className="text-xs">채널 <span className="text-gray-400">(비우면 전체)</span></Label>
        <Select value={form.channel || '__all__'} onValueChange={v => setForm((p: any) => ({ ...p, channel: v === '__all__' ? '' : v }))}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="전체 채널" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">전체</SelectItem>
            {carriersData.filter((c: any) => c.isActive).map((c: any) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">요금제 <span className="text-gray-400">(비우면 전체)</span></Label>
        <Input className="h-8 text-sm" placeholder="비우면 전체 요금제" value={form.planName} onChange={e => setForm((p: any) => ({ ...p, planName: e.target.value }))} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">유형 <span className="text-gray-400">(비우면 전체)</span></Label>
        <Select value={form.customerType || '__all__'} onValueChange={v => setForm((p: any) => ({ ...p, customerType: v === '__all__' ? '' : v }))}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="전체" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">전체</SelectItem>
            <SelectItem value="1">1 (신규)</SelectItem>
            <SelectItem value="2">2 (번이)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">추가/차감 *</Label>
        <Select value={form.adjustmentType} onValueChange={v => setForm((p: any) => ({ ...p, adjustmentType: v }))}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ADD">추가 (ADD)</SelectItem>
            <SelectItem value="DEDUCT">차감 (DEDUCT)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 col-span-2">
        <Label className="text-xs">조건 종류 *</Label>
        <Select value={form.conditionType} onValueChange={v => setForm((p: any) => ({ ...p, conditionType: v, conditionValue: '' }))}>
          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONDITION_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label || o.value}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {NEEDS_CONDITION_VALUE.includes(form.conditionType) && (
        <div className="space-y-1 col-span-2">
          <Label className="text-xs">조건값 * <span className="text-gray-400">(이 조건 종류는 필수)</span></Label>
          <Input className="h-8 text-sm" placeholder="예: 캐치콜+" value={form.conditionValue} onChange={e => setForm((p: any) => ({ ...p, conditionValue: e.target.value }))} />
        </div>
      )}
      <div className="space-y-1 col-span-2">
        <Label className="text-xs">금액 * <span className="text-gray-400">(양수만 허용)</span></Label>
        <Input className="h-8 text-sm" placeholder="예: 5,000" value={form.amount} onChange={e => setForm((p: any) => ({ ...p, amount: e.target.value }))} />
      </div>
      <div className="space-y-1 col-span-2">
        <Label className="text-xs">메모</Label>
        <Input className="h-8 text-sm" value={form.memo} onChange={e => setForm((p: any) => ({ ...p, memo: e.target.value }))} />
      </div>
    </div>
  );
}

// 정산지급처명/실판매점명에서 "원)", "준)", "우)", "웅)", "구)", "협)", "협력)" 등 업무용 접두어 제거 후 trim
function normalizeDealerName(name: string): string {
  if (!name) return '';
  // 괄호 접두어 제거: 한글/영문 + ")" 패턴
  return name.replace(/^[^)]*\)\s*/, '').trim();
}

// 두 명칭이 정규화 후 동일한지 비교 (본점 판단용)
function isSameStoreName(a: string, b: string): boolean {
  return normalizeDealerName(a) === normalizeDealerName(b);
}

export function AdminPanel({ defaultTab }: { defaultTab?: string } = {}) {
  const { user } = useAuth();
  const apiRequest = useApiRequest();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // URL에서 탭 결정
  const currentPath = window.location.pathname;
  const actualDefaultTab = currentPath === '/admin/other-business-carriers' ? 'other-business-carriers' : (defaultTab || 'contact-codes');
  const [activeTab, setActiveTab] = useState(actualDefaultTab);

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
  
  // 접점코드 수정 다이얼로그 상태
  const [ccEditDialogOpen, setCcEditDialogOpen] = useState(false);
  const [editingCC, setEditingCC] = useState<any>(null);
  const [ccEditForm, setCcEditForm] = useState({
    code: '',
    dealerRegistrationId: null as number | null,
    dealerName: '',
    realSalesPOS: '',
    realSalesPosCode: '',
    carrier: '',
    salesManagerName: '',
    memo: '',
    isActive: true,
  });

  // 접점코드 관리 상태
  const [newContactCode, setNewContactCode] = useState('');
  const [newDealerRegistrationId, setNewDealerRegistrationId] = useState<number | null>(null);
  const [newDealerName, setNewDealerName] = useState('');
  const [ccAddDealerOpen, setCcAddDealerOpen] = useState(false);
  const [ccEditDealerOpen, setCcEditDealerOpen] = useState(false);
  const [newRealSalesPOS, setNewRealSalesPOS] = useState('');
  const [newRealSalesPosCode, setNewRealSalesPosCode] = useState('');
  const [newCarrier, setNewCarrier] = useState('');
  const [newSalesManagerName, setNewSalesManagerName] = useState('');
  const [newMemo, setNewMemo] = useState('');
  
  // 접점코드 검색 상태 (접수 신청 페이지와 동일한 방식)
  const [contactCodeSearchTerm, setContactCodeSearchTerm] = useState('');
  const [contactCodeSuggestions, setContactCodeSuggestions] = useState<any[]>([]);
  const [showContactCodeSuggestions, setShowContactCodeSuggestions] = useState(false);
  
  // 접점코드 검색 및 필터링
  const [contactCodeSearch, setContactCodeSearch] = useState('');
  const [debouncedCcSearch, setDebouncedCcSearch] = useState('');
  const [contactCodeCarrierFilter, setContactCodeCarrierFilter] = useState('all');
  const [ccPage, setCcPage] = useState(1);
  const [ccGroupView, setCcGroupView] = useState(true);
  const [expandedDealerGroups, setExpandedDealerGroups] = useState<Set<string>>(new Set());
  const [docsPage, setDocsPage] = useState(1);
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

  // 판매점 원장 관련 상태
  const [drDialogOpen, setDrDialogOpen] = useState(false);
  const [drEditDialogOpen, setDrEditDialogOpen] = useState(false);
  const [drEditTarget, setDrEditTarget] = useState<any>(null);
  const [drSearch, setDrSearch] = useState('');
  const [drHiddenFilter, setDrHiddenFilter] = useState<'all' | 'hidden' | 'normal'>('all');
  const [drActiveFilter, setDrActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [drForm, setDrForm] = useState({
    businessName: '', representativeName: '', businessNumber: '',
    contactPhone: '', address: '',
    bankAccount: '', bankName: '', accountHolder: '',
    username: '', password: '',
    isHiddenPos: false, isContactPolicyPos: false, isActive: true, status: '승인',
  });
  const [drUploadDialogOpen, setDrUploadDialogOpen] = useState(false);
  const [drUploadResult, setDrUploadResult] = useState<{ totalRows: number; created: number; skipped: number; errors: string[] } | null>(null);
  const [drUploading, setDrUploading] = useState(false);
  const drFileInputRef = useRef<HTMLInputElement>(null);

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
      contactPhone: z.string().optional(),
      location: z.string().optional(),
      carrierCodes: z.record(z.string()),
    })),
    defaultValues: {
      name: '',
      username: '',
      password: '',
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
      contactPhone: z.string().optional(),
      location: z.string().optional(),
      carrierCodes: z.record(z.string()),
    })),
    defaultValues: {
      name: '',
      username: '',
      password: '',
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

  // ── 판매점 원장 query / mutations ─────────────────────────────────────────
  const { data: dealerRegistrationList = [], refetch: refetchDr } = useQuery<any[]>({
    queryKey: ['/api/admin/dealer-registrations', drSearch, drHiddenFilter, drActiveFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (drSearch) params.set('search', drSearch);
      if (drHiddenFilter === 'hidden') params.set('isHiddenPos', 'true');
      if (drHiddenFilter === 'normal') params.set('isHiddenPos', 'false');
      if (drActiveFilter === 'all') params.set('includeInactive', 'true');
      if (drActiveFilter === 'inactive') params.set('isActive', 'false');
      // drActiveFilter === 'active' → 파라미터 없음 (서버 기본값: active only)
      return apiRequest(`/api/admin/dealer-registrations?${params.toString()}`);
    },
  });

  const createDrMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/admin/dealer-registrations', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: '판매점 원장 등록 완료' });
      setDrDialogOpen(false);
      setDrForm({ businessName: '', representativeName: '', businessNumber: '', contactPhone: '', address: '', bankAccount: '', bankName: '', accountHolder: '', username: '', password: '', isHiddenPos: false, isContactPolicyPos: false, isActive: true, status: '승인' });
      refetchDr();
    },
    onError: (e: any) => toast({ title: '등록 실패', description: e.message, variant: 'destructive' }),
  });

  const updateDrMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/admin/dealer-registrations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: '판매점 원장 수정 완료' });
      setDrEditDialogOpen(false);
      setDrEditTarget(null);
      refetchDr();
    },
    onError: (e: any) => toast({ title: '수정 실패', description: e.message, variant: 'destructive' }),
  });

  const deleteDrMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/dealer-registrations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast({ title: '판매점 원장 비활성화 완료' });
      refetchDr();
    },
    onError: (e: any) => toast({ title: '삭제 실패', description: e.message, variant: 'destructive' }),
  });

  const handleDrExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDrUploading(true);
    setDrUploadResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch('/api/admin/dealer-registrations/upload-excel', {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '업로드 실패');
      setDrUploadResult(result);
      if (result.created > 0) refetchDr();
    } catch (err: any) {
      toast({ title: '업로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setDrUploading(false);
      if (drFileInputRef.current) drFileInputRef.current.value = '';
    }
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

  // ── STEP 5D-6: 정산 결과 관리 상태 ──────────────────────────
  const [siFilterStatus, setSiFilterStatus] = useState('');
  const [siFilterMatchStatus, setSiFilterMatchStatus] = useState('');
  const [siFilterFrom, setSiFilterFrom] = useState('');
  const [siFilterTo, setSiFilterTo] = useState('');
  const [siPage, setSiPage] = useState(1);
  const [siLimit, setSiLimit] = useState(100);
  const [siEditDialogOpen, setSiEditDialogOpen] = useState(false);
  const [siEditTarget, setSiEditTarget] = useState<any>(null);
  const [siEditForm, setSiEditForm] = useState({
    adjustedAmount: '',
    addAmount: '',
    deductAmount: '',
    hiddenAmount: '',
    status: '',
    memo: '',
    forcePolicyVersionId: '',
    forceReason: '',
  });
  const siActivationUploadRef = useRef<HTMLInputElement>(null);
  const [siActivationUploading, setSiActivationUploading] = useState(false);
  const [siExportLoading, setSiExportLoading] = useState(false);
  const [siExpandedDealers, setSiExpandedDealers] = useState<Set<string>>(new Set());

  // ── STEP 5D-7: 정책 차수 관리 상태 ──────────────────────────
  const [pvSelectedId, setPvSelectedId] = useState<number | null>(null);
  const [pvCreateOpen, setPvCreateOpen] = useState(false);
  const [pvEditOpen, setPvEditOpen] = useState(false);
  const [pvEditTarget, setPvEditTarget] = useState<any>(null);
  const [pvForm, setPvForm] = useState({ policyNo: '', policyName: '', effectiveFrom: '', effectiveTo: '', memo: '' });
  const [prCreateOpen, setPrCreateOpen] = useState(false);
  const [prForm, setPrForm] = useState({ channel: '', planName: '', customerType: '1', simCount: '', bundleType: '', addService: '', regFeeType: '', rebateAmount: '', memo: '' });
  const [prEditOpen, setPrEditOpen] = useState(false);
  const [prEditTarget, setPrEditTarget] = useState<any>(null);
  const [prEditForm, setPrEditForm] = useState({ channel: '', planName: '', customerType: '1', nationalityType: '', simCount: '', bundleType: '', addService: '', regFeeType: '', rebateAmount: '', memo: '', isActive: true });
  // 단가 행 필터
  const [prFilterChannel, setPrFilterChannel] = useState('');
  const [prFilterPlan, setPrFilterPlan] = useState('');
  const [prFilterNat, setPrFilterNat] = useState('all');
  const [prFilterType, setPrFilterType] = useState('all');
  const [prFilterActive, setPrFilterActive] = useState('active');
  // adjustment_rules
  const [arCreateOpen, setArCreateOpen] = useState(false);
  const [arEditOpen, setArEditOpen] = useState(false);
  const [arEditTarget, setArEditTarget] = useState<any>(null);
  const arFormDefault = { channel: '', planName: '', customerType: '', conditionType: 'BUNDLE_EXISTS', conditionValue: '', adjustmentType: 'ADD', amount: '', isActive: true, memo: '' };
  const [arForm, setArForm] = useState(arFormDefault);
  const [arEditForm, setArEditForm] = useState(arFormDefault);
  // hidden_policy_rows
  const [hpCreateOpen, setHpCreateOpen] = useState(false);
  const [hpEditOpen, setHpEditOpen] = useState(false);
  const [hpEditTarget, setHpEditTarget] = useState<any>(null);
  const hpFormDefault = { dealerRegistrationId: '', contactCode: '', channel: '', planName: '', customerType: '', hiddenAmount: '', effectiveFrom: '', effectiveTo: '', isActive: true, memo: '' };
  const [hpForm, setHpForm] = useState(hpFormDefault);
  const [hpEditForm, setHpEditForm] = useState(hpFormDefault);
  // 히든정책 다이얼로그용 접점코드 목록
  const [hpDialogCCList, setHpDialogCCList] = useState<any[]>([]);
  const loadHpDialogCCList = async (dealerRegistrationId: string) => {
    if (!dealerRegistrationId) { setHpDialogCCList([]); return; }
    try {
      const result: any = await apiRequest(`/api/contact-codes?dealerRegistrationId=${dealerRegistrationId}&includeRealSalesPOSMatch=true`);
      setHpDialogCCList(Array.isArray(result) ? result : (result?.data ?? []));
    } catch { setHpDialogCCList([]); }
  };
  // 히든금액 재계산
  const [hpRecalcOpen, setHpRecalcOpen] = useState(false);
  const [hpRecalcFrom, setHpRecalcFrom] = useState('');
  const [hpRecalcTo, setHpRecalcTo] = useState('');
  const [hpRecalcResult, setHpRecalcResult] = useState<any>(null);
  const [hpRecalcRunning, setHpRecalcRunning] = useState(false);
  const [hpRecalcDebugCC, setHpRecalcDebugCC] = useState('');
  const SI_COL_DEFAULTS = [130,130,110,130,140,120,120,110,260,80,120,120,100,110,100,100,120,110,110,110,100,120];
  const [siColWidths, setSiColWidths] = useState<number[]>(() => {
    try { const s = localStorage.getItem('mcc-si-col-v3'); if (s) { const p = JSON.parse(s); if (Array.isArray(p) && p.length === 22) return p; } } catch {}
    return SI_COL_DEFAULTS;
  });
  const [peOpen, setPeOpen] = useState(false);
  const [peFile, setPeFile] = useState<File | null>(null);
  const [pePvId, setPePvId] = useState<string>('__auto__');
  const [peUploading, setPeUploading] = useState(false);
  const [peResult, setPeResult] = useState<any>(null);
  const peFileRef = useRef<HTMLInputElement>(null);

  // 채널별 수정파일 업로드 상태
  const [chOpen, setChOpen] = useState(false);
  const [chFile, setChFile] = useState<File | null>(null);
  const [chPvId, setChPvId] = useState<string>('');
  const [chUploading, setChUploading] = useState(false);
  const [chResult, setChResult] = useState<any>(null);
  const chFileRef = useRef<HTMLInputElement>(null);

  // 원본 정책표 자동 인식 상태
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgFile, setOrgFile] = useState<File | null>(null);
  const [orgUploading, setOrgUploading] = useState(false);
  const [orgResult, setOrgResult] = useState<any>(null);
  const orgFileRef = useRef<HTMLInputElement>(null);

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

  // 접점코드 등록 팝업용 판매점 원장 목록 (MCC 선택 드롭다운)
  const { data: dealerListForCC = [] } = useQuery<any[]>({
    queryKey: ['/api/admin/dealer-registrations-for-cc'],
    queryFn: () => apiRequest('/api/admin/dealer-registrations'),
    staleTime: 60_000,
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

  const { data: documentsResult, isLoading: documentsLoading } = useQuery({
    queryKey: ['/api/documents', docsPage],
    queryFn: () => apiRequest(`/api/documents?includeActivatedBy=true&page=${docsPage}&limit=50`),
    enabled: activeTab === 'documents',
  });
  const documents: Array<Document & { dealerName: string; userName: string; activatedByName?: string }> = documentsResult?.data ?? [];
  const docsTotalPages: number = documentsResult?.totalPages ?? 1;
  const docsTotal: number = documentsResult?.total ?? 0;



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
    enabled: activeTab === 'templates',
  });

  const { data: workerStats, isLoading: workerStatsLoading } = useQuery({
    queryKey: ['/api/worker-stats'],
    queryFn: () => apiRequest('/api/worker-stats') as Promise<Array<{
      workerName: string;
      totalActivations: number;
      monthlyActivations: number;
      dealerId: number;
    }>>,
    enabled: activeTab === 'workers',
  });

  const { data: servicePlans, isLoading: servicePlansLoading } = useQuery({
    queryKey: ['/api/admin/service-plans'],
    queryFn: () => apiRequest('/api/admin/service-plans') as Promise<ServicePlan[]>,
  });

  const { data: additionalServices, isLoading: additionalServicesLoading } = useQuery({
    queryKey: ['/api/admin/additional-services'],
    queryFn: () => apiRequest('/api/admin/additional-services') as Promise<AdditionalService[]>,
    enabled: activeTab === 'service-plans',
  });

  // Contact Codes Query (서버 페이지네이션)
  const { data: contactCodesResult, isLoading: contactCodesLoading } = useQuery({
    queryKey: ['/api/contact-codes', ccPage, debouncedCcSearch, contactCodeCarrierFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(ccPage), limit: '50' });
      if (debouncedCcSearch) params.set('search', debouncedCcSearch);
      if (contactCodeCarrierFilter && contactCodeCarrierFilter !== 'all') params.set('carrier', contactCodeCarrierFilter);
      return apiRequest(`/api/contact-codes?${params.toString()}`);
    },
    enabled: activeTab === 'contact-codes',
  });
  const contactCodes: ContactCode[] = contactCodesResult?.data ?? [];
  const ccTotalPages: number = contactCodesResult?.totalPages ?? 1;
  const ccTotal: number = contactCodesResult?.total ?? 0;

  // 그룹 보기용 전체 접점코드 쿼리 (페이지네이션 없음)
  const { data: allCCsResult, isLoading: allCCsLoading } = useQuery({
    queryKey: ['/api/contact-codes', 'all', debouncedCcSearch, contactCodeCarrierFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '1000' });
      if (debouncedCcSearch) params.set('search', debouncedCcSearch);
      if (contactCodeCarrierFilter && contactCodeCarrierFilter !== 'all') params.set('carrier', contactCodeCarrierFilter);
      return apiRequest(`/api/contact-codes?${params.toString()}`);
    },
    enabled: activeTab === 'contact-codes' && ccGroupView,
    staleTime: 30000,
  });
  const allCCs: any[] = Array.isArray(allCCsResult) ? allCCsResult : (allCCsResult?.data ?? []);

  // 중복 쿼리 제거: salesManagersList(미사용), carriersList는 carriersData로 통합됨

  // Settlement unit pricing queries
  const { data: settlementPrices, isLoading: settlementPricesLoading } = useQuery({
    queryKey: ['/api/admin/settlement-unit-prices'],
    queryFn: () => apiRequest('/api/admin/settlement-unit-prices') as Promise<SettlementUnitPrice[]>,
    enabled: activeTab === 'pricing' || activeTab === 'service-plans',
  });

  // ── STEP 5D-6: 정산 결과 쿼리 ─────────────────────────────────
  const siQueryParams = new URLSearchParams();
  if (siFilterStatus)      siQueryParams.set('status', siFilterStatus);
  if (siFilterMatchStatus) siQueryParams.set('matchStatus', siFilterMatchStatus);
  if (siFilterFrom)        siQueryParams.set('from', siFilterFrom);
  if (siFilterTo)          siQueryParams.set('to', siFilterTo);
  siQueryParams.set('page', String(siPage));
  siQueryParams.set('limit', String(siLimit));

  const { data: siData, isLoading: siLoading, refetch: siRefetch } = useQuery({
    queryKey: ['/api/admin/settlement/items', siFilterStatus, siFilterMatchStatus, siFilterFrom, siFilterTo, siPage, siLimit],
    queryFn: () => apiRequest(`/api/admin/settlement/items?${siQueryParams.toString()}`) as Promise<{ data: any[]; page: number; limit: number; summary: { total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number }; groups: Array<{ dealerName: string; total: number; autoMatch: number; reviewRequired: number; policyNotFound: number; settlementDone: number; sumPolicy: number; sumAdjusted: number; sumConfirmed: number; items: any[] }>; totalGroups: number }>,
    enabled: activeTab === 'settlement-results',
  });

  const siMatchMutation = useMutation({
    mutationFn: () => apiRequest('/api/admin/settlement/match', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement/items'] });
      toast({ title: '매칭 완료', description: `생성: ${res.created}건 (AUTO: ${res.autoMatch}, 검토: ${res.reviewRequired}, 미매칭: ${res.policyNotFound})` });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const siRematchMutation = useMutation({
    mutationFn: () => apiRequest('/api/admin/settlement/rematch', { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement/items'] });
      toast({ title: '재매칭 완료', description: `대상: ${res.total}건 → 매칭: ${res.updated}건 (AUTO: ${res.autoMatch}, 검토: ${res.reviewRequired}), 미매칭: ${res.stillNotFound}건` });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const siUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest(`/api/admin/settlement/items/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement/items'] });
      setSiEditDialogOpen(false);
      toast({ title: '수정 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const siLockMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/settlement/items/${id}/lock`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement/items'] });
      setSiEditDialogOpen(false);
      toast({ title: '정산 확정 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const handleActivationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSiActivationUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch('/api/admin/activations/upload', {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '업로드 실패');
      const errPreview = result.errors?.slice(0, 2).join(' / ') ?? '';
      toast({
        title: result.created > 0 ? '개통 업로드 완료' : '개통 업로드 — 저장 0건',
        description: `총 ${result.totalRows}행 | 저장 ${result.created}건 | 건너뜀 ${result.skipped}건${result.warnings?.length ? ` | 경고 ${result.warnings.length}건` : ''}${result.errors?.length ? ` | 오류 ${result.errors.length}건` : ''}${errPreview ? `\n예시: ${errPreview}` : ''}`,
        variant: result.created === 0 && result.errors?.length > 0 ? 'destructive' : 'default',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement/items'] });
    } catch (err: any) {
      toast({ title: '업로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setSiActivationUploading(false);
      if (siActivationUploadRef.current) siActivationUploadRef.current.value = '';
    }
  };

  const handleDownloadActivationTemplate = () => {
    const headers = ['작업자','메모','접수일','개통일','요청점','고객명','개통번호','코드','접점코드','M코드','판매점명','코드명','유형','요금제','결합','부가','모델명','일련번호','가입번호','상담메모','작업일','출금등록','중복값','서식지','고객유형'];
    const exampleRow = ['K)담당자','테스트','2026-06-13','2026-06-13','후불)엠모바일','홍길동','ACT001','','K엠12345','MCC001','누리','누리코드명','신규','엠)M 스페셜 7GB 플러스','아무나결합','캐치콜+','갤럭시S24','SN0001234','SUB001','','2026-06-13','','','','내국인'];
    const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '개통업로드');
    XLSX.writeFile(wb, '개통업로드_양식.xlsx');
  };

  const handleSettlementExport = async () => {
    setSiExportLoading(true);
    try {
      const params = new URLSearchParams();
      if (siFilterStatus)      params.set('status', siFilterStatus);
      if (siFilterMatchStatus) params.set('matchStatus', siFilterMatchStatus);
      if (siFilterFrom)        params.set('from', siFilterFrom);
      if (siFilterTo)          params.set('to', siFilterTo);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch(`/api/admin/settlement/export?${params.toString()}`, {
        method: 'GET',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: '다운로드 실패' }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `정산결과_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      toast({ title: '다운로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setSiExportLoading(false);
    }
  };

  // ── STEP 5D-7: 정책 차수 쿼리 & mutations ───────────────────
  const { data: policyVersions, isLoading: pvLoading, refetch: pvRefetch } = useQuery({
    queryKey: ['/api/admin/policies'],
    queryFn: () => apiRequest('/api/admin/policies') as Promise<any[]>,
    enabled: activeTab === 'policy-versions',
  });

  const { data: policyRowsData, refetch: prRefetch } = useQuery({
    queryKey: ['/api/admin/policies', pvSelectedId, 'rows'],
    queryFn: () => apiRequest(`/api/admin/policies/${pvSelectedId}/rows`) as Promise<any[]>,
    enabled: activeTab === 'policy-versions' && pvSelectedId !== null,
  });

  const pvCreateMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/admin/policies', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies'] });
      setPvCreateOpen(false);
      setPvForm({ policyNo: '', policyName: '', effectiveFrom: '', effectiveTo: '', memo: '' });
      toast({ title: '정책 차수 생성 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const pvUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest(`/api/admin/policies/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies'] });
      setPvEditOpen(false);
      toast({ title: '정책 차수 수정 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const pvDeactivateMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/policies/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies'] });
      toast({ title: '정책 차수 비활성화 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const prCreateMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest(`/api/admin/policies/${pvSelectedId}/rows`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', pvSelectedId, 'rows'] });
      setPrCreateOpen(false);
      setPrForm({ channel: '', planName: '', customerType: '1', simCount: '', bundleType: '', addService: '', regFeeType: '', rebateAmount: '', memo: '' });
      toast({ title: '단가 행 추가 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const prDeactivateMutation = useMutation({
    mutationFn: (rowId: number) =>
      apiRequest(`/api/admin/policies/${pvSelectedId}/rows/${rowId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', pvSelectedId, 'rows'] });
      toast({ title: '단가 행 비활성화 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const prUpdateMutation = useMutation({
    mutationFn: ({ rowId, data }: { rowId: number; data: any }) =>
      apiRequest(`/api/admin/policies/${pvSelectedId}/rows/${rowId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', pvSelectedId, 'rows'] });
      setPrEditOpen(false);
      setPrEditTarget(null);
      toast({ title: '단가 행 수정 완료' });
    },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const { data: arData, refetch: arRefetch } = useQuery({
    queryKey: ['/api/admin/policies', pvSelectedId, 'adjustment-rules'],
    queryFn: () => pvSelectedId ? apiRequest(`/api/admin/policies/${pvSelectedId}/adjustment-rules`) as Promise<any[]> : Promise.resolve([]),
    enabled: !!pvSelectedId,
  });

  const arCreateMutation = useMutation({
    mutationFn: (data: any) => apiRequest(`/api/admin/policies/${pvSelectedId}/adjustment-rules`, { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', pvSelectedId, 'adjustment-rules'] }); setArCreateOpen(false); setArForm(arFormDefault); toast({ title: '규칙 등록 완료' }); },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const arUpdateMutation = useMutation({
    mutationFn: ({ ruleId, data }: { ruleId: number; data: any }) =>
      apiRequest(`/api/admin/policies/${pvSelectedId}/adjustment-rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', pvSelectedId, 'adjustment-rules'] }); setArEditOpen(false); setArEditTarget(null); toast({ title: '규칙 수정 완료' }); },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const arDeactivateMutation = useMutation({
    mutationFn: (ruleId: number) => apiRequest(`/api/admin/policies/${pvSelectedId}/adjustment-rules/${ruleId}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', pvSelectedId, 'adjustment-rules'] }); toast({ title: '규칙 비활성화 완료' }); },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const { data: hpData, refetch: hpRefetch } = useQuery({
    queryKey: ['/api/admin/hidden-policy-rows'],
    queryFn: () => apiRequest('/api/admin/hidden-policy-rows') as Promise<any[]>,
  });

  const hpCreateMutation = useMutation({
    mutationFn: (data: any) => apiRequest('/api/admin/hidden-policy-rows', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/hidden-policy-rows'] }); setHpCreateOpen(false); setHpForm(hpFormDefault); toast({ title: '히든정책 등록 완료' }); },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const hpUpdateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/admin/hidden-policy-rows/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/hidden-policy-rows'] }); setHpEditOpen(false); setHpEditTarget(null); toast({ title: '히든정책 수정 완료' }); },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const hpDeactivateMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/admin/hidden-policy-rows/${id}`, { method: 'DELETE' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/hidden-policy-rows'] }); toast({ title: '히든정책 비활성화 완료' }); },
    onError: (e: Error) => toast({ title: '오류', description: e.message, variant: 'destructive' }),
  });

  const handleHpRecalc = async (dryRun: boolean) => {
    setHpRecalcRunning(true);
    setHpRecalcResult(null);
    try {
      const body: any = { onlyUnsettled: true, dryRun };
      if (hpRecalcFrom) body.dateFrom = hpRecalcFrom;
      if (hpRecalcTo)   body.dateTo   = hpRecalcTo;
      if (hpRecalcDebugCC.trim()) body.debugContactCode = hpRecalcDebugCC.trim();
      const result = await apiRequest('/api/admin/settlement/recalculate-hidden-amounts', { method: 'POST', body: JSON.stringify(body) }) as any;
      setHpRecalcResult({ ...result, dryRun });
      if (!dryRun) {
        queryClient.invalidateQueries({ queryKey: ['/api/admin/settlement/items'] });
      }
    } catch (e: any) {
      toast({ title: '재계산 오류', description: e.message, variant: 'destructive' });
    } finally {
      setHpRecalcRunning(false);
    }
  };

  const handleSiColResize = (colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = siColWidths[colIdx];
    const onMove = (me: MouseEvent) => {
      setSiColWidths(prev => { const n = [...prev]; n[colIdx] = Math.max(40, startW + me.clientX - startX); return n; });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setSiColWidths(prev => { try { localStorage.setItem('mcc-si-col-v3', JSON.stringify(prev)); } catch {} return prev; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handlePeUpload = async () => {
    if (!peFile) { toast({ title: '오류', description: '파일을 선택하세요.', variant: 'destructive' }); return; }
    setPeUploading(true);
    setPeResult(null);
    try {
      const formData = new FormData();
      formData.append('file', peFile);
      if (pePvId && pePvId !== '__auto__') formData.append('policyVersionId', pePvId);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch('/api/admin/policies/upload-excel', {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '업로드 실패');
      setPeResult(result);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies'] });
      if (result.versionId) {
        setPvSelectedId(result.versionId);
        queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', result.versionId, 'rows'] });
      }
    } catch (err: any) {
      toast({ title: '업로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setPeUploading(false);
    }
  };

  const handleChUpload = async () => {
    if (!chFile) { toast({ title: '오류', description: '파일을 선택하세요.', variant: 'destructive' }); return; }
    if (!chPvId) { toast({ title: '오류', description: '정책 차수를 선택하세요.', variant: 'destructive' }); return; }
    setChUploading(true);
    setChResult(null);
    try {
      const formData = new FormData();
      formData.append('file', chFile);
      formData.append('policyVersionId', chPvId);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch('/api/admin/policies/upload-channel-excel', {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '업로드 실패');
      setChResult(result);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/policies'] });
      if (result.versionId) {
        setPvSelectedId(result.versionId);
        queryClient.invalidateQueries({ queryKey: ['/api/admin/policies', result.versionId, 'rows'] });
      }
    } catch (err: any) {
      toast({ title: '업로드 실패', description: err.message, variant: 'destructive' });
    } finally {
      setChUploading(false);
    }
  };

  const handleOrgUpload = async () => {
    if (!orgFile) { toast({ title: '오류', description: '파일을 선택하세요.', variant: 'destructive' }); return; }
    setOrgUploading(true);
    setOrgResult(null);
    try {
      const formData = new FormData();
      formData.append('file', orgFile);
      const sessionId = useAuth.getState().sessionId;
      const resp = await fetch('/api/admin/policies/parse-original-policy-excel', {
        method: 'POST',
        headers: sessionId ? { Authorization: `Bearer ${sessionId}` } : {},
        body: formData,
      });
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || '자동 인식 실패');
      setOrgResult(result);
    } catch (err: any) {
      toast({ title: '자동 인식 실패', description: err.message, variant: 'destructive' });
    } finally {
      setOrgUploading(false);
    }
  };

  const handleOrgDownload = (fileData: { name: string; data: string }) => {
    const byteChars = atob(fileData.data);
    const byteArr = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
    const blob = new Blob([byteArr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileData.name;
    a.click();
    URL.revokeObjectURL(url);
  };

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

  // 접점코드 검색 디바운스 (300ms) + 페이지 초기화
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCcSearch(contactCodeSearch);
      setCcPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [contactCodeSearch]);

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

      let description = `신규 ${data.created ?? 0}건, 수정 ${data.updated ?? 0}건`;
      if (data.dealerMatchSuccess != null || data.dealerMatchFailed != null) {
        description += `\n판매점 매칭: 성공 ${data.dealerMatchSuccess ?? 0}건, 실패 ${data.dealerMatchFailed ?? 0}건`;
      }
      if (data.realSalesPOSMatchSuccess != null || data.realSalesPOSUnregistered != null) {
        description += `\n실제판매점 원장 매칭: ${data.realSalesPOSMatchSuccess ?? 0}건 ✓, 미등록 ${data.realSalesPOSUnregistered ?? 0}건`;
      }
      if ((data.skipped ?? 0) > 0) {
        description += `\n실패: ${data.skipped}건`;
      }
      if (data.warnings && data.warnings.length > 0) {
        description += `\n경고 ${data.warnings.length}건`;
      }
      if (data.errors && data.errors.length > 0) {
        description += `\n\n오류 상세:\n${data.errors.slice(0, 5).join('\n')}`;
        if (data.errors.length > 5) description += `\n... 외 ${data.errors.length - 5}건 더`;
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
    mutationFn: (data: { code: string; dealerName: string; carrier: string; salesManagerId?: number | null; salesManagerName?: string | null; dealerRegistrationId?: number | null; realSalesPOS?: string | null; realSalesPosCode?: string | null; memo?: string | null }) =>
      apiRequest('/api/admin/contact-codes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
      setContactCodeDialogOpen(false);
      setNewContactCode('');
      setNewDealerRegistrationId(null);
      setNewDealerName('');
      setNewCarrier('');
      setNewSalesManagerName('');
      setNewRealSalesPOS('');
      setNewRealSalesPosCode('');
      setNewMemo('');
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

  const updateContactCodeMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest(`/api/admin/contact-codes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contact-codes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/dealer-registrations-for-cc'] });
      setCcEditDialogOpen(false);
      setEditingCC(null);
      toast({ title: '성공', description: '접점코드가 수정되었습니다.' });
    },
    onError: (error: Error) => {
      toast({ title: '오류', description: error.message, variant: 'destructive' });
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

    if (!newDealerRegistrationId || !newContactCode || !newCarrier) {
      toast({
        title: '오류',
        description: '판매점(MCC), 접점코드, 채널을 모두 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    createContactCodeMutation.mutate({
      code: newContactCode,
      dealerName: newDealerName,
      carrier: newCarrier,
      salesManagerId: null,
      salesManagerName: newSalesManagerName || null,
      realSalesPOS: newRealSalesPOS || null,
      realSalesPosCode: newRealSalesPosCode || null,
      dealerRegistrationId: newDealerRegistrationId,
      memo: newMemo || null,
    });
  };

  const handleDeleteContactCode = (id: number) => {
    if (confirm('접점코드 자체를 삭제합니다.\n잘못 연결된 경우에는 삭제하지 말고 \'수정\'에서 정산지급처를 변경하세요.\n정말 삭제하시겠습니까?')) {
      deleteContactCodeMutation.mutate(id);
    }
  };

  const handleEditContactCode = (cc: any) => {
    setEditingCC(cc);
    setCcEditForm({
      code: cc.code || '',
      dealerRegistrationId: cc.dealerRegistrationId ?? null,
      dealerName: cc.dealerName || '',
      realSalesPOS: cc.realSalesPOS || '',
      realSalesPosCode: cc.realSalesPosCode || '',
      carrier: cc.carrier || '',
      salesManagerName: cc.salesManagerName || '',
      memo: cc.memo || '',
      isActive: cc.isActive !== false,
    });
    setCcEditDialogOpen(true);
  };

  const handleDeactivateContactCode = (cc: any) => {
    if (cc.isActive === false) {
      if (confirm(`접점코드 "${cc.code}"를 활성화하시겠습니까?`)) {
        updateContactCodeMutation.mutate({ id: cc.id, data: { isActive: true } });
      }
    } else {
      if (confirm(`접점코드 "${cc.code}"를 비활성화합니다. 데이터는 삭제되지 않습니다. 계속하시겠습니까?`)) {
        updateContactCodeMutation.mutate({ id: cc.id, data: { isActive: false } });
      }
    }
  };

  const handleSubmitCcEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCC) return;
    const dr = (dealerListForCC as any[]).find((d: any) => d.id === ccEditForm.dealerRegistrationId);
    updateContactCodeMutation.mutate({
      id: editingCC.id,
      data: {
        code: ccEditForm.code.trim(),
        dealerRegistrationId: ccEditForm.dealerRegistrationId,
        dealerName: dr?.businessName || ccEditForm.dealerName,
        realSalesPOS: ccEditForm.realSalesPOS.trim() || null,
        realSalesPosCode: ccEditForm.realSalesPosCode.trim() || null,
        carrier: ccEditForm.carrier,
        salesManagerName: ccEditForm.salesManagerName.trim() || null,
        memo: ccEditForm.memo.trim() || null,
        isActive: ccEditForm.isActive,
      },
    });
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

  // 접점코드 필터링은 서버에서 처리 (contactCodes = contactCodesResult.data)
  const filteredContactCodes = contactCodes;

  // 판매점 사업자명 집합 (실제판매점명 원장 매칭 확인용)
  const dealerBusinessNameSet = useMemo(() =>
    new Set((dealerListForCC as any[]).map((d: any) => d.businessName).filter(Boolean)),
  [dealerListForCC]);

  // 그룹 보기: 접점코드를 판매점 원장 기준으로 그룹핑
  const groupedContactCodes = useMemo(() => {
    if (!ccGroupView || allCCs.length === 0) return [];
    const map = new Map<string, { key: string; drId: number | null; drCode: string; drName: string; isContactPolicyPos: boolean; isHiddenPos: boolean; codes: any[] }>();
    for (const cc of allCCs) {
      const key = cc.dealerRegistrationId != null ? String(cc.dealerRegistrationId) : 'unlinked';
      if (!map.has(key)) {
        const dealer = cc.dealerRegistrationId != null
          ? (dealerListForCC as any[]).find((d: any) => d.id === cc.dealerRegistrationId)
          : null;
        map.set(key, {
          key,
          drId: cc.dealerRegistrationId ?? null,
          drCode: (cc as any).drDealerCode || '',
          drName: (cc as any).drBusinessName || cc.dealerName || '',
          isContactPolicyPos: dealer?.isContactPolicyPos ?? false,
          isHiddenPos: dealer?.isHiddenPos ?? false,
          codes: [],
        });
      }
      map.get(key)!.codes.push(cc);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === 'unlinked') return 1;
      if (b.key === 'unlinked') return -1;
      return a.drCode.localeCompare(b.drCode);
    });
  }, [ccGroupView, allCCs, dealerListForCC]);

  const toggleDealerGroup = (key: string) => {
    setExpandedDealerGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

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

  const _handleDownloadTemplateOld = () => {
    // 구버전 CSV 다운로드 (사용 안 함)
    const csvContent = '\uFEFF' + // BOM for Excel UTF-8 recognition
      '접점코드,판매점명,실판매POS,통신사,담당영업과장,판매점코드\n' +
      'PLACEHOLDER_REMOVE\n';
  };

  const handleDownloadTemplate = async () => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const res = await fetch('/api/admin/contact-codes/template', {
        headers: sessionId ? { 'Authorization': `Bearer ${sessionId}` } : {},
      });
      if (!res.ok) throw new Error('다운로드 실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '접점코드_업로드_양식.xlsx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('양식 다운로드 중 오류가 발생했습니다.');
    }
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
        <Tabs defaultValue={actualDefaultTab} onValueChange={setActiveTab} className="space-y-6">
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
            <TabsTrigger value="pricing" className="hidden">
              <Calculator className="h-4 w-4" />
              <span>정산단가</span>
            </TabsTrigger>
            <TabsTrigger value="hidden-pricing" className="flex items-center space-x-2">
              <DollarSign className="h-4 w-4" />
              <span>히든단가</span>
            </TabsTrigger>
            <TabsTrigger value="dealer-registrations" className="flex items-center space-x-2">
              <Building2 className="h-4 w-4" />
              <span>판매점 원장</span>
            </TabsTrigger>
            <TabsTrigger value="settlement-results" className="flex items-center space-x-2">
              <Calculator className="h-4 w-4" />
              <span>정산 결과</span>
            </TabsTrigger>
            <TabsTrigger value="policy-versions" className="flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>정산 정책</span>
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
                        {/* 1. 정산지급처 검색 선택 */}
                        <div>
                          <Label>정산지급처 *</Label>
                          <Popover open={ccAddDealerOpen} onOpenChange={setCcAddDealerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between font-normal"
                              >
                                {newDealerRegistrationId
                                  ? (() => {
                                      const found = (dealerListForCC as any[]).find((d: any) => d.id === newDealerRegistrationId);
                                      return found ? `${found.businessName}${found.dealerCode ? ` (${found.dealerCode})` : ''}` : '선택됨';
                                    })()
                                  : '판매점명으로 검색...'}
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[340px] p-0">
                              <Command>
                                <CommandInput placeholder="판매점명, MCC코드, 사업자번호 검색..." />
                                <CommandList>
                                  <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                                  <CommandGroup>
                                    {(dealerListForCC as any[]).map((d: any) => (
                                      <CommandItem
                                        key={d.id}
                                        value={`${d.businessName || ''} ${d.dealerCode || ''} ${d.businessNumber || ''}`}
                                        onSelect={() => {
                                          setNewDealerRegistrationId(d.id);
                                          setNewDealerName(d.businessName || '');
                                          setCcAddDealerOpen(false);
                                        }}
                                      >
                                        <span className="font-medium">{d.businessName}</span>
                                        {d.dealerCode && (
                                          <span className="ml-2 text-xs text-gray-400">({d.dealerCode})</span>
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* 3. 채널 선택 */}
                        <div>
                          <Label htmlFor="carrier">채널 *</Label>
                          <Select value={newCarrier} onValueChange={setNewCarrier}>
                            <SelectTrigger>
                              <SelectValue placeholder="채널을 선택하세요" />
                            </SelectTrigger>
                            <SelectContent>
                              {carriersData && carriersData.map((carrier: any) => (
                                <SelectItem key={carrier.id} value={carrier.name}>
                                  {carrier.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* 4. 접점코드 입력 */}
                        <div>
                          <Label htmlFor="contactCodeInput">접점코드 *</Label>
                          <Input
                            id="contactCodeInput"
                            value={newContactCode}
                            onChange={(e) => setNewContactCode(e.target.value.trim())}
                            placeholder="접점코드를 입력하세요"
                            required
                            data-testid="input-new-contact-code"
                          />
                        </div>

                        {/* 5. 실판매점명 (선택) */}
                        <div>
                          <Label htmlFor="realSalesPOS">실판매점명 (선택)</Label>
                          <Input
                            id="realSalesPOS"
                            value={newRealSalesPOS}
                            onChange={(e) => setNewRealSalesPOS(e.target.value)}
                            placeholder="하부점명 또는 실판매점명 (정산지급처명과 같으면 본점)"
                          />
                        </div>

                        {/* 5-1. 실판매점코드 (선택, 자동 생성 가능) */}
                        <div>
                          <Label htmlFor="realSalesPosCode">실판매점코드 (선택)</Label>
                          <Input
                            id="realSalesPosCode"
                            value={newRealSalesPosCode}
                            onChange={(e) => setNewRealSalesPosCode(e.target.value)}
                            placeholder="비워두면 자동 생성 (SP0001 형식)"
                          />
                        </div>

                        {/* 6. 담당 영업과장 */}
                        <div>
                          <Label htmlFor="salesManager">담당 영업과장</Label>
                          <Input
                            id="salesManager"
                            value={newSalesManagerName}
                            onChange={(e) => setNewSalesManagerName(e.target.value)}
                            placeholder="담당 영업과장 이름 (선택사항)"
                          />
                        </div>

                        {/* 7. 메모 */}
                        <div>
                          <Label htmlFor="newMemo">메모 (선택)</Label>
                          <Input
                            id="newMemo"
                            value={newMemo}
                            onChange={(e) => setNewMemo(e.target.value)}
                            placeholder="기타 참고사항"
                          />
                        </div>

                        <div className="flex justify-end space-x-2">
                          <Button type="button" variant="outline" onClick={() => {
                            setContactCodeDialogOpen(false);
                            setNewDealerRegistrationId(null);
                            setNewDealerName('');
                            setNewContactCode('');
                            setNewCarrier('');
                            setNewSalesManagerName('');
                            setNewRealSalesPOS('');
                            setNewRealSalesPosCode('');
                            setNewMemo('');
                          }}>
                            취소
                          </Button>
                          <Button type="submit" disabled={createContactCodeMutation.isPending}>
                            {createContactCodeMutation.isPending ? '생성 중...' : '생성'}
                          </Button>
                        </div>
                      </form>
                    </DialogContent>
                  </Dialog>

                  {/* 접점코드 수정 다이얼로그 */}
                  <Dialog open={ccEditDialogOpen} onOpenChange={(open) => { if (!open) { setCcEditDialogOpen(false); setEditingCC(null); } }}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>접점코드 수정</DialogTitle>
                        <DialogDescription>
                          정산지급처를 변경하면 해당 판매점 그룹으로 이동됩니다.
                        </DialogDescription>
                      </DialogHeader>
                      <form onSubmit={handleSubmitCcEdit} className="space-y-4">
                        {/* 접점코드 */}
                        <div>
                          <Label htmlFor="ccEditCode">접점코드 *</Label>
                          <Input
                            id="ccEditCode"
                            value={ccEditForm.code}
                            onChange={(e) => setCcEditForm(f => ({ ...f, code: e.target.value }))}
                            required
                          />
                        </div>
                        {/* 정산지급처 검색 선택 */}
                        <div>
                          <Label>정산지급처 *</Label>
                          <Popover open={ccEditDealerOpen} onOpenChange={setCcEditDealerOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                className="w-full justify-between font-normal"
                              >
                                {ccEditForm.dealerRegistrationId
                                  ? (() => {
                                      const found = (dealerListForCC as any[]).find((d: any) => d.id === ccEditForm.dealerRegistrationId);
                                      return found ? `${found.businessName}${found.dealerCode ? ` (${found.dealerCode})` : ''}` : '선택됨';
                                    })()
                                  : '판매점명으로 검색...'}
                                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[340px] p-0">
                              <Command>
                                <CommandInput placeholder="판매점명, MCC코드, 사업자번호 검색..." />
                                <CommandList>
                                  <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
                                  <CommandGroup>
                                    {(dealerListForCC as any[]).map((d: any) => (
                                      <CommandItem
                                        key={d.id}
                                        value={`${d.businessName || ''} ${d.dealerCode || ''} ${d.businessNumber || ''}`}
                                        onSelect={() => {
                                          setCcEditForm(f => ({ ...f, dealerRegistrationId: d.id, dealerName: d.businessName || '' }));
                                          setCcEditDealerOpen(false);
                                        }}
                                      >
                                        <span className="font-medium">{d.businessName}</span>
                                        {d.dealerCode && (
                                          <span className="ml-2 text-xs text-gray-400">({d.dealerCode})</span>
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>
                        {/* 실판매점명 */}
                        <div>
                          <Label htmlFor="ccEditRealPOS">실판매점명</Label>
                          <Input
                            id="ccEditRealPOS"
                            value={ccEditForm.realSalesPOS}
                            onChange={(e) => setCcEditForm(f => ({ ...f, realSalesPOS: e.target.value }))}
                            placeholder="하부점명 또는 실판매점명 (정산지급처명과 같으면 본점)"
                          />
                        </div>
                        {/* 실판매점코드 */}
                        <div>
                          <Label htmlFor="ccEditRealPOSCode">실판매점코드</Label>
                          <Input
                            id="ccEditRealPOSCode"
                            value={ccEditForm.realSalesPosCode}
                            onChange={(e) => setCcEditForm(f => ({ ...f, realSalesPosCode: e.target.value }))}
                            placeholder="비워두면 자동 생성 (SP0001 형식)"
                          />
                        </div>
                        {/* 채널 */}
                        <div>
                          <Label htmlFor="ccEditCarrier">채널 *</Label>
                          <Select
                            value={ccEditForm.carrier}
                            onValueChange={(val) => setCcEditForm(f => ({ ...f, carrier: val }))}
                          >
                            <SelectTrigger id="ccEditCarrier">
                              <SelectValue placeholder="통신사 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {(carriersData as any[]).map((c: any) => (
                                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {/* 담당영업과장 */}
                        <div>
                          <Label htmlFor="ccEditSM">담당영업과장</Label>
                          <Input
                            id="ccEditSM"
                            value={ccEditForm.salesManagerName}
                            onChange={(e) => setCcEditForm(f => ({ ...f, salesManagerName: e.target.value }))}
                          />
                        </div>
                        {/* 메모 */}
                        <div>
                          <Label htmlFor="ccEditMemo">메모</Label>
                          <Input
                            id="ccEditMemo"
                            value={ccEditForm.memo}
                            onChange={(e) => setCcEditForm(f => ({ ...f, memo: e.target.value }))}
                            placeholder="기타 참고사항"
                          />
                        </div>
                        {/* 상태 */}
                        <div className="flex items-center gap-2">
                          <Switch
                            id="ccEditActive"
                            checked={ccEditForm.isActive}
                            onCheckedChange={(v) => setCcEditForm(f => ({ ...f, isActive: v }))}
                          />
                          <Label htmlFor="ccEditActive">{ccEditForm.isActive ? '활성' : '비활성'}</Label>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" onClick={() => { setCcEditDialogOpen(false); setEditingCC(null); }}>취소</Button>
                          <Button type="submit" disabled={updateContactCodeMutation.isPending}>
                            {updateContactCodeMutation.isPending ? '저장 중...' : '저장'}
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
                      <Select value={contactCodeCarrierFilter} onValueChange={(v) => { setContactCodeCarrierFilter(v); setCcPage(1); }}>
                        <SelectTrigger>
                          <SelectValue placeholder="채널 필터" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">전체 채널</SelectItem>
                          {carriersData && carriersData.map((carrier: any) => (
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
                    <p className="mb-1">1. "양식 다운로드"를 클릭하여 템플릿을 받으세요 (3개 시트 포함).</p>
                    <p className="mb-1">2. <strong>접점코드입력</strong> 시트에 데이터를 입력하세요:</p>
                    <ul className="list-disc list-inside ml-4 space-y-0.5 mb-1">
                      <li><strong>접점코드</strong>: 실제 개통 원장에 찍히는 코드 (예: K엠45172)</li>
                      <li><strong>정산지급처선택</strong>: 아래 3가지 형식 모두 허용
                        <ul className="list-none ml-4 text-xs mt-0.5 space-y-0.5">
                          <li>① <code>[MCC0028] 썬플러스 중계</code> — 판매점원장참조 시트에서 복사</li>
                          <li>② <code>MCC0028</code> — MCC코드 단독</li>
                          <li>③ <code>썬플러스 중계</code> — 판매점명 단독 (중복 시 경고)</li>
                        </ul>
                      </li>
                      <li><strong>실제판매점명</strong>: 하부점 또는 실제 개통 판매점명</li>
                    </ul>
                    <p className="text-xs text-blue-500">※ 판매점명 단독 입력 시 동일명 2개 이상이면 경고가 발생합니다.</p>
                  </div>
                </div>

                {/* 그룹/목록 보기 전환 */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500">
                    {ccGroupView ? `${groupedContactCodes.length}개 판매점 그룹` : `전체 ${ccTotal}개`}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => setCcGroupView(v => !v)}>
                    {ccGroupView ? '목록 보기' : '그룹 보기'}
                  </Button>
                </div>

                {/* 그룹 보기 */}
                {ccGroupView ? (
                  (allCCsLoading) ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                      <p className="mt-2 text-sm text-gray-500">접점코드 로딩 중...</p>
                    </div>
                  ) : groupedContactCodes.length > 0 ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      {groupedContactCodes.map(group => {
                        const isExpanded = expandedDealerGroups.has(group.key);
                        const activeCnt = group.codes.filter(c => c.isActive !== false).length;
                        const uniquePOS = new Set(group.codes.map(c => c.realSalesPOS).filter(Boolean)).size;
                        return (
                          <div key={group.key} className="border-b border-gray-100 last:border-b-0">
                            {/* 그룹 헤더 */}
                            <div
                              className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 select-none"
                              onClick={() => toggleDealerGroup(group.key)}
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-500 flex-shrink-0" />}
                              <span className="font-mono text-xs text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{group.drCode || '미연결'}</span>
                              <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{group.drName || '(판매점 미연결)'}</span>
                              <span className="text-xs text-gray-400 ml-auto flex gap-3">
                                <span>접점코드 {group.codes.length}개</span>
                                <span>활성 {activeCnt}개</span>
                                {uniquePOS > 0 && <span>실제판매점 {uniquePOS}개</span>}
                                {group.isContactPolicyPos && <span className="text-blue-600">접점정책점</span>}
                                {group.isHiddenPos && <span className="text-purple-600">★히든</span>}
                              </span>
                            </div>
                            {/* 상세 행 */}
                            {isExpanded && (
                              <table className="w-full text-xs">
                                <thead className="bg-white dark:bg-gray-900 border-b border-gray-100">
                                  <tr>
                                    <th className="px-4 py-1.5 text-left font-medium text-gray-500">접점코드</th>
                                    <th className="px-4 py-1.5 text-left font-medium text-gray-500" title="정산지급처(그룹)와 다른 경우 실제 개통이 발생한 하부 판매점명">개통점(실제판매점)</th>
                                    <th className="px-4 py-1.5 text-left font-medium text-gray-500">채널</th>
                                    <th className="px-4 py-1.5 text-left font-medium text-gray-500">담당영업과장</th>
                                    <th className="px-4 py-1.5 text-left font-medium text-gray-500">상태</th>
                                    <th className="px-4 py-1.5 w-24"></th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                  {group.codes.map((cc: any) => {
                                    const isSub = group.drName && cc.realSalesPOS && !isSameStoreName(group.drName, cc.realSalesPOS);
                                    const posNotInRegistry = cc.realSalesPOS && !dealerBusinessNameSet.has(cc.realSalesPOS);
                                    const isMCodeData = !!(cc as any).mCode;
                                    // 접점코드가 판매점명 패턴인 경우 (예: 웅)가람모바일)
                                    const codeIsBizName = /^[가-힣]{1,3}[)）]/.test(cc.code || '');
                                    return (
                                      <tr key={cc.id} className={`hover:bg-gray-50 dark:hover:bg-gray-800 ${codeIsBizName ? 'bg-orange-50 dark:bg-orange-950' : ''}`}>
                                        <td className="px-4 py-1.5 font-mono font-medium text-gray-900 dark:text-gray-100">
                                          <span className="flex items-center gap-1 flex-wrap">
                                            <span className={codeIsBizName ? 'text-orange-700' : ''}>{cc.code}</span>
                                            {codeIsBizName && (
                                              <span title="접점코드가 판매점명 패턴입니다. 원장 확인 필요 (H컬럼 오입력 의심)" className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-1 rounded">검토필요</span>
                                            )}
                                            {!codeIsBizName && (isMCodeData
                                              ? <span title={`M코드 원장 업로드 데이터 (M코드: ${(cc as any).mCode})`} className="text-xs bg-indigo-100 text-indigo-700 px-1 rounded">M</span>
                                              : <span title="기존 접점코드 원장 데이터" className="text-xs bg-gray-100 text-gray-500 px-1 rounded">기존</span>
                                            )}
                                          </span>
                                        </td>
                                        <td className="px-4 py-1.5 text-gray-600 dark:text-gray-400">
                                          <span className="flex items-center gap-1 flex-wrap">
                                            {cc.realSalesPOS || <span className="text-gray-400">정산지급처와 동일</span>}
                                            {isSub && <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded">하부점</span>}
                                            {posNotInRegistry && <span title="판매점 원장에 없음" className="text-xs bg-amber-100 text-amber-700 px-1 rounded">원장미등록</span>}
                                          </span>
                                        </td>
                                        <td className="px-4 py-1.5 text-gray-600 dark:text-gray-400">{cc.channel || '미지정'}</td>
                                        <td className="px-4 py-1.5 text-gray-600 dark:text-gray-400">{cc.salesManagerName || '-'}</td>
                                        <td className="px-4 py-1.5">
                                          <span className={`px-1.5 py-0.5 rounded text-xs ${cc.isActive !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {cc.isActive !== false ? '활성' : '비활성'}
                                          </span>
                                        </td>
                                        <td className="px-4 py-1.5">
                                          <div className="flex items-center gap-1">
                                            <Button variant="ghost" size="sm" className="h-5 px-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50" title="수정" onClick={() => handleEditContactCode(cc)}>
                                              <Edit2 className="h-3 w-3" />
                                            </Button>
                                            <Button variant="ghost" size="sm" className="h-5 px-1 text-gray-400 hover:text-gray-600 hover:bg-gray-50" title={cc.isActive !== false ? '비활성화' : '활성화'} onClick={() => handleDeactivateContactCode(cc)}>
                                              {cc.isActive !== false ? '⏸' : '▶'}
                                            </Button>
                                            <Button variant="ghost" size="sm" className="h-5 px-1 text-red-400 hover:text-red-600 hover:bg-red-50" title="삭제" onClick={() => handleDeleteContactCode(cc.id)}>
                                              <Trash2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Settings className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">접점코드가 없습니다</h3>
                      <p className="mt-1 text-sm text-gray-500">첫 번째 접점코드를 추가해보세요.</p>
                    </div>
                  )
                ) : (
                  /* 목록 보기 (기존 평면 테이블) */
                  contactCodesLoading ? (
                    <div className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
                      <p className="mt-2 text-sm text-gray-500">접점코드 로딩 중...</p>
                    </div>
                  ) : filteredContactCodes && filteredContactCodes.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                      <input
                        type="checkbox"
                        id="selectAllContactCodes"
                        checked={selectAllContactCodes}
                        onChange={(e) => handleSelectAllContactCodes(e.target.checked)}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="selectAllContactCodes" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        전체 선택 (이 페이지 {filteredContactCodes.length}개 / 전체 {ccTotal}개)
                      </label>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left w-8"></th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">접점코드</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">정산지급처코드</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">정산지급처명</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300" title="정산지급처와 다른 경우 실제 개통이 발생한 하부 판매점명">개통점(실제판매점)</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">채널</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">담당영업과장</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-700 dark:text-gray-300">상태</th>
                            <th className="px-3 py-2 w-12"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                        {filteredContactCodes.map((code) => (
                        <tr key={code.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selectedContactCodes.includes(code.id || 0)}
                              onChange={(e) => handleSelectContactCode(code.id || 0, e.target.checked)}
                              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">
                            {(() => {
                              const codeIsBizName = /^[가-힣]{1,3}[)）]/.test(code.code || '');
                              return (
                                <span className="flex items-center gap-1 flex-wrap">
                                  <span className={codeIsBizName ? 'text-orange-700' : ''}>{code.code}</span>
                                  {codeIsBizName && (
                                    <span title="접점코드가 판매점명 패턴입니다. 원장 확인 필요 (H컬럼 오입력 의심)" className="text-xs bg-orange-100 text-orange-700 border border-orange-200 px-1 rounded">검토필요</span>
                                  )}
                                  {!codeIsBizName && ((code as any).mCode
                                    ? <span title={`M코드 원장 업로드 데이터 (M코드: ${(code as any).mCode})`} className="text-xs bg-indigo-100 text-indigo-700 px-1 rounded">M</span>
                                    : <span title="기존 접점코드 원장 데이터" className="text-xs bg-gray-100 text-gray-500 px-1 rounded">기존</span>
                                  )}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{(code as any).drDealerCode || '-'}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                            <span className="flex items-center gap-1">
                              {(code as any).drBusinessName || code.dealerName || '-'}
                              {(code as any).drBusinessName && code.dealerName && (code as any).drBusinessName !== code.dealerName && (
                                <span title={`저장된 판매점명: ${code.dealerName}`} className="text-amber-500 cursor-help text-xs">⚠</span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">
                            <span className="flex items-center gap-1">
                              {(code as any).realSalesPOS || '-'}
                              {(code as any).realSalesPOS && !dealerBusinessNameSet.has((code as any).realSalesPOS) && (
                                <span title="판매점 원장에 없음" className="text-xs bg-amber-100 text-amber-700 px-1 rounded">원장미등록</span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{(code as any).channel || '미지정'}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{(code as any).salesManagerName || '-'}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              code.isActive
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                            }`}>
                              {code.isActive ? '활성' : '비활성'}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Button variant="outline" size="sm" className="h-7 px-2 text-blue-600 hover:text-blue-700 border-blue-200" title="수정" onClick={() => handleEditContactCode(code)}>
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 px-2 text-gray-500 hover:text-gray-700 border-gray-200" title={code.isActive ? '비활성화' : '활성화'} onClick={() => handleDeactivateContactCode(code)}>
                                {code.isActive ? '⏸' : '▶'}
                              </Button>
                              <Button variant="outline" size="sm" className="h-7 px-2 text-red-600 hover:text-red-700 border-red-200" title="삭제" onClick={() => handleDeleteContactCode(code.id || 0)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                        ))}
                        </tbody>
                      </table>
                    </div>
                    {ccTotalPages > 1 && (
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-sm text-gray-500">
                          {ccPage} / {ccTotalPages} 페이지 (총 {ccTotal}개)
                        </span>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setCcPage(p => Math.max(1, p - 1))} disabled={ccPage <= 1}>이전</Button>
                          <Button variant="outline" size="sm" onClick={() => setCcPage(p => Math.min(ccTotalPages, p + 1))} disabled={ccPage >= ccTotalPages}>다음</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  ) : (
                    <div className="text-center py-8">
                      <Settings className="mx-auto h-12 w-12 text-gray-400" />
                      <h3 className="mt-2 text-sm font-medium text-gray-900">{debouncedCcSearch || (contactCodeCarrierFilter && contactCodeCarrierFilter !== 'all') ? '검색 결과가 없습니다' : '접점코드가 없습니다'}</h3>
                      <p className="mt-1 text-sm text-gray-500">{debouncedCcSearch ? '다른 검색어를 시도해보세요.' : '첫 번째 접점코드를 추가해보세요.'}</p>
                    </div>
                  )
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

                    {/* 페이지네이션 */}
                    {docsTotalPages > 1 && (
                      <div className="flex items-center justify-between pt-4 border-t border-gray-200 mt-2">
                        <span className="text-sm text-gray-500">
                          {docsPage} / {docsTotalPages} 페이지 (총 {docsTotal}건)
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDocsPage(p => Math.max(1, p - 1))}
                            disabled={docsPage <= 1}
                          >
                            이전
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDocsPage(p => Math.min(docsTotalPages, p + 1))}
                            disabled={docsPage >= docsTotalPages}
                          >
                            다음
                          </Button>
                        </div>
                      </div>
                    )}
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

          {/* 판매점 원장 관리 탭 */}
          <TabsContent value="dealer-registrations">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>판매점 원장 관리</CardTitle>
                  <CardDescription>판매점 사업자 정보, 계좌, 히든 운영점 여부를 관리합니다.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={async () => {
                    try {
                      const sessionId = useAuth.getState().sessionId;
                      const response = await fetch('/api/admin/dealer-registrations/export', {
                        headers: { 'Authorization': `Bearer ${sessionId ?? ''}` },
                      });
                      if (!response.ok) {
                        const text = await response.text();
                        throw new Error(text || `서버 오류 (${response.status})`);
                      }
                      const contentType = response.headers.get("content-type") || "";
                      if (!contentType.includes("spreadsheetml")) {
                        const text = await response.text();
                        throw new Error(`xlsx가 아닌 응답입니다: ${text.slice(0, 300)}`);
                      }
                      const arrayBuffer = await response.arrayBuffer();
                      const blob = new Blob([arrayBuffer], {
                        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      });
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      const cd = response.headers.get('content-disposition') || '';
                      const nameMatch = cd.match(/filename\*=UTF-8''(.+)/i);
                      a.download = nameMatch ? decodeURIComponent(nameMatch[1]) : '판매점원장_현재목록.xlsx';
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      window.URL.revokeObjectURL(url);
                    } catch (e: any) {
                      alert(`원장 다운로드 오류: ${e.message}`);
                    }
                  }}>
                    <Download className="mr-2 h-4 w-4" />
                    현재 원장 다운로드
                  </Button>
                  <Button variant="outline" onClick={() => { setDrUploadResult(null); setDrUploadDialogOpen(true); }}>
                    <Upload className="mr-2 h-4 w-4" />
                    엑셀 업로드
                  </Button>
                  <McodeMasterUploadPanel onUploadSuccess={() => refetchDr()} />
                  <Button onClick={() => {
                    setDrForm({ businessName: '', representativeName: '', businessNumber: '', contactPhone: '', address: '', bankAccount: '', bankName: '', accountHolder: '', username: '', password: '', isHiddenPos: false, isContactPolicyPos: false, isActive: true, status: '승인' });
                    setDrDialogOpen(true);
                  }}>
                    <Plus className="mr-2 h-4 w-4" />
                    판매점 원장 등록
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 필터 */}
                <div className="flex flex-wrap gap-3">
                  <Input
                    placeholder="판매점명 / 판매점코드 / 대표자명 검색"
                    value={drSearch}
                    onChange={(e) => setDrSearch(e.target.value)}
                    className="max-w-sm"
                  />
                  <Select value={drHiddenFilter} onValueChange={(v: any) => setDrHiddenFilter(v)}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="히든정책점" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      <SelectItem value="hidden">히든정책점</SelectItem>
                      <SelectItem value="normal">일반운영점</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={drActiveFilter} onValueChange={(v: any) => setDrActiveFilter(v)}>
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="활성상태" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체</SelectItem>
                      <SelectItem value="active">활성</SelectItem>
                      <SelectItem value="inactive">비활성</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* 목록 테이블 */}
                <div className="border rounded-md overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">판매점코드</th>
                        <th className="px-3 py-2 text-left font-medium">사업체명</th>
                        <th className="px-3 py-2 text-left font-medium">M코드</th>
                        <th className="px-3 py-2 text-left font-medium">KP번호</th>
                        <th className="px-3 py-2 text-left font-medium">지역</th>
                        <th className="px-3 py-2 text-left font-medium">상태</th>
                        <th className="px-3 py-2 text-center font-medium">구분</th>
                        <th className="px-3 py-2 text-center font-medium">활성</th>
                        <th className="px-3 py-2 text-right font-medium">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dealerRegistrationList.length === 0 ? (
                        <tr>
                          <td colSpan={11} className="px-3 py-8 text-center text-gray-500">등록된 판매점 원장이 없습니다.</td>
                        </tr>
                      ) : dealerRegistrationList.map((dr: any) => (
                        <tr key={dr.id} className="border-b hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-xs">{dr.dealerCode ?? '-'}</td>
                          <td className="px-3 py-2 font-medium">
                            <div>{dr.businessName}</div>
                            {dr.subDealerName && <div className="text-xs text-gray-400">{dr.subDealerName}</div>}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-blue-700">{dr.mCode ?? '-'}</td>
                          <td className="px-3 py-2 text-xs">{dr.kpNumber ?? '-'}</td>
                          <td className="px-3 py-2 text-xs">{dr.regionName ?? '-'}</td>
                          <td className="px-3 py-2">
                            <Badge variant={dr.status === '승인' ? 'default' : dr.status === '대기' ? 'secondary' : 'destructive'}>
                              {dr.status}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {dr.isContactPolicyPos && <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">접점</Badge>}
                              {dr.isHiddenPos && <Badge className="bg-orange-100 text-orange-800 border-orange-200 text-xs">히든</Badge>}
                              {!dr.isContactPolicyPos && !dr.isHiddenPos && <span className="text-gray-400">-</span>}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {dr.isActive ? <Badge className="bg-green-100 text-green-800 border-green-200">활성</Badge> : <Badge variant="secondary">비활성</Badge>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="outline" onClick={() => {
                                setDrEditTarget(dr);
                                setDrForm({
                                  businessName: dr.businessName ?? '',
                                  representativeName: dr.representativeName ?? '',
                                  businessNumber: dr.businessNumber ?? '',
                                  contactPhone: dr.contactPhone ?? '',
                                  address: dr.address ?? '',
                                  bankAccount: dr.bankAccount ?? '',
                                  bankName: dr.bankName ?? '',
                                  accountHolder: dr.accountHolder ?? '',
                                  username: dr.username ?? '',
                                  password: '',
                                  isHiddenPos: dr.isHiddenPos ?? false,
                                  isContactPolicyPos: dr.isContactPolicyPos ?? false,
                                  isActive: dr.isActive ?? true,
                                  status: dr.status ?? '승인',
                                });
                                setDrEditDialogOpen(true);
                              }}>
                                <Edit2 className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => {
                                if (window.confirm(`"${dr.businessName}" 판매점 원장을 삭제하시겠습니까?`)) {
                                  deleteDrMutation.mutate(dr.id);
                                }
                              }}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500">총 {dealerRegistrationList.length}개</p>
              </CardContent>
            </Card>

            {/* 엑셀 업로드 다이얼로그 */}
            <Dialog open={drUploadDialogOpen} onOpenChange={setDrUploadDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>판매점 원장 엑셀 대량 업로드</DialogTitle>
                  <DialogDescription>
                    엑셀 파일(.xlsx/.xls)을 업로드하여 판매점 원장을 일괄 등록합니다.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800 space-y-1">
                    <p className="font-semibold">필수 컬럼 (헤더 이름 정확히 입력)</p>
                    <p>상호명 / 대표자명 / 사업자번호 / 연락처 / 주소 / 아이디 / 비밀번호</p>
                    <p className="font-semibold mt-2">선택 컬럼</p>
                    <p>은행명 / 계좌번호 / 예금주 / 히든운영점 (Y 또는 N)</p>
                    <p className="text-xs text-blue-600 mt-1">판매점코드(MCC번호)는 서버가 자동 부여합니다. 사업자번호는 중복 가능합니다. 아이디 중복 시 skip됩니다.</p>
                  </div>
                  {!drUploadResult ? (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <input
                        ref={drFileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleDrExcelUpload}
                        className="hidden"
                        disabled={drUploading}
                      />
                      <Upload className="mx-auto h-10 w-10 text-gray-400 mb-3" />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => drFileInputRef.current?.click()}
                        disabled={drUploading}
                      >
                        {drUploading ? '업로드 중...' : '파일 선택'}
                      </Button>
                      <p className="mt-2 text-xs text-gray-500">.xlsx, .xls 파일만 지원됩니다</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 text-center text-sm">
                        <div className="p-2 bg-gray-50 rounded border">
                          <p className="text-xs text-gray-500">전체</p>
                          <p className="text-lg font-bold">{drUploadResult.totalRows}</p>
                        </div>
                        <div className="p-2 bg-green-50 rounded border border-green-200">
                          <p className="text-xs text-green-600">등록 성공</p>
                          <p className="text-lg font-bold text-green-700">{drUploadResult.created}</p>
                        </div>
                        <div className="p-2 bg-yellow-50 rounded border border-yellow-200">
                          <p className="text-xs text-yellow-600">스킵</p>
                          <p className="text-lg font-bold text-yellow-700">{drUploadResult.skipped}</p>
                        </div>
                      </div>
                      {drUploadResult.errors.length > 0 && (
                        <div className="max-h-40 overflow-y-auto border rounded p-2 bg-red-50 space-y-1">
                          {drUploadResult.errors.map((e, i) => (
                            <p key={i} className="text-xs text-red-700">{e}</p>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => { setDrUploadResult(null); }}>
                          다시 업로드
                        </Button>
                        <Button onClick={() => setDrUploadDialogOpen(false)}>닫기</Button>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* 등록 다이얼로그 */}
            <Dialog open={drDialogOpen} onOpenChange={(open) => { setDrDialogOpen(open); if (!open) setDrForm({ businessName: '', representativeName: '', businessNumber: '', contactPhone: '', address: '', bankAccount: '', bankName: '', accountHolder: '', username: '', password: '', isHiddenPos: false, isContactPolicyPos: false, isActive: true, status: '승인' }); }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>판매점 원장 등록</DialogTitle>
                  <DialogDescription>판매점 코드(MCC번호)는 자동으로 부여됩니다.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-2">
                  <div className="space-y-1">
                    <Label>사업체명 *</Label>
                    <Input value={drForm.businessName} onChange={e => setDrForm(f => ({ ...f, businessName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>대표자명 *</Label>
                    <Input value={drForm.representativeName} onChange={e => setDrForm(f => ({ ...f, representativeName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>사업자번호 *</Label>
                    <Input placeholder="000-00-00000" value={drForm.businessNumber} onChange={e => setDrForm(f => ({ ...f, businessNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>연락처 *</Label>
                    <Input value={drForm.contactPhone} onChange={e => setDrForm(f => ({ ...f, contactPhone: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>상태</Label>
                    <Select value={drForm.status} onValueChange={v => setDrForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="승인">승인</SelectItem>
                        <SelectItem value="대기">대기</SelectItem>
                        <SelectItem value="거부">거부</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>주소 *</Label>
                    <Input value={drForm.address} onChange={e => setDrForm(f => ({ ...f, address: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>은행명</Label>
                    <Input value={drForm.bankName} onChange={e => setDrForm(f => ({ ...f, bankName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>계좌번호</Label>
                    <Input value={drForm.bankAccount} onChange={e => setDrForm(f => ({ ...f, bankAccount: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>예금주</Label>
                    <Input value={drForm.accountHolder} onChange={e => setDrForm(f => ({ ...f, accountHolder: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>로그인 ID *</Label>
                    <Input value={drForm.username} onChange={e => setDrForm(f => ({ ...f, username: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>비밀번호 *</Label>
                    <Input type="password" value={drForm.password} onChange={e => setDrForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                  <div className="flex items-center gap-3 col-span-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={drForm.isContactPolicyPos} onCheckedChange={v => setDrForm(f => ({ ...f, isContactPolicyPos: v }))} id="dr-contact" />
                      <Label htmlFor="dr-contact">접점정책점</Label>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Switch checked={drForm.isHiddenPos} onCheckedChange={v => setDrForm(f => ({ ...f, isHiddenPos: v }))} id="dr-hidden" />
                      <Label htmlFor="dr-hidden">히든정책점</Label>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Switch checked={drForm.isActive} onCheckedChange={v => setDrForm(f => ({ ...f, isActive: v }))} id="dr-active" />
                      <Label htmlFor="dr-active">활성</Label>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDrDialogOpen(false)}>취소</Button>
                  <Button onClick={() => createDrMutation.mutate(drForm)} disabled={createDrMutation.isPending}>
                    {createDrMutation.isPending ? '등록 중...' : '등록'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 수정 다이얼로그 */}
            <Dialog open={drEditDialogOpen} onOpenChange={(open) => { setDrEditDialogOpen(open); if (!open) { setDrEditTarget(null); setDrForm({ businessName: '', representativeName: '', businessNumber: '', contactPhone: '', address: '', bankAccount: '', bankName: '', accountHolder: '', username: '', password: '', isHiddenPos: false, isContactPolicyPos: false, isActive: true, status: '승인' }); } }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>판매점 원장 수정</DialogTitle>
                  <DialogDescription>판매점코드: {drEditTarget?.dealerCode ?? '-'}</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-2">
                  <div className="space-y-1">
                    <Label>사업체명 *</Label>
                    <Input value={drForm.businessName} onChange={e => setDrForm(f => ({ ...f, businessName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>대표자명 *</Label>
                    <Input value={drForm.representativeName} onChange={e => setDrForm(f => ({ ...f, representativeName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>사업자번호 *</Label>
                    <Input value={drForm.businessNumber} onChange={e => setDrForm(f => ({ ...f, businessNumber: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>연락처 *</Label>
                    <Input value={drForm.contactPhone} onChange={e => setDrForm(f => ({ ...f, contactPhone: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>상태</Label>
                    <Select value={drForm.status} onValueChange={v => setDrForm(f => ({ ...f, status: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="승인">승인</SelectItem>
                        <SelectItem value="대기">대기</SelectItem>
                        <SelectItem value="거부">거부</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label>주소 *</Label>
                    <Input value={drForm.address} onChange={e => setDrForm(f => ({ ...f, address: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>은행명</Label>
                    <Input value={drForm.bankName} onChange={e => setDrForm(f => ({ ...f, bankName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>계좌번호</Label>
                    <Input value={drForm.bankAccount} onChange={e => setDrForm(f => ({ ...f, bankAccount: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>예금주</Label>
                    <Input value={drForm.accountHolder} onChange={e => setDrForm(f => ({ ...f, accountHolder: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>로그인 ID</Label>
                    <Input value={drForm.username} onChange={e => setDrForm(f => ({ ...f, username: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>새 비밀번호 (변경 시만 입력)</Label>
                    <Input type="password" placeholder="변경하지 않으면 비워두세요" value={drForm.password} onChange={e => setDrForm(f => ({ ...f, password: e.target.value }))} />
                  </div>
                  <div className="flex items-center gap-3 col-span-2">
                    <div className="flex items-center gap-2">
                      <Switch checked={drForm.isContactPolicyPos} onCheckedChange={v => setDrForm(f => ({ ...f, isContactPolicyPos: v }))} id="dr-edit-contact" />
                      <Label htmlFor="dr-edit-contact">접점정책점</Label>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Switch checked={drForm.isHiddenPos} onCheckedChange={v => setDrForm(f => ({ ...f, isHiddenPos: v }))} id="dr-edit-hidden" />
                      <Label htmlFor="dr-edit-hidden">히든정책점</Label>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <Switch checked={drForm.isActive} onCheckedChange={v => setDrForm(f => ({ ...f, isActive: v }))} id="dr-edit-active" />
                      <Label htmlFor="dr-edit-active">활성</Label>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDrEditDialogOpen(false)}>취소</Button>
                  <Button onClick={() => updateDrMutation.mutate({ id: drEditTarget.id, data: drForm })} disabled={updateDrMutation.isPending}>
                    {updateDrMutation.isPending ? '수정 중...' : '수정'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ── STEP 5D-6: 정산 결과 탭 ── */}
          <TabsContent value="settlement-results">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>정산 결과 관리</CardTitle>
                  <CardDescription>개통 데이터와 정책 단가를 매칭한 정산 결과를 조회·수정·확정합니다.</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <input
                    ref={siActivationUploadRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleActivationUpload}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadActivationTemplate}
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    업로드 양식
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => siActivationUploadRef.current?.click()}
                    disabled={siActivationUploading}
                  >
                    {siActivationUploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                    개통 업로드
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSettlementExport}
                    disabled={siExportLoading}
                  >
                    {siExportLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    엑셀 다운로드
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => siMatchMutation.mutate()}
                    disabled={siMatchMutation.isPending}
                  >
                    {siMatchMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <TrendingUp className="h-4 w-4 mr-1" />}
                    자동 매칭 실행
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => siRematchMutation.mutate()}
                    disabled={siRematchMutation.isPending}
                  >
                    {siRematchMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
                    미매칭 재매칭
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 업무 흐름 안내 */}
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 space-y-1">
                  <div className="font-semibold mb-1 flex items-center gap-1"><Info className="h-3.5 w-3.5" />정산 처리 순서</div>
                  {[
                    '정산 정책 탭에서 정책 차수와 단가 행을 먼저 등록합니다.',
                    '업로드 양식 버튼으로 양식을 내려받아 개통 데이터를 작성합니다.',
                    '개통 업로드 버튼으로 엑셀 파일을 업로드합니다.',
                    '자동 매칭 실행을 눌러 개통 데이터와 정책 단가를 매칭합니다.',
                    '검토필요·정책없음 건은 행 클릭 후 조정금액을 입력하거나 예외 정책을 지정합니다.',
                    '확인 완료된 건은 정산 확정 버튼으로 확정하고 엑셀 다운로드로 저장합니다.',
                  ].map((step, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 font-bold">{i + 1}.</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>

                {/* 요약 카드 */}
                {siData?.summary && (() => {
                  const s = siData.summary;
                  return (
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        { label: '전체', value: s.total, color: 'bg-gray-100' },
                        { label: '자동매칭', value: s.autoMatch, color: 'bg-green-100' },
                        { label: '검토필요', value: s.reviewRequired, color: 'bg-yellow-100' },
                        { label: '정책없음', value: s.policyNotFound, color: 'bg-red-100' },
                        { label: '정산완료', value: s.settlementDone, color: 'bg-blue-100' },
                      ].map(c => (
                        <div key={c.label} className={`rounded-lg p-3 text-center ${c.color}`}>
                          <div className="text-2xl font-bold">{c.value}</div>
                          <div className="text-xs text-gray-600 mt-1">{c.label}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* 필터 */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs mb-1 block">정산상태</Label>
                    <Select value={siFilterStatus || 'all'} onValueChange={v => { setSiFilterStatus(v === 'all' ? '' : v); setSiPage(1); }}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="전체" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="미정산">미정산</SelectItem>
                        <SelectItem value="정산완료">정산완료</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">매칭상태</Label>
                    <Select value={siFilterMatchStatus || 'all'} onValueChange={v => { setSiFilterMatchStatus(v === 'all' ? '' : v); setSiPage(1); }}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="전체" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">전체</SelectItem>
                        <SelectItem value="AUTO_MATCH">자동매칭</SelectItem>
                        <SelectItem value="REVIEW_REQUIRED">검토필요</SelectItem>
                        <SelectItem value="POLICY_NOT_FOUND">정책없음</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">개통일 시작</Label>
                    <Input type="date" className="h-8 text-sm" value={siFilterFrom} onChange={e => { setSiFilterFrom(e.target.value); setSiPage(1); }} />
                  </div>
                  <div>
                    <Label className="text-xs mb-1 block">개통일 종료</Label>
                    <Input type="date" className="h-8 text-sm" value={siFilterTo} onChange={e => { setSiFilterTo(e.target.value); setSiPage(1); }} />
                  </div>
                </div>

                {/* 판매점 그룹형 테이블 — 엑셀형 grid 스타일 */}
                {siLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
                ) : (() => {
                  const groups = siData?.groups ?? [];
                  if (groups.length === 0) {
                    return <div className="text-center py-8 text-gray-400 text-sm">데이터가 없습니다. 자동 매칭을 실행하세요.</div>;
                  }

                  /* ── 공통 스타일 상수 ── */
                  const thG: React.CSSProperties = { border: '1px solid #475569', padding: '7px 8px', fontWeight: 700, whiteSpace: 'nowrap', background: '#334155', color: 'white' };
                  const tdG: React.CSSProperties = { border: '1px solid #d1d5db', padding: '6px 8px', fontSize: '12px' };
                  const thD: React.CSSProperties = { background: '#475569', color: 'white', border: '1px solid #64748b', padding: '5px 6px', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '11px' };
                  const tdD: React.CSSProperties = { border: '1px solid #e2e8f0', padding: '4px 6px', fontSize: '11px' };

                  return (
                    <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '4px' }}>
                      {/* ━━ 집계 테이블 ━━ */}
                      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '860px' }}>
                        <colgroup>
                          <col style={{ width: '32px' }} />
                          <col style={{ width: '170px' }} />
                          <col style={{ width: '60px' }} />
                          <col style={{ width: '60px' }} />
                          <col style={{ width: '72px' }} />
                          <col style={{ width: '60px' }} />
                          <col style={{ width: '72px' }} />
                          <col style={{ width: '112px' }} />
                          <col style={{ width: '112px' }} />
                          <col style={{ width: '112px' }} />
                          <col />
                        </colgroup>
                        <thead>
                          <tr>
                            <th style={thG}></th>
                            <th style={{ ...thG, textAlign: 'left' }}>판매점명</th>
                            <th style={{ ...thG, textAlign: 'center' }}>총건수</th>
                            <th style={{ ...thG, textAlign: 'center', background: '#14532d', color: '#bbf7d0', borderColor: '#166534' }}>자동</th>
                            <th style={{ ...thG, textAlign: 'center', background: '#78350f', color: '#fde68a', borderColor: '#92400e' }}>검토필요</th>
                            <th style={{ ...thG, textAlign: 'center', background: '#7f1d1d', color: '#fecaca', borderColor: '#991b1b' }}>미매칭</th>
                            <th style={{ ...thG, textAlign: 'center', background: '#1e3a5f', color: '#bfdbfe', borderColor: '#1d4ed8' }}>정산완료</th>
                            <th style={{ ...thG, textAlign: 'right' }}>정책합계</th>
                            <th style={{ ...thG, textAlign: 'right' }}>조정합계</th>
                            <th style={{ ...thG, textAlign: 'right' }}>확정합계</th>
                            <th style={{ ...thG, textAlign: 'center' }}>액션</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map(g => {
                            const isOpen = siExpandedDealers.has(g.dealerName);
                            const groupBg = isOpen ? '#dbeafe' : '#eff6ff';
                            return (
                              <React.Fragment key={`g-${g.dealerName}`}>
                                {/* 집계 행 */}
                                <tr
                                  style={{ background: groupBg, cursor: 'pointer', fontWeight: 500 }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = '#bfdbfe'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = groupBg; }}
                                  onClick={() => setSiExpandedDealers(prev => {
                                    const next = new Set(prev);
                                    if (next.has(g.dealerName)) next.delete(g.dealerName);
                                    else next.add(g.dealerName);
                                    return next;
                                  })}
                                >
                                  <td style={{ ...tdG, textAlign: 'center' }}>
                                    {isOpen ? <ChevronDown className="h-3 w-3 text-blue-600 inline" /> : <ChevronRight className="h-3 w-3 text-blue-600 inline" />}
                                  </td>
                                  <td style={{ ...tdG, textAlign: 'left', maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.dealerName}>
                                    {g.dealerName}
                                  </td>
                                  <td style={{ ...tdG, textAlign: 'center' }}>{g.total}</td>
                                  <td style={{ ...tdG, textAlign: 'center', background: '#f0fdf4', color: '#15803d', fontWeight: 700 }}>{g.autoMatch || '-'}</td>
                                  <td style={{ ...tdG, textAlign: 'center', background: '#fffbeb', color: '#b45309', fontWeight: 700 }}>{g.reviewRequired || '-'}</td>
                                  <td style={{ ...tdG, textAlign: 'center', background: '#fef2f2', color: '#dc2626', fontWeight: 700 }}>{g.policyNotFound || '-'}</td>
                                  <td style={{ ...tdG, textAlign: 'center', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }}>{g.settlementDone || '-'}</td>
                                  <td style={{ ...tdG, textAlign: 'right' }}>{g.sumPolicy ? g.sumPolicy.toLocaleString() : '-'}</td>
                                  <td style={{ ...tdG, textAlign: 'right' }}>{g.sumAdjusted ? g.sumAdjusted.toLocaleString() : '-'}</td>
                                  <td style={{ ...tdG, textAlign: 'right', fontWeight: 700, color: '#1e40af' }}>{g.sumConfirmed ? g.sumConfirmed.toLocaleString() : '-'}</td>
                                  <td style={{ ...tdG }} onClick={e => e.stopPropagation()}>
                                    <div className="flex items-center gap-1.5">
                                      {g.settlementDone === g.total ? (
                                        <Badge className="text-xs">전체완료</Badge>
                                      ) : (
                                        <>
                                          {(g.reviewRequired > 0 || g.policyNotFound > 0) && (
                                            <span className="text-yellow-600 text-xs" title="검토필요/미매칭 건 포함">⚠</span>
                                          )}
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-6 px-2 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                            disabled={siLockMutation.isPending}
                                            onClick={() => {
                                              const pending = g.items.filter((i: any) => i.status !== '정산완료');
                                              if (pending.length === 0) return;
                                              const hasIssue = g.reviewRequired > 0 || g.policyNotFound > 0;
                                              const msg = hasIssue
                                                ? `⚠ "${g.dealerName}" 에 검토필요/미매칭 건이 포함되어 있습니다.\n미정산 ${pending.length}건 모두 확정하시겠습니까?`
                                                : `"${g.dealerName}" 미정산 ${pending.length}건을 모두 확정하시겠습니까?`;
                                              if (confirm(msg)) {
                                                pending.forEach((i: any) => siLockMutation.mutate(i.id));
                                              }
                                            }}
                                          >
                                            <CheckCircle className="h-3 w-3 mr-0.5" />
                                            전체확정
                                          </Button>
                                          {g.settlementDone > 0 && (
                                            <span className="text-xs text-gray-500">{g.settlementDone}/{g.total}</span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>

                                {/* 상세 펼침 — nested 엑셀형 테이블 */}
                                {isOpen && (
                                  <tr>
                                    <td colSpan={11} style={{ padding: 0, border: '1px solid #93c5fd', background: '#f8fafc' }}>
                                      <div style={{ overflowX: 'auto' }}>
                                        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '2100px' }}>
                                          <thead>
                                            <tr>
                                              {([
                                                { label: '개통일',     w: '96px',  a: 'center' },
                                                { label: '채널',       w: '120px', a: 'center' },
                                                { label: '판매점명',   w: '140px', a: 'left'   },
                                                { label: '고객명',     w: '80px',  a: 'center' },
                                                { label: '개통번호',   w: '100px', a: 'center' },
                                                { label: '접점코드',   w: '90px',  a: 'center' },
                                                { label: '실판매점명', w: '120px', a: 'left'   },
                                                { label: '구분',       w: '56px',  a: 'center' },
                                                { label: '요금제',     w: '200px', a: 'left'   },
                                                { label: '가입유형',   w: '60px',  a: 'center' },
                                                { label: '고객구분',   w: '64px',  a: 'center' },
                                                { label: '결합조건',   w: '80px',  a: 'center' },
                                                { label: '부가서비스', w: '80px',  a: 'center' },
                                                { label: '가입비',     w: '72px',  a: 'center' },
                                                { label: '매칭상태',   w: '64px',  a: 'center' },
                                                { label: '정책금액',   w: '88px',  a: 'right'  },
                                                { label: '추가금',     w: '76px',  a: 'right'  },
                                                { label: '차감금',     w: '76px',  a: 'right'  },
                                                { label: '히든금액',   w: '76px',  a: 'right'  },
                                                { label: '조정금액',   w: '88px',  a: 'right'  },
                                                { label: '확정금액',   w: '88px',  a: 'right'  },
                                                { label: '메모',       w: '100px', a: 'left'   },
                                                { label: '수정/확정',  w: '68px',  a: 'center' },
                                              ] as const).map(({ label, w, a }) => (
                                                <th key={label} style={{ ...thD, width: w, textAlign: a as any }}>{label}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {g.items.map((item: any) => {
                                              const ar = item.activationRecord;
                                              const isSubPos = ar?.realSalesPOS && item.dealerName && !isSameStoreName(item.dealerName, ar.realSalesPOS);
                                              const matchStatus = item.matchStatus;
                                              const matchBg    = matchStatus === 'AUTO_MATCH' ? '#f0fdf4' : matchStatus === 'REVIEW_REQUIRED' ? '#fffbeb' : '#fef2f2';
                                              const matchColor = matchStatus === 'AUTO_MATCH' ? '#15803d' : matchStatus === 'REVIEW_REQUIRED' ? '#b45309' : '#dc2626';
                                              const matchLabel = matchStatus === 'AUTO_MATCH' ? '자동'    : matchStatus === 'REVIEW_REQUIRED' ? '검토'   : '미매칭';
                                              const rowBg      = item.status === '정산완료' ? '#f0f9ff' : 'white';

                                              const finalAmount = (() => {
                                                if (item.lockedAmount != null) return Number(item.lockedAmount);
                                                const base = item.adjustedAmount != null ? Number(item.adjustedAmount) : (item.rebateAmount != null ? Number(item.rebateAmount) : null);
                                                if (base == null) return null;
                                                return base + (item.addAmount != null ? Number(item.addAmount) : 0) - (item.deductAmount != null ? Number(item.deductAmount) : 0) + (item.hiddenAmount != null ? Number(item.hiddenAmount) : 0);
                                              })();

                                              return (
                                                <tr key={`d-${item.id}`}
                                                  style={{ background: rowBg }}
                                                  onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = '#fefce8'; }}
                                                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = rowBg; }}
                                                >
                                                  {/* 개통일 */}
                                                  <td style={{ ...tdD, textAlign: 'center', color: '#64748b', whiteSpace: 'nowrap' }}>
                                                    {ar?.activationDatetime ? format(new Date(ar.activationDatetime), 'yyyy-MM-dd HH:mm', { locale: ko }) : '-'}
                                                  </td>
                                                  {/* 채널 */}
                                                  <td style={{ ...tdD, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ar?.channel ?? ''}>{ar?.channel ?? '-'}</td>
                                                  {/* 판매점명 */}
                                                  <td style={{ ...tdD, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.dealerName ?? ''}>
                                                    {item.dealerName ?? '-'}
                                                  </td>
                                                  {/* 고객명 */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>{ar?.customerName ?? '-'}</td>
                                                  {/* 개통번호 */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>{ar?.activationNumber ?? ar?.activation_number ?? '-'}</td>
                                                  {/* 접점코드 */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>{ar?.contactCode ?? '-'}</td>
                                                  {/* 실판매점명 */}
                                                  <td style={{ ...tdD, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ar?.realSalesPOS ?? ''}>
                                                    {ar?.realSalesPOS ?? '-'}
                                                  </td>
                                                  {/* 구분 (본점/하부점) */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    {ar?.realSalesPOS ? (
                                                      isSubPos
                                                        ? <span style={{ fontSize: 10, color: '#c2410c', background: '#ffedd5', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>하부점</span>
                                                        : <span style={{ fontSize: 10, color: '#15803d', background: '#f0fdf4', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>본점</span>
                                                    ) : '-'}
                                                  </td>
                                                  {/* 요금제 */}
                                                  <td style={{ ...tdD, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ar?.planName ?? ''}>{ar?.planName ?? '-'}</td>
                                                  {/* 가입유형 */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    {ar?.customerType === '1' ? '신규' : ar?.customerType === '2' ? '번이' : ar?.customerType ?? '-'}
                                                  </td>
                                                  {/* 고객구분 */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    <span style={{
                                                      fontSize: 10, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                                                      background: ar?.nationalityType === '외국인' ? '#fef3c7' : '#f0fdf4',
                                                      color: ar?.nationalityType === '외국인' ? '#92400e' : '#15803d',
                                                    }}>
                                                      {ar?.nationalityType ?? '내국인'}
                                                    </span>
                                                  </td>
                                                  {/* 결합조건 */}
                                                  <td style={{ ...tdD, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ar?.bundleType ?? ''}>{ar?.bundleType ?? '-'}</td>
                                                  {/* 부가서비스 */}
                                                  <td style={{ ...tdD, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ar?.addService ?? ''}>{ar?.addService ?? '-'}</td>
                                                  {/* 가입비 */}
                                                  <td style={{ ...tdD, textAlign: 'center', whiteSpace: 'nowrap' }}>{ar?.regFeeType ?? '-'}</td>
                                                  {/* 매칭상태 */}
                                                  <td style={{ ...tdD, textAlign: 'center', background: matchBg }}>
                                                    <span style={{ fontWeight: 700, color: matchColor }}>{matchLabel}</span>
                                                  </td>
                                                  {/* 정책금액 */}
                                                  <td style={{ ...tdD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    {item.rebateAmount ? Number(item.rebateAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}
                                                  </td>
                                                  {/* 추가금 */}
                                                  <td style={{ ...tdD, textAlign: 'right', whiteSpace: 'nowrap', color: '#15803d' }}>
                                                    {item.addAmount != null ? Number(item.addAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}
                                                  </td>
                                                  {/* 차감금 */}
                                                  <td style={{ ...tdD, textAlign: 'right', whiteSpace: 'nowrap', color: '#dc2626' }}>
                                                    {item.deductAmount != null ? Number(item.deductAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}
                                                  </td>
                                                  {/* 히든금액 */}
                                                  <td style={{ ...tdD, textAlign: 'right', whiteSpace: 'nowrap', color: '#7c3aed' }}>
                                                    {item.hiddenAmount != null ? Number(item.hiddenAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}
                                                  </td>
                                                  {/* 조정금액 */}
                                                  <td style={{ ...tdD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                    {item.adjustedAmount ? Number(item.adjustedAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}
                                                  </td>
                                                  {/* 확정금액 */}
                                                  <td style={{ ...tdD, textAlign: 'right', fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', whiteSpace: 'nowrap' }}>
                                                    {finalAmount != null ? finalAmount.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}
                                                  </td>
                                                  {/* 메모 */}
                                                  <td style={{ ...tdD, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9ca3af' }} title={item.memo ?? ''}>
                                                    {item.memo || '-'}
                                                  </td>
                                                  {/* 수정/확정 */}
                                                  <td style={{ ...tdD, textAlign: 'center' }}>
                                                    <div className="flex items-center justify-center gap-0.5">
                                                      <Button size="sm" variant="ghost" className="h-5 px-1 text-xs" disabled={item.status === '정산완료'}
                                                        onClick={e => {
                                                          e.stopPropagation();
                                                          setSiEditTarget(item);
                                                          setSiEditForm({
                                                            adjustedAmount: item.adjustedAmount ?? '',
                                                            addAmount: item.addAmount != null ? Number(item.addAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '',
                                                            deductAmount: item.deductAmount != null ? Number(item.deductAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '',
                                                            hiddenAmount: item.hiddenAmount != null ? Number(item.hiddenAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '',
                                                            status: item.status ?? '',
                                                            memo: item.memo ?? '',
                                                            forcePolicyVersionId: item.forcePolicyVersionId ? String(item.forcePolicyVersionId) : '',
                                                            forceReason: item.forceReason ?? '',
                                                          });
                                                          setSiEditDialogOpen(true);
                                                        }}>
                                                        <Edit className="h-3 w-3" />
                                                      </Button>
                                                      {item.status !== '정산완료' && (
                                                        <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 hover:bg-blue-50"
                                                          disabled={siLockMutation.isPending}
                                                          onClick={e => {
                                                            e.stopPropagation();
                                                            if (confirm(`ID ${item.id} 건을 정산 확정하시겠습니까?\n확정 후 수정 불가합니다.`)) {
                                                              siLockMutation.mutate(item.id);
                                                            }
                                                          }}>
                                                          <CheckCircle className="h-3 w-3" />
                                                        </Button>
                                                      )}
                                                    </div>
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {/* 페이징 */}
                {(() => {
                  const isLastPage = siPage * siLimit >= (siData?.totalGroups ?? 0);
                  return (
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">표시 개수</span>
                        {([30, 50, 100] as const).map(n => (
                          <Button
                            key={n}
                            variant={siLimit === n ? 'default' : 'outline'}
                            size="sm"
                            className="px-2 h-7 text-xs"
                            onClick={() => { setSiLimit(n); setSiPage(1); }}
                          >
                            {n}행
                          </Button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled={siPage <= 1} onClick={() => setSiPage(p => p - 1)}>이전</Button>
                        <span className="text-sm px-2 py-1">{siPage} 페이지</span>
                        <Button variant="outline" size="sm" disabled={isLastPage} onClick={() => setSiPage(p => p + 1)}>다음</Button>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* 수정 다이얼로그 */}
            <Dialog open={siEditDialogOpen} onOpenChange={setSiEditDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>정산 항목 수정</DialogTitle>
                  <DialogDescription>
                    {siEditTarget && `ID: ${siEditTarget.id} | 판매점: ${siEditTarget.dealerName ?? '-'}`}
                  </DialogDescription>
                </DialogHeader>
                {siEditTarget && (
                  <div className="space-y-3">
                    {/* 읽기 전용 정보 */}
                    <div className="bg-gray-50 rounded p-3 text-xs grid grid-cols-2 gap-2">
                      <div><span className="text-gray-500">매칭상태:</span> <span className="font-medium">{siEditTarget.matchStatus}</span></div>
                      <div><span className="text-gray-500">정책금액:</span> <span className="font-medium">{siEditTarget.rebateAmount ? Number(siEditTarget.rebateAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}</span></div>
                      <div><span className="text-gray-500">채널:</span> <span className="font-medium">{siEditTarget.activationRecord?.channel ?? '-'}</span></div>
                      <div><span className="text-gray-500">요금제:</span> <span className="font-medium">{siEditTarget.activationRecord?.planName ?? '-'}</span></div>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-sm">수동 조정금액</Label>
                      <Input
                        type="number"
                        placeholder="조정금액 입력 (숫자)"
                        value={siEditForm.adjustedAmount}
                        onChange={e => setSiEditForm(f => ({ ...f, adjustedAmount: e.target.value }))}
                      />
                      <p className="text-xs text-gray-400">입력 시 기본정책금액을 대체합니다.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-sm text-green-700">추가금</Label>
                        <Input
                          type="text"
                          placeholder="예: 5,000"
                          value={siEditForm.addAmount}
                          onChange={e => setSiEditForm(f => ({ ...f, addAmount: e.target.value }))}
                        />
                        <p className="text-xs text-gray-400">기본정책금액에 더해질 금액입니다.</p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm text-red-600">차감금</Label>
                        <Input
                          type="text"
                          placeholder="예: 3,000"
                          value={siEditForm.deductAmount}
                          onChange={e => setSiEditForm(f => ({ ...f, deductAmount: e.target.value }))}
                        />
                        <p className="text-xs text-gray-400">기본정책금액에서 차감될 금액입니다. 음수가 아닌 양수로 입력하세요.</p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm text-purple-700">히든금액</Label>
                      <Input
                        type="text"
                        placeholder="예: 10,000"
                        value={siEditForm.hiddenAmount}
                        onChange={e => setSiEditForm(f => ({ ...f, hiddenAmount: e.target.value }))}
                      />
                      <p className="text-xs text-gray-400">히든정책으로 추가 지급될 금액입니다. 자동 계산 후 수동 조정 가능합니다.</p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm">정산상태</Label>
                      <Select value={siEditForm.status || 'current'} onValueChange={v => setSiEditForm(f => ({ ...f, status: v === 'current' ? f.status : v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="미정산">미정산</SelectItem>
                          <SelectItem value="보류">보류</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-sm">예외 정책차수 ID</Label>
                      <Input
                        type="number"
                        placeholder="강제 지정할 정책차수 ID"
                        value={siEditForm.forcePolicyVersionId}
                        onChange={e => setSiEditForm(f => ({ ...f, forcePolicyVersionId: e.target.value }))}
                      />
                    </div>
                    {siEditForm.forcePolicyVersionId && (
                      <div className="space-y-1">
                        <Label className="text-sm">예외사유 <span className="text-red-500">*</span></Label>
                        <Input
                          placeholder="예외사유 필수 입력"
                          value={siEditForm.forceReason}
                          onChange={e => setSiEditForm(f => ({ ...f, forceReason: e.target.value }))}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-sm">메모</Label>
                      <Textarea
                        rows={2}
                        placeholder="메모 입력"
                        value={siEditForm.memo}
                        onChange={e => setSiEditForm(f => ({ ...f, memo: e.target.value }))}
                      />
                    </div>
                    <div className="flex justify-between gap-2 pt-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={siEditTarget.status === '정산완료' || siLockMutation.isPending}
                        onClick={() => {
                          if (confirm(`ID ${siEditTarget.id} 항목을 정산 확정하시겠습니까?\n확정 후에는 수정할 수 없습니다.`)) {
                            siLockMutation.mutate(siEditTarget.id);
                          }
                        }}
                      >
                        {siLockMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <CheckCircle className="h-3 w-3 mr-1" />}
                        정산 확정
                      </Button>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setSiEditDialogOpen(false)}>취소</Button>
                        <Button
                          size="sm"
                          disabled={siEditTarget.status === '정산완료' || siUpdateMutation.isPending}
                          onClick={() => {
                            const rawAdd = siEditForm.addAmount.replace(/,/g, '');
                            const rawDeduct = siEditForm.deductAmount.replace(/,/g, '');
                            const rawHidden = siEditForm.hiddenAmount.replace(/,/g, '');
                            if (rawAdd !== '' && isNaN(Number(rawAdd))) {
                              toast({ title: '오류', description: '추가금은 숫자로 입력해주세요.', variant: 'destructive' }); return;
                            }
                            if (rawDeduct !== '' && isNaN(Number(rawDeduct))) {
                              toast({ title: '오류', description: '차감금은 숫자로 입력해주세요.', variant: 'destructive' }); return;
                            }
                            if (rawHidden !== '' && isNaN(Number(rawHidden))) {
                              toast({ title: '오류', description: '히든금액은 숫자로 입력해주세요.', variant: 'destructive' }); return;
                            }
                            if (rawAdd !== '' && Number(rawAdd) < 0) {
                              toast({ title: '오류', description: '추가금은 양수로 입력해주세요.', variant: 'destructive' }); return;
                            }
                            if (rawDeduct !== '' && Number(rawDeduct) < 0) {
                              toast({ title: '오류', description: '차감금은 양수로 입력해주세요.', variant: 'destructive' }); return;
                            }
                            const patch: any = {};
                            if (siEditForm.adjustedAmount !== '') patch.adjustedAmount = siEditForm.adjustedAmount;
                            patch.addAmount    = rawAdd    !== '' ? rawAdd    : null;
                            patch.deductAmount = rawDeduct !== '' ? rawDeduct : null;
                            patch.hiddenAmount = rawHidden !== '' ? rawHidden : null;
                            if (siEditForm.status)            patch.status = siEditForm.status;
                            if (siEditForm.memo !== '')        patch.memo = siEditForm.memo;
                            if (siEditForm.forcePolicyVersionId !== '') {
                              patch.forcePolicyVersionId = Number(siEditForm.forcePolicyVersionId);
                              patch.forceReason = siEditForm.forceReason;
                            }
                            siUpdateMutation.mutate({ id: siEditTarget.id, data: patch });
                          }}
                        >
                          {siUpdateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                          저장
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ── STEP 5D-7: 정산 정책 탭 ── */}
          <TabsContent value="policy-versions">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {/* 좌측: 정책 차수 목록 */}
              <div className="md:col-span-2">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <CardTitle className="text-base">정책 차수 목록</CardTitle>
                    <Button size="sm" onClick={() => { setPvForm({ policyNo: '', policyName: '', effectiveFrom: '', effectiveTo: '', memo: '' }); setPvCreateOpen(true); }}>
                      <Plus className="h-3 w-3 mr-1" />신규
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    {pvLoading ? (
                      <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
                    ) : (policyVersions ?? []).length === 0 ? (
                      <p className="text-center text-sm text-gray-400 py-6">정책 차수가 없습니다.</p>
                    ) : (
                      <ul className="divide-y">
                        {(policyVersions ?? []).map((pv: any) => (
                          <li
                            key={pv.id}
                            className={`px-4 py-3 cursor-pointer hover:bg-gray-50 flex items-start justify-between gap-2 ${pvSelectedId === pv.id ? 'bg-blue-50' : ''}`}
                            onClick={() => setPvSelectedId(pv.id)}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm truncate">{pv.policyName}</span>
                                {pv.isActive ? (
                                  <Badge className="text-xs shrink-0">활성</Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs shrink-0">비활성</Badge>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">{pv.policyNo} · {pv.effectiveFrom ? pv.effectiveFrom.slice(0, 10) : '-'}</div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Button
                                size="sm" variant="ghost" className="h-6 w-6 p-0"
                                onClick={e => { e.stopPropagation(); setPvEditTarget(pv); setPvForm({ policyNo: pv.policyNo, policyName: pv.policyName, effectiveFrom: pv.effectiveFrom?.slice(0,16) ?? '', effectiveTo: pv.effectiveTo?.slice(0,16) ?? '', memo: pv.memo ?? '' }); setPvEditOpen(true); }}
                              ><Edit className="h-3 w-3" /></Button>
                              {pv.isActive && (
                                <Button
                                  size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                                  onClick={e => { e.stopPropagation(); if (confirm(`"${pv.policyName}" 을 비활성화합니까?`)) pvDeactivateMutation.mutate(pv.id); }}
                                ><Trash2 className="h-3 w-3" /></Button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* 우측: 단가 행 */}
              <div className="md:col-span-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-3">
                    <div>
                      <CardTitle className="text-base">
                        {pvSelectedId ? `단가 행 — v${pvSelectedId}` : '단가 행'}
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {pvSelectedId ? '좌측 차수를 클릭하면 단가 행을 확인합니다.' : '좌측에서 정책 차수를 선택하세요.'}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setPeFile(null); setPePvId(pvSelectedId ? String(pvSelectedId) : '__auto__'); setPeResult(null); setPeOpen(true); if (peFileRef.current) peFileRef.current.value = ''; }}>
                        엑셀 업로드
                      </Button>
                      <Button size="sm" variant="outline" className="border-green-400 text-green-700 hover:bg-green-50" onClick={() => { setOrgFile(null); setOrgResult(null); setOrgOpen(true); if (orgFileRef.current) orgFileRef.current.value = ''; }}>
                        원본 정책표 자동 인식
                      </Button>
                      <Button size="sm" variant="outline" className="border-blue-300 text-blue-700 hover:bg-blue-50" onClick={() => { setChFile(null); setChPvId(pvSelectedId ? String(pvSelectedId) : ''); setChResult(null); setChOpen(true); if (chFileRef.current) chFileRef.current.value = ''; }}>
                        채널별 수정파일 업로드
                      </Button>
                      {pvSelectedId && (
                        <Button size="sm" onClick={() => { setPrForm({ channel: '', planName: '', customerType: '1', simCount: '', bundleType: '', addService: '', regFeeType: '', rebateAmount: '', memo: '' }); setPrCreateOpen(true); }}>
                          <Plus className="h-3 w-3 mr-1" />행 추가
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {/* 단가 행 필터 */}
                    {pvSelectedId && (
                      <div className="flex flex-wrap gap-2 p-2 border-b bg-gray-50 text-xs">
                        <select
                          className="border rounded h-7 px-1.5 text-xs bg-white"
                          value={prFilterChannel}
                          onChange={e => setPrFilterChannel(e.target.value)}
                        >
                          <option value="">채널 전체</option>
                          {Array.from(new Set((policyRowsData ?? []).map((r: any) => r.channel).filter(Boolean))).sort().map((ch: any) => (
                            <option key={ch} value={ch}>{ch}</option>
                          ))}
                        </select>
                        <input
                          className="border rounded h-7 px-1.5 text-xs w-40"
                          placeholder="요금제 검색"
                          value={prFilterPlan}
                          onChange={e => setPrFilterPlan(e.target.value)}
                        />
                        <select
                          className="border rounded h-7 px-1.5 text-xs bg-white"
                          value={prFilterNat}
                          onChange={e => setPrFilterNat(e.target.value)}
                        >
                          <option value="all">국적 전체</option>
                          <option value="내국인">내국인</option>
                          <option value="외국인">외국인</option>
                          <option value="공통">공통(NULL)</option>
                        </select>
                        <select
                          className="border rounded h-7 px-1.5 text-xs bg-white"
                          value={prFilterType}
                          onChange={e => setPrFilterType(e.target.value)}
                        >
                          <option value="all">유형 전체</option>
                          <option value="1">신규</option>
                          <option value="2">번이</option>
                        </select>
                        <select
                          className="border rounded h-7 px-1.5 text-xs bg-white"
                          value={prFilterActive}
                          onChange={e => setPrFilterActive(e.target.value)}
                        >
                          <option value="active">활성만</option>
                          <option value="all">전체</option>
                          <option value="inactive">비활성만</option>
                        </select>
                        <button
                          className="border rounded h-7 px-2 text-xs bg-white hover:bg-gray-100"
                          onClick={() => { setPrFilterChannel(''); setPrFilterPlan(''); setPrFilterNat('all'); setPrFilterType('all'); setPrFilterActive('active'); }}
                        >초기화</button>
                        <span className="text-gray-400 self-center">
                          {(() => {
                            const filtered = (policyRowsData ?? []).filter((row: any) => {
                              if (prFilterChannel && row.channel !== prFilterChannel) return false;
                              if (prFilterPlan && !String(row.planName ?? '').includes(prFilterPlan)) return false;
                              if (prFilterNat !== 'all') {
                                if (prFilterNat === '공통') { if (row.nationalityType != null && row.nationalityType !== '') return false; }
                                else { if (row.nationalityType !== prFilterNat) return false; }
                              }
                              if (prFilterType !== 'all' && row.customerType !== prFilterType) return false;
                              if (prFilterActive === 'active' && row.isActive === false) return false;
                              if (prFilterActive === 'inactive' && row.isActive !== false) return false;
                              return true;
                            });
                            return `${filtered.length}/${(policyRowsData ?? []).length}건`;
                          })()}
                        </span>
                      </div>
                    )}
                    {!pvSelectedId ? (
                      <p className="text-center text-sm text-gray-400 py-8">정책 차수를 선택하세요.</p>
                    ) : (policyRowsData ?? []).length === 0 ? (
                      <p className="text-center text-sm text-gray-400 py-8">단가 행이 없습니다. "행 추가"를 눌러 추가하세요.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              {['채널','요금제','유형','국적','유심','결합조건','부가서비스조건','가입비조건','기본정책금액','상태',''].map(h => (
                                <th key={h} className="text-left px-2 py-2 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(policyRowsData ?? []).filter((row: any) => {
                              if (prFilterChannel && row.channel !== prFilterChannel) return false;
                              if (prFilterPlan && !String(row.planName ?? '').includes(prFilterPlan)) return false;
                              if (prFilterNat !== 'all') {
                                if (prFilterNat === '공통') { if (row.nationalityType != null && row.nationalityType !== '') return false; }
                                else { if (row.nationalityType !== prFilterNat) return false; }
                              }
                              if (prFilterType !== 'all' && row.customerType !== prFilterType) return false;
                              if (prFilterActive === 'active' && row.isActive === false) return false;
                              if (prFilterActive === 'inactive' && row.isActive !== false) return false;
                              return true;
                            }).map((row: any) => (
                              <tr key={row.id} className={`border-b ${row.isActive === false ? 'opacity-40' : 'hover:bg-gray-50'}`}>
                                <td className="px-2 py-2 max-w-[80px] truncate" title={row.channel}>{row.channel}</td>
                                <td className="px-2 py-2 max-w-[100px] truncate" title={row.planName}>{row.planName}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{row.customerType === '1' ? '신규' : row.customerType === '2' ? '번이' : row.customerType}</td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  {row.nationalityType
                                    ? <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: row.nationalityType === '외국인' ? '#fef3c7' : '#f0fdf4', color: row.nationalityType === '외국인' ? '#92400e' : '#15803d' }}>{row.nationalityType}</span>
                                    : <span className="text-gray-400 text-xs">전체</span>
                                  }
                                </td>
                                <td className="px-2 py-2">{row.simCount ?? '-'}</td>
                                <td className="px-2 py-2 max-w-[60px] truncate">{row.bundleType ?? '-'}</td>
                                <td className="px-2 py-2 max-w-[60px] truncate">{row.addService ?? '-'}</td>
                                <td className="px-2 py-2">{row.regFeeType ?? '-'}</td>
                                <td className="px-2 py-2 text-right font-medium">{row.rebateAmount ? Number(row.rebateAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}</td>
                                <td className="px-2 py-2">
                                  <Badge variant={row.isActive !== false ? 'default' : 'secondary'} className="text-xs">
                                    {row.isActive !== false ? '활성' : '비활성'}
                                  </Badge>
                                </td>
                                <td className="px-2 py-2">
                                  <div className="flex items-center gap-1">
                                    <Button
                                      size="sm" variant="ghost" className="h-5 w-5 p-0 text-gray-400 hover:text-blue-600"
                                      onClick={() => {
                                        setPrEditTarget(row);
                                        setPrEditForm({
                                          channel: row.channel ?? '',
                                          planName: row.planName ?? '',
                                          customerType: row.customerType ?? '1',
                                          nationalityType: row.nationalityType ?? '',
                                          simCount: row.simCount != null ? String(row.simCount) : '',
                                          bundleType: row.bundleType ?? '',
                                          addService: row.addService ?? '',
                                          regFeeType: row.regFeeType ?? '',
                                          rebateAmount: row.rebateAmount != null ? Number(row.rebateAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '',
                                          memo: row.memo ?? '',
                                          isActive: row.isActive !== false,
                                        });
                                        setPrEditOpen(true);
                                      }}
                                    ><Edit2 className="h-3 w-3" /></Button>
                                    {row.isActive !== false && (
                                      <Button
                                        size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400 hover:text-red-600"
                                        onClick={() => { if (confirm('이 단가 행을 비활성화합니까?')) prDeactivateMutation.mutate(row.id); }}
                                      ><Trash2 className="h-3 w-3" /></Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* ── 추가/차감 규칙 섹션 ── */}
            {pvSelectedId && (
              <div className="mt-4">
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold">추가/차감 규칙</CardTitle>
                      <p className="text-xs text-gray-500 mt-0.5">신규 정산 항목 생성 시 조건에 맞는 규칙이 자동 적용됩니다.</p>
                    </div>
                    <Button size="sm" onClick={() => { setArForm(arFormDefault); setArCreateOpen(true); }}>
                      <Plus className="h-3 w-3 mr-1" />규칙 추가
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    {(arData ?? []).length === 0 ? (
                      <p className="text-center text-sm text-gray-400 py-6">등록된 규칙이 없습니다.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="bg-gray-50 border-b">
                              {['상태','채널','요금제','유형','조건종류','조건값','구분','금액','메모','관리'].map(h => (
                                <th key={h} className="text-left px-2 py-2 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(arData ?? []).map((rule: any) => (
                              <tr key={rule.id} className={`border-b ${rule.isActive === false ? 'opacity-40' : 'hover:bg-gray-50'}`}>
                                <td className="px-2 py-2"><Badge variant={rule.isActive !== false ? 'default' : 'secondary'} className="text-xs">{rule.isActive !== false ? '활성' : '비활성'}</Badge></td>
                                <td className="px-2 py-2">{rule.channel || '전체'}</td>
                                <td className="px-2 py-2 max-w-[100px] truncate" title={rule.planName}>{rule.planName || '전체'}</td>
                                <td className="px-2 py-2 whitespace-nowrap">{rule.customerType === '1' ? '신규' : rule.customerType === '2' ? '번이' : rule.customerType || '전체'}</td>
                                <td className="px-2 py-2 whitespace-nowrap text-blue-700">{rule.conditionType}</td>
                                <td className="px-2 py-2">{rule.conditionValue || '-'}</td>
                                <td className="px-2 py-2"><Badge variant={rule.adjustmentType === 'ADD' ? 'default' : 'destructive'} className="text-xs">{rule.adjustmentType === 'ADD' ? '추가' : '차감'}</Badge></td>
                                <td className="px-2 py-2 text-right font-medium">{rule.amount ? Number(rule.amount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}</td>
                                <td className="px-2 py-2 text-gray-400 max-w-[80px] truncate">{rule.memo || '-'}</td>
                                <td className="px-2 py-2">
                                  <div className="flex items-center gap-1">
                                    <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-gray-400 hover:text-blue-600" onClick={() => { setArEditTarget(rule); setArEditForm({ channel: rule.channel ?? '', planName: rule.planName ?? '', customerType: rule.customerType ?? '', conditionType: rule.conditionType ?? 'BUNDLE_EXISTS', conditionValue: rule.conditionValue ?? '', adjustmentType: rule.adjustmentType ?? 'ADD', amount: rule.amount != null ? Number(rule.amount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '', isActive: rule.isActive !== false, memo: rule.memo ?? '' }); setArEditOpen(true); }}><Edit2 className="h-3 w-3" /></Button>
                                    {rule.isActive !== false && (
                                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400 hover:text-red-600" onClick={() => { if (confirm('이 규칙을 비활성화합니까?')) arDeactivateMutation.mutate(rule.id); }}><Trash2 className="h-3 w-3" /></Button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── 히든정책 섹션 ── */}
            <div className="mt-4">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold">히든정책 관리</CardTitle>
                    <p className="text-xs text-gray-500 mt-0.5">히든정책 판매점(isHiddenPos=true)에 대한 히든금액 자동 적용 규칙입니다.</p>
                  </div>
                  <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setHpRecalcResult(null); setHpRecalcOpen(true); }}>
                    히든금액 재계산
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setHpForm(hpFormDefault); setHpCreateOpen(true); }}>
                    <Plus className="h-3 w-3 mr-1" />추가
                  </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-2">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          {['활성','판매점','접점코드','채널','요금제','유형','히든금액','적용시작일','적용종료일','메모','관리'].map(h => (
                            <th key={h} className="text-left px-2 py-2 font-medium text-gray-600 whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(hpData ?? []).map((row: any) => {
                          const drMatch = row.dealerRegistrationId != null ? (dealerListForCC as any[]).find((d: any) => d.id === row.dealerRegistrationId) : null;
                          const dealerLabel = drMatch ? `[${drMatch.dealerCode ?? drMatch.id}] ${drMatch.businessName}${drMatch.isHiddenPos ? ' ★' : ''}` : (row.dealerRegistrationId != null ? `ID:${row.dealerRegistrationId}` : '전체');
                          return (
                          <tr key={row.id} className={`border-b ${row.isActive === false ? 'opacity-40' : 'hover:bg-gray-50'}`}>
                            <td className="px-2 py-2"><Badge variant={row.isActive !== false ? 'default' : 'secondary'} className="text-xs">{row.isActive !== false ? '활성' : '비활성'}</Badge></td>
                            <td className="px-2 py-2 whitespace-nowrap max-w-[160px] truncate" title={dealerLabel}>{dealerLabel}</td>
                            <td className="px-2 py-2">{row.contactCode || '전체'}</td>
                            <td className="px-2 py-2">{row.channel || '전체'}</td>
                            <td className="px-2 py-2 max-w-[120px] truncate" title={row.planName}>{row.planName || '전체'}</td>
                            <td className="px-2 py-2 whitespace-nowrap">{row.customerType === '1' ? '신규' : row.customerType === '2' ? '번이' : row.customerType || '전체'}</td>
                            <td className="px-2 py-2 text-right font-medium text-purple-700">{row.hiddenAmount ? Number(row.hiddenAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '-'}</td>
                            <td className="px-2 py-2 whitespace-nowrap">{row.effectiveFrom ? new Date(row.effectiveFrom).toLocaleDateString('ko-KR') : '-'}</td>
                            <td className="px-2 py-2 whitespace-nowrap">{row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString('ko-KR') : '-'}</td>
                            <td className="px-2 py-2 text-gray-400 max-w-[80px] truncate">{row.memo || '-'}</td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-gray-400 hover:text-blue-600" onClick={() => {
                                  setHpEditTarget(row);
                                  const editDrId = row.dealerRegistrationId != null ? String(row.dealerRegistrationId) : '';
                                  setHpEditForm({
                                    dealerRegistrationId: editDrId,
                                    contactCode: row.contactCode ?? '',
                                    channel: row.channel ?? '',
                                    planName: row.planName ?? '',
                                    customerType: row.customerType ?? '',
                                    hiddenAmount: row.hiddenAmount != null ? Number(row.hiddenAmount).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '',
                                    effectiveFrom: row.effectiveFrom ? new Date(row.effectiveFrom).toISOString().slice(0,10) : '',
                                    effectiveTo: row.effectiveTo ? new Date(row.effectiveTo).toISOString().slice(0,10) : '',
                                    isActive: row.isActive !== false,
                                    memo: row.memo ?? '',
                                  });
                                  loadHpDialogCCList(editDrId);
                                  setHpEditOpen(true);
                                }}><Edit2 className="h-3 w-3" /></Button>
                                {row.isActive !== false && (
                                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0 text-red-400 hover:text-red-600" onClick={() => { if (confirm('이 히든정책을 비활성화합니까?')) hpDeactivateMutation.mutate(row.id); }}><Trash2 className="h-3 w-3" /></Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ); })}
                        {(hpData ?? []).length === 0 && (
                          <tr><td colSpan={11} className="px-2 py-4 text-center text-gray-400">등록된 히든정책이 없습니다.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 히든금액 재계산 다이얼로그 */}
            <Dialog open={hpRecalcOpen} onOpenChange={o => { setHpRecalcOpen(o); if (!o) { setHpRecalcResult(null); setHpRecalcDebugCC(''); } }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>히든금액 재계산</DialogTitle>
                  <DialogDescription>미확정 정산건의 hiddenAmount만 재계산합니다. 확정 건과 lockedAmount는 변경되지 않습니다.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">개통일 시작 <span className="text-gray-400">(미입력=전체)</span></Label>
                      <Input type="date" value={hpRecalcFrom} onChange={e => setHpRecalcFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">개통일 종료 <span className="text-gray-400">(미입력=전체)</span></Label>
                      <Input type="date" value={hpRecalcTo} onChange={e => setHpRecalcTo(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">접점코드 진단 <span className="text-gray-400">(입력 시 해당 코드의 처리 흐름 상세 추적)</span></Label>
                    <Input placeholder="예: K엠45172 (선택 사항)" value={hpRecalcDebugCC} onChange={e => setHpRecalcDebugCC(e.target.value)} className="font-mono text-xs" />
                  </div>
                  {hpRecalcResult && (
                    <div className={`rounded border p-3 text-xs space-y-1 ${hpRecalcResult.dryRun ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
                      <div className={`font-semibold mb-1 ${hpRecalcResult.dryRun ? 'text-yellow-800' : 'text-green-800'}`}>
                        {hpRecalcResult.dryRun ? '시뮬레이션 결과 (DB 미반영)' : '재계산 완료'}
                      </div>
                      <div>대상: <span className="font-medium">{hpRecalcResult.totalTargets}건</span></div>
                      <div>업데이트: <span className="font-medium text-green-700">{hpRecalcResult.updated}건</span></div>
                      <div>초기화(null): <span className="font-medium">{hpRecalcResult.cleared}건</span>
                        {hpRecalcResult.cleared > 0 && (
                          <span className="text-gray-400 ml-1">
                            (판매점 미연결: {hpRecalcResult.skippedNoDealer ?? 0}건,
                            히든POS 아님: {hpRecalcResult.skippedNotHiddenPos ?? 0}건,
                            정책 없음: {hpRecalcResult.skippedNoPolicy ?? 0}건)
                          </span>
                        )}
                      </div>
                      {hpRecalcResult.skippedNoPolicy > 0 && hpRecalcResult.policyMismatchDetail && (() => {
                        const d = hpRecalcResult.policyMismatchDetail;
                        const parts: string[] = [];
                        if (d.dealerMismatch) parts.push(`딜러: ${d.dealerMismatch}`);
                        if (d.contactCodeMismatch) parts.push(`접점코드: ${d.contactCodeMismatch}`);
                        if (d.channelMismatch) parts.push(`채널: ${d.channelMismatch}`);
                        if (d.planNameMismatch) parts.push(`요금제: ${d.planNameMismatch}`);
                        if (d.customerTypeMismatch) parts.push(`유형: ${d.customerTypeMismatch}`);
                        if (d.periodMismatch) parts.push(`기간: ${d.periodMismatch}`);
                        return parts.length > 0 ? (
                          <div className="text-gray-400 ml-2">↳ 불일치 사유: {parts.join(', ')}</div>
                        ) : null;
                      })()}
                      <div className="text-gray-500">확정 제외: {hpRecalcResult.skippedLocked}건</div>
                      <div className="text-gray-500">접점코드 없음: {hpRecalcResult.skippedNoContactCode}건</div>
                      {hpRecalcResult.errors?.length > 0 && (
                        <div className="text-red-600">오류: {hpRecalcResult.errors.length}건</div>
                      )}
                      {hpRecalcResult.debug && (() => {
                        const dbg = hpRecalcResult.debug;
                        const cf = dbg.currentFlow;
                        const rf = dbg.realSalesPOSFlow;
                        return (
                          <div className="mt-2 border-t pt-2 border-yellow-300">
                            <div className="font-semibold text-yellow-800 mb-1">진단: {dbg.contactCode}</div>
                            <div className={dbg.inTargetSet ? 'text-green-700' : 'text-red-600'}>
                              대상 포함: {dbg.inTargetSet ? `✅ (siId=${dbg.siId}, status=${dbg.siStatus})` : '❌ 대상 기간에 없음'}
                            </div>
                            {dbg.inTargetSet && (
                              <>
                                <div className="mt-1 font-medium text-yellow-700">[현재 흐름 — 정산지급처 DR 기준]</div>
                                <div>dealerRegId: {cf.dealerRegIdFromCC ?? 'null'}</div>
                                {cf.drByRegId && <div>DR: {cf.drByRegId.dealerCode} / {cf.drByRegId.businessName} / isHiddenPos={String(cf.isHiddenPosByRegId)}</div>}
                                {cf.skipReason && <div className="text-red-600">⛔ 스킵: {cf.skipReason}</div>}
                                {cf.policyTrace?.length > 0 && (
                                  <div className="ml-2 space-y-0.5">
                                    {cf.policyTrace.map((t: any, i: number) => (
                                      <div key={i} className={t.result === 'MATCH' ? 'text-green-700' : 'text-gray-500'}>
                                        {t.result === 'MATCH' ? `✓ policy#${t.policyId} → ${t.hiddenAmount}원` : `✗ policy#${t.policyId}: ${t.reason}`}
                                      </div>
                                    ))}
                                    <div className="font-medium">합계: {cf.hiddenAmount}원</div>
                                  </div>
                                )}
                                <div className="mt-1 font-medium text-blue-700">[realSalesPOS 흐름 — 참고]</div>
                                <div>realSalesPOS: {rf.realSalesPOS ?? 'null'}</div>
                                {rf.note && <div className="text-blue-600">{rf.note}</div>}
                                {rf.policyTrace?.length > 0 && (
                                  <div className="ml-2 space-y-0.5">
                                    {rf.policyTrace.map((t: any, i: number) => (
                                      <div key={i} className={t.result === 'MATCH' ? 'text-green-700' : 'text-gray-500'}>
                                        {t.result === 'MATCH' ? `✓ policy#${t.policyId} → ${t.hiddenAmount}원` : `✗ policy#${t.policyId}: ${t.reason}`}
                                      </div>
                                    ))}
                                    <div className="font-medium text-blue-700">합계: {rf.hiddenAmount}원</div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" onClick={() => setHpRecalcOpen(false)}>닫기</Button>
                  <Button variant="secondary" size="sm" disabled={hpRecalcRunning} onClick={() => handleHpRecalc(true)}>
                    {hpRecalcRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}시뮬레이션
                  </Button>
                  <Button size="sm" disabled={hpRecalcRunning} onClick={async () => {
                    if (!confirm('현재 조건의 미확정 정산건 히든금액만 재계산합니다.\n확정 건과 최종확정금액은 변경되지 않습니다.\n진행하시겠습니까?')) return;
                    await handleHpRecalc(false);
                  }}>
                    {hpRecalcRunning ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}실행
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 히든정책 등록 다이얼로그 */}
            <Dialog open={hpCreateOpen} onOpenChange={o => { setHpCreateOpen(o); if (!o) { setHpForm(hpFormDefault); setHpDialogCCList([]); } }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>히든정책 등록</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">판매점 <span className="text-gray-400">(선택 안 함 = 전체)</span></Label>
                    <Select value={hpForm.dealerRegistrationId || '__all__'} onValueChange={v => { const newId = v === '__all__' ? '' : v; setHpForm(f => ({ ...f, dealerRegistrationId: newId, contactCode: '' })); loadHpDialogCCList(newId); }}>
                      <SelectTrigger><SelectValue placeholder="판매점 선택 (전체)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">전체 (판매점 무관)</SelectItem>
                        {(dealerListForCC as any[]).map((d: any) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            [{d.dealerCode ?? d.id}] {d.businessName}{d.isHiddenPos ? ' ★히든' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">접점코드 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    {hpForm.dealerRegistrationId && hpDialogCCList.length > 0 ? (
                      <Select value={hpForm.contactCode || '__all__'} onValueChange={v => setHpForm(f => ({ ...f, contactCode: v === '__all__' ? '' : v }))}>
                        <SelectTrigger><SelectValue placeholder="접점코드 선택 (전체)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">전체 (접점코드 무관)</SelectItem>
                          {hpDialogCCList.map((cc: any) => (
                            <SelectItem key={cc.id} value={cc.code}>{cc.code}{cc.realSalesPOS ? ` (${cc.realSalesPOS})` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input placeholder="예: M0001" value={hpForm.contactCode} onChange={e => setHpForm(f => ({ ...f, contactCode: e.target.value }))} />
                    )}
                    {hpForm.dealerRegistrationId && hpDialogCCList.length > 0 && hpForm.contactCode && !hpDialogCCList.some((cc: any) => cc.code === hpForm.contactCode) && (
                      <p className="text-xs text-amber-600 mt-1">⚠ 이 접점코드는 선택된 판매점에 등록되지 않았습니다.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">채널 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    <Input placeholder="예: 후불)엠모바일" value={hpForm.channel} onChange={e => setHpForm(f => ({ ...f, channel: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">요금제 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    <Input placeholder="예: 이동의즐거움 5G" value={hpForm.planName} onChange={e => setHpForm(f => ({ ...f, planName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">유형 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    <Select value={hpForm.customerType || '__all__'} onValueChange={v => setHpForm(f => ({ ...f, customerType: v === '__all__' ? '' : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">전체</SelectItem>
                        <SelectItem value="1">신규</SelectItem>
                        <SelectItem value="2">번이</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-purple-700">히든금액 *</Label>
                    <Input placeholder="예: 10,000" value={hpForm.hiddenAmount} onChange={e => setHpForm(f => ({ ...f, hiddenAmount: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">적용시작일</Label>
                    <Input type="date" value={hpForm.effectiveFrom} onChange={e => setHpForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">적용종료일</Label>
                    <Input type="date" value={hpForm.effectiveTo} onChange={e => setHpForm(f => ({ ...f, effectiveTo: e.target.value }))} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">메모</Label>
                    <Input placeholder="메모 입력" value={hpForm.memo} onChange={e => setHpForm(f => ({ ...f, memo: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setHpCreateOpen(false)}>취소</Button>
                  <Button disabled={hpCreateMutation.isPending} onClick={() => {
                    const rawAmt = hpForm.hiddenAmount.replace(/,/g, '');
                    if (!rawAmt || isNaN(Number(rawAmt))) { toast({ title: '오류', description: '히든금액은 숫자로 입력해주세요.', variant: 'destructive' }); return; }
                    const data: any = { hiddenAmount: rawAmt, isActive: hpForm.isActive };
                    if (hpForm.dealerRegistrationId) data.dealerRegistrationId = Number(hpForm.dealerRegistrationId);
                    if (hpForm.contactCode.trim()) data.contactCode = hpForm.contactCode.trim();
                    if (hpForm.channel.trim()) data.channel = hpForm.channel.trim();
                    if (hpForm.planName.trim()) data.planName = hpForm.planName.trim();
                    if (hpForm.customerType) data.customerType = hpForm.customerType;
                    if (hpForm.effectiveFrom) data.effectiveFrom = hpForm.effectiveFrom;
                    if (hpForm.effectiveTo) data.effectiveTo = hpForm.effectiveTo;
                    if (hpForm.memo.trim()) data.memo = hpForm.memo.trim();
                    hpCreateMutation.mutate(data);
                  }}>{hpCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}등록</Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 히든정책 수정 다이얼로그 */}
            <Dialog open={hpEditOpen} onOpenChange={o => { setHpEditOpen(o); if (!o) { setHpEditTarget(null); setHpDialogCCList([]); } }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>히든정책 수정</DialogTitle><DialogDescription>id:{hpEditTarget?.id}</DialogDescription></DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">판매점 <span className="text-gray-400">(선택 안 함 = 전체)</span></Label>
                    <Select value={hpEditForm.dealerRegistrationId || '__all__'} onValueChange={v => { const newId = v === '__all__' ? '' : v; setHpEditForm(f => ({ ...f, dealerRegistrationId: newId, contactCode: '' })); loadHpDialogCCList(newId); }}>
                      <SelectTrigger><SelectValue placeholder="판매점 선택 (전체)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">전체 (판매점 무관)</SelectItem>
                        {(dealerListForCC as any[]).map((d: any) => (
                          <SelectItem key={d.id} value={String(d.id)}>
                            [{d.dealerCode ?? d.id}] {d.businessName}{d.isHiddenPos ? ' ★히든' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">접점코드 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    {hpEditForm.dealerRegistrationId && hpDialogCCList.length > 0 ? (
                      <Select value={hpEditForm.contactCode || '__all__'} onValueChange={v => setHpEditForm(f => ({ ...f, contactCode: v === '__all__' ? '' : v }))}>
                        <SelectTrigger><SelectValue placeholder="접점코드 선택 (전체)" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">전체 (접점코드 무관)</SelectItem>
                          {hpDialogCCList.map((cc: any) => (
                            <SelectItem key={cc.id} value={cc.code}>{cc.code}{cc.realSalesPOS ? ` (${cc.realSalesPOS})` : ''}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input placeholder="예: M0001" value={hpEditForm.contactCode} onChange={e => setHpEditForm(f => ({ ...f, contactCode: e.target.value }))} />
                    )}
                    {hpEditForm.dealerRegistrationId && hpDialogCCList.length > 0 && hpEditForm.contactCode && !hpDialogCCList.some((cc: any) => cc.code === hpEditForm.contactCode) && (
                      <p className="text-xs text-amber-600 mt-1">⚠ 이 접점코드는 선택된 판매점에 등록되지 않았습니다.</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">채널 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    <Input placeholder="예: 후불)엠모바일" value={hpEditForm.channel} onChange={e => setHpEditForm(f => ({ ...f, channel: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">요금제 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    <Input placeholder="예: 이동의즐거움 5G" value={hpEditForm.planName} onChange={e => setHpEditForm(f => ({ ...f, planName: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">유형 <span className="text-gray-400">(빈칸=전체)</span></Label>
                    <Select value={hpEditForm.customerType || '__all__'} onValueChange={v => setHpEditForm(f => ({ ...f, customerType: v === '__all__' ? '' : v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">전체</SelectItem>
                        <SelectItem value="1">신규</SelectItem>
                        <SelectItem value="2">번이</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-purple-700">히든금액 *</Label>
                    <Input placeholder="예: 10,000" value={hpEditForm.hiddenAmount} onChange={e => setHpEditForm(f => ({ ...f, hiddenAmount: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">적용시작일</Label>
                    <Input type="date" value={hpEditForm.effectiveFrom} onChange={e => setHpEditForm(f => ({ ...f, effectiveFrom: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">적용종료일</Label>
                    <Input type="date" value={hpEditForm.effectiveTo} onChange={e => setHpEditForm(f => ({ ...f, effectiveTo: e.target.value }))} />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">메모</Label>
                    <Input placeholder="메모 입력" value={hpEditForm.memo} onChange={e => setHpEditForm(f => ({ ...f, memo: e.target.value }))} />
                  </div>
                  <div className="col-span-2 flex items-center gap-2 pt-1">
                    <input type="checkbox" id="hp-edit-active" checked={hpEditForm.isActive} onChange={e => setHpEditForm(f => ({ ...f, isActive: e.target.checked }))} />
                    <Label htmlFor="hp-edit-active" className="text-xs cursor-pointer">활성</Label>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setHpEditOpen(false)}>취소</Button>
                  <Button disabled={hpUpdateMutation.isPending} onClick={() => {
                    const rawAmt = hpEditForm.hiddenAmount.replace(/,/g, '');
                    if (!rawAmt || isNaN(Number(rawAmt))) { toast({ title: '오류', description: '히든금액은 숫자로 입력해주세요.', variant: 'destructive' }); return; }
                    const data: any = { hiddenAmount: rawAmt, isActive: hpEditForm.isActive };
                    if (hpEditForm.dealerRegistrationId) data.dealerRegistrationId = Number(hpEditForm.dealerRegistrationId);
                    else data.dealerRegistrationId = null;
                    data.contactCode = hpEditForm.contactCode.trim() || null;
                    data.channel = hpEditForm.channel.trim() || null;
                    data.planName = hpEditForm.planName.trim() || null;
                    data.customerType = hpEditForm.customerType || null;
                    data.effectiveFrom = hpEditForm.effectiveFrom || null;
                    data.effectiveTo = hpEditForm.effectiveTo || null;
                    data.memo = hpEditForm.memo.trim() || null;
                    hpUpdateMutation.mutate({ id: hpEditTarget.id, data });
                  }}>{hpUpdateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}저장</Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 정책 차수 생성 다이얼로그 */}
            <Dialog open={pvCreateOpen} onOpenChange={setPvCreateOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>정책 차수 생성</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {[
                    { label: '정책번호 *', key: 'policyNo', ph: 'POL-2025-001' },
                    { label: '정책명 *', key: 'policyName', ph: '2025년 1차 정책' },
                    { label: '적용 시작일시 *', key: 'effectiveFrom', type: 'datetime-local' },
                    { label: '적용 종료일시', key: 'effectiveTo', type: 'datetime-local' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-sm">{f.label}</Label>
                      <Input
                        type={f.type ?? 'text'} placeholder={f.ph}
                        value={(pvForm as any)[f.key]}
                        onChange={e => setPvForm(p => ({ ...p, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label className="text-sm">메모</Label>
                    <Textarea rows={2} value={pvForm.memo} onChange={e => setPvForm(p => ({ ...p, memo: e.target.value }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setPvCreateOpen(false)}>취소</Button>
                    <Button
                      disabled={pvCreateMutation.isPending}
                      onClick={() => {
                        if (!pvForm.policyNo || !pvForm.policyName || !pvForm.effectiveFrom) {
                          toast({ title: '오류', description: '정책번호·정책명·적용시작일은 필수입니다.', variant: 'destructive' }); return;
                        }
                        pvCreateMutation.mutate({ ...pvForm, effectiveTo: pvForm.effectiveTo || null });
                      }}
                    >
                      {pvCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}생성
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* 정책 차수 수정 다이얼로그 */}
            <Dialog open={pvEditOpen} onOpenChange={setPvEditOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>정책 차수 수정</DialogTitle>
                  <DialogDescription>{pvEditTarget?.policyNo}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  {[
                    { label: '정책번호', key: 'policyNo' },
                    { label: '정책명', key: 'policyName' },
                    { label: '적용 시작일시', key: 'effectiveFrom', type: 'datetime-local' },
                    { label: '적용 종료일시', key: 'effectiveTo', type: 'datetime-local' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-sm">{f.label}</Label>
                      <Input
                        type={f.type ?? 'text'}
                        value={(pvForm as any)[f.key]}
                        onChange={e => setPvForm(p => ({ ...p, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label className="text-sm">메모</Label>
                    <Textarea rows={2} value={pvForm.memo} onChange={e => setPvForm(p => ({ ...p, memo: e.target.value }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setPvEditOpen(false)}>취소</Button>
                    <Button
                      disabled={pvUpdateMutation.isPending}
                      onClick={() => pvUpdateMutation.mutate({ id: pvEditTarget.id, data: { ...pvForm, effectiveTo: pvForm.effectiveTo || null } })}
                    >
                      {pvUpdateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}수정
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* 단가 행 추가 다이얼로그 */}
            <Dialog open={prCreateOpen} onOpenChange={setPrCreateOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>단가 행 추가</DialogTitle>
                  <DialogDescription>정책 차수 v{pvSelectedId}에 단가 행을 추가합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  {/* 채널: carriers 목록 Select */}
                  <div className="space-y-1">
                    <Label className="text-xs">채널 *</Label>
                    <Select value={prForm.channel} onValueChange={v => setPrForm(p => ({ ...p, channel: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="운영 채널 선택" /></SelectTrigger>
                      <SelectContent>
                        {(carriersData as any[]).filter(c => c.isActive).map((c: any) => (
                          <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {[
                    { label: '요금제 *', key: 'planName', ph: '스선)363/3M' },
                    { label: '부가서비스조건', key: 'addService', ph: '비우면 와일드카드' },
                    { label: '결합조건', key: 'bundleType', ph: '비우면 와일드카드' },
                    { label: '가입비조건', key: 'regFeeType', ph: '비우면 와일드카드' },
                    { label: '유심개수', key: 'simCount', ph: '', type: 'number' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label}</Label>
                      <Input
                        type={f.type ?? 'text'} placeholder={f.ph} className="h-8 text-sm"
                        value={(prForm as any)[f.key]}
                        onChange={e => setPrForm(p => ({ ...p, [f.key]: e.target.value }))}
                      />
                    </div>
                  ))}
                  {/* 유형: 1(신규) / 2(번이) */}
                  <div className="space-y-1">
                    <Label className="text-xs">유형 * <span className="text-gray-400 font-normal">(1=신규 2=번이)</span></Label>
                    <Select value={prForm.customerType} onValueChange={v => setPrForm(p => ({ ...p, customerType: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 (신규)</SelectItem>
                        <SelectItem value="2">2 (번이)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">정책금액 *</Label>
                    <Input
                      type="number" placeholder="30000" className="h-8 text-sm"
                      value={prForm.rebateAmount}
                      onChange={e => setPrForm(p => ({ ...p, rebateAmount: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">메모</Label>
                    <Input className="h-8 text-sm" value={prForm.memo} onChange={e => setPrForm(p => ({ ...p, memo: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setPrCreateOpen(false)}>취소</Button>
                  <Button
                    disabled={prCreateMutation.isPending}
                    onClick={() => {
                      if (!prForm.channel || !prForm.planName || !prForm.rebateAmount) {
                        toast({ title: '오류', description: '채널·요금제·리베이트금액은 필수입니다.', variant: 'destructive' }); return;
                      }
                      prCreateMutation.mutate({
                        channel: prForm.channel,
                        planName: prForm.planName,
                        customerType: prForm.customerType,
                        simCount: prForm.simCount ? Number(prForm.simCount) : null,
                        bundleType: prForm.bundleType || null,
                        addService: prForm.addService || null,
                        regFeeType: prForm.regFeeType || null,
                        rebateAmount: prForm.rebateAmount,
                        memo: prForm.memo || null,
                      });
                    }}
                  >
                    {prCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}추가
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 단가 행 수정 다이얼로그 */}
            <Dialog open={prEditOpen} onOpenChange={o => { setPrEditOpen(o); if (!o) setPrEditTarget(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>단가 행 수정</DialogTitle>
                  <DialogDescription>id:{prEditTarget?.id} 단가 행을 수정합니다.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">채널 *</Label>
                    <Select value={prEditForm.channel} onValueChange={v => setPrEditForm(p => ({ ...p, channel: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="채널 선택" /></SelectTrigger>
                      <SelectContent>
                        {(carriersData as any[]).filter(c => c.isActive).map((c: any) => (
                          <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {[
                    { label: '요금제 *', key: 'planName', ph: '' },
                    { label: '결합조건', key: 'bundleType', ph: '비우면 전체 조건', desc: '특정 결합명 조건이 있을 때만 입력하세요. 비우면 전체 조건으로 적용됩니다.' },
                    { label: '부가서비스조건', key: 'addService', ph: '예: 캐치콜+', desc: '예: 캐치콜+. 금액을 입력하는 칸이 아닙니다.' },
                    { label: '가입비조건', key: 'regFeeType', ph: '비우면 전체 조건', desc: '가입비 조건이 있을 때만 입력하세요. 비우면 전체 조건으로 적용됩니다.' },
                    { label: '유심개수', key: 'simCount', ph: '', type: 'number' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1">
                      <Label className="text-xs">{f.label}</Label>
                      <Input type={f.type ?? 'text'} placeholder={f.ph} className="h-8 text-sm"
                        value={(prEditForm as any)[f.key]}
                        onChange={e => setPrEditForm(p => ({ ...p, [f.key]: e.target.value }))} />
                      {(f as any).desc && <p className="text-xs text-gray-400 leading-tight">{(f as any).desc}</p>}
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label className="text-xs">유형 * <span className="text-gray-400 font-normal">(1=신규 2=번이)</span></Label>
                    <Select value={prEditForm.customerType} onValueChange={v => setPrEditForm(p => ({ ...p, customerType: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 (신규)</SelectItem>
                        <SelectItem value="2">2 (번이)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">국적구분 <span className="text-gray-400 font-normal">(비우면 공통정책)</span></Label>
                    <Select value={prEditForm.nationalityType} onValueChange={v => setPrEditForm(p => ({ ...p, nationalityType: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="공통(전체)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">공통(내외국인 모두)</SelectItem>
                        <SelectItem value="내국인">내국인</SelectItem>
                        <SelectItem value="외국인">외국인</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">기본정책금액 *</Label>
                    <Input type="text" placeholder="예: 110,000" className="h-8 text-sm"
                      value={prEditForm.rebateAmount}
                      onChange={e => setPrEditForm(p => ({ ...p, rebateAmount: e.target.value }))} />
                    <p className="text-xs text-gray-400 leading-tight">기본 지급 정책 금액입니다. 추가금/차감금은 추후 별도 정책에서 처리합니다.</p>
                  </div>
                  <div className="space-y-1 col-span-2 flex items-center gap-2">
                    <input type="checkbox" id="pr-edit-active" checked={prEditForm.isActive}
                      onChange={e => setPrEditForm(p => ({ ...p, isActive: e.target.checked }))} />
                    <Label htmlFor="pr-edit-active" className="text-xs cursor-pointer">활성</Label>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">메모</Label>
                    <Input className="h-8 text-sm" value={prEditForm.memo}
                      onChange={e => setPrEditForm(p => ({ ...p, memo: e.target.value }))} />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setPrEditOpen(false)}>취소</Button>
                  <Button disabled={prUpdateMutation.isPending}
                    onClick={() => {
                      if (!prEditForm.channel || !prEditForm.planName) {
                        toast({ title: '오류', description: '채널·요금제는 필수입니다.', variant: 'destructive' }); return;
                      }
                      const rawAmount = prEditForm.rebateAmount.replace(/,/g, '');
                      if (!rawAmount || isNaN(Number(rawAmount))) {
                        toast({ title: '오류', description: '기본정책금액을 숫자로 입력해주세요.', variant: 'destructive' }); return;
                      }
                      prUpdateMutation.mutate({ rowId: prEditTarget.id, data: {
                        channel: prEditForm.channel,
                        planName: prEditForm.planName,
                        customerType: prEditForm.customerType,
                        nationalityType: prEditForm.nationalityType || null,
                        simCount: prEditForm.simCount ? Number(prEditForm.simCount) : null,
                        bundleType: prEditForm.bundleType || null,
                        addService: prEditForm.addService || null,
                        regFeeType: prEditForm.regFeeType || null,
                        rebateAmount: rawAmount,
                        isActive: prEditForm.isActive,
                        memo: prEditForm.memo || null,
                      }});
                    }}>
                    {prUpdateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}저장
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 추가/차감 규칙 등록 다이얼로그 */}
            <Dialog open={arCreateOpen} onOpenChange={o => { setArCreateOpen(o); if (!o) setArForm(arFormDefault); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>추가/차감 규칙 등록</DialogTitle></DialogHeader>
                <ArRuleForm form={arForm} setForm={setArForm} carriersData={carriersData as any[]} />
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setArCreateOpen(false)}>취소</Button>
                  <Button disabled={arCreateMutation.isPending} onClick={() => {
                    const rawAmt = arForm.amount.replace(/,/g, '');
                    const numAmt = Number(rawAmt);
                    if (!rawAmt || isNaN(numAmt)) { toast({ title: '오류', description: '금액은 숫자로 입력해주세요.', variant: 'destructive' }); return; }
                    if (numAmt <= 0) { toast({ title: '오류', description: '금액은 0보다 커야 합니다.', variant: 'destructive' }); return; }
                    const needsVal = ['BUNDLE_MATCH','ADD_SERVICE_MATCH','ADD_SERVICE_NOT_MATCH','REGFEE_MATCH','SIM_COUNT_MATCH'];
                    if (needsVal.includes(arForm.conditionType) && !arForm.conditionValue.trim()) { toast({ title: '오류', description: '이 조건 종류는 조건값이 필요합니다.', variant: 'destructive' }); return; }
                    arCreateMutation.mutate({ ...arForm, amount: rawAmt });
                  }}>{arCreateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}등록</Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 추가/차감 규칙 수정 다이얼로그 */}
            <Dialog open={arEditOpen} onOpenChange={o => { setArEditOpen(o); if (!o) setArEditTarget(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>추가/차감 규칙 수정</DialogTitle><DialogDescription>id:{arEditTarget?.id}</DialogDescription></DialogHeader>
                <ArRuleForm form={arEditForm} setForm={setArEditForm} carriersData={carriersData as any[]} />
                <div className="space-y-1 pt-1 flex items-center gap-2">
                  <input type="checkbox" id="ar-edit-active" checked={arEditForm.isActive} onChange={e => setArEditForm(f => ({ ...f, isActive: e.target.checked }))} />
                  <Label htmlFor="ar-edit-active" className="text-xs cursor-pointer">활성</Label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setArEditOpen(false)}>취소</Button>
                  <Button disabled={arUpdateMutation.isPending} onClick={() => {
                    const rawAmt = arEditForm.amount.replace(/,/g, '');
                    const numAmt = Number(rawAmt);
                    if (!rawAmt || isNaN(numAmt)) { toast({ title: '오류', description: '금액은 숫자로 입력해주세요.', variant: 'destructive' }); return; }
                    if (numAmt <= 0) { toast({ title: '오류', description: '금액은 0보다 커야 합니다.', variant: 'destructive' }); return; }
                    const needsVal = ['BUNDLE_MATCH','ADD_SERVICE_MATCH','ADD_SERVICE_NOT_MATCH','REGFEE_MATCH','SIM_COUNT_MATCH'];
                    if (needsVal.includes(arEditForm.conditionType) && !arEditForm.conditionValue.trim()) { toast({ title: '오류', description: '이 조건 종류는 조건값이 필요합니다.', variant: 'destructive' }); return; }
                    arUpdateMutation.mutate({ ruleId: arEditTarget.id, data: { ...arEditForm, amount: rawAmt } });
                  }}>{arUpdateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}저장</Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* 정책 엑셀 업로드 다이얼로그 */}
            <Dialog open={peOpen} onOpenChange={o => { setPeOpen(o); if (!o) setPeResult(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>정산 정책 엑셀 업로드</DialogTitle>
                  <DialogDescription>정산 정책 전용 양식을 업로드하여 policy_rows에 일괄 등록합니다.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {/* 양식 안내 */}
                  <div className="rounded bg-blue-50 border border-blue-200 p-3 text-xs space-y-1.5">
                    <div className="font-semibold text-blue-800 mb-1">정산 정책 업로드 양식 안내</div>
                    <div className="text-blue-700">
                      <span className="font-medium">✅ 10컬럼 국적형 (권장):</span> 채널 · 요금제 · 내국인_신규 · 내국인_번이 · 외국인_신규 · 외국인_번이 · 결합조건 · 부가서비스조건 · 가입비조건 · 메모
                    </div>
                    <div className="text-blue-700">
                      <span className="font-medium">8컬럼 구형 가로형 (하위호환):</span> 채널 · 요금제 · 신규 · 번이 · 결합조건 · 부가서비스조건 · 가입비조건 · 메모 → 국적 '내국인' 고정
                    </div>
                    <div className="text-blue-700">
                      <span className="font-medium">세로형 (하위호환):</span> 유형(1/2) + 정책금액(원단위) → 국적 와일드카드(전체 적용)
                    </div>
                    <div className="text-blue-600 mt-1 space-y-0.5">
                      <div>· <span className="font-medium">금액 단위:</span> 만원 소수점 — 3.0 → 30,000원 / 47.5 → 475,000원</div>
                      <div>· <span className="font-medium">빈 칸:</span> 해당 유형 행을 생성하지 않음</div>
                      <div>· <span className="font-medium">국적 매칭:</span> 정확일치 → AUTO_MATCH / 와일드카드(null) → REVIEW_REQUIRED</div>
                    </div>
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-100"
                        onClick={() => {
                          const headers = ['채널', '요금제', '내국인_신규', '내국인_번이', '외국인_신규', '외국인_번이', '결합조건', '부가서비스조건', '가입비조건', '메모'];
                          const guide = ['※ 금액 단위: 만원 소수점 (3.0 = 30,000원). 빈 칸 = 해당 행 미생성.'];
                          const ex1 = ['후불)엠모바일', '엠)M 프리미엄 100GB(밀리의서재)', 3.0, 15.0, 4.0, 16.0, '', '', '', ''];
                          const ex2 = ['후불)엠모바일', '엠)데이터 선택 11GB+', '', 10.0, '', 11.0, '', '', '', '번이만 예시'];
                          const ex3 = ['후불)엠모바일', '엠)안심 요금제 5GB', 5.0, '', '', '', '', '', '선납', '가입비조건 예시'];
                          const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2, ex3, [], guide]);
                          ws['!cols'] = [
                            { wch: 24 }, { wch: 42 }, { wch: 11 }, { wch: 11 },
                            { wch: 11 }, { wch: 11 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 20 },
                          ];
                          const wb2 = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb2, ws, '정산정책');
                          XLSX.writeFile(wb2, '정산정책_업로드_내외국인_가로형_양식.xlsx');
                        }}
                      >
                        내외국인 양식 (10컬럼)
                      </Button>
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs border-gray-300 text-gray-600 hover:bg-gray-50"
                        onClick={() => {
                          const headers = ['채널', '요금제', '신규', '번이', '결합조건', '부가서비스조건', '가입비조건', '메모'];
                          const guide = ['※ 금액 단위: 만원 소수점. 국적 = 내국인 고정.'];
                          const ex1 = ['후불)엠모바일', '엠)M 프리미엄 100GB(밀리의서재)', 3.0, 15.0, '', '', '', ''];
                          const ex2 = ['후불)엠모바일', '엠)데이터 선택 11GB+', '', 10.0, '', '', '', '번이만 예시'];
                          const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2, [], guide]);
                          ws['!cols'] = [
                            { wch: 24 }, { wch: 42 }, { wch: 8 }, { wch: 8 },
                            { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 20 },
                          ];
                          const wb2 = XLSX.utils.book_new();
                          XLSX.utils.book_append_sheet(wb2, ws, '정산정책');
                          XLSX.writeFile(wb2, '정산정책_업로드_가로형_양식.xlsx');
                        }}
                      >
                        구형 양식 (8컬럼)
                      </Button>
                    </div>
                  </div>

                  {/* 파일 선택 */}
                  <div className="space-y-1">
                    <Label className="text-sm">파일 선택 *</Label>
                    <input
                      ref={peFileRef}
                      type="file"
                      accept=".xlsx,.xls"
                      className="block w-full text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      onChange={e => setPeFile(e.target.files?.[0] ?? null)}
                    />
                  </div>

                  {/* 정책 차수 선택 */}
                  <div className="space-y-1">
                    <Label className="text-sm">정책 차수</Label>
                    <Select value={pePvId} onValueChange={setPePvId}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="새 차수 자동 생성" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__auto__">새 정책 차수 자동 생성</SelectItem>
                        {(policyVersions ?? []).map((pv: any) => (
                          <SelectItem key={pv.id} value={String(pv.id)}>{pv.policyName} ({pv.policyNo})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-gray-400">비워두면 오늘 날짜로 새 차수를 자동 생성합니다.</p>
                  </div>

                  {/* 업로드 결과 */}
                  {peResult && (
                    <div className="rounded bg-green-50 border border-green-200 p-3 text-sm space-y-1">
                      <div className="font-medium text-green-800">업로드 완료 — 차수: {peResult.versionName} (ID: {peResult.versionId})</div>
                      <div className="text-green-700">엑셀 행: {peResult.totalRows}개 / 등록: <strong>{peResult.inserted}</strong>개 / 건너뜀(중복): {peResult.skipped}개</div>
                      {peResult.errors?.length > 0 && (
                        <div className="text-red-600 text-xs mt-1">오류 {peResult.errors.length}건: {peResult.errors.slice(0, 3).join('; ')}</div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="outline" onClick={() => setPeOpen(false)}>닫기</Button>
                    <Button disabled={peUploading || !peFile} onClick={handlePeUpload}>
                      {peUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      {peUploading ? '업로드 중...' : '업로드'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

        </Tabs>

        {/* 채널별 수정파일 업로드 다이얼로그 */}
        <Dialog open={chOpen} onOpenChange={o => { setChOpen(o); if (!o) setChResult(null); }}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>채널별 수정파일 업로드</DialogTitle>
              <DialogDescription>
                사용자가 수정한 채널별 *_upload.xlsx 파일을 업로드합니다. 모든 차수 시트가 자동 처리됩니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded bg-blue-50 border border-blue-200 p-3 text-xs space-y-1">
                <div className="font-semibold text-blue-800">업로드 규칙</div>
                <div className="text-blue-700">· 정책 차수 선택 필수 (자동 생성 불가)</div>
                <div className="text-blue-700">· 파일 내 모든 차수 시트를 순회하여 처리</div>
                <div className="text-blue-700">· 검토필요 시트·숨김 시트 자동 제외</div>
                <div className="text-blue-700">· 같은 채널+차수의 기존 행은 비활성화 후 새 행 삽입 (소프트 삭제)</div>
                <div className="text-blue-700">· 시트명 형식: 8월2차 / 8월2차_14일접수 / 8월3차_14일접수_수정</div>
              </div>

              <div className="space-y-1">
                <Label className="text-sm">정책 차수 선택 <span className="text-red-500">*</span></Label>
                <Select value={chPvId} onValueChange={setChPvId}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="정책 차수를 선택하세요 (필수)" /></SelectTrigger>
                  <SelectContent>
                    {(policyVersions ?? []).map((pv: any) => (
                      <SelectItem key={pv.id} value={String(pv.id)}>{pv.policyName} ({pv.policyNo})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!chPvId && <p className="text-xs text-red-500">채널별 업로드는 정책 차수 선택이 필수입니다.</p>}
              </div>

              <div className="space-y-1">
                <Label className="text-sm">파일 선택 <span className="text-red-500">*</span></Label>
                <input
                  ref={chFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="block w-full text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  onChange={e => setChFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-gray-400">예: 엠모바일_upload.xlsx, 텔링크_upload.xlsx 등</p>
              </div>

              {chResult && (
                <div className="rounded bg-green-50 border border-green-200 p-3 text-sm space-y-2">
                  <div className="font-medium text-green-800">
                    업로드 완료 — {chResult.versionName} (ID: {chResult.versionId})
                  </div>
                  <div className="text-green-700 text-xs space-y-0.5">
                    <div>총 시트: {chResult.totalSheets}개 / 처리: <strong>{chResult.processedSheets}</strong>개 / skip: {chResult.skippedSheets}개</div>
                    <div>배치ID: {chResult.uploadedBatchId}</div>
                  </div>
                  {chResult.sheets?.length > 0 && (
                    <div className="text-xs space-y-0.5 mt-1">
                      <div className="font-medium text-gray-700">시트별 결과:</div>
                      {chResult.sheets.map((s: any, i: number) => (
                        <div key={i} className="text-gray-600 pl-2">
                          [{s.sheetName}] 비활성화: {s.deactivated}건 / 등록: <strong>{s.inserted}</strong>건{s.skipped ? ` / skip: ${s.skipped}건` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {chResult.warnings?.length > 0 && (
                    <div className="text-yellow-700 text-xs mt-1">
                      경고 {chResult.warnings.length}건: {chResult.warnings.slice(0, 5).join(' | ')}
                    </div>
                  )}
                  {chResult.errors?.length > 0 && (
                    <div className="text-red-600 text-xs mt-1">
                      오류 {chResult.errors.length}건: {chResult.errors.slice(0, 3).join('; ')}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setChOpen(false)}>닫기</Button>
                <Button disabled={chUploading || !chFile || !chPvId} onClick={handleChUpload} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {chUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                  {chUploading ? '업로드 중...' : '채널파일 업로드'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* 원본 정책표 자동 인식 다이얼로그 */}
        <Dialog open={orgOpen} onOpenChange={o => { setOrgOpen(o); if (!o) setOrgResult(null); }}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>원본 정책표 자동 인식</DialogTitle>
              <DialogDescription>
                MCC 정책 통합본 xlsx를 업로드하면 채널별 수정파일 업로드용 파일을 자동 생성합니다.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded bg-green-50 border border-green-200 p-3 text-xs space-y-1">
                <div className="font-semibold text-green-800">처리 흐름</div>
                <div className="text-green-700">① 원본 통합본 파일 업로드 → ② 채널별 자동 분리 → ③ *_upload.xlsx 파일 다운로드 → ④ 수정 완료 후 "채널별 수정파일 업로드"로 DB 반영</div>
                <div className="text-green-700 mt-1 font-medium">※ 이 단계에서는 DB에 저장하지 않습니다.</div>
              </div>

              {!orgResult && (
                <div className="space-y-1">
                  <Label className="text-sm">원본 MCC 정책 통합본 파일 선택 <span className="text-red-500">*</span></Label>
                  <input
                    ref={orgFileRef}
                    type="file"
                    accept=".xlsx,.xls"
                    className="block w-full text-sm text-gray-600 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                    onChange={e => setOrgFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-gray-400">예: ■MCC정책_통합본_8월 8차(24일~)_유선_8월_20차(21일12시~) 송부용.xlsx</p>
                </div>
              )}

              {orgResult && (
                <div className="space-y-3">
                  <div className="rounded bg-green-50 border border-green-200 p-3 text-sm space-y-1">
                    <div className="font-medium text-green-800">자동 인식 완료</div>
                    <div className="text-green-700 text-xs">
                      <span>원본: {orgResult.originalFileName}</span>
                      <span className="ml-3">처리 시트: {orgResult.sheetsAnalyzed?.length ?? 0}개</span>
                      <span className="ml-3">채널: {orgResult.totalChannels}개</span>
                    </div>
                    <div className="text-green-700 text-xs">
                      <span>자동인식 행: <strong>{orgResult.totalOkRows}</strong></span>
                      <span className="ml-3">검토필요 행: {orgResult.totalReviewRows}</span>
                    </div>
                  </div>

                  {orgResult.warnings?.length > 0 && (
                    <div className="rounded bg-yellow-50 border border-yellow-200 p-2 text-xs text-yellow-700">
                      <div className="font-medium mb-1">경고 {orgResult.warnings.length}건</div>
                      {orgResult.warnings.slice(0, 5).map((w: string, i: number) => (
                        <div key={i}>· {w}</div>
                      ))}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-sm font-medium text-gray-700">생성된 채널별 파일 ({orgResult.files?.length ?? 0}개) — 클릭하여 다운로드</div>
                    {(orgResult.files ?? []).map((f: any, i: number) => (
                      <div key={i} className="rounded border border-gray-200 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium text-gray-800">{f.name}</span>
                            <span className="ml-2 text-gray-500">{f.totalRows}행</span>
                          </div>
                          <Button size="sm" variant="outline" className="h-6 text-xs px-2 border-green-400 text-green-700 hover:bg-green-50" onClick={() => handleOrgDownload(f)}>
                            다운로드
                          </Button>
                        </div>
                        <div className="mt-1 text-gray-500 pl-1">
                          {f.sheets?.map((s: any) => `${s.name}(${s.rows}행)`).join(' · ')}
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button size="sm" variant="outline" className="w-full" onClick={() => { setOrgResult(null); setOrgFile(null); if (orgFileRef.current) orgFileRef.current.value = ''; }}>
                    다시 업로드
                  </Button>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setOrgOpen(false)}>닫기</Button>
                {!orgResult && (
                  <Button disabled={orgUploading || !orgFile} onClick={handleOrgUpload} className="bg-green-600 hover:bg-green-700 text-white">
                    {orgUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    {orgUploading ? '처리 중...' : '자동 인식 시작'}
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
