import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Building, User, Phone, Mail, FileText, Key } from "lucide-react";

const dealerRegistrationSchema = z.object({
  businessName: z.string().min(1, "사업자명을 입력해주세요"),
  businessRegistrationNumber: z.string().min(1, "사업자등록번호를 입력해주세요"),
  representativeName: z.string().min(1, "대표자명을 입력해주세요"),
  businessAddress: z.string().min(1, "사업장 주소를 입력해주세요"),
  phoneNumber: z.string().min(1, "연락처를 입력해주세요"),
  email: z.string().email("올바른 이메일 형식을 입력해주세요"),
  contactCode: z.string().optional(),
  username: z.string().min(4, "아이디는 4자 이상이어야 합니다"),
  password: z.string().min(6, "비밀번호는 6자 이상이어야 합니다"),
  additionalInfo: z.string().optional()
});

type DealerRegistrationForm = z.infer<typeof dealerRegistrationSchema>;

export function DealerRegistration() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const form = useForm<DealerRegistrationForm>({
    resolver: zodResolver(dealerRegistrationSchema),
    defaultValues: {
      businessName: "",
      businessRegistrationNumber: "",
      representativeName: "",
      businessAddress: "",
      phoneNumber: "",
      email: "",
      contactCode: "",
      username: "",
      password: "",
      additionalInfo: ""
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: DealerRegistrationForm) => {
      const response = await fetch("/api/dealer-registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "등록 신청 중 오류가 발생했습니다.");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      console.log("Registration successful:", data);
      setIsSubmitted(true);
      toast({
        title: "등록 신청 완료",
        description: "판매점 등록 신청이 완료되었습니다. 승인 후 이용 가능합니다.",
      });
    },
    onError: (error: any) => {
      console.error("Registration error:", error);
      toast({
        title: "등록 실패",
        description: error.message || "등록 신청 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  function onSubmit(data: DealerRegistrationForm) {
    registerMutation.mutate(data);
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <Building className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl">신청 완료</CardTitle>
            <CardDescription>
              판매점 등록 신청이 완료되었습니다.
              <br />
              관리자 승인 후 이용 가능합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              className="w-full" 
              onClick={() => window.location.href = "/"}
            >
              메인 페이지로 이동
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">판매점 등록</CardTitle>
            <CardDescription>
              MCC네트월드 판매점으로 등록하시려면 아래 정보를 입력해주세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* 사업자 정보 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    사업자 정보
                  </h3>
                  
                  <FormField
                    control={form.control}
                    name="businessName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>사업자명 *</FormLabel>
                        <FormControl>
                          <Input placeholder="예: (주)삼성전자" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="businessRegistrationNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>사업자등록번호 *</FormLabel>
                        <FormControl>
                          <Input placeholder="예: 123-45-67890" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="businessAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>사업장 주소 *</FormLabel>
                        <FormControl>
                          <Input placeholder="사업장 주소를 입력하세요" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 대표자 정보 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <User className="h-5 w-5" />
                    대표자 정보
                  </h3>

                  <FormField
                    control={form.control}
                    name="representativeName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>대표자명 *</FormLabel>
                        <FormControl>
                          <Input placeholder="대표자 성명을 입력하세요" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 연락처 정보 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <Phone className="h-5 w-5" />
                    연락처 정보
                  </h3>

                  <FormField
                    control={form.control}
                    name="phoneNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>연락처 *</FormLabel>
                        <FormControl>
                          <Input placeholder="예: 02-1234-5678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>이메일 *</FormLabel>
                        <FormControl>
                          <Input 
                            type="email" 
                            placeholder="예: dealer@example.com" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contactCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>접점코드 (선택사항)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="예: 웅)대리점명" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 계정 정보 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <Key className="h-5 w-5" />
                    계정 정보
                  </h3>

                  <FormField
                    control={form.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>아이디 *</FormLabel>
                        <FormControl>
                          <Input placeholder="로그인용 아이디 (4자 이상)" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>비밀번호 *</FormLabel>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="비밀번호 (6자 이상)" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 추가 정보 */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    추가 정보
                  </h3>

                  <FormField
                    control={form.control}
                    name="additionalInfo"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>추가 정보 (선택사항)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="추가로 전달할 정보가 있으시면 입력해주세요"
                            rows={3}
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending ? "처리중..." : "등록 신청"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}