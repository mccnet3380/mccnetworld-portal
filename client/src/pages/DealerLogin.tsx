import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Building, LogIn, UserPlus } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

const dealerLoginSchema = z.object({
  username: z.string().min(1, "아이디를 입력해주세요"),
  password: z.string().min(1, "비밀번호를 입력해주세요")
});

type DealerLoginForm = z.infer<typeof dealerLoginSchema>;

export function DealerLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const form = useForm<DealerLoginForm>({
    resolver: zodResolver(dealerLoginSchema),
    defaultValues: {
      username: "",
      password: ""
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: DealerLoginForm) => {
      const response = await apiRequest("POST", "/api/auth/dealer-login", data);
      return await response.json();
    },
    onSuccess: (data) => {
      console.log("Dealer login successful:", data);
      
      // Store authentication data in useAuth store
      useAuth.setState({
        user: data.user,
        sessionId: data.sessionId,
        isAuthenticated: true
      });
      
      toast({
        title: "로그인 성공",
        description: `${data.user.name}님, 환영합니다!`,
      });
      
      // 판매점 전용 대시보드로 이동 (없으면 /documents로 대체)
      setLocation("/dealer-dashboard");
    },
    onError: (error: any) => {
      console.error("Dealer login error:", error);
      toast({
        title: "로그인 실패",
        description: error.message || "로그인 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  function onSubmit(data: DealerLoginForm) {
    loginMutation.mutate(data);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-6">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <Building className="h-8 w-8 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-2xl">판매점 로그인</CardTitle>
            <CardDescription>
              MCC네트월드 판매점 계정으로 로그인하세요
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>아이디</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="아이디를 입력하세요"
                          autoComplete="username"
                          {...field} 
                        />
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
                      <FormLabel>비밀번호</FormLabel>
                      <FormControl>
                        <Input 
                          type="password"
                          placeholder="비밀번호를 입력하세요"
                          autoComplete="current-password"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={loginMutation.isPending}
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  {loginMutation.isPending ? "로그인 중..." : "로그인"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        {/* 숨김: 등록 안내 */}
        {false && (
          <Card>
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">
                  아직 계정이 없으신가요?
                </p>
                <Link href="/dealer-registration">
                  <Button variant="outline" className="w-full">
                    <UserPlus className="mr-2 h-4 w-4" />
                    판매점 등록
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 직원 로그인 링크 */}
        <div className="text-center">
          <Link href="/login" className="text-sm text-muted-foreground hover:text-primary">
            직원 로그인 →
          </Link>
        </div>
      </div>
    </div>
  );
}