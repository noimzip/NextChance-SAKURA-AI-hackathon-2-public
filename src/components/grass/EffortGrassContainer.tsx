import { useEffect, useMemo, useState } from "react";
import { Flame, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffortLog } from "@/hooks/useEffortLog";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { cn } from "@/lib/utils";
import {
  EFFORT_CATEGORIES,
  CATEGORY_CHART_COLOR,
  CATEGORY_LABELS,
  analyzeEffortDays,
  applyEffortFilters,
  formatPeriodDateRange,
  formatPeriodLabel,
  generateEffortAdvice,
  type EffortFilters,
  type EffortPeriodPreset,
} from "@/lib/analysis-engine";
import {
  DEFAULT_SECRETARY_MODEL,
  isSecretaryModelId,
  SECRETARY_MODEL_STORAGE_KEY,
  type SecretaryModelId,
} from "@/lib/secretaryModels";
import { ActivityFilter } from "./ActivityFilter";
import { GrassChart } from "./GrassChart";
import type { EffortCategory } from "@/types";

interface EffortGrassContainerProps {
  className?: string;
}

const DEFAULT_FILTERS: EffortFilters = {
  period: "last30",
  categories: [...EFFORT_CATEGORIES],
  scoreThreshold: 1,
};

function statTrendLabel(delta: number): string {
  if (delta > 0.05) return "上昇";
  if (delta < -0.05) return "下降";
  return "横ばい";
}

function asPeriodPreset(value: EffortPeriodPreset): EffortPeriodPreset {
  return value;
}

export function EffortGrassContainer({ className }: EffortGrassContainerProps) {
  const { getAllDailySummaries, getCurrentStreak, getTotalCount, getTotalScore } = useEffortLog();
  const [storedSelectedModel, setStoredSelectedModel] = useLocalStorage<string>(
    SECRETARY_MODEL_STORAGE_KEY,
    DEFAULT_SECRETARY_MODEL,
  );

  const [filters, setFilters] = useState<EffortFilters>(DEFAULT_FILTERS);
  const [advice, setAdvice] = useState<string>("");
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [isGeneratingAdvice, setIsGeneratingAdvice] = useState(false);
  const selectedModel: SecretaryModelId = isSecretaryModelId(storedSelectedModel)
    ? storedSelectedModel
    : DEFAULT_SECRETARY_MODEL;

  useEffect(() => {
    if (!isSecretaryModelId(storedSelectedModel)) {
      setStoredSelectedModel(DEFAULT_SECRETARY_MODEL);
    }
  }, [storedSelectedModel, setStoredSelectedModel]);

  const allSummaries = useMemo(() => getAllDailySummaries(), [getAllDailySummaries]);
  const filteredDays = useMemo(
    () => applyEffortFilters(allSummaries, filters),
    [allSummaries, filters],
  );
  const stats = useMemo(() => analyzeEffortDays(filteredDays), [filteredDays]);
  const taskCompleteTagStats = useMemo(() => {
    const tagCounts = new Map<string, number>();

    for (const day of filteredDays) {
      for (const activity of day.activities) {
        if (activity.type !== "task_complete") {
          continue;
        }
        const tags =
          activity.metadata?.tags && activity.metadata.tags.length > 0
            ? activity.metadata.tags
            : ["タグなし"];
        for (const tag of tags) {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }

    return [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }, [filteredDays]);
  const streak = getCurrentStreak();
  const totalCount = getTotalCount();
  const totalScore = getTotalScore();

  const handlePeriodChange = (period: EffortPeriodPreset) => {
    setFilters((prev) => ({ ...prev, period: asPeriodPreset(period) }));
  };

  const handleCategoriesChange = (categories: EffortCategory[]) => {
    setFilters((prev) => ({ ...prev, categories }));
  };

  const handleScoreThresholdChange = (scoreThreshold: number) => {
    setFilters((prev) => ({ ...prev, scoreThreshold }));
  };

  const handleGenerateAdvice = async () => {
    setAdviceError(null);
    setIsGeneratingAdvice(true);
    try {
      const nextAdvice = await generateEffortAdvice(stats, filteredDays, filters, {
        model: selectedModel,
      });
      setAdvice(nextAdvice);
    } catch (error) {
      const message = error instanceof Error ? error.message : "不明なエラー";
      setAdviceError(`AIアドバイスの生成に失敗しました: ${message}`);
    } finally {
      setIsGeneratingAdvice(false);
    }
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-4 border-b bg-gradient-to-r from-emerald-50/70 via-green-50/40 to-transparent">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <CardTitle className="text-xl flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 text-white shadow-sm">
              <span className="text-lg">🌱</span>
            </div>
            <span className="bg-gradient-to-r from-emerald-700 to-green-600 bg-clip-text text-transparent">
              努力の芝ダッシュボード
            </span>
          </CardTitle>

          <div className="flex flex-wrap gap-2 text-xs">
            <div className="px-3 py-1.5 rounded-full border bg-emerald-50 text-emerald-700">
              合計件数 <strong>{totalCount}</strong>
            </div>
            <div className="px-3 py-1.5 rounded-full border bg-green-50 text-green-700">
              合計スコア <strong>{totalScore}</strong>
            </div>
            <div className="px-3 py-1.5 rounded-full border bg-orange-50 text-orange-700 flex items-center gap-1">
              <Flame className="h-3.5 w-3.5" />
              連続 <strong>{streak}</strong> 日
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        <ActivityFilter
          period={filters.period}
          categories={filters.categories}
          scoreThreshold={filters.scoreThreshold}
          onPeriodChange={handlePeriodChange}
          onCategoriesChange={handleCategoriesChange}
          onScoreThresholdChange={handleScoreThresholdChange}
        />

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h3 className="font-semibold text-sm">多次元アクティビティ・グリッド</h3>
            <p className="text-xs text-muted-foreground">
              {formatPeriodLabel(filters.period)} / {formatPeriodDateRange(filteredDays)}
            </p>
          </div>
          <TooltipProvider delayDuration={120}>
            <GrassChart days={filteredDays} selectedCategories={filters.categories} />
          </TooltipProvider>
          <p className="text-[11px] text-muted-foreground">
            ※ スコア閾値未満のセルは薄表示されます（コンテキスト保持）。
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">アクティビティ分析パネル</h3>
              <span className="text-xs text-muted-foreground">
                傾向: {statTrendLabel(stats.densityDelta)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border bg-muted/30 p-2">
                <p className="text-muted-foreground">表示中スコア</p>
                <p className="font-semibold text-base">{stats.totalScore}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <p className="text-muted-foreground">アクティブ日数</p>
                <p className="font-semibold text-base">{stats.activeDays}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <p className="text-muted-foreground">日次平均スコア</p>
                <p className="font-semibold text-base">
                  {stats.averageScorePerActiveDay.toFixed(1)}
                </p>
              </div>
              <div className="rounded-md border bg-muted/30 p-2 flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground">密度変化</p>
                  <p className="font-semibold text-base">{stats.densityDelta.toFixed(1)}</p>
                </div>
                {stats.densityDelta >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-rose-600" />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium">カテゴリ寄与（スコア）</p>
              <ScrollArea className="max-h-44 pr-1">
                <div className="space-y-2">
                  {stats.categoryContributions.length === 0 && (
                    <p className="text-xs text-muted-foreground">該当データがありません。</p>
                  )}
                  {stats.categoryContributions.map((item) => (
                    <div key={item.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span>{CATEGORY_LABELS[item.category]}</span>
                        <span className="text-muted-foreground">
                          {item.score} ({Math.round(item.ratio * 100)}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, Math.round(item.ratio * 100))}%`,
                            backgroundColor: CATEGORY_CHART_COLOR[item.category],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium">タスク完了（タグ別）</p>
              <div className="rounded-md border bg-muted/20 p-2">
                {taskCompleteTagStats.length === 0 ? (
                  <p className="text-xs text-muted-foreground">タスク完了データがありません。</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {taskCompleteTagStats.map((item) => (
                      <span
                        key={item.tag}
                        className="rounded-full border px-2 py-1 text-[11px] bg-background"
                      >
                        {item.tag}: {item.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                AI秘書のアドバイス
              </h3>
              <Button size="sm" onClick={handleGenerateAdvice} disabled={isGeneratingAdvice}>
                {isGeneratingAdvice ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    生成中
                  </>
                ) : (
                  "分析更新"
                )}
              </Button>
            </div>

            {adviceError && (
              <p className="text-xs text-destructive rounded-md border border-destructive/20 bg-destructive/5 p-2">
                {adviceError}
              </p>
            )}

            <div className="rounded-md border bg-muted/30 p-3 min-h-24">
              {advice ? (
                <p className="text-sm leading-relaxed">{advice}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  「分析更新」を押すと、直近の芝密度とカテゴリ寄与から、ずんだもん口調の行動アドバイスを生成します。
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
