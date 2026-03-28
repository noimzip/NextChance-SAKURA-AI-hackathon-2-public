import { describe, expect, it } from "vite-plus/test";
import {
  buildReminderDeliveryKey,
  formatReminderSummary,
  getReminderReferenceDate,
  normalizeAllDayReminderTime,
  normalizeReminderOffsets,
} from "@/lib/scheduleReminders";

describe("scheduleReminders", () => {
  it("normalizes reminder offsets as sorted unique positive minutes", () => {
    expect(normalizeReminderOffsets([60, 5, 60, -1, 0, Number.NaN, 30])).toEqual([5, 30, 60]);
  });

  it("formats reminder summary with mixed units", () => {
    expect(formatReminderSummary([10, 60, 1440])).toBe("10分前 / 1時間前 / 1日前");
  });

  it("returns notification-none summary when empty", () => {
    expect(formatReminderSummary([])).toBe("通知なし");
    expect(formatReminderSummary(undefined)).toBe("通知なし");
  });

  it("normalizes all-day reminder time and falls back when invalid", () => {
    expect(normalizeAllDayReminderTime("9:5")).toBe("09:05");
    expect(normalizeAllDayReminderTime("99:00")).toBe("09:00");
    expect(normalizeAllDayReminderTime("invalid")).toBe("09:00");
  });

  it("uses all-day reminder time as notification reference", () => {
    const reference = getReminderReferenceDate({
      dueDate: new Date("2025-01-10T00:00:00.000Z"),
      mode: "schedule",
      isAllDay: true,
      allDayReminderTime: "08:30",
    });
    expect(reference.getHours()).toBe(8);
    expect(reference.getMinutes()).toBe(30);
  });

  it("builds deterministic reminder delivery keys", () => {
    const reference = new Date("2025-01-10T09:00:00.000Z");
    expect(buildReminderDeliveryKey("schedule-1", 60, reference)).toBe(
      `schedule-1:60:${reference.getTime()}`,
    );
  });
});
