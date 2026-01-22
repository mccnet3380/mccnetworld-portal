import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle, AlertCircle, Building, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import logoImage from '@assets/KakaoTalk_20250626_162541112-removebg-preview_1751604392501.png';

export function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showRegister, setShowRegister] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [registerData, setRegisterData] = useState({
    kpNumber: '',
    username: '',
    password: '',
    name: ''
  });
  const [kpValidation, setKpValidation] = useState({
    isValid: false,
    dealerName: '',
    location: '',
    isChecking: false
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const success = await login(formData);
      if (success) {
        setLocation('/dashboard');
      } else {
        setError('아이디 또는 비밀번호가 올바르지 않습니다.');
      }
    } catch (err: any) {
      setError(err.message || '로그인 중 오류가 발생했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRegisterData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const validateKPNumber = async (kpNumber: string) => {
    if (!kpNumber.trim()) {
      setKpValidation({ isValid: false, dealerName: '', location: '', isChecking: false });
      return;
    }

    setKpValidation(prev => ({ ...prev, isChecking: true }));
    try {
      const response = await fetch(`/api/kp-info/${kpNumber}`);
      if (response.ok) {
        const kpInfo = await response.json();
        setKpValidation({
          isValid: true,
          dealerName: kpInfo.dealerName,
          location: kpInfo.location,
          isChecking: false
        });
      } else {
        setKpValidation({
          isValid: false,
          dealerName: '',
          location: '',
          isChecking: false
        });
      }
    } catch (error) {
      setKpValidation({
        isValid: false,
        dealerName: '',
        location: '',
        isChecking: false
      });
    }
  };

  const handleKPNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setRegisterData(prev => ({
      ...prev,
      kpNumber: value
    }));
    
    if (value.length >= 3) {
      setTimeout(() => validateKPNumber(value), 500);
    } else {
      setKpValidation({ isValid: false, dealerName: '', location: '', isChecking: false });
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!kpValidation.isValid) {
      toast({
        title: '오류',
        description: '유효한 KP번호를 입력해주세요.',
        variant: 'destructive'
      });
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/register/dealer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registerData),
      });

      if (response.ok) {
        toast({
          title: '성공',
          description: '판매점 계정이 성공적으로 생성되었습니다. 로그인해주세요.',
          variant: 'default'
        });
        setRegisterData({ kpNumber: '', username: '', password: '', name: '' });
        setKpValidation({ isValid: false, dealerName: '', location: '', isChecking: false });
        setShowRegister(false);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || '계정 생성 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      toast({
        title: '오류',
        description: err.message,
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <img 
            src={logoImage} 
            alt="MCC네트월드 로고" 
            className="h-16 w-auto"
          />
        </div>
        <h2 className="mt-3 text-center text-5xl font-bold text-gray-900">
          MCC
        </h2>
        <p className="mt-1 text-center text-sm text-gray-600">
          Empowering Mobile Innovation
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>MCC</CardTitle>
            <CardDescription>
              계정 정보를 입력하여 로그인하거나 새 계정을 생성하세요
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!showRegister ? (
              <div className="space-y-6">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <div>
                    <Label htmlFor="username">아이디</Label>
                    <Input
                      id="username"
                      name="username"
                      type="text"
                      required
                      value={formData.username}
                      onChange={handleChange}
                      placeholder="아이디를 입력하세요"
                      className="mt-1"
                      data-testid="input-username"
                    />
                  </div>

                  <div>
                    <Label htmlFor="password">비밀번호</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      required
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="비밀번호를 입력하세요"
                      className="mt-1"
                      data-testid="input-password"
                    />
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-slate-800 hover:bg-slate-900"
                    disabled={isLoading}
                    data-testid="button-login"
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    로그인
                  </Button>
                </form>

                <div className="space-y-3">
                  <div className="text-center">
                    <p className="text-sm text-gray-600">판매점이신가요?</p>
                  </div>

                  <Link href="/dealer-login">
                    <Button
                      variant="outline"
                      className="w-full"
                      data-testid="button-dealer-login"
                    >
                      <Building className="mr-2 h-4 w-4" />
                      판매점 로그인
                    </Button>
                  </Link>

                  {/* 숨김: 판매점 신규등록 버튼 */}
                  {false && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowRegister(true)}
                      data-testid="button-dealer-register"
                    >
                      <UserPlus className="mr-2 h-4 w-4" />
                      판매점 신규등록
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="mb-4">
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      판매점 계정만 생성할 수 있습니다. 관리자 및 근무자 계정은 관리자에게 문의하세요.
                    </AlertDescription>
                  </Alert>
                </div>

                <form onSubmit={handleRegisterSubmit} className="space-y-6">
                  <div>
                    <Label htmlFor="kpNumber">KP번호</Label>
                    <div className="relative">
                      <Input
                        id="kpNumber"
                        name="kpNumber"
                        type="text"
                        required
                        value={registerData.kpNumber}
                        onChange={handleKPNumberChange}
                        placeholder="KP번호를 입력하세요 (예: KP001)"
                        className="mt-1"
                      />
                      {kpValidation.isChecking && (
                        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      )}
                    </div>
                    {kpValidation.isValid && (
                      <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                        <div className="flex items-center space-x-2">
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <Badge variant="outline" className="text-green-700 border-green-300">
                            유효한 KP번호
                          </Badge>
                        </div>
                        <p className="text-sm text-green-800 mt-1">
                          <strong>판매점:</strong> {kpValidation.dealerName}
                        </p>
                        <p className="text-sm text-green-800">
                          <strong>위치:</strong> {kpValidation.location}
                        </p>
                      </div>
                    )}
                    {registerData.kpNumber && !kpValidation.isValid && !kpValidation.isChecking && (
                      <p className="mt-2 text-sm text-red-600">
                        유효하지 않은 KP번호입니다.
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="register-name">이름</Label>
                    <Input
                      id="register-name"
                      name="name"
                      type="text"
                      required
                      value={registerData.name}
                      onChange={handleRegisterChange}
                      placeholder="이름을 입력하세요"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="register-username">아이디</Label>
                    <Input
                      id="register-username"
                      name="username"
                      type="text"
                      required
                      value={registerData.username}
                      onChange={handleRegisterChange}
                      placeholder="아이디를 입력하세요 (최소 3자)"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <Label htmlFor="register-password">비밀번호</Label>
                    <Input
                      id="register-password"
                      name="password"
                      type="password"
                      required
                      value={registerData.password}
                      onChange={handleRegisterChange}
                      placeholder="비밀번호를 입력하세요 (최소 6자)"
                      className="mt-1"
                    />
                  </div>

                  <div className="space-y-3">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isLoading || !kpValidation.isValid}
                    >
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      계정 생성
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => setShowRegister(false)}
                    >
                      로그인으로 돌아가기
                    </Button>
                  </div>
                </form>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
