import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DialoguePhase } from "@/hooks/useDialogueLoop";
import type { DialogueTurn } from "@/store/useChatStore";
import { Loader2, Mic, MessageCircle, Square, Volume2 } from "lucide-react";

interface DialogueOverlayProps {
  open: boolean;
  phase: DialoguePhase;
  statusLabel: string;
  sessionTitle: string | null;
  turns: DialogueTurn[];
  recordingTimeLabel?: string;
  audioLevel?: number;
  onStop: () => void | Promise<void>;
  className?: string;
}

function getPhaseIcon(phase: DialoguePhase) {
  switch (phase) {
    case "listening":
      return <Mic className="h-5 w-5 text-emerald-600" />;
    case "thinking":
      return <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />;
    case "speaking":
      return <Volume2 className="h-5 w-5 text-purple-600" />;
    case "confirming_interrupt":
      return <MessageCircle className="h-5 w-5 text-amber-600" />;
    default:
      return <MessageCircle className="h-5 w-5 text-muted-foreground" />;
  }
}

export function DialogueOverlay({
  open,
  phase,
  statusLabel,
  sessionTitle,
  turns,
  recordingTimeLabel,
  audioLevel = 0,
  onStop,
  className,
}: DialogueOverlayProps) {
  if (!open) return null;

  const level = Math.round(Math.max(0, Math.min(1, audioLevel)) * 100);

  return (
    <div
      className={cn(
        "absolute inset-0 z-30 bg-background/85 backdrop-blur-sm",
        "flex items-center justify-center p-4",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-xl p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">対話中：ずんだもん</p>
            <p className="text-base font-semibold">{sessionTitle ?? "新しい対話"}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => {
              void onStop();
            }}
          >
            <Square className="h-3.5 w-3.5" />
            終了
          </Button>
        </div>

        <div className="rounded-lg bg-muted/60 px-3 py-2 flex items-center gap-2">
          {getPhaseIcon(phase)}
          <span className="text-sm font-medium">{statusLabel}</span>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>入力レベル</span>
            <span>
              {recordingTimeLabel ? `${recordingTimeLabel} / ` : ""}
              {level}%
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width] duration-150"
              style={{ width: `${level}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">対話内容</p>
          <div className="max-h-52 overflow-y-auto rounded-md border border-border/60 bg-background/70 p-2 space-y-2">
            {turns.length === 0 ? (
              <p className="text-xs text-muted-foreground">まだ会話はありません。</p>
            ) : (
              turns.map((turn) => (
                <div key={turn.id} className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">
                    {turn.role === "user"
                      ? "あなた"
                      : turn.role === "assistant"
                        ? "さくら"
                        : "システム"}
                  </p>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">{turn.content}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
