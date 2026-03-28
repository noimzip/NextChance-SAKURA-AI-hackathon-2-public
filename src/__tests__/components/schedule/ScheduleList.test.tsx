import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BOOKED_EVENT_TITLE } from "@/lib/calendarPermissions";
import type {
  CalendarShareLink,
  ScheduleConflict,
  ScheduleItem,
  SharedCalendarMeta,
  Tag,
} from "@/types";

type CheckScheduleConflictsFn = (
  schedules: ScheduleItem[],
  dueDate: string | Date,
  endDate?: string | Date,
  excludeId?: string,
  targetMode?: ScheduleItem["mode"],
  targetIsAllDay?: boolean,
) => ScheduleConflict[];

const mockCheckScheduleConflicts = vi.fn<CheckScheduleConflictsFn>(() => []);
const mockResolvePublicRoleByToken =
  vi.fn<(token: string) => "VIEWER_FULL" | "VIEWER_FREE_BUSY" | null>();
const mockDeleteSchedule = vi.fn();
const mockDeleteTag = vi.fn();
const mockRemoveMember = vi.fn();

let mockSchedules: ScheduleItem[] = [];
let mockSharing: SharedCalendarMeta;

const baseTag: Tag = {
  id: "tag-1",
  name: "重要",
  color: "#EF4444",
  priority: "high",
  conflictWarningsEnabled: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

function createShareLink(overrides?: Partial<CalendarShareLink>): CalendarShareLink {
  return {
    token: "valid-token",
    enabled: true,
    role: "VIEWER_FULL",
    createdAt: new Date("2099-01-01T00:00:00.000Z"),
    updatedAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createSchedule(overrides: Partial<ScheduleItem>): ScheduleItem {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 1);
  dueDate.setHours(9, 0, 0, 0);
  const endDate = new Date(dueDate);
  endDate.setHours(10, 0, 0, 0);

  return {
    id: "schedule-default",
    title: "予定",
    mode: "schedule",
    dueDate,
    endDate,
    completed: false,
    tags: [baseTag],
    createdAt: new Date(),
    ...overrides,
  };
}

function getLatestConflictInput(): ScheduleItem[] {
  const latestCall = mockCheckScheduleConflicts.mock.lastCall;
  if (!latestCall) {
    throw new Error("checkScheduleConflicts was not called");
  }
  return latestCall[0];
}

vi.mock("@/lib/scheduleConflicts", () => ({
  checkScheduleConflicts: (...args: Parameters<CheckScheduleConflictsFn>) =>
    mockCheckScheduleConflicts(...args),
  checkIsOverdueDate: () => false,
}));

vi.mock("@/hooks/useSchedule", () => ({
  useSchedule: () => ({
    schedules: mockSchedules,
    addSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: mockDeleteSchedule,
    toggleComplete: vi.fn(),
    getUpcoming: () => mockSchedules.filter((item) => !item.completed),
    getOverdue: () => [],
    getCalendarEventsByDate: () => new Map(),
    getCalendarEventsByDateWithAccess: () => new Map(),
    getScheduleVisibilityView: () => [],
  }),
}));

vi.mock("@/hooks/useCalendarSharing", () => ({
  useCalendarSharing: () => ({
    sharing: mockSharing,
    ownerUserId: "owner-local",
    inviteMember: vi.fn(() => ({ ok: false, reason: "not-used" })),
    updateMemberRole: vi.fn(() => ({ ok: false, reason: "not-used" })),
    removeMember: mockRemoveMember,
    setPublicLinkEnabled: vi.fn(() => createShareLink()),
    setPublicLinkRole: vi.fn(() => createShareLink()),
    regeneratePublicLinkToken: vi.fn(() => createShareLink()),
    getPublicShareUrl: vi.fn(() => null),
    resolvePublicRoleByToken: mockResolvePublicRoleByToken,
  }),
}));

vi.mock("@/hooks/useTags", () => ({
  DEFAULT_COLORS: ["#EF4444", "#3B82F6", "#22C55E"],
  useTags: () => ({
    tags: [
      baseTag,
      {
        id: "tag-2",
        name: "会議",
        color: "#3B82F6",
        priority: "medium",
        conflictWarningsEnabled: true,
        createdAt: new Date(),
      },
    ],
    addTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: mockDeleteTag,
  }),
}));

vi.mock("@/hooks/useEffortLog", () => ({
  useEffortLog: () => ({
    addActivity: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWarningSettings", () => ({
  useWarningSettings: () => ({
    settings: {
      conflictWarnings: true,
      overdueWarnings: true,
    },
    setConflictWarnings: vi.fn(),
    setOverdueWarnings: vi.fn(),
  }),
}));

vi.mock("@/components/schedule/ScheduleItem", () => ({
  ScheduleItem: ({ item, onDelete }: { item: ScheduleItem; onDelete: () => void }) => (
    <button data-testid={`delete-${item.id}`} onClick={onDelete}>
      delete-{item.id}
    </button>
  ),
}));

vi.mock("@/components/schedule/ScheduleDetailModal", () => ({
  ScheduleDetailModal: () => null,
}));

vi.mock("@/components/schedule/CalendarSharingPanel", () => ({
  CalendarSharingPanel: ({
    activeViewerMode,
    sharing,
    onRemoveMember,
  }: {
    activeViewerMode: string;
    sharing: SharedCalendarMeta;
    onRemoveMember: (memberId: string) => void;
  }) => (
    <div data-testid="active-viewer-mode" data-mode={activeViewerMode}>
      <button
        onClick={() => {
          if (sharing.members[0]) {
            onRemoveMember(sharing.members[0].id);
          }
        }}
      >
        remove-first-member
      </button>
    </div>
  ),
}));

import { ScheduleList } from "@/components/schedule/ScheduleList";

describe("ScheduleList share-token and conflict privacy behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
    mockCheckScheduleConflicts.mockClear();
    mockResolvePublicRoleByToken.mockReset();
    mockResolvePublicRoleByToken.mockReturnValue(null);
    mockDeleteSchedule.mockClear();
    mockDeleteTag.mockClear();
    mockRemoveMember.mockClear();

    mockSchedules = [
      createSchedule({
        id: "private-1",
        title: "秘密会議",
        isPrivate: true,
        notes: "持ち物: パスポート",
      }),
      createSchedule({
        id: "public-1",
        title: "公開ミーティング",
        isPrivate: false,
      }),
    ];

    mockSharing = {
      calendarId: "calendar-local-1",
      owner: {
        userId: "owner-local",
        displayName: "あなた",
      },
      members: [],
      publicLink: createShareLink(),
    };
  });

  test("switches to public viewer mode for valid URL token and masks private conflicts", async () => {
    window.history.replaceState({}, "", "/?shareToken=valid-token");
    mockResolvePublicRoleByToken.mockImplementation((token) =>
      token === "valid-token" ? "VIEWER_FULL" : null,
    );

    render(<ScheduleList />);

    await waitFor(() => {
      expect(screen.getByTestId("active-viewer-mode")).toHaveAttribute("data-mode", "public");
    });

    expect(mockResolvePublicRoleByToken).toHaveBeenCalledWith("valid-token");

    await waitFor(() => {
      expect(mockCheckScheduleConflicts).toHaveBeenCalled();
    });

    const conflictInput = getLatestConflictInput();
    const privateSchedule = conflictInput.find((item) => item.id === "private-1");
    const publicSchedule = conflictInput.find((item) => item.id === "public-1");

    expect(privateSchedule?.title).toBe(BOOKED_EVENT_TITLE);
    expect(privateSchedule?.notes).toBeUndefined();
    expect(privateSchedule?.tags).toEqual([]);
    expect(publicSchedule?.title).toBe("公開ミーティング");
  });

  test("keeps owner mode and raw schedule details when URL token is invalid", async () => {
    window.history.replaceState({}, "", "/?shareToken=invalid-token");
    mockResolvePublicRoleByToken.mockReturnValue(null);

    render(<ScheduleList />);

    await waitFor(() => {
      expect(mockResolvePublicRoleByToken).toHaveBeenCalledWith("invalid-token");
    });

    expect(screen.getByTestId("active-viewer-mode")).toHaveAttribute("data-mode", "owner");

    await waitFor(() => {
      expect(mockCheckScheduleConflicts).toHaveBeenCalled();
    });

    const conflictInput = getLatestConflictInput();
    const privateSchedule = conflictInput.find((item) => item.id === "private-1");

    expect(privateSchedule?.title).toBe("秘密会議");
    expect(privateSchedule?.notes).toBe("持ち物: パスポート");
    expect(privateSchedule?.tags.map((tag) => tag.name)).toEqual(["重要"]);
  });

  test("requires confirmation before deleting non-recurring schedule", async () => {
    render(<ScheduleList />);

    fireEvent.click(await screen.findByTestId("delete-private-1"));

    expect(screen.getByText("予定を削除")).toBeInTheDocument();
    expect(screen.getByText("この予定を削除します。よろしいですか？")).toBeInTheDocument();
    expect(mockDeleteSchedule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(mockDeleteSchedule).toHaveBeenCalledWith("private-1", "single");
  });

  test("requires confirmation before deleting tag", async () => {
    render(<ScheduleList />);

    fireEvent.click(screen.getByRole("button", { name: "タグ" }));
    fireEvent.click(screen.getByLabelText("会議タグを削除"));

    expect(screen.getByText("タグを削除")).toBeInTheDocument();
    expect(mockDeleteTag).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(mockDeleteTag).toHaveBeenCalledWith("tag-2");
  });

  test("requires confirmation before removing shared member", async () => {
    mockSharing = {
      ...mockSharing,
      members: [
        {
          id: "member-1",
          userId: "member-user-1",
          email: "member@example.com",
          displayName: "共有メンバー",
          role: "VIEWER_FULL",
          color: "#3B82F6",
          invitedAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    render(<ScheduleList />);

    fireEvent.click(screen.getByText("remove-first-member"));

    expect(screen.getByText("共有ユーザーを削除")).toBeInTheDocument();
    expect(mockRemoveMember).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));

    expect(mockRemoveMember).toHaveBeenCalledWith("member-1");
  });
});
