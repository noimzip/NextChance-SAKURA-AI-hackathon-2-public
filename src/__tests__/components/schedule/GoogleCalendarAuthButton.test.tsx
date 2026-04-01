import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GoogleCalendarAuthButton } from "@/components/schedule/GoogleCalendarAuthButton";
import type { ScheduleItem } from "@/types";

const mockUseGoogleCalendarSync = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useGoogleCalendarSync", () => ({
  useGoogleCalendarSync: mockUseGoogleCalendarSync,
}));

function createSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  const dueDate = new Date("2026-04-01T09:00:00.000Z");
  const endDate = new Date("2026-04-01T10:00:00.000Z");
  return {
    id: "schedule-1",
    title: "テスト予定",
    mode: "schedule",
    dueDate,
    endDate,
    completed: false,
    tags: [],
    createdAt: new Date("2026-04-01T08:00:00.000Z"),
    ...overrides,
  };
}

describe("GoogleCalendarAuthButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("shows login state and triggers login flow", async () => {
    const clearSyncError = vi.fn();
    const clearCalendarError = vi.fn();
    const login = vi.fn(async () => undefined);
    const refreshCalendars = vi.fn(async () => []);
    const syncNow = vi.fn(async () => undefined);

    mockUseGoogleCalendarSync.mockReturnValue({
      isSyncing: false,
      isAutoSyncEnabled: false,
      isAuthenticated: false,
      calendars: [],
      selectedCalendarId: "primary",
      conflicts: [],
      syncError: null,
      calendarError: null,
      lastSyncedAt: null,
      login,
      logout: vi.fn(async () => undefined),
      refreshCalendars,
      setSelectedCalendarId: vi.fn(),
      syncNow,
      resolveConflictKeepLocal: vi.fn(async () => undefined),
      resolveConflictKeepRemote: vi.fn(async () => undefined),
      clearSyncError,
      clearCalendarError,
    });

    render(
      <GoogleCalendarAuthButton
        schedules={[createSchedule()]}
        addSchedule={vi.fn()}
        updateSchedule={vi.fn()}
        deleteSchedule={vi.fn()}
      />,
    );

    expect(screen.getByText("Google未連携")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Googleログイン" }));

    await waitFor(() => {
      expect(clearSyncError).toHaveBeenCalled();
      expect(clearCalendarError).toHaveBeenCalled();
      expect(login).toHaveBeenCalled();
      expect(refreshCalendars).toHaveBeenCalled();
      expect(syncNow).toHaveBeenCalled();
    });
  });

  test("shows authenticated controls and triggers sync/logout/conflict handlers", async () => {
    const clearSyncError = vi.fn();
    const clearCalendarError = vi.fn();
    const syncNow = vi.fn(async () => undefined);
    const logout = vi.fn(async () => undefined);
    const resolveConflictKeepLocal = vi.fn(async () => undefined);
    const resolveConflictKeepRemote = vi.fn(async () => undefined);
    const setSelectedCalendarId = vi.fn();

    mockUseGoogleCalendarSync.mockReturnValue({
      isSyncing: false,
      isAutoSyncEnabled: true,
      isAuthenticated: true,
      calendars: [
        { id: "primary", summary: "Primary" },
        { id: "team-calendar", summary: "チーム" },
      ],
      selectedCalendarId: "primary",
      conflicts: [
        {
          id: "conflict-1",
          scheduleId: "schedule-1",
          eventId: "event-1",
          calendarId: "primary",
          scheduleTitle: "競合予定",
          remoteTitle: "Google競合",
          remoteUpdatedAt: "2026-04-01T09:05:00.000Z",
          detectedAt: "2026-04-01T09:06:00.000Z",
        },
      ],
      syncError: "同期エラー",
      calendarError: null,
      lastSyncedAt: new Date("2026-04-01T09:10:00.000Z"),
      login: vi.fn(async () => undefined),
      logout,
      refreshCalendars: vi.fn(async () => []),
      setSelectedCalendarId,
      syncNow,
      resolveConflictKeepLocal,
      resolveConflictKeepRemote,
      clearSyncError,
      clearCalendarError,
    });

    render(
      <GoogleCalendarAuthButton
        schedules={[createSchedule()]}
        addSchedule={vi.fn()}
        updateSchedule={vi.fn()}
        deleteSchedule={vi.fn()}
      />,
    );

    expect(screen.getByText("Google連携済み")).toBeInTheDocument();
    expect(screen.getByText("競合: 1件")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("カレンダー"), {
      target: { value: "team-calendar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "今すぐ同期" }));
    fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    fireEvent.click(screen.getByRole("button", { name: "ローカル優先" }));
    fireEvent.click(screen.getByRole("button", { name: "Google優先" }));
    fireEvent.click(screen.getByRole("button", { name: "クリア" }));

    await waitFor(() => {
      expect(setSelectedCalendarId).toHaveBeenCalledWith("team-calendar");
      expect(syncNow).toHaveBeenCalled();
      expect(logout).toHaveBeenCalled();
      expect(resolveConflictKeepLocal).toHaveBeenCalledWith("conflict-1");
      expect(resolveConflictKeepRemote).toHaveBeenCalledWith("conflict-1");
      expect(clearSyncError).toHaveBeenCalled();
      expect(clearCalendarError).toHaveBeenCalled();
    });
  });
});
