import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { useSchedule } from "./useSchedule";
import { useEffortLog } from "./useEffortLog";
import { useTags, DEFAULT_COLORS } from "./useTags";
import { useCalendarSharing } from "./useCalendarSharing";
import { sendChatMessageWithContext } from "@/services/chatService";
import { loadLatestPhotoCheckResult } from "@/services/photoAnalysisService";
import { synthesizeSpeech, createAudioUrl, revokeAudioUrl } from "@/services/speechService";
import { checkScheduleConflicts, isOverdue } from "@/lib/scheduleConflicts";
import { getVisibleScheduleConflicts } from "@/lib/conflictWarningFilter";
import { fillMissingActionFields } from "@/lib/secretaryFieldFallback";
import { formatSecretaryResponse } from "@/lib/secretaryResponse";
import { isGenerativeUiRequest, parseGenerativeUiInput } from "@/lib/generativeUi";
import { isTailwindThemeRequest, parseTailwindThemeInput } from "@/lib/tailwindTheme";
import {
  DEFAULT_SECRETARY_MODEL,
  isSecretaryModelId,
  SECRETARY_MODEL_STORAGE_KEY,
  type SecretaryModelId,
} from "@/lib/secretaryModels";
import type {
  ChatRequestMode,
  ChatMessage,
  ChatThread,
  SecretaryAction,
  SecretaryContext,
  SecretaryEffortSummary,
  SecretaryPriorityHints,
  SecretaryPriorityItem,
  SecretaryScheduleContext,
  SecretarySchedulingContext,
  SecretarySchedulingParticipant,
  SecretaryParticipantBusyWindow,
  SecretaryFreeSlotCandidate,
  ScheduleItem,
  ExecutedAction,
  ScheduleConflict,
  EffortCategory,
  EffortDailySummary,
  RepeatWeekday,
  ScheduleMutationScope,
  ScheduleRecurrenceInput,
  SharedCalendarMeta,
} from "@/types";

// Re-export for convenience
export { checkScheduleConflicts, isOverdue };

const THREADS_STORAGE_KEY = "grass-secretary-chat-threads";
const ACTIVE_THREAD_STORAGE_KEY = "grass-secretary-active-thread-id";
const LEGACY_CHAT_STORAGE_KEY = "grass-secretary-chat";
const DEADLINE_SOON_MS = 48 * 60 * 60 * 1000;
const UPCOMING_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_EFFORT_DAYS = 7;
const MAX_PRIORITY_ITEMS = 6;
const MAX_TOP_EFFORT_CATEGORIES = 3;
const SCHEDULING_SEARCH_WINDOW_DAYS = 14;
const SCHEDULING_SLOT_MINUTES = 30;
const MAX_FREE_SLOT_CANDIDATES = 12;
const THREAD_IMAGE_DATA_URL_MAX_LENGTH = 200_000;
const THREAD_IMAGE_TOTAL_BUDGET = 900_000;
const DEFAULT_THREAD_TITLE = "チャット";

const EFFORT_CATEGORY_LABELS: Record<EffortCategory, string> = {
  ai_chat: "AI会話",
  schedule_create: "予定/タスク作成",
  task_complete: "タスク完了",
  photo_check: "写真チェック",
};

// Action parsing regex patterns
const ACTION_PATTERNS = {
  ADD_SCHEDULE: /\[ADD_SCHEDULE:\s*(\{[\s\S]*?\})\s*\]/g,
  UPDATE_SCHEDULE: /\[UPDATE_SCHEDULE:\s*(\{[\s\S]*?\})\s*\]/g,
  COMPLETE_SCHEDULE: /\[COMPLETE_SCHEDULE:\s*(\{[^}]+\})\]/g,
  DELETE_SCHEDULE: /\[DELETE_SCHEDULE:\s*(\{[^}]+\})\]/g,
};

function normalizeWeekdaysForAction(value: unknown): RepeatWeekday[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const weekdays = value
    .map((entry) => {
      if (typeof entry === "number") {
        return entry;
      }
      if (typeof entry === "string" && entry.trim().length > 0) {
        return Number.parseInt(entry, 10);
      }
      return Number.NaN;
    })
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6) as RepeatWeekday[];

  return [...new Set(weekdays)].sort((a, b) => a - b);
}

function normalizeRecurrenceForAction(value: unknown): ScheduleRecurrenceInput | null | undefined {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const weekdays = normalizeWeekdaysForAction((value as { weekdays?: unknown }).weekdays);
  const rawIsInfinite = (value as { isInfinite?: unknown }).isInfinite;
  const isInfinite = rawIsInfinite === true;
  const rawCount = (value as { count?: unknown }).count;
  const countRaw =
    typeof rawCount === "number"
      ? rawCount
      : typeof rawCount === "string" && rawCount.trim().length > 0
        ? Number.parseInt(rawCount, 10)
        : undefined;
  const count =
    typeof countRaw === "number" && Number.isFinite(countRaw) ? Math.floor(countRaw) : undefined;

  if (weekdays.length === 0) {
    return undefined;
  }
  if (isInfinite) {
    return { weekdays, isInfinite: true };
  }
  if (!count || count <= 1) {
    return undefined;
  }

  return {
    weekdays,
    count,
  };
}

function normalizeActionScope(value: unknown): ScheduleMutationScope | undefined {
  if (value === "single" || value === "all" || value === "future") {
    return value;
  }
  return undefined;
}

function collectScopedSeriesSchedules(
  schedules: ScheduleItem[],
  target: ScheduleItem,
  scope: ScheduleMutationScope,
): ScheduleItem[] {
  const seriesId = target.recurrence?.seriesId;
  if (!seriesId || scope === "single") {
    return [target];
  }
  const sameSeries = schedules.filter((item) => item.recurrence?.seriesId === seriesId);
  if (scope === "all") {
    return sameSeries;
  }
  const targetDue = new Date(target.dueDate).getTime();
  return sameSeries.filter((item) => new Date(item.dueDate).getTime() >= targetDue);
}

interface UseSecretaryReturn {
  threads: ChatThread[];
  activeThreadId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  pendingActions: SecretaryAction[];
  lastExecutedAction: ExecutedAction | null;
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
  sendMessageAndGetReply: (content: string, options?: SendMessageOptions) => Promise<string | null>;
  retryUserMessage: (messageId: string) => Promise<string | null>;
  retryLastUserMessage: () => Promise<string | null>;
  cancelCurrentResponse: () => void;
  deleteMessage: (messageId: string) => void;
  clearMessages: () => void;
  playVoice: (messageId: string) => Promise<void>;
  isPlaying: string | null;
  createThread: (title?: string) => string;
  selectThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string) => void;
  deleteThread: (threadId: string) => void;
  executeAction: (action: SecretaryAction) => void;
  dismissAction: (index: number) => void;
  executeAllActions: () => void;
  undoLastAction: () => void;
  getScheduleById: (id: string) => ScheduleItem | null;
  getScheduleByTitle: (title: string) => ScheduleItem | null;
  selectedModel: SecretaryModelId;
  setSelectedModel: (model: SecretaryModelId) => void;
  secretaryContext: SecretaryContext;
  checkConflicts: (
    dueDate: string,
    endDate?: string,
    targetMode?: ScheduleItem["mode"],
    targetIsAllDay?: boolean,
    targetId?: string,
    targetTitle?: string,
  ) => ScheduleConflict[];
}

interface SendMessageOptions {
  threadId?: string;
  imageAttachmentDataUrl?: string;
  imageAttachmentName?: string;
  requestMode?: ChatRequestMode;
  userPreferences?: string;
  currentNeed?: string;
}

interface UseSecretaryOptions {
  selectedModel?: SecretaryModelId;
  onSelectedModelChange?: (model: SecretaryModelId) => void;
}

function formatDateForContext(date: Date): string {
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getRecentDateKeys(baseDate: Date, days: number): Set<string> {
  const keys = new Set<string>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(baseDate);
    date.setDate(baseDate.getDate() - offset);
    keys.add(formatDateKey(date));
  }
  return keys;
}

function buildEffortSummary(
  dailySummaries: EffortDailySummary[],
  currentStreak: number,
  today: Date,
): SecretaryEffortSummary {
  const todayKey = formatDateKey(today);
  const recentDateKeys = getRecentDateKeys(today, RECENT_EFFORT_DAYS);
  const recentSummaries = dailySummaries.filter((summary) => recentDateKeys.has(summary.date));
  const effectiveSummaries =
    recentSummaries.length > 0 ? recentSummaries : dailySummaries.slice(-RECENT_EFFORT_DAYS);

  const todayActivityCount =
    dailySummaries.find((summary) => summary.date === todayKey)?.totalCount ?? 0;
  const recentActivityCount = effectiveSummaries.reduce(
    (sum, summary) => sum + summary.totalCount,
    0,
  );
  const recentActiveDays = effectiveSummaries.filter((summary) => summary.totalCount > 0).length;
  const categoryTotals = new Map<EffortCategory, number>();

  for (const summary of effectiveSummaries) {
    for (const [category, score] of Object.entries(summary.categoryScores) as [
      EffortCategory,
      number,
    ][]) {
      if (score <= 0) continue;
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + score);
    }
  }

  const topCategories = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOP_EFFORT_CATEGORIES)
    .map(([category]) => EFFORT_CATEGORY_LABELS[category]);

  return {
    currentStreak,
    todayActivityCount,
    recentActivityCount,
    recentActiveDays,
    topCategories,
  };
}

function buildPriorityHints(relevantSchedules: ScheduleItem[], now: Date): SecretaryPriorityHints {
  interface InternalPriorityItem {
    item: SecretaryPriorityItem;
    dueAt: number;
  }

  const candidates = new Map<string, InternalPriorityItem>();
  const activeSchedules = relevantSchedules.filter((schedule) => !schedule.completed);
  const conflictIds = new Set<string>();

  const upsertPriorityItem = (
    schedule: ScheduleItem,
    reason: SecretaryPriorityItem["reason"],
    priority: SecretaryPriorityItem["priority"],
  ) => {
    const dueAt = new Date(schedule.dueDate).getTime();
    const includeTime = !(schedule.mode === "schedule" && schedule.isAllDay);
    const candidate: InternalPriorityItem = {
      item: {
        title: schedule.title,
        reason,
        dueDate: formatDateShort(new Date(schedule.dueDate), includeTime),
        priority,
      },
      dueAt,
    };
    const existing = candidates.get(schedule.id);
    if (!existing || candidate.item.priority < existing.item.priority) {
      candidates.set(schedule.id, candidate);
    }
  };

  for (const schedule of activeSchedules) {
    if (schedule.mode !== "schedule") continue;
    const conflicts = checkScheduleConflicts(
      activeSchedules,
      schedule.dueDate,
      schedule.endDate,
      schedule.id,
      "schedule",
      schedule.isAllDay,
    );
    if (conflicts.length > 0) {
      conflictIds.add(schedule.id);
    }
  }

  for (const schedule of activeSchedules) {
    const dueAt = new Date(schedule.dueDate).getTime();
    const diffMs = dueAt - now.getTime();

    if (schedule.mode === "task" && isOverdue(schedule)) {
      upsertPriorityItem(schedule, "overdue", 1);
      continue;
    }

    if (schedule.mode === "task" && diffMs >= 0 && diffMs <= DEADLINE_SOON_MS) {
      upsertPriorityItem(schedule, "deadline_soon", 2);
      continue;
    }

    if (schedule.mode === "schedule" && conflictIds.has(schedule.id)) {
      upsertPriorityItem(schedule, "schedule_conflict", 2);
      continue;
    }

    if (diffMs >= 0 && diffMs <= UPCOMING_LOOKAHEAD_MS) {
      upsertPriorityItem(schedule, "upcoming", 3);
    }
  }

  const sortedItems = [...candidates.values()]
    .sort((a, b) => {
      if (a.item.priority !== b.item.priority) {
        return a.item.priority - b.item.priority;
      }
      return a.dueAt - b.dueAt;
    })
    .slice(0, MAX_PRIORITY_ITEMS)
    .map((entry) => entry.item);

  return {
    hasUrgentItems: sortedItems.some((item) => item.priority <= 2),
    hasScheduleConflicts: conflictIds.size > 0,
    items: sortedItems,
  };
}

interface BusyInterval {
  start: number;
  end: number;
}

function getScheduleBusyInterval(schedule: ScheduleItem): BusyInterval | null {
  if (schedule.mode !== "schedule") {
    return null;
  }

  const start = new Date(schedule.dueDate).getTime();
  if (!Number.isFinite(start)) {
    return null;
  }

  let end: number;
  if (schedule.endDate) {
    end = new Date(schedule.endDate).getTime();
  } else if (schedule.isAllDay) {
    const endOfDay = new Date(schedule.dueDate);
    endOfDay.setHours(23, 59, 59, 999);
    end = endOfDay.getTime();
  } else {
    end = start + SCHEDULING_SLOT_MINUTES * 60 * 1000;
  }

  if (!Number.isFinite(end) || end <= start) {
    end = start + SCHEDULING_SLOT_MINUTES * 60 * 1000;
  }

  return { start, end };
}

function mergeBusyIntervals(intervals: BusyInterval[]): BusyInterval[] {
  if (intervals.length <= 1) {
    return intervals;
  }

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: BusyInterval[] = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function alignToNextSlotBoundary(base: Date): number {
  const slotMs = SCHEDULING_SLOT_MINUTES * 60 * 1000;
  return Math.ceil(base.getTime() / slotMs) * slotMs;
}

function createSchedulingParticipants(
  sharing: SharedCalendarMeta,
  schedules: ScheduleItem[],
): SecretarySchedulingParticipant[] {
  const ownerUserId = sharing.owner.userId || "owner-local";
  const participantsById = new Map<string, SecretarySchedulingParticipant>();

  participantsById.set(ownerUserId, {
    id: ownerUserId,
    displayName: sharing.owner.displayName || "あなた",
    calendarId: sharing.calendarId,
    visibilityMode: "full_details",
  });

  for (const member of sharing.members) {
    participantsById.set(member.userId, {
      id: member.userId,
      displayName: member.displayName || member.email || member.userId,
      visibilityMode: member.role === "VIEWER_FREE_BUSY" ? "free_busy_only" : "full_details",
    });
  }

  for (const item of schedules) {
    const participantId = item.ownerId || ownerUserId;
    if (participantsById.has(participantId)) {
      continue;
    }
    participantsById.set(participantId, {
      id: participantId,
      displayName: item.ownerDisplayName || participantId,
      visibilityMode: "full_details",
    });
  }

  return [...participantsById.values()];
}

function buildSchedulingContext(
  schedules: ScheduleItem[],
  sharing: SharedCalendarMeta,
  now: Date,
): SecretarySchedulingContext {
  const participants = createSchedulingParticipants(sharing, schedules);
  const ownerUserId = sharing.owner.userId || "owner-local";
  const participantsById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  const busyIntervalsByParticipant = new Map<string, BusyInterval[]>(
    participants.map((participant) => [participant.id, []]),
  );

  const searchWindowStartMs = now.getTime();
  const searchWindowEndMs =
    searchWindowStartMs + SCHEDULING_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const busyWindows: SecretaryParticipantBusyWindow[] = [];

  for (const schedule of schedules) {
    const interval = getScheduleBusyInterval(schedule);
    if (!interval) {
      continue;
    }
    if (interval.end <= searchWindowStartMs || interval.start >= searchWindowEndMs) {
      continue;
    }

    const participantId = schedule.ownerId || ownerUserId;
    if (!participantsById.has(participantId)) {
      const fallbackParticipant: SecretarySchedulingParticipant = {
        id: participantId,
        displayName: schedule.ownerDisplayName || participantId,
        visibilityMode: "full_details",
      };
      participantsById.set(participantId, fallbackParticipant);
      busyIntervalsByParticipant.set(participantId, []);
      participants.push(fallbackParticipant);
    }
    const participant = participantsById.get(participantId)!;

    const clippedStart = Math.max(interval.start, searchWindowStartMs);
    const clippedEnd = Math.min(interval.end, searchWindowEndMs);
    if (clippedEnd <= clippedStart) {
      continue;
    }

    const shouldHideDetails =
      participant.visibilityMode === "free_busy_only" ||
      (Boolean(schedule.isPrivate) && participantId !== ownerUserId);
    busyWindows.push({
      participantId,
      start: new Date(clippedStart).toISOString(),
      end: new Date(clippedEnd).toISOString(),
      isAllDay: schedule.mode === "schedule" ? Boolean(schedule.isAllDay) : undefined,
      ...(shouldHideDetails ? {} : { title: schedule.title }),
      ...(!shouldHideDetails && schedule.notes ? { notes: schedule.notes } : {}),
    });
    const intervals = busyIntervalsByParticipant.get(participantId) ?? [];
    intervals.push({ start: clippedStart, end: clippedEnd });
    busyIntervalsByParticipant.set(participantId, intervals);
  }

  busyWindows.sort((a, b) => {
    const startDiff = new Date(a.start).getTime() - new Date(b.start).getTime();
    if (startDiff !== 0) {
      return startDiff;
    }
    return a.participantId.localeCompare(b.participantId);
  });

  const mergedBusyByParticipant = new Map<string, BusyInterval[]>();
  for (const [participantId, intervals] of busyIntervalsByParticipant.entries()) {
    mergedBusyByParticipant.set(participantId, mergeBusyIntervals(intervals));
  }

  const participantIds = participants.map((participant) => participant.id);
  const slotMs = SCHEDULING_SLOT_MINUTES * 60 * 1000;
  const freeSlotCandidates: SecretaryFreeSlotCandidate[] = [];
  let cursorMs = alignToNextSlotBoundary(now);

  while (
    cursorMs + slotMs <= searchWindowEndMs &&
    freeSlotCandidates.length < MAX_FREE_SLOT_CANDIDATES
  ) {
    const slotEndMs = cursorMs + slotMs;
    const isAvailableForAll = participantIds.every((participantId) => {
      const participantIntervals = mergedBusyByParticipant.get(participantId) ?? [];
      return !participantIntervals.some(
        (interval) => interval.start < slotEndMs && interval.end > cursorMs,
      );
    });

    if (isAvailableForAll) {
      freeSlotCandidates.push({
        start: new Date(cursorMs).toISOString(),
        end: new Date(slotEndMs).toISOString(),
        durationMinutes: SCHEDULING_SLOT_MINUTES,
        participantIds,
      });
    }

    cursorMs += slotMs;
  }

  return {
    searchWindowDays: SCHEDULING_SEARCH_WINDOW_DAYS,
    allowOutsideWorkingHours: true,
    participants,
    busyWindows,
    freeSlotCandidates,
  };
}

function buildSecretaryContext(
  schedules: ScheduleItem[],
  dailySummaries: EffortDailySummary[],
  currentStreak: number,
  sharing: SharedCalendarMeta,
): SecretaryContext {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  // Filter relevant schedules (upcoming 7 days + overdue)
  const relevantSchedules = schedules.filter((item) => {
    const dueDate = new Date(item.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const endDate = item.endDate ? new Date(item.endDate) : dueDate;
    endDate.setHours(0, 0, 0, 0);

    // Include if: ongoing, upcoming within 7 days, or overdue
    return endDate >= today || (dueDate < today && !item.completed);
  });

  const scheduleContexts: SecretaryScheduleContext[] = relevantSchedules.map((item) => ({
    id: item.id,
    title: item.title,
    mode: item.mode,
    dueDate: formatDateShort(new Date(item.dueDate), !item.isAllDay),
    endDate: item.endDate ? formatDateShort(new Date(item.endDate), !item.isAllDay) : undefined,
    isAllDay: item.mode === "schedule" ? item.isAllDay : undefined,
    completed: item.completed,
    isOverdue: isOverdue(item),
    tags: item.tags.map((t) => t.name),
    location: item.location,
    items: item.items,
    recurrence: item.recurrence
      ? {
          weekdays: item.recurrence.weekdays,
          ...(typeof item.recurrence.count === "number" ? { count: item.recurrence.count } : {}),
          ...(item.recurrence.isInfinite ? { isInfinite: true } : {}),
          ...(typeof item.recurrence.occurrenceIndex === "number"
            ? { occurrenceIndex: item.recurrence.occurrenceIndex }
            : {}),
        }
      : undefined,
  }));

  const upcomingCount = relevantSchedules.filter((s) => !s.completed && !isOverdue(s)).length;
  const overdueCount = relevantSchedules.filter((s) => isOverdue(s)).length;
  const completedTodayCount = schedules.filter((s) => {
    if (!s.completed) return false;
    // Assuming completed items don't have a completion timestamp,
    // we check if due date is today (approximation)
    const dueDate = new Date(s.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    return dueDate.getTime() === today.getTime();
  }).length;

  const effortSummary = buildEffortSummary(dailySummaries, currentStreak, now);
  const priorityHints = buildPriorityHints(relevantSchedules, now);
  const scheduling = buildSchedulingContext(schedules, sharing, now);

  return {
    currentDate: formatDateForContext(now),
    schedules: scheduleContexts,
    upcomingCount,
    overdueCount,
    completedTodayCount,
    effortSummary,
    priorityHints,
    scheduling,
  };
}

function toDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const imageAttachmentDataUrl =
    typeof message.imageAttachmentDataUrl === "string" &&
    message.imageAttachmentDataUrl.trim().length > 0
      ? message.imageAttachmentDataUrl
      : undefined;
  return {
    ...message,
    timestamp: toDate(message.timestamp),
    requestMode:
      message.requestMode === "generative_ui" || message.requestMode === "tailwind_theme"
        ? message.requestMode
        : "default",
    imageAttachmentDataUrl,
    hasImageAttachment: Boolean(message.hasImageAttachment || imageAttachmentDataUrl),
  };
}

function normalizeExecutedAction(action: ExecutedAction | null): ExecutedAction | null {
  if (!action) return null;
  const undoData = action.undoData
    ? {
        ...action.undoData,
        scheduleData: action.undoData.scheduleData
          ? {
              ...action.undoData.scheduleData,
              dueDate: toDate(action.undoData.scheduleData.dueDate),
              endDate: action.undoData.scheduleData.endDate
                ? toDate(action.undoData.scheduleData.endDate)
                : undefined,
              createdAt: toDate(action.undoData.scheduleData.createdAt),
            }
          : undefined,
      }
    : undefined;
  return {
    ...action,
    timestamp: toDate(action.timestamp),
    undoData,
  };
}

function normalizeThread(thread: ChatThread): ChatThread {
  return {
    ...thread,
    isTitleManuallyEdited: thread.isTitleManuallyEdited === true,
    messages: Array.isArray(thread.messages) ? thread.messages.map(normalizeChatMessage) : [],
    pendingActions: Array.isArray(thread.pendingActions) ? thread.pendingActions : [],
    lastExecutedAction: normalizeExecutedAction(thread.lastExecutedAction),
    createdAt: toDate(thread.createdAt),
    updatedAt: toDate(thread.updatedAt),
  };
}

function dedupeThreadsById(threads: ChatThread[]): { threads: ChatThread[]; changed: boolean } {
  const seen = new Set<string>();
  let changed = false;
  const uniqueThreads: ChatThread[] = [];

  for (const thread of threads) {
    if (seen.has(thread.id)) {
      changed = true;
      continue;
    }
    seen.add(thread.id);
    uniqueThreads.push(thread);
  }

  return { threads: uniqueThreads, changed };
}

function compactChatThreadsForStorage(threads: ChatThread[]): {
  threads: ChatThread[];
  changed: boolean;
} {
  const imageCandidates: Array<{
    key: string;
    timestamp: number;
    length: number;
  }> = [];

  for (const thread of threads) {
    for (const message of thread.messages) {
      const imageDataUrl =
        typeof message.imageAttachmentDataUrl === "string"
          ? message.imageAttachmentDataUrl.trim()
          : "";
      if (!imageDataUrl) {
        continue;
      }
      imageCandidates.push({
        key: `${thread.id}:${message.id}`,
        timestamp: toDate(message.timestamp).getTime(),
        length: imageDataUrl.length,
      });
    }
  }

  const sortedCandidates = imageCandidates
    .filter((candidate) => candidate.length <= THREAD_IMAGE_DATA_URL_MAX_LENGTH)
    .sort((a, b) => b.timestamp - a.timestamp);
  const keepImageKeys = new Set<string>();
  let totalImageLength = 0;
  for (const candidate of sortedCandidates) {
    if (totalImageLength + candidate.length > THREAD_IMAGE_TOTAL_BUDGET) {
      continue;
    }
    keepImageKeys.add(candidate.key);
    totalImageLength += candidate.length;
  }

  let changed = false;
  const compactedThreads = threads.map((thread) => {
    let threadChanged = false;

    const messages = thread.messages.map((message) => {
      const imageDataUrl =
        typeof message.imageAttachmentDataUrl === "string"
          ? message.imageAttachmentDataUrl.trim()
          : "";
      if (!imageDataUrl) {
        return message;
      }

      const key = `${thread.id}:${message.id}`;
      const shouldDropImage =
        imageDataUrl.length > THREAD_IMAGE_DATA_URL_MAX_LENGTH || !keepImageKeys.has(key);
      if (!shouldDropImage) {
        if (imageDataUrl === message.imageAttachmentDataUrl && message.hasImageAttachment) {
          return message;
        }
        threadChanged = true;
        changed = true;
        return {
          ...message,
          hasImageAttachment: true,
          imageAttachmentDataUrl: imageDataUrl,
        };
      }

      threadChanged = true;
      changed = true;
      return {
        ...message,
        hasImageAttachment: true,
        imageAttachmentDataUrl: undefined,
      };
    });

    if (!threadChanged) {
      return thread;
    }

    return {
      ...thread,
      messages,
    };
  });

  return { threads: compactedThreads, changed };
}

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getNextThreadTitle(threads: ChatThread[]): string {
  const existing = new Set(threads.map((t) => t.title));
  let index = 1;
  while (existing.has(`チャット ${index}`)) {
    index += 1;
  }
  return `チャット ${index}`;
}

function stripMarkdownForTitle(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/^ {0,3}\[[^\]]+\]:\s+\S+.*$/gm, " ")
    .replace(/```(?:[\w-]+)?\n?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/`+/g, " ")
    .replace(/!\[([^\]]*)\]\((?:[^()\\]|\\.)*\)/g, "$1")
    .replace(/\[([^\]]+)\]\((?:[^()\\]|\\.)*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*]/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s{0,3}\[(?: |x|X)\]\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, " ")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+.!>~-])/g, "$1");
}

function normalizeTitleText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .trim();
}

function summarizeTitleFragment(text: string): string {
  const normalized = normalizeTitleText(stripMarkdownForTitle(text));
  if (!normalized) {
    return "";
  }

  const sentence =
    normalized
      .split(/[。!！?？]+/u)
      .map((part) => normalizeTitleText(part))
      .find((part) => part.length > 0) ?? normalized;

  const withoutIntro = sentence.replace(
    /^(?:はい|了解(?:しました)?|承知(?:しました)?|もちろん|まず|結論(?:として)?|要点(?:として)?|最優先は|優先は)\s*/u,
    "",
  );

  const withoutOutro = withoutIntro.replace(
    /\s*(?:です|ます|でした|でしたら|のだ|なのだ)\s*$/u,
    "",
  );

  return normalizeTitleText(withoutOutro || sentence);
}

function generateThreadTitle(options: {
  latestUserContent: string;
  latestAssistantContent: string;
  fallbackTitle: string;
}): string {
  const latestUser = summarizeTitleFragment(options.latestUserContent);
  const latestAssistant = summarizeTitleFragment(options.latestAssistantContent);
  const merged = normalizeTitleText(
    latestUser && latestAssistant
      ? latestAssistant.includes(latestUser)
        ? latestAssistant
        : latestUser.includes(latestAssistant)
          ? latestUser
          : `${latestUser} ${latestAssistant}`
      : latestUser || latestAssistant,
  );
  const fallback = normalizeTitleText(stripMarkdownForTitle(options.fallbackTitle));
  const candidate = merged || latestUser || latestAssistant || fallback || DEFAULT_THREAD_TITLE;
  return candidate || DEFAULT_THREAD_TITLE;
}

function createThread(options: {
  title: string;
  messages?: ChatMessage[];
  pendingActions?: SecretaryAction[];
  lastExecutedAction?: ExecutedAction | null;
  isTitleManuallyEdited?: boolean;
}): ChatThread {
  const now = new Date();
  const messages = options.messages ?? [];
  return {
    id: createThreadId(),
    title: options.title,
    isTitleManuallyEdited: options.isTitleManuallyEdited ?? false,
    messages,
    pendingActions: options.pendingActions ?? [],
    lastExecutedAction: options.lastExecutedAction ?? null,
    createdAt: now,
    updatedAt: messages.at(-1)?.timestamp ?? now,
  };
}

export function parseActionsFromResponse(content: string): {
  cleanContent: string;
  actions: SecretaryAction[];
} {
  const actions: SecretaryAction[] = [];
  let cleanContent = content;

  // Parse ADD_SCHEDULE actions
  let match: RegExpExecArray | null;
  while ((match = ACTION_PATTERNS.ADD_SCHEDULE.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1]);
      const recurrence = normalizeRecurrenceForAction(payload.recurrence);
      actions.push({
        type: "add_schedule",
        payload: {
          title: payload.title,
          mode: payload.mode || "task",
          dueDate: payload.dueDate,
          endDate: payload.endDate,
          ...(payload.isAllDay !== undefined ? { isAllDay: payload.isAllDay } : {}),
          ...(Array.isArray(payload.tags) && payload.tags.length > 0 ? { tags: payload.tags } : {}),
          ...(recurrence && recurrence !== null ? { recurrence } : {}),
          location: payload.location,
          items: payload.items,
          participants: payload.participants,
          url: payload.url,
          notes: payload.notes,
        },
      });
      cleanContent = cleanContent.replace(match[0], "").trim();
    } catch (e) {
      console.warn("Failed to parse ADD_SCHEDULE action:", e);
    }
  }

  // Reset regex lastIndex
  ACTION_PATTERNS.ADD_SCHEDULE.lastIndex = 0;

  // Parse UPDATE_SCHEDULE actions
  while ((match = ACTION_PATTERNS.UPDATE_SCHEDULE.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1]);
      const scope = normalizeActionScope(payload.scope);
      const updates = payload.updates ?? {};
      const recurrence = normalizeRecurrenceForAction(updates.recurrence);
      actions.push({
        type: "update_schedule",
        payload: {
          id: payload.id,
          title: payload.title,
          ...(scope ? { scope } : {}),
          updates: {
            ...(updates.title !== undefined ? { title: updates.title } : {}),
            ...(updates.dueDate !== undefined ? { dueDate: updates.dueDate } : {}),
            ...(updates.endDate !== undefined ? { endDate: updates.endDate } : {}),
            ...(updates.isAllDay !== undefined ? { isAllDay: updates.isAllDay } : {}),
            ...(Array.isArray(updates.tags) && updates.tags.length > 0
              ? { tags: updates.tags }
              : {}),
            ...(updates.location !== undefined ? { location: updates.location } : {}),
            ...(updates.items !== undefined ? { items: updates.items } : {}),
            ...(updates.participants !== undefined ? { participants: updates.participants } : {}),
            ...(updates.url !== undefined ? { url: updates.url } : {}),
            ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
            ...(recurrence !== undefined ? { recurrence } : {}),
          },
        },
      });
      cleanContent = cleanContent.replace(match[0], "").trim();
    } catch (e) {
      console.warn("Failed to parse UPDATE_SCHEDULE action:", e);
    }
  }

  ACTION_PATTERNS.UPDATE_SCHEDULE.lastIndex = 0;

  // Parse COMPLETE_SCHEDULE actions
  while ((match = ACTION_PATTERNS.COMPLETE_SCHEDULE.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1]);
      actions.push({
        type: "complete_schedule",
        payload: {
          id: payload.id,
          title: payload.title,
        },
      });
      cleanContent = cleanContent.replace(match[0], "").trim();
    } catch (e) {
      console.warn("Failed to parse COMPLETE_SCHEDULE action:", e);
    }
  }

  ACTION_PATTERNS.COMPLETE_SCHEDULE.lastIndex = 0;

  // Parse DELETE_SCHEDULE actions
  while ((match = ACTION_PATTERNS.DELETE_SCHEDULE.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1]);
      const scope = normalizeActionScope(payload.scope);
      actions.push({
        type: "delete_schedule",
        payload: {
          id: payload.id,
          title: payload.title,
          ...(scope ? { scope } : {}),
        },
      });
      cleanContent = cleanContent.replace(match[0], "").trim();
    } catch (e) {
      console.warn("Failed to parse DELETE_SCHEDULE action:", e);
    }
  }

  ACTION_PATTERNS.DELETE_SCHEDULE.lastIndex = 0;

  return { cleanContent, actions };
}

function findScheduleByTitle(schedules: ScheduleItem[], title: string): ScheduleItem | undefined {
  // Exact match first
  let found = schedules.find((s) => s.title.toLowerCase() === title.toLowerCase() && !s.completed);
  if (found) return found;

  // Partial match
  found = schedules.find(
    (s) => s.title.toLowerCase().includes(title.toLowerCase()) && !s.completed,
  );
  if (found) return found;

  // Reverse partial match
  found = schedules.find(
    (s) => title.toLowerCase().includes(s.title.toLowerCase()) && !s.completed,
  );
  return found;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return error instanceof Error && /abort/i.test(error.message);
}

function getTagColorByName(name: string): string {
  if (name === "重要") return DEFAULT_COLORS[0];
  const hash = Array.from(name).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return DEFAULT_COLORS[hash % DEFAULT_COLORS.length];
}

export function useSecretary(options: UseSecretaryOptions = {}): UseSecretaryReturn {
  const [storedThreads, setStoredThreadsRaw] = useLocalStorage<ChatThread[]>(
    THREADS_STORAGE_KEY,
    [],
  );
  const [legacyMessages, setLegacyMessages] = useLocalStorage<ChatMessage[]>(
    LEGACY_CHAT_STORAGE_KEY,
    [],
  );
  const [activeThreadId, setActiveThreadId] = useLocalStorage<string | null>(
    ACTIVE_THREAD_STORAGE_KEY,
    null,
  );
  const [storedSelectedModel, setStoredSelectedModel] = useLocalStorage<string>(
    SECRETARY_MODEL_STORAGE_KEY,
    DEFAULT_SECRETARY_MODEL,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const latestMessageRequestRef = useRef<{
    threadId: string;
    content: string;
    requestMode: ChatRequestMode;
    imageAttachmentDataUrl?: string;
  } | null>(null);

  const setStoredThreads = useCallback(
    (value: ChatThread[] | ((prev: ChatThread[]) => ChatThread[])) => {
      setStoredThreadsRaw((previous) => {
        const normalizedPrevious = previous.map(normalizeThread);
        const nextValue = value instanceof Function ? value(normalizedPrevious) : value;
        const normalizedNext = nextValue.map(normalizeThread);
        return compactChatThreadsForStorage(normalizedNext).threads;
      });
    },
    [setStoredThreadsRaw],
  );

  const {
    schedules,
    addSchedule,
    updateSchedule,
    toggleComplete,
    deleteSchedule: deleteScheduleItem,
  } = useSchedule();
  const { sharing } = useCalendarSharing();
  const { tags, addTag } = useTags();
  const { addActivity, getAllDailySummaries, getCurrentStreak } = useEffortLog();

  const threads = useMemo(() => {
    const normalizedThreads = storedThreads.map(normalizeThread);
    const { threads: uniqueThreads } = dedupeThreadsById(normalizedThreads);
    return uniqueThreads.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }, [storedThreads]);

  useEffect(() => {
    if (storedThreads.length === 0) {
      return;
    }

    const normalizedStoredThreads = storedThreads.map(normalizeThread);
    const deduped = dedupeThreadsById(normalizedStoredThreads);
    const compacted = compactChatThreadsForStorage(deduped.threads);
    if (deduped.changed || compacted.changed) {
      setStoredThreadsRaw(compacted.threads);
    }
  }, [setStoredThreadsRaw, storedThreads]);

  useEffect(() => {
    if (threads.length > 0) {
      if (!activeThreadId || !threads.some((thread) => thread.id === activeThreadId)) {
        setActiveThreadId(threads[0].id);
      }
      return;
    }

    const normalizedLegacyMessages = legacyMessages.map(normalizeChatMessage);
    const initialThread = createThread({
      title: normalizedLegacyMessages.length > 0 ? "既存チャット" : "チャット 1",
      messages: normalizedLegacyMessages,
      pendingActions: [],
      lastExecutedAction: null,
    });

    setStoredThreads([initialThread]);
    setActiveThreadId(initialThread.id);

    if (normalizedLegacyMessages.length > 0) {
      setLegacyMessages([]);
    }
  }, [
    activeThreadId,
    legacyMessages,
    setActiveThreadId,
    setLegacyMessages,
    setStoredThreads,
    threads,
  ]);

  const activeThread = useMemo(() => {
    if (!activeThreadId) return threads[0] ?? null;
    return threads.find((thread) => thread.id === activeThreadId) ?? threads[0] ?? null;
  }, [activeThreadId, threads]);

  const messages = activeThread?.messages ?? [];
  const pendingActions = activeThread?.pendingActions ?? [];
  const lastExecutedAction = activeThread?.lastExecutedAction ?? null;

  const updateThreadById = useCallback(
    (threadId: string, updater: (thread: ChatThread) => ChatThread) => {
      setStoredThreads((previous) =>
        previous.map((rawThread) => {
          const normalizedThread = normalizeThread(rawThread);
          return normalizedThread.id === threadId ? updater(normalizedThread) : normalizedThread;
        }),
      );
    },
    [setStoredThreads],
  );

  const createThreadFromUi = useCallback(
    (title?: string): string => {
      const threadId = createThreadId();
      setStoredThreads((previous) => {
        const normalizedThreads = previous.map(normalizeThread);
        if (normalizedThreads.some((thread) => thread.id === threadId)) {
          return normalizedThreads;
        }
        const nextTitle = title?.trim() || getNextThreadTitle(normalizedThreads);
        const now = new Date();
        const newThread: ChatThread = {
          id: threadId,
          title: nextTitle,
          isTitleManuallyEdited: false,
          messages: [],
          pendingActions: [],
          lastExecutedAction: null,
          createdAt: now,
          updatedAt: now,
        };
        return [newThread, ...normalizedThreads];
      });
      setActiveThreadId(threadId);
      setError(null);
      return threadId;
    },
    [setActiveThreadId, setStoredThreads],
  );

  const selectThread = useCallback(
    (threadId: string) => {
      if (!threads.some((thread) => thread.id === threadId)) return;
      setActiveThreadId(threadId);
      setError(null);
    },
    [setActiveThreadId, threads],
  );

  const renameThread = useCallback(
    (threadId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      updateThreadById(threadId, (thread) => ({
        ...thread,
        title: trimmed,
        isTitleManuallyEdited: true,
        updatedAt: new Date(),
      }));
    },
    [updateThreadById],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      let nextActiveThreadId: string | null = activeThreadId;
      setStoredThreads((previous) => {
        const normalizedThreads = previous.map(normalizeThread);
        const remaining = normalizedThreads.filter((thread) => thread.id !== threadId);

        if (remaining.length === 0) {
          const fallback = createThread({ title: "チャット 1" });
          nextActiveThreadId = fallback.id;
          return [fallback];
        }

        if (activeThreadId === threadId) {
          const sortedRemaining = [...remaining].sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
          );
          nextActiveThreadId = sortedRemaining[0]?.id ?? remaining[0].id;
        }

        return remaining;
      });

      if (nextActiveThreadId !== activeThreadId) {
        setActiveThreadId(nextActiveThreadId);
      }
    },
    [activeThreadId, setActiveThreadId, setStoredThreads],
  );

  const resolveTags = useCallback(
    (tagNames?: string[]) => {
      if (!tagNames || tagNames.length === 0) return [];
      return tagNames
        .map((name) => name.trim())
        .filter((name, index, arr) => name.length > 0 && arr.indexOf(name) === index)
        .map((name) => {
          const existing = tags.find((tag) => tag.name === name);
          if (existing) return existing;
          return addTag({
            name,
            color: getTagColorByName(name),
            priority: name === "重要" ? "high" : "medium",
          });
        });
    },
    [tags, addTag],
  );

  const effortDailySummaries = useMemo(() => getAllDailySummaries(), [getAllDailySummaries]);
  const currentStreak = useMemo(() => getCurrentStreak(), [getCurrentStreak]);

  // Build context from current schedules and effort logs
  const context = useMemo(
    () => buildSecretaryContext(schedules, effortDailySummaries, currentStreak, sharing),
    [schedules, effortDailySummaries, currentStreak, sharing],
  );
  const internalSelectedModel = useMemo<SecretaryModelId>(
    () => (isSecretaryModelId(storedSelectedModel) ? storedSelectedModel : DEFAULT_SECRETARY_MODEL),
    [storedSelectedModel],
  );
  const selectedModel = options.selectedModel ?? internalSelectedModel;

  useEffect(() => {
    if (!isSecretaryModelId(storedSelectedModel)) {
      setStoredSelectedModel(DEFAULT_SECRETARY_MODEL);
    }
  }, [storedSelectedModel, setStoredSelectedModel]);

  const setSelectedModel = useCallback(
    (model: SecretaryModelId) => {
      if (options.onSelectedModelChange) {
        options.onSelectedModelChange(model);
        return;
      }
      setStoredSelectedModel(model);
    },
    [options.onSelectedModelChange, setStoredSelectedModel],
  );

  // Conflict detection
  const checkConflicts = useCallback(
    (
      dueDate: string,
      endDate?: string,
      targetMode?: ScheduleItem["mode"],
      targetIsAllDay?: boolean,
      targetId?: string,
      targetTitle?: string,
    ): ScheduleConflict[] => {
      let resolvedMode = targetMode;
      let resolvedIsAllDay = targetIsAllDay;
      if (!resolvedMode) {
        if (targetId) {
          resolvedMode = schedules.find((schedule) => schedule.id === targetId)?.mode;
        } else if (targetTitle) {
          resolvedMode = findScheduleByTitle(schedules, targetTitle)?.mode;
        }
      }
      if (resolvedIsAllDay === undefined) {
        if (targetId) {
          resolvedIsAllDay = schedules.find((schedule) => schedule.id === targetId)?.isAllDay;
        } else if (targetTitle) {
          resolvedIsAllDay = findScheduleByTitle(schedules, targetTitle)?.isAllDay;
        }
      }
      return getVisibleScheduleConflicts(
        checkScheduleConflicts(
          schedules,
          dueDate,
          endDate,
          targetId,
          resolvedMode,
          resolvedIsAllDay,
        ),
        tags,
      );
    },
    [schedules, tags],
  );

  const setLastExecutedActionForThread = useCallback(
    (threadId: string, action: ExecutedAction | null) => {
      updateThreadById(threadId, (thread) => ({
        ...thread,
        lastExecutedAction: action,
        updatedAt: new Date(),
      }));
    },
    [updateThreadById],
  );

  const executeAction = useCallback(
    (action: SecretaryAction) => {
      if (!activeThread?.id) return;
      const threadId = activeThread.id;

      switch (action.type) {
        case "add_schedule": {
          const {
            title,
            mode,
            dueDate,
            endDate,
            isAllDay,
            tags: tagNames,
            recurrence,
            location,
            items,
            participants,
            url,
            notes,
          } = action.payload;
          const resolvedTags = resolveTags(tagNames);
          addSchedule({
            title,
            mode,
            dueDate: new Date(dueDate),
            endDate: endDate ? new Date(endDate) : undefined,
            isAllDay,
            color: "#EF4444",
            location,
            items,
            participants,
            url,
            notes,
            tags: resolvedTags,
            recurrence,
          });
          setLastExecutedActionForThread(threadId, {
            action,
            timestamp: new Date(),
            undoData: {
              type: "restore",
              scheduleData: {
                id: "",
                title,
                mode,
                dueDate: new Date(dueDate),
                endDate: endDate ? new Date(endDate) : undefined,
                isAllDay,
                color: "#EF4444",
                location,
                items,
                participants,
                url,
                notes,
                tags: resolvedTags,
                recurrence,
                completed: false,
                createdAt: new Date(),
              },
            },
          });
          addActivity({
            type: "schedule_create",
            description: `AIが「${title}」を追加`,
            metadata: {
              scheduleMode: mode,
              tags: resolvedTags.map((tag) => tag.name),
            },
          });
          break;
        }
        case "update_schedule": {
          const { id, title, updates, scope = "single" } = action.payload;
          const hasUpdate = (key: keyof typeof updates) =>
            Object.prototype.hasOwnProperty.call(updates, key);
          let targetId = id;
          let targetSchedule: ScheduleItem | undefined;
          if (!targetId && title) {
            targetSchedule = findScheduleByTitle(schedules, title);
            targetId = targetSchedule?.id;
          } else if (targetId) {
            targetSchedule = schedules.find((s) => s.id === targetId);
          }
          if (targetId && targetSchedule) {
            const previousState: Partial<ScheduleItem> = {};
            if (updates.title) previousState.title = targetSchedule.title;
            if (updates.dueDate) previousState.dueDate = targetSchedule.dueDate;
            if (updates.endDate) previousState.endDate = targetSchedule.endDate;
            if (updates.isAllDay !== undefined) previousState.isAllDay = targetSchedule.isAllDay;
            if (updates.location) previousState.location = targetSchedule.location;
            if (updates.items) previousState.items = targetSchedule.items;
            if (updates.participants) previousState.participants = targetSchedule.participants;
            if (updates.url) previousState.url = targetSchedule.url;
            if (updates.notes) previousState.notes = targetSchedule.notes;
            if (updates.tags) previousState.tags = targetSchedule.tags;
            if (hasUpdate("recurrence")) previousState.recurrence = targetSchedule.recurrence;

            const resolvedTags = updates.tags ? resolveTags(updates.tags) : undefined;
            updateSchedule(
              targetId,
              {
                ...(updates.title && { title: updates.title }),
                ...(updates.dueDate && { dueDate: new Date(updates.dueDate) }),
                ...(updates.endDate && { endDate: new Date(updates.endDate) }),
                ...(updates.isAllDay !== undefined ? { isAllDay: updates.isAllDay } : {}),
                ...(resolvedTags && { tags: resolvedTags }),
                ...(updates.location && { location: updates.location }),
                ...(updates.items && { items: updates.items }),
                ...(updates.participants && { participants: updates.participants }),
                ...(updates.url && { url: updates.url }),
                ...(updates.notes && { notes: updates.notes }),
                ...(hasUpdate("recurrence") ? { recurrence: updates.recurrence ?? null } : {}),
              },
              scope,
            );
            setLastExecutedActionForThread(threadId, {
              action,
              timestamp: new Date(),
              undoData: {
                type: "revert",
                previousState: { ...previousState, id: targetId },
              },
            });
          }
          break;
        }
        case "complete_schedule": {
          const { id, title } = action.payload;
          let targetId = id;
          let targetSchedule: ScheduleItem | undefined;
          if (!targetId && title) {
            targetSchedule = findScheduleByTitle(schedules, title);
            targetId = targetSchedule?.id;
          } else if (targetId) {
            targetSchedule = schedules.find((s) => s.id === targetId);
          }
          if (targetId && targetSchedule) {
            toggleComplete(targetId);
            setLastExecutedActionForThread(threadId, {
              action,
              timestamp: new Date(),
              undoData: {
                type: "toggle",
                scheduleData: targetSchedule,
              },
            });
            if (targetSchedule.mode === "task") {
              addActivity({
                type: "task_complete",
                description: `「${title || targetSchedule.title}」を完了`,
                metadata: {
                  scheduleId: targetSchedule.id,
                  scheduleMode: targetSchedule.mode,
                  tags: targetSchedule.tags.map((tag) => tag.name),
                },
              });
            }
          }
          break;
        }
        case "delete_schedule": {
          const { id, title, scope = "single" } = action.payload;
          let targetId = id;
          let targetSchedule: ScheduleItem | undefined;
          if (!targetId && title) {
            targetSchedule = findScheduleByTitle(schedules, title);
            targetId = targetSchedule?.id;
          } else if (targetId) {
            targetSchedule = schedules.find((s) => s.id === targetId);
          }
          if (targetId && targetSchedule) {
            const scopedSchedules = collectScopedSeriesSchedules(schedules, targetSchedule, scope);
            deleteScheduleItem(targetId, scope);
            setLastExecutedActionForThread(threadId, {
              action,
              timestamp: new Date(),
              undoData: {
                type: "restore",
                scheduleData:
                  scopedSchedules.length > 0
                    ? scopedSchedules[scopedSchedules.length - 1]
                    : targetSchedule,
              },
            });
          }
          break;
        }
      }
    },
    [
      activeThread,
      schedules,
      addSchedule,
      updateSchedule,
      toggleComplete,
      deleteScheduleItem,
      addActivity,
      resolveTags,
      setLastExecutedActionForThread,
    ],
  );

  const undoLastAction = useCallback(() => {
    if (!activeThread?.id || !lastExecutedAction?.undoData) return;
    const threadId = activeThread.id;
    const { undoData } = lastExecutedAction;

    switch (undoData.type) {
      case "restore":
        if (lastExecutedAction.action.type === "add_schedule" && undoData.scheduleData) {
          const recentlyAdded = schedules.find(
            (s) => s.title === undoData.scheduleData!.title && !s.completed,
          );
          if (recentlyAdded) {
            deleteScheduleItem(recentlyAdded.id);
          }
        } else if (lastExecutedAction.action.type === "delete_schedule" && undoData.scheduleData) {
          const { title, mode, dueDate, endDate, location, items, participants, url, notes, tags } =
            undoData.scheduleData;
          addSchedule({
            title,
            mode,
            dueDate: new Date(dueDate),
            endDate: endDate ? new Date(endDate) : undefined,
            isAllDay: undoData.scheduleData.isAllDay,
            location,
            items,
            participants,
            url,
            notes,
            tags,
            recurrence: undoData.scheduleData.recurrence,
          });
        }
        break;
      case "toggle":
        if (undoData.scheduleData) {
          toggleComplete(undoData.scheduleData.id);
        }
        break;
      case "revert":
        if (undoData.previousState?.id) {
          const { id, ...updates } = undoData.previousState;
          updateSchedule(id, {
            ...(updates.title && { title: updates.title }),
            ...(updates.dueDate && { dueDate: new Date(updates.dueDate) }),
            ...(updates.endDate && { endDate: new Date(updates.endDate) }),
            ...(updates.isAllDay !== undefined ? { isAllDay: updates.isAllDay } : {}),
            ...(updates.tags && { tags: updates.tags }),
            ...(updates.location && { location: updates.location }),
            ...(updates.items && { items: updates.items }),
            ...(updates.participants && { participants: updates.participants }),
            ...(updates.url && { url: updates.url }),
            ...(updates.notes && { notes: updates.notes }),
            ...(Object.prototype.hasOwnProperty.call(updates, "recurrence")
              ? { recurrence: updates.recurrence ?? null }
              : {}),
          });
        }
        break;
    }

    setLastExecutedActionForThread(threadId, null);
  }, [
    activeThread,
    lastExecutedAction,
    schedules,
    addSchedule,
    deleteScheduleItem,
    toggleComplete,
    updateSchedule,
    addActivity,
    setLastExecutedActionForThread,
  ]);

  const dismissAction = useCallback(
    (index: number) => {
      if (!activeThread?.id) return;
      updateThreadById(activeThread.id, (thread) => ({
        ...thread,
        pendingActions: thread.pendingActions.filter((_, i) => i !== index),
        updatedAt: new Date(),
      }));
    },
    [activeThread, updateThreadById],
  );

  const executeAllActions = useCallback(() => {
    if (!activeThread?.id) return;
    for (const action of pendingActions) {
      executeAction(action);
    }
    updateThreadById(activeThread.id, (thread) => ({
      ...thread,
      pendingActions: [],
      updatedAt: new Date(),
    }));
  }, [activeThread, pendingActions, executeAction, updateThreadById]);

  const getScheduleByTitle = useCallback(
    (title: string) => findScheduleByTitle(schedules, title) ?? null,
    [schedules],
  );

  const getScheduleById = useCallback(
    (id: string) => schedules.find((schedule) => schedule.id === id) ?? null,
    [schedules],
  );

  const sendMessageAndGetReply = useCallback(
    async (content: string, options?: SendMessageOptions): Promise<string | null> => {
      const trimmedContent = content.trim();
      if (!trimmedContent) return null;

      const targetThread =
        (options?.threadId
          ? threads.find((thread) => thread.id === options.threadId)
          : activeThread) ?? null;
      if (!targetThread?.id) return null;

      const inferredRequestMode =
        options?.requestMode ??
        (isTailwindThemeRequest(trimmedContent)
          ? ("tailwind_theme" as const)
          : isGenerativeUiRequest(trimmedContent)
            ? ("generative_ui" as const)
            : ("default" as const));

      const threadId = targetThread.id;
      const requestKey = {
        threadId,
        content: trimmedContent,
        requestMode: inferredRequestMode,
        imageAttachmentDataUrl: options?.imageAttachmentDataUrl,
      };
      const latestRequest = latestMessageRequestRef.current;
      if (
        latestRequest &&
        latestRequest.threadId === requestKey.threadId &&
        latestRequest.content === requestKey.content &&
        latestRequest.requestMode === requestKey.requestMode &&
        latestRequest.imageAttachmentDataUrl === requestKey.imageAttachmentDataUrl
      ) {
        return null;
      }
      latestMessageRequestRef.current = requestKey;

      const parsedGenerativeInput =
        inferredRequestMode === "generative_ui"
          ? parseGenerativeUiInput(trimmedContent)
          : inferredRequestMode === "tailwind_theme"
            ? parseTailwindThemeInput(trimmedContent)
            : { userPreferences: "", currentNeed: "" };

      const userMessage: ChatMessage = {
        id: `user-${threadId}-${Date.now()}`,
        role: "user",
        content: trimmedContent,
        timestamp: new Date(),
        requestMode: inferredRequestMode,
        hasImageAttachment: Boolean(options?.imageAttachmentDataUrl),
        imageAttachmentName: options?.imageAttachmentName,
        imageAttachmentDataUrl: options?.imageAttachmentDataUrl,
      };

      const nextMessages = [...targetThread.messages, userMessage];
      updateThreadById(threadId, (thread) => ({
        ...thread,
        messages: [...thread.messages, userMessage],
        updatedAt: new Date(),
      }));

      setIsLoading(true);
      setError(null);
      const controller = new AbortController();
      activeRequestControllerRef.current = controller;

      try {
        const response = await sendChatMessageWithContext(nextMessages, context, {
          model: selectedModel,
          requestMode: inferredRequestMode,
          userPreferences: options?.userPreferences ?? parsedGenerativeInput.userPreferences,
          currentNeed: options?.currentNeed ?? parsedGenerativeInput.currentNeed,
          imageAttachmentDataUrl: options?.imageAttachmentDataUrl,
          latestPhotoCheckResult: loadLatestPhotoCheckResult(),
          signal: controller.signal,
        });

        const isStructuredMode =
          inferredRequestMode === "generative_ui" || inferredRequestMode === "tailwind_theme";
        const { cleanContent, actions } = isStructuredMode
          ? { cleanContent: response, actions: [] }
          : parseActionsFromResponse(response);
        const actionsWithFallback = isStructuredMode
          ? []
          : fillMissingActionFields(actions, userMessage.content);
        const formattedContent = isStructuredMode
          ? cleanContent
          : formatSecretaryResponse(cleanContent);

        const assistantMessage: ChatMessage = {
          id: `assistant-${threadId}-${Date.now()}`,
          role: "assistant",
          content: formattedContent,
          timestamp: new Date(),
          requestMode: inferredRequestMode,
          actions: actionsWithFallback.length > 0 ? actionsWithFallback : undefined,
        };

        updateThreadById(threadId, (thread) => {
          const nextTitle = thread.isTitleManuallyEdited
            ? thread.title
            : generateThreadTitle({
                latestUserContent: userMessage.content,
                latestAssistantContent: isStructuredMode ? "" : assistantMessage.content,
                fallbackTitle: thread.title,
              });
          return {
            ...thread,
            title: nextTitle,
            messages: [...thread.messages, assistantMessage],
            pendingActions:
              actionsWithFallback.length > 0
                ? [...thread.pendingActions, ...actionsWithFallback]
                : thread.pendingActions,
            updatedAt: new Date(),
          };
        });

        addActivity({
          type: "ai_chat",
          description: `${options?.imageAttachmentDataUrl ? "画像付き" : ""}${inferredRequestMode === "generative_ui" ? "Generative UI" : inferredRequestMode === "tailwind_theme" ? "Tailwind Theme" : "AI"}チャット: ${trimmedContent.slice(0, 20)}${trimmedContent.length > 20 ? "..." : ""}`,
        });

        return formattedContent;
      } catch (err) {
        if (isAbortError(err)) {
          return null;
        }
        const errorMessage = err instanceof Error ? err.message : "メッセージの送信に失敗しました";
        setError(errorMessage);
        return null;
      } finally {
        const latestRequest = latestMessageRequestRef.current;
        if (
          latestRequest &&
          latestRequest.threadId === requestKey.threadId &&
          latestRequest.content === requestKey.content &&
          latestRequest.requestMode === requestKey.requestMode &&
          latestRequest.imageAttachmentDataUrl === requestKey.imageAttachmentDataUrl
        ) {
          latestMessageRequestRef.current = null;
        }
        if (activeRequestControllerRef.current === controller) {
          activeRequestControllerRef.current = null;
        }
        setIsLoading(false);
      }
    },
    [activeThread, addActivity, context, selectedModel, threads, updateThreadById],
  );

  const sendMessage = useCallback(
    async (content: string, options?: SendMessageOptions): Promise<void> => {
      await sendMessageAndGetReply(content, options);
    },
    [sendMessageAndGetReply],
  );

  const retryUserMessage = useCallback(
    async (messageId: string): Promise<string | null> => {
      if (!activeThread?.id) return null;
      const targetUserMessage = activeThread.messages.find(
        (message) => message.id === messageId && message.role === "user",
      );
      if (!targetUserMessage) return null;

      return sendMessageAndGetReply(targetUserMessage.content, {
        threadId: activeThread.id,
        requestMode: targetUserMessage.requestMode,
        imageAttachmentDataUrl: targetUserMessage.imageAttachmentDataUrl,
        imageAttachmentName: targetUserMessage.imageAttachmentName,
      });
    },
    [activeThread, sendMessageAndGetReply],
  );

  const retryLastUserMessage = useCallback(async (): Promise<string | null> => {
    if (!activeThread?.id) return null;
    const latestUserMessage = [...activeThread.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!latestUserMessage) return null;

    return retryUserMessage(latestUserMessage.id);
  }, [activeThread, retryUserMessage]);

  const cancelCurrentResponse = useCallback(() => {
    activeRequestControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  const clearMessages = useCallback(() => {
    if (!activeThread?.id) return;
    const targetIds = new Set(messages.map((message) => message.id));

    setAudioUrls((previous) => {
      const next = new Map(previous);
      for (const messageId of targetIds) {
        const audioUrl = next.get(messageId);
        if (audioUrl) {
          revokeAudioUrl(audioUrl);
          next.delete(messageId);
        }
      }
      return next;
    });

    updateThreadById(activeThread.id, (thread) => ({
      ...thread,
      messages: [],
      pendingActions: [],
      lastExecutedAction: null,
      updatedAt: new Date(),
    }));
    setError(null);
  }, [activeThread, messages, updateThreadById]);

  const deleteMessage = useCallback(
    (messageId: string) => {
      if (!activeThread?.id) return;

      setAudioUrls((previous) => {
        const audioUrl = previous.get(messageId);
        if (!audioUrl) {
          return previous;
        }
        revokeAudioUrl(audioUrl);
        const next = new Map(previous);
        next.delete(messageId);
        return next;
      });

      updateThreadById(activeThread.id, (thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => message.id !== messageId),
        updatedAt: new Date(),
      }));
    },
    [activeThread, updateThreadById],
  );

  const playVoice = useCallback(
    async (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.role !== "assistant") return;

      setIsPlaying(messageId);

      try {
        let audioUrl = audioUrls.get(messageId);

        if (!audioUrl) {
          const blob = await synthesizeSpeech(message.content);
          audioUrl = createAudioUrl(blob);
          setAudioUrls((prev) => new Map(prev).set(messageId, audioUrl!));
        }

        const audio = new Audio(audioUrl);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Failed to play audio"));
          audio.play().catch(reject);
        });
      } catch (err) {
        console.error("Failed to play voice:", err);
      } finally {
        setIsPlaying(null);
      }
    },
    [messages, audioUrls],
  );

  return {
    threads,
    activeThreadId: activeThread?.id ?? activeThreadId,
    messages,
    isLoading,
    error,
    pendingActions,
    lastExecutedAction,
    sendMessage,
    sendMessageAndGetReply,
    retryUserMessage,
    retryLastUserMessage,
    cancelCurrentResponse,
    deleteMessage,
    clearMessages,
    playVoice,
    isPlaying,
    createThread: createThreadFromUi,
    selectThread,
    renameThread,
    deleteThread,
    executeAction,
    dismissAction,
    executeAllActions,
    undoLastAction,
    getScheduleById,
    getScheduleByTitle,
    selectedModel,
    setSelectedModel,
    secretaryContext: context,
    checkConflicts,
  };
}
