import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createSalesTeamSchema, createSalesManagerSchema, updateSalesManagerSchema, assignSalesManagerToTeamSchema, createContactCodeMappingSchema } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { Plus, Users, User, Settings, Edit, Trash2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sidebar } from '@/components/Sidebar';

interface SalesTeam {
  id: number;
  teamName: string;
  teamCode: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SalesManager {
  id: number;
  teamId: number;
  managerName: string;
  managerCode: string;
  username: string;
  position: '팀장' | '과장' | '대리';
  contactPhone?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ContactCodeMapping {
  id: number;
  managerId: number;
  carrier: string;
  contactCode: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function SalesTeamManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState(false);
  const [isManagerDialogOpen, setIsManagerDialogOpen] = useState(false);
  const [isMappingDialogOpen, setIsMappingDialogOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<SalesManager | null>(null);
  const [isEditManagerDialogOpen, setIsEditManagerDialogOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [showTeamMembers, setShowTeamMembers] = useState(false);
  const [editingTeam, setEditingTeam] = useState<SalesTeam | null>(null);
  const [isEditTeamDialogOpen, setIsEditTeamDialogOpen] = useState(false);

  // 영업팀 목록 조회
  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['/api/admin/sales-teams'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/sales-teams');
      return res.json();
    }
  });

  // 영업과장 목록 조회
  const { data: managers = [], isLoading: managersLoading } = useQuery({
    queryKey: ['/api/admin/sales-managers'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/sales-managers');
      return res.json();
    }
  });

  // 팀에 배정되지 않은 영업과장 계정 목록 조회
  const { data: unassignedManagers = [], isLoading: unassignedLoading } = useQuery({
    queryKey: ['/api/admin/unassigned-sales-managers'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/unassigned-sales-managers');
      return res.json();
    }
  });

  // 접점 코드 매핑 목록 조회
  const { data: mappings = [], isLoading: mappingsLoading } = useQuery({
    queryKey: ['/api/admin/contact-code-mappings'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/admin/contact-code-mappings');
      return res.json();
    }
  });

  // 영업팀 생성 폼
  const teamForm = useForm({
    resolver: zodResolver(createSalesTeamSchema),
    defaultValues: {
      teamName: '',
      teamCode: '',
      description: ''
    }
  });

  // 영업팀 수정 폼
  const editTeamForm = useForm({
    resolver: zodResolver(createSalesTeamSchema),
    defaultValues: {
      teamName: '',
      teamCode: '',
      description: ''
    }
  });

  // 영업과장 배정 폼 (기존 계정을 팀에 배정)
  const managerForm = useForm({
    resolver: zodResolver(assignSalesManagerToTeamSchema),
    defaultValues: {
      teamId: 0,
      salesManagerUserId: 0,
      managerCode: '',
      position: '대리' as const,
      contactPhone: '',
      email: ''
    }
  });

  // 영업과장 수정 폼
  const editManagerForm = useForm({
    resolver: zodResolver(createSalesManagerSchema.omit({ password: true })),
    defaultValues: {
      teamId: 0,
      managerName: '',
      managerCode: '',
      username: '',
      position: '대리' as const,
      contactPhone: '',
      email: ''
    }
  });

  // 접점 코드 매핑 생성 폼
  const mappingForm = useForm({
    resolver: zodResolver(createContactCodeMappingSchema),
    defaultValues: {
      managerId: 0,
      carrier: '',
      contactCode: ''
    }
  });

  // 영업팀 생성 뮤테이션
  const createTeamMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/admin/sales-teams', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-teams'] });
      toast({ title: "성공", description: "영업팀이 생성되었습니다." });
      setIsTeamDialogOpen(false);
      teamForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "오류", 
        description: error.message || "영업팀 생성 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  });

  // 영업팀 수정 뮤테이션
  const updateTeamMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('PUT', `/api/admin/sales-teams/${editingTeam?.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-teams'] });
      toast({ title: "성공", description: "영업팀이 수정되었습니다." });
      setIsEditTeamDialogOpen(false);
      setEditingTeam(null);
      editTeamForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "오류", 
        description: error.message || "영업팀 수정 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  });

  // 영업팀 삭제 뮤테이션
  const deleteTeamMutation = useMutation({
    mutationFn: async (teamId: number) => {
      const response = await apiRequest('DELETE', `/api/admin/sales-teams/${teamId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-teams'] });
      toast({ title: "성공", description: "영업팀이 삭제되었습니다." });
    },
    onError: (error: any) => {
      toast({ 
        title: "오류", 
        description: error.message || "영업팀 삭제 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  });

  // 영업과장 배정 뮤테이션 (기존 계정을 팀에 배정)
  const assignManagerMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/admin/assign-sales-manager', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-managers'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/unassigned-sales-managers'] });
      toast({ title: "성공", description: "영업과장이 팀에 배정되었습니다." });
      setIsManagerDialogOpen(false);
      managerForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "오류", 
        description: error.message || "영업과장 배정 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  });

  // 영업과장 수정 뮤테이션
  const updateManagerMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('PUT', `/api/admin/sales-managers/${editingManager?.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/sales-managers'] });
      toast({ title: "성공", description: "영업과장 정보가 수정되었습니다." });
      setIsEditManagerDialogOpen(false);
      setEditingManager(null);
      editManagerForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "오류", 
        description: error.message || "영업과장 수정 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  });

  // 접점 코드 매핑 생성 뮤테이션
  const createMappingMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('POST', '/api/admin/contact-code-mappings', data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/contact-code-mappings'] });
      toast({ title: "성공", description: "접점 코드 매핑이 생성되었습니다." });
      setIsMappingDialogOpen(false);
      mappingForm.reset();
    },
    onError: (error: any) => {
      toast({ 
        title: "오류", 
        description: error.message || "접점 코드 매핑 생성 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
  });

  const onTeamSubmit = (data: any) => {
    createTeamMutation.mutate(data);
  };

  const onManagerSubmit = (data: any) => {
    assignManagerMutation.mutate(data);
  };

  const onMappingSubmit = (data: any) => {
    createMappingMutation.mutate(data);
  };

  const onEditManagerSubmit = (data: any) => {
    updateManagerMutation.mutate(data);
  };

  const onEditTeamSubmit = (data: any) => {
    updateTeamMutation.mutate(data);
  };

  const handleEditManager = (manager: SalesManager) => {
    setEditingManager(manager);
    const teamForManager = teams.find(team => team.id === manager.teamId);
    editManagerForm.reset({
      teamId: manager.teamId,
      managerName: manager.managerName,
      managerCode: manager.managerCode,
      username: manager.username,
      position: manager.position,
      contactPhone: manager.contactPhone || '',
      email: manager.email || ''
    });
    setIsEditManagerDialogOpen(true);
  };

  const handleEditTeam = (team: SalesTeam) => {
    setEditingTeam(team);
    editTeamForm.reset({
      teamName: team.teamName,
      teamCode: team.teamCode,
      description: team.description || ''
    });
    setIsEditTeamDialogOpen(true);
  };

  const handleDeleteTeam = (team: SalesTeam) => {
    if (window.confirm(`"${team.teamName}" 팀을 삭제하시겠습니까?`)) {
      deleteTeamMutation.mutate(team.id);
    }
  };

  const handleTeamClick = (teamId: number) => {
    if (selectedTeamId === teamId && showTeamMembers) {
      setShowTeamMembers(false);
      setSelectedTeamId(null);
    } else {
      setSelectedTeamId(teamId);
      setShowTeamMembers(true);
    }
  };

  // 선택된 팀의 팀원들을 필터링
  const teamMembers = selectedTeamId 
    ? managers.filter(manager => manager.teamId === selectedTeamId)
    : [];

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold">영업조직 관리</h1>
          </div>

          <Tabs defaultValue="teams" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="teams" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            영업팀 관리
          </TabsTrigger>
          <TabsTrigger value="managers" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            영업과장 관리
          </TabsTrigger>
          <TabsTrigger value="mappings" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            접점 코드 매핑
          </TabsTrigger>
        </TabsList>

        {/* 영업팀 관리 탭 */}
        <TabsContent value="teams">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>영업팀 목록</CardTitle>
              <Dialog open={isTeamDialogOpen} onOpenChange={setIsTeamDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    영업팀 추가
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>새 영업팀 추가</DialogTitle>
                  </DialogHeader>
                  <Form {...teamForm}>
                    <form onSubmit={teamForm.handleSubmit(onTeamSubmit)} className="space-y-4">
                      <FormField
                        control={teamForm.control}
                        name="teamName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>팀명</FormLabel>
                            <FormControl>
                              <Input placeholder="예: 1영업팀" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={teamForm.control}
                        name="teamCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>팀 코드</FormLabel>
                            <FormControl>
                              <Input placeholder="예: TEAM01" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={teamForm.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>설명 (선택사항)</FormLabel>
                            <FormControl>
                              <Textarea placeholder="팀 설명을 입력하세요" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" disabled={createTeamMutation.isPending}>
                        {createTeamMutation.isPending ? '생성 중...' : '생성'}
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {teamsLoading ? (
                <div>로딩 중...</div>
              ) : (
                <div className="grid gap-4">
                  {teams.map((team: SalesTeam) => (
                    <div key={team.id}>
                      <Card 
                        className="cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleTeamClick(team.id)}
                      >
                        <CardContent className="pt-4">
                          <div className="flex justify-between items-start">
                            <div className="flex-1">
                              <h3 className="font-semibold">{team.teamName}</h3>
                              <p className="text-sm text-muted-foreground">코드: {team.teamCode}</p>
                              {team.description && (
                                <p className="text-sm mt-2">{team.description}</p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <div className="text-sm text-muted-foreground">
                                생성일: {new Date(team.createdAt).toLocaleDateString()}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleEditTeam(team);
                                  }}
                                >
                                  <Edit className="h-3 w-3 mr-1" />
                                  수정
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTeam(team);
                                  }}
                                  className="text-red-600 hover:text-red-700 hover:border-red-300"
                                >
                                  <Trash2 className="h-3 w-3 mr-1" />
                                  삭제
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                      
                      {/* 팀원 목록 표시 */}
                      {showTeamMembers && selectedTeamId === team.id && (
                        <div className="ml-4 mt-2 space-y-2">
                          <h4 className="font-medium text-sm text-muted-foreground">팀원 목록:</h4>
                          {teamMembers.length > 0 ? (
                            teamMembers.map((member: SalesManager) => (
                              <Card key={member.id} className="bg-muted/30">
                                <CardContent className="pt-3 pb-3">
                                  <div className="flex justify-between items-center">
                                    <div>
                                      <h5 className="font-medium text-sm">{member.managerName} ({member.position})</h5>
                                      <p className="text-xs text-muted-foreground">
                                        코드: {member.managerCode} | ID: {member.username}
                                      </p>
                                    </div>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditManager(member);
                                      }}
                                    >
                                      <Edit className="h-3 w-3 mr-1" />
                                      수정
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            ))
                          ) : (
                            <p className="text-sm text-muted-foreground ml-2">이 팀에는 등록된 팀원이 없습니다.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 영업과장 관리 탭 */}
        <TabsContent value="managers">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>영업과장 목록</CardTitle>
              <Dialog open={isManagerDialogOpen} onOpenChange={setIsManagerDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    영업과장 추가
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>영업과장 팀 배정</DialogTitle>
                    <p className="text-sm text-muted-foreground">
                      관리자 패널에서 생성된 영업과장 계정을 팀에 배정합니다.
                    </p>
                  </DialogHeader>
                  {unassignedManagers.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">배정 가능한 영업과장 계정이 없습니다.</p>
                      <p className="text-sm text-muted-foreground mt-2">
                        관리자 패널에서 영업과장 계정을 먼저 생성해주세요.
                      </p>
                    </div>
                  ) : (
                    <Form {...managerForm}>
                      <form onSubmit={managerForm.handleSubmit(onManagerSubmit)} className="space-y-4">
                        <FormField
                          control={managerForm.control}
                          name="salesManagerUserId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>영업과장 계정 선택</FormLabel>
                              <Select onValueChange={(value) => field.onChange(parseInt(value))}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="영업과장 계정을 선택하세요" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {unassignedManagers.map((manager: any) => (
                                    <SelectItem key={manager.id} value={manager.id.toString()}>
                                      {manager.name} ({manager.username})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={managerForm.control}
                          name="teamId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>소속 팀</FormLabel>
                              <Select onValueChange={(value) => field.onChange(parseInt(value))}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="팀을 선택하세요" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {teams.map((team: SalesTeam) => (
                                    <SelectItem key={team.id} value={team.id.toString()}>
                                      {team.teamName}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={managerForm.control}
                          name="managerCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>과장 코드</FormLabel>
                              <FormControl>
                                <Input placeholder="예: MGR001" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={managerForm.control}
                          name="position"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>직급</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="직급을 선택하세요" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="팀장">팀장</SelectItem>
                                  <SelectItem value="과장">과장</SelectItem>
                                  <SelectItem value="대리">대리</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={managerForm.control}
                          name="contactPhone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>연락처 (선택사항)</FormLabel>
                              <FormControl>
                                <Input placeholder="연락처" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={managerForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>이메일 (선택사항)</FormLabel>
                              <FormControl>
                                <Input type="email" placeholder="이메일" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button type="submit" disabled={assignManagerMutation.isPending}>
                          {assignManagerMutation.isPending ? '배정 중...' : '팀에 배정'}
                        </Button>
                      </form>
                    </Form>
                  )}
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {managersLoading ? (
                <div>로딩 중...</div>
              ) : (
                <div className="grid gap-4">
                  {managers.map((manager: SalesManager) => (
                    <Card key={manager.id}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{manager.managerName} ({manager.position})</h3>
                            <p className="text-sm text-muted-foreground">
                              코드: {manager.managerCode} | ID: {manager.username}
                            </p>
                            {manager.contactPhone && (
                              <p className="text-sm">연락처: {manager.contactPhone}</p>
                            )}
                            {manager.email && (
                              <p className="text-sm">이메일: {manager.email}</p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditManager(manager)}
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              수정
                            </Button>
                            <div className="text-sm text-muted-foreground">
                              생성일: {new Date(manager.createdAt).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 접점 코드 매핑 탭 */}
        <TabsContent value="mappings">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>접점 코드 매핑</CardTitle>
              <Dialog open={isMappingDialogOpen} onOpenChange={setIsMappingDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    매핑 추가
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>새 접점 코드 매핑 추가</DialogTitle>
                  </DialogHeader>
                  <Form {...mappingForm}>
                    <form onSubmit={mappingForm.handleSubmit(onMappingSubmit)} className="space-y-4">
                      <FormField
                        control={mappingForm.control}
                        name="managerId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>영업과장</FormLabel>
                            <Select onValueChange={(value) => field.onChange(parseInt(value))}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="영업과장을 선택하세요" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {managers.map((manager: SalesManager) => (
                                  <SelectItem key={manager.id} value={manager.id.toString()}>
                                    {manager.managerName} ({manager.managerCode})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={mappingForm.control}
                        name="carrier"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>통신사</FormLabel>
                            <FormControl>
                              <Input placeholder="예: SKT, KT, LGU+" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={mappingForm.control}
                        name="contactCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>접점 코드</FormLabel>
                            <FormControl>
                              <Input placeholder="접점 코드를 입력하세요" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" disabled={createMappingMutation.isPending}>
                        {createMappingMutation.isPending ? '생성 중...' : '생성'}
                      </Button>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {mappingsLoading ? (
                <div>로딩 중...</div>
              ) : (
                <div className="grid gap-4">
                  {mappings.map((mapping: ContactCodeMapping) => (
                    <Card key={mapping.id}>
                      <CardContent className="pt-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <h3 className="font-semibold">{mapping.carrier}</h3>
                            <p className="text-sm text-muted-foreground">
                              접점 코드: {mapping.contactCode}
                            </p>
                            <p className="text-sm">담당자 ID: {mapping.managerId}</p>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            생성일: {new Date(mapping.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
        </div>
      </div>

      {/* 영업과장 수정 다이얼로그 */}
      <Dialog open={isEditManagerDialogOpen} onOpenChange={setIsEditManagerDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>영업과장 수정</DialogTitle>
          </DialogHeader>
          <Form {...editManagerForm}>
            <form onSubmit={editManagerForm.handleSubmit(onEditManagerSubmit)} className="space-y-4">
              <FormField
                control={editManagerForm.control}
                name="teamId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>소속 팀</FormLabel>
                    <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="팀을 선택하세요" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {teams.map((team: SalesTeam) => (
                          <SelectItem key={team.id} value={team.id.toString()}>
                            {team.teamName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editManagerForm.control}
                name="managerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이름</FormLabel>
                    <FormControl>
                      <Input placeholder="영업과장 이름" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editManagerForm.control}
                name="position"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>직급</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="직급을 선택하세요" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="팀장">팀장</SelectItem>
                        <SelectItem value="과장">과장</SelectItem>
                        <SelectItem value="대리">대리</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editManagerForm.control}
                name="managerCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>과장 코드</FormLabel>
                    <FormControl>
                      <Input placeholder="DX1팀" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editManagerForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>로그인 ID</FormLabel>
                    <FormControl>
                      <Input placeholder="로그인에 사용할 ID" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editManagerForm.control}
                name="contactPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>연락처</FormLabel>
                    <FormControl>
                      <Input placeholder="연락처 (선택사항)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editManagerForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이메일</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="이메일 (선택사항)" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={updateManagerMutation.isPending}>
                {updateManagerMutation.isPending ? '수정 중...' : '수정'}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* 영업팀 수정 다이얼로그 */}
      <Dialog open={isEditTeamDialogOpen} onOpenChange={setIsEditTeamDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>영업팀 정보 수정</DialogTitle>
          </DialogHeader>
          <Form {...editTeamForm}>
            <form onSubmit={editTeamForm.handleSubmit(onEditTeamSubmit)} className="space-y-4">
              <FormField
                control={editTeamForm.control}
                name="teamName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>팀명</FormLabel>
                    <FormControl>
                      <Input placeholder="예: 1영업팀" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editTeamForm.control}
                name="teamCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>팀 코드</FormLabel>
                    <FormControl>
                      <Input placeholder="예: TEAM01" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editTeamForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>설명 (선택사항)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="팀 설명을 입력하세요" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={updateTeamMutation.isPending}>
                {updateTeamMutation.isPending ? '수정 중...' : '수정'}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}