import { describe, test, expect, vi, beforeEach } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useDialogueLoop } from "@/hooks/useDialogueLoop";
import type { UseSakuraSTTReturn } from "@/hooks/useSakuraSTT";
import { formatDialogueSpeechText } from "@/lib/dialogueSpeech";

type OnTranscript = (text: string) => Promise<void> | void;

function createSttFactory(
  options: {
    isSupported?: boolean;
    audioLevel?: number;
  } = {},
): {
  sttFactory: NonNullable<Parameters<typeof useDialogueLoop>[0]["sttFactory"]>;
  triggerTranscript: (text: string) => Promise<void>;
  setAudioLevel: (level: number) => void;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  let onTranscript: OnTranscript | undefined;
  let audioLevel = options.audioLevel ?? 0.3;

  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => "");
  const cancel = vi.fn(async () => undefined);
  const reset = vi.fn(() => undefined);

  const sttFactory = vi.fn(
    (
      factoryOptions?: Parameters<
        NonNullable<Parameters<typeof useDialogueLoop>[0]["sttFactory"]>
      >[0],
    ) =>
      ({
        isSupported: options.isSupported ?? true,
        isRecording: true,
        isTranscribing: false,
        recordingTimeMs: 0,
        recordingTimeLabel: "00:00",
        audioLevel,
        transcript: "",
        error: null,
        analyserNode: null,
        start,
        stop,
        cancel,
        reset,
        transcribeAudio: vi.fn(async () => ""),
        ...(() => {
          onTranscript = factoryOptions?.onTranscript;
          return {};
        })(),
      }) as UseSakuraSTTReturn,
  );

  return {
    sttFactory,
    triggerTranscript: async (text: string) => {
      await onTranscript?.(text);
    },
    setAudioLevel: (next) => {
      audioLevel = next;
    },
    start,
    stop,
    cancel,
  };
}

describe("useDialogueLoop", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test("starts dialogue by creating named session and thread", async () => {
    const createThread = vi.fn((title?: string) => `thread:${title ?? "none"}`);
    const selectThread = vi.fn();
    const sendMessageAndGetReply = vi.fn(async () => "了解です");
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory();

    const { result } = renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
        createAudio: () =>
          ({
            onended: null,
            onerror: null,
            currentTime: 0,
            pause: vi.fn(),
            play: vi.fn(async () => undefined),
          }) as never,
        synthesize: vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/wav" })),
      }),
    );

    // patch store actions via direct state replacement
    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    await act(async () => {
      await result.current.startDialogue();
    });

    expect(createThread).toHaveBeenCalledWith("新しい対話#1");
    expect(selectThread).toHaveBeenCalledWith("thread:新しい対話#1");
    expect(setSessionThreadId).toHaveBeenCalledWith("session-1", "thread:新しい対話#1");
    expect(result.current.isActive).toBe(true);
    expect(result.current.phase).toBe("listening");
  });

  test("stops on keyword transcript", async () => {
    const createThread = vi.fn(() => "thread-1");
    const selectThread = vi.fn();
    const sendMessageAndGetReply = vi.fn(async () => "了解です");
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory();

    const { result } = renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
      }),
    );

    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    await act(async () => {
      await result.current.startDialogue();
    });

    await act(async () => {
      await stt.triggerTranscript("今日はここで終了");
    });

    await waitFor(() => {
      expect(result.current.isActive).toBe(false);
      expect(result.current.phase).toBe("idle");
    });
    expect(finishDialogueSession).toHaveBeenCalledWith("session-1", "keyword_exit");
    expect(sendMessageAndGetReply).not.toHaveBeenCalled();
  });

  test("speaking interruption enters confirm state and resumes listening", async () => {
    const createThread = vi.fn(() => "thread-1");
    const selectThread = vi.fn();
    const sendMessageAndGetReply = vi.fn(async () => "返答テキスト");
    const createInterruptMonitor = vi.fn(async (onInterrupt: () => void, _threshold: number) => {
      onInterrupt();
      return () => undefined;
    });
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory();
    const play = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
        createInterruptMonitor,
        createAudio: () =>
          ({
            onended: null,
            onerror: null,
            currentTime: 0,
            pause: vi.fn(),
            play,
          }) as never,
        synthesize: vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/wav" })),
      }),
    );

    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    await act(async () => {
      await result.current.startDialogue();
    });

    await act(async () => {
      await stt.triggerTranscript("こんにちは");
    });

    await waitFor(() => {
      expect(result.current.phase).toBe("listening");
    });
    expect(addTurn).toHaveBeenCalledWith("session-1", "assistant", "何か追加で言いたいのだ？");
  });

  test("formats schedule table reply before speech synthesis", async () => {
    const createThread = vi.fn(() => "thread-1");
    const selectThread = vi.fn();
    const reply = `今日の予定なのだ。

| タイトル | 期限 | 状態 |
| --- | --- | --- |
| 数学の課題 | 2026-03-24 17:00 | 未完了 |`;
    const sendMessageAndGetReply = vi.fn(async () => reply);
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory();
    const synthesize = vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/wav" }));

    const { result } = renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
        createAudio: () => {
          const audio = {
            onended: null as (() => void) | null,
            onerror: null as (() => void) | null,
            currentTime: 0,
            pause: vi.fn(),
            play: vi.fn(async () => {
              void Promise.resolve().then(() => {
                audio.onended?.();
              });
            }),
          };
          return audio as never;
        },
        synthesize,
      }),
    );

    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    await act(async () => {
      await result.current.startDialogue();
    });

    await act(async () => {
      await stt.triggerTranscript("予定を教えて");
    });

    const expectedSpeech = formatDialogueSpeechText(reply);
    expect(synthesize).toHaveBeenCalledWith(expectedSpeech, { model: "zundamon" });
  });

  test("silent timeout stops dialogue", async () => {
    vi.useFakeTimers();
    try {
      const createThread = vi.fn(() => "thread-1");
      const selectThread = vi.fn();
      const sendMessageAndGetReply = vi.fn(async () => "返答");
      const startDialogueSession = vi.fn(() => ({
        id: "session-1",
        title: "新しい対話#1",
        startedAt: new Date().toISOString(),
        turns: [],
      }));
      const setSessionThreadId = vi.fn();
      const addTurn = vi.fn();
      const finishDialogueSession = vi.fn();
      const stt = createSttFactory({ audioLevel: 0 });

      const { result, rerender } = renderHook(() =>
        useDialogueLoop({
          createThread,
          selectThread,
          sendMessageAndGetReply,
          sttFactory: stt.sttFactory,
          silenceExitMs: 1_000,
          listeningLevelThreshold: 0.3,
        }),
      );

      const { useChatStore } = await import("@/store/useChatStore");
      act(() => {
        useChatStore.setState({
          sessions: [],
          activeSessionId: null,
          startDialogueSession,
          setSessionThreadId,
          addTurn,
          finishDialogueSession,
        });
      });

      await act(async () => {
        await result.current.startDialogue();
      });

      await act(async () => {
        vi.advanceTimersByTime(1_200);
        stt.setAudioLevel(0.01);
        rerender();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(result.current.isActive).toBe(false);
      expect(finishDialogueSession).toHaveBeenCalledWith("session-1", "silent_timeout");
    } finally {
      vi.useRealTimers();
    }
  });

  test("passes 30% threshold and 3.5s timeout to STT factory by default", async () => {
    const createThread = vi.fn(() => "thread-1");
    const selectThread = vi.fn();
    const sendMessageAndGetReply = vi.fn(async () => "返答");
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory({ audioLevel: 0.1 });

    renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
      }),
    );

    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    expect(stt.sttFactory).toHaveBeenCalled();
    const sttCalls = vi.mocked(stt.sttFactory).mock.calls;
    expect(sttCalls.length).toBeGreaterThan(0);
    const factoryOptions = sttCalls.at(0)?.[0];
    expect(factoryOptions?.silenceLevelThreshold).toBe(0.3);
    expect(factoryOptions?.silenceTimeoutMs).toBe(3_500);
  });

  test("interrupt check uses 30% threshold", async () => {
    const createThread = vi.fn(() => "thread-1");
    const selectThread = vi.fn();
    const sendMessageAndGetReply = vi.fn(async () => "返答テキスト");
    const createInterruptMonitor = vi.fn(async (onInterrupt: () => void, _threshold: number) => {
      onInterrupt();
      return () => undefined;
    });
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory();
    const play = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
        createInterruptMonitor,
        createAudio: () =>
          ({
            onended: null,
            onerror: null,
            currentTime: 0,
            pause: vi.fn(),
            play,
          }) as never,
        synthesize: vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/wav" })),
      }),
    );

    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    await act(async () => {
      await result.current.startDialogue();
    });

    await act(async () => {
      await stt.triggerTranscript("こんにちは");
    });

    expect(createInterruptMonitor).toHaveBeenCalled();
    const interruptCalls = vi.mocked(createInterruptMonitor).mock.calls;
    expect(interruptCalls.length).toBeGreaterThan(0);
    const threshold = interruptCalls.at(0)?.[1];
    expect(threshold).toBe(0.3);
  });

  test("always enters interrupt confirmation when monitor triggers immediately", async () => {
    const createThread = vi.fn(() => "thread-1");
    const selectThread = vi.fn();
    const sendMessageAndGetReply = vi.fn(async () => "返答テキスト");
    const createInterruptMonitor = vi.fn(async (onInterrupt: () => void, _threshold: number) => {
      onInterrupt();
      return () => undefined;
    });
    const startDialogueSession = vi.fn(() => ({
      id: "session-1",
      title: "新しい対話#1",
      startedAt: new Date().toISOString(),
      turns: [],
    }));
    const setSessionThreadId = vi.fn();
    const addTurn = vi.fn();
    const finishDialogueSession = vi.fn();
    const stt = createSttFactory();

    const { result } = renderHook(() =>
      useDialogueLoop({
        createThread,
        selectThread,
        sendMessageAndGetReply,
        sttFactory: stt.sttFactory,
        createInterruptMonitor,
        createAudio: () =>
          ({
            onended: null,
            onerror: null,
            currentTime: 0,
            pause: vi.fn(),
            play: vi.fn(async () => undefined),
          }) as never,
        synthesize: vi.fn(async () => new Blob([new Uint8Array([1])], { type: "audio/wav" })),
      }),
    );

    const { useChatStore } = await import("@/store/useChatStore");
    act(() => {
      useChatStore.setState({
        sessions: [],
        activeSessionId: null,
        startDialogueSession,
        setSessionThreadId,
        addTurn,
        finishDialogueSession,
      });
    });

    await act(async () => {
      await result.current.startDialogue();
    });

    await act(async () => {
      await stt.triggerTranscript("次のターン");
    });

    await waitFor(() => {
      expect(addTurn).toHaveBeenCalledWith("session-1", "assistant", "何か追加で言いたいのだ？");
      expect(result.current.phase).toBe("listening");
    });
  });
});
