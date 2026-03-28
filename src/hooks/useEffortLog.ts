import { useCallback, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { EffortLog, EffortActivity, EffortCategory, EffortDailySummary } from "@/types";

const ALL_CATEGORIES: EffortCategory[] = [
  "ai_chat",
  "schedule_create",
  "task_complete",
  "photo_check",
];

interface UseEffortLogReturn {
  logs: EffortLog[];
  addActivity: (
    activity: Omit<EffortActivity, "id" | "timestamp" | "score"> & { score?: number },
  ) => void;
  getLogForDate: (date: string) => EffortLog | undefined;
  getLast365Days: () => EffortLog[];
  getAllDays: () => EffortLog[];
  getTotalCount: () => number;
  getTotalScore: () => number;
  getCurrentStreak: () => number;
  getDailySummaries: () => EffortDailySummary[];
  getAllDailySummaries: () => EffortDailySummary[];
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getLast365DaysDates(): string[] {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 364);
  return getDatesInRange(start, end);
}

function getDatesInRange(start: Date, end: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endAt = new Date(end);
  endAt.setHours(0, 0, 0, 0);

  while (cursor <= endAt) {
    const date = new Date(cursor);
    dates.push(formatDate(date));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

function getAllDaysDates(logs: EffortLog[]): string[] {
  if (logs.length === 0) {
    return [formatDate(new Date())];
  }

  let oldest = new Date(logs[0].date);
  for (const log of logs) {
    const logDate = new Date(log.date);
    if (logDate < oldest) {
      oldest = logDate;
    }
  }

  const today = new Date();
  oldest.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);

  if (oldest > today) {
    return [formatDate(today)];
  }

  return getDatesInRange(oldest, today);
}

function mapDatesToLogs(dates: string[], logs: EffortLog[]): EffortLog[] {
  const logsMap = new Map(logs.map((log) => [log.date, log]));
  return dates.map(
    (date) =>
      logsMap.get(date) || {
        date,
        count: 0,
        activities: [],
      },
  );
}

function getLast365DaysFromLogs(logs: EffortLog[]): EffortLog[] {
  return mapDatesToLogs(getLast365DaysDates(), logs);
}

function getAllDaysFromLogs(logs: EffortLog[]): EffortLog[] {
  return mapDatesToLogs(getAllDaysDates(logs), logs);
}

function normalizeLogs(rawLogs: EffortLog[]): EffortLog[] {
  const normalized = rawLogs.map(normalizeLog);
  normalized.sort((a, b) => a.date.localeCompare(b.date));
  return normalized;
}

function createActivityScore(activity: EffortActivity): number {
  void activity;
  return 1;
}

function calculateTotalScore(logs: EffortLog[]): number {
  return logs.reduce(
    (sum, log) =>
      sum +
      log.activities.reduce(
        (activitySum, activity) => activitySum + createActivityScore(activity),
        0,
      ),
    0,
  );
}

function getCurrentStreakFromLogs(logs: EffortLog[]): number {
  const today = new Date();
  let streak = 0;

  for (let i = 0; i <= 365; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dateStr = formatDate(checkDate);

    const log = logs.find((l) => l.date === dateStr);
    if (log && log.count > 0) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  return streak;
}

function isEffortCategory(value: unknown): value is EffortCategory {
  return typeof value === "string" && ALL_CATEGORIES.includes(value as EffortCategory);
}

function toDateValue(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function normalizeActivity(raw: EffortActivity): EffortActivity {
  const type = isEffortCategory(raw.type) ? raw.type : "ai_chat";
  return {
    ...raw,
    type,
    score: 1,
    timestamp: toDateValue(raw.timestamp),
  };
}

function normalizeLog(rawLog: EffortLog): EffortLog {
  const activities = rawLog.activities.map(normalizeActivity);
  return {
    date: rawLog.date,
    count: activities.length,
    activities,
  };
}

function createEmptySummary(date: string): EffortDailySummary {
  const categoryCounts = Object.fromEntries(
    ALL_CATEGORIES.map((category) => [category, 0]),
  ) as Record<EffortCategory, number>;
  const categoryScores = Object.fromEntries(
    ALL_CATEGORIES.map((category) => [category, 0]),
  ) as Record<EffortCategory, number>;

  return {
    date,
    totalCount: 0,
    totalScore: 0,
    categoryCounts,
    categoryScores,
    activities: [],
  };
}

function toDailySummary(log: EffortLog): EffortDailySummary {
  const summary = createEmptySummary(log.date);
  summary.activities = log.activities;

  for (const activity of log.activities) {
    const score = createActivityScore(activity);
    summary.totalCount += 1;
    summary.totalScore += score;
    summary.categoryCounts[activity.type] += 1;
    summary.categoryScores[activity.type] += score;
  }

  return summary;
}

export function useEffortLog(): UseEffortLogReturn {
  const [rawLogs, setLogs] = useLocalStorage<EffortLog[]>("grass-secretary-effort-logs", []);
  const logs = useMemo(() => normalizeLogs(rawLogs), [rawLogs]);

  const addActivity = useCallback(
    (activity: Omit<EffortActivity, "id" | "timestamp" | "score"> & { score?: number }) => {
      const today = formatDate(new Date());
      const normalizedType = isEffortCategory(activity.type) ? activity.type : "ai_chat";
      const newActivity: EffortActivity = {
        ...activity,
        type: normalizedType,
        id: `activity-${Date.now()}`,
        timestamp: new Date(),
        score: 1,
      };

      setLogs((prev) => {
        const normalizedPrev = normalizeLogs(prev);
        const existingLogIndex = normalizedPrev.findIndex((log) => log.date === today);
        const hasSameTaskCompletionAlready = normalizedPrev.some((log) =>
          log.activities.some(
            (entry) =>
              entry.type === "task_complete" &&
              entry.metadata?.scheduleId &&
              entry.metadata.scheduleId === activity.metadata?.scheduleId,
          ),
        );

        if (normalizedType === "task_complete" && hasSameTaskCompletionAlready) {
          return normalizedPrev;
        }

        if (existingLogIndex >= 0) {
          const updated = [...normalizedPrev];
          updated[existingLogIndex] = {
            ...updated[existingLogIndex],
            activities: [...updated[existingLogIndex].activities, newActivity],
            count: updated[existingLogIndex].activities.length + 1,
          };
          return updated;
        }

        return [
          ...normalizedPrev,
          {
            date: today,
            count: 1,
            activities: [newActivity],
          },
        ];
      });
    },
    [setLogs],
  );

  const getLogForDate = useCallback(
    (date: string) => logs.find((log) => log.date === date),
    [logs],
  );

  const getLast365Days = useMemo(() => {
    return () => getLast365DaysFromLogs(logs);
  }, [logs]);

  const getAllDays = useMemo(() => {
    return () => getAllDaysFromLogs(logs);
  }, [logs]);

  const getTotalCount = useCallback(() => logs.reduce((sum, log) => sum + log.count, 0), [logs]);

  const getTotalScore = useCallback(() => calculateTotalScore(logs), [logs]);

  const getDailySummaries = useMemo(() => {
    return () => getLast365Days().map(toDailySummary);
  }, [getLast365Days]);

  const getAllDailySummaries = useMemo(() => {
    return () => getAllDays().map(toDailySummary);
  }, [getAllDays]);

  const getCurrentStreak = useCallback(() => {
    return getCurrentStreakFromLogs(logs);
  }, [logs]);

  return {
    logs,
    addActivity,
    getLogForDate,
    getLast365Days,
    getAllDays,
    getTotalCount,
    getTotalScore,
    getCurrentStreak,
    getDailySummaries,
    getAllDailySummaries,
  };
}
