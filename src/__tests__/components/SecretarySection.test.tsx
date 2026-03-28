import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ChatThread, ScheduleItem, SecretaryAction, SecretaryContext, Tag } from "@/types";

const {
  mockUseSecretary,
  mockDeleteSchedule,
  mockSetConflictWarnings,
  mockStartDialogue,
  mockStopDialogue,
  mockSpeakText,
} = vi.hoisted(() => ({
  mockUseSecretary: vi.fn(),
  mockDeleteSchedule: vi.fn(),
  mockSetConflictWarnings: vi.fn(),
  mockStartDialogue: vi.fn(async () => undefined),
  mockStopDialogue: vi.fn(async () => undefined),
  mockSpeakText: vi.fn(async () => undefined),
}));

vi.mock("@/hooks/useSecretary", () => ({
  useSecretary: (...args: unknown[]) => mockUseSecretary(...args),
}));

vi.mock("@/hooks/useSchedule", () => ({
  useSchedule: () => ({
    deleteSchedule: mockDeleteSchedule,
  }),
}));

vi.mock("@/hooks/useWarningSettings", () => ({
  useWarningSettings: () => ({
    settings: {
      conflictWarnings: true,
      overdueWarnings: true,
    },
    setConflictWarnings: mockSetConflictWarnings,
    setOverdueWarnings: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSakuraSTT", () => ({
  useSakuraSTT: () => ({
    isSupported: true,
    isRecording: false,
    isTranscribing: false,
    recordingTimeMs: 0,
    recordingTimeLabel: "00:00",
    audioLevel: 0,
    transcript: "",
    error: null,
    analyserNode: null,
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => null),
    cancel: vi.fn(async () => undefined),
    transcribeAudio: vi.fn(async () => ""),
    reset: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDialogueLoop", () => ({
  useDialogueLoop: () => ({
    isActive: false,
    phase: "idle",
    statusLabel: "待機中",
    sessionTitle: null,
    error: null,
    turns: [],
    stt: {
      isSupported: true,
      isRecording: false,
      isTranscribing: false,
      recordingTimeLabel: "00:00",
      audioLevel: 0,
    },
    startDialogue: mockStartDialogue,
    stopDialogue: mockStopDialogue,
    toggleDialogue: vi.fn(async () => undefined),
  }),
}));

vi.mock("@/services/sakuraAI", () => ({
  isApiConfigured: () => true,
}));

vi.mock("@/services/speechService", () => ({
  speakText: mockSpeakText,
}));

vi.mock("@/services/photoAnalysisService", () => ({
  compressImageDataUrlForStorage: vi.fn(async (value: string) => value),
  fileToDataUrl: vi.fn(async () => ""),
}));

vi.mock("@/lib/nextPromptSuggestions", () => ({
  generateNextPromptSuggestions: vi.fn(async () => []),
}));

vi.mock("@/components/chat/ChatMessage", () => ({
  ChatMessage: () => <div data-testid="chat-message" />,
}));

vi.mock("@/components/chat/ChatInput", () => ({
  ChatInput: () => <div data-testid="chat-input" />,
}));

vi.mock("@/components/VoiceInputButton", () => ({
  VoiceInputButton: () => <button type="button">voice-input</button>,
}));

vi.mock("@/components/DialogueOverlay", () => ({
  DialogueOverlay: () => null,
}));

vi.mock("@/components/schedule/ScheduleDetailModal", () => ({
  ScheduleDetailModal: () => null,
}));

import { SecretarySection } from "@/components/SecretarySection";

const baseTag: Tag = {
  id: "tag-1",
  name: "仕事",
  color: "#3B82F6",
  priority: "medium",
  conflictWarningsEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const baseSecretaryContext: SecretaryContext = {
  currentDate: "2026-04-01T09:00:00.000Z",
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

function createSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: "schedule-1",
    title: "朝会",
    mode: "schedule",
    dueDate: new Date("2026-04-02T09:00:00.000Z"),
    endDate: new Date("2026-04-02T10:00:00.000Z"),
    completed: false,
    tags: [baseTag],
    location: "会議室A",
    notes: "議題確認",
    createdAt: new Date("2026-03-20T08:00:00.000Z"),
    ...overrides,
  };
}

function createThread(pendingActions: SecretaryAction[]): ChatThread {
  return {
    id: "thread-1",
    title: "チャット 1",
    messages: [],
    pendingActions,
    lastExecutedAction: null,
    createdAt: new Date("2026-03-20T08:00:00.000Z"),
    updatedAt: new Date("2026-03-20T08:00:00.000Z"),
  };
}

function setupUseSecretaryMock(options: {
  pendingActions: SecretaryAction[];
  getScheduleById?: (id: string) => ScheduleItem | null;
  getScheduleByTitle?: (title: string) => ScheduleItem | null;
}) {
  const getScheduleByIdMock = vi.fn(options.getScheduleById ?? (() => null));
  const getScheduleByTitleMock = vi.fn(options.getScheduleByTitle ?? (() => null));
  const checkConflictsMock = vi.fn(() => []);
  const executeActionMock = vi.fn();
  const dismissActionMock = vi.fn();
  const createThreadMock = vi.fn(() => "thread-2");
  const selectThreadMock = vi.fn();
  const renameThreadMock = vi.fn();
  const deleteThreadMock = vi.fn();

  mockUseSecretary.mockReturnValue({
    threads: [createThread(options.pendingActions)],
    activeThreadId: "thread-1",
    messages: [],
    isLoading: false,
    error: null,
    pendingActions: options.pendingActions,
    lastExecutedAction: null,
    sendMessage: vi.fn(async () => undefined),
    sendMessageAndGetReply: vi.fn(async () => null),
    retryUserMessage: vi.fn(async () => null),
    cancelCurrentResponse: vi.fn(),
    deleteMessage: vi.fn(),
    playVoice: vi.fn(async () => undefined),
    isPlaying: null,
    executeAction: executeActionMock,
    dismissAction: dismissActionMock,
    executeAllActions: vi.fn(),
    undoLastAction: vi.fn(),
    getScheduleById: getScheduleByIdMock,
    getScheduleByTitle: getScheduleByTitleMock,
    checkConflicts: checkConflictsMock,
    createThread: createThreadMock,
    selectThread: selectThreadMock,
    renameThread: renameThreadMock,
    deleteThread: deleteThreadMock,
    secretaryContext: baseSecretaryContext,
  });

  return {
    getScheduleByIdMock,
    getScheduleByTitleMock,
    checkConflictsMock,
    executeActionMock,
    dismissActionMock,
    createThreadMock,
    selectThreadMock,
    renameThreadMock,
    deleteThreadMock,
  };
}

describe("SecretarySection update action confirmation details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  test("shows target identification and changed fields with before/after values", async () => {
    const updateAction: SecretaryAction = {
      type: "update_schedule",
      payload: {
        id: "schedule-1",
        title: "朝会",
        updates: {
          title: "朝会(30分)",
          location: "オンライン",
        },
      },
    };

    setupUseSecretaryMock({
      pendingActions: [updateAction],
      getScheduleById: () => createSchedule(),
    });

    render(<SecretarySection />);

    fireEvent.click(screen.getByRole("button", { name: /変更: 朝会/ }));

    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("変更対象")).toBeInTheDocument();
    expect(within(dialog).getByText(/ID: schedule-1/)).toBeInTheDocument();

    expect(within(dialog).getByText("変更内容")).toBeInTheDocument();
    expect(within(dialog).getByText("変更あり 2件")).toBeInTheDocument();
    expect(within(dialog).getByText("タイトル")).toBeInTheDocument();
    expect(within(dialog).getAllByText("場所").length).toBeGreaterThan(0);

    expect(within(dialog).getByText("朝会(30分)")).toBeInTheDocument();
    expect(within(dialog).getByText("会議室A")).toBeInTheDocument();
    expect(within(dialog).getByText("オンライン")).toBeInTheDocument();

    expect(within(dialog).getAllByText("変更前").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("変更後").length).toBeGreaterThan(0);
  });

  test("resolves target by title and shows task update details with explicit field labels", async () => {
    const targetTask = createSchedule({
      id: "task-7",
      title: "レポート作成",
      mode: "task",
      dueDate: new Date("2026-04-03T20:00:00.000Z"),
      endDate: undefined,
      notes: "初稿作成中",
      location: undefined,
    });

    const updateAction: SecretaryAction = {
      type: "update_schedule",
      payload: {
        title: "レポート作成",
        updates: {
          notes: "レビュー依頼済み",
        },
      },
    };

    const { getScheduleByTitleMock } = setupUseSecretaryMock({
      pendingActions: [updateAction],
      getScheduleByTitle: () => targetTask,
    });

    render(<SecretarySection />);

    fireEvent.click(screen.getByRole("button", { name: /変更: レポート作成/ }));

    const dialog = await screen.findByRole("dialog");

    expect(getScheduleByTitleMock).toHaveBeenCalledWith("レポート作成");
    expect(within(dialog).getByText("変更対象")).toBeInTheDocument();
    expect(within(dialog).getByText("変更あり 1件")).toBeInTheDocument();

    expect(within(dialog).getAllByText("備考").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("初稿作成中")).toBeInTheDocument();
    expect(within(dialog).getAllByText("レビュー依頼済み").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("期限")).toBeInTheDocument();
    expect(within(dialog).getByText(/変更なし:/)).toBeInTheDocument();

    expect(within(dialog).getAllByText("変更前").length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText("変更後").length).toBeGreaterThan(0);
  });

  test("adds scroll constraints to confirmation dialog for long content", async () => {
    const updateAction: SecretaryAction = {
      type: "update_schedule",
      payload: {
        id: "schedule-1",
        title: "朝会",
        updates: {
          notes: "長文の確認",
        },
      },
    };

    setupUseSecretaryMock({
      pendingActions: [updateAction],
      getScheduleById: () => createSchedule(),
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: /変更: 朝会/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("max-h-[85vh]");
    expect(dialog).toHaveClass("overflow-y-auto");
  });

  test("checks conflicts even when update action does not include dueDate", async () => {
    const target = createSchedule({
      dueDate: new Date("2026-04-10T09:00:00.000Z"),
      endDate: new Date("2026-04-10T10:00:00.000Z"),
      isAllDay: false,
    });
    const updateAction: SecretaryAction = {
      type: "update_schedule",
      payload: {
        id: "schedule-1",
        title: "朝会",
        updates: {
          notes: "議題更新",
        },
      },
    };

    const { checkConflictsMock } = setupUseSecretaryMock({
      pendingActions: [updateAction],
      getScheduleById: () => target,
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: /変更: 朝会/ }));
    await screen.findByRole("dialog");

    expect(checkConflictsMock).toHaveBeenCalledWith(
      new Date(target.dueDate).toISOString(),
      new Date(target.endDate!).toISOString(),
      "schedule",
      false,
      "schedule-1",
      "朝会",
    );
  });

  test("allows editing add action fields before confirmation", async () => {
    const addAction: SecretaryAction = {
      type: "add_schedule",
      payload: {
        title: "初期タイトル",
        mode: "task",
        dueDate: "2026-04-02T09:00:00.000Z",
      },
    };

    const { executeActionMock, dismissActionMock } = setupUseSecretaryMock({
      pendingActions: [addAction],
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: /追加: 初期タイトル/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("タイトル"), {
      target: { value: "修正後タイトル" },
    });
    fireEvent.change(within(dialog).getByLabelText("場所"), {
      target: { value: "会議室B" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "追加する" }));

    expect(executeActionMock).toHaveBeenCalledTimes(1);
    const submittedAction = executeActionMock.mock.calls[0][0] as SecretaryAction;
    expect(submittedAction.type).toBe("add_schedule");
    if (submittedAction.type === "add_schedule") {
      expect(submittedAction.payload.title).toBe("修正後タイトル");
      expect(submittedAction.payload.location).toBe("会議室B");
    }
    expect(dismissActionMock).toHaveBeenCalledWith(0);
  });

  test("shows schedule-only update fields when target is schedule", async () => {
    const updateAction: SecretaryAction = {
      type: "update_schedule",
      payload: {
        id: "schedule-1",
        title: "朝会",
        updates: {
          notes: "更新",
        },
      },
    };

    setupUseSecretaryMock({
      pendingActions: [updateAction],
      getScheduleById: () => createSchedule({ mode: "schedule", isAllDay: false }),
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: /変更: 朝会/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("開始日時（変更後）")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("終了日時（変更後）")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("終日として変更")).toBeInTheDocument();
  });

  test("shows task-oriented update fields when target is task", async () => {
    const targetTask = createSchedule({
      id: "task-9",
      title: "仕様確認",
      mode: "task",
      endDate: undefined,
    });
    const updateAction: SecretaryAction = {
      type: "update_schedule",
      payload: {
        id: "task-9",
        title: "仕様確認",
        updates: {
          notes: "更新",
        },
      },
    };

    setupUseSecretaryMock({
      pendingActions: [updateAction],
      getScheduleById: () => targetTask,
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: /変更: 仕様確認/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("期限（変更後）")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("終了日時（変更後）")).toBeNull();
    expect(within(dialog).queryByLabelText("終日として変更")).toBeNull();
  });

  test("opens mobile thread list sheet and supports selecting thread", async () => {
    const { selectThreadMock } = setupUseSecretaryMock({
      pendingActions: [],
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: "チャット一覧を表示" }));

    const sheet = await screen.findByRole("dialog", { name: "チャット一覧" });
    expect(sheet).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: /チャット 1 \d{2}:\d{2}/ }));
    expect(selectThreadMock).toHaveBeenCalledWith("thread-1");
  });

  test("mobile sheet provides rename and delete actions for threads", async () => {
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("新しい名前");
    const { renameThreadMock } = setupUseSecretaryMock({
      pendingActions: [],
    });

    render(<SecretarySection />);
    fireEvent.click(screen.getByRole("button", { name: "チャット一覧を表示" }));
    const sheet = await screen.findByRole("dialog", { name: "チャット一覧" });

    fireEvent.click(within(sheet).getByLabelText("チャット「チャット 1」を名前変更"));
    expect(promptSpy).toHaveBeenCalled();
    expect(renameThreadMock).toHaveBeenCalledWith("thread-1", "新しい名前");

    fireEvent.click(within(sheet).getByLabelText("チャット「チャット 1」を削除"));
    expect(await screen.findByRole("heading", { name: "チャットを削除" })).toBeInTheDocument();
  });
});
