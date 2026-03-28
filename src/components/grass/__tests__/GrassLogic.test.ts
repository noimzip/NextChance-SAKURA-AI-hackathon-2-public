import { describe, expect, it } from "vite-plus/test";
import type { EffortDailySummary, EffortCategory } from "@/types";
import {
  analyzeEffortDays,
  applyEffortFilters,
  buildEffortAdvicePrompt,
  type EffortFilters,
} from "@/lib/analysis-engine";
import { buildRuleBasedSuggestions } from "@/lib/nextPromptSuggestions";

const categories: EffortCategory[] = ["ai_chat", "schedule_create", "task_complete", "photo_check"];

function makeSummary(
  date: string,
  items: { type: EffortCategory; score: number; description?: string }[],
): EffortDailySummary {
  const empty = Object.fromEntries(categories.map((category) => [category, 0])) as Record<
    EffortCategory,
    number
  >;
  const activities = items.map((item, index) => ({
    id: `${date}-${index}`,
    type: item.type,
    description: item.description ?? `${item.type}-${index}`,
    timestamp: new Date(`${date}T12:00:00`),
    score: item.score,
  }));

  const categoryCounts = { ...empty };
  const categoryScores = { ...empty };
  for (const item of items) {
    categoryCounts[item.type] += 1;
    categoryScores[item.type] += item.score;
  }

  return {
    date,
    totalCount: items.length,
    totalScore: items.reduce((sum, item) => sum + item.score, 0),
    categoryCounts,
    categoryScores,
    activities,
  };
}

describe("analysis-engine", () => {
  const summaries: EffortDailySummary[] = [
    makeSummary("2025-12-20", [{ type: "schedule_create", score: 1 }]),
    makeSummary("2026-03-10", [
      { type: "photo_check", score: 1 },
      { type: "task_complete", score: 1 },
    ]),
    makeSummary("2026-03-20", [
      { type: "ai_chat", score: 1 },
      { type: "schedule_create", score: 1 },
      { type: "task_complete", score: 1 },
    ]),
  ];

  const baseFilters: EffortFilters = {
    period: "all",
    categories: [...categories],
    scoreThreshold: 0,
  };

  it("filters by period currentQuarter", () => {
    const days = applyEffortFilters(
      summaries,
      { ...baseFilters, period: "currentQuarter" },
      new Date("2026-03-21"),
    );
    expect(days.some((day) => day.date === "2025-12-20")).toBe(false);
    expect(days.some((day) => day.date === "2026-03-20")).toBe(true);
  });

  it("filters by selected categories", () => {
    const days = applyEffortFilters(
      summaries,
      { ...baseFilters, categories: ["task_complete"] },
      new Date("2026-03-21"),
    );
    const target = days.find((day) => day.date === "2026-03-20");
    expect(target?.filteredCount).toBe(1);
    expect(target?.filteredScore).toBe(1);
  });

  it("marks below-threshold days as dimmed", () => {
    const days = applyEffortFilters(
      summaries,
      { ...baseFilters, scoreThreshold: 3 },
      new Date("2026-03-21"),
    );
    const low = days.find((day) => day.date === "2025-12-20");
    const high = days.find((day) => day.date === "2026-03-20");
    expect(low?.isBelowThreshold).toBe(true);
    expect(high?.isBelowThreshold).toBe(false);
  });

  it("calculates intensity relative to max score", () => {
    const days = applyEffortFilters(summaries, baseFilters, new Date("2026-03-21"));
    const top = days.find((day) => day.date === "2026-03-20");
    const lower = days.find((day) => day.date === "2026-03-10");
    expect(top?.intensity).toBe(4);
    expect((lower?.intensity ?? 0) < (top?.intensity ?? 0)).toBe(true);
  });

  it("computes category contributions and trend stats", () => {
    const days = applyEffortFilters(summaries, baseFilters, new Date("2026-03-21"));
    const stats = analyzeEffortDays(days);
    expect(stats.totalScore).toBe(6);
    expect(stats.topCategory).toBe("schedule_create");
    expect(stats.categoryContributions[0]?.category).toBe("schedule_create");
  });

  it("builds advice prompt with zundamon guidance", () => {
    const days = applyEffortFilters(summaries, baseFilters, new Date("2026-03-21"));
    const stats = analyzeEffortDays(days);
    const prompt = buildEffortAdvicePrompt(stats, days, baseFilters);
    expect(prompt).toContain("ずんだもん口調");
    expect(prompt).toContain("直近14日ログ");
    expect(prompt).toContain("120〜180文字目安");
    expect(prompt).toContain("〜のだ");
  });

  it("builds 3 rule-based next prompt suggestions", () => {
    const suggestions = buildRuleBasedSuggestions({
      schedules: [
        {
          id: "task-1",
          title: "レポート提出",
          mode: "task",
          dueDate: "3月25日 23:59",
          isOverdue: false,
          completed: false,
          tags: [],
        },
      ],
      effortSummary: {
        currentStreak: 4,
        todayActivityCount: 1,
        recentActivityCount: 8,
        recentActiveDays: 5,
        topCategories: ["タスク完了"],
      },
      priorityHints: {
        hasUrgentItems: true,
        hasScheduleConflicts: false,
        items: [
          {
            title: "レポート提出",
            reason: "deadline_soon",
            dueDate: "3月25日 23:59",
            priority: 2,
          },
        ],
      },
    });

    expect(suggestions).toHaveLength(3);
    expect(new Set(suggestions).size).toBe(3);
  });
});
