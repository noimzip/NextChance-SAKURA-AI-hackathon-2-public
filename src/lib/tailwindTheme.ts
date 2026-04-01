import type { ChatMessage, SecretaryContext, TailwindThemeExtendOutput } from "@/types";

const TAILWIND_THEME_TRIGGER_REGEX = /^\s*\/gen-theme(?:\s|$)/i;
const JSON_OBJECT_PATTERN = /\{[\s\S]*\}/;
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const PADDING_VALUE_REGEX = /^\d+(?:\.\d+)?rem$/;

const REQUIRED_PADDING_KEYS = ["3", "4", "6", "8"] as const;

const DEFAULT_TAILWIND_EXTEND_OUTPUT: TailwindThemeExtendOutput = {
  colors: {
    layeredDarks: {
      base: "#0B1220",
      surface: "#111B2E",
      elevated: "#17233A",
    },
    background: "#0B1220",
    primary: "#3B82F6",
    primaryForeground: "#EAF2FF",
  },
  padding: {
    "3": "0.9rem",
    "4": "1.2rem",
    "6": "1.8rem",
    "8": "2.4rem",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHexColor(value: string): boolean {
  return HEX_COLOR_REGEX.test(value);
}

function ensureHexColor(value: unknown, path: string): string {
  const normalized = safeTrim(value);
  if (!isHexColor(normalized)) {
    throw new Error(`${path} must be a valid hex color (e.g. #0B1220)`);
  }
  return normalized;
}

function ensurePaddingRem(value: unknown, path: string): string {
  const normalized = safeTrim(value);
  if (!PADDING_VALUE_REGEX.test(normalized)) {
    throw new Error(`${path} must be a rem value string (e.g. 1.2rem)`);
  }
  return normalized;
}

function parseJsonCandidate(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Tailwind theme response is empty");
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
    throw new Error("Tailwind theme JSON block not found in response");
  }

  return JSON.parse(matched);
}

function normalizePadding(raw: unknown): TailwindThemeExtendOutput["padding"] {
  if (!isRecord(raw)) {
    throw new Error("padding must be an object");
  }

  const normalized = {} as TailwindThemeExtendOutput["padding"];
  for (const key of REQUIRED_PADDING_KEYS) {
    normalized[key] = ensurePaddingRem(raw[key], `padding.${key}`);
  }
  return normalized;
}

function normalizeTailwindThemeExtend(raw: unknown): TailwindThemeExtendOutput {
  if (!isRecord(raw)) {
    throw new Error("Tailwind theme payload must be an object");
  }

  const colorsRaw = raw.colors;
  if (!isRecord(colorsRaw)) {
    throw new Error("colors must be an object");
  }
  const layeredDarksRaw = colorsRaw.layeredDarks;
  if (!isRecord(layeredDarksRaw)) {
    throw new Error("colors.layeredDarks must be an object");
  }

  const colors: TailwindThemeExtendOutput["colors"] = {
    layeredDarks: {
      base: ensureHexColor(layeredDarksRaw.base, "colors.layeredDarks.base"),
      surface: ensureHexColor(layeredDarksRaw.surface, "colors.layeredDarks.surface"),
      elevated: ensureHexColor(layeredDarksRaw.elevated, "colors.layeredDarks.elevated"),
    },
    background: ensureHexColor(colorsRaw.background, "colors.background"),
    primary: ensureHexColor(colorsRaw.primary, "colors.primary"),
    primaryForeground: ensureHexColor(colorsRaw.primaryForeground, "colors.primaryForeground"),
  };
  const padding = normalizePadding(raw.padding);

  return {
    colors,
    padding,
  };
}

export function isTailwindThemeRequest(input: string): boolean {
  return TAILWIND_THEME_TRIGGER_REGEX.test(input);
}

export function stripTailwindThemeTrigger(input: string): string {
  return input.replace(TAILWIND_THEME_TRIGGER_REGEX, "").trim();
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

export function parseTailwindThemeInput(input: string): {
  userPreferences: string;
  currentNeed: string;
} {
  const normalized = stripTailwindThemeTrigger(input);
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

export function buildTailwindThemePrompt(input: {
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
    "あなたは Tailwind CSS テーマ設計の専門家です。",
    "ユーザーの趣向・要望を反映し、tailwind.config.js の theme.extend に直接流し込める JSON オブジェクトのみを生成してください。",
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
    "## 制約（厳守）",
    "- 背景は Layered Darks ベースの深い紺色（base/surface/elevated の3層）",
    "- primary は集中しやすい落ち着いた青",
    "- 読みやすさ向上のため padding を標準比 20% 拡大（padding専用トークンとして定義）",
    "- 出力は JSON オブジェクトのみ",
    "- キーは colors と padding のみ",
    "- colors は layeredDarks/background/primary/primaryForeground を含む",
    '- padding は "3","4","6","8" を rem 文字列で含む',
    "",
    "## 出力スキーマ",
    '{ "colors": { "layeredDarks": { "base": "#0B1220", "surface": "#111B2E", "elevated": "#17233A" }, "background": "#0B1220", "primary": "#3B82F6", "primaryForeground": "#EAF2FF" }, "padding": { "3": "0.9rem", "4": "1.2rem", "6": "1.8rem", "8": "2.4rem" } }',
  ].join("\n");
}

export function parseTailwindThemeResponse(content: string): TailwindThemeExtendOutput {
  const parsed = parseJsonCandidate(content);
  return normalizeTailwindThemeExtend(parsed);
}

export function getDefaultTailwindThemeExtendOutput(): TailwindThemeExtendOutput {
  return {
    colors: {
      layeredDarks: { ...DEFAULT_TAILWIND_EXTEND_OUTPUT.colors.layeredDarks },
      background: DEFAULT_TAILWIND_EXTEND_OUTPUT.colors.background,
      primary: DEFAULT_TAILWIND_EXTEND_OUTPUT.colors.primary,
      primaryForeground: DEFAULT_TAILWIND_EXTEND_OUTPUT.colors.primaryForeground,
    },
    padding: { ...DEFAULT_TAILWIND_EXTEND_OUTPUT.padding },
  };
}
