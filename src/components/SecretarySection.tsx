import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { ChatInput } from "@/components/chat/ChatInput";
import { VoiceInputButton } from "@/components/VoiceInputButton";
import { DialogueOverlay } from "@/components/DialogueOverlay";
import { ScheduleDetailModal } from "@/components/schedule/ScheduleDetailModal";
import { useSecretary } from "@/hooks/useSecretary";
import { useSchedule } from "@/hooks/useSchedule";
import { useSakuraSTT } from "@/hooks/useSakuraSTT";
import { useDialogueLoop } from "@/hooks/useDialogueLoop";
import { useWarningSettings } from "@/hooks/useWarningSettings";
import { speakText } from "@/services/speechService";
import { compressImageDataUrlForStorage, fileToDataUrl } from "@/services/photoAnalysisService";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { generateNextPromptSuggestions } from "@/lib/nextPromptSuggestions";
import {
  isGenerativeUiRequest,
  parseGenerativeUiInput,
  stripGenerativeUiTrigger,
} from "@/lib/generativeUi";
import {
  isTailwindThemeRequest,
  parseTailwindThemeInput,
  stripTailwindThemeTrigger,
} from "@/lib/tailwindTheme";
import {
  DEFAULT_SECRETARY_MODEL,
  getSecretaryModelOptionsForInput,
  normalizeSecretaryModelSelection,
  isSecretaryMultimodalModelId,
  isSecretaryModelId,
  SECRETARY_MODEL_STORAGE_KEY,
  type SecretaryModelId,
} from "@/lib/secretaryModels";
import {
  Trash2,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  MessageSquare,
  Sparkles,
  Plus,
  CheckCircle2,
  Trash,
  X,
  Calendar,
  MapPin,
  Clock,
  FileText,
  AlertTriangle,
  Pencil,
  Undo2,
  BellOff,
  Users,
  Link as LinkIcon,
  MessageCircle,
  Square,
  ChevronLeft,
  ChevronRight,
  PanelRightOpen,
} from "lucide-react";
import { isApiConfigured } from "@/services/sakuraAI";
import type {
  RepeatWeekday,
  ScheduleItem,
  ScheduleConflict,
  ScheduleMutationScope,
  SecretaryAction,
} from "@/types";

interface SecreatarySectionProps {
  className?: string;
}

const WEEKDAY_LABELS: Record<RepeatWeekday, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

const SCOPE_LABELS: Record<ScheduleMutationScope, string> = {
  single: "この予定のみ",
  future: "この予定以降",
  all: "繰り返し全件",
};

const EMPTY_VALUE_LABEL = "未設定";
const UNKNOWN_CURRENT_VALUE_LABEL = "（現在の値を取得できません）";

type UpdateScheduleAction = Extract<SecretaryAction, { type: "update_schedule" }>;
type AddScheduleAction = Extract<SecretaryAction, { type: "add_schedule" }>;

interface UpdateFieldDiff {
  key:
    | "title"
    | "dueDate"
    | "endDate"
    | "isAllDay"
    | "tags"
    | "location"
    | "items"
    | "participants"
    | "url"
    | "notes"
    | "recurrence";
  label: string;
  changed: boolean;
  before: string;
  after: string;
}

function formatRecurrenceLabel(
  recurrence:
    | { weekdays: RepeatWeekday[]; count?: number; isInfinite?: boolean }
    | null
    | undefined,
): string | null {
  if (!recurrence || recurrence.weekdays.length === 0) {
    return null;
  }
  const weekdays = recurrence.weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join("・");
  if (recurrence.isInfinite) {
    return `毎週${weekdays} / 永続`;
  }
  if (!recurrence.count || recurrence.count <= 1) {
    return null;
  }
  return `毎週${weekdays} / ${recurrence.count}回`;
}

function formatActionDate(dateInput: string | Date): string {
  try {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
      return typeof dateInput === "string" ? dateInput : EMPTY_VALUE_LABEL;
    }
    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return typeof dateInput === "string" ? dateInput : EMPTY_VALUE_LABEL;
  }
}

function toDateTimeLocalValue(value: string | Date | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseDateTimeLocalValue(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function parseCommaSeparatedTags(value: string): string[] | undefined {
  const parsed = value
    .split(/[,、\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

function formatThreadUpdatedAt(date: Date): string {
  return new Date(date).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function hasNonEmptyTextValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatOptionalTextValue(value: string | undefined | null): string {
  if (!value) return EMPTY_VALUE_LABEL;
  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : EMPTY_VALUE_LABEL;
}

function formatTagsValue(tags: string[] | undefined): string {
  return tags && tags.length > 0 ? tags.join(", ") : EMPTY_VALUE_LABEL;
}

function formatAllDayValue(isAllDay: boolean | undefined): string {
  if (isAllDay === undefined) {
    return EMPTY_VALUE_LABEL;
  }
  return isAllDay ? "終日" : "時間指定";
}

function formatOptionalDateValue(value: string | Date | undefined): string {
  if (!value) return EMPTY_VALUE_LABEL;
  return formatActionDate(value);
}

function formatRecurrenceValue(
  recurrence:
    | { weekdays: RepeatWeekday[]; count?: number; isInfinite?: boolean }
    | null
    | undefined,
): string {
  if (recurrence === null) {
    return "なし";
  }
  return formatRecurrenceLabel(recurrence) ?? EMPTY_VALUE_LABEL;
}

function buildUpdateFieldDiffs(
  action: UpdateScheduleAction,
  targetSchedule: ScheduleItem | null,
): UpdateFieldDiff[] {
  const { updates } = action.payload;
  const getCurrentValue = (formatter: (schedule: ScheduleItem) => string) =>
    targetSchedule ? formatter(targetSchedule) : UNKNOWN_CURRENT_VALUE_LABEL;

  const titleChanged = hasNonEmptyTextValue(updates.title);
  const dueDateChanged = hasNonEmptyTextValue(updates.dueDate);
  const endDateChanged = hasNonEmptyTextValue(updates.endDate);
  const isAllDayChanged = updates.isAllDay !== undefined;
  const tagsChanged = Array.isArray(updates.tags) && updates.tags.length > 0;
  const locationChanged = hasNonEmptyTextValue(updates.location);
  const itemsChanged = hasNonEmptyTextValue(updates.items);
  const participantsChanged = hasNonEmptyTextValue(updates.participants);
  const urlChanged = hasNonEmptyTextValue(updates.url);
  const notesChanged = hasNonEmptyTextValue(updates.notes);
  const recurrenceChanged =
    Object.prototype.hasOwnProperty.call(updates, "recurrence") && updates.recurrence !== undefined;

  const dueDateLabel = targetSchedule?.mode === "task" ? "期限" : "開始日時";

  return [
    {
      key: "title",
      label: "タイトル",
      changed: titleChanged,
      before: getCurrentValue((schedule) => formatOptionalTextValue(schedule.title)),
      after: titleChanged
        ? formatOptionalTextValue(updates.title)
        : getCurrentValue((schedule) => formatOptionalTextValue(schedule.title)),
    },
    {
      key: "dueDate",
      label: dueDateLabel,
      changed: dueDateChanged,
      before: getCurrentValue((schedule) => formatActionDate(schedule.dueDate)),
      after: dueDateChanged
        ? formatOptionalDateValue(updates.dueDate)
        : getCurrentValue((schedule) => formatActionDate(schedule.dueDate)),
    },
    {
      key: "endDate",
      label: "終了日時",
      changed: endDateChanged,
      before: getCurrentValue((schedule) => formatOptionalDateValue(schedule.endDate)),
      after: endDateChanged
        ? formatOptionalDateValue(updates.endDate)
        : getCurrentValue((schedule) => formatOptionalDateValue(schedule.endDate)),
    },
    {
      key: "isAllDay",
      label: "終日設定",
      changed: isAllDayChanged,
      before: getCurrentValue((schedule) => formatAllDayValue(schedule.isAllDay)),
      after: isAllDayChanged
        ? formatAllDayValue(updates.isAllDay)
        : getCurrentValue((schedule) => formatAllDayValue(schedule.isAllDay)),
    },
    {
      key: "tags",
      label: "タグ",
      changed: tagsChanged,
      before: getCurrentValue((schedule) => formatTagsValue(schedule.tags.map((tag) => tag.name))),
      after: tagsChanged
        ? formatTagsValue(updates.tags)
        : getCurrentValue((schedule) => formatTagsValue(schedule.tags.map((tag) => tag.name))),
    },
    {
      key: "location",
      label: "場所",
      changed: locationChanged,
      before: getCurrentValue((schedule) => formatOptionalTextValue(schedule.location)),
      after: locationChanged
        ? formatOptionalTextValue(updates.location)
        : getCurrentValue((schedule) => formatOptionalTextValue(schedule.location)),
    },
    {
      key: "items",
      label: "持ち物",
      changed: itemsChanged,
      before: getCurrentValue((schedule) => formatOptionalTextValue(schedule.items)),
      after: itemsChanged
        ? formatOptionalTextValue(updates.items)
        : getCurrentValue((schedule) => formatOptionalTextValue(schedule.items)),
    },
    {
      key: "participants",
      label: "参加者",
      changed: participantsChanged,
      before: getCurrentValue((schedule) => formatOptionalTextValue(schedule.participants)),
      after: participantsChanged
        ? formatOptionalTextValue(updates.participants)
        : getCurrentValue((schedule) => formatOptionalTextValue(schedule.participants)),
    },
    {
      key: "url",
      label: "URL",
      changed: urlChanged,
      before: getCurrentValue((schedule) => formatOptionalTextValue(schedule.url)),
      after: urlChanged
        ? formatOptionalTextValue(updates.url)
        : getCurrentValue((schedule) => formatOptionalTextValue(schedule.url)),
    },
    {
      key: "notes",
      label: "備考",
      changed: notesChanged,
      before: getCurrentValue((schedule) => formatOptionalTextValue(schedule.notes)),
      after: notesChanged
        ? formatOptionalTextValue(updates.notes)
        : getCurrentValue((schedule) => formatOptionalTextValue(schedule.notes)),
    },
    {
      key: "recurrence",
      label: "繰り返し",
      changed: recurrenceChanged,
      before: getCurrentValue((schedule) => formatRecurrenceValue(schedule.recurrence)),
      after: recurrenceChanged
        ? formatRecurrenceValue(updates.recurrence)
        : getCurrentValue((schedule) => formatRecurrenceValue(schedule.recurrence)),
    },
  ];
}

function ActionConfirmDialog({
  action,
  targetSchedule,
  open,
  conflicts,
  scope,
  showConflictWarnings,
  onToggleConflictWarnings,
  onActionChange,
  onScopeChange,
  onConfirm,
  onCancel,
}: {
  action: SecretaryAction | null;
  targetSchedule: ScheduleItem | null;
  open: boolean;
  conflicts: ScheduleConflict[];
  scope: ScheduleMutationScope;
  showConflictWarnings: boolean;
  onToggleConflictWarnings: (show: boolean) => void;
  onActionChange: (nextAction: SecretaryAction) => void;
  onScopeChange: (scope: ScheduleMutationScope) => void;
  onConfirm: (nextAction: SecretaryAction) => void;
  onCancel: () => void;
}) {
  if (!action) return null;

  const isAdd = action.type === "add_schedule";
  const isUpdate = action.type === "update_schedule";
  const isDelete = action.type === "delete_schedule";
  const hasConflicts = conflicts.length > 0 && (isAdd || isUpdate);
  const updateFieldDiffs =
    isUpdate && action.type === "update_schedule"
      ? buildUpdateFieldDiffs(action, targetSchedule)
      : [];
  const changedUpdateFieldDiffs = updateFieldDiffs.filter((field) => field.changed);
  const unchangedUpdateFieldDiffs = updateFieldDiffs.filter((field) => !field.changed);
  const updateScope =
    isUpdate && action.type === "update_schedule" ? (action.payload.scope ?? "single") : "single";
  const updateTargetMode = targetSchedule?.mode ?? "schedule";

  const updateAddPayload = (patch: Partial<AddScheduleAction["payload"]>) => {
    if (action.type !== "add_schedule") return;
    onActionChange({
      ...action,
      payload: {
        ...action.payload,
        ...patch,
      },
    });
  };

  const updateUpdatePayload = (patch: Partial<UpdateScheduleAction["payload"]["updates"]>) => {
    if (action.type !== "update_schedule") return;
    onActionChange({
      ...action,
      payload: {
        ...action.payload,
        updates: {
          ...action.payload.updates,
          ...patch,
        },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isAdd && (
              <>
                <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Plus className="h-4 w-4 text-emerald-600" />
                </div>
                <span>予定を追加</span>
              </>
            )}
            {isUpdate && (
              <>
                <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <Pencil className="h-4 w-4 text-amber-600" />
                </div>
                <span>予定を変更</span>
              </>
            )}
            {isDelete && (
              <>
                <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash className="h-4 w-4 text-red-600" />
                </div>
                <span>予定を削除</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isAdd && "以下の内容で予定を追加します。よろしいですか？"}
            {isUpdate && "以下の内容に変更します。よろしいですか？"}
            {isDelete && "以下の予定を削除します。この操作は取り消せません。"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {isAdd && action.type === "add_schedule" && (
            <div className="space-y-3 rounded-lg border border-emerald-200/70 bg-emerald-50/40 p-3">
              <p className="text-xs font-medium text-emerald-800">追加内容を編集</p>

              <div className="space-y-1.5">
                <Label htmlFor="action-add-title" className="text-xs text-muted-foreground">
                  タイトル
                </Label>
                <Input
                  id="action-add-title"
                  value={action.payload.title}
                  onChange={(e) => updateAddPayload({ title: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">種類</Label>
                <div className="flex gap-1 rounded-md border p-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateAddPayload({
                        mode: "task",
                        isAllDay: false,
                        endDate: undefined,
                      })
                    }
                    className={cn(
                      "flex-1 rounded px-2 py-1.5 text-xs font-medium",
                      action.payload.mode === "task"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    タスク
                  </button>
                  <button
                    type="button"
                    onClick={() => updateAddPayload({ mode: "schedule" })}
                    className={cn(
                      "flex-1 rounded px-2 py-1.5 text-xs font-medium",
                      action.payload.mode === "schedule"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    予定
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="action-add-due-date" className="text-xs text-muted-foreground">
                    {action.payload.mode === "task" ? "期限" : "開始日時"}
                  </Label>
                  <Input
                    id="action-add-due-date"
                    type="datetime-local"
                    value={toDateTimeLocalValue(action.payload.dueDate)}
                    onChange={(e) => {
                      const nextDueDate = parseDateTimeLocalValue(e.target.value);
                      if (!nextDueDate) return;
                      updateAddPayload({ dueDate: nextDueDate });
                    }}
                  />
                </div>

                {action.payload.mode === "schedule" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="action-add-end-date" className="text-xs text-muted-foreground">
                      終了日時（任意）
                    </Label>
                    <Input
                      id="action-add-end-date"
                      type="datetime-local"
                      value={toDateTimeLocalValue(action.payload.endDate)}
                      onChange={(e) => {
                        const nextEndDate = parseDateTimeLocalValue(e.target.value);
                        updateAddPayload({ endDate: nextEndDate });
                      }}
                    />
                  </div>
                )}
              </div>

              {action.payload.mode === "schedule" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="action-add-all-day"
                    checked={Boolean(action.payload.isAllDay)}
                    onCheckedChange={(checked) => updateAddPayload({ isAllDay: checked === true })}
                  />
                  <Label htmlFor="action-add-all-day" className="text-sm">
                    終日
                  </Label>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="action-add-tags" className="text-xs text-muted-foreground">
                    タグ（カンマ区切り）
                  </Label>
                  <Input
                    id="action-add-tags"
                    value={action.payload.tags?.join(", ") ?? ""}
                    onChange={(e) =>
                      updateAddPayload({ tags: parseCommaSeparatedTags(e.target.value) })
                    }
                    placeholder="例: 仕事, 会議"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="action-add-location" className="text-xs text-muted-foreground">
                    場所
                  </Label>
                  <Input
                    id="action-add-location"
                    value={action.payload.location ?? ""}
                    onChange={(e) => updateAddPayload({ location: e.target.value })}
                    placeholder="例: 会議室A"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="action-add-items" className="text-xs text-muted-foreground">
                    持ち物
                  </Label>
                  <Input
                    id="action-add-items"
                    value={action.payload.items ?? ""}
                    onChange={(e) => updateAddPayload({ items: e.target.value })}
                    placeholder="例: PC、資料"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="action-add-participants"
                    className="text-xs text-muted-foreground"
                  >
                    参加者
                  </Label>
                  <Input
                    id="action-add-participants"
                    value={action.payload.participants ?? ""}
                    onChange={(e) => updateAddPayload({ participants: e.target.value })}
                    placeholder="例: 田中、鈴木"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="action-add-url" className="text-xs text-muted-foreground">
                  URL
                </Label>
                <Input
                  id="action-add-url"
                  value={action.payload.url ?? ""}
                  onChange={(e) => updateAddPayload({ url: e.target.value })}
                  placeholder="https://example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="action-add-notes" className="text-xs text-muted-foreground">
                  備考
                </Label>
                <Textarea
                  id="action-add-notes"
                  value={action.payload.notes ?? ""}
                  onChange={(e) => updateAddPayload({ notes: e.target.value })}
                  rows={3}
                />
              </div>
            </div>
          )}

          {isUpdate && action.type === "update_schedule" && (
            <div className="space-y-3 rounded-lg border border-amber-200/70 bg-amber-50/40 p-3">
              <p className="text-xs font-medium text-amber-800">
                変更後の値を編集（空欄は変更しません）
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="action-update-title" className="text-xs text-muted-foreground">
                  タイトル（変更後）
                </Label>
                <Input
                  id="action-update-title"
                  value={action.payload.updates.title ?? ""}
                  onChange={(e) => updateUpdatePayload({ title: e.target.value })}
                  placeholder={targetSchedule?.title ?? "未変更"}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="action-update-due-date" className="text-xs text-muted-foreground">
                    {updateTargetMode === "task" ? "期限（変更後）" : "開始日時（変更後）"}
                  </Label>
                  <Input
                    id="action-update-due-date"
                    type="datetime-local"
                    value={toDateTimeLocalValue(action.payload.updates.dueDate)}
                    onChange={(e) =>
                      updateUpdatePayload({ dueDate: parseDateTimeLocalValue(e.target.value) })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    現在:{" "}
                    {targetSchedule ? formatActionDate(targetSchedule.dueDate) : "取得できません"}
                  </p>
                </div>

                {updateTargetMode === "schedule" && (
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="action-update-end-date"
                      className="text-xs text-muted-foreground"
                    >
                      終了日時（変更後）
                    </Label>
                    <Input
                      id="action-update-end-date"
                      type="datetime-local"
                      value={toDateTimeLocalValue(action.payload.updates.endDate)}
                      onChange={(e) =>
                        updateUpdatePayload({ endDate: parseDateTimeLocalValue(e.target.value) })
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      現在:{" "}
                      {targetSchedule?.endDate
                        ? formatActionDate(targetSchedule.endDate)
                        : EMPTY_VALUE_LABEL}
                    </p>
                  </div>
                )}
              </div>

              {updateTargetMode === "schedule" && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="action-update-all-day"
                    checked={Boolean(action.payload.updates.isAllDay ?? targetSchedule?.isAllDay)}
                    onCheckedChange={(checked) =>
                      updateUpdatePayload({ isAllDay: checked === true })
                    }
                  />
                  <Label htmlFor="action-update-all-day" className="text-sm">
                    終日として変更
                  </Label>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="action-update-tags" className="text-xs text-muted-foreground">
                    タグ（カンマ区切り）
                  </Label>
                  <Input
                    id="action-update-tags"
                    value={action.payload.updates.tags?.join(", ") ?? ""}
                    onChange={(e) =>
                      updateUpdatePayload({ tags: parseCommaSeparatedTags(e.target.value) })
                    }
                    placeholder={
                      targetSchedule
                        ? targetSchedule.tags.map((tag) => tag.name).join(", ")
                        : "未変更"
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="action-update-location" className="text-xs text-muted-foreground">
                    場所
                  </Label>
                  <Input
                    id="action-update-location"
                    value={action.payload.updates.location ?? ""}
                    onChange={(e) => updateUpdatePayload({ location: e.target.value })}
                    placeholder={targetSchedule?.location ?? EMPTY_VALUE_LABEL}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="action-update-items" className="text-xs text-muted-foreground">
                    持ち物
                  </Label>
                  <Input
                    id="action-update-items"
                    value={action.payload.updates.items ?? ""}
                    onChange={(e) => updateUpdatePayload({ items: e.target.value })}
                    placeholder={targetSchedule?.items ?? EMPTY_VALUE_LABEL}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="action-update-participants"
                    className="text-xs text-muted-foreground"
                  >
                    参加者
                  </Label>
                  <Input
                    id="action-update-participants"
                    value={action.payload.updates.participants ?? ""}
                    onChange={(e) => updateUpdatePayload({ participants: e.target.value })}
                    placeholder={targetSchedule?.participants ?? EMPTY_VALUE_LABEL}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="action-update-url" className="text-xs text-muted-foreground">
                  URL
                </Label>
                <Input
                  id="action-update-url"
                  value={action.payload.updates.url ?? ""}
                  onChange={(e) => updateUpdatePayload({ url: e.target.value })}
                  placeholder={targetSchedule?.url ?? EMPTY_VALUE_LABEL}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="action-update-notes" className="text-xs text-muted-foreground">
                  備考
                </Label>
                <Textarea
                  id="action-update-notes"
                  value={action.payload.updates.notes ?? ""}
                  onChange={(e) => updateUpdatePayload({ notes: e.target.value })}
                  rows={3}
                  placeholder={targetSchedule?.notes ?? EMPTY_VALUE_LABEL}
                />
              </div>
            </div>
          )}

          {/* Conflict Warning */}
          {hasConflicts && showConflictWarnings && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 text-amber-800 mb-2">
                <AlertTriangle className="h-4 w-4" />
                <span className="font-medium text-sm">
                  {conflicts.length}件のスケジュールと重複しています
                </span>
              </div>
              <div className="space-y-1">
                {conflicts.map((conflict, i) => (
                  <div key={i} className="text-xs text-amber-700 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span className="font-medium">{conflict.conflictingSchedule.title}</span>
                    <span>({conflict.conflictingSchedule.dueDate})</span>
                    {conflict.type === "exact" && <span className="text-amber-600">- 同時刻</span>}
                  </div>
                ))}
              </div>
              {/* Opt-out checkbox */}
              <div className="mt-3 pt-2 border-t border-amber-200">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="disable-conflict-warnings"
                    checked={false}
                    onCheckedChange={() => onToggleConflictWarnings(false)}
                    className="h-3.5 w-3.5"
                  />
                  <Label
                    htmlFor="disable-conflict-warnings"
                    className="text-xs text-amber-700 cursor-pointer"
                  >
                    今後、重複警告を表示しない
                  </Label>
                </div>
              </div>
            </div>
          )}

          {/* Show muted indicator when warnings are disabled but conflicts exist */}
          {hasConflicts && !showConflictWarnings && (
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
              <BellOff className="h-3.5 w-3.5" />
              <span>{conflicts.length}件の重複あり（警告は非表示）</span>
              <button
                onClick={() => onToggleConflictWarnings(true)}
                className="ml-auto text-xs text-blue-600 hover:underline"
              >
                表示する
              </button>
            </div>
          )}

          {isAdd && action.type === "add_schedule" && (
            <>
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">タイトル</p>
                  <p className="font-medium">{action.payload.title}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    {action.payload.mode === "task" ? "期限" : "日時"}
                  </p>
                  <p className="font-medium">{formatActionDate(action.payload.dueDate)}</p>
                  {action.payload.endDate && (
                    <p className="text-sm text-muted-foreground">
                      〜 {formatActionDate(action.payload.endDate)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">種類</p>
                  <p className="font-medium">
                    {action.payload.mode === "task" ? "タスク" : "予定"}
                  </p>
                </div>
              </div>

              {formatRecurrenceLabel(action.payload.recurrence) && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">繰り返し</p>
                    <p className="font-medium">
                      {formatRecurrenceLabel(action.payload.recurrence)}
                    </p>
                  </div>
                </div>
              )}

              {action.payload.tags && action.payload.tags.length > 0 && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">タグ</p>
                    <p className="font-medium">{action.payload.tags.join(", ")}</p>
                  </div>
                </div>
              )}

              {action.payload.location && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">場所</p>
                    <p className="font-medium">{action.payload.location}</p>
                  </div>
                </div>
              )}

              {action.payload.items && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">持ち物</p>
                    <p className="font-medium">{action.payload.items}</p>
                  </div>
                </div>
              )}

              {action.payload.participants && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">参加者</p>
                    <p className="font-medium">{action.payload.participants}</p>
                  </div>
                </div>
              )}

              {action.payload.url && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <LinkIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">URL</p>
                    <a
                      href={action.payload.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary hover:underline break-all"
                    >
                      {action.payload.url}
                    </a>
                  </div>
                </div>
              )}

              {action.payload.notes && (
                <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">備考</p>
                    <p className="font-medium">{action.payload.notes}</p>
                  </div>
                </div>
              )}
            </>
          )}

          {isUpdate && action.type === "update_schedule" && (
            <>
              <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">変更対象</p>
                  <p className="font-medium break-all">
                    {action.payload.title ?? targetSchedule?.title ?? "（対象を特定できません）"}
                  </p>
                  {action.payload.id && (
                    <p className="mt-1 text-xs text-muted-foreground">ID: {action.payload.id}</p>
                  )}
                  {!targetSchedule && (
                    <p className="mt-1 text-xs text-amber-700">
                      現在値を取得できないため、変更後を中心に表示しています。
                    </p>
                  )}
                </div>
              </div>

              <div className="p-3 bg-amber-50/50 border border-amber-100 rounded-lg space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-amber-800 flex items-center gap-1">
                    <Pencil className="h-3 w-3" />
                    変更内容
                  </p>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                    変更あり {changedUpdateFieldDiffs.length}件
                  </span>
                </div>

                <div className="space-y-2">
                  {updateFieldDiffs.map((field) => (
                    <div
                      key={field.key}
                      className={cn(
                        "rounded-md border px-3 py-2",
                        field.changed
                          ? "border-amber-200 bg-amber-50/70"
                          : "border-border/70 bg-muted/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-foreground">{field.label}</p>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                            field.changed
                              ? "bg-amber-200/70 text-amber-800"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {field.changed ? "変更あり" : "変更なし"}
                        </span>
                      </div>
                      {field.changed ? (
                        <div className="mt-2 space-y-1 text-sm">
                          <p className="flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                              変更前
                            </span>
                            <span className="text-muted-foreground break-all">{field.before}</span>
                          </p>
                          <p className="flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 text-xs font-medium text-amber-700">
                              変更後
                            </span>
                            <span className="font-medium break-all">{field.after}</span>
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-muted-foreground break-all">
                          {field.before}
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rounded-md border border-amber-200/80 bg-white/70 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">適用範囲</p>
                  <p className="text-sm font-medium">{SCOPE_LABELS[updateScope]}</p>
                </div>

                {changedUpdateFieldDiffs.length === 0 && (
                  <p className="text-xs text-amber-700">
                    変更項目を特定できませんでした。実行前に内容を再確認してください。
                  </p>
                )}
                {unchangedUpdateFieldDiffs.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    変更なし: {unchangedUpdateFieldDiffs.map((field) => field.label).join(" / ")}
                  </p>
                )}
              </div>
            </>
          )}

          {isDelete && action.type === "delete_schedule" && (
            <div className="space-y-3">
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2 text-red-800">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="font-medium">削除対象: {action.payload.title}</p>
                </div>
                <p className="text-xs text-red-600 mt-1">タイトルに一致する予定を削除します</p>
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">削除範囲</p>
                <div className="grid grid-cols-1 gap-2">
                  {(Object.keys(SCOPE_LABELS) as ScheduleMutationScope[]).map((scopeOption) => (
                    <button
                      key={`scope-${scopeOption}`}
                      type="button"
                      onClick={() => onScopeChange(scopeOption)}
                      className={cn(
                        "rounded-md border px-3 py-2 text-left text-sm",
                        scope === scopeOption
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-input text-muted-foreground",
                      )}
                    >
                      {SCOPE_LABELS[scopeOption]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
          <Button
            variant={isDelete ? "destructive" : "default"}
            onClick={() => onConfirm(action)}
            className={cn(
              isAdd && "bg-emerald-600 hover:bg-emerald-700",
              isUpdate && "bg-amber-600 hover:bg-amber-700",
            )}
          >
            {isAdd && "追加する"}
            {isUpdate && "変更する"}
            {isDelete && "削除する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBadge({
  action,
  onExecute,
  onDismiss,
}: {
  action: SecretaryAction;
  onExecute: () => void;
  onDismiss: () => void;
}) {
  const getActionInfo = () => {
    switch (action.type) {
      case "add_schedule":
        return {
          icon: <Plus className="h-3 w-3" />,
          label: `追加: ${action.payload.title}`,
          color: "bg-emerald-100 text-emerald-800 border-emerald-200",
        };
      case "update_schedule":
        return {
          icon: <Pencil className="h-3 w-3" />,
          label: `変更: ${action.payload.title}`,
          color: "bg-amber-100 text-amber-800 border-amber-200",
        };
      case "complete_schedule":
        return {
          icon: <CheckCircle2 className="h-3 w-3" />,
          label: `完了: ${action.payload.title}`,
          color: "bg-blue-100 text-blue-800 border-blue-200",
        };
      case "delete_schedule":
        return {
          icon: <Trash className="h-3 w-3" />,
          label: `削除: ${action.payload.title}`,
          color: "bg-red-100 text-red-800 border-red-200",
        };
    }
  };

  const info = getActionInfo();

  return (
    <button
      onClick={onExecute}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity",
        info.color,
      )}
      title="クリックして詳細を確認"
    >
      {info.icon}
      <span className="truncate max-w-[120px]">{info.label}</span>
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="p-0.5 rounded-full hover:bg-black/10 transition-colors"
        title="キャンセル"
      >
        <X className="h-3 w-3" />
      </span>
    </button>
  );
}

export function SecretarySection({ className }: SecreatarySectionProps) {
  const [selectedModel, setSelectedModel] = useLocalStorage<string>(
    SECRETARY_MODEL_STORAGE_KEY,
    DEFAULT_SECRETARY_MODEL,
  );
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useLocalStorage<boolean>(
    "grass-secretary-history-panel-open",
    true,
  );
  const [inputValue, setInputValue] = useState("");
  const [pendingImageName, setPendingImageName] = useState<string | null>(null);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(null);
  const [nextPromptSuggestions, setNextPromptSuggestions] = useState<string[]>([]);

  const { deleteSchedule } = useSchedule();
  const hasPendingImage = Boolean(pendingImageDataUrl);
  const resolvedSelectedModel = useMemo<SecretaryModelId>(
    () =>
      normalizeSecretaryModelSelection(selectedModel, {
        hasImageAttachment: hasPendingImage,
      }),
    [hasPendingImage, selectedModel],
  );
  const modelOptionsForCurrentInput = useMemo(
    () => getSecretaryModelOptionsForInput(hasPendingImage),
    [hasPendingImage],
  );

  const {
    threads,
    activeThreadId,
    messages,
    isLoading,
    error,
    pendingActions,
    lastExecutedAction,
    sendMessage,
    sendMessageAndGetReply,
    retryUserMessage,
    cancelCurrentResponse,
    deleteMessage,
    playVoice,
    isPlaying,
    executeAction,
    dismissAction,
    executeAllActions,
    undoLastAction,
    getScheduleById,
    getScheduleByTitle,
    checkConflicts,
    createThread,
    selectThread,
    renameThread,
    deleteThread,
    secretaryContext,
  } = useSecretary({
    selectedModel: resolvedSelectedModel,
    onSelectedModelChange: setSelectedModel,
  });
  const activeThreadTitle = useMemo(() => {
    if (threads.length === 0) return "チャット";
    const activeThread = activeThreadId
      ? threads.find((thread) => thread.id === activeThreadId)
      : null;
    return (activeThread ?? threads[0])?.title || "チャット";
  }, [threads, activeThreadId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isChatNearBottom, setIsChatNearBottom] = useState(true);
  const [canScrollChat, setCanScrollChat] = useState(false);
  const stt = useSakuraSTT({
    onTranscript: async (recognizedText) => {
      const reply = await sendMessageAndGetReply(recognizedText);
      if (reply) {
        setInputValue("");
        await speakText(reply);
      }
    },
  });
  const dialogue = useDialogueLoop({
    createThread,
    selectThread,
    sendMessageAndGetReply,
  });

  // Global warning settings (shared across app)
  const { settings: warningSettings, setConflictWarnings } = useWarningSettings();

  // Confirmation dialog state
  const [confirmingAction, setConfirmingAction] = useState<{
    action: SecretaryAction;
    index: number;
  } | null>(null);
  const [confirmScope, setConfirmScope] = useState<ScheduleMutationScope>("single");
  const [detailDeleteScope, setDetailDeleteScope] = useState<ScheduleMutationScope>("single");
  const [isDetailDeleteDialogOpen, setIsDetailDeleteDialogOpen] = useState(false);
  const [viewingScheduleId, setViewingScheduleId] = useState<string | null>(null);
  const [isMobileThreadSheetOpen, setIsMobileThreadSheetOpen] = useState(false);
  const [pendingDeleteThread, setPendingDeleteThread] = useState<{
    id: string;
    title: string;
  } | null>(null);

  // Toggle conflict warnings setting
  const handleToggleConflictWarnings = (show: boolean) => {
    setConflictWarnings(show);
  };

  const confirmingTargetSchedule = useMemo<ScheduleItem | null>(() => {
    if (!confirmingAction || confirmingAction.action.type !== "update_schedule") {
      return null;
    }
    const { id, title } = confirmingAction.action.payload;
    if (id) {
      return getScheduleById(id);
    }
    if (title) {
      return getScheduleByTitle(title);
    }
    return null;
  }, [confirmingAction, getScheduleById, getScheduleByTitle]);

  // Calculate conflicts for the confirming action
  const actionConflicts = useMemo(() => {
    if (!confirmingAction) return [];
    const action = confirmingAction.action;
    if (action.type === "add_schedule") {
      return checkConflicts(
        action.payload.dueDate,
        action.payload.endDate,
        action.payload.mode,
        action.payload.isAllDay,
      );
    }
    if (action.type === "update_schedule") {
      const fallbackDueDate = confirmingTargetSchedule
        ? new Date(confirmingTargetSchedule.dueDate).toISOString()
        : undefined;
      const fallbackEndDate = confirmingTargetSchedule?.endDate
        ? new Date(confirmingTargetSchedule.endDate).toISOString()
        : undefined;
      const hasExplicitEndDate = Object.prototype.hasOwnProperty.call(
        action.payload.updates,
        "endDate",
      );
      const effectiveDueDate = action.payload.updates.dueDate ?? fallbackDueDate;
      const effectiveEndDate = hasExplicitEndDate
        ? action.payload.updates.endDate
        : fallbackEndDate;
      if (!effectiveDueDate) {
        return [];
      }
      return checkConflicts(
        effectiveDueDate,
        effectiveEndDate,
        confirmingTargetSchedule?.mode,
        action.payload.updates.isAllDay ?? confirmingTargetSchedule?.isAllDay,
        action.payload.id,
        action.payload.title,
      );
    }
    return [];
  }, [confirmingAction, confirmingTargetSchedule, checkConflicts]);

  const updateChatScrollState = useCallback(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
    setCanScrollChat(maxScrollTop > 8);
    setIsChatNearBottom(maxScrollTop - scrollEl.scrollTop <= 8);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    updateChatScrollState();
  }, [messages, activeThreadId, updateChatScrollState]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    updateChatScrollState();
    scrollEl.addEventListener("scroll", updateChatScrollState);
    return () => {
      scrollEl.removeEventListener("scroll", updateChatScrollState);
    };
  }, [updateChatScrollState]);

  useEffect(() => {
    setConfirmingAction(null);
    setConfirmScope("single");
    setIsDetailDeleteDialogOpen(false);
    setDetailDeleteScope("single");
    setIsMobileThreadSheetOpen(false);
    setPendingDeleteThread(null);
  }, [activeThreadId]);

  useEffect(() => {
    const normalized = normalizeSecretaryModelSelection(selectedModel, {
      hasImageAttachment: hasPendingImage,
    });
    if (normalized !== selectedModel) {
      setSelectedModel(normalized);
    }
  }, [hasPendingImage, selectedModel, setSelectedModel]);

  useEffect(() => {
    const latestAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!latestAssistantMessage) {
      setNextPromptSuggestions([]);
      return;
    }
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    let cancelled = false;

    void generateNextPromptSuggestions({
      latestAssistantMessage,
      latestUserMessage,
      schedules: secretaryContext.schedules,
      effortSummary: secretaryContext.effortSummary,
      priorityHints: secretaryContext.priorityHints,
      model: resolvedSelectedModel,
    }).then((suggestions) => {
      if (cancelled) return;
      setNextPromptSuggestions(suggestions);
    });

    return () => {
      cancelled = true;
    };
  }, [
    messages,
    resolvedSelectedModel,
    secretaryContext.schedules,
    secretaryContext.effortSummary,
    secretaryContext.priorityHints,
  ]);

  const apiConfigured = isApiConfigured();

  // Handle action click - show confirmation for add/update/delete, execute directly for complete
  const handleActionClick = (action: SecretaryAction, index: number) => {
    if (action.type === "complete_schedule") {
      // Complete actions execute immediately (low risk)
      executeAction(action);
      dismissAction(index);
    } else {
      // Add, Update and Delete actions require confirmation
      setConfirmScope(
        action.type === "delete_schedule" ? (action.payload.scope ?? "single") : "single",
      );
      setConfirmingAction({ action, index });
    }
  };

  const handleActionDraftChange = (nextAction: SecretaryAction) => {
    setConfirmingAction((current) => (current ? { ...current, action: nextAction } : current));
  };

  const handleConfirmAction = (draftAction: SecretaryAction) => {
    if (confirmingAction) {
      const nextAction =
        draftAction.type === "delete_schedule"
          ? {
              ...draftAction,
              payload: {
                ...draftAction.payload,
                scope: confirmScope,
              },
            }
          : draftAction;
      executeAction(nextAction);
      dismissAction(confirmingAction.index);
      setConfirmingAction(null);
      setConfirmScope("single");
    }
  };

  const handleCancelConfirm = () => {
    setConfirmingAction(null);
    setConfirmScope("single");
  };

  const handleCreateThread = () => {
    createThread();
  };

  const handleCreateThreadFromMobile = () => {
    createThread();
    setIsMobileThreadSheetOpen(false);
  };

  const handleSelectThreadFromMobile = (threadId: string) => {
    selectThread(threadId);
    setIsMobileThreadSheetOpen(false);
  };

  const handleRenameThread = (threadId: string, currentTitle: string) => {
    const nextTitle = window.prompt("チャット名を入力してください", currentTitle);
    if (nextTitle === null) return;
    renameThread(threadId, nextTitle);
  };

  const handleRenameThreadFromMobile = (threadId: string, currentTitle: string) => {
    handleRenameThread(threadId, currentTitle);
  };

  const handleDeleteThread = (threadId: string, title: string) => {
    setPendingDeleteThread({ id: threadId, title });
  };

  const handleDeleteThreadFromMobile = (threadId: string, title: string) => {
    setIsMobileThreadSheetOpen(false);
    handleDeleteThread(threadId, title);
  };

  const handleConfirmDeleteThread = () => {
    if (!pendingDeleteThread) {
      return;
    }
    deleteThread(pendingDeleteThread.id);
    setPendingDeleteThread(null);
  };

  const handleStartVoiceInput = async () => {
    if (dialogue.isActive) return;
    stt.reset();
    await stt.start();
  };

  const handleStopVoiceInput = async () => {
    await stt.stop();
  };

  const handleToggleDialogueMode = async () => {
    if (dialogue.isActive) {
      await dialogue.stopDialogue("manual");
      return;
    }

    if (stt.isRecording || stt.isTranscribing) {
      await stt.cancel();
    }
    stt.reset();
    await dialogue.startDialogue();
  };

  const handleScheduleNameClick = (title: string) => {
    const schedule = getScheduleByTitle(title);
    if (!schedule) return;
    setViewingScheduleId(schedule.id);
  };

  const handleSendMessage = useCallback(
    async (content: string) => {
      const rawMessageText = content.trim() || "この画像を説明してください。";
      const isTailwindThemeMode = !hasPendingImage && isTailwindThemeRequest(rawMessageText);
      const isGenerativeMode =
        !isTailwindThemeMode && !hasPendingImage && isGenerativeUiRequest(rawMessageText);
      const parsedStructuredInput = isTailwindThemeMode
        ? parseTailwindThemeInput(rawMessageText)
        : isGenerativeMode
          ? parseGenerativeUiInput(rawMessageText)
          : { userPreferences: "", currentNeed: "" };
      const messageText = isTailwindThemeMode
        ? stripTailwindThemeTrigger(rawMessageText)
        : isGenerativeMode
          ? stripGenerativeUiTrigger(rawMessageText)
          : rawMessageText;
      await sendMessage(messageText, {
        requestMode: isTailwindThemeMode
          ? "tailwind_theme"
          : isGenerativeMode
            ? "generative_ui"
            : "default",
        userPreferences: parsedStructuredInput.userPreferences,
        currentNeed: parsedStructuredInput.currentNeed,
        imageAttachmentDataUrl: pendingImageDataUrl ?? undefined,
        imageAttachmentName: pendingImageName ?? undefined,
      });
      setInputValue("");
      setPendingImageName(null);
      setPendingImageDataUrl(null);
    },
    [pendingImageDataUrl, pendingImageName, sendMessage],
  );

  const handleRemovePendingImage = () => {
    setPendingImageName(null);
    setPendingImageDataUrl(null);
  };

  const handleRetryMessage = useCallback(
    async (messageId: string) => {
      if (isLoading || stt.isTranscribing || !apiConfigured) {
        return;
      }
      await retryUserMessage(messageId);
    },
    [apiConfigured, isLoading, retryUserMessage, stt.isTranscribing],
  );

  const handleAttachImage = async (file: File) => {
    if (isLoading || stt.isTranscribing) {
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    const compressedDataUrl = await compressImageDataUrlForStorage(dataUrl, {
      maxEdge: 720,
      quality: 0.64,
      targetMaxLength: 160_000,
    });
    setPendingImageName(file.name);
    setPendingImageDataUrl(compressedDataUrl);
  };

  const viewingSchedule = viewingScheduleId ? getScheduleById(viewingScheduleId) : null;

  const handleDetailEdit = () => {
    if (!viewingSchedule) return;
    const dueLabel = new Date(viewingSchedule.dueDate).toLocaleString("ja-JP");
    const nextTitle = window.prompt(
      `「${viewingSchedule.title}」のタイトルを入力してください（キャンセルで中止）`,
      viewingSchedule.title,
    );
    if (nextTitle === null) {
      return;
    }

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === viewingSchedule.title) {
      return;
    }

    void sendMessage(
      `「${viewingSchedule.title}」を「${trimmedTitle}」に変更して。現在の日時は${dueLabel}。`,
    );
    setViewingScheduleId(null);
  };

  const handleDetailDelete = () => {
    if (!viewingSchedule) return;
    setDetailDeleteScope("single");
    setIsDetailDeleteDialogOpen(true);
  };

  const handleConfirmDetailDelete = () => {
    if (!viewingSchedule) return;
    deleteSchedule(viewingSchedule.id, detailDeleteScope);
    setIsDetailDeleteDialogOpen(false);
    setViewingScheduleId(null);
    setDetailDeleteScope("single");
  };

  const handleChatScrollJump = () => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    if (isChatNearBottom) {
      scrollEl.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
  };

  return (
    <Card className={cn("relative flex flex-col h-full overflow-hidden", className)}>
      {/* Confirmation Dialog */}
      <ActionConfirmDialog
        action={confirmingAction?.action || null}
        targetSchedule={confirmingTargetSchedule}
        open={confirmingAction !== null}
        conflicts={actionConflicts}
        scope={confirmScope}
        showConflictWarnings={warningSettings.conflictWarnings}
        onToggleConflictWarnings={handleToggleConflictWarnings}
        onActionChange={handleActionDraftChange}
        onScopeChange={setConfirmScope}
        onConfirm={handleConfirmAction}
        onCancel={handleCancelConfirm}
      />
      <ScheduleDetailModal
        item={viewingSchedule}
        open={viewingScheduleId !== null}
        onOpenChange={(open) => {
          if (!open) setViewingScheduleId(null);
        }}
        onEdit={handleDetailEdit}
        onDelete={handleDetailDelete}
      />
      <Dialog
        open={isDetailDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDetailDeleteDialogOpen(open);
          if (!open) {
            setDetailDeleteScope("single");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>予定を削除</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              繰り返し予定の場合は削除範囲を選択できます。
            </p>
            <div className="space-y-2">
              {(Object.keys(SCOPE_LABELS) as ScheduleMutationScope[]).map((scopeOption) => (
                <button
                  key={`detail-delete-scope-${scopeOption}`}
                  type="button"
                  onClick={() => setDetailDeleteScope(scopeOption)}
                  className={cn(
                    "w-full rounded-md border px-3 py-2 text-left text-sm",
                    detailDeleteScope === scopeOption
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-input text-muted-foreground",
                  )}
                >
                  {SCOPE_LABELS[scopeOption]}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDetailDeleteDialogOpen(false)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleConfirmDetailDelete}>
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={pendingDeleteThread !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteThread(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>チャットを削除</DialogTitle>
            <DialogDescription>
              「{pendingDeleteThread?.title ?? "このチャット"}
              」を削除します。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDeleteThread(null)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={handleConfirmDeleteThread}>
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={isMobileThreadSheetOpen} onOpenChange={setIsMobileThreadSheetOpen}>
        <SheetContent side="right" className="w-[90%] max-w-sm p-0 sm:hidden">
          <SheetHeader className="border-b border-border/50 px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2 pr-8">
              <div>
                <SheetTitle className="text-base">チャット一覧</SheetTitle>
                <SheetDescription className="text-xs">
                  チャットの切り替え・名前変更・削除
                </SheetDescription>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handleCreateThreadFromMobile}
                aria-label="新しいチャットを作成"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-84px)]">
            <div className="space-y-1 p-3">
              {threads.map((thread) => {
                const active = thread.id === activeThreadId;
                return (
                  <div
                    key={`mobile-thread-${thread.id}`}
                    className={cn(
                      "rounded-lg border transition-colors",
                      active
                        ? "bg-pink-50 border-pink-200"
                        : "bg-background border-transparent hover:border-border/60",
                    )}
                  >
                    <div className="flex items-center">
                      <button
                        type="button"
                        onClick={() => handleSelectThreadFromMobile(thread.id)}
                        className="min-w-0 flex-1 px-3 py-2.5 text-left"
                      >
                        <p className="truncate text-sm font-medium">{thread.title}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatThreadUpdatedAt(thread.updatedAt)}
                        </p>
                      </button>

                      <div className="flex items-center pr-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleRenameThreadFromMobile(thread.id, thread.title)}
                          title="名前変更"
                          aria-label={`チャット「${thread.title}」を名前変更`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteThreadFromMobile(thread.id, thread.title)}
                          title="削除"
                          aria-label={`チャット「${thread.title}」を削除`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <CardHeader
        data-testid="chat_panel_header"
        className="flex-shrink-0 flex flex-row items-center justify-between gap-3 space-y-0 pb-4 border-b bg-gradient-to-r from-pink-50/80 via-emerald-50/50 to-transparent"
      >
        <CardTitle className="min-w-0 flex flex-1 items-center gap-2">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-500 text-white shadow-md ring-2 ring-pink-200">
              <span className="text-lg">🌸</span>
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center ring-2 ring-white">
              <Sparkles className="h-2.5 w-2.5 text-white" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="bg-gradient-to-r from-pink-600 to-rose-500 bg-clip-text text-xl font-bold text-transparent">
                さくら
              </span>
              <span className="rounded-full bg-pink-100 px-1.5 py-0.5 text-xs font-normal text-pink-700">
                AI秘書
              </span>
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">現在のチャット</p>
            <p className="truncate text-sm font-semibold text-foreground" title={activeThreadTitle}>
              {activeThreadTitle}
            </p>
          </div>
        </CardTitle>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs sm:hidden"
            onClick={() => setIsMobileThreadSheetOpen(true)}
            aria-label="チャット一覧を表示"
          >
            <PanelRightOpen className="h-4 w-4" />
            <span className="ml-1">一覧</span>
          </Button>
          {lastExecutedAction && (
            <Button
              variant="ghost"
              size="sm"
              onClick={undoLastAction}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-amber-600 hover:bg-amber-50"
              title="最後のアクションを取り消し"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">元に戻す</span>
            </Button>
          )}
        </div>
      </CardHeader>

      <DialogueOverlay
        open={dialogue.isActive}
        phase={dialogue.phase}
        statusLabel={dialogue.statusLabel}
        sessionTitle={dialogue.sessionTitle}
        turns={dialogue.turns}
        recordingTimeLabel={dialogue.stt.recordingTimeLabel}
        audioLevel={dialogue.stt.audioLevel}
        onStop={() => dialogue.stopDialogue("manual")}
      />

      <CardContent className="flex-1 flex flex-col p-0 overflow-hidden">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {isHistoryPanelOpen && (
            <aside className="relative hidden w-64 shrink-0 flex-col overflow-y-hidden overflow-x-visible border-r border-border/50 bg-muted/20 sm:flex">
              <button
                type="button"
                onClick={() => setIsHistoryPanelOpen(false)}
                className={cn(
                  "absolute right-0 top-1/2 z-20 hidden -translate-y-1/2 translate-x-1/2 sm:flex",
                  "h-12 w-8 items-center justify-center rounded-r-lg",
                  "border border-border/60 bg-card text-muted-foreground",
                  "hover:bg-accent hover:text-foreground transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-label="チャット履歴を隠す"
                aria-expanded={isHistoryPanelOpen}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              <div className="flex items-center justify-between border-b border-border/50 px-3 py-3">
                <p className="text-xs font-semibold text-muted-foreground">チャット一覧</p>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={handleCreateThread}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-1 p-2">
                  {threads.map((thread) => {
                    const active = thread.id === activeThreadId;
                    return (
                      <div
                        key={thread.id}
                        className={cn(
                          "group rounded-lg border transition-colors",
                          active
                            ? "bg-pink-50 border-pink-200"
                            : "bg-background/80 border-transparent hover:border-border/60",
                        )}
                      >
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => selectThread(thread.id)}
                            className="min-w-0 flex-1 p-2 text-left"
                          >
                            <p className="truncate text-sm font-medium">{thread.title}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatThreadUpdatedAt(thread.updatedAt)}
                            </p>
                          </button>
                          <div className="flex items-center pr-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              onClick={() => handleRenameThread(thread.id, thread.title)}
                              title="名前変更"
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              onClick={() => handleDeleteThread(thread.id, thread.title)}
                              title="削除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </aside>
          )}

          {!isHistoryPanelOpen && (
            <button
              type="button"
              onClick={() => setIsHistoryPanelOpen(true)}
              className={cn(
                "absolute left-0 top-1/2 z-20 hidden -translate-y-1/2 sm:flex",
                "h-12 w-8 items-center justify-center rounded-r-lg",
                "border border-border/60 bg-card text-muted-foreground",
                "hover:bg-accent hover:text-foreground transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
              aria-label="チャット履歴を表示"
              aria-expanded={false}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col overflow-hidden",
              !isHistoryPanelOpen && "sm:pl-10",
            )}
          >
            <div className="sm:hidden border-b border-border/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted-foreground">チャット操作</p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setIsMobileThreadSheetOpen(true)}
                  >
                    <PanelRightOpen className="h-3.5 w-3.5" />
                    一覧を開く
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleCreateThread}
                    aria-label="新しいチャットを作成"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {!apiConfigured && (
              <div className="mx-4 my-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-amber-800">APIキーが未設定です</p>
                  <p className="text-amber-700 text-xs mt-0.5">
                    .envファイルにVITE_SAKURA_AI_API_KEYを設定してください
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="mx-4 my-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-destructive">エラーが発生しました</p>
                  <p className="text-destructive/80 text-xs mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {stt.error && (
              <div className="mx-4 my-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-amber-800">音声入力エラー</p>
                  <p className="text-amber-700 text-xs mt-0.5">{stt.error}</p>
                </div>
              </div>
            )}

            {dialogue.error && (
              <div className="mx-4 my-2 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-amber-800">対話モードエラー</p>
                  <p className="text-amber-700 text-xs mt-0.5">{dialogue.error}</p>
                </div>
              </div>
            )}

            {pendingActions.length > 0 && (
              <div className="mx-4 my-2 p-3 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-emerald-800 flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    AIからの提案アクション ({pendingActions.length}件)
                  </span>
                  {pendingActions.every((a) => a.type === "complete_schedule") && (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={executeAllActions}
                      className="h-6 text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      すべて実行
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  クリックして詳細を確認・実行できます
                </p>
                <div className="flex flex-wrap gap-2">
                  {pendingActions.map((action, index) => (
                    <ActionBadge
                      key={`${action.type}-${index}`}
                      action={action}
                      onExecute={() => handleActionClick(action, index)}
                      onDismiss={() => dismissAction(index)}
                    />
                  ))}
                </div>
              </div>
            )}

            <ScrollArea ref={scrollRef} className="flex-1">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12 px-4">
                  <div className="relative">
                    <div className="h-24 w-24 rounded-full bg-gradient-to-br from-pink-100 via-rose-100 to-emerald-100 flex items-center justify-center mb-4 shadow-lg">
                      <span className="text-5xl">🌸</span>
                    </div>
                    <div className="absolute -right-1 -bottom-1 h-8 w-8 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-md">
                      <MessageSquare className="h-4 w-4 text-white" />
                    </div>
                  </div>
                  <p className="text-xl font-bold bg-gradient-to-r from-pink-600 to-rose-500 bg-clip-text text-transparent mt-2">
                    こんにちは！さくらです 🌸
                  </p>
                  <p className="text-sm text-muted-foreground mt-2 text-center max-w-sm">
                    予定の追加や完了、タスク管理など、会話を通じてお手伝いします。
                    <span className="block mt-1 text-xs text-emerald-600">
                      ✨ あなたの予定を把握した上でアドバイスします
                    </span>
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-md">
                    {[
                      "今日の予定を教えて",
                      "明日14時に会議を追加して",
                      "期限が近いタスクは？",
                      "買い物タスクを完了にして",
                      "/gen-ui ユーザーの趣向: ミニマリズム、情報量少なめ\n現在の課題/要望: 今日の予定を一目で確認したい",
                      "/gen-theme ユーザーの趣向: 最近目が疲れているので、目に優しいけど仕事に集中できるプロフェッショナルな雰囲気にしたい\n現在の課題/要望: tailwind.config.js の extend 用JSONを生成して",
                    ].map((suggestion) => (
                      <Button
                        key={`starter-prompt-${suggestion}`}
                        variant="outline"
                        size="sm"
                        onClick={() => sendMessage(suggestion)}
                        disabled={isLoading || !apiConfigured}
                        className="text-xs border-pink-200 hover:bg-pink-50 hover:text-pink-700 hover:border-pink-300 transition-colors"
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {messages.map((message) => (
                    <ChatMessage
                      key={message.id}
                      message={message}
                      onPlayVoice={
                        message.role === "assistant" ? () => playVoice(message.id) : undefined
                      }
                      isPlaying={isPlaying === message.id}
                      onScheduleClick={handleScheduleNameClick}
                      onRetryMessage={handleRetryMessage}
                      retryDisabled={isLoading || !apiConfigured || stt.isTranscribing}
                      onDeleteMessage={deleteMessage}
                      deleteDisabled={isLoading || stt.isTranscribing}
                    />
                  ))}
                  {isLoading && (
                    <div className="flex gap-3 p-4 bg-gradient-to-r from-pink-50/50 to-transparent">
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center text-sm ring-2 ring-pink-200">
                        🌸
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-pink-600">さくらが考え中...</span>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
                          <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
                          <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {messages.length > 0 && canScrollChat && (
              <button
                type="button"
                onClick={handleChatScrollJump}
                className={cn(
                  "absolute right-4 z-30 h-10 w-10 rounded-full",
                  "bottom-20 sm:bottom-24",
                  "border border-border/60 bg-card/95 text-foreground shadow-lg backdrop-blur-sm",
                  "hover:bg-accent transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-label={isChatNearBottom ? "チャット履歴の一番上へ" : "チャット履歴の一番下へ"}
                title={isChatNearBottom ? "一番上へ" : "一番下へ"}
              >
                {isChatNearBottom ? (
                  <ArrowUp className="mx-auto h-4 w-4" aria-hidden="true" />
                ) : (
                  <ArrowDown className="mx-auto h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}

            {nextPromptSuggestions.length > 0 && (
              <div className="mx-4 mt-2 mb-1 p-3 rounded-lg border border-slate-200 bg-slate-50/70">
                <p className="text-[11px] font-semibold text-slate-600 mb-2">次の質問候補</p>
                <div className="flex flex-wrap gap-2">
                  {nextPromptSuggestions.map((suggestion) => (
                    <Button
                      key={`next-prompt-${suggestion}`}
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => setInputValue(suggestion)}
                      className="h-7 text-xs border-slate-200 bg-white hover:bg-slate-100"
                    >
                      {suggestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <ChatInput
              onSend={handleSendMessage}
              onImageAttach={handleAttachImage}
              attachedImageName={pendingImageName}
              onRemoveImageAttachment={handleRemovePendingImage}
              isLoading={isLoading || stt.isTranscribing}
              inputValue={inputValue}
              onInputChange={setInputValue}
              modelOptions={modelOptionsForCurrentInput}
              selectedModel={resolvedSelectedModel}
              onModelChange={(modelId) => {
                if (!isSecretaryModelId(modelId)) return;
                if (hasPendingImage && !isSecretaryMultimodalModelId(modelId)) return;
                setSelectedModel(modelId);
              }}
              canSendWithoutText={hasPendingImage}
              actions={
                <>
                  <VoiceInputButton
                    stt={stt}
                    disabled={isLoading || !apiConfigured || dialogue.isActive}
                    onStart={handleStartVoiceInput}
                    onStop={handleStopVoiceInput}
                    className="h-9 w-9"
                  />
                  <Button
                    type="button"
                    variant={dialogue.isActive ? "destructive" : "outline"}
                    size="icon"
                    onClick={() => {
                      void handleToggleDialogueMode();
                    }}
                    disabled={
                      !dialogue.isActive &&
                      (isLoading ||
                        !apiConfigured ||
                        !dialogue.stt.isSupported ||
                        stt.isRecording ||
                        stt.isTranscribing)
                    }
                    className="h-9 w-9 shrink-0"
                    title={dialogue.isActive ? "対話モードを終了" : "対話モードを開始"}
                    aria-label={dialogue.isActive ? "対話モードを終了" : "対話モードを開始"}
                  >
                    {dialogue.isActive ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <MessageCircle className="h-4 w-4" />
                    )}
                  </Button>
                  {isLoading && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      onClick={cancelCurrentResponse}
                      title="生成を停止"
                      aria-label="生成を停止"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  )}
                </>
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
