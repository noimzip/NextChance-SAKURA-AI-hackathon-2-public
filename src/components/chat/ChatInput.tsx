import {
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Loader2, ImagePlus, X } from "lucide-react";

interface ModelOption {
  id: string;
  label: string;
}

interface ChatInputProps {
  onSend: (message: string) => void | Promise<void>;
  onImageAttach?: (file: File) => void | Promise<void>;
  attachedImageName?: string | null;
  onRemoveImageAttachment?: () => void;
  isLoading?: boolean;
  className?: string;
  actions?: ReactNode;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  modelOptions?: readonly ModelOption[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  canSendWithoutText?: boolean;
}

export function ChatInput({
  onSend,
  onImageAttach,
  attachedImageName,
  onRemoveImageAttachment,
  isLoading,
  className,
  actions,
  inputValue,
  onInputChange,
  modelOptions,
  selectedModel,
  onModelChange,
  canSendWithoutText = false,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isControlled = typeof inputValue === "string" && Boolean(onInputChange);
  const currentInput = isControlled ? inputValue : input;
  const showModelSelector =
    Boolean(modelOptions && modelOptions.length > 0) &&
    typeof selectedModel === "string" &&
    Boolean(onModelChange);
  const hasAttachment = Boolean(attachedImageName);

  const updateInput = (value: string) => {
    if (isControlled) {
      onInputChange?.(value);
      return;
    }
    setInput(value);
  };

  const submitCurrentInput = () => {
    if (isLoading) return;
    const trimmed = currentInput.trim();
    if (!trimmed && !canSendWithoutText) return;
    void onSend(trimmed);
    updateInput("");
  };

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    void onImageAttach?.(file);
    event.target.value = "";
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitCurrentInput();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitCurrentInput();
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("p-4 border-t bg-background space-y-2", className)}>
      <div>
        <Textarea
          value={currentInput}
          onChange={(e) => updateInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力... (Shift+Enterで改行)"
          className="min-h-[44px] max-h-32 resize-none"
          disabled={isLoading}
          rows={1}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showModelSelector && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none">
            <label htmlFor="chat-model-selector" className="text-[11px] text-muted-foreground">
              Model
            </label>
            <select
              id="chat-model-selector"
              aria-label="AIモデル"
              value={selectedModel}
              onChange={(e) => onModelChange?.(e.target.value)}
              className={cn(
                "h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs sm:w-[280px] sm:flex-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              disabled={isLoading}
            >
              {modelOptions?.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {hasAttachment && (
          <span className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-100 px-2 text-[11px] text-blue-700">
            <span className="max-w-[120px] truncate">{attachedImageName}</span>
            {onRemoveImageAttachment && (
              <button
                type="button"
                aria-label="添付画像を外す"
                className="rounded p-0.5 hover:bg-blue-200"
                onClick={onRemoveImageAttachment}
                disabled={isLoading}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isLoading || !onImageAttach}
            className="shrink-0 h-9 w-9"
            title="画像を添付"
            aria-label="画像を添付"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageChange}
            />
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Button
            type="submit"
            size="icon"
            disabled={(!currentInput.trim() && !canSendWithoutText) || isLoading}
            className="shrink-0 h-9 w-9"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
