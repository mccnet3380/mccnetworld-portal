import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useApiRequest, useAuth } from '@/lib/auth';
import { useToast } from '@/hooks/use-toast';
import { Download, FileText, Calendar, Calculator } from 'lucide-react';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

interface DocumentTemplate {
  id: number;
  title: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  category: '가입서류' | '변경서류';
  uploadedAt: Date;
  isActive: boolean;
}

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

export function Downloads() {
  const apiRequest = useApiRequest();
  const { toast } = useToast();
  const [filter, setFilter] = useState<'all' | '가입서류' | '변경서류'>('all');

  const { data: documents, isLoading } = useQuery({
    queryKey: ['/api/document-templates'],
    queryFn: () => apiRequest('/api/document-templates') as Promise<DocumentTemplate[]>,
  });

  const { data: pricingTables, isLoading: pricingLoading } = useQuery({
    queryKey: ['/api/pricing-tables'],
    queryFn: () => apiRequest('/api/pricing-tables') as Promise<PricingTable[]>,
  });

  const handleDownload = async (documentId: number, fileName: string) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch(`/api/document-templates/${documentId}/download`, {
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

  const handlePricingDownload = async (pricingId: number, fileName: string) => {
    try {
      const sessionId = useAuth.getState().sessionId;
      const response = await fetch(`/api/files/pricing/${pricingId}`, {
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

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case '가입서류':
        return <Badge variant="outline" className="text-blue-600 border-blue-600">가입서류</Badge>;
      case '변경서류':
        return <Badge variant="outline" className="text-green-600 border-green-600">변경서류</Badge>;
      default:
        return <Badge variant="secondary">{category}</Badge>;
    }
  };

  const filteredDocuments = Array.isArray(documents) ? documents.filter(doc => 
    doc.isActive && (filter === 'all' || doc.category === filter)
  ) : [];

  return (
    <Layout title="서식지 다운로드">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-lg font-medium text-gray-900">서식지 다운로드</h3>
          <p className="text-sm text-gray-500">
            가입서류 및 변경서류를 다운로드할 수 있습니다.
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg w-fit">
          {['all', '가입서류', '변경서류'].map((category) => (
            <button
              key={category}
              onClick={() => setFilter(category as typeof filter)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                filter === category
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {category === 'all' ? '전체' : category}
            </button>
          ))}
        </div>

        {/* Documents Grid */}
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </CardHeader>
                <CardContent>
                  <div className="h-10 bg-gray-200 rounded"></div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredDocuments.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <FileText className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">서류가 없습니다</h3>
              <p className="mt-1 text-sm text-gray-500">
                {filter === 'all' ? '등록된 서류가 없습니다.' : `${filter} 서류가 없습니다.`}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDocuments.map((doc) => (
              <Card key={doc.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-sm font-medium line-clamp-2">
                      {doc.title}
                    </CardTitle>
                    {getCategoryBadge(doc.category)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center text-sm text-gray-500">
                    <FileText className="mr-2 h-4 w-4" />
                    <span className="truncate">{doc.fileName}</span>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{formatFileSize(doc.fileSize)}</span>
                    <div className="flex items-center">
                      <Calendar className="mr-1 h-3 w-3" />
                      {format(new Date(doc.uploadedAt), 'yy.MM.dd', { locale: ko })}
                    </div>
                  </div>

                  <Button 
                    onClick={() => handleDownload(doc.id, doc.fileName)}
                    className="w-full"
                    size="sm"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    다운로드
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pricing Tables Section */}
        <div className="mt-8 space-y-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">단가표</h3>
            <p className="text-sm text-gray-500">
              최신 단가표를 다운로드할 수 있습니다.
            </p>
          </div>

          {pricingLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardHeader>
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </CardHeader>
                  <CardContent>
                    <div className="h-10 bg-gray-200 rounded"></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : pricingTables && pricingTables.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pricingTables
                .filter(table => table.isActive)
                .slice(0, 5)
                .map((table) => (
                <Card key={table.id} className="hover:shadow-md transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-sm font-medium line-clamp-2">
                        {table.title}
                      </CardTitle>
                      <Badge variant="outline" className="text-purple-600 border-purple-600">
                        단가표
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center text-sm text-gray-500">
                      <Calculator className="mr-2 h-4 w-4" />
                      <span className="truncate">{table.fileName}</span>
                    </div>
                    
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>{formatFileSize(table.fileSize)}</span>
                      <div className="flex items-center">
                        <Calendar className="mr-1 h-3 w-3" />
                        {format(new Date(table.uploadedAt), 'yy.MM.dd', { locale: ko })}
                      </div>
                    </div>

                    <Button 
                      onClick={() => handlePricingDownload(table.id, table.fileName)}
                      className="w-full"
                      size="sm"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      다운로드
                    </Button>
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
                  등록된 단가표가 없습니다.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </Layout>
  );
}