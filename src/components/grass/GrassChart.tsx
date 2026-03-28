import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CATEGORY_BADGE_CLASS,
  CATEGORY_LABELS,
  formatDateForTooltip,
  type FilteredEffortDay,
} from "@/lib/analysis-engine";
import type { EffortCategory } from "@/types";

interface GrassChartProps {
  days: FilteredEffortDay[];
  selectedCategories: EffortCategory[];
}

const DAYS_OF_WEEK = ["日", "月", "火", "水", "木", "金", "土"];

function intensityClass(intensity: FilteredEffortDay["intensity"]): string {
  if (intensity === 0) return "bg-grass-0";
  if (intensity === 1) return "bg-grass-1";
  if (intensity === 2) return "bg-grass-2";
  if (intensity === 3) return "bg-grass-3";
  return "bg-grass-4";
}

function buildWeeks(days: FilteredEffortDay[]): FilteredEffortDay[][] {
  const weeks: FilteredEffortDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

function getCategorySummary(day: FilteredEffortDay, categories: EffortCategory[]) {
  return categories
    .map((category) => ({
      category,
      count: day.categoryCounts[category],
      score: day.categoryScores[category],
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.score - a.score);
}

export function GrassChart({ days, selectedCategories }: GrassChartProps) {
  const weeks = buildWeeks(days);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="inline-block min-w-max">
        <div className="flex gap-0.5">
          <div className="flex flex-col gap-0.5 mr-1">
            {DAYS_OF_WEEK.map((day, index) => (
              <div
                key={day}
                className={cn(
                  "h-3 text-[10px] text-muted-foreground",
                  index % 2 === 0 ? "opacity-100" : "opacity-0",
                )}
              >
                {day}
              </div>
            ))}
          </div>

          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-0.5">
              {week.map((day) => {
                const categorySummary = getCategorySummary(day, selectedCategories);
                return (
                  <Tooltip key={day.date}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          "w-3 h-3 rounded-[2px] cursor-pointer transition-transform hover:scale-125",
                          intensityClass(day.intensity),
                          day.isBelowThreshold && "opacity-35",
                        )}
                        aria-label={`${formatDateForTooltip(day.date)}: ${day.filteredCount}件 / score ${day.filteredScore}`}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-xs bg-popover text-popover-foreground border p-3"
                    >
                      <p className="font-semibold">{formatDateForTooltip(day.date)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {day.filteredCount}件 / スコア {day.filteredScore}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {categorySummary.length > 0 ? (
                          categorySummary.map((item) => (
                            <Badge
                              key={item.category}
                              variant="outline"
                              className={cn(
                                "text-[10px] border",
                                CATEGORY_BADGE_CLASS[item.category],
                              )}
                            >
                              {CATEGORY_LABELS[item.category]}: {item.count}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            アクティビティなし
                          </span>
                        )}
                      </div>
                      {day.activities.length > 0 && (
                        <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                          {day.activities.slice(0, 3).map((activity) => (
                            <li key={activity.id}>• {activity.description}</li>
                          ))}
                          {day.activities.length > 3 && <li>• 他 {day.activities.length - 3}件</li>}
                        </ul>
                      )}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
