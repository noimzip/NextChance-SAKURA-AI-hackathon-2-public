import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-react";
import type { RepeatWeekday, ScheduleItem as ScheduleItemType } from "@/types";
import {
  DEFAULT_ALL_DAY_REMINDER_TIME,
  formatReminderSummary,
  normalizeAllDayReminderTime,
} from "@/lib/scheduleReminders";

interface ScheduleDetailModalProps {
  item: ScheduleItemType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit?: boolean;
  canDelete?: boolean;
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

function formatRecurrence(item: ScheduleItemType): string | null {
  const recurrence = item.recurrence;
  if (!recurrence || recurrence.weekdays.length === 0) {
    return null;
  }

  const weekdays = recurrence.weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join("・");
  if (recurrence.isInfinite) {
    const occurrenceText =
      typeof recurrence.occurrenceIndex === "number"
        ? `（${recurrence.occurrenceIndex + 1}回目）`
        : "";
    return `毎週${weekdays} / 永続 ${occurrenceText}`.trim();
  }
  if (!recurrence.count || recurrence.count <= 1) {
    return null;
  }
  const occurrenceText =
    typeof recurrence.occurrenceIndex === "number"
      ? `（${recurrence.occurrenceIndex + 1}/${recurrence.count}）`
      : "";
  return `毎週${weekdays} / ${recurrence.count}回 ${occurrenceText}`.trim();
}

export function ScheduleDetailModal({
  item,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: ScheduleDetailModalProps) {
  if (!item) return null;

  const formatDateDisplay = (date: Date | string, includeTime = true) => {
    const dateObj = date instanceof Date ? date : new Date(date);
    const dateStr = dateObj.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    if (includeTime) {
      const hours = dateObj.getHours();
      const minutes = dateObj.getMinutes();
      const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
      return `${dateStr} ${timeStr}`;
    }

    return dateStr;
  };

  const includeTime = !(item.mode === "schedule" && item.isAllDay);
  const recurrence = formatRecurrence(item);
  const reminderSummary = formatReminderSummary(item.reminderOffsetsMinutes);
  const allDayReminderTime = normalizeAllDayReminderTime(
    item.allDayReminderTime ?? DEFAULT_ALL_DAY_REMINDER_TIME,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1">{item.title}</DialogTitle>
            <Badge variant="outline" className="text-xs">
              {item.mode === "task" ? "タスク" : "予定"}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {/* Due Date and Time */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">
              {item.mode === "task" ? "期限" : "開始"}
            </h4>
            <p className="text-sm">
              {formatDateDisplay(item.dueDate, includeTime)}
              {!includeTime && " 終日"}
            </p>
          </div>

          {/* End Date (for schedules) */}
          {item.endDate && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">終了</h4>
              <p className="text-sm">
                {formatDateDisplay(item.endDate, includeTime)}
                {!includeTime && " 終日"}
              </p>
            </div>
          )}

          {recurrence && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">繰り返し</h4>
              <p className="text-sm">{recurrence}</p>
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-1">リマインド</h4>
            <p className="text-sm">{reminderSummary}</p>
            {item.mode === "schedule" && item.isAllDay && (
              <p className="text-xs text-muted-foreground mt-1">
                終日予定の基準時刻: {allDayReminderTime}
              </p>
            )}
          </div>

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">タグ</h4>
              <div className="flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <Badge
                    key={tag.id}
                    style={{ backgroundColor: tag.color, color: "white" }}
                    className="text-xs"
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Location */}
          {item.location && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">場所</h4>
              <p className="text-sm">{item.location}</p>
            </div>
          )}

          {/* Items to bring */}
          {item.items && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">持ち物</h4>
              <p className="text-sm">{item.items}</p>
            </div>
          )}

          {/* Participants */}
          {item.participants && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">参加者</h4>
              <p className="text-sm">{item.participants}</p>
            </div>
          )}

          {/* URL */}
          {item.url && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">URL</h4>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-500 hover:underline break-all"
              >
                {item.url}
              </a>
            </div>
          )}

          {/* Notes */}
          {item.notes && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-1">備考</h4>
              <p className="text-sm">{item.notes}</p>
            </div>
          )}

          {/* Status */}
          {item.completed && (
            <div>
              <Badge className="bg-primary text-primary-foreground">完了</Badge>
            </div>
          )}
          {item.isPrivate && (
            <div>
              <Badge variant="outline" className="text-xs">
                非公開（OWNERのみ詳細）
              </Badge>
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          {canDelete && (
            <Button variant="outline" size="sm" onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              削除
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            閉じる
          </Button>
          {canEdit && (
            <Button size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-2" />
              編集
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
