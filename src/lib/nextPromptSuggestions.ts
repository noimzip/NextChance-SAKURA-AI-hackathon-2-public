import { sakuraFetch } from "@/services/sakuraAI";
import { requestChatCompletionWithRetry } from "@/lib/chatCompletion";
import type {
  ChatCompletionResponse,
  ChatMessage,
  SecretaryEffortSummary,
  SecretaryPriorityHints,
  SecretaryPriorityItem,
  SecretaryScheduleContext,
} from "@/types";

export interface SuggestionContext {
  latestAssistantMessage: ChatMessage;
  latestUserMessage?: ChatMessage;
  schedules: SecretaryScheduleContext[];
  effortSummary: SecretaryEffortSummary;
  priorityHints: SecretaryPriorityHints;
  model: string;
}

interface RuleBasedInput {
  schedules: SecretaryScheduleContext[];
  effortSummary: SecretaryEffortSummary;
  priorityHints: SecretaryPriorityHints;
}

const TARGET_SUGGESTION_COUNT = 3;
const FALLBACK_SUGGESTIONS = [
  "今日やることを優先順で3つに絞って",
  "次に着手すべきタスクを1つだけ提案して",
  "今の予定に合わせた5分の準備を教えて",
];

function buildPrioritySuggestion(item: SecretaryPriorityItem): string {
  if (item.reason === "overdue") {
    return `「${item.title}」を今日中に終える段取りを5分で作って`;
  }
  if (item.reason === "deadline_soon") {
    return `「${item.title}」の締切までに終わる作業順を提案して`;
  }
  if (item.reason === "schedule_conflict") {
    return `「${item.title}」の重複を避ける調整案を出して`;
  }
  return `「${item.title}」に向けた今日の準備を短く教えて`;
}

export function buildRuleBasedSuggestions(input: RuleBasedInput): string[] {
  const suggestions: string[] = [];
  const activeSchedules = input.schedules.filter((schedule) => !schedule.completed);
  const overdueTask = activeSchedules.find(
    (schedule) => schedule.mode === "task" && schedule.isOverdue,
  );
  const upcomingTask = activeSchedules.filter(
    (schedule) => schedule.mode === "task" && !schedule.isOverdue,
  )[0];
  const upcomingSchedule = activeSchedules.filter((schedule) => schedule.mode === "schedule")[0];

  const urgentPriority = input.priorityHints.items[0];
  if (urgentPriority) {
    suggestions.push(buildPrioritySuggestion(urgentPriority));
  }

  if (overdueTask) {
    suggestions.push(`「${overdueTask.title}」を今から着手する最短ステップを教えて`);
  }

  if (upcomingTask) {
    suggestions.push(`「${upcomingTask.title}」を期限までに終える時間割を作って`);
  }

  if (input.priorityHints.hasScheduleConflicts) {
    suggestions.push("重複している予定の優先順位と調整案を表でまとめて");
  }

  if (upcomingSchedule) {
    suggestions.push(`「${upcomingSchedule.title}」の持ち物と準備チェックリストを作って`);
  }

  if (input.effortSummary.todayActivityCount > 0) {
    suggestions.push("今日の頑張りを踏まえて、残り時間のおすすめ行動を教えて");
  } else {
    suggestions.push("今日の芝を育てるために最初の1タスクを提案して");
  }

  if (input.effortSummary.currentStreak >= 3) {
    suggestions.push("連続記録を維持するために、夜の締めタスクを提案して");
  }

  const uniqueSuggestions: string[] = [];
  const seen = new Set<string>();

  for (const suggestion of suggestions) {
    const trimmed = suggestion.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    uniqueSuggestions.push(trimmed);
  }

  return uniqueSuggestions.slice(0, TARGET_SUGGESTION_COUNT);
}

function normalizeAiSuggestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, TARGET_SUGGESTION_COUNT);
}

async function buildAiSuggestions(context: SuggestionContext): Promise<string[]> {
  const request = {
    model: context.model,
    messages: [
      {
        role: "system",
        content:
          "あなたはユーザーの次の行動を促す秘書です。次に送るべき短い日本語プロンプトを3件、箇条書きで出力してください。",
      },
      {
        role: "user",
        content: [
          `直前のユーザー入力: ${context.latestUserMessage?.content ?? "なし"}`,
          `直前のAI応答: ${context.latestAssistantMessage.content}`,
          `未完了件数: ${context.schedules.filter((schedule) => !schedule.completed).length}`,
          `期限超過件数: ${context.schedules.filter((schedule) => schedule.mode === "task" && schedule.isOverdue).length}`,
          `継続日数: ${context.effortSummary.currentStreak}`,
        ].join("\n"),
      },
    ],
    temperature: 0.4,
    stream: false,
  };

  const response = await requestChatCompletionWithRetry(context.model, 256, (maxTokens) =>
    sakuraFetch<ChatCompletionResponse>("/chat/completions", {
      body: {
        ...request,
        max_tokens: maxTokens,
      } as const,
    }),
  );
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI suggestion API response empty");
  }

  return normalizeAiSuggestions(content);
}

export async function generateNextPromptSuggestions(context: SuggestionContext): Promise<string[]> {
  const ruleBasedSuggestions = buildRuleBasedSuggestions({
    schedules: context.schedules,
    effortSummary: context.effortSummary,
    priorityHints: context.priorityHints,
  });
  if (ruleBasedSuggestions.length >= TARGET_SUGGESTION_COUNT) {
    return ruleBasedSuggestions;
  }

  try {
    const aiSuggestions = await buildAiSuggestions(context);
    const merged = [...ruleBasedSuggestions, ...aiSuggestions];
    const uniqueMerged: string[] = [];
    const seen = new Set<string>();

    for (const suggestion of merged) {
      const trimmed = suggestion.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      uniqueMerged.push(trimmed);
      if (uniqueMerged.length >= TARGET_SUGGESTION_COUNT) break;
    }

    if (uniqueMerged.length >= TARGET_SUGGESTION_COUNT) {
      return uniqueMerged.slice(0, TARGET_SUGGESTION_COUNT);
    }

    for (const fallback of FALLBACK_SUGGESTIONS) {
      if (seen.has(fallback)) continue;
      uniqueMerged.push(fallback);
      if (uniqueMerged.length >= TARGET_SUGGESTION_COUNT) break;
    }

    return uniqueMerged.slice(0, TARGET_SUGGESTION_COUNT);
  } catch {
    if (ruleBasedSuggestions.length >= TARGET_SUGGESTION_COUNT) {
      return ruleBasedSuggestions;
    }
    const filled = [...ruleBasedSuggestions];
    for (const fallback of FALLBACK_SUGGESTIONS) {
      if (filled.includes(fallback)) continue;
      filled.push(fallback);
      if (filled.length >= TARGET_SUGGESTION_COUNT) break;
    }
    return filled.slice(0, TARGET_SUGGESTION_COUNT);
  }
}
