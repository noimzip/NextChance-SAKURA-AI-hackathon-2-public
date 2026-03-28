import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useSchedule } from "@/hooks/useSchedule";
import {
  SCHEDULE_SORT_STORAGE_KEY,
  sortScheduleItems,
  type ScheduleSortMode,
} from "@/lib/tagPriority";
import {
  MessageSquare,
  Calendar as CalendarIcon,
  Camera,
  LayoutGrid,
  ChevronLeft,
} from "lucide-react";

export type TabId = "chat" | "schedule" | "photo" | "grass";

type SidebarUpcomingViewMode = "combined" | "separated";
type SidebarSeparatedTarget = "schedule" | "task";

const SIDEBAR_UPCOMING_VIEW_STORAGE_KEY = "grass-secretary-sidebar-upcoming-view-mode";
const SIDEBAR_SEPARATED_TARGET_STORAGE_KEY = "grass-secretary-sidebar-separated-target";

function getSidebarItemColor(item: {
  mode: "task" | "schedule";
  color?: string;
  tags?: { id: string; color: string }[];
}): string {
  if (item.color) return item.color;
  return item.mode === "task" ? "oklch(0.55 0.15 250)" : "oklch(0.60 0.18 160)";
}

function formatDateDisplay(date: Date | string, isAllDay = false): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const checkDate = new Date(dateObj);
  checkDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffTime = checkDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (isAllDay) {
    if (diffDays < 0) return `${Math.abs(diffDays)}日超過 終日`;
    if (diffDays === 0) return "今日 終日";
    if (diffDays === 1) return "明日 終日";
    if (diffDays <= 7) return `${diffDays}日後 終日`;

    return (
      dateObj.toLocaleDateString("ja-JP", {
        month: "short",
        day: "numeric",
      }) + " 終日"
    );
  }

  const hours = dateObj.getHours();
  const minutes = dateObj.getMinutes();
  const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  if (diffDays < 0) return `${Math.abs(diffDays)}日超過 ${timeStr}`;
  if (diffDays === 0) return `今日 ${timeStr}`;
  if (diffDays === 1) return `明日 ${timeStr}`;
  if (diffDays <= 7) return `${diffDays}日後 ${timeStr}`;

  return (
    dateObj.toLocaleDateString("ja-JP", {
      month: "short",
      day: "numeric",
    }) + ` ${timeStr}`
  );
}

function formatScheduleDateRange(
  dueDate: Date | string,
  endDate?: Date | string,
  isAllDay?: boolean,
): string {
  const startDisplay = formatDateDisplay(dueDate, Boolean(isAllDay));
  if (!endDate) {
    return startDisplay;
  }
  const endDisplay = formatDateDisplay(endDate, Boolean(isAllDay));
  return `${startDisplay} 〜 ${endDisplay}`;
}

function isOverdue(date: Date | string): boolean {
  const dateObj = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const checkDate = new Date(dateObj);
  checkDate.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);

  const diffTime = checkDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays < 0;
}

interface SidebarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  selectedDate?: Date | null;
  onDateSelect?: (date: Date | null) => void;
  isOpen?: boolean;
  onToggle?: () => void;
  className?: string;
}

/**
 * Sidebar Navigation - Layered Darks Design
 *
 * UX Design Rationale:
 * - Elevated surface (muted layer) creates clear separation from main content
 * - Active states use primary color for strong visual feedback
 * - Focus-visible states with high contrast ring for AAA accessibility
 * - Generous touch targets (h-12) for mobile accessibility
 * - Semantic structure with proper ARIA roles
 */
const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  {
    id: "chat",
    label: "AI秘書",
    icon: <MessageSquare className="h-5 w-5" />,
  },
  {
    id: "schedule",
    label: "スケジュール",
    icon: <CalendarIcon className="h-5 w-5" />,
  },
  {
    id: "photo",
    label: "持ち物チェック",
    icon: <Camera className="h-5 w-5" />,
  },
  {
    id: "grass",
    label: "努力の芝",
    icon: <LayoutGrid className="h-5 w-5" />,
  },
];

export function Sidebar({
  activeTab,
  onTabChange,
  selectedDate,
  onDateSelect,
  isOpen = true,
  onToggle,
  className,
}: SidebarProps) {
  const { getCalendarEventsByDate, getUpcoming } = useSchedule();
  const [sortMode, setSortMode] = useLocalStorage<ScheduleSortMode>(
    SCHEDULE_SORT_STORAGE_KEY,
    "date",
  );
  const [upcomingViewMode, setUpcomingViewMode] = useLocalStorage<SidebarUpcomingViewMode>(
    SIDEBAR_UPCOMING_VIEW_STORAGE_KEY,
    "separated",
  );
  const [separatedTarget, setSeparatedTarget] = useLocalStorage<SidebarSeparatedTarget>(
    SIDEBAR_SEPARATED_TARGET_STORAGE_KEY,
    "schedule",
  );
  const datesWithEvents = getCalendarEventsByDate();
  const upcomingItems = sortScheduleItems(getUpcoming(7), sortMode).slice(0, 5);
  const upcomingScheduleItems = upcomingItems.filter(
    (item) => item.mode === "schedule" && !isOverdue(item.dueDate),
  );
  const upcomingTaskItems = upcomingItems.filter((item) => item.mode === "task");
  const combinedUpcomingItems = upcomingItems.filter(
    (item) => item.mode === "task" || (item.mode === "schedule" && !isOverdue(item.dueDate)),
  );

  const handleDateSelect = (date: Date | null) => {
    if (onDateSelect) {
      onDateSelect(date);
    }
    if (date && onTabChange) {
      onTabChange("schedule");
    }
  };

  return (
    <aside
      className={cn(
        "relative flex min-h-0 flex-col overflow-y-hidden overflow-x-visible",
        "border-r border-border/50",
        "bg-muted/20",
        "w-full sm:w-72",
        className,
      )}
      role="navigation"
      aria-label="メインナビゲーション"
    >
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "hidden sm:flex absolute right-0 top-1/2 z-20 -translate-y-1/2 translate-x-1/2",
            "h-12 w-8 items-center justify-center rounded-r-lg",
            "border border-border/60 bg-card text-muted-foreground",
            "hover:text-foreground hover:bg-accent transition-all duration-200",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          )}
          aria-label={isOpen ? "サイドバーを隠す" : "サイドバーを表示"}
          aria-expanded={isOpen}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      <nav className="flex flex-row sm:flex-col gap-1.5 p-3 sm:p-4" role="tablist">
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "secondary" : "ghost"}
            className={cn(
              "flex-1 sm:flex-none justify-start gap-3 h-12",
              "text-sm font-medium transition-all duration-200",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              activeTab === tab.id
                ? "bg-primary/15 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
          >
            <span
              className={cn(
                "transition-colors",
                activeTab === tab.id ? "text-primary" : "text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {tab.icon}
            </span>
            <span className="inline text-xs sm:text-sm sm:inline">{tab.label}</span>
          </Button>
        ))}
      </nav>

      <div className="hidden sm:flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Mini calendar */}
        <div className="px-4 pt-4">
          <Calendar
            size="compact"
            selectedDate={selectedDate}
            onDateSelect={handleDateSelect}
            datesWithEvents={datesWithEvents}
          />
        </div>

        {/* Upcoming schedules/tasks */}
        <div className="mt-4 flex flex-1 flex-col border-t border-border/40 px-4 py-4">
          <div className="mb-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">並び順:</span>
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

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">表示:</span>
              <Button
                variant={upcomingViewMode === "combined" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setUpcomingViewMode("combined")}
              >
                一覧
              </Button>
              <Button
                variant={upcomingViewMode === "separated" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setUpcomingViewMode("separated")}
              >
                分割
              </Button>
            </div>

            {upcomingViewMode === "separated" && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">対象:</span>
                <Button
                  variant={separatedTarget === "schedule" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSeparatedTarget("schedule")}
                >
                  予定
                </Button>
                <Button
                  variant={separatedTarget === "task" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSeparatedTarget("task")}
                >
                  タスク
                </Button>
              </div>
            )}
          </div>

          {upcomingViewMode === "combined" ? (
            <section aria-labelledby="upcoming-all">
              <h3
                id="upcoming-all"
                className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3"
              >
                予定・タスク
              </h3>
              <div className="space-y-2">
                {combinedUpcomingItems.length > 0 ? (
                  combinedUpcomingItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        onDateSelect?.(item.dueDate);
                        onTabChange("schedule");
                      }}
                      className={cn(
                        "w-full text-left p-3 rounded-lg text-sm",
                        "bg-card/50 border border-border/40",
                        "hover:bg-accent hover:border-primary/30 transition-all duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        item.completed && "opacity-50 line-through",
                        item.mode === "task" &&
                          isOverdue(item.dueDate) &&
                          !item.completed &&
                          "border-destructive/50 bg-destructive/10",
                      )}
                      style={{
                        borderLeftWidth: "3px",
                        borderLeftColor: getSidebarItemColor(item),
                      }}
                      title={item.title}
                    >
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="font-semibold truncate text-foreground">{item.title}</div>
                        <span
                          className={cn(
                            "inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0",
                            item.mode === "schedule"
                              ? "bg-emerald-500/15 text-emerald-700"
                              : "bg-blue-500/15 text-blue-700",
                          )}
                        >
                          {item.mode === "schedule" ? "予定" : "タスク"}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "text-xs mb-1.5",
                          item.mode === "task" && isOverdue(item.dueDate) && !item.completed
                            ? "text-destructive font-bold"
                            : "text-muted-foreground",
                        )}
                      >
                        {item.mode === "schedule"
                          ? formatScheduleDateRange(item.dueDate, item.endDate, item.isAllDay)
                          : formatDateDisplay(item.dueDate, false)}
                      </div>
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {item.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ backgroundColor: tag.color + "25", color: tag.color }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground py-3 text-center">
                    予定・タスクがありません
                  </p>
                )}
              </div>
            </section>
          ) : (
            <>
              {separatedTarget === "schedule" ? (
                <section aria-labelledby="upcoming-schedules">
                  <h3
                    id="upcoming-schedules"
                    className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3"
                  >
                    予定
                  </h3>
                  <div className="space-y-2">
                    {upcomingScheduleItems.length > 0 ? (
                      upcomingScheduleItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onDateSelect?.(item.dueDate);
                            onTabChange("schedule");
                          }}
                          className={cn(
                            "w-full text-left p-3 rounded-lg text-sm",
                            "bg-card/50 border border-border/40",
                            "hover:bg-accent hover:border-primary/30 transition-all duration-200",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            item.completed && "opacity-50 line-through",
                          )}
                          style={{
                            borderLeftWidth: "3px",
                            borderLeftColor: getSidebarItemColor(item),
                          }}
                          title={item.title}
                        >
                          <div className="font-semibold truncate mb-1.5 text-foreground">
                            {item.title}
                          </div>
                          <div className="text-xs text-muted-foreground mb-1.5">
                            {formatScheduleDateRange(item.dueDate, item.endDate, item.isAllDay)}
                          </div>
                          {item.tags && item.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {item.tags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
                                  style={{ backgroundColor: tag.color + "25", color: tag.color }}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground py-3 text-center">
                        予定がありません
                      </p>
                    )}
                  </div>
                </section>
              ) : (
                <section aria-labelledby="upcoming-tasks">
                  <h3
                    id="upcoming-tasks"
                    className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3"
                  >
                    タスク
                  </h3>
                  <div className="space-y-2">
                    {upcomingTaskItems.length > 0 ? (
                      upcomingTaskItems.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => {
                            onDateSelect?.(item.dueDate);
                            onTabChange("schedule");
                          }}
                          className={cn(
                            "w-full text-left p-3 rounded-lg text-sm",
                            "bg-card/50 border border-border/40",
                            "hover:bg-accent hover:border-primary/30 transition-all duration-200",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            item.completed && "opacity-50 line-through",
                            isOverdue(item.dueDate) &&
                              !item.completed &&
                              "border-destructive/50 bg-destructive/10",
                          )}
                          style={{
                            borderLeftWidth: "3px",
                            borderLeftColor: getSidebarItemColor(item),
                          }}
                          title={item.title}
                        >
                          <div className="font-semibold truncate mb-1.5 text-foreground">
                            {item.title}
                          </div>
                          <div
                            className={cn(
                              "text-xs mb-1.5",
                              isOverdue(item.dueDate) && !item.completed
                                ? "text-destructive font-bold"
                                : "text-muted-foreground",
                            )}
                          >
                            {item.mode === "schedule"
                              ? formatScheduleDateRange(item.dueDate, item.endDate, item.isAllDay)
                              : formatDateDisplay(item.dueDate, false)}
                          </div>
                          {item.tags && item.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {item.tags.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="inline-block text-xs px-2 py-0.5 rounded-full font-medium"
                                  style={{ backgroundColor: tag.color + "25", color: tag.color }}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground py-3 text-center">
                        タスクがありません
                      </p>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
