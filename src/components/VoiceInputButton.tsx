import { useMemo } from "react";
import { Mic, Loader2, Square, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UseSakuraSTTReturn } from "@/hooks/useSakuraSTT";

interface VoiceInputButtonProps {
  stt: Pick<
    UseSakuraSTTReturn,
    "isSupported" | "isRecording" | "isTranscribing" | "recordingTimeLabel" | "audioLevel" | "error"
  >;
  disabled?: boolean;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  className?: string;
}

function toLevelPercentage(audioLevel: number): number {
  return Math.round(Math.max(0, Math.min(1, audioLevel)) * 100);
}

export function VoiceInputButton({
  stt,
  disabled,
  onStart,
  onStop,
  className,
}: VoiceInputButtonProps) {
  const isBusy = stt.isTranscribing;
  const buttonDisabled = disabled || isBusy || !stt.isSupported;

  const statusText = useMemo(() => {
    if (!stt.isSupported) {
      return "このブラウザでは音声入力が利用できません";
    }
    if (stt.isTranscribing) {
      return "音声をテキスト化しています…";
    }
    if (stt.isRecording) {
      return `録音中 ${stt.recordingTimeLabel} / レベル ${toLevelPercentage(stt.audioLevel)}%`;
    }
    if (stt.error) {
      return stt.error;
    }
    return "音声入力を開始";
  }, [
    stt.audioLevel,
    stt.error,
    stt.isRecording,
    stt.isSupported,
    stt.isTranscribing,
    stt.recordingTimeLabel,
  ]);

  const handleClick = async () => {
    if (buttonDisabled) return;
    if (stt.isRecording) {
      await onStop();
      return;
    }
    await onStart();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={stt.isRecording ? "destructive" : "outline"}
          size="icon"
          onClick={() => {
            void handleClick();
          }}
          disabled={buttonDisabled}
          className={cn("h-11 w-11 shrink-0 relative", className)}
          aria-label={statusText}
          title={statusText}
        >
          {isBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : stt.isRecording ? (
            <Square className="h-4 w-4" />
          ) : stt.error ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          {stt.isRecording && (
            <span
              className={cn(
                "pointer-events-none absolute inset-0 rounded-md border border-red-400/70",
                "animate-pulse",
              )}
              aria-hidden="true"
            />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{statusText}</TooltipContent>
    </Tooltip>
  );
}
