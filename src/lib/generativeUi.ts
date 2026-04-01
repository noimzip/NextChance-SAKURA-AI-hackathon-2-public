import type {
  ChatMessage,
  GenerativeUIComponentPriority,
  GenerativeUIComponentType,
  GenerativeUIOutput,
  GenerativeUIThemeMode,
  SecretaryContext,
} from "@/types";

const GENERATIVE_UI_TRIGGER_REGEX = /^\s*\/gen-ui(?:\s|$)/i;

const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/;

const ALLOWED_COMPONENT_TYPES = new Set<GenerativeUIComponentType>([
  "Card",
  "List",
  "Calendar",
  "Chart",
  "Button",
]);

const ALLOWED_PRIORITIES = new Set<GenerativeUIComponentPriority>(["high", "medium", "low"]);

const ALLOWED_LAYOUTS = new Set<GenerativeUIOutput["layout"]>(["grid", "stack"]);

const ALLOWED_THEME_MODES = new Set<GenerativeUIThemeMode>(["dark", "light"]);

const DEFAULT_PRIMARY_COLOR = "Future Dust";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonCandidate(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Generative UI response is empty");
  }

  const direct = (() => {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  })();
  if (direct !== null) {
    return direct;
  }

  const matched = trimmed.match(JSON_OBJECT_PATTERN)?.[0];
  if (!matched) {
    throw new Error("Generative UI JSON block not found in response");
  }

  return JSON.parse(matched);
}

function normalizeGenerativeUiOutput(raw: unknown): GenerativeUIOutput {
  if (!isRecord(raw)) {
    throw new Error("Generative UI payload must be an object");
  }

  const layout = safeTrim(raw.layout);
  if (!ALLOWED_LAYOUTS.has(layout as GenerativeUIOutput["layout"])) {
    throw new Error("Generative UI layout must be 'grid' or 'stack'");
  }

  const themeRaw = raw.theme;
  if (!isRecord(themeRaw)) {
    throw new Error("Generative UI theme must be an object");
  }
  const mode = safeTrim(themeRaw.mode);
  if (!ALLOWED_THEME_MODES.has(mode as GenerativeUIThemeMode)) {
    throw new Error("Generative UI theme.mode must be 'dark' or 'light'");
  }

  const primaryColor = safeTrim(themeRaw.primaryColor) || DEFAULT_PRIMARY_COLOR;

  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    throw new Error("Generative UI components must be a non-empty array");
  }

  const components = raw.components.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Generative UI components[${index}] must be an object`);
    }
    const type = safeTrim(entry.type);
    if (!ALLOWED_COMPONENT_TYPES.has(type as GenerativeUIComponentType)) {
      throw new Error(
        `Generative UI components[${index}].type must be one of ${[...ALLOWED_COMPONENT_TYPES].join(", ")}`,
      );
    }
    const priority = safeTrim(entry.priority);
    if (!ALLOWED_PRIORITIES.has(priority as GenerativeUIComponentPriority)) {
      throw new Error("Generative UI component priority must be high/medium/low");
    }
    if (!isRecord(entry.props)) {
      throw new Error(`Generative UI components[${index}].props must be an object`);
    }

    return {
      type: type as GenerativeUIComponentType,
      props: entry.props,
      priority: priority as GenerativeUIComponentPriority,
    };
  });

  return {
    layout: layout as GenerativeUIOutput["layout"],
    theme: {
      mode: mode as GenerativeUIThemeMode,
      primaryColor,
    },
    components,
  };
}

export function isGenerativeUiRequest(input: string): boolean {
  return GENERATIVE_UI_TRIGGER_REGEX.test(input);
}

export function stripGenerativeUiTrigger(input: string): string {
  return input.replace(GENERATIVE_UI_TRIGGER_REGEX, "").trim();
}

function extractLabeledValue(
  input: string,
  labels: readonly string[],
): { value: string; matchedLineIndexes: number[] } {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const matchedLineIndexes: number[] = [];
  const values: string[] = [];
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`^(?:${escapedLabels.join("|")})\\s*[:：]\\s*(.+)$`, "i");

  lines.forEach((line, index) => {
    const matched = line.match(pattern);
    if (!matched) return;
    const value = matched[1]?.trim();
    if (!value) return;
    matchedLineIndexes.push(index);
    values.push(value);
  });

  return {
    value: values.join(" / "),
    matchedLineIndexes,
  };
}

export function parseGenerativeUiInput(input: string): {
  userPreferences: string;
  currentNeed: string;
} {
  const normalized = stripGenerativeUiTrigger(input);
  const source = normalized || input.trim();
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const preference = extractLabeledValue(source, [
    "ユーザーの趣向",
    "趣向",
    "好み",
    "preferences",
    "preference",
  ]);
  const need = extractLabeledValue(source, [
    "現在の課題/要望",
    "現在の課題",
    "現在の要望",
    "課題",
    "要望",
    "ニーズ",
    "need",
    "task",
  ]);

  const consumedIndexes = new Set<number>([
    ...preference.matchedLineIndexes,
    ...need.matchedLineIndexes,
  ]);
  const unlabeled = lines
    .filter((_, index) => !consumedIndexes.has(index))
    .join(" ")
    .trim();

  return {
    userPreferences: preference.value,
    currentNeed: need.value || unlabeled || source || "未指定",
  };
}

function buildPreferenceSummary(rawPreferences: string): string {
  const trimmed = rawPreferences.trim();
  return trimmed.length > 0 ? trimmed : "特になし";
}

function buildCurrentNeedSummary(rawNeed: string): string {
  const trimmed = rawNeed.trim();
  return trimmed.length > 0 ? trimmed : "未指定";
}

function serializeChatHistoryForPrompt(messages: ChatMessage[]): string {
  const historyLines = messages
    .slice(-10)
    .map((message, index) => `${index + 1}. [${message.role}] ${message.content.trim()}`)
    .filter((line) => line.length > 0);
  return historyLines.length > 0 ? historyLines.join("\n") : "履歴なし";
}

function serializeCurrentContextForPrompt(context: SecretaryContext): string {
  const scheduleSummary =
    context.schedules.length > 0
      ? context.schedules
          .slice(0, 8)
          .map(
            (schedule, index) =>
              `${index + 1}. ${schedule.title} (${schedule.mode}) / ${schedule.dueDate}${schedule.endDate ? `〜${schedule.endDate}` : ""} / 完了:${schedule.completed ? "はい" : "いいえ"}`,
          )
          .join("\n")
      : "予定なし";

  return [
    `日時: ${context.currentDate}`,
    `今後件数: ${context.upcomingCount}`,
    `期限超過件数: ${context.overdueCount}`,
    `本日完了件数: ${context.completedTodayCount}`,
    `優先ヒント件数: ${context.priorityHints.items.length}`,
    `予定サマリー:\n${scheduleSummary}`,
  ].join("\n");
}

export function buildGenerativeUiPrompt(input: {
  userPreferences: string;
  currentNeed: string;
  messages: ChatMessage[];
  context: SecretaryContext;
}): string {
  const userPreferences = buildPreferenceSummary(input.userPreferences);
  const currentNeed = buildCurrentNeedSummary(input.currentNeed);
  const history = serializeChatHistoryForPrompt(input.messages);
  const currentContext = serializeCurrentContextForPrompt(input.context);

  return [
    "あなたは高度な Generative UI アーキテクトです。",
    "ユーザーの趣向、現在の要望、チャット履歴、現在文脈を分析し、最適なUI構成を決定してください。",
    "",
    "## タスク",
    "1. ユーザーの現在の真の意図を推定する",
    "2. 利用可能コンポーネント（Card, List, Calendar, Chart, Button）から最適構成を選ぶ",
    "3. 趣向を反映した Design Tokens を割り当てる",
    "",
    "## ユーザー趣向",
    userPreferences,
    "",
    "## 現在の課題/要望",
    currentNeed,
    "",
    "## チャット履歴",
    history,
    "",
    "## 現在文脈",
    currentContext,
    "",
    "## 出力ルール",
    "- 先頭に必ずJSONオブジェクトを出力する",
    "- JSONは以下スキーマに厳密準拠する",
    "- JSONの後に補足テキストを追加してよい",
    "- layout は grid または stack",
    "- theme.mode は dark または light",
    '- theme.primaryColor はユーザー趣向に応じて可変（未指定時は "Future Dust"）',
    "- components.type は Card/List/Calendar/Chart/Button のみ",
    "- components.priority は high/medium/low のみ",
    "- components.props は必ずオブジェクト",
    "",
    "## スキーマ",
    '{ "layout": "grid | stack", "theme": { "mode": "dark | light", "primaryColor": "Future Dust" }, "components": [ { "type": "Calendar", "props": { "density": "compact", "view": "day" }, "priority": "high" } ] }',
  ].join("\n");
}

export function parseGenerativeUiResponse(content: string): GenerativeUIOutput {
  const parsed = parseJsonCandidate(content);
  return normalizeGenerativeUiOutput(parsed);
}
