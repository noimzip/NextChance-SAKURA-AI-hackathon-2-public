import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EffortCategory } from "@/types";
import {
  CATEGORY_LABELS,
  CATEGORY_BADGE_CLASS,
  formatPeriodLabel,
  type EffortPeriodPreset,
} from "@/lib/analysis-engine";

interface ActivityFilterProps {
  period: EffortPeriodPreset;
  categories: EffortCategory[];
  scoreThreshold: number;
  onPeriodChange: (period: EffortPeriodPreset) => void;
  onCategoriesChange: (categories: EffortCategory[]) => void;
  onScoreThresholdChange: (threshold: number) => void;
}

const PERIOD_OPTIONS: EffortPeriodPreset[] = ["last30", "currentQuarter", "all"];
const CATEGORY_OPTIONS: EffortCategory[] = [
  "ai_chat",
  "schedule_create",
  "task_complete",
  "photo_check",
];

export function ActivityFilter({
  period,
  categories,
  scoreThreshold,
  onPeriodChange,
  onCategoriesChange,
  onScoreThresholdChange,
}: ActivityFilterProps) {
  const allSelected = categories.length === CATEGORY_OPTIONS.length;

  const toggleCategory = (category: EffortCategory) => {
    if (categories.includes(category)) {
      const next = categories.filter((value) => value !== category);
      onCategoriesChange(next.length > 0 ? next : [category]);
      return;
    }

    onCategoriesChange([...categories, category]);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">期間プリセット</Label>
        <div className="flex flex-wrap gap-2">
          {PERIOD_OPTIONS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={period === option ? "default" : "outline"}
              onClick={() => onPeriodChange(option)}
            >
              {formatPeriodLabel(option)}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">カテゴリーフィルタ</Label>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() =>
              onCategoriesChange(
                allSelected
                  ? ["schedule_create", "task_complete", "photo_check"]
                  : [...CATEGORY_OPTIONS],
              )
            }
          >
            {allSelected ? "作業系のみ" : "全カテゴリ表示"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((category) => {
            const selected = categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleCategory(category)}
                className={cn(
                  "rounded-full border px-0.5 transition-transform hover:scale-105",
                  selected ? "border-foreground/30" : "border-border opacity-70",
                )}
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs border",
                    CATEGORY_BADGE_CLASS[category],
                    selected ? "opacity-100" : "opacity-60",
                  )}
                >
                  {CATEGORY_LABELS[category]}
                </Badge>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="score-threshold" className="text-xs text-muted-foreground">
          スコア閾値（未満は薄表示）
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="score-threshold"
            type="number"
            min={0}
            max={20}
            value={scoreThreshold}
            onChange={(event) =>
              onScoreThresholdChange(Math.max(0, Number(event.target.value) || 0))
            }
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">以上を強調</span>
        </div>
      </div>
    </div>
  );
}
