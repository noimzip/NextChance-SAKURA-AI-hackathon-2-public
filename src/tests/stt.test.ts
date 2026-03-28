import { describe, test, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useSakuraSTT } from "@/hooks/useSakuraSTT";
import { SakuraAIError, sakuraFetch } from "@/services/sakuraAI";

vi.mock("@/services/sakuraAI", () => ({
  sakuraFetch: vi.fn(),
  SakuraAIError: class MockSakuraAIError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
      super(message);
      this.name = "SakuraAIError";
      this.status = status;
    }
  },
}));

const useAudioRecorderMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useAudioRecorder", () => ({
  useAudioRecorder: useAudioRecorderMock,
}));

function createLargeAudioBlob(): Blob {
  return new Blob([new Uint8Array(2048)], { type: "audio/webm" });
}

function createRecorderMock(overrides: Partial<ReturnType<typeof useAudioRecorderMock>> = {}) {
  const startRecording = vi.fn(async () => {});
  const stopRecording = vi.fn(async () => createLargeAudioBlob());

  return {
    isSupported: true,
    isRecording: false,
    recordingTimeMs: 0,
    recordingTimeLabel: "00:00",
    audioLevel: 0.3,
    analyserNode: null,
    error: null as string | null,
    startRecording,
    stopRecording,
    resetError: vi.fn(),
    ...overrides,
  };
}

describe("useSakuraSTT", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAudioRecorderMock.mockReset();
    useAudioRecorderMock.mockReturnValue(createRecorderMock());
  });

  test("transcribes audio and forwards transcript via callback", async () => {
    const onTranscript = vi.fn(async () => {});
    useAudioRecorderMock.mockReturnValue(createRecorderMock());
    vi.mocked(sakuraFetch).mockResolvedValue({
      model: "whisper-large-v3-turbo",
      text: "  明日の 会議 を 追加して  ",
    });

    const { result } = renderHook(() => useSakuraSTT({ onTranscript }));

    const text = await act(async () => result.current.transcribeAudio(createLargeAudioBlob()));

    expect(text).toBe("明日の 会議 を 追加して");
    expect(sakuraFetch).toHaveBeenCalledTimes(1);
    const [, options] = vi.mocked(sakuraFetch).mock.calls[0];
    expect(options?.body).toBeInstanceOf(FormData);
    const formData = options?.body as FormData;
    const fileEntry = formData.get("file");
    expect(fileEntry).toBeInstanceOf(Blob);
    expect((fileEntry as Blob).type).toBe("audio/webm");

    await act(async () => {
      await result.current.start();
    });
    const stopResult = await act(async () => result.current.stop());
    expect(stopResult).toBe("明日の 会議 を 追加して");
    expect(result.current.transcript).toBe("明日の 会議 を 追加して");
    expect(onTranscript).toHaveBeenCalledWith("明日の 会議 を 追加して");
  });

  test("reports API auth error from STT endpoint", async () => {
    const onError = vi.fn();
    useAudioRecorderMock.mockReturnValue(createRecorderMock());
    vi.mocked(sakuraFetch).mockRejectedValue(
      new SakuraAIError("Unauthorized", 401, "UNAUTHORIZED"),
    );

    const { result } = renderHook(() => useSakuraSTT({ onError }));

    await act(async () => {
      await result.current.start();
    });
    const stopResult = await act(async () => result.current.stop());

    expect(stopResult).toBeNull();
    expect(result.current.error).toBe("STT API認証に失敗しました。APIキーを確認してください。");
    expect(onError).toHaveBeenCalledWith("STT API認証に失敗しました。APIキーを確認してください。");
  });

  test("returns null and sets message when recorded audio is too small", async () => {
    useAudioRecorderMock.mockReturnValue(
      createRecorderMock({
        audioLevel: 0,
        stopRecording: vi.fn(async () => new Blob(["x"], { type: "audio/webm" })),
      }),
    );

    const { result } = renderHook(() => useSakuraSTT());

    await act(async () => {
      await result.current.start();
    });
    const value = await act(async () => result.current.stop());

    expect(value).toBeNull();
    expect(result.current.error).toBe("音声が検出できませんでした。もう一度お試しください。");
    expect(sakuraFetch).not.toHaveBeenCalled();
  });

  test("returns null when no voice activity was detected", async () => {
    useAudioRecorderMock.mockReturnValue(
      createRecorderMock({
        audioLevel: 0,
      }),
    );

    const { result } = renderHook(() => useSakuraSTT());

    await act(async () => {
      await result.current.start();
    });
    const value = await act(async () => result.current.stop());

    expect(value).toBeNull();
    expect(result.current.error).toBe("音声が検出できませんでした。もう一度お試しください。");
    expect(sakuraFetch).not.toHaveBeenCalled();
  });

  test("normalizes non-wav audio to wav when AudioContext decode succeeds", async () => {
    const onTranscript = vi.fn(async () => {});
    useAudioRecorderMock.mockReturnValue(createRecorderMock());
    vi.mocked(sakuraFetch).mockResolvedValue({
      model: "whisper-large-v3-turbo",
      text: "テスト",
    });

    const originalAudioContext = globalThis.AudioContext;
    const originalWindowAudioContext = window.AudioContext;
    const close = vi.fn(async () => {});
    const decodeAudioData = vi.fn(async () => {
      const channelData = new Float32Array([0, 0.25, -0.25, 0.5]);
      return {
        numberOfChannels: 1,
        sampleRate: 16000,
        length: channelData.length,
        getChannelData: () => channelData,
      };
    });

    class MockAudioContext {
      decodeAudioData = decodeAudioData;
      close = close;
    }

    // @ts-expect-error test stub
    globalThis.AudioContext = MockAudioContext;

    try {
      // @ts-expect-error test stub
      window.AudioContext = MockAudioContext;
      const { result } = renderHook(() => useSakuraSTT({ onTranscript }));
      await act(async () => {
        await result.current.transcribeAudio(createLargeAudioBlob());
      });

      const [, options] = vi.mocked(sakuraFetch).mock.calls[0];
      const formData = options?.body as FormData;
      const fileEntry = formData.get("file");
      expect(fileEntry).toBeInstanceOf(Blob);
      expect((fileEntry as Blob).type).toBe("audio/wav");
      expect(decodeAudioData).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    } finally {
      globalThis.AudioContext = originalAudioContext;
      window.AudioContext = originalWindowAudioContext;
    }
  });
});
