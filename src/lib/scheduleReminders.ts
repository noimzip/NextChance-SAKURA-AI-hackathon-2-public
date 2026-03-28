import type { ScheduleItem } from "@/types";

export interface ReminderOption {
  minutes: number;
  label: string;
}

export type ReminderNotificationPermission = NotificationPermission | "unsupported";

export const REMINDER_OPTIONS: ReminderOption[] = [
  { minutes: 5, label: "5分前" },
  { minutes: 10, label: "10分前" },
  { minutes: 30, label: "30分前" },
  { minutes: 60, label: "1時間前" },
  { minutes: 120, label: "2時間前" },
  { minutes: 360, label: "6時間前" },
  { minutes: 1440, label: "1日前" },
  { minutes: 2880, label: "2日前" },
  { minutes: 10080, label: "1週間前" },
];

export const DEFAULT_REMINDER_OFFSETS_MINUTES = [60];
export const DEFAULT_ALL_DAY_REMINDER_TIME = "09:00";

export function normalizeReminderOffsets(offsets?: number[] | null): number[] {
  if (!Array.isArray(offsets)) {
    return [];
  }
  const normalized = offsets
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.floor(value));
  return [...new Set(normalized)].sort((a, b) => a - b);
}

export function formatReminderOffset(minutes: number): string {
  const normalized = Math.max(1, Math.floor(minutes));
  if (normalized % 1440 === 0) {
    return `${normalized / 1440}日前`;
  }
  if (normalized % 60 === 0) {
    return `${normalized / 60}時間前`;
  }
  return `${normalized}分前`;
}

export function formatReminderSummary(offsets?: number[] | null): string {
  const normalized = normalizeReminderOffsets(offsets);
  if (normalized.length === 0) {
    return "通知なし";
  }
  return normalized.map((offset) => formatReminderOffset(offset)).join(" / ");
}

export function normalizeAllDayReminderTime(value?: string | null): string {
  if (!value) {
    return DEFAULT_ALL_DAY_REMINDER_TIME;
  }
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) {
    return DEFAULT_ALL_DAY_REMINDER_TIME;
  }
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23) {
    return DEFAULT_ALL_DAY_REMINDER_TIME;
  }
  if (minute < 0 || minute > 59) {
    return DEFAULT_ALL_DAY_REMINDER_TIME;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseAllDayReminderTime(value?: string | null): { hour: number; minute: number } {
  const normalized = normalizeAllDayReminderTime(value);
  const [hour, minute] = normalized.split(":").map((entry) => Number.parseInt(entry, 10));
  return { hour, minute };
}

export function getReminderReferenceDate(
  item: Pick<ScheduleItem, "dueDate" | "mode" | "isAllDay" | "allDayReminderTime">,
): Date {
  const baseDate = item.dueDate instanceof Date ? new Date(item.dueDate) : new Date(item.dueDate);
  if (item.mode === "schedule" && item.isAllDay) {
    const { hour, minute } = parseAllDayReminderTime(item.allDayReminderTime);
    baseDate.setHours(hour, minute, 0, 0);
  }
  return baseDate;
}

export function buildReminderDeliveryKey(
  scheduleId: string,
  minutesBefore: number,
  referenceDate: Date,
): string {
  return `${scheduleId}:${minutesBefore}:${referenceDate.getTime()}`;
}

export function getReminderNotificationPermission(): ReminderNotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function requestReminderNotificationPermission(): Promise<ReminderNotificationPermission> {
  const currentPermission = getReminderNotificationPermission();
  if (currentPermission === "unsupported" || currentPermission !== "default") {
    return currentPermission;
  }
  const permission = await Notification.requestPermission();
  return permission;
}
