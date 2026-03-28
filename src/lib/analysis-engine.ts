import { sakuraFetch } from "@/services/sakuraAI";
import { formatSecretaryResponse } from "@/lib/secretaryResponse";
import { DEFAULT_SECRETARY_MODEL, type SecretaryModelId } from "@/lib/secretaryModels";
import { requestChatCompletionWithRetry } from "@/lib/chatCompletion";
import type {
  ChatCompletionResponse,
  EffortActivity,
  EffortCategory,
  EffortDailySummary,
} from "@/types";

export const EFFORT_CATEGORIES: EffortCategory[] = [
  "ai_chat",
  "schedule_create",
  "task_complete",
  "photo_check",
];

export const CATEGORY_LABELS: Record<EffortCategory, string> = {
  ai_chat: "AI会話",
  schedule_create: "予定/タスク作成",
  task_complete: "タスク完了",
  photo_check: "写真チェック",
};

export const CATEGORY_BADGE_CLASS: Record<EffortCategory, string> = {
  ai_chat: "bg-sky-100 text-sky-700 border-sky-200",
  schedule_create: "bg-emerald-100 text-emerald-700 border-emerald-200",
  task_complete: "bg-green-100 text-green-700 border-green-200",
  photo_check: "bg-amber-100 text-amber-700 border-amber-200",
};

export const CATEGORY_CHART_COLOR: Record<EffortCategory, string> = {
  ai_chat: "#0ea5e9",
  schedule_create: "#10b981",
  task_complete: "#22c55e",
  photo_check: "#f59e0b",
};

const DEFAULT_ANALYSIS_MAX_TOKENS = 1024;

export type EffortPeriodPreset = "last30" | "currentQuarter" | "all";

export interface EffortFilters {
  period: EffortPeriodPreset;
  categories: EffortCategory[];
  scoreThreshold: number;
}

export interface FilteredEffortDay {
  date: string;
  totalCount: number;
  totalScore: number;
  filteredCount: number;
  filteredScore: number;
  categoryCounts: Record<EffortCategory, number>;
  categoryScores: Record<EffortCategory, number>;
  activities: EffortActivity[];
  intensity: 0 | 1 | 2 | 3 | 4;
  isBelowThreshold: boolean;
}

export interface CategoryContribution {
  category: EffortCategory;
  label: string;
  count: number;
  score: number;
  ratio: number;
}

export interface EffortAnalysisStats {
  totalCount: number;
  totalScore: number;
  activeDays: number;
  averageScorePerActiveDay: number;
  topCategory: EffortCategory | null;
  categoryContributions: CategoryContribution[];
  recentDensity: number;
  previousDensity: number;
  densityDelta: number;
}

interface ChatCompletionRequest {
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfQuarter(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function endOfQuarter(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth + 3, 0);
}

function isInPeriod(date: Date, start: Date, end: Date): boolean {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const min = new Date(start);
  min.setHours(0, 0, 0, 0);
  const max = new Date(end);
  max.setHours(0, 0, 0, 0);
  return target >= min && target <= max;
}

function resolvePeriodRange(
  preset: EffortPeriodPreset,
  summaries: EffortDailySummary[],
  today: Date,
): { start: Date; end: Date } {
  if (preset === "last30") {
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    return { start, end: today };
  }

  if (preset === "currentQuarter") {
    return { start: startOfQuarter(today), end: endOfQuarter(today) };
  }

  if (summaries.length === 0) {
    return { start: today, end: today };
  }

  const start = new Date(summaries[0].date);
  const end = new Date(summaries[summaries.length - 1].date);
  return { start, end };
}

function createEmptyCategoryRecord(): Record<EffortCategory, number> {
  return Object.fromEntries(EFFORT_CATEGORIES.map((category) => [category, 0])) as Record<
    EffortCategory,
    number
  >;
}

function scoreToIntensity(score: number, maxScore: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0 || maxScore <= 0) {
    return 0;
  }

  const ratio = score / maxScore;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function applyEffortFilters(
  summaries: EffortDailySummary[],
  filters: EffortFilters,
  today: Date = new Date(),
): FilteredEffortDay[] {
  const sortedSummaries = [...summaries].sort((a, b) => a.date.localeCompare(b.date));
  const range = resolvePeriodRange(filters.period, sortedSummaries, today);
  const allowedCategories = new Set(filters.categories);
  const periodSummaries = sortedSummaries.filter((summary) =>
    isInPeriod(new Date(summary.date), range.start, range.end),
  );

  const days = periodSummaries.map((summary) => {
    const categoryCounts = createEmptyCategoryRecord();
    const categoryScores = createEmptyCategoryRecord();
    const filteredActivities = summary.activities.filter((activity) =>
      allowedCategories.has(activity.type),
    );

    let filteredCount = 0;
    let filteredScore = 0;
    for (const activity of filteredActivities) {
      const score = activity.score ?? 1;
      filteredCount += 1;
      filteredScore += score;
      categoryCounts[activity.type] += 1;
      categoryScores[activity.type] += score;
    }

    return {
      date: summary.date,
      totalCount: summary.totalCount,
      totalScore: summary.totalScore,
      filteredCount,
      filteredScore,
      categoryCounts,
      categoryScores,
      activities: filteredActivities,
      intensity: 0,
      isBelowThreshold: filteredScore < filters.scoreThreshold,
    } satisfies Omit<FilteredEffortDay, "intensity"> & { intensity: 0 };
  });

  const maxScore = Math.max(0, ...days.map((day) => day.filteredScore));
  return days.map((day) => ({
    ...day,
    intensity: scoreToIntensity(day.filteredScore, maxScore),
  }));
}

export function analyzeEffortDays(days: FilteredEffortDay[]): EffortAnalysisStats {
  const totalCount = days.reduce((sum, day) => sum + day.filteredCount, 0);
  const totalScore = days.reduce((sum, day) => sum + day.filteredScore, 0);
  const activeDays = days.filter((day) => day.filteredCount > 0).length;

  const categoryScoreTotals = createEmptyCategoryRecord();
  const categoryCountTotals = createEmptyCategoryRecord();
  for (const day of days) {
    for (const category of EFFORT_CATEGORIES) {
      categoryScoreTotals[category] += day.categoryScores[category];
      categoryCountTotals[category] += day.categoryCounts[category];
    }
  }

  const contributions = EFFORT_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    count: categoryCountTotals[category],
    score: categoryScoreTotals[category],
    ratio: totalScore > 0 ? categoryScoreTotals[category] / totalScore : 0,
  }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const topCategory = contributions[0]?.category ?? null;

  const recentWindow = days.slice(-7);
  const previousWindow = days.slice(-14, -7);
  const recentDensity = average(recentWindow.map((day) => day.filteredScore));
  const previousDensity = average(previousWindow.map((day) => day.filteredScore));
  const densityDelta = recentDensity - previousDensity;

  return {
    totalCount,
    totalScore,
    activeDays,
    averageScorePerActiveDay: activeDays > 0 ? totalScore / activeDays : 0,
    topCategory,
    categoryContributions: contributions,
    recentDensity,
    previousDensity,
    densityDelta,
  };
}

export function buildEffortAdvicePrompt(
  stats: EffortAnalysisStats,
  days: FilteredEffortDay[],
  filters: EffortFilters,
): string {
  const latestDays = days.slice(-14);
  const sample = latestDays
    .map((day) => {
      const point = EFFORT_CATEGORIES.map(
        (category) => `${CATEGORY_LABELS[category]}:${day.categoryScores[category]}`,
      ).join(", ");
      return `${day.date} => score:${day.filteredScore}, count:${day.filteredCount}, ${point}`;
    })
    .join("\n");

  const selectedCategories = filters.categories
    .map((category) => CATEGORY_LABELS[category])
    .join(" / ");
  const topCategoryLabel = stats.topCategory ? CATEGORY_LABELS[stats.topCategory] : "なし";
  const trendLabel =
    stats.densityDelta > 0 ? "上昇傾向" : stats.densityDelta < 0 ? "下降傾向" : "横ばい";

  return [
    "あなたはGrass-Secretaryの分析秘書です。",
    "必ず日本語の「ずんだもん口調」で、短く前向きに、行動に繋がる助言を返してください。",
    "応答は120〜180文字目安、2文以内、絵文字は最大2個、ユーザーを責めないトーンで。",
    "毎応答に自然に1回以上「〜のだ/〜なのだ」を含めてください。",
    "",
    `フィルタ: period=${filters.period}, categories=${selectedCategories}, threshold=${filters.scoreThreshold}`,
    `総スコア=${stats.totalScore}, 総件数=${stats.totalCount}, アクティブ日数=${stats.activeDays}`,
    `直近密度=${stats.recentDensity.toFixed(2)}, 前期間密度=${stats.previousDensity.toFixed(2)}, 差分=${stats.densityDelta.toFixed(2)} (${trendLabel})`,
    `主要カテゴリ=${topCategoryLabel}`,
    "",
    "直近14日ログ:",
    sample || "(データなし)",
    "",
    "例: 最近、持ち物チェックが疎かになっていますね。明日は忘れずに実行しましょう！",
  ].join("\n");
}

export async function generateEffortAdvice(
  stats: EffortAnalysisStats,
  days: FilteredEffortDay[],
  filters: EffortFilters,
  options: { model?: SecretaryModelId } = {},
): Promise<string> {
  const { model = DEFAULT_SECRETARY_MODEL } = options;
  const prompt = buildEffortAdvicePrompt(stats, days, filters);
  const request = {
    model,
    temperature: 0.6,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "あなたは行動変容を促進するグラス・セクレタリーです。短く具体的で実行可能な助言を、ずんだもん口調で返します。",
      },
      { role: "user", content: prompt },
    ],
  };

  const response = await requestChatCompletionWithRetry(
    model,
    DEFAULT_ANALYSIS_MAX_TOKENS,
    (maxTokens) =>
      sakuraFetch<ChatCompletionResponse>("/chat/completions", {
        body: {
          ...request,
          max_tokens: maxTokens,
        } satisfies ChatCompletionRequest,
      }),
  );

  const advice = response.choices[0]?.message?.content?.trim();
  if (!advice) {
    throw new Error("AIアドバイスの生成結果が空でした。");
  }

  return formatSecretaryResponse(advice);
}

export function formatPeriodLabel(period: EffortPeriodPreset): string {
  if (period === "last30") return "直近30日";
  if (period === "currentQuarter") return "今期";
  return "全期間";
}

export function formatDateForTooltip(date: string): string {
  return new Date(date).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

export function formatPeriodDateRange(days: FilteredEffortDay[]): string {
  if (days.length === 0) return "データなし";
  return `${formatDateKey(new Date(days[0].date))} 〜 ${formatDateKey(new Date(days[days.length - 1].date))}`;
}
