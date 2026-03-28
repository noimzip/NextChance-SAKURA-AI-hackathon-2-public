import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useSchedule } from "@/hooks/useSchedule";
import { resolveAccessContextForMember } from "@/lib/calendarPermissions";

describe("useSchedule", () => {
  function mockNow(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  function dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it("should start with empty schedules", () => {
    const { result } = renderHook(() => useSchedule());
    expect(result.current.schedules).toEqual([]);
  });

  it("should add a new schedule", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Test Task",
        mode: "task",
        dueDate: new Date("2025-01-01"),
        tags: [],
      });
    });

    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.schedules[0].title).toBe("Test Task");
    expect(result.current.schedules[0].completed).toBe(false);
  });

  it("should toggle schedule completion", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Test Task",
        mode: "task",
        dueDate: new Date("2025-01-01"),
        tags: [],
      });
    });

    const scheduleId = result.current.schedules[0].id;

    act(() => {
      result.current.toggleComplete(scheduleId);
    });

    expect(result.current.schedules[0].completed).toBe(true);

    act(() => {
      result.current.toggleComplete(scheduleId);
    });

    expect(result.current.schedules[0].completed).toBe(false);
  });

  it("should delete a schedule", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Test Task",
        mode: "task",
        dueDate: new Date("2025-01-01"),
        tags: [],
      });
    });

    const scheduleId = result.current.schedules[0].id;

    act(() => {
      result.current.deleteSchedule(scheduleId);
    });

    expect(result.current.schedules).toHaveLength(0);
  });

  it("should expand finite recurrence into multiple schedules", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "反復タスク",
        mode: "task",
        dueDate: new Date("2025-01-06T09:00:00.000Z"),
        tags: [],
        recurrence: {
          weekdays: [1, 3],
          count: 4,
        },
      });
    });

    expect(result.current.schedules).toHaveLength(4);
    expect(result.current.schedules.every((item) => item.recurrence?.seriesId)).toBe(true);
  });

  it("should expand infinite recurrence up to horizon", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "永続タスク",
        mode: "task",
        dueDate: new Date("2025-01-06T09:00:00.000Z"),
        tags: [],
        recurrence: {
          weekdays: [1],
          isInfinite: true,
        },
      });
    });

    expect(result.current.schedules.length).toBeGreaterThan(8);
    expect(result.current.schedules.every((item) => item.recurrence?.isInfinite)).toBe(true);
  });

  it("should delete recurrence items by scope", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "削除スコープ確認",
        mode: "task",
        dueDate: new Date("2025-01-06T09:00:00.000Z"),
        tags: [],
        recurrence: {
          weekdays: [1, 3, 5],
          count: 5,
        },
      });
    });

    const allSeries = result.current.schedules;
    expect(allSeries).toHaveLength(5);

    const third = allSeries[2];
    act(() => {
      result.current.deleteSchedule(third.id, "future");
    });
    expect(result.current.schedules).toHaveLength(2);

    const firstRemaining = result.current.schedules[0];
    act(() => {
      result.current.deleteSchedule(firstRemaining.id, "all");
    });
    expect(result.current.schedules).toHaveLength(0);
  });

  it("should update recurrence series by scope", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "更新スコープ確認",
        mode: "task",
        dueDate: new Date("2025-01-06T09:00:00.000Z"),
        tags: [],
        recurrence: {
          weekdays: [1, 3],
          count: 4,
        },
      });
    });

    const initial = result.current.schedules;
    expect(initial).toHaveLength(4);

    act(() => {
      result.current.updateSchedule(initial[1].id, { title: "部分更新" }, "future");
    });

    const titlesAfterFuture = result.current.schedules
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .map((item) => item.title);
    expect(titlesAfterFuture[0]).toBe("更新スコープ確認");
    expect(titlesAfterFuture.slice(1).every((title) => title === "部分更新")).toBe(true);

    act(() => {
      result.current.updateSchedule(result.current.schedules[0].id, { title: "全体更新" }, "all");
    });

    expect(result.current.schedules.every((item) => item.title === "全体更新")).toBe(true);
  });

  it("should update a schedule", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Test Task",
        mode: "task",
        dueDate: new Date("2025-01-01"),
        tags: [],
      });
    });

    const scheduleId = result.current.schedules[0].id;

    act(() => {
      result.current.updateSchedule(scheduleId, {
        title: "Updated Task",
        notes: "New notes",
      });
    });

    expect(result.current.schedules[0].title).toBe("Updated Task");
    expect(result.current.schedules[0].notes).toBe("New notes");
  });

  it("should get upcoming schedules", () => {
    const { result } = renderHook(() => useSchedule());
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 8);

    act(() => {
      result.current.addSchedule({
        title: "Tomorrow Task",
        mode: "task",
        dueDate: tomorrow,
        tags: [],
      });
    });

    act(() => {
      result.current.addSchedule({
        title: "Next Week Task",
        mode: "task",
        dueDate: nextWeek,
        tags: [],
      });
    });

    const upcoming = result.current.getUpcoming(7);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].title).toBe("Tomorrow Task");
  });

  it("should get overdue schedules", () => {
    const { result } = renderHook(() => useSchedule());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    act(() => {
      result.current.addSchedule({
        title: "Overdue Task",
        mode: "task",
        dueDate: yesterday,
        tags: [],
      });
    });

    const overdue = result.current.getOverdue();
    expect(overdue).toHaveLength(1);
    expect(overdue[0].title).toBe("Overdue Task");
  });

  it("should treat overdue as date-based and exclude today's tasks", () => {
    mockNow("2025-01-10T12:00:00.000Z");
    const { result } = renderHook(() => useSchedule());

    const yesterday = new Date(2025, 0, 9, 9, 0, 0, 0);
    const todayPast = new Date(2025, 0, 10, 9, 0, 0, 0);
    const todayFuture = new Date(2025, 0, 10, 15, 0, 0, 0);

    act(() => {
      result.current.addSchedule({
        title: "Yesterday Task",
        mode: "task",
        dueDate: yesterday,
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Past Task",
        mode: "task",
        dueDate: todayPast,
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Future Task",
        mode: "task",
        dueDate: todayFuture,
        tags: [],
      });
    });

    const overdue = result.current.getOverdue();
    expect(overdue.map((item) => item.title)).toEqual(["Yesterday Task"]);
  });

  it("should mark overdue dates only for tasks before today", () => {
    mockNow("2025-01-10T12:00:00.000Z");
    const { result } = renderHook(() => useSchedule());

    const yesterdayTaskDate = new Date(2025, 0, 9, 9, 0, 0, 0);
    const todayTaskDate = new Date(2025, 0, 10, 9, 0, 0, 0);
    const todayScheduleStart = new Date(2025, 0, 10, 8, 0, 0, 0);
    const todayScheduleEnd = new Date(2025, 0, 10, 10, 0, 0, 0);

    act(() => {
      result.current.addSchedule({
        title: "Yesterday Task",
        mode: "task",
        dueDate: yesterdayTaskDate,
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Task",
        mode: "task",
        dueDate: todayTaskDate,
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Schedule",
        mode: "schedule",
        dueDate: todayScheduleStart,
        endDate: todayScheduleEnd,
        tags: [],
      });
    });

    const datesMap = result.current.getDatesWithSchedules();
    expect(datesMap.get(dateKey(yesterdayTaskDate))?.hasOverdue).toBe(true);
    expect(datesMap.get(dateKey(todayTaskDate))?.hasOverdue).toBe(false);
  });

  it("should add a schedule with mode and endDate", () => {
    const { result } = renderHook(() => useSchedule());
    const startDate = new Date("2025-01-01");
    const endDate = new Date("2025-01-10");

    act(() => {
      result.current.addSchedule({
        title: "Test Schedule",
        mode: "schedule",
        dueDate: startDate,
        endDate: endDate,
        tags: [],
      });
    });

    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.schedules[0].mode).toBe("schedule");
    expect(result.current.schedules[0].endDate).toEqual(endDate);
  });

  it("should persist reminder offsets and all-day reminder time", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Reminder Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-10T00:00:00.000Z"),
        endDate: new Date("2025-01-10T23:59:59.999Z"),
        isAllDay: true,
        reminderOffsetsMinutes: [10, 60, 60, 1440],
        allDayReminderTime: "08:45",
        tags: [],
      });
    });

    expect(result.current.schedules).toHaveLength(1);
    expect(result.current.schedules[0].reminderOffsetsMinutes).toEqual([10, 60, 1440]);
    expect(result.current.schedules[0].allDayReminderTime).toBe("08:45");
  });

  it("should update schedule mode from task to schedule", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Test Item",
        mode: "task",
        dueDate: new Date("2025-01-01"),
        tags: [],
      });
    });

    const scheduleId = result.current.schedules[0].id;
    const endDate = new Date("2025-01-10");

    act(() => {
      result.current.updateSchedule(scheduleId, {
        mode: "schedule",
        endDate: endDate,
      });
    });

    expect(result.current.schedules[0].mode).toBe("schedule");
    expect(result.current.schedules[0].endDate).toEqual(endDate);
  });

  it("should clear endDate when switching from schedule to task mode", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Test Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-01"),
        endDate: new Date("2025-01-10"),
        tags: [],
      });
    });

    const scheduleId = result.current.schedules[0].id;

    act(() => {
      result.current.updateSchedule(scheduleId, {
        mode: "task",
        endDate: undefined,
      });
    });

    expect(result.current.schedules[0].mode).toBe("task");
    expect(result.current.schedules[0].endDate).toBeUndefined();
  });

  it("should return schedules spanning multiple days when querying any day in range", () => {
    const { result } = renderHook(() => useSchedule());
    const startDate = new Date("2025-01-05");
    const endDate = new Date("2025-01-10");

    act(() => {
      result.current.addSchedule({
        title: "Multi-day Schedule",
        mode: "schedule",
        dueDate: startDate,
        endDate: endDate,
        tags: [],
      });
    });

    // Query on start date
    const onStart = result.current.getSchedulesByDate(new Date("2025-01-05"));
    expect(onStart).toHaveLength(1);
    expect(onStart[0].title).toBe("Multi-day Schedule");

    // Query on middle date
    const onMiddle = result.current.getSchedulesByDate(new Date("2025-01-07"));
    expect(onMiddle).toHaveLength(1);
    expect(onMiddle[0].title).toBe("Multi-day Schedule");

    // Query on end date
    const onEnd = result.current.getSchedulesByDate(new Date("2025-01-10"));
    expect(onEnd).toHaveLength(1);
    expect(onEnd[0].title).toBe("Multi-day Schedule");

    // Query before range
    const before = result.current.getSchedulesByDate(new Date("2025-01-04"));
    expect(before).toHaveLength(0);

    // Query after range
    const after = result.current.getSchedulesByDate(new Date("2025-01-11"));
    expect(after).toHaveLength(0);
  });

  it("should include all days of multi-day schedule in getDatesWithSchedules", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "5-day Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-05"),
        endDate: new Date("2025-01-09"),
        tags: [],
      });
    });

    const datesMap = result.current.getDatesWithSchedules();

    // Should have entries for all 5 days
    expect(datesMap.has("2025-01-05")).toBe(true);
    expect(datesMap.has("2025-01-06")).toBe(true);
    expect(datesMap.has("2025-01-07")).toBe(true);
    expect(datesMap.has("2025-01-08")).toBe(true);
    expect(datesMap.has("2025-01-09")).toBe(true);

    // Should not have entries for days outside range
    expect(datesMap.has("2025-01-04")).toBe(false);
    expect(datesMap.has("2025-01-10")).toBe(false);

    // Each day should show count of 1
    expect(datesMap.get("2025-01-05")?.count).toBe(1);
    expect(datesMap.get("2025-01-07")?.count).toBe(1);
  });

  it("should calculate correct day of schedule using getDayOfSchedule", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "3-day Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-05"),
        endDate: new Date("2025-01-07"),
        tags: [],
      });
    });

    const schedule = result.current.schedules[0];

    // Day 1
    const day1 = result.current.getDayOfSchedule(schedule, new Date("2025-01-05"));
    expect(day1).toEqual({ day: 1, total: 3 });

    // Day 2
    const day2 = result.current.getDayOfSchedule(schedule, new Date("2025-01-06"));
    expect(day2).toEqual({ day: 2, total: 3 });

    // Day 3
    const day3 = result.current.getDayOfSchedule(schedule, new Date("2025-01-07"));
    expect(day3).toEqual({ day: 3, total: 3 });
  });

  it("should return null for single-day schedule in getDayOfSchedule", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Single-day Schedule",
        mode: "task",
        dueDate: new Date("2025-01-05"),
        tags: [],
      });
    });

    const schedule = result.current.schedules[0];
    const dayIndicator = result.current.getDayOfSchedule(schedule, new Date("2025-01-05"));

    expect(dayIndicator).toBeNull();
  });

  it("should normalize legacy tag priorities when loading from storage", () => {
    localStorage.setItem(
      "grass-secretary-schedules",
      JSON.stringify([
        {
          id: "schedule-legacy-1",
          title: "Legacy Priority Task",
          mode: "task",
          dueDate: "2025-01-02T09:00:00.000Z",
          completed: false,
          tags: [
            {
              id: "tag-1",
              name: "重要",
              color: "#EF4444",
              createdAt: "2025-01-01T00:00:00.000Z",
            },
            {
              id: "tag-2",
              name: "通常",
              color: "#3B82F6",
              createdAt: "2025-01-01T00:00:00.000Z",
            },
          ],
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ]),
    );

    const { result } = renderHook(() => useSchedule());
    const tags = result.current.schedules[0].tags;

    expect(tags.find((tag) => tag.id === "tag-1")?.priority).toBe("high");
    expect(tags.find((tag) => tag.id === "tag-2")?.priority).toBe("medium");
  });

  it("should migrate legacy important category to high-priority tag", () => {
    localStorage.setItem(
      "grass-secretary-schedules",
      JSON.stringify([
        {
          id: "schedule-legacy-2",
          title: "Legacy Important Category",
          dueDate: "2025-01-03T09:00:00.000Z",
          completed: false,
          category: "important",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ]),
    );

    const { result } = renderHook(() => useSchedule());
    const [migrated] = result.current.schedules;

    expect(migrated.mode).toBe("task");
    expect(migrated.tags).toHaveLength(1);
    expect(migrated.tags[0].id).toBe("tag-1");
    expect(migrated.tags[0].priority).toBe("high");
  });

  it("should hide today's task after due time in upcoming list", () => {
    mockNow("2025-01-10T12:00:00.000Z");
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Today Past Task",
        mode: "task",
        dueDate: new Date("2025-01-10T09:00:00.000Z"),
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Future Task",
        mode: "task",
        dueDate: new Date("2025-01-10T15:00:00.000Z"),
        tags: [],
      });
    });

    const upcoming = result.current.getUpcoming(1);
    expect(upcoming.map((item) => item.title)).toEqual(["Today Future Task"]);
  });

  it("should hide today's schedule only after endDate when endDate exists", () => {
    mockNow("2025-01-10T12:00:00.000Z");
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Schedule In Progress",
        mode: "schedule",
        dueDate: new Date("2025-01-10T09:00:00.000Z"),
        endDate: new Date("2025-01-10T13:00:00.000Z"),
        tags: [],
      });
      result.current.addSchedule({
        title: "Schedule Ended",
        mode: "schedule",
        dueDate: new Date("2025-01-10T09:00:00.000Z"),
        endDate: new Date("2025-01-10T11:00:00.000Z"),
        tags: [],
      });
    });

    const upcoming = result.current.getUpcoming(1);
    expect(upcoming.map((item) => item.title)).toEqual(["Schedule In Progress"]);
  });

  it("should hide time-passed items only for today in getSchedulesByDate", () => {
    mockNow("2025-01-10T12:00:00.000Z");
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Today Past Task",
        mode: "task",
        dueDate: new Date("2025-01-10T09:00:00.000Z"),
        tags: [],
      });
      result.current.addSchedule({
        title: "Tomorrow Task",
        mode: "task",
        dueDate: new Date("2025-01-11T09:00:00.000Z"),
        tags: [],
      });
    });

    const todayItems = result.current.getSchedulesByDate(new Date("2025-01-10T00:00:00.000Z"));
    const tomorrowItems = result.current.getSchedulesByDate(new Date("2025-01-11T00:00:00.000Z"));

    expect(todayItems).toHaveLength(0);
    expect(tomorrowItems.map((item) => item.title)).toEqual(["Tomorrow Task"]);
  });

  it("should keep today's all-day schedule visible in upcoming list even after current time", () => {
    mockNow("2025-01-10T20:00:00.000Z");
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Today All-Day Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-10T00:00:00.000Z"),
        endDate: new Date("2025-01-10T23:59:59.999Z"),
        isAllDay: true,
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Timed Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-10T09:00:00.000Z"),
        endDate: new Date("2025-01-10T10:00:00.000Z"),
        tags: [],
      });
    });

    const upcoming = result.current.getUpcoming(1);
    expect(upcoming.map((item) => item.title)).toEqual(["Today All-Day Schedule"]);
  });

  it("should keep today's all-day schedule visible in getSchedulesByDate", () => {
    mockNow("2025-01-10T12:00:00.000Z");
    const { result } = renderHook(() => useSchedule());
    const now = new Date();
    const allDayStart = new Date(now);
    allDayStart.setHours(0, 0, 0, 0);
    const allDayEnd = new Date(now);
    allDayEnd.setHours(23, 59, 59, 999);
    const pastTaskDue = new Date(now);
    pastTaskDue.setHours(9, 0, 0, 0);

    act(() => {
      result.current.addSchedule({
        title: "Today All-Day Schedule",
        mode: "schedule",
        dueDate: allDayStart,
        endDate: allDayEnd,
        isAllDay: true,
        tags: [],
      });
      result.current.addSchedule({
        title: "Today Past Task",
        mode: "task",
        dueDate: pastTaskDue,
        tags: [],
      });
    });

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const todayItems = result.current.getSchedulesByDate(today);
    expect(todayItems.map((item) => item.title)).toEqual(["Today All-Day Schedule"]);
  });

  it("should expose all-day calendar event metadata", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "All-Day Conference",
        mode: "schedule",
        dueDate: new Date("2025-01-10T00:00:00.000Z"),
        endDate: new Date("2025-01-10T23:59:59.999Z"),
        isAllDay: true,
        tags: [],
      });
    });

    const events = result.current.getCalendarEventsByDate().get("2025-01-10");
    expect(events).toBeDefined();
    expect(events?.[0].isAllDay).toBe(true);
    expect(events?.[0].time).toBe("");
  });

  it("should prioritize schedules and multi-day schedules in calendar event order", () => {
    const { result } = renderHook(() => useSchedule());

    act(() => {
      result.current.addSchedule({
        title: "Task A",
        mode: "task",
        dueDate: new Date("2025-01-10T09:00:00.000Z"),
        tags: [],
      });
      result.current.addSchedule({
        title: "Single-day Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-10T10:00:00.000Z"),
        tags: [],
      });
      result.current.addSchedule({
        title: "Multi-day Schedule",
        mode: "schedule",
        dueDate: new Date("2025-01-09T10:00:00.000Z"),
        endDate: new Date("2025-01-11T10:00:00.000Z"),
        tags: [],
      });
    });

    const events = result.current.getCalendarEventsByDate().get("2025-01-10");
    expect(events).toBeDefined();
    expect(events?.map((event) => event.title)).toEqual([
      "Multi-day Schedule",
      "Single-day Schedule",
      "Task A",
    ]);
  });

  it("should distinguish ownership colors for owner access", () => {
    const { result } = renderHook(() => useSchedule());

    const ownDueDate = new Date(2025, 0, 10, 9, 0, 0, 0);
    const memberDueDate = new Date(2025, 0, 10, 10, 0, 0, 0);

    act(() => {
      result.current.addSchedule({
        title: "Owner Event",
        mode: "task",
        dueDate: ownDueDate,
        tags: [],
        ownerId: "owner-local",
        ownerDisplayName: "あなた",
      });
      result.current.addSchedule({
        title: "Member Event",
        mode: "task",
        dueDate: memberDueDate,
        tags: [],
        ownerId: "member-1",
        ownerDisplayName: "Member",
      });
    });

    const ownerAccess = resolveAccessContextForMember("OWNER", "owner-local", "owner-local");
    const events = result.current
      .getCalendarEventsByDateWithAccess(ownerAccess)
      .get(dateKey(ownDueDate));

    expect(events).toBeDefined();
    const ownerEvent = events?.find((event) => event.title === "Owner Event");
    const memberEvent = events?.find((event) => event.title === "Member Event");

    expect(ownerEvent?.isOwnedByViewer).toBe(true);
    expect(memberEvent?.isOwnedByViewer).toBe(false);
    expect(ownerEvent?.color).toBe("#22C55E");
    expect(memberEvent?.color).toBe("#8B5CF6");
  });
});
