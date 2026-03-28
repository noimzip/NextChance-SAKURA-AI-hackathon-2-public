import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Volume2,
  Loader2,
  Sparkles,
  Image as ImageIcon,
  Copy,
  Check,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/types";
import { splitChatContentBlocks } from "@/lib/chatTableParser";
import { copyTextToClipboard } from "@/lib/clipboard";
import { getTitleColumnIndex, isLikelyScheduleTable } from "@/lib/scheduleTable";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

interface ChatMessageProps {
  message: ChatMessageType;
  onPlayVoice?: () => void;
  isPlaying?: boolean;
  onScheduleClick?: (title: string) => void;
  onRetryMessage?: (messageId: string) => void;
  retryDisabled?: boolean;
  onDeleteMessage?: (messageId: string) => void;
  deleteDisabled?: boolean;
}

export function ChatMessage({
  message,
  onPlayVoice,
  isPlaying,
  onScheduleClick,
  onRetryMessage,
  retryDisabled,
  onDeleteMessage,
  deleteDisabled,
}: ChatMessageProps) {
  const isAssistant = message.role === "assistant";
  const contentBlocks = isAssistant ? splitChatContentBlocks(message.content) : null;
  const [isImageDialogOpen, setIsImageDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const hasImageAttachment = Boolean(message.imageAttachmentDataUrl);
  const canCopy = message.content.trim().length > 0;

  const handleCopyMessage = async () => {
    if (!canCopy) return;
    try {
      await copyTextToClipboard(message.content);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy message:", error);
    }
  };

  return (
    <div
      className={cn(
        "flex gap-3 p-4 transition-colors",
        isAssistant
          ? "bg-gradient-to-r from-emerald-50/50 to-transparent"
          : "bg-background hover:bg-muted/30",
      )}
    >
      <Avatar className={cn("h-9 w-9 shrink-0", isAssistant && "ring-2 ring-emerald-200")}>
        <AvatarFallback
          className={cn(
            "text-sm font-medium",
            isAssistant
              ? "bg-gradient-to-br from-emerald-400 to-green-500 text-white"
              : "bg-slate-100 text-slate-600",
          )}
        >
          {isAssistant ? "🌱" : "👤"}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-sm font-semibold",
              isAssistant &&
                "bg-gradient-to-r from-emerald-600 to-green-600 bg-clip-text text-transparent",
            )}
          >
            {isAssistant ? "さくら" : "あなた"}
          </span>
          {isAssistant && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">
              <Sparkles className="h-2.5 w-2.5" />
              AI秘書
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {message.hasImageAttachment && (
            <span className="inline-flex items-center gap-1 text-[10px] text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">
              <ImageIcon className="h-2.5 w-2.5" />
              {message.imageAttachmentName ?? "画像添付"}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => {
                void handleCopyMessage();
              }}
              disabled={!canCopy}
              title={isCopied ? "コピーしました" : "コピー"}
              aria-label={isCopied ? "コピーしました" : "コピー"}
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            {message.role === "user" && onRetryMessage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-slate-100 hover:text-slate-700"
                onClick={() => onRetryMessage(message.id)}
                disabled={retryDisabled}
                title="この質問を再実行"
                aria-label="この質問を再実行"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            {isAssistant && onPlayVoice && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-emerald-100 hover:text-emerald-700"
                onClick={onPlayVoice}
                disabled={isPlaying}
                title="音声で再生"
              >
                {isPlaying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {onDeleteMessage && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={deleteDisabled}
                title="このメッセージを削除"
                aria-label="このメッセージを削除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        {isAssistant && contentBlocks ? (
          <div className="space-y-3">
            {contentBlocks.map((block, index) => {
              if (block.type === "text") {
                return (
                  <div
                    key={`text-${index}`}
                    className={cn("text-sm leading-relaxed", isAssistant && "text-slate-700")}
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => (
                          <ul className="list-disc pl-5 mb-2 last:mb-0 space-y-1">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal pl-5 mb-2 last:mb-0 space-y-1">{children}</ol>
                        ),
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        h1: ({ children }) => (
                          <h1 className="text-base font-bold mb-2">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-[15px] font-semibold mb-2">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-sm font-semibold mb-1.5">{children}</h3>
                        ),
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-700 underline hover:text-emerald-900"
                          >
                            {children}
                          </a>
                        ),
                        code: ({ className, children }) => {
                          const content =
                            typeof children === "string"
                              ? children
                              : Array.isArray(children)
                                ? children
                                    .filter((child): child is string => typeof child === "string")
                                    .join("")
                                : "";
                          const isBlock =
                            Boolean(className?.includes("language-")) || content.includes("\n");
                          if (isBlock) {
                            return (
                              <code
                                className={cn(
                                  "block overflow-x-auto rounded-md bg-slate-900 text-slate-100",
                                  "px-3 py-2 text-[12px] font-mono leading-relaxed",
                                )}
                              >
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code
                              className={cn(
                                "rounded bg-emerald-50 px-1.5 py-0.5",
                                "text-[12px] text-emerald-800 font-mono",
                                className,
                              )}
                            >
                              {children}
                            </code>
                          );
                        },
                        pre: ({ children }) => (
                          <pre className="my-2 overflow-x-auto rounded-md bg-slate-900 p-0">
                            {children}
                          </pre>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-2 border-emerald-300 pl-3 italic text-slate-600 mb-2">
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {block.text}
                    </ReactMarkdown>
                  </div>
                );
              }

              return (
                <div
                  key={`table-${index}`}
                  className="rounded-xl border border-emerald-200/80 bg-white/85 shadow-sm overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead className="bg-gradient-to-r from-emerald-100 to-emerald-50">
                        <tr>
                          {block.table.headers.map((header, headerIndex) => (
                            <th
                              key={`${header}-${headerIndex}`}
                              className={cn(
                                "px-3 py-2 text-left font-semibold text-emerald-900",
                                "border-b border-emerald-200",
                                headerIndex !== block.table.headers.length - 1 &&
                                  "border-r border-emerald-100",
                              )}
                            >
                              {header || " "}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const scheduleTable = isLikelyScheduleTable(block.table.headers);
                          const titleColumnIndex = scheduleTable
                            ? getTitleColumnIndex(block.table.headers)
                            : -1;

                          return block.table.rows.map((row, rowIndex) => (
                            <tr
                              key={rowIndex}
                              className={rowIndex % 2 === 0 ? "bg-white" : "bg-emerald-50/40"}
                            >
                              {row.map((cell, cellIndex) => {
                                const isTitleCell =
                                  scheduleTable &&
                                  titleColumnIndex >= 0 &&
                                  cellIndex === titleColumnIndex &&
                                  cell.trim().length > 0;
                                return (
                                  <td
                                    key={`${rowIndex}-${cellIndex}`}
                                    className={cn(
                                      "px-3 py-2.5 text-slate-700 align-top",
                                      "border-b border-emerald-100",
                                      cellIndex !== row.length - 1 && "border-r border-emerald-50",
                                    )}
                                  >
                                    {isTitleCell && onScheduleClick ? (
                                      <button
                                        type="button"
                                        onClick={() => onScheduleClick(cell.trim())}
                                        className={cn(
                                          "whitespace-pre-wrap break-words text-left w-full",
                                          "text-emerald-700 hover:text-emerald-900 hover:underline",
                                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-sm",
                                        )}
                                        title="詳細を表示"
                                      >
                                        {cell}
                                      </button>
                                    ) : (
                                      <span className="whitespace-pre-wrap break-words">
                                        {cell.length > 0 ? cell : "-"}
                                      </span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ));
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={cn(
              "text-sm leading-relaxed whitespace-pre-wrap",
              isAssistant && "text-slate-700",
            )}
          >
            {message.content}
          </div>
        )}
        {hasImageAttachment && (
          <>
            <button
              type="button"
              onClick={() => setIsImageDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50/70 px-2 py-1 hover:bg-blue-100 transition-colors"
            >
              <img
                src={message.imageAttachmentDataUrl}
                alt={message.imageAttachmentName ?? "添付画像"}
                className="h-12 w-12 rounded object-cover border"
              />
              <span className="text-xs text-blue-700">
                {message.imageAttachmentName ?? "添付画像"} を表示
              </span>
            </button>
            <Dialog open={isImageDialogOpen} onOpenChange={setIsImageDialogOpen}>
              <DialogContent className="max-w-2xl p-3">
                <DialogHeader>
                  <DialogTitle>{message.imageAttachmentName ?? "添付画像"}</DialogTitle>
                  <DialogDescription className="sr-only">
                    添付画像を拡大表示しています。
                  </DialogDescription>
                </DialogHeader>
                <img
                  src={message.imageAttachmentDataUrl}
                  alt={message.imageAttachmentName ?? "添付画像"}
                  className="w-full max-h-[75vh] object-contain rounded"
                />
              </DialogContent>
            </Dialog>
          </>
        )}
        {onDeleteMessage && (
          <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>メッセージを削除</DialogTitle>
                <DialogDescription>
                  このメッセージを削除します。必要なら内容を控えてから実行してください。
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {message.content.trim().slice(0, 120) || "（本文なし）"}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                  キャンセル
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    onDeleteMessage(message.id);
                    setIsDeleteDialogOpen(false);
                  }}
                >
                  削除
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
