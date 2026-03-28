import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const RECORDING_TIMER_INTERVAL_MS = 200;
const AUDIO_LEVEL_SCALE = 3;
const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/wav",
] as const;

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) {
    return "audio/webm";
  }

  const supported = MIME_TYPE_CANDIDATES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );

  return supported ?? "audio/webm";
}

function formatRecordingTime(recordingTimeMs: number): string {
  const totalSeconds = Math.floor(recordingTimeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRecorderErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "マイクへのアクセスが拒否されました。ブラウザ設定をご確認ください。";
    }
    if (error.name === "NotFoundError") {
      return "利用可能なマイクが見つかりませんでした。";
    }
    return `録音を開始できませんでした: ${error.message}`;
  }

  if (error instanceof Error) {
    return `録音を開始できませんでした: ${error.message}`;
  }

  return "録音を開始できませんでした。";
}

export interface UseAudioRecorderReturn {
  isSupported: boolean;
  isRecording: boolean;
  recordingTimeMs: number;
  recordingTimeLabel: string;
  audioLevel: number;
  analyserNode: AnalyserNode | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob | null>;
  resetError: () => void;
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTimeMs, setRecordingTimeMs] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number>(0);
  const recordingTimerRef = useRef<number | null>(null);
  const levelAnimationRef = useRef<number | null>(null);
  const stopResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const isSupported = useMemo(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return false;
    }

    if (!("MediaRecorder" in window)) {
      return false;
    }

    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }, []);

  const stopTimers = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (levelAnimationRef.current !== null) {
      window.cancelAnimationFrame(levelAnimationRef.current);
      levelAnimationRef.current = null;
    }
  }, []);

  const teardownMedia = useCallback(() => {
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setAnalyserNode(null);
  }, []);

  const resetError = useCallback(() => {
    setError(null);
  }, []);

  const startAudioLevelPolling = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const buffer = new Uint8Array(analyser.fftSize);

    const tick = () => {
      analyser.getByteTimeDomainData(buffer);

      let squareSum = 0;
      for (let index = 0; index < buffer.length; index += 1) {
        const normalized = (buffer[index] - 128) / 128;
        squareSum += normalized * normalized;
      }

      const rms = Math.sqrt(squareSum / buffer.length);
      setAudioLevel(Math.min(1, rms * AUDIO_LEVEL_SCALE));
      levelAnimationRef.current = window.requestAnimationFrame(tick);
    };

    levelAnimationRef.current = window.requestAnimationFrame(tick);
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return null;
    }

    return new Promise<Blob | null>((resolve) => {
      stopResolverRef.current = resolve;
      try {
        recorder.stop();
      } catch (stopError) {
        setError(getRecorderErrorMessage(stopError));
        stopResolverRef.current = null;
        stopTimers();
        teardownMedia();
        setIsRecording(false);
        setAudioLevel(0);
        resolve(null);
      }
    });
  }, [stopTimers, teardownMedia]);

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError("このブラウザは音声録音に対応していません。");
      return;
    }

    if (isRecording) return;

    setError(null);
    setAudioLevel(0);
    setRecordingTimeMs(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const preferredMimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, { mimeType: preferredMimeType });
      mediaRecorderRef.current = recorder;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;
      setAnalyserNode(analyser);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const resultBlob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, {
                type: recorder.mimeType || preferredMimeType,
              })
            : null;
        chunksRef.current = [];

        stopTimers();
        teardownMedia();
        setIsRecording(false);
        setAudioLevel(0);

        const resolver = stopResolverRef.current;
        stopResolverRef.current = null;
        resolver?.(resultBlob);
      };

      recorder.onerror = () => {
        setError("録音中にエラーが発生しました。もう一度お試しください。");
      };

      recorder.start();
      recordingStartedAtRef.current = Date.now();
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingTimeMs(Date.now() - recordingStartedAtRef.current);
      }, RECORDING_TIMER_INTERVAL_MS);

      setIsRecording(true);
      startAudioLevelPolling();
    } catch (startError) {
      setError(getRecorderErrorMessage(startError));
      stopTimers();
      teardownMedia();
      setIsRecording(false);
      setAudioLevel(0);
    }
  }, [isRecording, isSupported, startAudioLevelPolling, stopTimers, teardownMedia]);

  useEffect(() => {
    return () => {
      stopTimers();
      teardownMedia();
    };
  }, [stopTimers, teardownMedia]);

  return {
    isSupported,
    isRecording,
    recordingTimeMs,
    recordingTimeLabel: formatRecordingTime(recordingTimeMs),
    audioLevel,
    analyserNode,
    error,
    startRecording,
    stopRecording,
    resetError,
  };
}
