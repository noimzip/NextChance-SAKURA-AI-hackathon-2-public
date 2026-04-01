import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { act, renderHook } from "@testing-library/react";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";
import type {
  GoogleCalendarEventItem,
  GoogleCalendarListEventsOptions,
  ScheduleItem,
} from "@/types";

const mockUseGoogleCalendar = vi.hoisted(() => vi.fn());
const mockListGoogleCalendarEvents = vi.hoisted(() => vi.fn());
const mockCreateGoogleCalendarEvent = vi.hoisted(() => vi.fn());
const mockUpdateGoogleCalendarEvent = vi.hoisted(() => vi.fn());
const mockDeleteGoogleCalendarEvent = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useGoogleCalendar", () => ({
  useGoogleCalendar: mockUseGoogleCalendar,
}));

vi.mock("@/services/googleCalendarApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/googleCalendarApi")>();
  return {
    ...original,
    listGoogleCalendarEvents: mockListGoogleCalendarEvents,
    createGoogleCalendarEvent: mockCreateGoogleCalendarEvent,
    updateGoogleCalendarEvent: mockUpdateGoogleCalendarEvent,
    deleteGoogleCalendarEvent: mockDeleteGoogleCalendarEvent,
  };
});

function createSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  const dueDate = new Date("2026-04-01T09:00:00.000Z");
  const endDate = new Date("2026-04-01T10:00:00.000Z");
  return {
    id: "schedule-1",
    title: "ローカル予定",
    mode: "schedule",
    dueDate,
    endDate,
    completed: false,
    tags: [],
    createdAt: new Date("2026-04-01T08:00:00.000Z"),
    ...overrides,
  };
}

function createTask(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return createSchedule({
    id: "task-1",
    title: "タスク",
    mode: "task",
    endDate: undefined,
    ...overrides,
  });
}

function createEvent(overrides: Partial<GoogleCalendarEventItem> = {}): GoogleCalendarEventItem {
  return {
    id: "event-1",
    summary: "Google予定",
    start: { dateTime: "2026-04-01T09:00:00.000Z" },
    end: { dateTime: "2026-04-01T10:00:00.000Z" },
    updated: "2026-04-01T09:30:00.000Z",
    ...overrides,
  };
}

function setupGoogleHookReturn() {
  mockUseGoogleCalendar.mockReturnValue({
    token: {
      accessToken: "token",
      tokenType: "Bearer",
      scope: "https://www.googleapis.com/auth/calendar.events",
      expiresAt: Date.now() + 3600 * 1000,
      obtainedAt: Date.now(),
    },
    isAuthenticated: true,
    isLoading: false,
    isFetchingEvents: false,
    isListingCalendars: false,
    isCreatingEvent: false,
    isUpdatingEvent: false,
    isDeletingEvent: false,
    calendars: [{ id: "primary", summary: "Primary" }],
    selectedCalendarId: "primary",
    error: null,
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    refreshCalendars: vi.fn(async () => [{ id: "primary", summary: "Primary" }]),
    setSelectedCalendarId: vi.fn(),
    clearError: vi.fn(),
  });
}

describe("useGoogleCalendarSync", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setupGoogleHookReturn();
    mockListGoogleCalendarEvents.mockResolvedValue([]);
    mockCreateGoogleCalendarEvent.mockResolvedValue(createEvent());
    mockUpdateGoogleCalendarEvent.mockResolvedValue(createEvent());
    mockDeleteGoogleCalendarEvent.mockResolvedValue(undefined);
  });

  test("syncs only schedule mode items outbound", async () => {
    const addSchedule = vi.fn();
    const updateSchedule = vi.fn();
    const deleteSchedule = vi.fn();

    const { result } = renderHook(() =>
      useGoogleCalendarSync({
        schedules: [createSchedule({ id: "schedule-sync" }), createTask({ id: "task-skip" })],
        addSchedule,
        updateSchedule,
        deleteSchedule,
      }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(mockCreateGoogleCalendarEvent).toHaveBeenCalledTimes(1);
    const payload = mockCreateGoogleCalendarEvent.mock.calls[0]?.[1];
    expect(payload.summary).toBe("ローカル予定");
    expect(payload.extendedProperties?.private?.grass_secretary_schedule_id).toBe("schedule-sync");
    expect(payload.colorId).toBeUndefined();
  });

  test("sends mapped Google colorId for outbound sync", async () => {
    const addSchedule = vi.fn();
    const updateSchedule = vi.fn();
    const deleteSchedule = vi.fn();

    const { result } = renderHook(() =>
      useGoogleCalendarSync({
        schedules: [createSchedule({ id: "schedule-color", color: "#EF4444" })],
        addSchedule,
        updateSchedule,
        deleteSchedule,
      }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    const payload = mockCreateGoogleCalendarEvent.mock.calls[0]?.[1];
    expect(payload.colorId).toBe("11");
  });

  test("detects conflict when both local and remote changed", async () => {
    const baselineEvent = createEvent({
      summary: "Google予定A",
      updated: "2026-04-01T09:05:00.000Z",
    });
    const changedEvent = createEvent({
      summary: "Google予定B",
      updated: "2026-04-01T09:10:00.000Z",
    });
    mockListGoogleCalendarEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([baselineEvent])
      .mockResolvedValueOnce([changedEvent]);

    const addSchedule = vi.fn();
    const updateSchedule = vi.fn();
    const deleteSchedule = vi.fn();

    const localSchedule = createSchedule({ id: "schedule-conflict", title: "ローカル予定A" });

    const first = renderHook(() =>
      useGoogleCalendarSync({
        schedules: [localSchedule],
        addSchedule,
        updateSchedule,
        deleteSchedule,
      }),
    );

    await act(async () => {
      await first.result.current.syncNow();
    });

    first.unmount();

    const second = renderHook(() =>
      useGoogleCalendarSync({
        schedules: [createSchedule({ id: "schedule-conflict", title: "ローカル予定B" })],
        addSchedule,
        updateSchedule,
        deleteSchedule,
      }),
    );

    await act(async () => {
      await second.result.current.syncNow();
    });

    expect(second.result.current.conflicts).toHaveLength(1);
    expect(second.result.current.conflicts[0].scheduleId).toBe("schedule-conflict");
  });

  test("does not duplicate schedules when switching calendars A→B→A", async () => {
    const calendarA = "calendar-a";
    const calendarB = "calendar-b";
    const scheduleId = "schedule-a";
    const eventId = "event-a";

    localStorage.setItem(
      "grass-secretary-google-calendar-sync-meta-v1",
      JSON.stringify({
        selectedCalendarId: calendarA,
        scheduleToEventMap: {
          [scheduleId]: eventId,
        },
        eventToScheduleMap: {
          [eventId]: scheduleId,
        },
        remoteHashByScheduleId: {
          [scheduleId]: "remote-hash-a",
        },
        localHashByScheduleId: {
          [scheduleId]: "local-hash-a",
        },
        byCalendarId: {
          [calendarA]: {
            scheduleToEventMap: {
              [scheduleId]: eventId,
            },
            eventToScheduleMap: {
              [eventId]: scheduleId,
            },
            remoteHashByScheduleId: {
              [scheduleId]: "remote-hash-a",
            },
            localHashByScheduleId: {
              [scheduleId]: "local-hash-a",
            },
            lastInboundSyncAt: "2026-04-01T09:30:00.000Z",
          },
        },
      }),
    );

    let currentCalendarId = calendarA;
    const setSelectedCalendarIdMock = vi.fn((next: string) => {
      currentCalendarId = next;
    });
    mockUseGoogleCalendar.mockImplementation(() => ({
      token: {
        accessToken: "token",
        tokenType: "Bearer",
        scope: "https://www.googleapis.com/auth/calendar.events",
        expiresAt: Date.now() + 3600 * 1000,
        obtainedAt: Date.now(),
      },
      isAuthenticated: true,
      isLoading: false,
      isFetchingEvents: false,
      isListingCalendars: false,
      isCreatingEvent: false,
      isUpdatingEvent: false,
      isDeletingEvent: false,
      calendars: [
        { id: calendarA, summary: "Calendar A" },
        { id: calendarB, summary: "Calendar B" },
      ],
      selectedCalendarId: currentCalendarId,
      error: null,
      login: vi.fn(async () => undefined),
      logout: vi.fn(async () => undefined),
      refreshCalendars: vi.fn(async () => []),
      setSelectedCalendarId: setSelectedCalendarIdMock,
      clearError: vi.fn(),
    }));

    mockListGoogleCalendarEvents.mockImplementation(
      async (_token: string, options?: GoogleCalendarListEventsOptions) => {
        if (options?.calendarId === calendarA) {
          return [
            createEvent({
              id: eventId,
              summary: "A予定",
              updated: "2026-04-01T09:35:00.000Z",
              extendedProperties: {
                private: {
                  grass_secretary_source: "grass-secretary",
                  grass_secretary_schedule_id: scheduleId,
                },
              },
            }),
          ];
        }
        return [];
      },
    );

    const addSchedule = vi.fn();
    const updateSchedule = vi.fn();
    const deleteSchedule = vi.fn();
    const existingSchedule = createSchedule({ id: scheduleId, title: "A予定" });

    const { result, rerender } = renderHook(
      ({ schedules }) =>
        useGoogleCalendarSync({
          schedules,
          addSchedule,
          updateSchedule,
          deleteSchedule,
        }),
      {
        initialProps: {
          schedules: [existingSchedule],
        },
      },
    );

    await act(async () => {
      result.current.setSelectedCalendarId(calendarB);
    });
    rerender({ schedules: [existingSchedule] });

    await act(async () => {
      await result.current.syncNow();
    });

    await act(async () => {
      result.current.setSelectedCalendarId(calendarA);
    });
    rerender({ schedules: [existingSchedule] });

    await act(async () => {
      await result.current.syncNow();
    });

    expect(addSchedule).not.toHaveBeenCalled();
    expect(setSelectedCalendarIdMock).toHaveBeenCalledWith(calendarB);
    expect(setSelectedCalendarIdMock).toHaveBeenCalledWith(calendarA);

    const savedMeta = JSON.parse(
      localStorage.getItem("grass-secretary-google-calendar-sync-meta-v1") ?? "{}",
    );
    expect(savedMeta.byCalendarId?.[calendarA]?.eventToScheduleMap?.[eventId]).toBe(scheduleId);
  });

  test("resolves conflict by keeping local", async () => {
    localStorage.setItem(
      "grass-secretary-google-calendar-sync-conflicts-v1",
      JSON.stringify([
        {
          id: "conflict-keep-local",
          scheduleId: "schedule-keep-local",
          eventId: "event-keep-local",
          calendarId: "primary",
          scheduleTitle: "ローカル予定",
          remoteTitle: "Google予定",
          detectedAt: "2026-04-01T09:15:00.000Z",
        },
      ]),
    );

    const addSchedule = vi.fn();
    const updateSchedule = vi.fn();
    const deleteSchedule = vi.fn();

    const { result } = renderHook(() =>
      useGoogleCalendarSync({
        schedules: [createSchedule({ id: "schedule-keep-local" })],
        addSchedule,
        updateSchedule,
        deleteSchedule,
      }),
    );

    await act(async () => {
      await result.current.resolveConflictKeepLocal("conflict-keep-local");
    });

    expect(mockUpdateGoogleCalendarEvent).toHaveBeenCalled();
    expect(result.current.conflicts).toHaveLength(0);
  });

  test("imports Google event color into local schedule updates", async () => {
    localStorage.setItem(
      "grass-secretary-google-calendar-sync-meta-v1",
      JSON.stringify({
        selectedCalendarId: "primary",
        byCalendarId: {
          primary: {
            scheduleToEventMap: {
              "schedule-color-map": "event-color-1",
            },
            eventToScheduleMap: {
              "event-color-1": "schedule-color-map",
            },
            remoteHashByScheduleId: {
              "schedule-color-map": "old-remote",
            },
            localHashByScheduleId: {},
            lastInboundSyncAt: "2026-04-01T09:00:00.000Z",
          },
        },
      }),
    );

    mockListGoogleCalendarEvents.mockResolvedValue([
      createEvent({
        id: "event-color-1",
        summary: "色付きイベント",
        colorId: "11",
        updated: "2026-04-01T09:35:00.000Z",
      }),
    ]);

    const addSchedule = vi.fn();
    const updateSchedule = vi.fn();
    const deleteSchedule = vi.fn();

    const { result } = renderHook(() =>
      useGoogleCalendarSync({
        schedules: [createSchedule({ id: "schedule-color-map", title: "色同期対象" })],
        addSchedule,
        updateSchedule,
        deleteSchedule,
      }),
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(updateSchedule).toHaveBeenCalled();
    const updates = updateSchedule.mock.calls[0]?.[1];
    expect(updates.color).toBe("#EF4444");
  });
});
