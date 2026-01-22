import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApiRequest, useAuth } from '@/lib/auth';
interface PricingTable {
  id: number;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  uploadedBy: number;
  uploadedAt: Date;
  isActive: boolean;
}
import { Calculator, Download, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

export function PricingTables() {
  const apiRequest = useApiRequest();

  const { data: pricingTables, isLoading } = useQuery({
    queryKey: ['/api/pricing-tables'],
    queryFn: () => apiRequest('/api/pricing-tables') as Promise<PricingTable[]>,
  });

  const handleDownload = async (tableId: number) => {
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
      const contentDisposition = response.headers.get('Content-Disposition');
      const fileName = contentDisposition 
        ? decodeURIComponent(contentDisposition.split('filename=')[1]?.replace(/"/g, '') || `pricing_${tableId}`)
        : `pricing_${tableId}`;
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('다운로드 실패:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Layout title="단가표">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-lg font-medium text-gray-900">단가표 목록</h3>
          <p className="text-sm text-gray-500">
            최신 단가표와 이전 버전을 확인하고 다운로드할 수 있습니다.
          </p>
        </div>

        {/* Pricing Tables List */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mx-auto"></div>
            <p className="mt-2 text-sm text-gray-500">로딩 중...</p>
          </div>
        ) : pricingTables && pricingTables.length > 0 ? (
          <div className="grid gap-4">
            {pricingTables.map((table, index) => (
              <Card key={table.id} className={table.isActive ? 'ring-2 ring-accent' : ''}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-4">
                      <div className="flex-shrink-0">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          table.isActive ? 'bg-accent text-white' : 'bg-gray-100 text-gray-400'
                        }`}>
                          <Calculator className="w-5 h-5" />
                        </div>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <h4 className="text-lg font-medium text-gray-900 truncate">
                            {table.title}
                          </h4>
                          {table.isActive && (
                            <Badge className="bg-accent text-white">최신</Badge>
                          )}
                          {index === 0 && !table.isActive && (
                            <Badge variant="secondary">이전 버전</Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center space-x-4 text-sm text-gray-500">
                          <span className="flex items-center">
                            <FileText className="w-4 h-4 mr-1" />
                            {table.fileName}
                          </span>
                          <span>{formatFileSize(table.fileSize)}</span>
                          <span>
                            {format(new Date(table.uploadedAt), 'yyyy년 MM월 dd일 HH:mm', { locale: ko })}
                          </span>
                        </div>
                        
                        {table.isActive && (
                          <div className="mt-2 p-2 bg-blue-50 rounded-md">
                            <p className="text-sm text-blue-800">
                              📋 현재 사용 중인 단가표입니다. 가장 최신 정보를 확인하세요.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex-shrink-0">
                      <Button
                        onClick={() => handleDownload(table.id)}
                        className={table.isActive ? '' : 'bg-gray-600 hover:bg-gray-700'}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        다운로드
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="text-center py-12">
              <Calculator className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">단가표가 없습니다</h3>
              <p className="mt-1 text-sm text-gray-500">
                아직 등록된 단가표가 없습니다. 관리자가 단가표를 업로드할 때까지 기다려주세요.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Information Card */}
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-blue-900 flex items-center">
              <Calculator className="w-5 h-5 mr-2" />
              단가표 이용 안내
            </CardTitle>
          </CardHeader>
          <CardContent className="text-blue-800">
            <ul className="space-y-2 text-sm">
              <li>• 단가표는 정기적으로 업데이트됩니다.</li>
              <li>• 최신 단가표를 항상 확인하여 정확한 정보를 사용하세요.</li>
              <li>• 이전 버전 단가표도 참고용으로 다운로드할 수 있습니다.</li>
              <li>• 단가표 관련 문의사항은 본사 담당자에게 연락하세요.</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
