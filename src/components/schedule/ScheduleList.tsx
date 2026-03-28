import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Calendar, formatDateKey } from "@/components/ui/calendar";
import { ScheduleItem } from "./ScheduleItem";
import { ScheduleDetailModal } from "./ScheduleDetailModal";
import { useSchedule } from "@/hooks/useSchedule";
import { useCalendarSharing } from "@/hooks/useCalendarSharing";
import { useTags, DEFAULT_COLORS } from "@/hooks/useTags";
import { useEffortLog } from "@/hooks/useEffortLog";
import { useWarningSettings } from "@/hooks/useWarningSettings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { checkScheduleConflicts, checkIsOverdueDate } from "@/lib/scheduleConflicts";
import { getVisibleScheduleConflicts } from "@/lib/conflictWarningFilter";
import {
  buildScheduleVisibilityView,
  resolveAccessContextForMember,
  resolveAccessContextForPublicLink,
} from "@/lib/calendarPermissions";
import { CalendarSharingPanel } from "./CalendarSharingPanel";
import {
  SCHEDULE_SORT_STORAGE_KEY,
  sortScheduleItems,
  sortTagsByPriority,
  TAG_PRIORITY_LABELS,
  type ScheduleSortMode,
} from "@/lib/tagPriority";
import {
  DEFAULT_ALL_DAY_REMINDER_TIME,
  DEFAULT_REMINDER_OFFSETS_MINUTES,
  REMINDER_OPTIONS,
  formatReminderSummary,
  getReminderNotificationPermission,
  normalizeReminderOffsets,
  parseAllDayReminderTime,
  requestReminderNotificationPermission,
  type ReminderNotificationPermission,
} from "@/lib/scheduleReminders";
import {
  Plus,
  CalendarDays,
  AlertTriangle,
  ListTodo,
  X,
  Tag,
  Bell,
  BellOff,
  Settings,
  Share2,
} from "lucide-react";
import type {
  CalendarAccessContext,
  RepeatWeekday,
  ScheduleConflict,
  ScheduleMutationScope,
  ScheduleRecurrenceInput,
  ScheduleVisibilityView,
  TagPriority,
} from "@/types";

interface ScheduleListProps {
  className?: string;
  selectedDate?: Date | null;
  onDateSelect?: (date: Date | null) => void;
}

type ScheduleCategoryViewMode = "list" | "split";

const SCHEDULE_CATEGORY_VIEW_STORAGE_KEY = "grass-secretary-schedule-category-view-mode";
const WEEKDAY_LABELS: Record<RepeatWeekday, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};
const WEEKDAY_OPTIONS: RepeatWeekday[] = [0, 1, 2, 3, 4, 5, 6];
const SCHEDULE_MUTATION_SCOPE_OPTIONS: ScheduleMutationScope[] = ["single", "future", "all"];

const SCHEDULE_MUTATION_SCOPE_LABELS: Record<ScheduleMutationScope, string> = {
  single: "この予定のみ",
  future: "この予定以降",
  all: "繰り返し全件",
};

const DEFAULT_ALL_DAY_REMINDER = parseAllDayReminderTime(DEFAULT_ALL_DAY_REMINDER_TIME);
const DEFAULT_OWNER_USER_ID = "owner-local";

const REMINDER_PERMISSION_LABELS: Record<ReminderNotificationPermission, string> = {
  granted: "通知許可済み",
  denied: "通知ブロック中",
  default: "通知未設定",
  unsupported: "通知未対応",
};

function getReminderPermissionBadgeClass(permission: ReminderNotificationPermission): string {
  if (permission === "granted") {
    return "bg-emerald-100 text-emerald-700";
  }
  if (permission === "denied") {
    return "bg-destructive/15 text-destructive";
  }
  if (permission === "unsupported") {
    return "bg-muted text-muted-foreground";
  }
  return "bg-amber-100 text-amber-700";
}

function buildAllDayReminderTime(hour: string, minute: string): string {
  const normalizedHour = Number.parseInt(hour, 10);
  const normalizedMinute = Number.parseInt(minute, 10);
  if (
    !Number.isInteger(normalizedHour) ||
    !Number.isInteger(normalizedMinute) ||
    normalizedHour < 0 ||
    normalizedHour > 23 ||
    normalizedMinute < 0 ||
    normalizedMinute > 59
  ) {
    return DEFAULT_ALL_DAY_REMINDER_TIME;
  }
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

function formatRecurrenceSummary(recurrence?: ScheduleRecurrenceInput): string {
  if (!recurrence || recurrence.weekdays.length === 0) {
    return "繰り返しなし";
  }
  const weekdayLabels = recurrence.weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join("・");
  if (recurrence.isInfinite) {
    return `${weekdayLabels} / 永続`;
  }
  if (!recurrence.count || recurrence.count <= 1) {
    return "繰り返しなし";
  }
  return `${weekdayLabels} / ${recurrence.count}回`;
}

export function ScheduleList({ className, selectedDate, onDateSelect }: ScheduleListProps) {
  const {
    schedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,
    toggleComplete,
    getUpcoming,
    getOverdue,
    getCalendarEventsByDate,
    getCalendarEventsByDateWithAccess,
    getScheduleVisibilityView,
  } = useSchedule();
  const {
    sharing,
    ownerUserId,
    inviteMember,
    updateMemberRole,
    removeMember,
    setPublicLinkEnabled,
    setPublicLinkRole,
    regeneratePublicLinkToken,
    getPublicShareUrl,
    resolvePublicRoleByToken,
  } = useCalendarSharing();
  const { tags, addTag, updateTag, deleteTag: deleteTagFromList } = useTags();
  const { addActivity } = useEffortLog();
  const {
    settings: warningSettings,
    setConflictWarnings,
    setOverdueWarnings,
  } = useWarningSettings();

  const [pendingDeleteTagId, setPendingDeleteTagId] = useState<string | null>(null);
  const [pendingDeleteMemberId, setPendingDeleteMemberId] = useState<string | null>(null);

  const handleDeleteTag = (tagId: string) => {
    setPendingDeleteTagId(tagId);
  };

  const handleConfirmDeleteTag = () => {
    if (!pendingDeleteTagId) {
      return;
    }
    // Remove the tag from all schedules that reference it
    schedules.forEach((schedule) => {
      const updatedTags = schedule.tags.filter((tag) => tag.id !== pendingDeleteTagId);
      if (updatedTags.length !== schedule.tags.length) {
        updateSchedule(schedule.id, { tags: updatedTags });
      }
    });
    // Then delete the tag itself
    deleteTagFromList(pendingDeleteTagId);
    setPendingDeleteTagId(null);
  };

  const [isAddingSchedule, setIsAddingSchedule] = useState(false);
  const [isEditingSchedule, setIsEditingSchedule] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [viewingScheduleId, setViewingScheduleId] = useState<string | null>(null);
  const [showWarningSettings, setShowWarningSettings] = useState(false);

  const [newTitle, setNewTitle] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newDueDate, setNewDueDate] = useState(
    selectedDate ? formatDateKey(selectedDate) : new Date().toISOString().split("T")[0],
  );
  const [newDueHour, setNewDueHour] = useState("09");
  const [newDueMinute, setNewDueMinute] = useState("00");

  const [showTagManager, setShowTagManager] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(DEFAULT_COLORS[0]);
  const [newTagPriority, setNewTagPriority] = useState<TagPriority>("medium");
  const [currentMode, setCurrentMode] = useState<"task" | "schedule">("task");
  const [newIsAllDay, setNewIsAllDay] = useState(false);
  const [newEndDate, setNewEndDate] = useState("");
  const [newEndHour, setNewEndHour] = useState("18");
  const [newEndMinute, setNewEndMinute] = useState("00");
  const [validationError, setValidationError] = useState("");
  const [newItemColor, setNewItemColor] = useState(DEFAULT_COLORS[0]);
  const [newRepeatWeekdays, setNewRepeatWeekdays] = useState<RepeatWeekday[]>([]);
  const [newRepeatMode, setNewRepeatMode] = useState<"finite" | "infinite">("finite");
  const [newRepeatCount, setNewRepeatCount] = useState("8");
  const [newReminderOffsets, setNewReminderOffsets] = useState<number[]>(
    DEFAULT_REMINDER_OFFSETS_MINUTES,
  );
  const [newAllDayReminderHour, setNewAllDayReminderHour] = useState(
    String(DEFAULT_ALL_DAY_REMINDER.hour).padStart(2, "0"),
  );
  const [newAllDayReminderMinute, setNewAllDayReminderMinute] = useState(
    String(DEFAULT_ALL_DAY_REMINDER.minute).padStart(2, "0"),
  );
  const [notificationPermission, setNotificationPermission] =
    useState<ReminderNotificationPermission>(() => getReminderNotificationPermission());
  const [pendingDeleteScheduleId, setPendingDeleteScheduleId] = useState<string | null>(null);
  const [pendingDeleteScope, setPendingDeleteScope] = useState<ScheduleMutationScope>("single");
  const [showSharingPanel, setShowSharingPanel] = useState(false);
  const [activeViewerMode, setActiveViewerMode] = useState<string>("owner");
  const [hasResolvedShareToken, setHasResolvedShareToken] = useState(false);

  // New extended fields
  const [newLocation, setNewLocation] = useState("");
  const [newItems, setNewItems] = useState("");
  const [newParticipants, setNewParticipants] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newIsPrivate, setNewIsPrivate] = useState(false);
  const [sortMode, setSortMode] = useLocalStorage<ScheduleSortMode>(
    SCHEDULE_SORT_STORAGE_KEY,
    "date",
  );
  const [categoryViewMode, setCategoryViewMode] = useLocalStorage<ScheduleCategoryViewMode>(
    SCHEDULE_CATEGORY_VIEW_STORAGE_KEY,
    "list",
  );
  const shareTokenFromUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const token = new URLSearchParams(window.location.search).get("shareToken");
    return token ? token.trim() : null;
  }, []);

  useEffect(() => {
    if (hasResolvedShareToken) {
      return;
    }

    if (!shareTokenFromUrl) {
      setHasResolvedShareToken(true);
      return;
    }

    const resolvedRole = resolvePublicRoleByToken(shareTokenFromUrl);
    if (resolvedRole) {
      setActiveViewerMode("public");
    }
    setHasResolvedShareToken(true);
  }, [hasResolvedShareToken, resolvePublicRoleByToken, shareTokenFromUrl]);

  const selectedAccessContext = useMemo<CalendarAccessContext>(() => {
    if (activeViewerMode === "owner") {
      return resolveAccessContextForMember("OWNER", ownerUserId, ownerUserId);
    }

    if (activeViewerMode === "public") {
      const publicRole = sharing.publicLink?.role ?? "VIEWER_FULL";
      return resolveAccessContextForPublicLink(publicRole, ownerUserId);
    }

    if (activeViewerMode.startsWith("member:")) {
      const memberId = activeViewerMode.slice("member:".length);
      const member = sharing.members.find((entry) => entry.id === memberId);
      if (member) {
        return resolveAccessContextForMember(member.role, ownerUserId, member.userId);
      }
    }

    return resolveAccessContextForMember(
      "OWNER",
      ownerUserId || DEFAULT_OWNER_USER_ID,
      ownerUserId,
    );
  }, [activeViewerMode, ownerUserId, sharing.members, sharing.publicLink?.role]);

  const datesWithEvents =
    selectedAccessContext.role === "OWNER"
      ? getCalendarEventsByDate()
      : getCalendarEventsByDateWithAccess(selectedAccessContext);

  const schedulesForConflictDetection = useMemo(() => {
    if (selectedAccessContext.role === "OWNER") {
      return schedules;
    }

    return schedules.map((item) => buildScheduleVisibilityView(selectedAccessContext, item).item);
  }, [schedules, selectedAccessContext]);

  const visibilityViewsByDate = useMemo<ScheduleVisibilityView[] | null>(() => {
    if (!selectedDate) {
      return null;
    }
    return getScheduleVisibilityView(selectedDate, selectedAccessContext);
  }, [getScheduleVisibilityView, selectedAccessContext, selectedDate]);

  const allVisibilityById = useMemo(() => {
    const map = new Map<string, ScheduleVisibilityView>();
    schedules.forEach((item) => {
      map.set(item.id, buildScheduleVisibilityView(selectedAccessContext, item));
    });
    return map;
  }, [schedules, selectedAccessContext]);

  const memberColorByUserId = useMemo(() => {
    const map = new Map<string, string>();
    sharing.members.forEach((member) => {
      map.set(member.userId, member.color);
    });
    return map;
  }, [sharing.members]);

  const applyViewerPresentation = useCallback(
    (item: ScheduleVisibilityView["item"], visibility: ScheduleVisibilityView["visibility"]) => {
      if (visibility === "busy") {
        return {
          ...item,
          color: "#64748B",
        };
      }

      if (selectedAccessContext.role === "OWNER") {
        return item;
      }

      if (item.ownerId && item.ownerId === selectedAccessContext.viewerUserId) {
        return {
          ...item,
          color: "#22C55E",
        };
      }

      const memberColor = item.ownerId ? memberColorByUserId.get(item.ownerId) : undefined;
      return {
        ...item,
        color: memberColor || "#8B5CF6",
      };
    },
    [memberColorByUserId, selectedAccessContext.role, selectedAccessContext.viewerUserId],
  );

  const filteredSchedulesRaw = visibilityViewsByDate
    ? visibilityViewsByDate.map((view) => applyViewerPresentation(view.item, view.visibility))
    : null;
  const upcomingRaw = getUpcoming(14);
  const overdueRaw = getOverdue();
  const today = new Date(); // Get today's date for multi-day schedule indicators
  const sortedTags = sortTagsByPriority(tags);

  const filteredSchedules =
    filteredSchedulesRaw !== null ? sortScheduleItems(filteredSchedulesRaw, sortMode) : null;
  const sortedUpcoming = sortScheduleItems(upcomingRaw, sortMode).map((item) => {
    const view = allVisibilityById.get(item.id);
    if (!view) {
      return item;
    }
    return applyViewerPresentation(view.item, view.visibility);
  });
  const sortedOverdue = sortScheduleItems(overdueRaw, sortMode).map((item) => {
    const view = allVisibilityById.get(item.id);
    if (!view) {
      return item;
    }
    return applyViewerPresentation(view.item, view.visibility);
  });
  const sortedCompleted = sortScheduleItems(
    schedules.filter((item) => item.completed),
    sortMode,
  ).map((item) => {
    const view = allVisibilityById.get(item.id);
    if (!view) {
      return item;
    }
    return applyViewerPresentation(view.item, view.visibility);
  });

  const canMutateSchedules =
    selectedAccessContext.role === "OWNER" || selectedAccessContext.role === "EDITOR";
  const pendingDeleteTag = useMemo(
    () => tags.find((tag) => tag.id === pendingDeleteTagId) ?? null,
    [pendingDeleteTagId, tags],
  );
  const pendingDeleteMember = useMemo(
    () => sharing.members.find((member) => member.id === pendingDeleteMemberId) ?? null,
    [pendingDeleteMemberId, sharing.members],
  );
  const pendingDeleteSchedule = useMemo(
    () => schedules.find((schedule) => schedule.id === pendingDeleteScheduleId) ?? null,
    [pendingDeleteScheduleId, schedules],
  );
  const isPendingDeleteRecurring = Boolean(pendingDeleteSchedule?.recurrence?.seriesId);

  const getVisibilityForSchedule = (scheduleId: string): ScheduleVisibilityView | undefined => {
    if (selectedAccessContext.role === "OWNER") {
      return undefined;
    }
    return allVisibilityById.get(scheduleId);
  };

  const canEditSchedule = (scheduleId: string): boolean => {
    if (selectedAccessContext.role === "OWNER") {
      return true;
    }
    return Boolean(getVisibilityForSchedule(scheduleId)?.canEdit);
  };

  const canDeleteSchedule = (scheduleId: string): boolean => {
    if (selectedAccessContext.role === "OWNER") {
      return true;
    }
    return Boolean(getVisibilityForSchedule(scheduleId)?.canDelete);
  };

  const canToggleSchedule = (scheduleId: string): boolean => {
    if (selectedAccessContext.role === "OWNER") {
      return true;
    }
    return Boolean(getVisibilityForSchedule(scheduleId)?.canToggleComplete);
  };

  const canViewScheduleDetails = (scheduleId: string): boolean => {
    if (selectedAccessContext.role === "OWNER") {
      return true;
    }
    return Boolean(getVisibilityForSchedule(scheduleId)?.canViewDetails);
  };
  const upcomingSchedules = sortedUpcoming.filter((s) => s.mode === "schedule");
  const completedSchedulesAll = sortedCompleted.filter((s) => s.mode === "schedule");
  const completedSchedules = completedSchedulesAll.slice(0, 5);
  const overdueTasks = sortedOverdue.filter((s) => s.mode === "task");
  const upcomingTasks = sortedUpcoming.filter((s) => s.mode === "task");
  const completedTasksAll = sortedCompleted.filter((s) => s.mode === "task");
  const completedTasks = completedTasksAll.slice(0, 5);

  // Compute conflicts for current form values
  const currentConflicts = useMemo((): ScheduleConflict[] => {
    if (!newDueDate) return [];
    const dueDate = new Date(newDueDate);
    if (currentMode === "schedule" && newIsAllDay) {
      dueDate.setHours(0, 0, 0, 0);
    } else {
      dueDate.setHours(parseInt(newDueHour), parseInt(newDueMinute), 0, 0);
    }
    const endDate =
      currentMode === "schedule" && newEndDate
        ? (() => {
            const d = new Date(newEndDate);
            if (newIsAllDay) {
              d.setHours(23, 59, 59, 999);
            } else {
              d.setHours(parseInt(newEndHour), parseInt(newEndMinute), 0, 0);
            }
            return d;
          })()
        : undefined;
    return checkScheduleConflicts(
      schedulesForConflictDetection,
      dueDate,
      endDate,
      editingScheduleId ?? undefined,
      currentMode,
      currentMode === "schedule" ? newIsAllDay : undefined,
    );
  }, [
    schedulesForConflictDetection,
    newDueDate,
    newDueHour,
    newDueMinute,
    newEndDate,
    newEndHour,
    newEndMinute,
    currentMode,
    newIsAllDay,
    editingScheduleId,
  ]);

  // Check if due date is overdue (for tasks only)
  const isCurrentOverdue = useMemo((): boolean => {
    if (currentMode !== "task" || !newDueDate) return false;
    const dueDate = new Date(newDueDate);
    dueDate.setHours(parseInt(newDueHour), parseInt(newDueMinute), 0, 0);
    return checkIsOverdueDate(dueDate);
  }, [newDueDate, newDueHour, newDueMinute, currentMode]);

  const normalizedReminderOffsets = useMemo(
    () => normalizeReminderOffsets(newReminderOffsets),
    [newReminderOffsets],
  );
  const reminderSummary = useMemo(
    () => formatReminderSummary(normalizedReminderOffsets),
    [normalizedReminderOffsets],
  );

  const selectedTagObjects = useMemo(
    () => tags.filter((tag) => selectedTags.includes(tag.id)),
    [tags, selectedTags],
  );
  const visibleConflicts = useMemo(
    () => getVisibleScheduleConflicts(currentConflicts, tags),
    [currentConflicts, tags],
  );
  const hasTagFilteredConflicts =
    warningSettings.conflictWarnings &&
    currentConflicts.length > 0 &&
    visibleConflicts.length === 0;
  // Only show conflict warning when global setting is ON and filtered conflicts remain.
  const shouldShowConflictWarning = warningSettings.conflictWarnings && visibleConflicts.length > 0;
  const shouldShowOverdueWarning = warningSettings.overdueWarnings;

  const handleAddTag = () => {
    if (!newTagName.trim()) return;
    addTag({
      name: newTagName.trim(),
      color: newTagColor,
      priority: newTagPriority,
      conflictWarningsEnabled: true,
    });
    setNewTagName("");
    setNewTagColor(DEFAULT_COLORS[0]);
    setNewTagPriority("medium");
  };

  const handleToggleTagSelection = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId],
    );
  };

  const toggleReminderOffset = (minutes: number) => {
    setNewReminderOffsets((prev) => {
      const next = prev.includes(minutes)
        ? prev.filter((entry) => entry !== minutes)
        : [...prev, minutes];
      return normalizeReminderOffsets(next);
    });
  };

  const handleRequestNotificationPermission = async () => {
    const permission = await requestReminderNotificationPermission();
    setNotificationPermission(permission);
  };

  const resetScheduleForm = () => {
    setNewTitle("");
    setSelectedTags([]);
    setNewDueDate(new Date().toISOString().split("T")[0]);
    setNewDueHour("09");
    setNewDueMinute("00");
    setNewIsAllDay(false);
    setNewEndDate("");
    setNewEndHour("18");
    setNewEndMinute("00");
    setCurrentMode("task");
    setValidationError("");
    setNewItemColor(DEFAULT_COLORS[0]);
    setNewLocation("");
    setNewItems("");
    setNewParticipants("");
    setNewUrl("");
    setNewNotes("");
    setNewIsPrivate(false);
    setNewRepeatWeekdays([]);
    setNewRepeatMode("finite");
    setNewRepeatCount("8");
    setNewReminderOffsets(DEFAULT_REMINDER_OFFSETS_MINUTES);
    setNewAllDayReminderHour(String(DEFAULT_ALL_DAY_REMINDER.hour).padStart(2, "0"));
    setNewAllDayReminderMinute(String(DEFAULT_ALL_DAY_REMINDER.minute).padStart(2, "0"));
    setNotificationPermission(getReminderNotificationPermission());
    setPendingDeleteScheduleId(null);
    setPendingDeleteScope("single");
  };

  const normalizedRecurrence = useMemo<ScheduleRecurrenceInput | undefined>(() => {
    if (newRepeatWeekdays.length === 0) {
      return undefined;
    }
    if (newRepeatMode === "infinite") {
      return {
        weekdays: [...newRepeatWeekdays].sort((a, b) => a - b),
        isInfinite: true,
      };
    }
    const count = Number.parseInt(newRepeatCount, 10);
    if (!Number.isFinite(count) || count <= 1) {
      return undefined;
    }
    return {
      weekdays: [...newRepeatWeekdays].sort((a, b) => a - b),
      count,
    };
  }, [newRepeatCount, newRepeatMode, newRepeatWeekdays]);

  const toggleRepeatWeekday = (weekday: RepeatWeekday) => {
    setNewRepeatWeekdays((prev) =>
      prev.includes(weekday)
        ? prev.filter((entry) => entry !== weekday)
        : [...prev, weekday].sort((a, b) => a - b),
    );
  };

  const validateSchedule = (): boolean => {
    if (currentMode === "schedule" && newEndDate) {
      const dueDate = new Date(newDueDate);
      const endDate = new Date(newEndDate);
      if (endDate < dueDate) {
        setValidationError("終了日は開始日以降である必要があります");
        return false;
      }
    }
    setValidationError("");
    return true;
  };

  const viewingSchedule = viewingScheduleId
    ? schedules.find((s) => s.id === viewingScheduleId)
    : null;

  const handleViewDetail = (scheduleId: string) => {
    if (!canViewScheduleDetails(scheduleId)) {
      return;
    }
    setViewingScheduleId(scheduleId);
  };

  const handleEventClick = (scheduleId: string) => {
    if (!scheduleId) {
      return;
    }
    handleViewDetail(scheduleId);
  };

  const populateFormWithSchedule = (schedule: (typeof schedules)[0]) => {
    setEditingScheduleId(schedule.id);
    setNewTitle(schedule.title);
    setSelectedTags(schedule.tags.map((tag) => tag.id));
    setNewDueDate(formatDateKey(schedule.dueDate));
    setNewDueHour(String(schedule.dueDate.getHours()).padStart(2, "0"));
    setNewDueMinute(String(schedule.dueDate.getMinutes()).padStart(2, "0"));
    setNewIsAllDay(schedule.mode === "schedule" ? Boolean(schedule.isAllDay) : false);
    setNewEndDate(schedule.endDate ? formatDateKey(schedule.endDate) : "");
    setNewEndHour(schedule.endDate ? String(schedule.endDate.getHours()).padStart(2, "0") : "18");
    setNewEndMinute(
      schedule.endDate ? String(schedule.endDate.getMinutes()).padStart(2, "0") : "00",
    );
    setCurrentMode(schedule.mode);
    setNewItemColor(schedule.color || DEFAULT_COLORS[0]);
    setNewLocation(schedule.location || "");
    setNewItems(schedule.items || "");
    setNewParticipants(schedule.participants || "");
    setNewUrl(schedule.url || "");
    setNewNotes(schedule.notes || "");
    setNewIsPrivate(Boolean(schedule.isPrivate));
    setNewRepeatWeekdays(schedule.recurrence?.weekdays ?? []);
    setNewRepeatMode(schedule.recurrence?.isInfinite ? "infinite" : "finite");
    setNewRepeatCount(schedule.recurrence?.count ? String(schedule.recurrence.count) : "8");
    const scheduleReminderOffsets = normalizeReminderOffsets(schedule.reminderOffsetsMinutes);
    setNewReminderOffsets(scheduleReminderOffsets);
    const allDayReminderTime = parseAllDayReminderTime(schedule.allDayReminderTime);
    setNewAllDayReminderHour(String(allDayReminderTime.hour).padStart(2, "0"));
    setNewAllDayReminderMinute(String(allDayReminderTime.minute).padStart(2, "0"));
    setNotificationPermission(getReminderNotificationPermission());
  };

  const handleQuickEdit = (scheduleId: string) => {
    if (!canEditSchedule(scheduleId)) {
      return;
    }
    const schedule = schedules.find((s) => s.id === scheduleId);
    if (schedule) {
      populateFormWithSchedule(schedule);
      setIsEditingSchedule(true);
    }
  };

  const handleDetailEdit = () => {
    if (viewingSchedule && canEditSchedule(viewingSchedule.id)) {
      populateFormWithSchedule(viewingSchedule);
      setIsEditingSchedule(true);
      setViewingScheduleId(null);
    }
  };

  const handleDetailDelete = () => {
    if (viewingSchedule && canDeleteSchedule(viewingSchedule.id)) {
      setPendingDeleteScheduleId(viewingSchedule.id);
      setPendingDeleteScope("single");
    }
  };

  const handleDeleteClick = (scheduleId: string) => {
    if (!canDeleteSchedule(scheduleId)) {
      return;
    }
    setPendingDeleteScheduleId(scheduleId);
    setPendingDeleteScope("single");
  };

  const handleConfirmDelete = () => {
    if (!pendingDeleteScheduleId) {
      return;
    }
    deleteSchedule(pendingDeleteScheduleId, pendingDeleteScope);
    if (viewingScheduleId === pendingDeleteScheduleId) {
      setViewingScheduleId(null);
    }
    setPendingDeleteScheduleId(null);
    setPendingDeleteScope("single");
  };

  const handleRequestRemoveMember = (memberId: string) => {
    setPendingDeleteMemberId(memberId);
  };

  const handleConfirmRemoveMember = () => {
    if (!pendingDeleteMemberId) {
      return;
    }
    removeMember(pendingDeleteMemberId);
    if (activeViewerMode === `member:${pendingDeleteMemberId}`) {
      setActiveViewerMode("owner");
    }
    setPendingDeleteMemberId(null);
  };

  const handleAdd = () => {
    if (!canMutateSchedules) return;
    if (!newTitle.trim()) return;
    if (!validateSchedule()) return;

    const dueDate = new Date(newDueDate);
    if (currentMode === "schedule" && newIsAllDay) {
      dueDate.setHours(0, 0, 0, 0);
    } else {
      dueDate.setHours(parseInt(newDueHour), parseInt(newDueMinute), 0, 0);
    }

    const endDate = currentMode === "schedule" && newEndDate ? new Date(newEndDate) : undefined;
    if (endDate) {
      if (newIsAllDay) {
        endDate.setHours(23, 59, 59, 999);
      } else {
        endDate.setHours(parseInt(newEndHour), parseInt(newEndMinute), 0, 0);
      }
    }
    const allDayReminderTime =
      currentMode === "schedule" && newIsAllDay
        ? buildAllDayReminderTime(newAllDayReminderHour, newAllDayReminderMinute)
        : undefined;

    addSchedule({
      title: newTitle.trim(),
      mode: currentMode,
      tags: selectedTagObjects,
      dueDate,
      endDate,
      isAllDay: currentMode === "schedule" ? newIsAllDay : undefined,
      color: newItemColor,
      location: newLocation.trim() || undefined,
      items: newItems.trim() || undefined,
      participants: newParticipants.trim() || undefined,
      url: newUrl.trim() || undefined,
      notes: newNotes.trim() || undefined,
      isPrivate: newIsPrivate,
      recurrence: normalizedRecurrence,
      reminderOffsetsMinutes: normalizedReminderOffsets,
      allDayReminderTime,
      ownerId: ownerUserId || DEFAULT_OWNER_USER_ID,
      ownerDisplayName: sharing.owner.displayName || "あなた",
    });

    addActivity({
      type: "schedule_create",
      description: `「${newTitle.trim()}」を追加`,
      metadata: {
        scheduleMode: currentMode,
        tags: selectedTagObjects.map((tag) => tag.name),
      },
    });

    resetScheduleForm();
    setIsAddingSchedule(false);
  };

  const handleUpdateSchedule = () => {
    if (!canMutateSchedules) return;
    if (!newTitle.trim() || !editingScheduleId) return;
    if (!validateSchedule()) return;

    const dueDate = new Date(newDueDate);
    if (currentMode === "schedule" && newIsAllDay) {
      dueDate.setHours(0, 0, 0, 0);
    } else {
      dueDate.setHours(parseInt(newDueHour), parseInt(newDueMinute), 0, 0);
    }

    const endDate = currentMode === "schedule" && newEndDate ? new Date(newEndDate) : undefined;
    if (endDate) {
      if (newIsAllDay) {
        endDate.setHours(23, 59, 59, 999);
      } else {
        endDate.setHours(parseInt(newEndHour), parseInt(newEndMinute), 0, 0);
      }
    }
    const allDayReminderTime =
      currentMode === "schedule" && newIsAllDay
        ? buildAllDayReminderTime(newAllDayReminderHour, newAllDayReminderMinute)
        : undefined;

    updateSchedule(editingScheduleId, {
      title: newTitle.trim(),
      mode: currentMode,
      tags: selectedTagObjects,
      dueDate,
      endDate,
      isAllDay: currentMode === "schedule" ? newIsAllDay : undefined,
      color: newItemColor,
      location: newLocation.trim() || undefined,
      items: newItems.trim() || undefined,
      participants: newParticipants.trim() || undefined,
      url: newUrl.trim() || undefined,
      notes: newNotes.trim() || undefined,
      isPrivate: newIsPrivate,
      recurrence: normalizedRecurrence ?? undefined,
      reminderOffsetsMinutes: normalizedReminderOffsets,
      allDayReminderTime,
    });

    resetScheduleForm();
    setIsEditingSchedule(false);
    setEditingScheduleId(null);
  };

  const handleToggleComplete = (id: string) => {
    if (!canToggleSchedule(id)) {
      return;
    }
    const item = schedules.find((s) => s.id === id);
    if (item && !item.completed && item.mode === "task") {
      addActivity({
        type: "task_complete",
        description: `「${item.title}」を完了`,
        metadata: {
          scheduleId: item.id,
          scheduleMode: item.mode,
          tags: item.tags.map((tag) => tag.name),
        },
      });
    }
    toggleComplete(id);
  };

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="flex-shrink-0 flex flex-row items-center justify-between space-y-0 pb-4 border-b bg-gradient-to-r from-emerald-50/80 to-transparent">
        <CardTitle className="text-xl flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-sm">
            <CalendarDays className="h-4 w-4" />
          </div>
          <span className="bg-gradient-to-r from-emerald-700 to-green-600 bg-clip-text text-transparent">
            スケジュール
          </span>
        </CardTitle>
        <div className="flex gap-2 items-center">
          <Button variant="outline" size="sm" onClick={() => setShowTagManager(true)}>
            <Tag className="h-4 w-4 mr-1" />
            タグ
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSharingPanel(true)}>
            <Share2 className="h-4 w-4 mr-1" />
            共有
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setIsAddingSchedule(true)}
            disabled={!canMutateSchedules}
          >
            <Plus className="h-4 w-4 mr-1" />
            追加
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col p-0">
        {/* Tag Manager Modal */}
        <Dialog open={showTagManager} onOpenChange={setShowTagManager}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>タグ管理</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium mb-2">タグ一覧</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                  {sortedTags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                      <span className="rounded-full bg-black/20 px-1.5 py-0.5 text-[10px]">
                        {TAG_PRIORITY_LABELS[tag.priority]}
                      </span>
                      {tag.id !== "tag-1" && (
                        <button
                          onClick={() => handleDeleteTag(tag.id)}
                          className="ml-1 hover:opacity-80"
                          aria-label={`${tag.name}タグを削除`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                      {tag.id !== "tag-1" && (
                        <select
                          className="text-[10px] rounded border border-white/50 bg-white/20 px-1 py-0.5 text-white"
                          value={tag.priority}
                          onChange={(e) =>
                            updateTag(tag.id, { priority: e.target.value as TagPriority })
                          }
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="high" className="text-black">
                            高
                          </option>
                          <option value="medium" className="text-black">
                            中
                          </option>
                          <option value="low" className="text-black">
                            低
                          </option>
                        </select>
                      )}
                      <label
                        className="ml-1 inline-flex items-center gap-1 text-[10px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={tag.conflictWarningsEnabled !== false}
                          onCheckedChange={(checked) =>
                            updateTag(tag.id, { conflictWarningsEnabled: checked === true })
                          }
                          className="h-3 w-3 border-white/70 data-[state=checked]:bg-white data-[state=checked]:text-black"
                        />
                        重複警告
                      </label>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2 p-2 bg-muted rounded-md">
                <div className="flex gap-2">
                  <Input
                    placeholder="タグ名"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    size={2}
                    maxLength={20}
                    className="text-xs flex-1"
                  />
                  <div className="flex items-center gap-1">
                    {DEFAULT_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setNewTagColor(color)}
                        className={cn(
                          "w-6 h-6 rounded-full border-2",
                          newTagColor === color ? "border-foreground" : "border-transparent",
                        )}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">優先度</Label>
                  <select
                    className="text-xs rounded border border-input bg-background px-2 py-1"
                    value={newTagPriority}
                    onChange={(e) => setNewTagPriority(e.target.value as TagPriority)}
                  >
                    <option value="high">高</option>
                    <option value="medium">中</option>
                    <option value="low">低</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" onClick={handleAddTag} disabled={!newTagName.trim()}>
                    <Plus className="h-3 w-3 mr-1" />
                    追加
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Schedule Modal */}
        <Dialog open={isAddingSchedule} onOpenChange={setIsAddingSchedule}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>{currentMode === "task" ? "タスク追加" : "予定追加"}</DialogTitle>
                <div className="flex gap-1 bg-muted rounded-md p-1">
                  <button
                    onClick={() => {
                      setCurrentMode("task");
                      setNewIsAllDay(false);
                      setNewEndDate("");
                    }}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-medium transition-colors",
                      currentMode === "task"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    タスク
                  </button>
                  <button
                    onClick={() => setCurrentMode("schedule")}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-medium transition-colors",
                      currentMode === "schedule"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    予定
                  </button>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="タイトル"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                autoFocus
              />
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold">プライベート予定</p>
                  <p className="text-[11px] text-muted-foreground">
                    OWNER以外には詳細を表示しません
                  </p>
                </div>
                <Checkbox
                  checked={newIsPrivate}
                  onCheckedChange={(checked) => setNewIsPrivate(checked === true)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {currentMode === "task" ? "期限" : "開始日"}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="flex-1"
                  />
                  {!(currentMode === "schedule" && newIsAllDay) && (
                    <>
                      <Input
                        type="number"
                        min="0"
                        max="23"
                        value={newDueHour}
                        onChange={(e) => setNewDueHour(e.target.value.padStart(2, "0"))}
                        placeholder="時"
                        className="w-16"
                      />
                      <span className="flex items-center">:</span>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={newDueMinute}
                        onChange={(e) => setNewDueMinute(e.target.value.padStart(2, "0"))}
                        placeholder="分"
                        className="w-16"
                      />
                    </>
                  )}
                </div>
              </div>
              {currentMode === "schedule" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="all-day-add"
                    checked={newIsAllDay}
                    onCheckedChange={(checked) => setNewIsAllDay(checked === true)}
                  />
                  <Label htmlFor="all-day-add" className="text-sm font-medium cursor-pointer">
                    終日
                  </Label>
                </div>
              )}
              {currentMode === "schedule" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    終了日（オプション）
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={newEndDate}
                      onChange={(e) => setNewEndDate(e.target.value)}
                      className="flex-1"
                    />
                    {!newIsAllDay && (
                      <>
                        <Input
                          type="number"
                          min="0"
                          max="23"
                          value={newEndHour}
                          onChange={(e) => setNewEndHour(e.target.value.padStart(2, "0"))}
                          placeholder="時"
                          className="w-16"
                        />
                        <span className="flex items-center">:</span>
                        <Input
                          type="number"
                          min="0"
                          max="59"
                          value={newEndMinute}
                          onChange={(e) => setNewEndMinute(e.target.value.padStart(2, "0"))}
                          placeholder="分"
                          className="w-16"
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-2 rounded-md border p-3">
                <label className="text-xs font-medium text-muted-foreground">
                  繰り返し（曜日）
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_OPTIONS.map((weekday) => (
                    <button
                      key={`repeat-add-${weekday}`}
                      type="button"
                      onClick={() => toggleRepeatWeekday(weekday)}
                      className={cn(
                        "h-7 w-7 rounded-full border text-xs",
                        newRepeatWeekdays.includes(weekday)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground",
                      )}
                    >
                      {WEEKDAY_LABELS[weekday]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">繰り返し設定</label>
                  <div className="flex items-center gap-1 rounded-md border p-1">
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        newRepeatMode === "finite"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setNewRepeatMode("finite")}
                    >
                      回数指定
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        newRepeatMode === "infinite"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setNewRepeatMode("infinite")}
                    >
                      永続
                    </button>
                  </div>
                  {newRepeatMode === "finite" ? (
                    <Input
                      type="number"
                      min="2"
                      max="365"
                      value={newRepeatCount}
                      onChange={(e) => setNewRepeatCount(e.target.value)}
                      className="w-24"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">終了なし</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatRecurrenceSummary(normalizedRecurrence)}
                  </span>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Bell className="h-3.5 w-3.5" />
                    リマインド通知
                  </label>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      getReminderPermissionBadgeClass(notificationPermission),
                    )}
                  >
                    {REMINDER_PERMISSION_LABELS[notificationPermission]}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REMINDER_OPTIONS.map((option) => (
                    <button
                      key={`reminder-add-${option.minutes}`}
                      type="button"
                      onClick={() => toggleReminderOffset(option.minutes)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        normalizedReminderOffsets.includes(option.minutes)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input text-muted-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">選択中: {reminderSummary}</p>
                {currentMode === "schedule" && newIsAllDay && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      終日予定の基準時刻（通知計算用）
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="23"
                        value={newAllDayReminderHour}
                        onChange={(e) => setNewAllDayReminderHour(e.target.value.padStart(2, "0"))}
                        className="w-16"
                      />
                      <span>:</span>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={newAllDayReminderMinute}
                        onChange={(e) =>
                          setNewAllDayReminderMinute(e.target.value.padStart(2, "0"))
                        }
                        className="w-16"
                      />
                    </div>
                  </div>
                )}
                {notificationPermission !== "granted" &&
                  notificationPermission !== "unsupported" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={handleRequestNotificationPermission}
                    >
                      通知を許可
                    </Button>
                  )}
              </div>
              {validationError && (
                <div className="px-3 py-2 bg-destructive/10 border border-destructive/50 rounded-md">
                  <p className="text-xs text-destructive">{validationError}</p>
                </div>
              )}

              {/* Warnings Section for Add Modal */}
              {shouldShowConflictWarning || (shouldShowOverdueWarning && isCurrentOverdue) ? (
                <div className="space-y-2">
                  {/* Conflict Warning */}
                  {shouldShowConflictWarning && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center gap-2 text-amber-800 mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium text-sm">
                          {visibleConflicts.length}件のスケジュールと重複しています
                        </span>
                      </div>
                      <div className="space-y-1">
                        {visibleConflicts.map((conflict, i) => (
                          <div key={i} className="text-xs text-amber-700 flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span className="font-medium">
                              {conflict.conflictingSchedule.title}
                            </span>
                            <span>({conflict.conflictingSchedule.dueDate})</span>
                            {conflict.type === "exact" && (
                              <span className="text-amber-600">- 同時刻</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Overdue Warning */}
                  {shouldShowOverdueWarning && isCurrentOverdue && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center gap-2 text-red-800">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium text-sm">期限が過去の日付です</span>
                      </div>
                    </div>
                  )}

                  {/* Per-item opt-out */}
                </div>
              ) : null}

              {/* Muted indicator when warnings are disabled */}
              {hasTagFilteredConflicts && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <BellOff className="h-3.5 w-3.5" />
                  <span>
                    {currentConflicts.length}件の重複（警告ONタグ付き候補がないため非表示）
                  </span>
                  <button
                    onClick={() => setShowTagManager(true)}
                    className="ml-auto text-xs text-blue-600 hover:underline"
                  >
                    タグ設定
                  </button>
                </div>
              )}
              {!shouldShowConflictWarning && !shouldShowOverdueWarning && isCurrentOverdue && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <BellOff className="h-3.5 w-3.5" />
                  <span>
                    {isCurrentOverdue && "期限超過"}
                    （警告は非表示）
                  </span>
                  <button
                    onClick={() => setShowWarningSettings(true)}
                    className="ml-auto text-xs text-blue-600 hover:underline"
                  >
                    設定
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">アイテムの色</label>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewItemColor(color)}
                      className={cn(
                        "w-8 h-8 rounded-lg border-2 transition-transform",
                        newItemColor === color
                          ? "border-foreground scale-110"
                          : "border-transparent",
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">タグを選択</label>
                <div className="flex flex-wrap gap-2">
                  {sortedTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleToggleTagSelection(tag.id)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium text-white transition-all border-2",
                        selectedTags.includes(tag.id)
                          ? "border-current scale-105"
                          : "border-transparent opacity-75 hover:opacity-100",
                      )}
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extended fields section */}
              <div className="border-t pt-4 mt-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-3">
                  詳細情報（オプション）
                </h4>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="location" className="text-xs font-medium text-muted-foreground">
                      場所
                    </label>
                    <Input
                      id="location"
                      placeholder="例: 会議室B"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="items" className="text-xs font-medium text-muted-foreground">
                      持ち物
                    </label>
                    <Input
                      id="items"
                      placeholder="例: パソコン、資料、筆記用具"
                      value={newItems}
                      onChange={(e) => setNewItems(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="participants"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      他の参加者
                    </label>
                    <Input
                      id="participants"
                      placeholder="例: 田中太郎、山田花子"
                      value={newParticipants}
                      onChange={(e) => setNewParticipants(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="url" className="text-xs font-medium text-muted-foreground">
                      URL
                    </label>
                    <Input
                      id="url"
                      placeholder="https://example.com"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="notes" className="text-xs font-medium text-muted-foreground">
                      備考
                    </label>
                    <textarea
                      id="notes"
                      placeholder="その他の注記や詳細情報"
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsAddingSchedule(false);
                  resetScheduleForm();
                }}
              >
                キャンセル
              </Button>
              <Button onClick={handleAdd} disabled={!newTitle.trim()}>
                追加
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Schedule Modal */}
        <Dialog open={isEditingSchedule} onOpenChange={setIsEditingSchedule}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle>{currentMode === "task" ? "タスク編集" : "予定編集"}</DialogTitle>
                <div className="flex gap-1 bg-muted rounded-md p-1">
                  <button
                    onClick={() => {
                      setCurrentMode("task");
                      setNewIsAllDay(false);
                      setNewEndDate("");
                    }}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-medium transition-colors",
                      currentMode === "task"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    タスク
                  </button>
                  <button
                    onClick={() => setCurrentMode("schedule")}
                    className={cn(
                      "px-3 py-1 rounded text-xs font-medium transition-colors",
                      currentMode === "schedule"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    予定
                  </button>
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                placeholder="タイトル"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
              <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                <div>
                  <p className="text-xs font-semibold">プライベート予定</p>
                  <p className="text-[11px] text-muted-foreground">
                    OWNER以外には詳細を表示しません
                  </p>
                </div>
                <Checkbox
                  checked={newIsPrivate}
                  onCheckedChange={(checked) => setNewIsPrivate(checked === true)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  {currentMode === "task" ? "期限" : "開始日"}
                </label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="flex-1"
                  />
                  {!(currentMode === "schedule" && newIsAllDay) && (
                    <>
                      <Input
                        type="number"
                        min="0"
                        max="23"
                        value={newDueHour}
                        onChange={(e) => setNewDueHour(e.target.value.padStart(2, "0"))}
                        placeholder="時"
                        className="w-16"
                      />
                      <span className="flex items-center">:</span>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={newDueMinute}
                        onChange={(e) => setNewDueMinute(e.target.value.padStart(2, "0"))}
                        placeholder="分"
                        className="w-16"
                      />
                    </>
                  )}
                </div>
              </div>
              {currentMode === "schedule" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="all-day-edit"
                    checked={newIsAllDay}
                    onCheckedChange={(checked) => setNewIsAllDay(checked === true)}
                  />
                  <Label htmlFor="all-day-edit" className="text-sm font-medium cursor-pointer">
                    終日
                  </Label>
                </div>
              )}
              {currentMode === "schedule" && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    終了日（オプション）
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="date"
                      value={newEndDate}
                      onChange={(e) => setNewEndDate(e.target.value)}
                      className="flex-1"
                    />
                    {!newIsAllDay && (
                      <>
                        <Input
                          type="number"
                          min="0"
                          max="23"
                          value={newEndHour}
                          onChange={(e) => setNewEndHour(e.target.value.padStart(2, "0"))}
                          placeholder="時"
                          className="w-16"
                        />
                        <span className="flex items-center">:</span>
                        <Input
                          type="number"
                          min="0"
                          max="59"
                          value={newEndMinute}
                          onChange={(e) => setNewEndMinute(e.target.value.padStart(2, "0"))}
                          placeholder="分"
                          className="w-16"
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="space-y-2 rounded-md border p-3">
                <label className="text-xs font-medium text-muted-foreground">
                  繰り返し（曜日）
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_OPTIONS.map((weekday) => (
                    <button
                      key={`repeat-edit-${weekday}`}
                      type="button"
                      onClick={() => toggleRepeatWeekday(weekday)}
                      className={cn(
                        "h-7 w-7 rounded-full border text-xs",
                        newRepeatWeekdays.includes(weekday)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background text-muted-foreground",
                      )}
                    >
                      {WEEKDAY_LABELS[weekday]}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">繰り返し設定</label>
                  <div className="flex items-center gap-1 rounded-md border p-1">
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        newRepeatMode === "finite"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setNewRepeatMode("finite")}
                    >
                      回数指定
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        newRepeatMode === "infinite"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setNewRepeatMode("infinite")}
                    >
                      永続
                    </button>
                  </div>
                  {newRepeatMode === "finite" ? (
                    <Input
                      type="number"
                      min="2"
                      max="365"
                      value={newRepeatCount}
                      onChange={(e) => setNewRepeatCount(e.target.value)}
                      className="w-24"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">終了なし</span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatRecurrenceSummary(normalizedRecurrence)}
                  </span>
                </div>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Bell className="h-3.5 w-3.5" />
                    リマインド通知
                  </label>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      getReminderPermissionBadgeClass(notificationPermission),
                    )}
                  >
                    {REMINDER_PERMISSION_LABELS[notificationPermission]}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REMINDER_OPTIONS.map((option) => (
                    <button
                      key={`reminder-edit-${option.minutes}`}
                      type="button"
                      onClick={() => toggleReminderOffset(option.minutes)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs",
                        normalizedReminderOffsets.includes(option.minutes)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input text-muted-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">選択中: {reminderSummary}</p>
                {currentMode === "schedule" && newIsAllDay && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      終日予定の基準時刻（通知計算用）
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="23"
                        value={newAllDayReminderHour}
                        onChange={(e) => setNewAllDayReminderHour(e.target.value.padStart(2, "0"))}
                        className="w-16"
                      />
                      <span>:</span>
                      <Input
                        type="number"
                        min="0"
                        max="59"
                        value={newAllDayReminderMinute}
                        onChange={(e) =>
                          setNewAllDayReminderMinute(e.target.value.padStart(2, "0"))
                        }
                        className="w-16"
                      />
                    </div>
                  </div>
                )}
                {notificationPermission !== "granted" &&
                  notificationPermission !== "unsupported" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={handleRequestNotificationPermission}
                    >
                      通知を許可
                    </Button>
                  )}
              </div>
              {validationError && (
                <div className="px-3 py-2 bg-destructive/10 border border-destructive/50 rounded-md">
                  <p className="text-xs text-destructive">{validationError}</p>
                </div>
              )}

              {/* Warnings Section for Edit Modal */}
              {shouldShowConflictWarning || (shouldShowOverdueWarning && isCurrentOverdue) ? (
                <div className="space-y-2">
                  {/* Conflict Warning */}
                  {shouldShowConflictWarning && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-center gap-2 text-amber-800 mb-2">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium text-sm">
                          {visibleConflicts.length}件のスケジュールと重複しています
                        </span>
                      </div>
                      <div className="space-y-1">
                        {visibleConflicts.map((conflict, i) => (
                          <div key={i} className="text-xs text-amber-700 flex items-center gap-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                            <span className="font-medium">
                              {conflict.conflictingSchedule.title}
                            </span>
                            <span>({conflict.conflictingSchedule.dueDate})</span>
                            {conflict.type === "exact" && (
                              <span className="text-amber-600">- 同時刻</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Overdue Warning */}
                  {shouldShowOverdueWarning && isCurrentOverdue && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div className="flex items-center gap-2 text-red-800">
                        <AlertTriangle className="h-4 w-4" />
                        <span className="font-medium text-sm">期限が過去の日付です</span>
                      </div>
                    </div>
                  )}

                  {/* Per-item opt-out */}
                </div>
              ) : null}

              {/* Muted indicator when warnings are disabled */}
              {hasTagFilteredConflicts && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <BellOff className="h-3.5 w-3.5" />
                  <span>
                    {currentConflicts.length}件の重複（警告ONタグ付き候補がないため非表示）
                  </span>
                  <button
                    onClick={() => setShowTagManager(true)}
                    className="ml-auto text-xs text-blue-600 hover:underline"
                  >
                    タグ設定
                  </button>
                </div>
              )}
              {!shouldShowConflictWarning && !shouldShowOverdueWarning && isCurrentOverdue && (
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                  <BellOff className="h-3.5 w-3.5" />
                  <span>
                    {isCurrentOverdue && "期限超過"}
                    （警告は非表示）
                  </span>
                  <button
                    onClick={() => setShowWarningSettings(true)}
                    className="ml-auto text-xs text-blue-600 hover:underline"
                  >
                    設定
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">アイテムの色</label>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewItemColor(color)}
                      className={cn(
                        "w-8 h-8 rounded-lg border-2 transition-transform",
                        newItemColor === color
                          ? "border-foreground scale-110"
                          : "border-transparent",
                      )}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">タグを選択</label>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => handleToggleTagSelection(tag.id)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium text-white transition-all border-2",
                        selectedTags.includes(tag.id)
                          ? "border-current scale-105"
                          : "border-transparent opacity-75 hover:opacity-100",
                      )}
                      style={{ backgroundColor: tag.color }}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extended fields section */}
              <div className="border-t pt-4 mt-4">
                <h4 className="text-xs font-medium text-muted-foreground mb-3">
                  詳細情報（オプション）
                </h4>
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="edit-location"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      場所
                    </label>
                    <Input
                      id="edit-location"
                      placeholder="例: 会議室B"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="edit-items"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      持ち物
                    </label>
                    <Input
                      id="edit-items"
                      placeholder="例: パソコン、資料、筆記用具"
                      value={newItems}
                      onChange={(e) => setNewItems(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="edit-participants"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      他の参加者
                    </label>
                    <Input
                      id="edit-participants"
                      placeholder="例: 田中太郎、山田花子"
                      value={newParticipants}
                      onChange={(e) => setNewParticipants(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-url" className="text-xs font-medium text-muted-foreground">
                      URL
                    </label>
                    <Input
                      id="edit-url"
                      placeholder="https://example.com"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="edit-notes"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      備考
                    </label>
                    <textarea
                      id="edit-notes"
                      placeholder="その他の注記や詳細情報"
                      value={newNotes}
                      onChange={(e) => setNewNotes(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      rows={3}
                    />
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditingSchedule(false);
                  resetScheduleForm();
                }}
              >
                キャンセル
              </Button>
              <Button onClick={handleUpdateSchedule} disabled={!newTitle.trim()}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Calendar section */}
        <div className="px-4 py-3 border-b">
          <Calendar
            size="standard"
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
            onEventClick={handleEventClick}
            datesWithEvents={datesWithEvents}
            showCellBorders
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              自分の予定
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              共有相手の予定
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
              <span className="h-2 w-2 rounded-full bg-slate-500" />
              Booked表示
            </span>
          </div>
          {selectedDate && (
            <div
              className={cn(
                "mt-4 p-4 rounded-xl",
                "bg-card border border-border/60",
                "transition-all duration-300",
              )}
            >
              {/* Header - Bold date display */}
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-foreground">
                  {selectedDate.toLocaleDateString("ja-JP", {
                    month: "long",
                    day: "numeric",
                  })}
                  <span className="text-muted-foreground font-normal ml-1">
                    ({["日", "月", "火", "水", "木", "金", "土"][selectedDate.getDay()]})
                  </span>
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-9 px-3 text-muted-foreground hover:text-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  onClick={() => onDateSelect?.(null)}
                  aria-label="日付選択をクリア"
                >
                  <X className="h-4 w-4 mr-1.5" />
                  <span className="text-sm">クリア</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pt-4">
          {/* When filtering by date, show only that date's schedules */}
          {filteredSchedules ? (
            <>
              {filteredSchedules.length > 0 ? (
                <div className="space-y-2">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">並び順:</span>
                    <Button
                      variant={sortMode === "priority" ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSortMode("priority")}
                    >
                      優先度順
                    </Button>
                    <Button
                      variant={sortMode === "date" ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSortMode("date")}
                    >
                      日付順
                    </Button>
                  </div>
                  {filteredSchedules.map((item) => (
                    <ScheduleItem
                      key={item.id}
                      item={item}
                      onToggleComplete={() => handleToggleComplete(item.id)}
                      onDelete={() => handleDeleteClick(item.id)}
                      onEdit={() => handleQuickEdit(item.id)}
                      onView={() => handleViewDetail(item.id)}
                      viewDate={selectedDate}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <CalendarDays className="h-10 w-10 mb-3 opacity-50" />
                  <p className="text-sm font-medium">この日の予定はありません</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={!canMutateSchedules}
                    onClick={() => {
                      if (!canMutateSchedules) {
                        return;
                      }
                      setNewDueDate(formatDateKey(selectedDate!));
                      setIsAddingSchedule(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    予定を追加
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">並び順:</span>
                <Button
                  variant={sortMode === "priority" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSortMode("priority")}
                >
                  優先度順
                </Button>
                <Button
                  variant={sortMode === "date" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSortMode("date")}
                >
                  日付順
                </Button>
                <span className="ml-2 text-xs text-muted-foreground">表示:</span>
                <Button
                  variant={categoryViewMode === "list" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategoryViewMode("list")}
                >
                  一覧
                </Button>
                <Button
                  variant={categoryViewMode === "split" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setCategoryViewMode("split")}
                >
                  スプリット
                </Button>
              </div>
              {schedules.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="relative mb-6">
                    <div className="absolute -inset-2 rounded-full bg-gradient-to-br from-emerald-100 to-green-50 blur-lg" />
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-50 to-green-50 border-2 border-emerald-100">
                      <CalendarDays className="h-10 w-10 text-emerald-400" />
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-foreground mb-1">
                    予定・タスクがありません
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    まずは最初のスケジュールを追加してみましょう
                  </p>
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white shadow-md"
                    disabled={!canMutateSchedules}
                    onClick={() => {
                      if (!canMutateSchedules) {
                        return;
                      }
                      setIsAddingSchedule(true);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    スケジュールを追加
                  </Button>
                </div>
              ) : categoryViewMode === "split" ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="space-y-6">
                    {upcomingSchedules.length > 0 && (
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                          <CalendarDays className="h-4 w-4" />
                          予定 ({upcomingSchedules.length})
                        </h3>
                        <div className="space-y-2">
                          {upcomingSchedules.map((item) => (
                            <ScheduleItem
                              key={item.id}
                              item={item}
                              onToggleComplete={() => handleToggleComplete(item.id)}
                              onDelete={() => handleDeleteClick(item.id)}
                              onEdit={() => handleQuickEdit(item.id)}
                              onView={() => handleViewDetail(item.id)}
                              viewDate={today}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {completedSchedules.length > 0 && (
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                          <ListTodo className="h-4 w-4" />
                          予定 - 完了済み ({completedSchedulesAll.length})
                        </h3>
                        <div className="space-y-2">
                          {completedSchedules.map((item) => (
                            <ScheduleItem
                              key={item.id}
                              item={item}
                              onToggleComplete={() => handleToggleComplete(item.id)}
                              onDelete={() => handleDeleteClick(item.id)}
                              onEdit={() => handleQuickEdit(item.id)}
                              onView={() => handleViewDetail(item.id)}
                              viewDate={today}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {upcomingSchedules.length === 0 && completedSchedules.length === 0 && (
                      <p className="text-sm text-muted-foreground py-3 text-center">
                        予定がありません
                      </p>
                    )}
                  </div>

                  <div className="space-y-6">
                    {overdueTasks.length > 0 && (
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-destructive mb-3">
                          <AlertTriangle className="h-4 w-4" />
                          タスク - 期限超過 ({overdueTasks.length})
                        </h3>
                        <div className="space-y-2">
                          {overdueTasks.map((item) => (
                            <ScheduleItem
                              key={item.id}
                              item={item}
                              onToggleComplete={() => handleToggleComplete(item.id)}
                              onDelete={() => handleDeleteClick(item.id)}
                              onEdit={() => handleQuickEdit(item.id)}
                              onView={() => handleViewDetail(item.id)}
                              viewDate={today}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {upcomingTasks.length > 0 && (
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                          <CalendarDays className="h-4 w-4" />
                          タスク ({upcomingTasks.length})
                        </h3>
                        <div className="space-y-2">
                          {upcomingTasks.map((item) => (
                            <ScheduleItem
                              key={item.id}
                              item={item}
                              onToggleComplete={() => handleToggleComplete(item.id)}
                              onDelete={() => handleDeleteClick(item.id)}
                              onEdit={() => handleQuickEdit(item.id)}
                              onView={() => handleViewDetail(item.id)}
                              viewDate={today}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {completedTasks.length > 0 && (
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                          <ListTodo className="h-4 w-4" />
                          タスク - 完了済み ({completedTasksAll.length})
                        </h3>
                        <div className="space-y-2">
                          {completedTasks.map((item) => (
                            <ScheduleItem
                              key={item.id}
                              item={item}
                              onToggleComplete={() => handleToggleComplete(item.id)}
                              onDelete={() => handleDeleteClick(item.id)}
                              onEdit={() => handleQuickEdit(item.id)}
                              onView={() => handleViewDetail(item.id)}
                              viewDate={today}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {overdueTasks.length === 0 &&
                      upcomingTasks.length === 0 &&
                      completedTasks.length === 0 && (
                        <p className="text-sm text-muted-foreground py-3 text-center">
                          タスクがありません
                        </p>
                      )}
                  </div>
                </div>
              ) : (
                <>
                  {upcomingSchedules.length > 0 && (
                    <div className="mb-6">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                        <CalendarDays className="h-4 w-4" />
                        予定 ({upcomingSchedules.length})
                      </h3>
                      <div className="space-y-2">
                        {upcomingSchedules.map((item) => (
                          <ScheduleItem
                            key={item.id}
                            item={item}
                            onToggleComplete={() => handleToggleComplete(item.id)}
                            onDelete={() => handleDeleteClick(item.id)}
                            onEdit={() => handleQuickEdit(item.id)}
                            onView={() => handleViewDetail(item.id)}
                            viewDate={today}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {completedSchedules.length > 0 && (
                    <div className="mb-6">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                        <ListTodo className="h-4 w-4" />
                        予定 - 完了済み ({completedSchedulesAll.length})
                      </h3>
                      <div className="space-y-2">
                        {completedSchedules.map((item) => (
                          <ScheduleItem
                            key={item.id}
                            item={item}
                            onToggleComplete={() => handleToggleComplete(item.id)}
                            onDelete={() => handleDeleteClick(item.id)}
                            onEdit={() => handleQuickEdit(item.id)}
                            onView={() => handleViewDetail(item.id)}
                            viewDate={today}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {overdueTasks.length > 0 && (
                    <div className="mb-6">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-destructive mb-3">
                        <AlertTriangle className="h-4 w-4" />
                        タスク - 期限超過 ({overdueTasks.length})
                      </h3>
                      <div className="space-y-2">
                        {overdueTasks.map((item) => (
                          <ScheduleItem
                            key={item.id}
                            item={item}
                            onToggleComplete={() => handleToggleComplete(item.id)}
                            onDelete={() => handleDeleteClick(item.id)}
                            onEdit={() => handleQuickEdit(item.id)}
                            onView={() => handleViewDetail(item.id)}
                            viewDate={today}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {upcomingTasks.length > 0 && (
                    <div className="mb-6">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                        <CalendarDays className="h-4 w-4" />
                        タスク ({upcomingTasks.length})
                      </h3>
                      <div className="space-y-2">
                        {upcomingTasks.map((item) => (
                          <ScheduleItem
                            key={item.id}
                            item={item}
                            onToggleComplete={() => handleToggleComplete(item.id)}
                            onDelete={() => handleDeleteClick(item.id)}
                            onEdit={() => handleQuickEdit(item.id)}
                            onView={() => handleViewDetail(item.id)}
                            viewDate={today}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {completedTasks.length > 0 && (
                    <div className="mb-6">
                      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
                        <ListTodo className="h-4 w-4" />
                        タスク - 完了済み ({completedTasksAll.length})
                      </h3>
                      <div className="space-y-2">
                        {completedTasks.map((item) => (
                          <ScheduleItem
                            key={item.id}
                            item={item}
                            onToggleComplete={() => handleToggleComplete(item.id)}
                            onDelete={() => handleDeleteClick(item.id)}
                            onEdit={() => handleQuickEdit(item.id)}
                            onView={() => handleViewDetail(item.id)}
                            viewDate={today}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </CardContent>

      {/* Warning Settings Modal */}
      <Dialog open={showWarningSettings} onOpenChange={setShowWarningSettings}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              警告設定
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="conflict-warnings" className="text-sm font-medium">
                  重複警告
                </Label>
                <p className="text-xs text-muted-foreground">
                  スケジュールが重複している場合に警告
                </p>
              </div>
              <Checkbox
                id="conflict-warnings"
                checked={warningSettings.conflictWarnings}
                onCheckedChange={(checked) => setConflictWarnings(checked === true)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="overdue-warnings" className="text-sm font-medium">
                  期限超過警告
                </Label>
                <p className="text-xs text-muted-foreground">
                  タスクの期限が過去の日付の場合に警告
                </p>
              </div>
              <Checkbox
                id="overdue-warnings"
                checked={warningSettings.overdueWarnings}
                onCheckedChange={(checked) => setOverdueWarnings(checked === true)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowWarningSettings(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CalendarSharingPanel
        open={showSharingPanel}
        onOpenChange={setShowSharingPanel}
        sharing={sharing}
        activeViewerMode={activeViewerMode}
        onActiveViewerModeChange={setActiveViewerMode}
        onInviteMember={(input) => inviteMember(input)}
        onUpdateMemberRole={(memberId, role) => {
          updateMemberRole(memberId, role);
        }}
        onRemoveMember={handleRequestRemoveMember}
        onPublicLinkEnabledChange={(enabled) => {
          setPublicLinkEnabled(enabled);
          if (enabled && sharing.publicLink?.role !== "VIEWER_FULL") {
            setPublicLinkRole("VIEWER_FULL");
          }
          if (!enabled && activeViewerMode === "public") {
            setActiveViewerMode("owner");
          }
        }}
        onPublicLinkRoleChange={(role) => {
          setPublicLinkRole(role);
        }}
        onRegeneratePublicLink={() => {
          regeneratePublicLinkToken();
        }}
        publicShareUrl={getPublicShareUrl()}
      />

      {/* Schedule Detail Modal */}
      <ScheduleDetailModal
        item={viewingSchedule || null}
        open={viewingScheduleId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewingScheduleId(null);
          }
        }}
        onEdit={handleDetailEdit}
        onDelete={handleDetailDelete}
        canEdit={viewingSchedule ? canEditSchedule(viewingSchedule.id) : true}
        canDelete={viewingSchedule ? canDeleteSchedule(viewingSchedule.id) : true}
      />

      <Dialog
        open={pendingDeleteScheduleId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteScheduleId(null);
            setPendingDeleteScope("single");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>予定を削除</DialogTitle>
          </DialogHeader>
          {pendingDeleteScheduleId && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {isPendingDeleteRecurring
                  ? "削除範囲を選択してください。繰り返し予定の場合のみ範囲が適用されます。"
                  : "この予定を削除します。よろしいですか？"}
              </p>
              {isPendingDeleteRecurring && (
                <div className="space-y-2">
                  {SCHEDULE_MUTATION_SCOPE_OPTIONS.map((scope) => (
                    <button
                      key={`delete-scope-${scope}`}
                      type="button"
                      onClick={() => setPendingDeleteScope(scope)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left text-sm",
                        pendingDeleteScope === scope
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-input text-muted-foreground",
                      )}
                    >
                      {SCHEDULE_MUTATION_SCOPE_LABELS[scope]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteScheduleId(null)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDeleteTagId !== null}
        onOpenChange={(open) => !open && setPendingDeleteTagId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>タグを削除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            「{pendingDeleteTag?.name ?? "このタグ"}」を削除します。関連予定からもタグが外れます。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteTagId(null)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteTag}>
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDeleteMemberId !== null}
        onOpenChange={(open) => !open && setPendingDeleteMemberId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>共有ユーザーを削除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            「{pendingDeleteMember?.displayName ?? pendingDeleteMember?.email ?? "このユーザー"}
            」との共有を解除します。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteMemberId(null)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleConfirmRemoveMember}>
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
