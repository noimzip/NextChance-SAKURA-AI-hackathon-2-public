import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockedSakuraFetch = vi.hoisted(() => vi.fn());
const mockedRequestChatCompletionWithRetry = vi.hoisted(() => vi.fn());

vi.mock("@/services/sakuraAI", () => ({
  sakuraFetch: mockedSakuraFetch,
}));

vi.mock("@/lib/chatCompletion", () => ({
  requestChatCompletionWithRetry: mockedRequestChatCompletionWithRetry,
}));

import { sendChatMessageWithContext } from "@/services/chatService";
import { DEFAULT_SECRETARY_MULTIMODAL_MODEL } from "@/lib/secretaryModels";
import type { ChatMessage, SecretaryContext } from "@/types";

const baseContext: SecretaryContext = {
  currentDate: "2026/03/25 12:00",
  schedules: [],
  upcomingCount: 0,
  overdueCount: 0,
  completedTodayCount: 0,
  effortSummary: {
    currentStreak: 0,
    todayActivityCount: 0,
    recentActivityCount: 0,
    recentActiveDays: 0,
    topCategories: [],
  },
  priorityHints: {
    hasUrgentItems: false,
    hasScheduleConflicts: false,
    items: [],
  },
};

describe("chatService vision mode", () => {
  beforeEach(() => {
    mockedSakuraFetch.mockReset();
    mockedRequestChatCompletionWithRetry.mockReset();
    mockedRequestChatCompletionWithRetry.mockImplementation(
      async (
        _model: string,
        _maxTokens: number | undefined,
        requestFn: (maxTokens: number) => Promise<unknown>,
      ) => requestFn(512),
    );
    mockedSakuraFetch.mockResolvedValue({
      choices: [{ message: { content: "画像の説明: テストなのだ。" } }],
    });
  });

  it("uses selected multimodal model when image is attached", async () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "この画像を説明して",
        timestamp: new Date("2026-03-25T00:00:00.000Z"),
      },
    ];

    await sendChatMessageWithContext(messages, baseContext, {
      model: "preview/Kimi-K2.5",
      imageAttachmentDataUrl: "data:image/png;base64,AAA",
    });

    const body = mockedSakuraFetch.mock.calls[0]?.[1]?.body;
    expect(body.model).toBe("preview/Kimi-K2.5");
    expect(body.temperature).toBe(0.2);
    expect(body.messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAA" },
    });
  });

  it("falls back to default multimodal model when image is attached with text model", async () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "この画像を説明して",
        timestamp: new Date("2026-03-25T00:00:00.000Z"),
      },
    ];

    await sendChatMessageWithContext(messages, baseContext, {
      model: "gpt-oss-120b",
      imageAttachmentDataUrl: "data:image/png;base64,AAA",
    });

    const body = mockedSakuraFetch.mock.calls[0]?.[1]?.body;
    expect(body.model).toBe(DEFAULT_SECRETARY_MULTIMODAL_MODEL);
    expect(body.temperature).toBe(0.2);
  });

  it("keeps selected model when no image is attached", async () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "今日の予定を教えて",
        timestamp: new Date("2026-03-25T00:00:00.000Z"),
      },
    ];

    await sendChatMessageWithContext(messages, baseContext, {
      model: "gpt-oss-120b",
    });

    const body = mockedSakuraFetch.mock.calls[0]?.[1]?.body;
    expect(body.model).toBe("gpt-oss-120b");
    expect(body.messages[1].content).toBe("今日の予定を教えて");
  });

  it("forwards abort signal when provided", async () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "止められるか確認",
        timestamp: new Date("2026-03-25T00:00:00.000Z"),
      },
    ];
    const controller = new AbortController();

    await sendChatMessageWithContext(messages, baseContext, {
      model: "gpt-oss-120b",
      signal: controller.signal,
    });

    expect(mockedSakuraFetch).toHaveBeenCalledWith(
      "/chat/completions",
      expect.objectContaining({
        signal: controller.signal,
      }),
    );
  });

  it("includes scheduling instructions and hides free-busy details in prompt", async () => {
    const messages: ChatMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "AさんとBさんの空き時間で30分会議を調整して",
        timestamp: new Date("2026-03-25T00:00:00.000Z"),
      },
    ];

    const contextWithScheduling: SecretaryContext = {
      ...baseContext,
      scheduling: {
        searchWindowDays: 14,
        allowOutsideWorkingHours: true,
        participants: [
          { id: "owner-local", displayName: "あなた", visibilityMode: "full_details" },
          { id: "member-a", displayName: "Aさん", visibilityMode: "free_busy_only" },
          { id: "member-b", displayName: "Bさん", visibilityMode: "full_details" },
        ],
        busyWindows: [
          {
            participantId: "member-a",
            start: "2026-03-26T10:00:00.000Z",
            end: "2026-03-26T11:00:00.000Z",
          },
          {
            participantId: "member-b",
            start: "2026-03-26T11:00:00.000Z",
            end: "2026-03-26T12:00:00.000Z",
            title: "定例会議",
          },
        ],
        freeSlotCandidates: [
          {
            start: "2026-03-26T13:00:00.000Z",
            end: "2026-03-26T13:30:00.000Z",
            durationMinutes: 30,
            participantIds: ["owner-local", "member-a", "member-b"],
          },
          {
            start: "2026-03-26T15:00:00.000Z",
            end: "2026-03-26T15:30:00.000Z",
            durationMinutes: 30,
            participantIds: ["owner-local", "member-a", "member-b"],
          },
          {
            start: "2026-03-26T16:00:00.000Z",
            end: "2026-03-26T16:30:00.000Z",
            durationMinutes: 30,
            participantIds: ["owner-local", "member-a", "member-b"],
          },
        ],
      },
    };

    await sendChatMessageWithContext(messages, contextWithScheduling, {
      model: "gpt-oss-120b",
    });

    const body = mockedSakuraFetch.mock.calls[0]?.[1]?.body;
    const systemPrompt = body.messages[0].content as string;

    expect(systemPrompt).toContain("共有カレンダーの日程調整");
    expect(systemPrompt).toContain("共通の30分空き時間を3候補");
    expect(systemPrompt).toContain("Aさん (visibility: free_busy_only)");
    expect(systemPrompt).toContain("予定あり (詳細非公開)");
    expect(systemPrompt).toContain("プライバシー規則");
    expect(systemPrompt).toMatch(/共通空き時間候補（30分）:[\s\S]*1\./);
  });

  it("includes weather note only when user mentions weather intent", async () => {
    const contextWithWeather: SecretaryContext = {
      ...baseContext,
      scheduling: {
        searchWindowDays: 14,
        allowOutsideWorkingHours: true,
        participants: [
          { id: "owner-local", displayName: "あなた", visibilityMode: "full_details" },
        ],
        busyWindows: [],
        freeSlotCandidates: [],
        externalContextNotes: [
          {
            type: "weather",
            note: "明日の午後は雨予報なのだ。",
          },
        ],
      },
    };

    await sendChatMessageWithContext(
      [
        {
          id: "user-1",
          role: "user",
          content: "明日の空き時間を提案して",
          timestamp: new Date("2026-03-25T00:00:00.000Z"),
        },
      ],
      contextWithWeather,
      { model: "gpt-oss-120b" },
    );

    let body = mockedSakuraFetch.mock.calls.at(-1)?.[1]?.body;
    let systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).not.toContain("明日の午後は雨予報なのだ。");

    await sendChatMessageWithContext(
      [
        {
          id: "user-2",
          role: "user",
          content: "明日の天気も考慮して空き時間を提案して",
          timestamp: new Date("2026-03-25T00:05:00.000Z"),
        },
      ],
      contextWithWeather,
      { model: "gpt-oss-120b" },
    );

    body = mockedSakuraFetch.mock.calls.at(-1)?.[1]?.body;
    systemPrompt = body.messages[0].content as string;
    expect(systemPrompt).toContain("明日の午後は雨予報なのだ。");
  });
});
