import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Trash2,
  Clock,
  CalendarDays,
  Pencil,
  ChevronDown,
  Sparkles,
  Bell,
} from "lucide-react";
import type { RepeatWeekday, ScheduleItem as ScheduleItemType } from "@/types";
import { formatReminderSummary } from "@/lib/scheduleReminders";

/**
 * ScheduleItem Component - 2025 UX Redesign
 *
 * Design Principles:
 * - Bold Minimalism: Time-first hierarchy, reduced visual noise
 * - Touch-friendly: 56px minimum row height, generous tap targets
 * - Category color bar on left edge for quick scanning
 * - WCAG AAA: High contrast text, visible focus states
 */

interface ScheduleItemProps {
  item: ScheduleItemType;
  onToggleComplete: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onView?: () => void;
  viewDate?: Date | null;
}

function formatTime(date: Date | string): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatRelativeDate(
  date: Date | string,
  mode: "task" | "schedule",
  isAllDay = false,
): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const dueDate = new Date(dateObj);
  dueDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  const diffTime = dueDate.getTime() - now.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const suffix = isAllDay ? " 終日" : ` ${formatTime(dateObj)}`;

  if (mode === "schedule" && diffDays < 0) {
    return `${dateObj.toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}${suffix}`;
  }

  if (diffDays < 0) return `${Math.abs(diffDays)}日超過${suffix}`;
  if (diffDays === 0) return `今日${suffix}`;
  if (diffDays === 1) return `明日${suffix}`;
  if (diffDays <= 7) return `${diffDays}日後${suffix}`;
  return `${dateObj.toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}${suffix}`;
}

function getItemColor(item: ScheduleItemType): string {
  if (item.color) return item.color;
  if (item.mode === "task") return "oklch(0.55 0.15 250)"; // Blue-purple
  return "oklch(0.60 0.18 160)"; // Emerald
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

function formatRecurrenceSummary(item: ScheduleItemType): string | null {
  const recurrence = item.recurrence;
  if (!recurrence || recurrence.weekdays.length === 0) {
    return null;
  }
  const weekdays = recurrence.weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join("・");
  if (recurrence.isInfinite) {
    const occurrenceText =
      typeof recurrence.occurrenceIndex === "number"
        ? ` (${recurrence.occurrenceIndex + 1}回目)`
        : "";
    return `毎週${weekdays} / 永続${occurrenceText}`;
  }
  if (!recurrence.count || recurrence.count <= 1) {
    return null;
  }
  const occurrenceText =
    typeof recurrence.occurrenceIndex === "number"
      ? ` (${recurrence.occurrenceIndex + 1}/${recurrence.count})`
      : "";
  return `毎週${weekdays}${occurrenceText}`;
}

export function ScheduleItem({
  item,
  onToggleComplete,
  onDelete,
  onEdit,
  onView,
  viewDate,
}: ScheduleItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const isOverdue = !item.completed && item.mode === "task" && new Date(item.dueDate) < new Date();

  const getDayIndicator = () => {
    if (!viewDate || !item.endDate) return null;
    const dueDate = new Date(item.dueDate);
    dueDate.setHours(0, 0, 0, 0);
    const endDate = new Date(item.endDate);
    endDate.setHours(0, 0, 0, 0);
    const checkDate = new Date(viewDate);
    checkDate.setHours(0, 0, 0, 0);
    if (dueDate.getTime() === endDate.getTime()) return null;
    const day = Math.floor((checkDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const total = Math.floor((endDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return { day, total };
  };

  const handleToggleComplete = () => {
    if (!item.completed) {
      setIsCompleting(true);
      setTimeout(() => {
        onToggleComplete();
        setIsCompleting(false);
      }, 400);
    } else {
      onToggleComplete();
    }
  };

  const hasExtendedFields =
    item.location || item.items || item.participants || item.url || item.notes;
  const dayIndicator = getDayIndicator();
  const itemColor = getItemColor(item);
  const recurrenceText = formatRecurrenceSummary(item);
  const reminderText = formatReminderSummary(item.reminderOffsetsMinutes);

  return (
    <div
      className={cn(
        "group relative flex items-stretch gap-0 rounded-xl transition-all duration-200",
        "bg-card border border-border/60",
        "hover:border-primary/30 hover:shadow-md",
        "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
        "min-h-14 sm:min-h-16", // 56px+ touch target
        item.completed && "opacity-50",
        isOverdue && !item.completed && "border-destructive/50 bg-destructive/5",
        isCompleting && "scale-[1.02] shadow-lg border-primary",
      )}
      onClick={() => onView?.()}
      role="article"
      aria-label={`${item.title}、${formatRelativeDate(item.dueDate, item.mode, item.isAllDay)}`}
    >
      {/* Color bar - Category indicator */}
      <div
        className={cn(
          "w-1.5 rounded-l-xl flex-shrink-0 transition-all",
          item.completed && "opacity-40",
        )}
        style={{
          backgroundColor: itemColor,
          boxShadow:
            item.ownerId && item.ownerId !== "owner-local"
              ? `0 0 0 1px color-mix(in oklab, ${itemColor} 70%, black)`
              : undefined,
        }}
        aria-hidden="true"
      />

      {/* Completion celebration effect */}
      {isCompleting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex gap-1">
            <Sparkles className="h-5 w-5 text-primary animate-ping" />
            <Sparkles className="h-4 w-4 text-yellow-500 animate-ping [animation-delay:0.1s]" />
            <Sparkles className="h-5 w-5 text-primary animate-ping [animation-delay:0.2s]" />
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 flex items-center gap-3 p-3 sm:p-4 min-w-0">
        {/* Task checkbox */}
        {item.mode === "task" && (
          <Button
            variant="outline"
            size="icon"
            className={cn(
              "h-8 w-8 shrink-0 rounded-full transition-all duration-200",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              item.completed && "bg-primary border-primary text-primary-foreground",
              !item.completed && "hover:border-primary hover:bg-primary/10",
              isCompleting && "scale-110 bg-primary border-primary",
            )}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleComplete();
            }}
            aria-label={item.completed ? "完了を取り消す" : "完了にする"}
          >
            {(item.completed || isCompleting) && <Check className="h-4 w-4" />}
          </Button>
        )}

        {/* Time - Bold, prominent (time-first hierarchy) */}
        <div className="flex-shrink-0 w-14 sm:w-16">
          {item.mode === "schedule" && item.isAllDay ? (
            <span
              className={cn(
                "text-sm sm:text-base font-bold",
                isOverdue ? "text-destructive" : "text-foreground",
                item.completed && "text-muted-foreground",
              )}
            >
              終日
            </span>
          ) : (
            <span
              className={cn(
                "text-base sm:text-lg font-bold tabular-nums",
                isOverdue ? "text-destructive" : "text-foreground",
                item.completed && "text-muted-foreground",
              )}
            >
              {formatTime(item.dueDate)}
            </span>
          )}
        </div>

        {/* Title and metadata */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "font-semibold text-sm sm:text-base text-foreground truncate",
                item.completed && "line-through text-muted-foreground",
              )}
            >
              {item.title}
            </span>

            {/* Badges - Minimal */}
            <Badge
              variant="outline"
              className={cn(
                "text-xs px-2 py-0 h-5",
                item.mode === "task"
                  ? "border-muted-foreground/30 text-muted-foreground"
                  : "border-primary/30 text-primary bg-primary/5",
              )}
            >
              {item.mode === "task" ? "タスク" : "予定"}
            </Badge>

            {dayIndicator && (
              <Badge variant="secondary" className="text-xs px-2 py-0 h-5">
                {dayIndicator.day}/{dayIndicator.total}日目
              </Badge>
            )}
          </div>

          {/* Date info - Subdued */}
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span
              className={cn(
                "flex items-center gap-1",
                isOverdue && item.mode === "task" && "text-destructive font-semibold",
              )}
            >
              {isOverdue && item.mode === "task" ? (
                <Clock className="h-3.5 w-3.5" />
              ) : (
                <CalendarDays className="h-3.5 w-3.5" />
              )}
              {formatRelativeDate(item.dueDate, item.mode, item.isAllDay)}
            </span>

            {item.endDate && (
              <>
                <span className="text-muted-foreground/50">→</span>
                <span>{formatRelativeDate(item.endDate, item.mode, item.isAllDay)}</span>
              </>
            )}

            {/* Tags inline */}
            {item.tags?.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                style={{ backgroundColor: tag.color + "20", color: tag.color }}
              >
                {tag.name}
              </span>
            ))}
            {item.tags && item.tags.length > 2 && (
              <span className="text-muted-foreground">+{item.tags.length - 2}</span>
            )}
            {recurrenceText && (
              <span className="text-[11px] text-muted-foreground">{recurrenceText}</span>
            )}
            {reminderText !== "通知なし" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Bell className="h-3 w-3" />
                {reminderText}
              </span>
            )}
          </div>

          {/* Expandable details */}
          {hasExtendedFields && (
            <div className="mt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className={cn(
                  "flex items-center gap-1 text-xs text-muted-foreground",
                  "hover:text-foreground transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
                )}
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-180")}
                />
                詳細
              </button>

              {isExpanded && (
                <div className="mt-2 pl-4 border-l-2 border-border space-y-1.5 text-xs text-muted-foreground">
                  {item.location && (
                    <div>
                      <span className="font-medium text-foreground">場所:</span> {item.location}
                    </div>
                  )}
                  {item.items && (
                    <div>
                      <span className="font-medium text-foreground">持ち物:</span> {item.items}
                    </div>
                  )}
                  {item.participants && (
                    <div>
                      <span className="font-medium text-foreground">参加者:</span>{" "}
                      {item.participants}
                    </div>
                  )}
                  {item.url && (
                    <div>
                      <span className="font-medium text-foreground">URL:</span>{" "}
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline break-all"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.url}
                      </a>
                    </div>
                  )}
                  {item.notes && (
                    <div>
                      <span className="font-medium text-foreground">備考:</span> {item.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action buttons - Always visible on mobile, hover on desktop */}
      <div
        className={cn(
          "flex items-center gap-1 pr-2 sm:pr-3",
          "sm:opacity-0 sm:group-hover:opacity-100 transition-opacity",
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-lg",
            "text-muted-foreground hover:text-primary hover:bg-primary/10",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label="編集"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 rounded-lg",
            "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="削除"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
