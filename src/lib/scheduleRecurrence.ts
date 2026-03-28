import type {
  RepeatWeekday,
  ScheduleItem,
  ScheduleRecurrenceInput,
  ScheduleRecurrenceRule,
} from "@/types";

const DEFAULT_FINITE_RECURRENCE_COUNT = 8;
const DEFAULT_INFINITE_RECURRENCE_HORIZON_DAYS = 365;

function normalizeWeekdays(weekdays: RepeatWeekday[]): RepeatWeekday[] {
  return [...new Set(weekdays)]
    .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
    .sort((a, b) => a - b) as RepeatWeekday[];
}

function normalizeCount(count: unknown): number | undefined {
  if (count === undefined || count === null || count === "") {
    return undefined;
  }
  const parsed =
    typeof count === "number"
      ? count
      : typeof count === "string"
        ? Number.parseInt(count, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(1, Math.floor(parsed));
}

export function normalizeRecurrenceInput(
  recurrence?: ScheduleRecurrenceInput | null,
): ScheduleRecurrenceInput | undefined {
  if (!recurrence) {
    return undefined;
  }

  const weekdays = normalizeWeekdays(recurrence.weekdays ?? []);
  const isInfinite = recurrence.isInfinite === true;
  const count = normalizeCount(recurrence.count);

  if (weekdays.length === 0) {
    return undefined;
  }

  if (isInfinite) {
    return { weekdays, isInfinite: true };
  }

  if (!count || count <= 1) {
    return undefined;
  }

  return { weekdays, count, isInfinite: false };
}

function createSeriesId(base: Date): string {
  return `series-${base.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
}

function setTimeLike(source: Date, target: Date): Date {
  const clone = new Date(target);
  clone.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
  return clone;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextMatchingWeekday(from: Date, weekdays: RepeatWeekday[]): Date {
  const sorted = normalizeWeekdays(weekdays);
  if (sorted.length === 0) {
    return from;
  }

  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = addDays(from, offset);
    if (sorted.includes(candidate.getDay() as RepeatWeekday)) {
      return candidate;
    }
  }
  return addDays(from, 7);
}

function alignToMatchingWeekday(date: Date, weekdays: RepeatWeekday[]): Date {
  if (weekdays.includes(date.getDay() as RepeatWeekday)) {
    return date;
  }
  return nextMatchingWeekday(addDays(date, -1), weekdays);
}

export function buildRecurringScheduleItems(
  base: Omit<ScheduleItem, "id" | "completed" | "createdAt">,
  options: { seriesId?: string; infiniteHorizonDays?: number } = {},
): Omit<ScheduleItem, "id" | "completed" | "createdAt">[] {
  const recurrence = normalizeRecurrenceInput(base.recurrence ?? undefined);
  if (!recurrence) {
    return [{ ...base, recurrence: undefined }];
  }

  const dueDate = new Date(base.dueDate);
  const durationMs = base.endDate ? new Date(base.endDate).getTime() - dueDate.getTime() : 0;
  const seriesId = options.seriesId ?? createSeriesId(dueDate);
  const items: Omit<ScheduleItem, "id" | "completed" | "createdAt">[] = [];
  const isInfinite = recurrence.isInfinite === true;
  const finiteCount = normalizeCount(recurrence.count);
  const horizonDays = Number.isFinite(options.infiniteHorizonDays)
    ? Math.max(1, Math.floor(options.infiniteHorizonDays!))
    : DEFAULT_INFINITE_RECURRENCE_HORIZON_DAYS;
  const occurrenceCount = isInfinite
    ? horizonDays + 7
    : finiteCount && finiteCount > 1
      ? finiteCount
      : DEFAULT_FINITE_RECURRENCE_COUNT;
  const horizonEnd = addDays(dueDate, horizonDays);

  let cursorDueDate = alignToMatchingWeekday(new Date(dueDate), recurrence.weekdays);
  for (let index = 0; index < occurrenceCount; index += 1) {
    if (isInfinite && cursorDueDate > horizonEnd) {
      break;
    }

    const recurrenceRule: ScheduleRecurrenceRule = {
      weekdays: recurrence.weekdays,
      ...(isInfinite ? { isInfinite: true } : { count: occurrenceCount, isInfinite: false }),
      seriesId,
      occurrenceIndex: index,
    };

    const nextEndDate = base.endDate ? new Date(cursorDueDate.getTime() + durationMs) : undefined;

    items.push({
      ...base,
      dueDate: new Date(cursorDueDate),
      endDate: nextEndDate,
      recurrence: recurrenceRule,
    });

    const nextDate = nextMatchingWeekday(cursorDueDate, recurrence.weekdays);
    cursorDueDate = setTimeLike(dueDate, nextDate);
  }

  if (items.length === 0) {
    return [{ ...base, recurrence: undefined }];
  }

  return items;
}

export function parseWeekdayCsvToNumbers(value: string): RepeatWeekday[] {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const numeric = tokens
    .map((token) => Number.parseInt(token, 10))
    .filter((num) => Number.isInteger(num) && num >= 0 && num <= 6) as RepeatWeekday[];
  return normalizeWeekdays(numeric);
}
