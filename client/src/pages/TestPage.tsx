import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function TestPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pricingDialogOpen, setPricingDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pricingTitle, setPricingTitle] = useState('');

  const uploadPricingMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const sessionId = useAuth.getState().sessionId;
      
      if (!sessionId) {
        throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
      }

      console.log('Uploading with sessionId:', sessionId ? 'Present' : 'Missing');
      console.log('FormData contents:');
      for (const [key, value] of data.entries()) {
        console.log(key, value instanceof File ? `File: ${value.name}` : value);
      }

      const response = await fetch('/api/admin/pricing-tables', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sessionId}`,
        },
        body: data,
      });
      
      console.log('Response status:', response.status);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('Error response:', errorText);
        let error;
        try {
          error = JSON.parse(errorText);
        } catch {
          error = { error: errorText || '업로드에 실패했습니다.' };
        }
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
      console.error('Upload error:', error);
      toast({
        title: '오류',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleUploadPricing = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!pricingTitle.trim()) {
      toast({
        title: '오류',
        description: '제목을 입력해주세요.',
        variant: 'destructive',
      });
      return;
    }

    // 파일 업로드는 선택사항으로 변경됨

    const formData = new FormData();
    formData.append('title', pricingTitle);
    if (selectedFile) {
      formData.append('file', selectedFile);
    }

    uploadPricingMutation.mutate(formData);
  };

  if (user?.userType !== 'admin') {
    // 근무자는 자동으로 접수 관리 페이지로 리다이렉트
    window.location.href = '/documents';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">접수 관리 페이지로 이동 중...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout title="테스트 페이지">
      <div className="space-y-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            이 페이지는 단가표 업로드 기능을 테스트하기 위한 페이지입니다.
            <br />
            지원 파일 형식: Excel (.xlsx, .xls), PDF, JPG, JPEG
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <FileText className="h-5 w-5" />
              <span>단가표 업로드 테스트</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Dialog open={pricingDialogOpen} onOpenChange={setPricingDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Upload className="mr-2 h-4 w-4" />
                  단가표 업로드 테스트
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>새 단가표 업로드</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleUploadPricing} className="space-y-4">
                  <div>
                    <Label htmlFor="pricingTitle">제목</Label>
                    <Input
                      id="pricingTitle"
                      value={pricingTitle}
                      onChange={(e) => setPricingTitle(e.target.value)}
                      placeholder="단가표 제목을 입력하세요"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="pricingFile">파일</Label>
                    <Input
                      id="pricingFile"
                      type="file"
                      accept=".xlsx,.xls,.pdf,.jpg,.jpeg"
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Excel 파일(.xlsx, .xls), PDF, JPG, JPEG 파일 업로드 가능 (최대 50MB)
                    </p>
                  </div>
                  {selectedFile && (
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-700">
                        선택된 파일: <strong>{selectedFile.name}</strong>
                      </p>
                      <p className="text-xs text-gray-500">
                        크기: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      <p className="text-xs text-gray-500">
                        타입: {selectedFile.type}
                      </p>
                    </div>
                  )}
                  <div className="flex justify-end space-x-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setPricingDialogOpen(false)}
                    >
                      취소
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={uploadPricingMutation.isPending}
                    >
                      {uploadPricingMutation.isPending ? '업로드 중...' : '업로드'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>

            <div className="mt-4 space-y-2">
              <h3 className="font-medium text-gray-900">디버그 정보</h3>
              <div className="text-sm text-gray-600 space-y-1">
                <p>현재 사용자: {user?.name} ({user?.userType})</p>
                <p>세션 ID: {useAuth.getState().sessionId ? '있음' : '없음'}</p>
                <p>업로드 상태: {uploadPricingMutation.isPending ? '진행 중' : '대기'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}