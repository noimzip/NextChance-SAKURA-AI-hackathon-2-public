import { useCallback, useEffect, useRef, useState } from "react";
import { SakuraAIError, sakuraFetch } from "@/services/sakuraAI";
import { useAudioRecorder } from "./useAudioRecorder";

const DEFAULT_MODEL = "whisper-large-v3-turbo";
const DEFAULT_LANGUAGE = "ja";
const DEFAULT_MAX_RECORDING_MS = 60_000;
const DEFAULT_SILENCE_TIMEOUT_MS = 3_500;
const DEFAULT_SILENCE_LEVEL_THRESHOLD = 0.3;
const MIN_AUDIO_SIZE_BYTES = 1024;
const WAV_MIME_TYPE = "audio/wav";

interface AudioBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeAudioBufferAsWav(audioBuffer: AudioBufferLike): ArrayBuffer {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const frameCount = audioBuffer.length;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = frameCount * blockAlign;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[frame]));
      const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, Math.round(pcm), true);
      offset += bytesPerSample;
    }
  }

  return wavBuffer;
}

async function normalizeAudioBlobForStt(audioBlob: Blob): Promise<Blob> {
  if (audioBlob.type.includes("wav")) {
    return audioBlob;
  }

  const AudioContextCtor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;

  if (!AudioContextCtor) {
    return audioBlob;
  }

  const audioContext = new AudioContextCtor();

  try {
    const sourceBuffer = await audioBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(sourceBuffer.slice(0));
    const wavBuffer = encodeAudioBufferAsWav(decoded);
    return new Blob([wavBuffer], { type: WAV_MIME_TYPE });
  } catch {
    return audioBlob;
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}

interface TranscriptionResponse {
  model: string;
  text: string;
}

export interface TranscribeOptions {
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export interface UseSakuraSTTOptions {
  model?: string;
  language?: string;
  prompt?: string;
  maxRecordingMs?: number;
  silenceTimeoutMs?: number;
  silenceLevelThreshold?: number;
  onTranscript?: (text: string) => Promise<void> | void;
  onError?: (message: string) => void;
}

export interface UseSakuraSTTReturn {
  isSupported: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  recordingTimeMs: number;
  recordingTimeLabel: string;
  audioLevel: number;
  transcript: string;
  error: string | null;
  analyserNode: AnalyserNode | null;
  start: () => Promise<void>;
  stop: () => Promise<string | null>;
  cancel: () => Promise<void>;
  transcribeAudio: (audioBlob: Blob, options?: TranscribeOptions) => Promise<string>;
  reset: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof SakuraAIError) {
    if (error.status === 401) {
      return "STT API認証に失敗しました。APIキーを確認してください。";
    }
    if (error.status === 429) {
      return "STT APIの利用上限に達しました。しばらくしてから再試行してください。";
    }
    if (error.status && error.status >= 500) {
      return "STTサーバーでエラーが発生しました。時間をおいて再試行してください。";
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "音声認識に失敗しました。";
}

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function useSakuraSTT(options: UseSakuraSTTOptions = {}): UseSakuraSTTReturn {
  const {
    model = DEFAULT_MODEL,
    language = DEFAULT_LANGUAGE,
    prompt,
    maxRecordingMs = DEFAULT_MAX_RECORDING_MS,
    silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
    silenceLevelThreshold = DEFAULT_SILENCE_LEVEL_THRESHOLD,
    onTranscript,
    onError,
  } = options;

  const recorder = useAudioRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [peakAudioLevel, setPeakAudioLevel] = useState(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const hasVoiceActivityRef = useRef(false);
  const silenceStartedAtRef = useRef<number | null>(null);
  const autoStopReasonRef = useRef<"silence" | "timeout" | null>(null);
  const stopInFlightRef = useRef(false);

  useEffect(() => {
    hasVoiceActivityRef.current = false;
    silenceStartedAtRef.current = null;
    autoStopReasonRef.current = null;
    stopInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (!recorder.isRecording) {
      recordingStartedAtRef.current = null;
      hasVoiceActivityRef.current = false;
      silenceStartedAtRef.current = null;
      autoStopReasonRef.current = null;
      stopInFlightRef.current = false;
      setPeakAudioLevel(0);
    }
  }, [recorder.isRecording]);

  useEffect(() => {
    if (!recorder.error) return;
    setError(recorder.error);
    onError?.(recorder.error);
  }, [onError, recorder.error]);

  const transcribeAudio = useCallback(
    async (audioBlob: Blob, transcribeOptions: TranscribeOptions = {}): Promise<string> => {
      const normalizedAudioBlob = await normalizeAudioBlobForStt(audioBlob);
      const formData = new FormData();
      const selectedModel = transcribeOptions.model ?? model;
      const selectedLanguage = transcribeOptions.language ?? language;
      const selectedPrompt = transcribeOptions.prompt ?? prompt;

      formData.append(
        "file",
        normalizedAudioBlob,
        normalizedAudioBlob.type.includes("wav") ? "recording.wav" : "recording.webm",
      );
      formData.append("model", selectedModel);
      formData.append("language", selectedLanguage);
      if (selectedPrompt) {
        formData.append("prompt", selectedPrompt);
      }
      formData.append("temperature", "0");
      formData.append("stream", "false");

      const response = await sakuraFetch<TranscriptionResponse>("/audio/transcriptions", {
        body: formData,
        signal: transcribeOptions.signal,
      });
      const normalized = normalizeTranscript(response.text);
      if (!normalized) {
        throw new Error("音声が認識できませんでした。もう一度お試しください。");
      }
      return normalized;
    },
    [language, model, prompt],
  );

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
    recorder.resetError();
  }, [recorder]);

  const finalizeStop = useCallback(
    async (audioBlob: Blob | null): Promise<string | null> => {
      stopInFlightRef.current = false;
      const recordingError = recorder.error;
      if (recordingError) {
        setError(recordingError);
        onError?.(recordingError);
        return null;
      }

      if (!audioBlob || audioBlob.size < MIN_AUDIO_SIZE_BYTES) {
        const reasonMessage =
          autoStopReasonRef.current === "silence"
            ? "無音状態が続いたため録音を停止しました。もう少しはっきり話してみてください。"
            : "音声が検出できませんでした。もう一度お試しください。";
        setError(reasonMessage);
        onError?.(reasonMessage);
        return null;
      }

      const hasVoiceActivity =
        hasVoiceActivityRef.current || recorder.audioLevel >= silenceLevelThreshold;
      if (!hasVoiceActivity) {
        const reasonMessage = "音声が検出できませんでした。もう一度お試しください。";
        setError(reasonMessage);
        onError?.(reasonMessage);
        return null;
      }

      setIsTranscribing(true);
      try {
        const recognizedText = await transcribeAudio(audioBlob);
        setTranscript(recognizedText);
        await onTranscript?.(recognizedText);
        setError(null);
        return recognizedText;
      } catch (transcribeError) {
        const message = getErrorMessage(transcribeError);
        setError(message);
        onError?.(message);
        return null;
      } finally {
        setIsTranscribing(false);
      }
    },
    [
      onError,
      onTranscript,
      recorder.audioLevel,
      recorder.error,
      silenceLevelThreshold,
      transcribeAudio,
    ],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    const blob = await recorder.stopRecording();
    return finalizeStop(blob);
  }, [finalizeStop, recorder]);

  const cancel = useCallback(async (): Promise<void> => {
    await recorder.stopRecording();
    setError(null);
    setTranscript("");
    setPeakAudioLevel(0);
    setIsTranscribing(false);
    recordingStartedAtRef.current = null;
    hasVoiceActivityRef.current = false;
    silenceStartedAtRef.current = null;
    autoStopReasonRef.current = null;
    stopInFlightRef.current = false;
  }, [recorder]);

  const start = useCallback(async () => {
    if (isTranscribing || recorder.isRecording) return;

    setError(null);
    setTranscript("");
    setPeakAudioLevel(0);
    recordingStartedAtRef.current = Date.now();
    hasVoiceActivityRef.current = false;
    silenceStartedAtRef.current = null;
    autoStopReasonRef.current = null;
    stopInFlightRef.current = false;
    recorder.resetError();
    await recorder.startRecording();
  }, [isTranscribing, recorder]);

  useEffect(() => {
    if (!recorder.isRecording || isTranscribing || stopInFlightRef.current) {
      return;
    }

    const currentLevel = recorder.audioLevel;
    if (currentLevel > peakAudioLevel) {
      setPeakAudioLevel(currentLevel);
    }

    if (currentLevel >= silenceLevelThreshold) {
      if (!hasVoiceActivityRef.current) {
        hasVoiceActivityRef.current = true;
      }
      if (silenceStartedAtRef.current !== null) {
        silenceStartedAtRef.current = null;
      }
      return;
    }

    if (hasVoiceActivityRef.current) {
      if (silenceStartedAtRef.current === null) {
        silenceStartedAtRef.current = Date.now();
      } else if (Date.now() - silenceStartedAtRef.current >= silenceTimeoutMs) {
        autoStopReasonRef.current = "silence";
        stopInFlightRef.current = true;
        void stop();
      }
    }

    if (
      recordingStartedAtRef.current !== null &&
      Date.now() - recordingStartedAtRef.current >= maxRecordingMs
    ) {
      if (hasVoiceActivityRef.current || peakAudioLevel >= silenceLevelThreshold) {
        autoStopReasonRef.current = "timeout";
        stopInFlightRef.current = true;
        void stop();
      } else {
        autoStopReasonRef.current = "silence";
        stopInFlightRef.current = true;
        void stop();
      }
    }
  }, [
    isTranscribing,
    maxRecordingMs,
    peakAudioLevel,
    recorder.audioLevel,
    recorder.isRecording,
    silenceLevelThreshold,
    silenceTimeoutMs,
    stop,
  ]);

  const effectiveError = error ?? recorder.error;

  return {
    isSupported: recorder.isSupported,
    isRecording: recorder.isRecording,
    isTranscribing,
    recordingTimeMs: recorder.recordingTimeMs,
    recordingTimeLabel: recorder.recordingTimeLabel,
    audioLevel: recorder.audioLevel,
    transcript,
    error: effectiveError,
    analyserNode: recorder.analyserNode,
    start,
    stop,
    cancel,
    transcribeAudio,
    reset,
  };
}

export const __internal__ = {
  DEFAULT_MODEL,
  DEFAULT_LANGUAGE,
  DEFAULT_MAX_RECORDING_MS,
  DEFAULT_SILENCE_TIMEOUT_MS,
  DEFAULT_SILENCE_LEVEL_THRESHOLD,
  MIN_AUDIO_SIZE_BYTES,
  normalizeAudioBlobForStt,
  encodeAudioBufferAsWav,
  normalizeTranscript,
  getErrorMessage,
};
