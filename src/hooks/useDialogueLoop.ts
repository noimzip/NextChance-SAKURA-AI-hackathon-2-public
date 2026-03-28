import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSakuraSTT } from "@/hooks/useSakuraSTT";
import type { UseSakuraSTTReturn } from "@/hooks/useSakuraSTT";
import { createAudioUrl, revokeAudioUrl, synthesizeSpeech } from "@/services/speechService";
import { useChatStore } from "@/store/useChatStore";
import { formatDialogueSpeechText } from "@/lib/dialogueSpeech";
import type { DialogueTurn } from "@/store/useChatStore";

const DIALOGUE_STOP_KEYWORDS = [
  "バイバイ",
  "終了",
  "終わり",
  "おわり",
  "さようなら",
  "またね",
] as const;
const DEFAULT_SILENCE_EXIT_MS = 3_500;
const DEFAULT_LISTENING_LEVEL_THRESHOLD = 0.3;
const DEFAULT_INTERRUPT_LEVEL_THRESHOLD = 0.3;
const DEFAULT_INTERRUPT_GRACE_MS = 700;
const DEFAULT_INTERRUPT_HOLD_MS = 350;
const DEFAULT_INTERRUPT_PROMPT = "何か追加で言いたいのだ？";
const DIALOGUE_STT_SILENCE_TIMEOUT_MS = 3_500;
const DIALOGUE_STT_MAX_RECORDING_MS = 30_000;

export type DialoguePhase =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "confirming_interrupt"
  | "stopping";

export type DialogueStopReason = "manual" | "silent_timeout" | "keyword_exit" | "error";

type AudioLike = Pick<HTMLAudioElement, "onended" | "onerror" | "currentTime" | "pause" | "play">;

interface DialogueSttStatus {
  isSupported: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  recordingTimeLabel: string;
  audioLevel: number;
}

interface SendMessageOptions {
  threadId?: string;
}

type SendMessageAndGetReply = (
  content: string,
  options?: SendMessageOptions,
) => Promise<string | null>;

type StartInterruptMonitor = (
  onInterrupt: () => void,
  threshold: number,
) => Promise<() => void> | (() => void);

type PlaybackResult = "ended" | "interrupted" | "error";

interface UseDialogueLoopOptions {
  createThread: (title?: string) => string;
  selectThread: (threadId: string) => void;
  sendMessageAndGetReply: SendMessageAndGetReply;
  onError?: (message: string) => void;
  silenceExitMs?: number;
  listeningLevelThreshold?: number;
  interruptLevelThreshold?: number;
  createAudio?: (url: string) => AudioLike;
  synthesize?: typeof synthesizeSpeech;
  createInterruptMonitor?: StartInterruptMonitor;
  sttFactory?: typeof useSakuraSTT;
}

export interface UseDialogueLoopReturn {
  isActive: boolean;
  phase: DialoguePhase;
  statusLabel: string;
  sessionTitle: string | null;
  error: string | null;
  turns: DialogueTurn[];
  stt: DialogueSttStatus;
  startDialogue: () => Promise<void>;
  stopDialogue: (reason?: DialogueStopReason) => Promise<void>;
  toggleDialogue: () => Promise<void>;
}

function createDefaultAudio(url: string): AudioLike {
  return new Audio(url);
}

function containsStopKeyword(input: string): boolean {
  const normalized = input.replace(/\s+/g, "");
  return DIALOGUE_STOP_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

async function startDefaultInterruptMonitor(
  onInterrupt: () => void,
  threshold: number,
): Promise<() => void> {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return () => undefined;
  }

  if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
    return () => undefined;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const audioContext = new window.AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.8;
  source.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  let rafId: number | null = null;
  let interrupted = false;
  const monitorStartedAt = Date.now();
  let aboveThresholdStartedAt: number | null = null;

  const poll = () => {
    analyser.getByteTimeDomainData(data);

    let squareSum = 0;
    for (let index = 0; index < data.length; index += 1) {
      const normalized = (data[index] - 128) / 128;
      squareSum += normalized * normalized;
    }

    const rms = Math.sqrt(squareSum / data.length);
    const level = Math.min(1, rms * 3);
    const now = Date.now();
    const withinGracePeriod = now - monitorStartedAt < DEFAULT_INTERRUPT_GRACE_MS;

    if (withinGracePeriod) {
      aboveThresholdStartedAt = null;
      rafId = window.requestAnimationFrame(poll);
      return;
    }

    if (level >= threshold) {
      if (aboveThresholdStartedAt === null) {
        aboveThresholdStartedAt = now;
      }

      if (
        !interrupted &&
        aboveThresholdStartedAt !== null &&
        now - aboveThresholdStartedAt >= DEFAULT_INTERRUPT_HOLD_MS
      ) {
        interrupted = true;
        onInterrupt();
        return;
      }
    } else {
      aboveThresholdStartedAt = null;
    }

    rafId = window.requestAnimationFrame(poll);
  };

  rafId = window.requestAnimationFrame(poll);

  return () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
    }
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void audioContext.close();
  };
}

function getPhaseLabel(phase: DialoguePhase): string {
  switch (phase) {
    case "idle":
      return "待機中";
    case "listening":
      return "聞き取り中";
    case "thinking":
      return "考え中";
    case "speaking":
      return "話し中";
    case "confirming_interrupt":
      return DEFAULT_INTERRUPT_PROMPT;
    case "stopping":
      return "終了中";
    default:
      return "待機中";
  }
}

export function useDialogueLoop(options: UseDialogueLoopOptions): UseDialogueLoopReturn {
  const {
    createThread,
    selectThread,
    sendMessageAndGetReply,
    onError,
    silenceExitMs = DEFAULT_SILENCE_EXIT_MS,
    listeningLevelThreshold = DEFAULT_LISTENING_LEVEL_THRESHOLD,
    interruptLevelThreshold = DEFAULT_INTERRUPT_LEVEL_THRESHOLD,
    createAudio = createDefaultAudio,
    synthesize = synthesizeSpeech,
    createInterruptMonitor = startDefaultInterruptMonitor,
    sttFactory = useSakuraSTT,
  } = options;

  const startDialogueSession = useChatStore((state) => state.startDialogueSession);
  const setSessionThreadId = useChatStore((state) => state.setSessionThreadId);
  const addTurn = useChatStore((state) => state.addTurn);
  const finishDialogueSession = useChatStore((state) => state.finishDialogueSession);
  const sessions = useChatStore((state) => state.sessions);

  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shouldRestartListening, setShouldRestartListening] = useState(false);

  const isActiveRef = useRef(false);
  const stoppingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const listeningStartedAtRef = useRef<number | null>(null);
  const hasVoiceActivityRef = useRef(false);
  const speakingAudioRef = useRef<AudioLike | null>(null);
  const stopInterruptMonitorRef = useRef<(() => void) | null>(null);
  const stopDialogueRef = useRef<(reason?: DialogueStopReason) => Promise<void>>(async () => {});
  const handleTranscriptRef = useRef<(recognizedText: string) => Promise<void>>(async () => {});
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const stt = sttFactory({
    maxRecordingMs: DIALOGUE_STT_MAX_RECORDING_MS,
    silenceTimeoutMs: DIALOGUE_STT_SILENCE_TIMEOUT_MS,
    silenceLevelThreshold: listeningLevelThreshold,
    onTranscript: async (recognizedText) => {
      await handleTranscriptRef.current(recognizedText);
    },
    onError: (message) => {
      if (!isActiveRef.current || stoppingRef.current) {
        return;
      }
      setError(message);
      onError?.(message);
      void stopDialogueRef.current("error");
    },
  }) as UseSakuraSTTReturn;

  const cleanupSpeaking = useCallback(() => {
    if (speakingAudioRef.current) {
      speakingAudioRef.current.pause();
      speakingAudioRef.current.currentTime = 0;
      speakingAudioRef.current = null;
    }
    if (stopInterruptMonitorRef.current) {
      stopInterruptMonitorRef.current();
      stopInterruptMonitorRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    if (!isActiveRef.current || stoppingRef.current) {
      return;
    }

    listeningStartedAtRef.current = Date.now();
    hasVoiceActivityRef.current = false;
    setPhase("listening");
    await stt.start();
  }, [stt]);

  const playAssistantVoice = useCallback(
    async (text: string): Promise<PlaybackResult> => {
      let audioUrl: string | null = null;
      let stopMonitor: (() => void) | null = null;

      try {
        const speechBlob = await synthesize(text, { model: "zundamon" });
        audioUrl = createAudioUrl(speechBlob);
        const audio = createAudio(audioUrl);
        speakingAudioRef.current = audio;

        let settlePlayback: ((next: PlaybackResult) => void) | null = null;
        let interruptedBeforeReady = false;
        const onInterrupt = () => {
          if (!isActiveRef.current || stoppingRef.current) return;
          audio.pause();
          audio.currentTime = 0;
          if (settlePlayback) {
            settlePlayback("interrupted");
            return;
          }
          interruptedBeforeReady = true;
        };

        try {
          stopMonitor = await Promise.resolve(
            createInterruptMonitor(onInterrupt, interruptLevelThreshold),
          );
          stopInterruptMonitorRef.current = stopMonitor;
        } catch {
          stopMonitor = null;
          stopInterruptMonitorRef.current = null;
        }

        const result = await new Promise<PlaybackResult>((resolve) => {
          let settled = false;
          const clearMonitor = () => {
            if (stopMonitor) {
              stopMonitor();
              stopMonitor = null;
            }
            stopInterruptMonitorRef.current = null;
          };

          const settle = (next: PlaybackResult) => {
            if (settled) return;
            settled = true;
            audio.onended = null;
            audio.onerror = null;
            clearMonitor();
            resolve(next);
          };
          settlePlayback = settle;

          if (interruptedBeforeReady) {
            settle("interrupted");
            return;
          }

          audio.onended = () => settle("ended");
          audio.onerror = () => settle("error");
          audio.play().catch(() => settle("error"));
        });

        return result;
      } catch {
        return "error";
      } finally {
        if (stopMonitor) {
          stopMonitor();
        }
        stopInterruptMonitorRef.current = null;
        speakingAudioRef.current = null;
        if (audioUrl) {
          revokeAudioUrl(audioUrl);
        }
      }
    },
    [createAudio, createInterruptMonitor, interruptLevelThreshold, synthesize],
  );

  const stopDialogue = useCallback(
    async (reason: DialogueStopReason = "manual") => {
      if (!isActiveRef.current || stoppingRef.current) {
        return;
      }

      stoppingRef.current = true;
      setPhase("stopping");
      setIsActive(false);
      isActiveRef.current = false;
      listeningStartedAtRef.current = null;
      hasVoiceActivityRef.current = false;
      setShouldRestartListening(false);

      cleanupSpeaking();
      await stt.cancel();

      const sessionId = sessionIdRef.current;
      if (sessionId) {
        finishDialogueSession(sessionId, reason);
      }

      if (reason !== "error") {
        setError(null);
      }

      sessionIdRef.current = null;
      threadIdRef.current = null;
      setActiveSessionId(null);
      setSessionTitle(null);
      setPhase("idle");
      stoppingRef.current = false;
    },
    [cleanupSpeaking, finishDialogueSession, stt],
  );

  useEffect(() => {
    stopDialogueRef.current = stopDialogue;
  }, [stopDialogue]);

  const handleTranscript = useCallback(
    async (recognizedText: string) => {
      if (!isActiveRef.current || stoppingRef.current) {
        return;
      }

      const transcript = recognizedText.trim();
      if (!transcript) {
        return;
      }

      const sessionId = sessionIdRef.current;
      const threadId = threadIdRef.current;
      if (sessionId) {
        addTurn(sessionId, "user", transcript);
      }

      if (containsStopKeyword(transcript)) {
        await stopDialogueRef.current("keyword_exit");
        return;
      }

      if (!threadId) {
        const message = "対話スレッドの初期化に失敗しました。";
        setError(message);
        onError?.(message);
        await stopDialogueRef.current("error");
        return;
      }

      setPhase("thinking");
      const reply = await sendMessageAndGetReply(transcript, { threadId });

      if (!reply) {
        const message = "AI応答の生成に失敗しました。";
        setError(message);
        onError?.(message);
        await stopDialogueRef.current("error");
        return;
      }

      if (sessionId) {
        addTurn(sessionId, "assistant", reply);
      }

      const speechText = formatDialogueSpeechText(reply);
      setPhase("speaking");
      const playbackResult = await playAssistantVoice(speechText);

      if (!isActiveRef.current || stoppingRef.current) {
        return;
      }

      if (playbackResult === "interrupted") {
        if (sessionId) {
          addTurn(sessionId, "assistant", DEFAULT_INTERRUPT_PROMPT);
        }
        setPhase("confirming_interrupt");
        const confirmPlayback = await playAssistantVoice(DEFAULT_INTERRUPT_PROMPT);
        if (confirmPlayback === "error") {
          const message = "確認音声の再生に失敗しました。テキスト確認を継続します。";
          setError(message);
          onError?.(message);
        }
        setShouldRestartListening(true);
        return;
      }

      if (playbackResult === "error") {
        const message = "音声再生に失敗しました。";
        setError(message);
        onError?.(message);
        await stopDialogueRef.current("error");
        return;
      }

      setShouldRestartListening(true);
    },
    [addTurn, onError, playAssistantVoice, sendMessageAndGetReply, startListening],
  );

  useEffect(() => {
    handleTranscriptRef.current = handleTranscript;
  }, [handleTranscript]);

  useEffect(() => {
    if (!shouldRestartListening || !isActive || stoppingRef.current) {
      return;
    }
    if (stt.isTranscribing) {
      return;
    }

    setShouldRestartListening(false);
    void startListening();
  }, [isActive, shouldRestartListening, startListening, stt.isTranscribing]);

  const startDialogue = useCallback(async () => {
    if (isActiveRef.current || stoppingRef.current) {
      return;
    }

    if (!stt.isSupported) {
      const message = "このブラウザでは対話モードを開始できません。";
      setError(message);
      onError?.(message);
      return;
    }

    const session = startDialogueSession();
    const threadId = createThread(session.title);
    selectThread(threadId);
    setSessionThreadId(session.id, threadId);

    sessionIdRef.current = session.id;
    threadIdRef.current = threadId;
    setActiveSessionId(session.id);
    setSessionTitle(session.title);
    setError(null);
    setShouldRestartListening(false);
    setIsActive(true);
    isActiveRef.current = true;

    await startListening();
  }, [
    createThread,
    onError,
    selectThread,
    setSessionThreadId,
    startDialogueSession,
    startListening,
    stt.isSupported,
  ]);

  const toggleDialogue = useCallback(async () => {
    if (isActiveRef.current) {
      await stopDialogue("manual");
      return;
    }
    await startDialogue();
  }, [startDialogue, stopDialogue]);

  useEffect(() => {
    if (!isActive || phase !== "listening" || !stt.isRecording) {
      return;
    }

    const now = Date.now();
    if (stt.audioLevel >= listeningLevelThreshold) {
      hasVoiceActivityRef.current = true;
      return;
    }

    if (hasVoiceActivityRef.current) {
      return;
    }

    if (listeningStartedAtRef.current === null) {
      listeningStartedAtRef.current = now;
      return;
    }

    if (now - listeningStartedAtRef.current >= silenceExitMs) {
      void stopDialogue("silent_timeout");
    }
  }, [
    isActive,
    listeningLevelThreshold,
    phase,
    silenceExitMs,
    stopDialogue,
    stt.audioLevel,
    stt.isRecording,
  ]);

  useEffect(() => {
    return () => {
      cleanupSpeaking();
    };
  }, [cleanupSpeaking]);

  const statusLabel = useMemo(() => getPhaseLabel(phase), [phase]);
  const turns = useMemo(() => {
    if (!activeSessionId) return [];
    return sessions.find((session) => session.id === activeSessionId)?.turns ?? [];
  }, [activeSessionId, sessions]);

  return {
    isActive,
    phase,
    statusLabel,
    sessionTitle,
    error,
    turns,
    stt: {
      isSupported: stt.isSupported,
      isRecording: stt.isRecording,
      isTranscribing: stt.isTranscribing,
      recordingTimeLabel: stt.recordingTimeLabel,
      audioLevel: stt.audioLevel,
    },
    startDialogue,
    stopDialogue,
    toggleDialogue,
  };
}

export const __internal__ = {
  DIALOGUE_STOP_KEYWORDS,
  DIALOGUE_STT_SILENCE_TIMEOUT_MS,
  DEFAULT_LISTENING_LEVEL_THRESHOLD,
  DEFAULT_INTERRUPT_LEVEL_THRESHOLD,
  DEFAULT_INTERRUPT_GRACE_MS,
  DEFAULT_INTERRUPT_HOLD_MS,
  DEFAULT_INTERRUPT_PROMPT,
  containsStopKeyword,
  getPhaseLabel,
  startDefaultInterruptMonitor,
};
