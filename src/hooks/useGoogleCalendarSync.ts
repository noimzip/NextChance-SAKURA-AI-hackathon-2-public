import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type {
  GoogleCalendarCalendarListItem,
  GoogleCalendarCreateEventInput,
  GoogleCalendarEventItem,
  GoogleCalendarSyncConflict,
  GoogleCalendarUpdateEventInput,
  ScheduleItem,
} from "@/types";
import { useGoogleCalendar } from "@/hooks/useGoogleCalendar";
import { buildRecurringScheduleItems } from "@/lib/scheduleRecurrence";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  GoogleCalendarApiError,
  listGoogleCalendarEvents,
  updateGoogleCalendarEvent,
} from "@/services/googleCalendarApi";
import { toGoogleEventColorId, toLocalScheduleColor } from "@/lib/googleCalendarColors";

const GOOGLE_SYNC_META_STORAGE_KEY = "grass-secretary-google-calendar-sync-meta-v1";
const GOOGLE_SYNC_CONFLICTS_STORAGE_KEY = "grass-secretary-google-calendar-sync-conflicts-v1";
const GOOGLE_SYNC_DEFAULT_PULL_RANGE_DAYS = 60;
const GOOGLE_SYNC_POLLING_INTERVAL_MS = 30 * 1000;
const GOOGLE_SYNC_SOURCE_KEY = "grass_secretary_source";
const GOOGLE_SYNC_SOURCE_VALUE = "grass-secretary";
const GOOGLE_SYNC_SCHEDULE_ID_KEY = "grass_secretary_schedule_id";

interface GoogleCalendarSyncCalendarState {
  scheduleToEventMap: Record<string, string>;
  eventToScheduleMap: Record<string, string>;
  remoteHashByScheduleId: Record<string, string>;
  localHashByScheduleId: Record<string, string>;
  lastInboundSyncAt?: string;
}

interface GoogleCalendarSyncMeta extends GoogleCalendarSyncCalendarState {
  selectedCalendarId: string;
  byCalendarId: Record<string, GoogleCalendarSyncCalendarState>;
}

interface LegacyGoogleCalendarSyncCalendarState extends Partial<GoogleCalendarSyncCalendarState> {
  eventHashByScheduleId?: Record<string, string>;
}

interface LegacyGoogleCalendarSyncMeta extends LegacyGoogleCalendarSyncCalendarState {
  selectedCalendarId?: string;
  byCalendarId?: Record<string, LegacyGoogleCalendarSyncCalendarState>;
}

const DEFAULT_CALENDAR_SYNC_STATE: GoogleCalendarSyncCalendarState = {
  scheduleToEventMap: {},
  eventToScheduleMap: {},
  remoteHashByScheduleId: {},
  localHashByScheduleId: {},
};

const DEFAULT_SYNC_META: GoogleCalendarSyncMeta = {
  selectedCalendarId: "primary",
  ...DEFAULT_CALENDAR_SYNC_STATE,
  byCalendarId: {},
};

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value : new Date(value);
}

function safeIso(value: Date | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function formatDateForCalendarDate(date: Date): string {
  return [
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function normalizeConflictList(input: GoogleCalendarSyncConflict[]): GoogleCalendarSyncConflict[] {
  return input
    .map((entry) => ({
      ...entry,
      detectedAt: entry.detectedAt || new Date().toISOString(),
    }))
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
}

function normalizeCalendarSyncState(
  input: LegacyGoogleCalendarSyncCalendarState | null | undefined,
): GoogleCalendarSyncCalendarState {
  const legacyRemoteHashes = input?.eventHashByScheduleId ?? {};
  return {
    scheduleToEventMap: input?.scheduleToEventMap ?? {},
    eventToScheduleMap: input?.eventToScheduleMap ?? {},
    remoteHashByScheduleId: input?.remoteHashByScheduleId ?? legacyRemoteHashes,
    localHashByScheduleId: input?.localHashByScheduleId ?? {},
    lastInboundSyncAt: input?.lastInboundSyncAt,
  };
}

function hasCalendarSyncStateData(state: GoogleCalendarSyncCalendarState): boolean {
  return (
    Object.keys(state.scheduleToEventMap).length > 0 ||
    Object.keys(state.eventToScheduleMap).length > 0 ||
    Object.keys(state.remoteHashByScheduleId).length > 0 ||
    Object.keys(state.localHashByScheduleId).length > 0 ||
    Boolean(state.lastInboundSyncAt)
  );
}

function normalizeSyncMeta(
  input: LegacyGoogleCalendarSyncMeta | null | undefined,
): GoogleCalendarSyncMeta {
  const selectedCalendarId = input?.selectedCalendarId || "primary";
  const normalizedByCalendarId: Record<string, GoogleCalendarSyncCalendarState> = {};
  if (input?.byCalendarId) {
    for (const [calendarId, meta] of Object.entries(input.byCalendarId)) {
      normalizedByCalendarId[calendarId] = normalizeCalendarSyncState(meta);
    }
  }

  const normalizedTopLevel = normalizeCalendarSyncState(input);
  const selectedFromMap = normalizedByCalendarId[selectedCalendarId];
  const activeState =
    hasCalendarSyncStateData(normalizedTopLevel) || !selectedFromMap
      ? normalizedTopLevel
      : selectedFromMap;
  normalizedByCalendarId[selectedCalendarId] = activeState;

  return {
    selectedCalendarId,
    ...activeState,
    byCalendarId: normalizedByCalendarId,
  };
}

function getCalendarSyncState(
  meta: GoogleCalendarSyncMeta,
  calendarId: string,
): GoogleCalendarSyncCalendarState {
  const fromMap = meta.byCalendarId[calendarId];
  if (fromMap) {
    return normalizeCalendarSyncState(fromMap);
  }
  if (meta.selectedCalendarId === calendarId) {
    return normalizeCalendarSyncState(meta);
  }
  return normalizeCalendarSyncState(undefined);
}

function buildMetaFromCalendarMap(
  meta: GoogleCalendarSyncMeta,
  selectedCalendarId: string,
  byCalendarId: Record<string, GoogleCalendarSyncCalendarState>,
): GoogleCalendarSyncMeta {
  const selectedState =
    byCalendarId[selectedCalendarId] ?? getCalendarSyncState(meta, selectedCalendarId);
  return {
    selectedCalendarId,
    ...selectedState,
    byCalendarId,
  };
}

function updateCalendarSyncState(
  meta: GoogleCalendarSyncMeta,
  calendarId: string,
  updater: (state: GoogleCalendarSyncCalendarState) => GoogleCalendarSyncCalendarState,
): GoogleCalendarSyncMeta {
  const targetCalendarId = calendarId || meta.selectedCalendarId || "primary";
  const nextState = normalizeCalendarSyncState(
    updater(getCalendarSyncState(meta, targetCalendarId)),
  );
  const nextByCalendarId: Record<string, GoogleCalendarSyncCalendarState> = {
    ...meta.byCalendarId,
    [targetCalendarId]: nextState,
  };
  const selectedCalendarId = meta.selectedCalendarId || targetCalendarId;
  return buildMetaFromCalendarMap(meta, selectedCalendarId, nextByCalendarId);
}

function selectCalendarSyncMeta(
  meta: GoogleCalendarSyncMeta,
  calendarId: string,
): GoogleCalendarSyncMeta {
  const targetCalendarId = calendarId || "primary";
  const nextByCalendarId: Record<string, GoogleCalendarSyncCalendarState> = {
    ...meta.byCalendarId,
  };
  if (!nextByCalendarId[targetCalendarId]) {
    nextByCalendarId[targetCalendarId] = getCalendarSyncState(meta, targetCalendarId);
  }
  return buildMetaFromCalendarMap(meta, targetCalendarId, nextByCalendarId);
}

function isSyncRootSchedule(item: ScheduleItem): boolean {
  if (item.mode !== "schedule") {
    return false;
  }
  if (!item.recurrence?.seriesId) {
    return true;
  }
  return item.recurrence.occurrenceIndex === 0 || item.recurrence.occurrenceIndex === undefined;
}

function hashScheduleForSync(item: ScheduleItem): string {
  const payload = {
    title: item.title,
    mode: item.mode,
    dueDate: safeIso(toDate(item.dueDate)),
    endDate: safeIso(toDate(item.endDate)),
    isAllDay: Boolean(item.isAllDay),
    location: item.location ?? "",
    notes: item.notes ?? "",
    color: item.color ?? "",
    googleCalendarId: item.googleCalendarId ?? "",
    recurrence: item.recurrence ?? null,
    completed: item.completed,
  };
  return JSON.stringify(payload);
}

function hashEventForSync(event: GoogleCalendarEventItem): string {
  const payload = {
    id: event.id,
    summary: event.summary ?? "",
    startDate: event.start?.date,
    startDateTime: event.start?.dateTime,
    endDate: event.end?.date,
    endDateTime: event.end?.dateTime,
    location: event.location ?? "",
    colorId: event.colorId ?? "",
    description: event.description ?? "",
    recurrence: event.recurrence ?? null,
    status: event.status ?? "",
    updated: event.updated ?? "",
  };
  return JSON.stringify(payload);
}

function toGoogleRecurrence(item: ScheduleItem): string[] | undefined {
  const recurrence = item.recurrence;
  if (!recurrence || recurrence.weekdays.length === 0) {
    return undefined;
  }
  const dayMap = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const by = recurrence.weekdays.map((weekday) => dayMap[weekday]).join(",");
  if (!by) {
    return undefined;
  }
  const parts = ["FREQ=WEEKLY", `BYDAY=${by}`];
  if (!recurrence.isInfinite && recurrence.count && recurrence.count > 1) {
    parts.push(`COUNT=${recurrence.count}`);
  }
  return [`RRULE:${parts.join(";")}`];
}

function parseRRuleToRecurrence(
  rruleText: string | undefined,
): Pick<ScheduleItem, "recurrence">["recurrence"] | undefined {
  if (!rruleText) {
    return undefined;
  }
  const body = rruleText.startsWith("RRULE:") ? rruleText.slice("RRULE:".length) : rruleText;
  const tokens = body.split(";").map((entry) => entry.trim());
  const byDayToken = tokens.find((entry) => entry.startsWith("BYDAY="));
  if (!byDayToken) {
    return undefined;
  }
  const weekdayMap: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };
  const weekdays = byDayToken
    .replace("BYDAY=", "")
    .split(",")
    .map((token) => token.trim())
    .map((token) => weekdayMap[token])
    .filter((value) => value !== undefined);
  if (weekdays.length === 0) {
    return undefined;
  }
  const countToken = tokens.find((entry) => entry.startsWith("COUNT="));
  const parsedCount = countToken
    ? Number.parseInt(countToken.replace("COUNT=", ""), 10)
    : Number.NaN;
  if (Number.isFinite(parsedCount) && parsedCount > 1) {
    return {
      weekdays,
      count: parsedCount,
      isInfinite: false,
    };
  }
  return {
    weekdays,
    isInfinite: true,
  };
}

function toGoogleEventInput(
  item: ScheduleItem,
  calendarId: string,
  scheduleId?: string,
): GoogleCalendarCreateEventInput {
  const start = toDate(item.dueDate) ?? new Date();
  const end = toDate(item.endDate);
  const recurrence = toGoogleRecurrence(item);
  if (item.isAllDay) {
    const endDate = end ?? start;
    const endExclusive = new Date(endDate);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return {
      calendarId,
      summary: item.title,
      description: item.notes,
      location: item.location,
      colorId: toGoogleEventColorId(item.color),
      start: { date: formatDateForCalendarDate(start) },
      end: { date: formatDateForCalendarDate(endExclusive) },
      recurrence,
      extendedProperties: {
        private: {
          [GOOGLE_SYNC_SOURCE_KEY]: GOOGLE_SYNC_SOURCE_VALUE,
          ...(scheduleId ? { [GOOGLE_SYNC_SCHEDULE_ID_KEY]: scheduleId } : {}),
        },
      },
    };
  }
  const fallbackEnd = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    calendarId,
    summary: item.title,
    description: item.notes,
    location: item.location,
    colorId: toGoogleEventColorId(item.color),
    start: { dateTime: start.toISOString() },
    end: { dateTime: (end ?? fallbackEnd).toISOString() },
    recurrence,
    extendedProperties: {
      private: {
        [GOOGLE_SYNC_SOURCE_KEY]: GOOGLE_SYNC_SOURCE_VALUE,
        ...(scheduleId ? { [GOOGLE_SYNC_SCHEDULE_ID_KEY]: scheduleId } : {}),
      },
    },
  };
}

function buildScheduleFromEvent(
  event: GoogleCalendarEventItem,
  calendarId: string,
): Omit<ScheduleItem, "id" | "completed" | "createdAt"> {
  const isAllDay = Boolean(event.start?.date && !event.start?.dateTime);
  const dueDate = isAllDay
    ? new Date(`${event.start?.date ?? "1970-01-01"}T00:00:00`)
    : new Date(event.start?.dateTime ?? `${event.start?.date ?? "1970-01-01"}T00:00:00`);

  let endDate: Date | undefined;
  if (isAllDay) {
    if (event.end?.date) {
      const inclusive = new Date(`${event.end.date}T00:00:00`);
      inclusive.setDate(inclusive.getDate() - 1);
      inclusive.setHours(23, 59, 59, 999);
      endDate = inclusive;
    }
  } else if (event.end?.dateTime) {
    endDate = new Date(event.end.dateTime);
  } else if (event.end?.date) {
    endDate = new Date(`${event.end.date}T00:00:00`);
  }

  const recurrence = parseRRuleToRecurrence(event.recurrence?.[0]);
  const notes = event.description;
  const color = toLocalScheduleColor(event.colorId);
  return {
    title: event.summary?.trim() || "Google予定",
    mode: "schedule",
    dueDate,
    endDate,
    isAllDay,
    tags: [],
    location: event.location,
    notes,
    color,
    recurrence,
    googleCalendarId: calendarId,
    isPrivate: false,
    ownerId: "owner-local",
    ownerDisplayName: "あなた",
    reminderOffsetsMinutes: [],
    allDayReminderTime: isAllDay ? "09:00" : undefined,
  };
}

function removeScheduleMapping(
  state: GoogleCalendarSyncCalendarState,
  scheduleId: string,
  expectedEventId?: string,
): GoogleCalendarSyncCalendarState {
  const mappedEventId = expectedEventId ?? state.scheduleToEventMap[scheduleId];
  const nextScheduleMap = { ...state.scheduleToEventMap };
  const nextEventMap = { ...state.eventToScheduleMap };
  const nextRemoteHashes = { ...state.remoteHashByScheduleId };
  const nextLocalHashes = { ...state.localHashByScheduleId };
  delete nextScheduleMap[scheduleId];
  delete nextRemoteHashes[scheduleId];
  delete nextLocalHashes[scheduleId];
  if (mappedEventId && nextEventMap[mappedEventId] === scheduleId) {
    delete nextEventMap[mappedEventId];
  }
  return {
    ...state,
    scheduleToEventMap: nextScheduleMap,
    eventToScheduleMap: nextEventMap,
    remoteHashByScheduleId: nextRemoteHashes,
    localHashByScheduleId: nextLocalHashes,
  };
}

function buildProjectedLocalSchedule(
  current: ScheduleItem,
  inbound: Omit<ScheduleItem, "id" | "completed" | "createdAt">,
): ScheduleItem {
  return {
    ...current,
    title: inbound.title,
    mode: "schedule",
    dueDate: inbound.dueDate,
    endDate: inbound.endDate,
    isAllDay: inbound.isAllDay,
    color: inbound.color,
    location: inbound.location,
    notes: inbound.notes,
    googleCalendarId: inbound.googleCalendarId,
    recurrence: inbound.recurrence,
  };
}

interface UseGoogleCalendarSyncParams {
  schedules: ScheduleItem[];
  addSchedule: (
    item: Omit<ScheduleItem, "id" | "completed" | "createdAt">,
    options?: { idSeed?: number },
  ) => void;
  updateSchedule: (
    id: string,
    updates: Omit<Partial<ScheduleItem>, "recurrence"> & {
      recurrence?: ScheduleItem["recurrence"] | null;
    },
    scope?: "single" | "all" | "future",
  ) => void;
  deleteSchedule: (id: string, scope?: "single" | "all" | "future") => void;
}

interface UseGoogleCalendarSyncResult {
  isSyncing: boolean;
  isAutoSyncEnabled: boolean;
  isAuthenticated: boolean;
  calendars: GoogleCalendarCalendarListItem[];
  selectedCalendarId: string;
  conflicts: GoogleCalendarSyncConflict[];
  syncError: string | null;
  calendarError: string | null;
  lastSyncedAt: Date | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshCalendars: () => Promise<GoogleCalendarCalendarListItem[]>;
  setSelectedCalendarId: (calendarId: string) => void;
  syncNow: () => Promise<void>;
  resolveConflictKeepLocal: (conflictId: string) => Promise<void>;
  resolveConflictKeepRemote: (conflictId: string) => Promise<void>;
  clearSyncError: () => void;
  clearCalendarError: () => void;
}

export function useGoogleCalendarSync({
  schedules,
  addSchedule,
  updateSchedule,
  deleteSchedule,
}: UseGoogleCalendarSyncParams): UseGoogleCalendarSyncResult {
  const {
    token,
    isAuthenticated,
    isLoading,
    isFetchingEvents,
    isListingCalendars,
    isCreatingEvent,
    isUpdatingEvent,
    isDeletingEvent,
    calendars,
    selectedCalendarId,
    error: calendarError,
    login,
    logout,
    refreshCalendars,
    setSelectedCalendarId,
    clearError: clearCalendarError,
  } = useGoogleCalendar();

  const [syncMetaRaw, setSyncMetaRaw] = useLocalStorage<LegacyGoogleCalendarSyncMeta>(
    GOOGLE_SYNC_META_STORAGE_KEY,
    DEFAULT_SYNC_META,
  );
  const [conflictsRaw, setConflictsRaw] = useLocalStorage<GoogleCalendarSyncConflict[]>(
    GOOGLE_SYNC_CONFLICTS_STORAGE_KEY,
    [],
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const syncMeta = useMemo(() => normalizeSyncMeta(syncMetaRaw), [syncMetaRaw]);
  const conflicts = useMemo(() => normalizeConflictList(conflictsRaw), [conflictsRaw]);
  const activeCalendarId = useMemo(
    () => selectedCalendarId || syncMeta.selectedCalendarId || "primary",
    [selectedCalendarId, syncMeta.selectedCalendarId],
  );
  const activeSyncState = useMemo(
    () => getCalendarSyncState(syncMeta, activeCalendarId),
    [activeCalendarId, syncMeta],
  );
  const lastKnownScheduleHashRef = useRef<string>("");

  const syncRootItems = useMemo(
    () => schedules.filter((item) => isSyncRootSchedule(item)),
    [schedules],
  );

  const trackedSchedulesHash = useMemo(
    () =>
      syncRootItems
        .map((item) => `${item.id}:${hashScheduleForSync(item)}`)
        .sort()
        .join("|"),
    [syncRootItems],
  );

  const lastSyncedAt = useMemo(() => {
    if (!activeSyncState.lastInboundSyncAt) {
      return null;
    }
    const parsed = new Date(activeSyncState.lastInboundSyncAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [activeSyncState.lastInboundSyncAt]);

  const removeConflict = useCallback(
    (conflictId: string) => {
      setConflictsRaw((prev) => prev.filter((entry) => entry.id !== conflictId));
    },
    [setConflictsRaw],
  );

  const upsertConflict = useCallback(
    (input: Omit<GoogleCalendarSyncConflict, "id" | "detectedAt">) => {
      setConflictsRaw((prev) => {
        const existing = prev.find(
          (entry) =>
            entry.scheduleId === input.scheduleId &&
            entry.eventId === input.eventId &&
            entry.calendarId === input.calendarId,
        );
        const nextEntry: GoogleCalendarSyncConflict = {
          id:
            existing?.id ?? `sync-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          detectedAt: new Date().toISOString(),
          ...input,
        };
        if (!existing) {
          return [nextEntry, ...prev];
        }
        return prev.map((entry) => (entry.id === existing.id ? nextEntry : entry));
      });
    },
    [setConflictsRaw],
  );

  const setSyncMeta = useCallback(
    (updater: (prev: GoogleCalendarSyncMeta) => GoogleCalendarSyncMeta) => {
      setSyncMetaRaw((prev) => normalizeSyncMeta(updater(normalizeSyncMeta(prev))));
    },
    [setSyncMetaRaw],
  );

  const ensureCalendarsLoaded = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }
    if (calendars.length > 0) {
      return;
    }
    await refreshCalendars();
  }, [calendars.length, isAuthenticated, refreshCalendars]);

  const loadInboundEvents = useCallback(async () => {
    if (!token?.accessToken || !isAuthenticated) {
      return [] as GoogleCalendarEventItem[];
    }
    const effectiveCalendarId = activeCalendarId;
    return listGoogleCalendarEvents(token.accessToken, {
      calendarId: effectiveCalendarId,
      maxResults: 250,
      singleEvents: true,
      orderBy: "updated",
      showDeleted: true,
      ...(activeSyncState.lastInboundSyncAt
        ? { updatedMin: activeSyncState.lastInboundSyncAt }
        : {}),
    });
  }, [activeCalendarId, activeSyncState.lastInboundSyncAt, isAuthenticated, token?.accessToken]);

  const applyInboundEvents = useCallback(
    async (events: GoogleCalendarEventItem[]) => {
      if (!token?.accessToken || !isAuthenticated) {
        return;
      }
      const effectiveCalendarId = activeCalendarId;
      const nowIso = new Date().toISOString();

      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        const eventScheduleCalendarId = effectiveCalendarId;
        let mappedScheduleId: string | undefined = activeSyncState.eventToScheduleMap[event.id];
        const remoteHash = hashEventForSync(event);

        if (mappedScheduleId) {
          const localExists = schedules.some((item) => item.id === mappedScheduleId);
          if (!localExists) {
            const staleScheduleId = mappedScheduleId;
            setSyncMeta((prev) =>
              updateCalendarSyncState(prev, effectiveCalendarId, (state) =>
                removeScheduleMapping(state, staleScheduleId, event.id),
              ),
            );
            mappedScheduleId = undefined;
          }
        }

        if (event.status === "cancelled") {
          if (mappedScheduleId) {
            deleteSchedule(mappedScheduleId, "single");
            setSyncMeta((prev) =>
              updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
                ...removeScheduleMapping(state, mappedScheduleId, event.id),
                lastInboundSyncAt: nowIso,
              })),
            );
          }
          continue;
        }

        if (mappedScheduleId) {
          const localSchedule = schedules.find((item) => item.id === mappedScheduleId);
          if (!localSchedule) {
            continue;
          }

          const baselineRemoteHash = activeSyncState.remoteHashByScheduleId[mappedScheduleId];
          const baselineLocalHash = activeSyncState.localHashByScheduleId[mappedScheduleId];
          const currentLocalHash = hashScheduleForSync(localSchedule);
          const isRemoteChanged = baselineRemoteHash !== remoteHash;
          const isLocalChangedSinceLastSync =
            baselineLocalHash !== undefined && baselineLocalHash !== currentLocalHash;

          if (isRemoteChanged && isLocalChangedSinceLastSync) {
            upsertConflict({
              scheduleId: mappedScheduleId,
              eventId: event.id,
              calendarId: effectiveCalendarId,
              scheduleTitle: localSchedule.title,
              remoteTitle: event.summary,
              remoteUpdatedAt: event.updated,
            });
            continue;
          }

          if (isRemoteChanged) {
            const nextSchedule = buildScheduleFromEvent(event, eventScheduleCalendarId);
            const projectedSchedule = buildProjectedLocalSchedule(localSchedule, nextSchedule);
            updateSchedule(mappedScheduleId, {
              title: nextSchedule.title,
              dueDate: nextSchedule.dueDate,
              endDate: nextSchedule.endDate,
              isAllDay: nextSchedule.isAllDay,
              color: nextSchedule.color,
              location: nextSchedule.location,
              notes: nextSchedule.notes,
              googleCalendarId: nextSchedule.googleCalendarId,
              recurrence: nextSchedule.recurrence ?? null,
              mode: "schedule",
            });
            setSyncMeta((prev) =>
              updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
                ...state,
                remoteHashByScheduleId: {
                  ...state.remoteHashByScheduleId,
                  [mappedScheduleId]: remoteHash,
                },
                localHashByScheduleId: {
                  ...state.localHashByScheduleId,
                  [mappedScheduleId]: hashScheduleForSync(projectedSchedule),
                },
                lastInboundSyncAt: nowIso,
              })),
            );
            continue;
          }

          if (baselineLocalHash === undefined || baselineRemoteHash === undefined) {
            setSyncMeta((prev) =>
              updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
                ...state,
                remoteHashByScheduleId: {
                  ...state.remoteHashByScheduleId,
                  [mappedScheduleId]: remoteHash,
                },
                localHashByScheduleId: {
                  ...state.localHashByScheduleId,
                  [mappedScheduleId]: currentLocalHash,
                },
                lastInboundSyncAt: nowIso,
              })),
            );
          }
          continue;
        }

        const nextSchedule = buildScheduleFromEvent(event, eventScheduleCalendarId);
        const generatedItems = buildRecurringScheduleItems(nextSchedule);
        const rootItem = generatedItems[0] ?? nextSchedule;
        const createdSeed = Date.now() + index;
        const createdId = `schedule-${createdSeed}-0`;
        addSchedule(nextSchedule, { idSeed: createdSeed });

        const createdRootScheduleForHash: ScheduleItem = {
          ...rootItem,
          id: createdId,
          completed: false,
          createdAt: new Date(),
        };

        setSyncMeta((prev) =>
          updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
            ...state,
            scheduleToEventMap: {
              ...state.scheduleToEventMap,
              [createdId]: event.id,
            },
            eventToScheduleMap: {
              ...state.eventToScheduleMap,
              [event.id]: createdId,
            },
            remoteHashByScheduleId: {
              ...state.remoteHashByScheduleId,
              [createdId]: remoteHash,
            },
            localHashByScheduleId: {
              ...state.localHashByScheduleId,
              [createdId]: hashScheduleForSync(createdRootScheduleForHash),
            },
            lastInboundSyncAt: nowIso,
          })),
        );
      }
    },
    [
      activeCalendarId,
      activeSyncState.eventToScheduleMap,
      activeSyncState.localHashByScheduleId,
      activeSyncState.remoteHashByScheduleId,
      addSchedule,
      deleteSchedule,
      isAuthenticated,
      schedules,
      setSyncMeta,
      token?.accessToken,
      updateSchedule,
      upsertConflict,
    ],
  );

  const pushOutboundChanges = useCallback(
    async (inboundEvents: GoogleCalendarEventItem[] = []) => {
      if (!token?.accessToken || !isAuthenticated) {
        return;
      }

      const effectiveCalendarId = activeCalendarId;
      const scheduleById = new Map(schedules.map((item) => [item.id, item]));
      const inboundEventById = new Map(inboundEvents.map((event) => [event.id, event]));

      for (const [scheduleId, eventId] of Object.entries(activeSyncState.scheduleToEventMap)) {
        const schedule = scheduleById.get(scheduleId);
        if (!schedule) {
          try {
            await deleteGoogleCalendarEvent(token.accessToken, {
              calendarId: effectiveCalendarId,
              eventId,
            });
          } catch (error) {
            if (
              error instanceof GoogleCalendarApiError &&
              (error.status === 404 || error.status === 410)
            ) {
              // Already deleted remotely.
            } else {
              throw error;
            }
          }
          setSyncMeta((prev) =>
            updateCalendarSyncState(prev, effectiveCalendarId, (state) =>
              removeScheduleMapping(state, scheduleId, eventId),
            ),
          );
          continue;
        }

        const scheduleCalendarId = schedule.googleCalendarId || effectiveCalendarId;
        if (scheduleCalendarId !== effectiveCalendarId) {
          try {
            await deleteGoogleCalendarEvent(token.accessToken, {
              calendarId: effectiveCalendarId,
              eventId,
            });
          } catch (error) {
            if (
              error instanceof GoogleCalendarApiError &&
              (error.status === 404 || error.status === 410)
            ) {
              // Already deleted remotely.
            } else {
              throw error;
            }
          }
          setSyncMeta((prev) =>
            updateCalendarSyncState(prev, effectiveCalendarId, (state) =>
              removeScheduleMapping(state, scheduleId, eventId),
            ),
          );
          continue;
        }

        if (!isSyncRootSchedule(schedule)) {
          setSyncMeta((prev) =>
            updateCalendarSyncState(prev, effectiveCalendarId, (state) =>
              removeScheduleMapping(state, scheduleId, eventId),
            ),
          );
        }
      }

      for (const item of syncRootItems) {
        const itemCalendarId = item.googleCalendarId || effectiveCalendarId;
        if (itemCalendarId !== activeCalendarId) {
          continue;
        }
        const existingEventId = activeSyncState.scheduleToEventMap[item.id];
        const localHash = hashScheduleForSync(item);

        if (!existingEventId) {
          const createInput = toGoogleEventInput(item, itemCalendarId, item.id);
          const created = await createGoogleCalendarEvent(token.accessToken, createInput);
          const remoteHash = hashEventForSync(created);
          setSyncMeta((prev) =>
            updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
              ...state,
              scheduleToEventMap: {
                ...state.scheduleToEventMap,
                [item.id]: created.id,
              },
              eventToScheduleMap: {
                ...state.eventToScheduleMap,
                [created.id]: item.id,
              },
              remoteHashByScheduleId: {
                ...state.remoteHashByScheduleId,
                [item.id]: remoteHash,
              },
              localHashByScheduleId: {
                ...state.localHashByScheduleId,
                [item.id]: localHash,
              },
            })),
          );
          continue;
        }

        const hasConflict = conflicts.some(
          (entry) => entry.scheduleId === item.id && entry.eventId === existingEventId,
        );
        if (hasConflict) {
          continue;
        }

        const inboundEvent = inboundEventById.get(existingEventId);
        if (inboundEvent?.status === "cancelled") {
          continue;
        }

        const baselineRemoteHash = activeSyncState.remoteHashByScheduleId[item.id];
        const lastKnownLocalHash = activeSyncState.localHashByScheduleId[item.id];
        if (inboundEvent && baselineRemoteHash !== undefined && lastKnownLocalHash !== undefined) {
          const inboundRemoteHash = hashEventForSync(inboundEvent);
          const isRemoteChangedSinceLastSync = baselineRemoteHash !== inboundRemoteHash;
          const isLocalChangedSinceLastSync = lastKnownLocalHash !== localHash;
          if (isRemoteChangedSinceLastSync && isLocalChangedSinceLastSync) {
            upsertConflict({
              scheduleId: item.id,
              eventId: existingEventId,
              calendarId: effectiveCalendarId,
              scheduleTitle: item.title,
              remoteTitle: inboundEvent.summary,
              remoteUpdatedAt: inboundEvent.updated,
            });
            continue;
          }
        }

        if (lastKnownLocalHash === localHash) {
          continue;
        }

        const updatePayload: GoogleCalendarUpdateEventInput = {
          ...toGoogleEventInput(item, itemCalendarId, item.id),
          eventId: existingEventId,
        };
        const updated = await updateGoogleCalendarEvent(token.accessToken, updatePayload);
        const remoteHash = hashEventForSync(updated);
        setSyncMeta((prev) =>
          updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
            ...state,
            remoteHashByScheduleId: {
              ...state.remoteHashByScheduleId,
              [item.id]: remoteHash,
            },
            localHashByScheduleId: {
              ...state.localHashByScheduleId,
              [item.id]: localHash,
            },
          })),
        );
      }
    },
    [
      activeCalendarId,
      activeSyncState.localHashByScheduleId,
      activeSyncState.remoteHashByScheduleId,
      activeSyncState.scheduleToEventMap,
      conflicts,
      isAuthenticated,
      schedules,
      setSyncMeta,
      syncRootItems,
      token?.accessToken,
      upsertConflict,
    ],
  );

  const syncNow = useCallback(async () => {
    if (!isAuthenticated || !token?.accessToken) {
      return;
    }
    setIsManualSyncing(true);
    setSyncError(null);
    clearCalendarError();
    try {
      await ensureCalendarsLoaded();
      const inboundEvents = await loadInboundEvents();
      await pushOutboundChanges(inboundEvents);
      await applyInboundEvents(inboundEvents);
      setSyncMeta((prev) =>
        updateCalendarSyncState(
          selectCalendarSyncMeta(prev, activeCalendarId),
          activeCalendarId,
          (state) => ({
            ...state,
            lastInboundSyncAt: new Date().toISOString(),
          }),
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Google Calendar synchronization failed.";
      setSyncError(message);
      throw error;
    } finally {
      setIsManualSyncing(false);
    }
  }, [
    applyInboundEvents,
    clearCalendarError,
    ensureCalendarsLoaded,
    activeCalendarId,
    isAuthenticated,
    loadInboundEvents,
    pushOutboundChanges,
    setSyncMeta,
    token?.accessToken,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !token?.accessToken) {
      return;
    }
    if (lastKnownScheduleHashRef.current === "") {
      lastKnownScheduleHashRef.current = trackedSchedulesHash;
      return;
    }
    if (lastKnownScheduleHashRef.current === trackedSchedulesHash) {
      return;
    }
    lastKnownScheduleHashRef.current = trackedSchedulesHash;
    void syncNow().catch(() => undefined);
  }, [isAuthenticated, syncNow, token?.accessToken, trackedSchedulesHash]);

  useEffect(() => {
    if (!isAuthenticated || !token?.accessToken) {
      return;
    }
    const timer = window.setInterval(() => {
      void syncNow().catch(() => undefined);
    }, GOOGLE_SYNC_POLLING_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [isAuthenticated, syncNow, token?.accessToken]);

  useEffect(() => {
    if (!isAuthenticated || !token?.accessToken) {
      return;
    }
    if (activeSyncState.lastInboundSyncAt) {
      return;
    }
    void (async () => {
      try {
        const effectiveCalendarId = activeCalendarId;
        const seededEvents = await listGoogleCalendarEvents(token.accessToken, {
          calendarId: effectiveCalendarId,
          maxResults: 250,
          singleEvents: true,
          orderBy: "updated",
          showDeleted: false,
          timeMin: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          timeMax: new Date(
            Date.now() + GOOGLE_SYNC_DEFAULT_PULL_RANGE_DAYS * 24 * 60 * 60 * 1000,
          ).toISOString(),
        });
        await applyInboundEvents(seededEvents);
        setSyncMeta((prev) =>
          updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
            ...state,
            lastInboundSyncAt: new Date().toISOString(),
          })),
        );
      } catch {
        // Surface errors through explicit manual sync path to avoid noisy startup loops.
      }
    })();
  }, [
    activeCalendarId,
    activeSyncState.lastInboundSyncAt,
    applyInboundEvents,
    isAuthenticated,
    setSyncMeta,
    token?.accessToken,
  ]);

  const handleSetSelectedCalendarId = useCallback(
    (calendarId: string) => {
      const normalized = calendarId.trim();
      if (!normalized) {
        return;
      }
      setSelectedCalendarId(normalized);
      setSyncMeta((prev) => selectCalendarSyncMeta(prev, normalized));
      setConflictsRaw([]);
      setSyncError(null);
      clearCalendarError();
    },
    [clearCalendarError, setConflictsRaw, setSelectedCalendarId, setSyncMeta],
  );

  const resolveConflictKeepLocal = useCallback(
    async (conflictId: string) => {
      const conflict = conflicts.find((entry) => entry.id === conflictId);
      if (!conflict || !token?.accessToken || !isAuthenticated) {
        return;
      }
      const target = schedules.find((item) => item.id === conflict.scheduleId);
      if (!target) {
        removeConflict(conflictId);
        return;
      }
      const targetCalendarId = target.googleCalendarId || conflict.calendarId || activeCalendarId;
      const payload: GoogleCalendarUpdateEventInput = {
        ...toGoogleEventInput(target, targetCalendarId, target.id),
        eventId: conflict.eventId,
      };
      const updated = await updateGoogleCalendarEvent(token.accessToken, payload);
      const localHash = hashScheduleForSync(target);
      setSyncMeta((prev) =>
        updateCalendarSyncState(prev, targetCalendarId, (state) => ({
          ...state,
          remoteHashByScheduleId: {
            ...state.remoteHashByScheduleId,
            [target.id]: hashEventForSync(updated),
          },
          localHashByScheduleId: {
            ...state.localHashByScheduleId,
            [target.id]: localHash,
          },
        })),
      );
      removeConflict(conflictId);
    },
    [
      activeCalendarId,
      conflicts,
      isAuthenticated,
      removeConflict,
      schedules,
      setSyncMeta,
      token?.accessToken,
    ],
  );

  const resolveConflictKeepRemote = useCallback(
    async (conflictId: string) => {
      const conflict = conflicts.find((entry) => entry.id === conflictId);
      if (!conflict || !token?.accessToken || !isAuthenticated) {
        return;
      }
      const effectiveCalendarId = conflict.calendarId || activeCalendarId;
      const events = await listGoogleCalendarEvents(token.accessToken, {
        calendarId: effectiveCalendarId,
        maxResults: 250,
        singleEvents: true,
        orderBy: "updated",
      });
      const event = events.find((item) => item.id === conflict.eventId);
      if (!event) {
        removeConflict(conflictId);
        return;
      }
      if (event.status === "cancelled") {
        deleteSchedule(conflict.scheduleId, "single");
        removeConflict(conflictId);
        setSyncMeta((prev) =>
          updateCalendarSyncState(prev, effectiveCalendarId, (state) =>
            removeScheduleMapping(state, conflict.scheduleId, conflict.eventId),
          ),
        );
        return;
      }
      const target = schedules.find((item) => item.id === conflict.scheduleId);
      if (!target) {
        removeConflict(conflictId);
        return;
      }

      const nextSchedule = buildScheduleFromEvent(event, effectiveCalendarId);
      const projected = buildProjectedLocalSchedule(target, nextSchedule);
      updateSchedule(conflict.scheduleId, {
        title: nextSchedule.title,
        dueDate: nextSchedule.dueDate,
        endDate: nextSchedule.endDate,
        isAllDay: nextSchedule.isAllDay,
        color: nextSchedule.color,
        location: nextSchedule.location,
        notes: nextSchedule.notes,
        googleCalendarId: nextSchedule.googleCalendarId,
        recurrence: nextSchedule.recurrence ?? null,
        mode: "schedule",
      });
      setSyncMeta((prev) =>
        updateCalendarSyncState(prev, effectiveCalendarId, (state) => ({
          ...state,
          remoteHashByScheduleId: {
            ...state.remoteHashByScheduleId,
            [conflict.scheduleId]: hashEventForSync(event),
          },
          localHashByScheduleId: {
            ...state.localHashByScheduleId,
            [conflict.scheduleId]: hashScheduleForSync(projected),
          },
        })),
      );
      removeConflict(conflictId);
    },
    [
      activeCalendarId,
      conflicts,
      deleteSchedule,
      isAuthenticated,
      removeConflict,
      schedules,
      setSyncMeta,
      token?.accessToken,
      updateSchedule,
    ],
  );

  return {
    isSyncing:
      isManualSyncing ||
      isLoading ||
      isFetchingEvents ||
      isListingCalendars ||
      isCreatingEvent ||
      isUpdatingEvent ||
      isDeletingEvent,
    isAutoSyncEnabled: isAuthenticated,
    isAuthenticated,
    calendars,
    selectedCalendarId,
    conflicts,
    syncError,
    calendarError,
    lastSyncedAt,
    login,
    logout,
    refreshCalendars,
    setSelectedCalendarId: handleSetSelectedCalendarId,
    syncNow,
    resolveConflictKeepLocal,
    resolveConflictKeepRemote,
    clearSyncError: () => setSyncError(null),
    clearCalendarError,
  };
}
