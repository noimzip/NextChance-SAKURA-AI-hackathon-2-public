import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { useChat } from "@/hooks/useChat";
import { useEffortLog } from "@/hooks/useEffortLog";
import { Trash2, AlertCircle, MessageSquare } from "lucide-react";
import { isApiConfigured } from "@/services/sakuraAI";

interface ChatPanelProps {
  className?: string;
}

export function ChatPanel({ className }: ChatPanelProps) {
  const { messages, isLoading, error, sendMessage, clearMessages, playVoice, isPlaying } =
    useChat();
  const { addActivity } = useEffortLog();
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleSendMessage = async (content: string) => {
    await sendMessage(content);
    addActivity({
      type: "ai_chat",
      description: "AI秘書とチャット",
    });
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const apiConfigured = isApiConfigured();

  return (
    <Card className={cn("flex flex-col h-full overflow-hidden", className)}>
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between space-y-0 pb-4 border-b bg-gradient-to-r from-emerald-50/80 to-transparent">
        <CardTitle className="text-xl flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-sm">
            <span className="text-lg">🌱</span>
          </div>
          <div>
            <span className="bg-gradient-to-r from-emerald-700 to-green-600 bg-clip-text text-transparent">
              さくら
            </span>
            <span className="text-xs text-muted-foreground ml-2 font-normal">AI秘書</span>
          </div>
        </CardTitle>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={clearMessages}
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title="チャット履歴をクリア"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        {!apiConfigured && (
          <div className="mx-4 my-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-amber-800">APIキーが未設定です</p>
              <p className="text-amber-700 text-xs mt-0.5">
                .envファイルにVITE_SAKURA_AI_API_KEYを設定してください
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-4 my-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-destructive">エラーが発生しました</p>
              <p className="text-destructive/80 text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <ScrollArea ref={scrollRef} className="flex-1">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 px-4">
              <div className="relative">
                <div className="h-20 w-20 rounded-full bg-gradient-to-br from-emerald-100 to-green-100 flex items-center justify-center mb-4">
                  <span className="text-4xl">🌱</span>
                </div>
                <div className="absolute -right-1 -bottom-1 h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center">
                  <MessageSquare className="h-3 w-3 text-white" />
                </div>
              </div>
              <p className="text-lg font-semibold text-slate-700 mt-2">こんにちは！さくらです</p>
              <p className="text-sm text-muted-foreground mt-1 text-center max-w-xs">
                予定の管理やタスクの相談など、なんでもお手伝いします。
              </p>
              <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-md">
                {["今日の予定を確認して", "明日の持ち物を教えて", "タスク管理のコツは？"].map(
                  (suggestion) => (
                    <Button
                      key={suggestion}
                      variant="outline"
                      size="sm"
                      onClick={() => handleSendMessage(suggestion)}
                      disabled={isLoading || !apiConfigured}
                      className="text-xs border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 transition-colors"
                    >
                      {suggestion}
                    </Button>
                  ),
                )}
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onPlayVoice={
                    message.role === "assistant" ? () => playVoice(message.id) : undefined
                  }
                  isPlaying={isPlaying === message.id}
                />
              ))}
              {isLoading && (
                <div className="flex gap-3 p-4 bg-gradient-to-r from-emerald-50/50 to-transparent">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center text-sm ring-2 ring-emerald-200">
                    🌱
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-emerald-600">さくらが考え中...</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <ChatInput onSend={handleSendMessage} isLoading={isLoading} />
      </CardContent>
    </Card>
  );
}
