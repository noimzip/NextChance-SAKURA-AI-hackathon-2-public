import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { CalendarEvent } from "@/types";

/**
 * Calendar Component - 2025 UX Redesign
 *
 * Design Philosophy:
 * - Bold Minimalism: Clean typography, reduced visual noise
 * - Multi-day events: Connected bars show event spans across days
 * - WCAG AAA: 7:1 contrast, 44×44px touch targets
 * - Mobile-first: Generous cell heights, clear tap feedback
 */

interface CalendarProps {
  selectedDate?: Date | null;
  onDateSelect?: (date: Date) => void;
  onEventClick?: (scheduleId: string) => void;
  datesWithEvents?: Map<string, CalendarEvent[]>;
  size?: "compact" | "standard";
  showCellBorders?: boolean;
  className?: string;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const STANDARD_VISIBLE_EVENTS = 4;
const MOBILE_VISIBLE_EVENTS = 3;
const COMPACT_VISIBLE_EVENTS = 4;
const MOBILE_CELL_HEIGHT_CLASS = "h-26";
const DESKTOP_CELL_HEIGHT_CLASS = "sm:h-30";
const MULTI_DAY_CONNECT_PX = 1;
const EVENT_EDGE_WIDTH_PX = 4;

function formatDateKey(date: Date | string): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}`;
}

function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startPadding = firstDay.getDay();
  for (let i = startPadding - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    days.push(new Date(year, month, day));
  }

  const endPadding = 6 - lastDay.getDay();
  for (let i = 1; i <= endPadding; i++) {
    days.push(new Date(year, month + 1, i));
  }

  return days;
}

// Get category color for event dot/fill
function getEventColor(event: CalendarEvent): string {
  if (event.color) return event.color;
  if (event.completed) return "var(--color-muted-foreground)";
  if (event.mode === "task") return "oklch(0.55 0.15 250)"; // Blue-purple for tasks
  return "oklch(0.60 0.18 160)"; // Emerald for schedules
}

function getEventEdgeColor(event: CalendarEvent): string {
  return event.edgeColor || getEventColor(event);
}

export function Calendar({
  selectedDate,
  onDateSelect,
  onEventClick,
  datesWithEvents = new Map(),
  size = "standard",
  showCellBorders = false,
  className,
}: CalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const today = useMemo(() => new Date(), []);

  const days = useMemo(
    () => getDaysInMonth(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth],
  );

  const goToPreviousMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const handleDateClick = (date: Date) => {
    if (onDateSelect) {
      if (selectedDate && isSameDay(date, selectedDate)) {
        onDateSelect(null as unknown as Date);
      } else {
        onDateSelect(date);
      }
    }
  };

  const isCompact = size === "compact";

  return (
    <div className={cn("select-none", className)} role="grid" aria-label="カレンダー">
      {/* Header with navigation - Increased touch targets */}
      <div className="flex items-center justify-between mb-3">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "transition-all duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isCompact ? "h-8 w-8" : "h-11 w-11",
          )}
          onClick={goToPreviousMonth}
          aria-label="前の月"
        >
          <ChevronLeft className={cn(isCompact ? "h-4 w-4" : "h-5 w-5")} />
        </Button>

        {/* Month/Year - Bold typography */}
        <h2
          className={cn(
            "font-bold tracking-tight text-foreground",
            isCompact ? "text-sm" : "text-lg",
          )}
        >
          {currentMonth.getFullYear()}年{currentMonth.getMonth() + 1}月
        </h2>

        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "transition-all duration-200",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isCompact ? "h-8 w-8" : "h-11 w-11",
          )}
          onClick={goToNextMonth}
          aria-label="次の月"
        >
          <ChevronRight className={cn(isCompact ? "h-4 w-4" : "h-5 w-5")} />
        </Button>
      </div>

      <div
        className={cn(
          showCellBorders && "rounded-xl border border-border/60 overflow-hidden bg-background",
        )}
      >
        {/* Weekday headers - Subdued, medium weight */}
        <div
          className={cn(
            "grid grid-cols-7",
            showCellBorders ? "mb-0 border-b border-border/60 bg-muted/20" : "mb-1",
          )}
          role="row"
        >
          {WEEKDAYS.map((day, index) => (
            <div
              key={day}
              role="columnheader"
              className={cn(
                "text-center font-medium uppercase tracking-wider",
                isCompact ? "text-[10px] py-1" : "text-xs py-2",
                "text-muted-foreground",
                // Weekend colors with better contrast
                index === 0 && "text-red-400",
                index === 6 && "text-blue-400",
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid - Increased cell heights for touch */}
        <div
          className={cn("grid grid-cols-7", showCellBorders ? "gap-0" : "gap-1")}
          role="rowgroup"
        >
          {days.map((date, index) => {
            const dateKey = formatDateKey(date);
            const calendarEvents = datesWithEvents.get(dateKey);
            const eventCount = calendarEvents?.length || 0;
            const isCurrentMonth = date.getMonth() === currentMonth.getMonth();
            const isToday = isSameDay(date, today);
            const isSelected = selectedDate && isSameDay(date, selectedDate);
            const dayOfWeek = date.getDay();
            const rowIndex = Math.floor(index / 7);
            const colIndex = index % 7;

            return (
              <button
                key={index}
                type="button"
                role="gridcell"
                aria-selected={isSelected || undefined}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${date.getMonth() + 1}月${date.getDate()}日${eventCount > 0 ? `、${eventCount}件の予定` : ""}`}
                onClick={() => handleDateClick(date)}
                className={cn(
                  // Base styles - Bold minimalism
                  "relative flex flex-col items-center justify-start",
                  "transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  showCellBorders ? "rounded-none bg-background" : "rounded-lg",
                  showCellBorders && colIndex > 0 && "border-l border-border/50",
                  showCellBorders && rowIndex > 0 && "border-t border-border/50",

                  // Size variants
                  isCompact
                    ? "h-8 pt-1"
                    : showCellBorders
                      ? `${MOBILE_CELL_HEIGHT_CLASS} ${DESKTOP_CELL_HEIGHT_CLASS} py-1 px-0 sm:py-1.5 sm:px-0`
                      : `${MOBILE_CELL_HEIGHT_CLASS} ${DESKTOP_CELL_HEIGHT_CLASS} p-1 sm:p-1.5`,
                  isCompact ? "overflow-hidden" : "overflow-visible",

                  // Current month vs other months
                  !isCurrentMonth && "opacity-30",
                  isCurrentMonth && "hover:bg-accent/50 active:scale-[0.97]",

                  // Weekend colors
                  isCurrentMonth && dayOfWeek === 0 && "text-red-400",
                  isCurrentMonth && dayOfWeek === 6 && "text-blue-400",

                  // Today highlight
                  isToday &&
                    !isSelected &&
                    "z-10 border-primary/50 bg-primary/5 ring-1 ring-primary/45",

                  // Selected state
                  isSelected &&
                    "z-20 border-primary bg-primary/20 ring-2 ring-primary/75 text-primary shadow-sm",
                )}
              >
                {/* Date number - Bold, prominent */}
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    isCompact ? "text-xs" : "text-sm sm:text-base",
                    isToday && !isSelected && "text-primary",
                    isSelected && "text-primary",
                  )}
                >
                  {date.getDate()}
                </span>

                {/* Standard view: Show event details with multi-day spanning */}
                {!isCompact && eventCount > 0 && (
                  <div className="w-full mt-0.5 space-y-0.5 sm:space-y-0.5 overflow-visible">
                    {calendarEvents!.slice(0, STANDARD_VISIBLE_EVENTS).map((event, i) => {
                      const edgeColor = getEventEdgeColor(event);
                      const eventColor = getEventColor(event);
                      const fillColor =
                        event.color || event.completed
                          ? `color-mix(in oklab, ${eventColor} 20%, transparent)`
                          : event.mode === "task"
                            ? "rgba(148, 163, 184, 0.15)" // slate-400 with opacity
                            : "rgba(34, 197, 94, 0.15)"; // green-500 with opacity
                      const displayTimePrefix = event.time
                        ? event.mode === "task"
                          ? `✓ ${event.time} `
                          : `${event.time} `
                        : "";
                      const connectsLeft =
                        event.isMultiDay && !event.isStart && showCellBorders && colIndex > 0;
                      const connectsRight =
                        event.isMultiDay && !event.isEnd && showCellBorders && colIndex < 6;

                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEventClick?.(event.scheduleId || "");
                          }}
                          className={cn(
                            "relative z-10 flex h-[14px] sm:h-[16px] items-center transition-all cursor-pointer",
                            "text-[10px] sm:text-[10px] leading-none",
                            "hover:opacity-80 active:scale-[0.98]",
                            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                            event.completed && "opacity-50",
                            i >= MOBILE_VISIBLE_EVENTS && "hidden sm:flex",
                            // Multi-day event styling
                            event.isMultiDay && !connectsLeft && "rounded-l-sm",
                            event.isMultiDay && !connectsRight && "rounded-r-sm",
                            !event.isMultiDay && "rounded-sm",
                          )}
                          style={{
                            backgroundColor: fillColor,
                            width: "100%",
                            marginLeft: connectsLeft ? `-${MULTI_DAY_CONNECT_PX}px` : "0",
                            paddingLeft: connectsLeft
                              ? `${MULTI_DAY_CONNECT_PX}px`
                              : `${EVENT_EDGE_WIDTH_PX + 2}px`,
                            paddingRight: "4px",
                            borderLeft:
                              !event.isMultiDay || event.isStart
                                ? `${EVENT_EDGE_WIDTH_PX}px solid ${edgeColor}`
                                : "none",
                            borderRight: "none",
                          }}
                          aria-label={`${event.title}${event.time ? ` ${event.time}` : ""}`}
                        >
                          {/* Show title only on start day or single-day events */}
                          {(!event.isMultiDay || event.isStart) && (
                            <span
                              className={cn(
                                "truncate font-semibold text-foreground/95",
                                event.completed && "line-through text-muted-foreground",
                              )}
                            >
                              <span className="hidden sm:inline">{displayTimePrefix}</span>
                              {event.title}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {eventCount > MOBILE_VISIBLE_EVENTS && (
                      <div
                        className={cn(
                          "text-[8px] font-medium text-muted-foreground pl-1 sm:hidden",
                          isSelected && "text-primary-foreground/70",
                        )}
                      >
                        +{eventCount - MOBILE_VISIBLE_EVENTS}件
                      </div>
                    )}
                    {eventCount > STANDARD_VISIBLE_EVENTS && (
                      <div
                        className={cn(
                          "hidden sm:block text-[8px] sm:text-[9px] font-medium text-muted-foreground pl-1",
                          isSelected && "text-primary-foreground/70",
                        )}
                      >
                        +{eventCount - STANDARD_VISIBLE_EVENTS}件
                      </div>
                    )}
                  </div>
                )}

                {/* Compact view: Show dots only */}
                {isCompact && eventCount > 0 && (
                  <div className="absolute bottom-0.5 flex items-center gap-0.5">
                    {calendarEvents!.slice(0, COMPACT_VISIBLE_EVENTS).map((event, i) => (
                      <span
                        key={i}
                        className={cn(
                          "rounded-full h-1 w-1",
                          isSelected && "ring-1 ring-primary-foreground",
                        )}
                        style={{ backgroundColor: getEventColor(event) }}
                        aria-hidden="true"
                      />
                    ))}
                    {eventCount > COMPACT_VISIBLE_EVENTS && (
                      <span className="text-[6px] font-bold text-primary">+</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { formatDateKey, isSameDay };
