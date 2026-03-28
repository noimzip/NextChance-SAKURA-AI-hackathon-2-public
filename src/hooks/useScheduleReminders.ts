import { useEffect, useMemo, useRef } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { ScheduleItem } from "@/types";
import {
  buildReminderDeliveryKey,
  formatReminderOffset,
  getReminderNotificationPermission,
  getReminderReferenceDate,
  normalizeReminderOffsets,
} from "@/lib/scheduleReminders";

const REMINDER_SENT_STORAGE_KEY = "grass-secretary-reminder-delivery-map";
const REMINDER_CHECK_INTERVAL_MS = 30 * 1000;
const REMINDER_TRIGGER_WINDOW_MS = 60 * 1000;
const REMINDER_EXPIRY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const REMINDER_MAX_STORED_ENTRIES = 400;

type ReminderDeliveryMap = Record<string, number>;

function pruneReminderMap(map: ReminderDeliveryMap, now: number): ReminderDeliveryMap {
  const entries = Object.entries(map).filter(
    ([, timestamp]) => now - timestamp <= REMINDER_EXPIRY_WINDOW_MS,
  );
  entries.sort((a, b) => b[1] - a[1]);
  const limited = entries.slice(0, REMINDER_MAX_STORED_ENTRIES);
  return Object.fromEntries(limited);
}

function shouldNotifyForItem(item: ScheduleItem): boolean {
  if (item.completed) {
    return false;
  }
  const reminderOffsets = normalizeReminderOffsets(item.reminderOffsetsMinutes);
  if (reminderOffsets.length === 0) {
    return false;
  }
  return true;
}

function canUseBrowserNotifications(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    typeof Notification.permission === "string"
  );
}

function buildNotificationBody(item: ScheduleItem, minutesBefore: number): string {
  const offsetLabel = formatReminderOffset(minutesBefore);
  const modeLabel = item.mode === "task" ? "タスク" : "予定";
  return `${modeLabel}「${item.title}」の${offsetLabel}です。`;
}

export function useScheduleReminders(schedules: ScheduleItem[]): void {
  const [deliveryMap, setDeliveryMap] = useLocalStorage<ReminderDeliveryMap>(
    REMINDER_SENT_STORAGE_KEY,
    {},
  );
  const deliveryMapRef = useRef(deliveryMap);

  useEffect(() => {
    deliveryMapRef.current = deliveryMap;
  }, [deliveryMap]);

  useEffect(() => {
    if (!canUseBrowserNotifications()) {
      return;
    }

    const permission = getReminderNotificationPermission();
    if (permission !== "granted") {
      return;
    }

    const checkAndNotify = () => {
      const now = Date.now();
      const currentMap = deliveryMapRef.current;
      const nextMap = { ...currentMap };
      let hasUpdates = false;

      for (const item of schedules) {
        if (!shouldNotifyForItem(item)) {
          continue;
        }

        const referenceDate = getReminderReferenceDate(item);
        const reminderOffsets = normalizeReminderOffsets(item.reminderOffsetsMinutes);

        for (const minutesBefore of reminderOffsets) {
          const triggerTime = referenceDate.getTime() - minutesBefore * 60 * 1000;
          if (now < triggerTime || now - triggerTime > REMINDER_TRIGGER_WINDOW_MS) {
            continue;
          }

          const deliveryKey = buildReminderDeliveryKey(item.id, minutesBefore, referenceDate);
          if (currentMap[deliveryKey]) {
            continue;
          }

          new Notification("Grass-Secretary リマインド", {
            body: buildNotificationBody(item, minutesBefore),
            tag: `schedule-reminder:${item.id}:${minutesBefore}`,
          });

          nextMap[deliveryKey] = now;
          hasUpdates = true;
        }
      }

      if (hasUpdates) {
        setDeliveryMap(pruneReminderMap(nextMap, now));
      } else if (Object.keys(currentMap).length > REMINDER_MAX_STORED_ENTRIES) {
        setDeliveryMap(pruneReminderMap(currentMap, now));
      }
    };

    checkAndNotify();
    const timer = window.setInterval(checkAndNotify, REMINDER_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [schedules, setDeliveryMap]);

  const futureSignature = useMemo(
    () =>
      schedules
        .filter(shouldNotifyForItem)
        .map((item) => {
          const due =
            item.dueDate instanceof Date
              ? item.dueDate.getTime()
              : new Date(item.dueDate).getTime();
          return `${item.id}:${due}:${normalizeReminderOffsets(item.reminderOffsetsMinutes).join(",")}:${item.completed ? "1" : "0"}`;
        })
        .join("|"),
    [schedules],
  );

  useEffect(() => {
    if (!futureSignature) {
      return;
    }
    const now = Date.now();
    setDeliveryMap((prev) => pruneReminderMap(prev, now));
  }, [futureSignature, setDeliveryMap]);
}
