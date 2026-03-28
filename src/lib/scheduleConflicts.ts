import type { ScheduleItem, ScheduleConflict } from "@/types";

/**
 * Format date in short Japanese locale format
 */
function formatDateShort(date: Date, includeTime = true): string {
  const dateFormat = date.toLocaleDateString("ja-JP", {
    month: "short",
    day: "numeric",
  });

  if (!includeTime) {
    return dateFormat;
  }

  return `${dateFormat} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getConflictRange(start: Date, end: Date, isAllDay: boolean): { start: Date; end: Date } {
  const rangeStart = new Date(start);
  const rangeEnd = new Date(end);

  if (isAllDay) {
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(23, 59, 59, 999);
  }

  return { start: rangeStart, end: rangeEnd };
}

/**
 * Check if a schedule item is overdue
 */
export function isOverdue(item: ScheduleItem): boolean {
  if (item.completed) return false;
  if (item.mode === "schedule") return false; // Schedules don't have overdue concept
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueDate = new Date(item.dueDate);
  dueDate.setHours(0, 0, 0, 0);
  return dueDate < now;
}

/**
 * Check for conflicting schedules within a time range
 * @param schedules - List of existing schedules to check against
 * @param dueDate - Start/due date of new schedule (ISO string or Date)
 * @param endDate - Optional end date of new schedule (ISO string or Date)
 * @param excludeId - Optional schedule ID to exclude (for edit operations)
 * @returns Array of schedule conflicts
 */
export function checkScheduleConflicts(
  schedules: ScheduleItem[],
  dueDate: string | Date,
  endDate?: string | Date,
  excludeId?: string,
  targetMode?: ScheduleItem["mode"],
  targetIsAllDay?: boolean,
): ScheduleConflict[] {
  if (targetMode && targetMode !== "schedule") {
    return [];
  }

  const conflicts: ScheduleConflict[] = [];
  const newStartRaw = dueDate instanceof Date ? dueDate : new Date(dueDate);
  const newEndRaw = endDate ? (endDate instanceof Date ? endDate : new Date(endDate)) : newStartRaw;
  const targetAllDay = targetMode === "schedule" && Boolean(targetIsAllDay);
  const { start: newStart, end: newEnd } = getConflictRange(newStartRaw, newEndRaw, targetAllDay);

  for (const schedule of schedules) {
    // Skip completed schedules and the schedule being edited
    if (schedule.completed) continue;
    if (excludeId && schedule.id === excludeId) continue;
    if (targetMode === "schedule" && schedule.mode !== "schedule") continue;

    const scheduleStartRaw = new Date(schedule.dueDate);
    const scheduleEndRaw = schedule.endDate ? new Date(schedule.endDate) : scheduleStartRaw;
    const scheduleAllDay = schedule.mode === "schedule" && Boolean(schedule.isAllDay);
    const { start: scheduleStart, end: scheduleEnd } = getConflictRange(
      scheduleStartRaw,
      scheduleEndRaw,
      scheduleAllDay,
    );

    // Check for exact same time
    if (newStart.getTime() === scheduleStart.getTime()) {
      conflicts.push({
        conflictingSchedule: {
          id: schedule.id,
          title: schedule.title,
          mode: schedule.mode,
          dueDate: formatDateShort(scheduleStart, !scheduleAllDay),
          endDate: schedule.endDate ? formatDateShort(scheduleEnd, !scheduleAllDay) : undefined,
          isAllDay: scheduleAllDay,
          completed: schedule.completed,
          isOverdue: isOverdue(schedule),
          tags: schedule.tags.map((t) => t.name),
          location: schedule.location,
        },
        type: "exact",
      });
    }
    // Check for overlap
    else if (newStart <= scheduleEnd && newEnd >= scheduleStart) {
      conflicts.push({
        conflictingSchedule: {
          id: schedule.id,
          title: schedule.title,
          mode: schedule.mode,
          dueDate: formatDateShort(scheduleStart, !scheduleAllDay),
          endDate: schedule.endDate ? formatDateShort(scheduleEnd, !scheduleAllDay) : undefined,
          isAllDay: scheduleAllDay,
          completed: schedule.completed,
          isOverdue: isOverdue(schedule),
          tags: schedule.tags.map((t) => t.name),
          location: schedule.location,
        },
        type: "overlap",
      });
    }
  }

  return conflicts;
}

/**
 * Check if a date is in the past (overdue for tasks)
 */
export function checkIsOverdueDate(date: Date | string): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const checkDate = date instanceof Date ? date : new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate < now;
}
