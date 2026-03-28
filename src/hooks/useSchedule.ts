import { useCallback, useEffect, useMemo } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type {
  CalendarAccessContext,
  CalendarEvent,
  ScheduleItem,
  ScheduleMutationScope,
  ScheduleRecurrenceInput,
  ScheduleVisibilityView,
  Tag,
} from "@/types";
import { buildScheduleVisibilityView, maskScheduleForViewer } from "@/lib/calendarPermissions";
import { resolveTagPriority } from "@/lib/tagPriority";
import { buildRecurringScheduleItems, normalizeRecurrenceInput } from "@/lib/scheduleRecurrence";
import {
  DEFAULT_ALL_DAY_REMINDER_TIME,
  DEFAULT_REMINDER_OFFSETS_MINUTES,
  normalizeAllDayReminderTime,
  normalizeReminderOffsets,
} from "@/lib/scheduleReminders";

const INFINITE_RECURRENCE_HORIZON_DAYS = 365;

interface UseScheduleReturn {
  schedules: ScheduleItem[];
  addSchedule: (item: Omit<ScheduleItem, "id" | "completed" | "createdAt">) => void;
  updateSchedule: (
    id: string,
    updates: Omit<Partial<ScheduleItem>, "recurrence"> & {
      recurrence?: ScheduleRecurrenceInput | ScheduleItem["recurrence"] | null;
    },
    scope?: ScheduleMutationScope,
  ) => void;
  deleteSchedule: (id: string, scope?: ScheduleMutationScope) => void;
  toggleComplete: (id: string) => void;
  getUpcoming: (days?: number) => ScheduleItem[];
  getOverdue: () => ScheduleItem[];
  getSchedulesByDate: (date: Date) => ScheduleItem[];
  getDatesWithSchedules: () => Map<string, { count: number; hasOverdue: boolean }>;
  getCalendarEventsByDate: () => Map<string, CalendarEvent[]>;
  getScheduleVisibilityView: (
    date: Date,
    access: CalendarAccessContext,
  ) => ScheduleVisibilityView[];
  getCalendarEventsByDateWithAccess: (
    access: CalendarAccessContext,
  ) => Map<string, CalendarEvent[]>;
  getDayOfSchedule: (
    scheduleItem: ScheduleItem,
    viewDate: Date,
  ) => { day: number; total: number } | null;
}

function normalizeTag(tag: Tag): Tag {
  const createdAtValue = (tag as Partial<Tag>).createdAt;
  return {
    ...tag,
    priority: resolveTagPriority(tag),
    createdAt:
      createdAtValue instanceof Date
        ? createdAtValue
        : createdAtValue
          ? new Date(createdAtValue)
          : new Date(),
  };
}

function normalizeDateFields(item: ScheduleItem): ScheduleItem {
  const isAllDay = item.mode === "schedule" ? Boolean(item.isAllDay) : undefined;
  const recurrence = normalizeRecurrenceInput(item.recurrence);
  const reminderOffsetsMinutes = normalizeReminderOffsets(item.reminderOffsetsMinutes);
  const allDayReminderTime =
    item.mode === "schedule" && isAllDay
      ? normalizeAllDayReminderTime(item.allDayReminderTime)
      : undefined;
  return {
    ...item,
    mode: item.mode || "task",
    dueDate: item.dueDate instanceof Date ? item.dueDate : new Date(item.dueDate),
    endDate: item.endDate
      ? item.endDate instanceof Date
        ? item.endDate
        : new Date(item.endDate)
      : undefined,
    isAllDay,
    isPrivate: Boolean(item.isPrivate),
    ownerId: item.ownerId || "owner-local",
    ownerDisplayName: item.ownerDisplayName || "あなた",
    recurrence: recurrence
      ? {
          ...recurrence,
          ...(item.recurrence?.seriesId ? { seriesId: item.recurrence.seriesId } : {}),
          ...(typeof item.recurrence?.occurrenceIndex === "number"
            ? { occurrenceIndex: item.recurrence.occurrenceIndex }
            : {}),
        }
      : undefined,
    reminderOffsetsMinutes,
    allDayReminderTime,
    tags: Array.isArray(item.tags) ? item.tags.map(normalizeTag) : [],
    createdAt: item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt),
  };
}

function getScopeTargets(
  schedules: ScheduleItem[],
  target: ScheduleItem,
  scope: ScheduleMutationScope,
): ScheduleItem[] {
  const seriesId = target.recurrence?.seriesId;
  if (!seriesId) {
    return [target];
  }
  const sameSeries = schedules.filter((item) => item.recurrence?.seriesId === seriesId);
  if (scope === "all") {
    return sameSeries;
  }
  if (scope === "future") {
    const targetDue = new Date(target.dueDate).getTime();
    return sameSeries.filter((item) => new Date(item.dueDate).getTime() >= targetDue);
  }
  return [target];
}

function sortSchedulesByDueDate(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

function getCalendarEdgeColor(item: ScheduleItem): string | undefined {
  const importantTag = item.tags?.find((tag) => tag.id === "tag-1");
  if (importantTag) return importantTag.color;
  if (item.tags && item.tags.length > 0) return item.tags[0].color;
  if (item.color) return item.color;
  return item.mode === "task" ? "oklch(0.55 0.15 250)" : "oklch(0.60 0.18 160)";
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isPastDisplayTimeForToday(item: ScheduleItem, now: Date): boolean {
  if (item.mode === "schedule" && item.isAllDay) {
    return false;
  }

  if (item.mode === "schedule" && item.endDate) {
    const endDate = new Date(item.endDate);
    return isSameDate(endDate, now) && now.getTime() > endDate.getTime();
  }

  const dueDate = new Date(item.dueDate);
  return isSameDate(dueDate, now) && now.getTime() > dueDate.getTime();
}

export function useSchedule(): UseScheduleReturn {
  const [schedules, setSchedules] = useLocalStorage<ScheduleItem[]>(
    "grass-secretary-schedules",
    [],
  );

  // Migrate old schedules with category to new format with tags and normalize dates
  useEffect(() => {
    setSchedules((prev) => {
      const migrated = prev.map((item) => {
        const hasExistingTags = Array.isArray((item as Partial<ScheduleItem>).tags);
        // Normalize date fields first (convert strings to Date objects)
        const normalized = normalizeDateFields(item);

        // If already has tags array, return normalized version
        if (hasExistingTags) {
          return {
            ...normalized,
            tags: normalized.tags.map(normalizeTag),
          };
        }

        // Migrate old category format to tags
        const tags: Tag[] = [];
        const category = (item as any).category;
        if (category === "important") {
          tags.push({
            id: "tag-1",
            name: "重要",
            color: "#EF4444",
            priority: "high",
            createdAt: new Date(),
          });
        }
        return {
          ...normalized,
          tags,
        };
      });

      // Only update if changes were made
      if (JSON.stringify(prev) !== JSON.stringify(migrated)) {
        return migrated;
      }
      return prev;
    });
  }, []);

  // Ensure all schedules have normalized date fields
  const normalizedSchedules = useMemo(() => schedules.map(normalizeDateFields), [schedules]);

  const addSchedule = useCallback(
    (item: Omit<ScheduleItem, "id" | "completed" | "createdAt">) => {
      const normalizedReminderOffsets = normalizeReminderOffsets(item.reminderOffsetsMinutes);
      const reminderOffsetsMinutes =
        item.reminderOffsetsMinutes === undefined
          ? normalizedReminderOffsets.length > 0
            ? normalizedReminderOffsets
            : DEFAULT_REMINDER_OFFSETS_MINUTES
          : normalizedReminderOffsets;
      const recurringItems = buildRecurringScheduleItems({
        ...item,
        reminderOffsetsMinutes,
        allDayReminderTime:
          item.mode === "schedule" && item.isAllDay
            ? normalizeAllDayReminderTime(item.allDayReminderTime ?? DEFAULT_ALL_DAY_REMINDER_TIME)
            : undefined,
      });
      setSchedules((prev) => {
        const now = Date.now();
        const createdAt = new Date();
        const mapped = recurringItems.map((entry, index) => ({
          ...entry,
          id: `schedule-${now}-${index}`,
          completed: false,
          isPrivate: Boolean(entry.isPrivate),
          ownerId: entry.ownerId || "owner-local",
          ownerDisplayName: entry.ownerDisplayName || "あなた",
          createdAt,
        }));
        return [...prev, ...mapped];
      });
    },
    [setSchedules],
  );

  const updateSchedule = useCallback(
    (
      id: string,
      updates: Omit<Partial<ScheduleItem>, "recurrence"> & {
        recurrence?: ScheduleRecurrenceInput | ScheduleItem["recurrence"] | null;
      },
      scope: ScheduleMutationScope = "single",
    ) => {
      setSchedules((prev) => {
        const target = prev.find((item) => item.id === id);
        if (!target) {
          return prev;
        }
        const effectiveScope = target.recurrence?.seriesId ? scope : "single";
        const targets = getScopeTargets(prev, target, effectiveScope);

        const hasRecurrenceUpdate = Object.prototype.hasOwnProperty.call(updates, "recurrence");
        const nextRecurrence = hasRecurrenceUpdate
          ? updates.recurrence === null
            ? undefined
            : normalizeRecurrenceInput(
                (updates.recurrence ?? target.recurrence) as ScheduleRecurrenceInput,
              )
          : normalizeRecurrenceInput(target.recurrence);

        const mergedUpdates = {
          ...updates,
          ...(updates.isPrivate !== undefined ? { isPrivate: Boolean(updates.isPrivate) } : {}),
          ...(updates.ownerId ? { ownerId: updates.ownerId } : {}),
          ...(updates.ownerDisplayName ? { ownerDisplayName: updates.ownerDisplayName } : {}),
        };

        if (!target.recurrence?.seriesId || effectiveScope === "single") {
          const mergedSingle = normalizeDateFields({
            ...target,
            ...mergedUpdates,
            recurrence:
              updates.recurrence === null
                ? undefined
                : updates.recurrence !== undefined
                  ? updates.recurrence
                  : target.recurrence,
          } as ScheduleItem);
          return prev.map((item) =>
            item.id === id
              ? {
                  ...mergedSingle,
                  recurrence: nextRecurrence
                    ? {
                        ...nextRecurrence,
                        ...(target.recurrence?.seriesId
                          ? { seriesId: target.recurrence.seriesId }
                          : {}),
                        ...(typeof target.recurrence?.occurrenceIndex === "number"
                          ? { occurrenceIndex: target.recurrence.occurrenceIndex }
                          : {}),
                      }
                    : undefined,
                }
              : item,
          );
        }

        if (!nextRecurrence) {
          return prev.map((item) => {
            const isTarget = targets.some((targetItem) => targetItem.id === item.id);
            if (!isTarget) {
              return item;
            }
            const merged = normalizeDateFields({
              ...item,
              ...mergedUpdates,
              recurrence: undefined,
            } as ScheduleItem);
            return {
              ...merged,
              recurrence: undefined,
            };
          });
        }

        const updatesWithoutRecurrence = { ...mergedUpdates };
        delete updatesWithoutRecurrence.recurrence;
        const sortedTargets = sortSchedulesByDueDate(targets);
        const baseSeriesSource = sortedTargets[0] ?? target;
        const recurrenceForRebuild =
          effectiveScope === "future" &&
          !hasRecurrenceUpdate &&
          nextRecurrence &&
          !nextRecurrence.isInfinite
            ? {
                ...nextRecurrence,
                count: targets.length,
              }
            : nextRecurrence;
        const baseItem = normalizeDateFields({
          ...baseSeriesSource,
          ...updatesWithoutRecurrence,
          recurrence: recurrenceForRebuild,
        } as ScheduleItem);
        const seriesId = target.recurrence?.seriesId ?? baseItem.recurrence?.seriesId;
        const rebuiltSeries = buildRecurringScheduleItems(
          {
            ...baseItem,
            recurrence: recurrenceForRebuild,
          },
          { seriesId, infiniteHorizonDays: INFINITE_RECURRENCE_HORIZON_DAYS },
        );
        const retainFromSeries =
          effectiveScope === "future"
            ? sortSchedulesByDueDate(
                prev.filter(
                  (item) =>
                    item.recurrence?.seriesId === target.recurrence?.seriesId &&
                    !targets.some((targetItem) => targetItem.id === item.id),
                ),
              )
            : [];
        const otherSeries = prev.filter(
          (item) => item.recurrence?.seriesId !== target.recurrence?.seriesId,
        );
        const createdAt = baseSeriesSource.createdAt;
        const rebased = rebuiltSeries.map((entry, index) => ({
          ...entry,
          id: `schedule-${Date.now()}-${index}`,
          completed: false,
          isPrivate: Boolean(entry.isPrivate),
          ownerId: entry.ownerId || target.ownerId || "owner-local",
          ownerDisplayName: entry.ownerDisplayName || target.ownerDisplayName || "あなた",
          createdAt,
        }));
        return [...otherSeries, ...retainFromSeries, ...rebased];
      });
    },
    [setSchedules],
  );

  const deleteSchedule = useCallback(
    (id: string, scope: ScheduleMutationScope = "single") => {
      setSchedules((prev) => {
        const target = prev.find((item) => item.id === id);
        if (!target) {
          return prev;
        }
        const effectiveScope = target.recurrence?.seriesId ? scope : "single";
        if (effectiveScope === "single") {
          return prev.filter((item) => item.id !== id);
        }
        const targets = getScopeTargets(prev, target, effectiveScope);
        const targetIds = new Set(targets.map((item) => item.id));
        return prev.filter((item) => !targetIds.has(item.id));
      });
    },
    [setSchedules],
  );

  const toggleComplete = useCallback(
    (id: string) => {
      setSchedules((prev) =>
        prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item)),
      );
    },
    [setSchedules],
  );

  const getUpcoming = useCallback(
    (days = 7) => {
      const now = new Date();
      const today = new Date(now);
      today.setHours(0, 0, 0, 0);

      const futureDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);

      return normalizedSchedules
        .filter((item) => {
          if (isPastDisplayTimeForToday(item, now)) {
            return false;
          }

          const dueDate = new Date(item.dueDate);
          dueDate.setHours(0, 0, 0, 0);

          if (item.endDate) {
            const endDate = new Date(item.endDate);
            endDate.setHours(0, 0, 0, 0);
            return !item.completed && endDate >= today && dueDate <= futureDate;
          }

          return !item.completed && dueDate >= today && dueDate <= futureDate;
        })
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    },
    [normalizedSchedules],
  );

  const getOverdue = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return normalizedSchedules
      .filter((item) => {
        if (item.completed || item.mode !== "task") {
          return false;
        }
        const dueDate = new Date(item.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate < today;
      })
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [normalizedSchedules]);

  const getSchedulesByDate = useCallback(
    (date: Date) => {
      const now = new Date();
      const isTodayView = isSameDate(date, now);

      return normalizedSchedules.filter((item) => {
        const dueDate = new Date(item.dueDate);
        const endDate = item.endDate ? new Date(item.endDate) : dueDate;

        const checkDate = new Date(date);
        checkDate.setHours(0, 0, 0, 0);
        dueDate.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);

        const isInRange = checkDate >= dueDate && checkDate <= endDate;
        if (!isInRange) {
          return false;
        }

        if (isTodayView && isPastDisplayTimeForToday(item, now)) {
          return false;
        }

        return true;
      });
    },
    [normalizedSchedules],
  );

  const getDatesWithSchedules = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const map = new Map<string, { count: number; hasOverdue: boolean }>();

    for (const item of normalizedSchedules) {
      const dueDate = new Date(item.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      const endDate = item.endDate ? new Date(item.endDate) : dueDate;
      endDate.setHours(0, 0, 0, 0);

      // Generate all dates in range
      const currentDate = new Date(dueDate);
      while (currentDate <= endDate) {
        const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
        const existing = map.get(key) || { count: 0, hasOverdue: false };
        existing.count += 1;
        if (!item.completed && item.mode === "task" && dueDate < today) {
          existing.hasOverdue = true;
        }
        map.set(key, existing);
        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    return map;
  }, [normalizedSchedules]);

  const getDayOfSchedule = useCallback((scheduleItem: ScheduleItem, viewDate: Date) => {
    const dueDate = new Date(scheduleItem.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const endDate = scheduleItem.endDate ? new Date(scheduleItem.endDate) : dueDate;
    endDate.setHours(0, 0, 0, 0);

    // Single-day schedule has no day indicator
    if (dueDate.getTime() === endDate.getTime()) {
      return null;
    }

    const checkDate = new Date(viewDate);
    checkDate.setHours(0, 0, 0, 0);

    // Calculate day number (1-indexed)
    const day = Math.floor((checkDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const total = Math.floor((endDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return { day, total };
  }, []);

  const getCalendarEventsByDate = useCallback(() => {
    return buildCalendarEventsByDate(normalizedSchedules);
  }, [normalizedSchedules]);

  const getCalendarEventsByDateWithAccess = useCallback(
    (access: CalendarAccessContext) => {
      const views = normalizedSchedules.map((item) => buildScheduleVisibilityView(access, item));
      const visibilityById = new Map(views.map((view) => [view.item.id, view.visibility]));
      const visibleSchedules = views.map((view) => maskScheduleForViewer(access, view.item));
      return buildCalendarEventsByDate(visibleSchedules, access, visibilityById);
    },
    [normalizedSchedules],
  );

  const getScheduleVisibilityView = useCallback(
    (date: Date, access: CalendarAccessContext) => {
      const schedulesOnDate = getSchedulesByDate(date);
      return schedulesOnDate.map((item) => buildScheduleVisibilityView(access, item));
    },
    [getSchedulesByDate],
  );

  return {
    schedules: normalizedSchedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    toggleComplete,
    getUpcoming,
    getOverdue,
    getSchedulesByDate,
    getDatesWithSchedules,
    getCalendarEventsByDate,
    getCalendarEventsByDateWithAccess,
    getScheduleVisibilityView,
    getDayOfSchedule,
  };
}

function buildCalendarEventsByDate(
  schedules: ScheduleItem[],
  access?: CalendarAccessContext,
  visibilityById?: Map<string, "full" | "busy">,
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();

  const parseEventTimeToMinutes = (time: string): number => {
    if (!time) return Number.MAX_SAFE_INTEGER;
    const [hoursStr, minutesStr] = time.split(":");
    const hours = Number(hoursStr);
    const minutes = Number(minutesStr);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.MAX_SAFE_INTEGER;
    return hours * 60 + minutes;
  };

  for (const item of schedules) {
    const dueDate = new Date(item.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const endDate = item.endDate ? new Date(item.endDate) : dueDate;
    endDate.setHours(0, 0, 0, 0);

    const timeStr =
      item.mode === "schedule" && item.isAllDay
        ? ""
        : item.dueDate instanceof Date
          ? `${String(item.dueDate.getHours()).padStart(2, "0")}:${String(item.dueDate.getMinutes()).padStart(2, "0")}`
          : "00:00";

    // Generate all dates in range
    const currentDate = new Date(dueDate);
    let dayIndex = 0;
    const totalDays =
      Math.floor((endDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    while (currentDate <= endDate) {
      const key = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
      const isStart = dayIndex === 0;
      const isEnd = dayIndex === totalDays - 1;
      const isMultiDay = totalDays > 1;
      const viewerIdentity = access
        ? (access.viewerUserId ?? (access.role === "OWNER" ? access.ownerUserId : undefined))
        : undefined;
      const isOwnedByViewer = access
        ? Boolean(viewerIdentity && item.ownerId === viewerIdentity)
        : true;
      const visibility = access ? (visibilityById?.get(item.id) ?? "full") : "full";
      const color =
        visibility === "busy"
          ? "#64748B"
          : access && !isOwnedByViewer
            ? item.color || "#8B5CF6"
            : access && isOwnedByViewer
              ? item.color || "#22C55E"
              : item.color;

      const calendarEvent: CalendarEvent = {
        scheduleId: item.id,
        title: item.title,
        time: timeStr,
        isAllDay: item.mode === "schedule" ? item.isAllDay : undefined,
        mode: item.mode,
        isStart,
        isEnd,
        isMultiDay,
        completed: item.completed,
        color,
        edgeColor: visibility === "busy" ? "#64748B" : getCalendarEdgeColor(item),
        ownerId: item.ownerId,
        ownerDisplayName: item.ownerDisplayName,
        isOwnedByViewer,
        visibility,
      };

      const existing = map.get(key) || [];
      existing.push(calendarEvent);
      map.set(key, existing);

      currentDate.setDate(currentDate.getDate() + 1);
      dayIndex += 1;
    }
  }

  for (const [key, events] of map.entries()) {
    const sorted = [...events].sort((a, b) => {
      const aModePriority = a.mode === "schedule" ? 0 : 1;
      const bModePriority = b.mode === "schedule" ? 0 : 1;
      if (aModePriority !== bModePriority) return aModePriority - bModePriority;

      const aMultiDayPriority = a.mode === "schedule" && a.isMultiDay ? 0 : 1;
      const bMultiDayPriority = b.mode === "schedule" && b.isMultiDay ? 0 : 1;
      if (aMultiDayPriority !== bMultiDayPriority) return aMultiDayPriority - bMultiDayPriority;

      if (a.completed !== b.completed) return a.completed ? 1 : -1;

      const timeDiff = parseEventTimeToMinutes(a.time) - parseEventTimeToMinutes(b.time);
      if (timeDiff !== 0) return timeDiff;

      return a.title.localeCompare(b.title, "ja");
    });
    map.set(key, sorted);
  }

  return map;
}
