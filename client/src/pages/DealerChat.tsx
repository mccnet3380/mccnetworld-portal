import { useState, useEffect, useRef } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Send, MessageCircle, User, Clock } from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface ChatMessage {
  id: number;
  senderId: number;
  senderType: string;
  senderName: string;
  message: string;
  messageType: string;
  createdAt: string;
  isRead: boolean;
}

interface ChatRoom {
  id: number;
  documentId: number;
  createdAt: string;
}

interface DocumentInfo {
  id: number;
  documentNumber: string;
  customerName: string;
  status: string;
}

export function DealerChat() {
  const [match, params] = useRoute("/dealer-chat/:documentId");
  const documentId = params?.documentId ? parseInt(params.documentId) : null;
  const [newMessage, setNewMessage] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 채팅방 정보 조회
  const { data: chatData, isLoading } = useQuery({
    queryKey: [`/api/chat/room/${documentId}`],
    enabled: !!documentId,
    queryFn: async () => {
      // Get session ID from localStorage
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
      
      const res = await fetch(`/api/chat/room/${documentId}`, {
        headers,
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch chat room');
      }
      
      return res.json();
    },
  });

  // 채팅 메시지 조회
  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: [`/api/chat/messages/${chatData?.room?.id}`],
    enabled: !!chatData?.room?.id,
    refetchInterval: 2000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      // Get session ID from localStorage
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
      
      const res = await fetch(`/api/chat/messages/${chatData?.room?.id}`, {
        headers,
        credentials: "include",
      });
      
      if (!res.ok) {
        throw new Error('Failed to fetch messages');
      }
      
      return res.json();
    },
  });

  // WebSocket 연결 설정
  useEffect(() => {
    if (!chatData?.room?.id) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const websocket = new WebSocket(wsUrl);
    
    websocket.onopen = () => {
      console.log("WebSocket connected");
      setIsConnected(true);
      
      // 인증 (임시로 하드코딩, 실제로는 사용자 정보에서 가져와야 함)
      websocket.send(JSON.stringify({
        type: 'auth',
        userId: 1, // 임시 판매점 ID
        userType: 'dealer'
      }));
      
      // 채팅방 참여
      websocket.send(JSON.stringify({
        type: 'join_room',
        roomId: chatData.room.id
      }));
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WebSocket message received:", data);
      
      if (data.type === 'new_message') {
        // 새 메시지 수신 시 메시지 목록 새로고침
        queryClient.invalidateQueries({ 
          queryKey: [`/api/chat/messages/${chatData.room.id}`] 
        });
      }
    };

    websocket.onclose = () => {
      console.log("WebSocket disconnected");
      setIsConnected(false);
    };

    websocket.onerror = (error) => {
      console.error("WebSocket error:", error);
      setIsConnected(false);
      toast({
        title: "연결 오류",
        description: "채팅 서버에 연결할 수 없습니다.",
        variant: "destructive",
      });
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, [chatData?.room?.id, toast, queryClient]);

  // 메시지 전송
  const sendMessageMutation = useMutation({
    mutationFn: async (messageText: string) => {
      if (!chatData?.room?.id || !messageText.trim()) {
        throw new Error('Invalid message or room');
      }
      
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
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
      }
      
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          roomId: chatData.room.id,
          message: messageText.trim(),
        }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to send message');
      }
      
      return res.json();
    },
    onSuccess: () => {
      setNewMessage("");
      queryClient.invalidateQueries({ 
        queryKey: [`/api/chat/messages/${chatData?.room?.id}`] 
      });
      // 읽지 않은 메시지 개수 업데이트
      queryClient.invalidateQueries({ queryKey: ['/api/chat/unread-count'] });
      queryClient.invalidateQueries({ predicate: (query) => 
        query.queryKey[0] === '/api/dealer/applications' ||
        (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/dealer/applications'))
      });
    },
    onError: (error) => {
      console.error('Message send failed:', error);
      toast({
        title: "전송 실패",
        description: "메시지 전송에 실패했습니다.",
        variant: "destructive",
      });
    }
  });

  // 메시지 전송 핸들러
  const handleSendMessage = () => {
    if (newMessage.trim() && !sendMessageMutation.isPending) {
      sendMessageMutation.mutate(newMessage);
    }
  };

  // Enter 키 처리
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 채팅방 열 때 자동 읽음 처리
  useEffect(() => {
    if (chatData?.room?.id) {
      // Get session ID from localStorage
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
      
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (sessionId) {
        headers["Authorization"] = `Bearer ${sessionId}`;
      }
      
      fetch('/api/chat/mark-read', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ roomId: chatData.room.id })
      }).then(() => {
        // 읽지 않은 메시지 개수 및 문서 목록 업데이트
        queryClient.invalidateQueries({ queryKey: ['/api/chat/unread-count'] });
        queryClient.invalidateQueries({ predicate: (query) => 
          query.queryKey[0] === '/api/dealer/applications' ||
          (typeof query.queryKey[0] === 'string' && query.queryKey[0].startsWith('/api/dealer/applications'))
        });
      }).catch(error => {
        console.error('Failed to mark messages as read:', error);
      });
    }
  }, [chatData?.room?.id, queryClient]);

  // 자동 스크롤
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (isLoading || messagesLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">채팅방을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!chatData?.room) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">채팅방을 찾을 수 없습니다</h3>
            <p className="text-muted-foreground mb-4">
              요청하신 문서의 채팅방이 존재하지 않습니다.
            </p>
            <Link href="/dealer-dashboard">
              <Button>대시보드로 돌아가기</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const document = chatData.document;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "대기":
        return <Badge variant="secondary">대기</Badge>;
      case "진행중":
        return <Badge variant="default">진행중</Badge>;
      case "개통완료":
        return <Badge variant="secondary" className="bg-green-100 text-green-800">완료</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/dealer-dashboard">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  뒤로
                </Button>
              </Link>
              <div>
                <h1 className="text-lg font-semibold">
                  {document.documentNumber} - {document.customerName}
                </h1>
                <div className="flex items-center gap-2">
                  {getStatusBadge(document.status)}
                  <span className={`text-xs ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                    ● {isConnected ? '연결됨' : '연결 끊김'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 채팅 영역 */}
      <div className="max-w-4xl mx-auto p-4">
        <Card className="h-[calc(100vh-12rem)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">실시간 상담</CardTitle>
            <p className="text-sm text-muted-foreground">
              문서 처리 관련 문의사항을 담당자와 실시간으로 상담하실 수 있습니다.
            </p>
          </CardHeader>
          <Separator />
          
          {/* 메시지 영역 */}
          <CardContent className="flex flex-col h-full p-0">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4">
                {messages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>아직 메시지가 없습니다.</p>
                    <p className="text-sm">첫 메시지를 보내보세요!</p>
                  </div>
                ) : (
                  messages.map((message: ChatMessage) => (
                    <MessageBubble 
                      key={message.id} 
                      message={message} 
                      isOwnMessage={message.senderType === 'dealer'}
                    />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* 메시지 입력 영역 */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="메시지를 입력하세요..."
                  disabled={sendMessageMutation.isPending}
                  className="flex-1"
                />
                <Button 
                  onClick={handleSendMessage}
                  disabled={!newMessage.trim() || sendMessageMutation.isPending}
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {sendMessageMutation.isPending && (
                <p className="text-xs text-muted-foreground mt-1">
                  전송 중...
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isOwnMessage: boolean;
}

function MessageBubble({ message, isOwnMessage }: MessageBubbleProps) {
  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] ${isOwnMessage ? 'order-2' : 'order-1'}`}>
        <div className="flex items-center gap-2 mb-1">
          {!isOwnMessage && <User className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">
            {message.senderName}
          </span>
          <span className="text-xs text-muted-foreground">
            <Clock className="h-3 w-3 inline mr-1" />
            {format(new Date(message.createdAt), 'HH:mm')}
          </span>
        </div>
        <div className={`rounded-lg px-3 py-2 ${
          isOwnMessage 
            ? 'bg-blue-600 text-white' 
            : 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
        }`}>
          <p className="text-sm whitespace-pre-wrap">{message.message}</p>
        </div>
      </div>
    </div>
  );
}