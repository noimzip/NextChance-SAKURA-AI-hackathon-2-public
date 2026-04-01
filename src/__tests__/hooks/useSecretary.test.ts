import { expect, test, describe, vi, beforeEach } from "vite-plus/test";
import { renderHook, act, waitFor } from "@testing-library/react";
import { parseActionsFromResponse, checkScheduleConflicts, isOverdue } from "@/hooks/useSecretary";
import { useSecretary } from "@/hooks/useSecretary";
import { fillMissingActionFields } from "@/lib/secretaryFieldFallback";
import { sendChatMessageWithContext } from "@/services/chatService";
import type { ScheduleItem, Tag } from "@/types";
import type { SecretaryModelId } from "@/lib/secretaryModels";

vi.mock("@/services/chatService", () => ({
  sendChatMessageWithContext: vi.fn(
    async () => "最優先は締切の近いタスクです。次に会議準備を進めてください。",
  ),
}));

vi.mock("@/services/photoAnalysisService", () => ({
  loadLatestPhotoCheckResult: vi.fn(() => null),
}));

const mockedSendChatMessageWithContext = vi.mocked(sendChatMessageWithContext);

describe("useSecretary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseActionsFromResponse", () => {
    test("should parse ADD_SCHEDULE action", () => {
      const response = `明日の会議、追加しますね！📅✨
[ADD_SCHEDULE: {"title": "会議", "mode": "schedule", "dueDate": "2026-03-22T14:00:00"}]`;

      const { cleanContent, actions } = parseActionsFromResponse(response);

      expect(cleanContent).toBe("明日の会議、追加しますね！📅✨");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: "add_schedule",
        payload: {
          title: "会議",
          mode: "schedule",
          dueDate: "2026-03-22T14:00:00",
          endDate: undefined,
          items: undefined,
          location: undefined,
          participants: undefined,
          url: undefined,
          notes: undefined,
        },
      });
    });

    test("should parse ADD_SCHEDULE with all fields", () => {
      const response = `予定を追加しました！
[ADD_SCHEDULE: {"title": "旅行", "mode": "schedule", "dueDate": "2026-03-25T09:00:00", "endDate": "2026-03-27T18:00:00", "notes": "沖縄旅行", "location": "沖縄県"}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("add_schedule");
      if (actions[0].type === "add_schedule") {
        expect(actions[0].payload.title).toBe("旅行");
        expect(actions[0].payload.endDate).toBe("2026-03-27T18:00:00");
        expect(actions[0].payload.location).toBe("沖縄県");
        expect(actions[0].payload.notes).toBe("沖縄旅行");
      }
    });

    test("should parse ADD_SCHEDULE with isAllDay", () => {
      const response = `終日予定を追加します！
[ADD_SCHEDULE: {"title": "展示会", "mode": "schedule", "dueDate": "2026-03-25T00:00:00", "endDate": "2026-03-25T23:59:59", "isAllDay": true}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("add_schedule");
      if (actions[0].type === "add_schedule") {
        expect(actions[0].payload.isAllDay).toBe(true);
      }
    });

    test("should parse COMPLETE_SCHEDULE action", () => {
      const response = `買い物タスク、完了にしました！🎉
[COMPLETE_SCHEDULE: {"title": "買い物"}]`;

      const { cleanContent, actions } = parseActionsFromResponse(response);

      expect(cleanContent).toBe("買い物タスク、完了にしました！🎉");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: "complete_schedule",
        payload: {
          title: "買い物",
          id: undefined,
        },
      });
    });

    test("should parse COMPLETE_SCHEDULE with id", () => {
      const response = `完了しました！
[COMPLETE_SCHEDULE: {"id": "schedule-123", "title": "会議"}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("complete_schedule");
      if (actions[0].type === "complete_schedule") {
        expect(actions[0].payload.id).toBe("schedule-123");
        expect(actions[0].payload.title).toBe("会議");
      }
    });

    test("should parse DELETE_SCHEDULE action", () => {
      const response = `予定を削除しました。
[DELETE_SCHEDULE: {"title": "キャンセルされた会議"}]`;

      const { cleanContent, actions } = parseActionsFromResponse(response);

      expect(cleanContent).toBe("予定を削除しました。");
      expect(actions).toHaveLength(1);
      expect(actions[0]).toEqual({
        type: "delete_schedule",
        payload: {
          title: "キャンセルされた会議",
          id: undefined,
        },
      });
    });

    test("should parse DELETE_SCHEDULE scope", () => {
      const response = `繰り返し予定を以降分だけ削除します。
[DELETE_SCHEDULE: {"title": "ジム", "scope": "future"}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("delete_schedule");
      if (actions[0].type === "delete_schedule") {
        expect(actions[0].payload.scope).toBe("future");
      }
    });

    test("should parse multiple actions", () => {
      const response = `会議を追加して、買い物を完了にしますね！
[ADD_SCHEDULE: {"title": "会議", "mode": "schedule", "dueDate": "2026-03-22T14:00:00"}]
[COMPLETE_SCHEDULE: {"title": "買い物"}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(2);
      expect(actions[0].type).toBe("add_schedule");
      expect(actions[1].type).toBe("complete_schedule");
    });

    test("should return empty actions for response without actions", () => {
      const response = "今日の予定をお伝えしますね！\n- 14時: 会議\n- 17時: 買い物";

      const { cleanContent, actions } = parseActionsFromResponse(response);

      expect(cleanContent).toBe(response);
      expect(actions).toHaveLength(0);
    });

    test("should handle malformed JSON gracefully", () => {
      const response = `追加します！
[ADD_SCHEDULE: {invalid json}]`;

      const { actions } = parseActionsFromResponse(response);

      // Should not crash, just return empty actions
      expect(actions).toHaveLength(0);
    });

    test("should handle task mode", () => {
      const response = `タスクを追加しました！
[ADD_SCHEDULE: {"title": "レポート作成", "mode": "task", "dueDate": "2026-03-25T23:59:00"}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      if (actions[0].type === "add_schedule") {
        expect(actions[0].payload.mode).toBe("task");
      }
    });

    test("should clean whitespace around actions", () => {
      const response = `   完了です！   
[COMPLETE_SCHEDULE: {"title": "タスク"}]   `;

      const { cleanContent } = parseActionsFromResponse(response);

      expect(cleanContent).toBe("完了です！");
    });

    test("should parse UPDATE_SCHEDULE action", () => {
      const response = `会議の時間を変更しますね！📝
[UPDATE_SCHEDULE: {"title": "会議", "updates": {"dueDate": "2026-03-22T15:00:00"}}]`;

      const { cleanContent, actions } = parseActionsFromResponse(response);

      expect(cleanContent).toBe("会議の時間を変更しますね！📝");
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("update_schedule");
      if (actions[0].type === "update_schedule") {
        expect(actions[0].payload.title).toBe("会議");
        expect(actions[0].payload.updates.dueDate).toBe("2026-03-22T15:00:00");
      }
    });

    test("should parse UPDATE_SCHEDULE with multiple updates", () => {
      const response = `予定を更新しました！
[UPDATE_SCHEDULE: {"title": "会議", "updates": {"title": "重要会議", "location": "会議室A", "dueDate": "2026-03-22T16:00:00"}}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      if (actions[0].type === "update_schedule") {
        expect(actions[0].payload.title).toBe("会議");
        expect(actions[0].payload.updates.title).toBe("重要会議");
        expect(actions[0].payload.updates.location).toBe("会議室A");
        expect(actions[0].payload.updates.dueDate).toBe("2026-03-22T16:00:00");
      }
    });

    test("should parse UPDATE_SCHEDULE with isAllDay update", () => {
      const response = `予定を終日に変更します！
[UPDATE_SCHEDULE: {"title": "会議", "updates": {"isAllDay": true}}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("update_schedule");
      if (actions[0].type === "update_schedule") {
        expect(actions[0].payload.updates.isAllDay).toBe(true);
      }
    });

    test("should parse ADD_SCHEDULE recurrence", () => {
      const response = `繰り返し予定を追加します
[ADD_SCHEDULE: {"title": "ジム", "mode": "task", "dueDate": "2026-03-22T07:00:00", "recurrence": {"weekdays": [1, 3, 5], "count": 6}}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("add_schedule");
      if (actions[0].type === "add_schedule") {
        expect(actions[0].payload.recurrence).toEqual({
          weekdays: [1, 3, 5],
          count: 6,
        });
      }
    });

    test("should parse UPDATE_SCHEDULE recurrence including null", () => {
      const response = `繰り返しを変更します
[UPDATE_SCHEDULE: {"title": "ジム", "updates": {"recurrence": {"weekdays": [2, 4], "count": 4}}}]
[UPDATE_SCHEDULE: {"title": "会議", "updates": {"recurrence": null}}]`;

      const { actions } = parseActionsFromResponse(response);
      const recurring = actions.find(
        (action) =>
          action.type === "update_schedule" &&
          action.payload.title === "ジム" &&
          action.payload.updates.recurrence !== undefined,
      );
      const removeRecurrence = actions.find(
        (action) =>
          action.type === "update_schedule" &&
          action.payload.title === "会議" &&
          Object.prototype.hasOwnProperty.call(action.payload.updates, "recurrence"),
      );

      expect(recurring).toBeDefined();
      if (recurring?.type === "update_schedule") {
        expect(recurring.payload.updates.recurrence).toEqual({
          weekdays: [2, 4],
          count: 4,
        });
      }

      expect(removeRecurrence).toBeDefined();
      if (removeRecurrence?.type === "update_schedule") {
        expect(removeRecurrence.payload.updates.recurrence).toBeNull();
      }
    });

    test("should parse recurrence with isInfinite flag", () => {
      const response = `繰り返し予定を永続にします
[ADD_SCHEDULE: {"title": "朝活", "mode": "task", "dueDate": "2026-03-22T07:00:00", "recurrence": {"weekdays": [1, 3, 5], "isInfinite": true}}]`;

      const { actions } = parseActionsFromResponse(response);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe("add_schedule");
      if (actions[0].type === "add_schedule") {
        expect(actions[0].payload.recurrence).toEqual({
          weekdays: [1, 3, 5],
          isInfinite: true,
        });
      }
    });

    test("should parse mixed actions including UPDATE_SCHEDULE", () => {
      const response = `会議を変更して、新しい予定を追加しますね！
[UPDATE_SCHEDULE: {"title": "会議", "updates": {"dueDate": "2026-03-22T15:00:00"}}]
[ADD_SCHEDULE: {"title": "ランチ", "mode": "schedule", "dueDate": "2026-03-22T12:00:00"}]`;

      const { actions } = parseActionsFromResponse(response);

      expect(actions).toHaveLength(2);
      // Actions are parsed in order: ADD first, then UPDATE
      const addAction = actions.find((a) => a.type === "add_schedule");
      const updateAction = actions.find((a) => a.type === "update_schedule");
      expect(addAction).toBeDefined();
      expect(updateAction).toBeDefined();
    });
  });
  describe("fillMissingActionFields", () => {
    test("should fill missing fields for add_schedule from user input", () => {
      const actions = [
        {
          type: "add_schedule" as const,
          payload: {
            title: "打ち合わせ",
            mode: "schedule" as const,
            dueDate: "2026-03-22T15:00:00",
          },
        },
      ];

      const filled = fillMissingActionFields(
        actions,
        "明日15時に打ち合わせ。Zoomで、URLはhttps://zoom.us/j/123。資料を持っていく。備考は10分前集合。",
      );

      expect(filled[0].type).toBe("add_schedule");
      if (filled[0].type === "add_schedule") {
        expect(filled[0].payload.location).toBe("オンライン");
        expect(filled[0].payload.url).toBe("https://zoom.us/j/123");
        expect(filled[0].payload.items).toBe("資料");
        expect(filled[0].payload.notes).toBe("10分前集合");
        expect(filled[0].payload.tags).toContain("会議");
      }
    });

    test("should infer all-day from user input for add_schedule", () => {
      const actions = [
        {
          type: "add_schedule" as const,
          payload: {
            title: "展示会",
            mode: "schedule" as const,
            dueDate: "2026-03-22T00:00:00",
          },
        },
      ];

      const filled = fillMissingActionFields(actions, "明日は終日で展示会です");

      expect(filled[0].type).toBe("add_schedule");
      if (filled[0].type === "add_schedule") {
        expect(filled[0].payload.isAllDay).toBe(true);
      }
    });

    test("should not overwrite existing values", () => {
      const actions = [
        {
          type: "add_schedule" as const,
          payload: {
            title: "打ち合わせ",
            mode: "schedule" as const,
            dueDate: "2026-03-22T15:00:00",
            location: "会議室A",
            items: "ノートPC",
          },
        },
      ];

      const filled = fillMissingActionFields(
        actions,
        "ZoomでURLはhttps://zoom.us/j/123。資料を持っていく。",
      );

      expect(filled[0].type).toBe("add_schedule");
      if (filled[0].type === "add_schedule") {
        expect(filled[0].payload.location).toBe("会議室A");
        expect(filled[0].payload.items).toBe("ノートPC");
        expect(filled[0].payload.url).toBe("https://zoom.us/j/123");
      }
    });

    test("should fill missing fields in update_schedule updates", () => {
      const actions = [
        {
          type: "update_schedule" as const,
          payload: {
            title: "会議",
            updates: {
              dueDate: "2026-03-22T16:00:00",
            },
          },
        },
      ];

      const filled = fillMissingActionFields(
        actions,
        "会議を16時に変更。場所は会議室B、参加者は田中さん、備考は遅刻厳禁。",
      );

      expect(filled[0].type).toBe("update_schedule");
      if (filled[0].type === "update_schedule") {
        expect(filled[0].payload.updates.location).toBe("会議室B");
        expect(filled[0].payload.updates.participants).toBe("田中さん");
        expect(filled[0].payload.updates.notes).toBe("遅刻厳禁");
        expect(filled[0].payload.updates.tags).toContain("会議");
      }
    });

    test("should infer all-day from user input for update_schedule", () => {
      const actions = [
        {
          type: "update_schedule" as const,
          payload: {
            title: "会議",
            updates: {
              dueDate: "2026-03-22T16:00:00",
            },
          },
        },
      ];

      const filled = fillMissingActionFields(actions, "会議を終日に変更して");

      expect(filled[0].type).toBe("update_schedule");
      if (filled[0].type === "update_schedule") {
        expect(filled[0].payload.updates.isAllDay).toBe(true);
      }
    });

    test("should infer recurrence from user input for add_schedule", () => {
      const actions = [
        {
          type: "add_schedule" as const,
          payload: {
            title: "運動",
            mode: "task" as const,
            dueDate: "2026-03-22T07:00:00",
          },
        },
      ];

      const filled = fillMissingActionFields(actions, "毎週月水金で全8回、運動を追加して");
      expect(filled[0].type).toBe("add_schedule");
      if (filled[0].type === "add_schedule") {
        expect(filled[0].payload.recurrence).toEqual({
          weekdays: [1, 3, 5],
          count: 8,
        });
      }
    });

    test("should infer recurrence removal from user input for update_schedule", () => {
      const actions = [
        {
          type: "update_schedule" as const,
          payload: {
            title: "運動",
            updates: {},
          },
        },
      ];

      const filled = fillMissingActionFields(actions, "運動の繰り返しを解除して");
      expect(filled[0].type).toBe("update_schedule");
      if (filled[0].type === "update_schedule") {
        expect(Object.prototype.hasOwnProperty.call(filled[0].payload.updates, "recurrence")).toBe(
          true,
        );
        expect(filled[0].payload.updates.recurrence).toBeNull();
      }
    });
  });

  describe("response style formatting", () => {
    test("sendMessageAndGetReply should normalize assistant style for TTS", async () => {
      localStorage.clear();
      localStorage.setItem(
        "grass-secretary-schedules",
        JSON.stringify([
          {
            id: "schedule-1",
            title: "明日提出レポート",
            mode: "task",
            dueDate: "2026-03-22T23:59:00.000Z",
            completed: false,
            tags: [],
            createdAt: "2026-03-20T09:00:00.000Z",
          },
        ]),
      );

      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply(
          "今日は何を優先すべき？ まず締切が近いものを教えて",
        );
      });

      const assistantMessage = result.current.messages.find(
        (message) => message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.content.length).toBeLessThanOrEqual(180);
      expect(assistantMessage?.content).toMatch(/のだ|なのだ/);
    });

    test("sendMessageAndGetReply should keep raw JSON for generative_ui trigger", async () => {
      localStorage.clear();
      mockedSendChatMessageWithContext.mockImplementationOnce(async () =>
        JSON.stringify({
          layout: "stack",
          theme: { mode: "dark", primaryColor: "Future Dust" },
          components: [{ type: "Calendar", props: { view: "day" }, priority: "high" }],
        }),
      );
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply(
          "/gen-ui ユーザーの趣向: ミニマリズム\n現在の課題/要望: 今日の予定確認",
        );
      });

      const call = mockedSendChatMessageWithContext.mock.calls.at(-1);
      expect(call?.[2]).toMatchObject({
        requestMode: "generative_ui",
        userPreferences: "ミニマリズム",
        currentNeed: "今日の予定確認",
      });

      const assistantMessage = result.current.messages.find(
        (message) => message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.requestMode).toBe("generative_ui");
      expect(assistantMessage?.content.trim().startsWith("{")).toBe(true);
      expect(assistantMessage?.content).toContain('"layout"');
      expect(assistantMessage?.actions).toBeUndefined();
    });

    test("sendMessageAndGetReply should keep raw JSON for tailwind_theme trigger", async () => {
      localStorage.clear();
      mockedSendChatMessageWithContext.mockImplementationOnce(async () =>
        JSON.stringify({
          colors: {
            layeredDarks: {
              base: "#0B1220",
              surface: "#111B2E",
              elevated: "#17233A",
            },
            background: "#0B1220",
            primary: "#3B82F6",
            primaryForeground: "#EAF2FF",
          },
          padding: {
            "3": "0.9rem",
            "4": "1.2rem",
            "6": "1.8rem",
            "8": "2.4rem",
          },
        }),
      );
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply(
          "/gen-theme ユーザーの趣向: 目に優しい\n現在の課題/要望: tailwind extend JSON",
        );
      });

      const call = mockedSendChatMessageWithContext.mock.calls.at(-1);
      expect(call?.[2]).toMatchObject({
        requestMode: "tailwind_theme",
        userPreferences: "目に優しい",
        currentNeed: "tailwind extend JSON",
      });

      const assistantMessage = result.current.messages.find(
        (message) => message.role === "assistant",
      );
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.requestMode).toBe("tailwind_theme");
      expect(assistantMessage?.content.trim().startsWith("{")).toBe(true);
      expect(assistantMessage?.content).toContain('"layeredDarks"');
      expect(assistantMessage?.actions).toBeUndefined();
    });

    test("sendMessageAndGetReply should pass selected model to chat service", async () => {
      localStorage.clear();
      const selectedModel: SecretaryModelId = "Qwen3-Coder-30B-A3B-Instruct";
      const { result } = renderHook(() => useSecretary({ selectedModel }));
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("モデルの適用確認");
      });

      expect(mockedSendChatMessageWithContext).toHaveBeenCalled();
      const call = mockedSendChatMessageWithContext.mock.calls.at(-1);
      expect(call?.[2]).toMatchObject({ model: selectedModel });
      expect(result.current.selectedModel).toBe(selectedModel);
    });

    test("sendMessageAndGetReply should generate summary-style plain title", async () => {
      localStorage.clear();
      mockedSendChatMessageWithContext.mockImplementationOnce(
        async () => "結論として、会議準備が最優先です。次に資料確認を進めてください。",
      );
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("会議準備");
      });

      const activeThread = result.current.threads.find(
        (thread) => thread.id === result.current.activeThreadId,
      );

      expect(activeThread).toBeDefined();
      expect(activeThread?.title).toBe("会議準備が最優先");
      expect(activeThread?.title).not.toContain("結論として");
      expect(activeThread?.title).not.toContain("です");
      expect(activeThread?.title).not.toContain(" / ");
      expect(activeThread?.isTitleManuallyEdited).toBe(false);
    });

    test("sendMessageAndGetReply should strip markdown formatting from auto title", async () => {
      localStorage.clear();
      mockedSendChatMessageWithContext.mockImplementationOnce(
        async () => "## **回答**: [最優先](https://example.com)は`レポート`です。",
      );
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("**相談**: _レポート_をどう進める？");
      });

      const activeThread = result.current.threads.find(
        (thread) => thread.id === result.current.activeThreadId,
      );

      expect(activeThread).toBeDefined();
      expect(activeThread?.title).toContain("相談");
      expect(activeThread?.title).toContain("回答");
      expect(activeThread?.title).toContain("レポート");
      expect(activeThread?.title).not.toMatch(/[#*_[\]`]/);
      expect(activeThread?.title).not.toContain("https://");
      expect(activeThread?.isTitleManuallyEdited).toBe(false);
    });

    test("manual title override should prevent auto title updates", async () => {
      localStorage.clear();
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("最初の相談");
      });

      const threadId = result.current.activeThreadId;
      expect(threadId).toBeDefined();

      act(() => {
        result.current.renameThread(threadId!, "手動タイトル");
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("2回目の相談");
      });

      const activeThread = result.current.threads.find((thread) => thread.id === threadId);
      expect(activeThread?.title).toBe("手動タイトル");
      expect(activeThread?.title).not.toContain("2回目の相談");
      expect(activeThread?.isTitleManuallyEdited).toBe(true);
    });

    test("sendMessageAndGetReply should ignore duplicate concurrent requests", async () => {
      localStorage.clear();
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      mockedSendChatMessageWithContext.mockClear();
      let replies: Array<string | null> = [];

      await act(async () => {
        replies = await Promise.all([
          result.current.sendMessageAndGetReply("重複送信テスト"),
          result.current.sendMessageAndGetReply("重複送信テスト"),
        ]);
      });

      expect(mockedSendChatMessageWithContext).toHaveBeenCalledTimes(1);
      expect(replies.filter((reply) => reply !== null)).toHaveLength(1);
      expect(
        result.current.messages.filter(
          (message) => message.role === "user" && message.content === "重複送信テスト",
        ),
      ).toHaveLength(1);
    });

    test("sendMessageAndGetReply should forward image attachment options", async () => {
      localStorage.clear();
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("画像チェックして", {
          imageAttachmentDataUrl: "data:image/png;base64,AAA",
          imageAttachmentName: "bag.png",
        });
      });

      expect(mockedSendChatMessageWithContext).toHaveBeenCalled();
      const lastCall = mockedSendChatMessageWithContext.mock.calls.at(-1);
      expect(lastCall?.[2]).toMatchObject({
        imageAttachmentDataUrl: "data:image/png;base64,AAA",
      });
      const lastUser = result.current.messages.find((m) => m.role === "user");
      expect(lastUser?.hasImageAttachment).toBe(true);
      expect(lastUser?.imageAttachmentName).toBe("bag.png");
      expect(lastUser?.imageAttachmentDataUrl).toBe("data:image/png;base64,AAA");
    });

    test("retryLastUserMessage should resend latest user message content", async () => {
      localStorage.clear();
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("最初の質問");
      });

      mockedSendChatMessageWithContext.mockClear();

      await act(async () => {
        await result.current.retryLastUserMessage();
      });

      expect(mockedSendChatMessageWithContext).toHaveBeenCalled();
      const latestMessages = mockedSendChatMessageWithContext.mock.calls.at(-1)?.[0];
      const latestUser = [...(latestMessages ?? [])]
        .reverse()
        .find((message) => message.role === "user");
      expect(latestUser?.content).toBe("最初の質問");
    });

    test("retryUserMessage should resend the targeted user message", async () => {
      localStorage.clear();
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("最初の質問");
        await result.current.sendMessageAndGetReply("2番目の質問");
      });

      const firstUserMessage = result.current.messages.find(
        (message) => message.role === "user" && message.content === "最初の質問",
      );
      expect(firstUserMessage).toBeDefined();

      mockedSendChatMessageWithContext.mockClear();

      await act(async () => {
        await result.current.retryUserMessage(firstUserMessage!.id);
      });

      expect(mockedSendChatMessageWithContext).toHaveBeenCalled();
      const latestMessages = mockedSendChatMessageWithContext.mock.calls.at(-1)?.[0];
      const latestUser = [...(latestMessages ?? [])]
        .reverse()
        .find((message) => message.role === "user");
      expect(latestUser?.content).toBe("最初の質問");
    });

    test("deleteMessage should remove only targeted message", async () => {
      localStorage.clear();
      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        await result.current.sendMessageAndGetReply("削除対象テスト");
      });

      const currentMessages = result.current.messages;
      expect(currentMessages.length).toBeGreaterThanOrEqual(2);
      const userMessage = currentMessages.find((message) => message.role === "user");
      expect(userMessage).toBeDefined();

      act(() => {
        result.current.deleteMessage(userMessage!.id);
      });

      expect(result.current.messages.some((message) => message.id === userMessage!.id)).toBe(false);
      expect(result.current.messages.some((message) => message.role === "assistant")).toBe(true);
    });

    test("cancelCurrentResponse should abort inflight request without setting error", async () => {
      localStorage.clear();
      mockedSendChatMessageWithContext.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            window.setTimeout(() => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            }, 30);
          }),
      );

      const { result } = renderHook(() => useSecretary());
      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      await act(async () => {
        const pending = result.current.sendMessageAndGetReply("停止テスト");
        result.current.cancelCurrentResponse();
        await pending;
      });

      expect(result.current.error).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("thread switching", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    test("should initialize with a default thread", async () => {
      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      expect(result.current.activeThreadId).toBe(result.current.threads[0].id);
      expect(result.current.messages).toEqual([]);
    });

    test("should migrate legacy chat messages into first thread", async () => {
      localStorage.setItem(
        "grass-secretary-chat",
        JSON.stringify([
          {
            id: "legacy-user-1",
            role: "user",
            content: "legacy message",
            timestamp: new Date("2026-03-20T10:00:00").toISOString(),
          },
        ]),
      );

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
        expect(result.current.messages.length).toBe(1);
      });

      expect(result.current.messages[0].content).toBe("legacy message");
      expect(localStorage.getItem("grass-secretary-chat")).toBe("[]");
    });

    test("should create and switch threads", async () => {
      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      const firstThreadId = result.current.threads[0].id;

      act(() => {
        result.current.createThread("プロジェクトA");
      });

      await waitFor(() => {
        expect(result.current.threads.length).toBe(2);
      });

      const created = result.current.threads.find((thread) => thread.title === "プロジェクトA");
      expect(created).toBeDefined();
      expect(result.current.activeThreadId).toBe(created?.id);

      act(() => {
        result.current.selectThread(firstThreadId);
      });

      expect(result.current.activeThreadId).toBe(firstThreadId);
    });

    test("should rename thread and sort by latest update", async () => {
      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      act(() => {
        result.current.createThread("チャットB");
      });

      await waitFor(() => {
        expect(result.current.threads.length).toBe(2);
      });

      const oldestThread = result.current.threads[result.current.threads.length - 1];

      act(() => {
        result.current.renameThread(oldestThread.id, "  リネーム済み  ");
      });

      await waitFor(() => {
        expect(result.current.threads[0].title).toBe("リネーム済み");
      });
      expect(result.current.threads[0].isTitleManuallyEdited).toBe(true);
    });

    test("should normalize legacy threads without manual-title flag", async () => {
      localStorage.setItem(
        "grass-secretary-chat-threads",
        JSON.stringify([
          {
            id: "thread-legacy-title",
            title: "古いタイトル",
            messages: [],
            pendingActions: [],
            lastExecutedAction: null,
            createdAt: "2026-03-25T09:59:00.000Z",
            updatedAt: "2026-03-25T10:00:00.000Z",
          },
        ]),
      );
      localStorage.setItem(
        "grass-secretary-active-thread-id",
        JSON.stringify("thread-legacy-title"),
      );

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });
      expect(result.current.threads[0]?.isTitleManuallyEdited).toBe(false);

      await act(async () => {
        await result.current.sendMessageAndGetReply("要約");
      });

      await waitFor(() => {
        expect(result.current.threads[0]?.title).not.toBe("古いタイトル");
      });
    });

    test("should keep at least one thread after delete", async () => {
      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      const onlyThreadId = result.current.threads[0].id;

      act(() => {
        result.current.deleteThread(onlyThreadId);
      });

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      expect(result.current.activeThreadId).toBe(result.current.threads[0].id);
    });

    test("should not duplicate thread when generated id collides", async () => {
      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_712_345_678_000);
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456);

      act(() => {
        result.current.createThread("重複防止テスト");
      });

      await waitFor(() => {
        expect(result.current.threads.length).toBe(2);
      });

      act(() => {
        result.current.createThread("重複防止テスト2");
      });

      expect(result.current.threads).toHaveLength(2);
      expect(
        result.current.threads.filter((thread) => thread.title === "重複防止テスト"),
      ).toHaveLength(1);
      expect(
        result.current.threads.filter((thread) => thread.title === "重複防止テスト2"),
      ).toHaveLength(0);

      nowSpy.mockRestore();
      randomSpy.mockRestore();
    });
  });

  describe("chat storage compaction", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    test("compacts oversized image attachments while preserving chat messages", async () => {
      const oversizedImageDataUrl = `data:image/jpeg;base64,${"A".repeat(220_000)}`;
      localStorage.setItem(
        "grass-secretary-chat-threads",
        JSON.stringify([
          {
            id: "thread-oversized",
            title: "画像テスト",
            messages: [
              {
                id: "user-image-1",
                role: "user",
                content: "この画像を確認して",
                timestamp: "2026-03-25T10:00:00.000Z",
                hasImageAttachment: true,
                imageAttachmentName: "big.jpg",
                imageAttachmentDataUrl: oversizedImageDataUrl,
              },
            ],
            pendingActions: [],
            lastExecutedAction: null,
            createdAt: "2026-03-25T09:59:00.000Z",
            updatedAt: "2026-03-25T10:00:00.000Z",
          },
        ]),
      );
      localStorage.setItem("grass-secretary-active-thread-id", JSON.stringify("thread-oversized"));

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.messages.length).toBe(1);
      });

      expect(result.current.messages[0]?.content).toBe("この画像を確認して");
      expect(result.current.messages[0]?.hasImageAttachment).toBe(true);
      expect(result.current.messages[0]?.imageAttachmentDataUrl).toBeUndefined();

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem("grass-secretary-chat-threads") || "[]");
        expect(stored[0]?.messages?.[0]?.imageAttachmentDataUrl).toBeUndefined();
      });
    });

    test("keeps recent image attachments within storage budget", async () => {
      const baseTimestamp = new Date("2026-03-25T10:00:00.000Z").getTime();
      const messages = Array.from({ length: 8 }, (_, index) => ({
        id: `user-image-${index}`,
        role: "user",
        content: `画像メッセージ ${index}`,
        timestamp: new Date(baseTimestamp + index * 1000).toISOString(),
        hasImageAttachment: true,
        imageAttachmentName: `image-${index}.jpg`,
        imageAttachmentDataUrl: `data:image/jpeg;base64,${"A".repeat(1_000)}${index}`,
      }));

      localStorage.setItem(
        "grass-secretary-chat-threads",
        JSON.stringify([
          {
            id: "thread-compact",
            title: "履歴テスト",
            messages,
            pendingActions: [],
            lastExecutedAction: null,
            createdAt: "2026-03-25T09:59:00.000Z",
            updatedAt: "2026-03-25T10:00:08.000Z",
          },
        ]),
      );
      localStorage.setItem("grass-secretary-active-thread-id", JSON.stringify("thread-compact"));

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.messages.length).toBe(8);
      });

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem("grass-secretary-chat-threads") || "[]");
        const storedMessages = stored[0]?.messages ?? [];
        const imagesLeft = storedMessages.filter(
          (message: { imageAttachmentDataUrl?: string }) =>
            typeof message.imageAttachmentDataUrl === "string" &&
            message.imageAttachmentDataUrl.length > 0,
        );
        expect(imagesLeft).toHaveLength(8);
        expect(storedMessages[0]?.imageAttachmentDataUrl).toMatch(/^data:image\/jpeg;base64,/);
        expect(storedMessages[7]?.imageAttachmentDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      });
    });

    test("drops oldest image attachments when total image budget is exceeded", async () => {
      const baseTimestamp = new Date("2026-03-25T10:00:00.000Z").getTime();
      const imageSegment = "A".repeat(150_000);
      const messages = Array.from({ length: 8 }, (_, index) => ({
        id: `user-big-image-${index}`,
        role: "user",
        content: `大きい画像メッセージ ${index}`,
        timestamp: new Date(baseTimestamp + index * 1000).toISOString(),
        hasImageAttachment: true,
        imageAttachmentName: `big-image-${index}.jpg`,
        imageAttachmentDataUrl: `data:image/jpeg;base64,${imageSegment}${index}`,
      }));

      localStorage.setItem(
        "grass-secretary-chat-threads",
        JSON.stringify([
          {
            id: "thread-budget",
            title: "容量テスト",
            messages,
            pendingActions: [],
            lastExecutedAction: null,
            createdAt: "2026-03-25T09:59:00.000Z",
            updatedAt: "2026-03-25T10:00:08.000Z",
          },
        ]),
      );
      localStorage.setItem("grass-secretary-active-thread-id", JSON.stringify("thread-budget"));

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.messages.length).toBe(8);
      });

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem("grass-secretary-chat-threads") || "[]");
        const storedMessages = stored[0]?.messages ?? [];
        const imagesLeft = storedMessages.filter(
          (message: { imageAttachmentDataUrl?: string }) =>
            typeof message.imageAttachmentDataUrl === "string" &&
            message.imageAttachmentDataUrl.length > 0,
        );

        expect(imagesLeft).toHaveLength(5);
        expect(storedMessages[0]?.imageAttachmentDataUrl).toBeUndefined();
        expect(storedMessages[1]?.imageAttachmentDataUrl).toBeUndefined();
        expect(storedMessages[2]?.imageAttachmentDataUrl).toBeUndefined();
        expect(storedMessages[7]?.imageAttachmentDataUrl).toMatch(/^data:image\/jpeg;base64,/);
      });
    });
  });

  describe("checkConflicts", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    test("should only return conflicts from existing schedules with warning-enabled tags", async () => {
      const now = new Date("2026-03-20T09:00:00.000Z").toISOString();

      localStorage.setItem(
        "grass-secretary-tags",
        JSON.stringify([
          {
            id: "tag-1",
            name: "重要",
            color: "#EF4444",
            priority: "high",
            conflictWarningsEnabled: true,
            createdAt: now,
          },
          {
            id: "tag-meeting",
            name: "会議",
            color: "#3B82F6",
            priority: "medium",
            conflictWarningsEnabled: true,
            createdAt: now,
          },
          {
            id: "tag-private",
            name: "私用",
            color: "#22C55E",
            priority: "medium",
            conflictWarningsEnabled: false,
            createdAt: now,
          },
        ]),
      );

      localStorage.setItem(
        "grass-secretary-schedules",
        JSON.stringify([
          {
            id: "schedule-enabled",
            title: "警告ON予定",
            mode: "schedule",
            dueDate: "2026-03-21T10:00:00.000Z",
            completed: false,
            tags: [
              {
                id: "tag-meeting",
                name: "会議",
                color: "#3B82F6",
                priority: "medium",
                conflictWarningsEnabled: true,
                createdAt: now,
              },
            ],
            createdAt: now,
          },
          {
            id: "schedule-disabled",
            title: "警告OFF予定",
            mode: "schedule",
            dueDate: "2026-03-21T10:00:00.000Z",
            completed: false,
            tags: [
              {
                id: "tag-private",
                name: "私用",
                color: "#22C55E",
                priority: "medium",
                conflictWarningsEnabled: false,
                createdAt: now,
              },
            ],
            createdAt: now,
          },
          {
            id: "schedule-no-tags",
            title: "タグなし予定",
            mode: "schedule",
            dueDate: "2026-03-21T10:00:00.000Z",
            completed: false,
            tags: [],
            createdAt: now,
          },
        ]),
      );

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      const conflicts = result.current.checkConflicts(
        "2026-03-21T10:00:00.000Z",
        undefined,
        "schedule",
      );

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflictingSchedule.title).toBe("警告ON予定");
    });
  });

  describe("scheduling context", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    test("builds shared availability context with privacy-safe busy windows", async () => {
      const now = new Date();
      const baseDate = new Date(now);
      baseDate.setDate(baseDate.getDate() + 1);
      baseDate.setHours(10, 0, 0, 0);

      const ownerStart = new Date(baseDate);
      const ownerEnd = new Date(baseDate);
      ownerEnd.setHours(11, 0, 0, 0);

      const freeBusyStart = new Date(baseDate);
      freeBusyStart.setMinutes(30, 0, 0);
      const freeBusyEnd = new Date(freeBusyStart);
      freeBusyEnd.setHours(11, 30, 0, 0);

      const privateStart = new Date(baseDate);
      privateStart.setHours(12, 0, 0, 0);
      const privateEnd = new Date(privateStart);
      privateEnd.setMinutes(45, 0, 0);

      const fullStart = new Date(baseDate);
      fullStart.setHours(14, 0, 0, 0);
      const fullEnd = new Date(fullStart);
      fullEnd.setMinutes(30, 0, 0);

      const createdAt = now.toISOString();

      localStorage.setItem(
        "grass-secretary-calendar-sharing",
        JSON.stringify({
          calendarId: "calendar-local-1",
          owner: {
            userId: "owner-local",
            displayName: "あなた",
          },
          members: [
            {
              id: "member-1",
              userId: "member-freebusy",
              email: "freebusy@example.com",
              displayName: "Aさん",
              role: "VIEWER_FREE_BUSY",
              color: "#3B82F6",
              invitedAt: createdAt,
              updatedAt: createdAt,
            },
            {
              id: "member-2",
              userId: "member-full",
              email: "viewer@example.com",
              displayName: "Bさん",
              role: "VIEWER_FULL",
              color: "#A855F7",
              invitedAt: createdAt,
              updatedAt: createdAt,
            },
          ],
          publicLink: null,
        }),
      );

      localStorage.setItem(
        "grass-secretary-schedules",
        JSON.stringify([
          {
            id: "owner-schedule",
            title: "集中作業",
            mode: "schedule",
            dueDate: ownerStart.toISOString(),
            endDate: ownerEnd.toISOString(),
            completed: false,
            tags: [],
            ownerId: "owner-local",
            ownerDisplayName: "あなた",
            createdAt,
          },
          {
            id: "freebusy-schedule",
            title: "定例会議",
            mode: "schedule",
            dueDate: freeBusyStart.toISOString(),
            endDate: freeBusyEnd.toISOString(),
            completed: false,
            tags: [],
            notes: "会議室A",
            ownerId: "member-freebusy",
            ownerDisplayName: "Aさん",
            createdAt,
          },
          {
            id: "private-schedule",
            title: "機密レビュー",
            mode: "schedule",
            dueDate: privateStart.toISOString(),
            endDate: privateEnd.toISOString(),
            completed: false,
            tags: [],
            isPrivate: true,
            notes: "公開不可メモ",
            ownerId: "member-full",
            ownerDisplayName: "Bさん",
            createdAt,
          },
          {
            id: "full-schedule",
            title: "通常ミーティング",
            mode: "schedule",
            dueDate: fullStart.toISOString(),
            endDate: fullEnd.toISOString(),
            completed: false,
            tags: [],
            ownerId: "member-full",
            ownerDisplayName: "Bさん",
            createdAt,
          },
        ]),
      );

      const { result } = renderHook(() => useSecretary());

      await waitFor(() => {
        expect(result.current.threads.length).toBe(1);
      });

      const scheduling = result.current.secretaryContext.scheduling;
      expect(scheduling).toBeDefined();
      expect(scheduling?.searchWindowDays).toBe(14);
      expect(scheduling?.allowOutsideWorkingHours).toBe(true);

      const freeBusyParticipant = scheduling?.participants.find(
        (participant) => participant.id === "member-freebusy",
      );
      expect(freeBusyParticipant?.visibilityMode).toBe("free_busy_only");

      const freeBusyWindow = scheduling?.busyWindows.find(
        (busy) => busy.participantId === "member-freebusy",
      );
      expect(freeBusyWindow).toBeDefined();
      expect(freeBusyWindow?.title).toBeUndefined();
      expect(freeBusyWindow?.notes).toBeUndefined();

      const privateWindow = scheduling?.busyWindows.find(
        (busy) => busy.participantId === "member-full" && busy.start === privateStart.toISOString(),
      );
      expect(privateWindow).toBeDefined();
      expect(privateWindow?.title).toBeUndefined();
      expect(privateWindow?.notes).toBeUndefined();

      const ownerWindow = scheduling?.busyWindows.find(
        (busy) => busy.participantId === "owner-local",
      );
      expect(ownerWindow?.title).toBe("集中作業");

      expect((scheduling?.freeSlotCandidates.length ?? 0) > 0).toBe(true);
      for (const candidate of scheduling?.freeSlotCandidates ?? []) {
        expect(candidate.durationMinutes).toBe(30);
        expect(candidate.participantIds).toEqual(
          expect.arrayContaining(["owner-local", "member-freebusy", "member-full"]),
        );
      }
    });
  });

  describe("priority-related helpers", () => {
    test("isOverdue should detect overdue tasks and ignore schedules", () => {
      const baseDate = new Date("2026-03-20T09:00:00.000Z");
      const overdueTask: ScheduleItem = {
        id: "task-overdue",
        title: "期限切れタスク",
        mode: "task",
        dueDate: new Date(baseDate.getTime() - 24 * 60 * 60 * 1000),
        completed: false,
        tags: [],
        createdAt: baseDate,
      };
      const schedule: ScheduleItem = {
        id: "schedule-normal",
        title: "会議",
        mode: "schedule",
        dueDate: new Date(baseDate.getTime() - 24 * 60 * 60 * 1000),
        completed: false,
        tags: [],
        createdAt: baseDate,
      };
      expect(isOverdue(overdueTask)).toBe(true);
      expect(isOverdue(schedule)).toBe(false);
    });

    test("checkScheduleConflicts should detect overlaps between schedules", () => {
      const tags: Tag[] = [
        {
          id: "tag-1",
          name: "重要",
          color: "#EF4444",
          priority: "high",
          createdAt: new Date("2026-03-20T09:00:00.000Z"),
        },
      ];
      const existing: ScheduleItem[] = [
        {
          id: "schedule-a",
          title: "既存会議",
          mode: "schedule",
          dueDate: new Date("2026-03-21T10:00:00.000Z"),
          endDate: new Date("2026-03-21T11:00:00.000Z"),
          completed: false,
          tags,
          createdAt: new Date("2026-03-20T09:00:00.000Z"),
        },
      ];

      const conflicts = checkScheduleConflicts(
        existing,
        "2026-03-21T10:30:00.000Z",
        "2026-03-21T11:30:00.000Z",
        undefined,
        "schedule",
        false,
      );

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].conflictingSchedule.title).toBe("既存会議");
    });
  });
});
