import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useEffortLog } from "@/hooks/useEffortLog";

function formatLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("useEffortLog", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should start with empty logs", () => {
    const { result } = renderHook(() => useEffortLog());
    expect(result.current.logs).toEqual([]);
  });

  it("should add an activity", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Test activity",
      });
    });

    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0].count).toBe(1);
    expect(result.current.logs[0].activities[0].description).toBe("Test activity");
  });

  it("should increment count for same day activities", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "First activity",
      });
    });

    act(() => {
      result.current.addActivity({
        type: "task_complete",
        description: "Second activity",
      });
    });

    expect(result.current.logs).toHaveLength(1);
    expect(result.current.logs[0].count).toBe(2);
    expect(result.current.logs[0].activities).toHaveLength(2);
  });

  it("should calculate total count", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Activity 1",
      });
    });

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Activity 2",
      });
    });

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Activity 3",
      });
    });

    expect(result.current.getTotalCount()).toBe(3);
  });

  it("should use score 1 for all activity categories", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "ai chat",
      });
      result.current.addActivity({
        type: "schedule_create",
        description: "schedule create",
      });
      result.current.addActivity({
        type: "photo_check",
        description: "photo check",
      });
    });

    expect(result.current.getTotalScore()).toBe(3);
    const today = formatLocalDateKey(new Date());
    const summary = result.current.getAllDailySummaries().find((day) => day.date === today);
    expect(summary?.categoryScores.ai_chat).toBe(1);
    expect(summary?.categoryScores.schedule_create).toBe(1);
    expect(summary?.categoryScores.photo_check).toBe(1);
  });

  it("should get log for specific date", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Today's activity",
      });
    });

    const today = formatLocalDateKey(new Date());
    const log = result.current.getLogForDate(today);

    expect(log).toBeDefined();
    expect(log?.count).toBe(1);
  });

  it("should return undefined for date with no log", () => {
    const { result } = renderHook(() => useEffortLog());
    const log = result.current.getLogForDate("2020-01-01");
    expect(log).toBeUndefined();
  });

  it("should get last 365 days", () => {
    const { result } = renderHook(() => useEffortLog());
    const last365 = result.current.getLast365Days();
    expect(last365).toHaveLength(365);
  });

  it("should calculate current streak", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Today's activity",
      });
    });

    const streak = result.current.getCurrentStreak();
    expect(streak).toBeGreaterThanOrEqual(1);
  });

  it("should record activity under local today key for realtime same-day updates", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "ai_chat",
        description: "Local today update",
      });
    });

    const localToday = formatLocalDateKey(new Date());
    const summary = result.current.getAllDailySummaries().find((day) => day.date === localToday);

    expect(summary).toBeDefined();
    expect(summary?.totalCount).toBeGreaterThanOrEqual(1);
  });

  it("should record each task completion score only once per schedule", () => {
    const { result } = renderHook(() => useEffortLog());

    act(() => {
      result.current.addActivity({
        type: "task_complete",
        description: "Task done",
        metadata: { scheduleId: "task-1", scheduleMode: "task", tags: ["重要"] },
      });
    });

    act(() => {
      result.current.addActivity({
        type: "task_complete",
        description: "Task done again",
        metadata: { scheduleId: "task-1", scheduleMode: "task", tags: ["重要"] },
      });
    });

    const today = formatLocalDateKey(new Date());
    const summary = result.current.getAllDailySummaries().find((day) => day.date === today);
    const taskCompletions =
      summary?.activities.filter(
        (activity) =>
          activity.type === "task_complete" && activity.metadata?.scheduleId === "task-1",
      ) ?? [];
    expect(taskCompletions).toHaveLength(1);
    expect(result.current.getTotalScore()).toBe(1);
  });
});
