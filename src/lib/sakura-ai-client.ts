import { sakuraFetch } from "@/services/sakuraAI";
import type { SecretaryMultimodalModelId } from "@/lib/secretaryModels";
import type { ChatCompletionResponse } from "@/types";

export const TIMETREE_IMPORT_MODEL_ID: SecretaryMultimodalModelId =
  "preview/Qwen3-VL-30B-A3B-Instruct";

export interface TimeTreeScreenshotEvent {
  title: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  tag?: string;
  color?: string;
}

export interface TimeTreeScreenshotParseResult {
  year_month: string;
  events: TimeTreeScreenshotEvent[];
}

interface ChatContentPartText {
  type: "text";
  text: string;
}

interface ChatContentPartImage {
  type: "image_url";
  image_url: {
    url: string;
  };
}

interface TimeTreeChatCompletionRequest {
  model: string;
  messages: {
    role: "system" | "user";
    content: string | (ChatContentPartText | ChatContentPartImage)[];
  }[];
  temperature: number;
  max_tokens: number;
  stream: false;
}

const TIMETREE_SCREENSHOT_SYSTEM_PROMPT = `あなたは TimeTree の予定リスト画面スクリーンショットを解析し、Grass-Secretary へ移行するための構造化データを返す抽出エンジンです。

必ず次の順番で判断してください。
1. カレンダー文脈の特定:
   - 画像上部ヘッダーから対象の「年・月」を特定する。
2. 予定の抽出:
   - 日付セクションごとに予定タイトル、開始/終了時刻（読める場合）を抽出する。
3. タグの認識:
   - 画像上部のタグ一覧（例: 習い事、部活、コンテスト）を読み取り、候補として利用する。
4. タグ照合:
   - 各予定の左側にある色付き縦線・アイコンの色と、タグ一覧の色を照合し、予定タグを推定する。
5. 色の抽出:
   - 各予定色を CSS で利用可能な形式（#RRGGBB もしくは具体的な色名）で返す。
6. 出力形式:
   - 説明文は禁止。JSON オブジェクトのみ返す。
   - ルートは必ず year_month と events を持つ。

出力JSONスキーマ:
{
  "year_month": "YYYY-MM",
  "events": [
    {
      "title": "予定タイトル",
      "date": "YYYY-MM-DD または MM-DD または DD",
      "start_time": "HH:mm",
      "end_time": "HH:mm",
      "is_all_day": false,
      "tag": "タグ名",
      "color": "#RRGGBB または color name"
    }
  ]
}`;

const TIMETREE_SCREENSHOT_USER_PROMPT = `この画像を解析し、指定のJSON形式のみを返してください。判別できない項目は推測しすぎず、空文字ではなくキー自体を省略してください。`;

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.replaceAll("：", ":").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeYearMonth(value: unknown): string | null {
  const text = toNonEmptyString(value);
  if (!text) {
    return null;
  }
  const normalized = text.replaceAll("/", "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDateValue(value: unknown, yearMonth: string): string | null {
  const text = toNonEmptyString(value);
  if (!text) {
    return null;
  }
  const [yearText, monthText] = yearMonth.split("-");
  const baseYear = Number.parseInt(yearText, 10);
  const baseMonth = Number.parseInt(monthText, 10);
  if (!Number.isFinite(baseYear) || !Number.isFinite(baseMonth)) {
    return null;
  }

  const ymdMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    return toIsoDate(
      Number.parseInt(ymdMatch[1], 10),
      Number.parseInt(ymdMatch[2], 10),
      Number.parseInt(ymdMatch[3], 10),
    );
  }

  const mdMatch = text.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (mdMatch) {
    return toIsoDate(baseYear, Number.parseInt(mdMatch[1], 10), Number.parseInt(mdMatch[2], 10));
  }

  const jpMatch = text.match(/^(\d{1,2})月(\d{1,2})日$/);
  if (jpMatch) {
    return toIsoDate(baseYear, Number.parseInt(jpMatch[1], 10), Number.parseInt(jpMatch[2], 10));
  }

  const dayOnlyMatch = text.match(/^(\d{1,2})日?$/);
  if (dayOnlyMatch) {
    return toIsoDate(baseYear, baseMonth, Number.parseInt(dayOnlyMatch[1], 10));
  }

  return null;
}

function normalizeTimeValue(value: unknown): string | null {
  const text = toNonEmptyString(value);
  if (!text) {
    return null;
  }
  const normalized = text.replaceAll(".", ":").replaceAll("：", ":").trim();

  const hhmmMatch = normalized.match(/^(\d{1,2}):(\d{1,2})$/);
  if (hhmmMatch) {
    const hour = Number.parseInt(hhmmMatch[1], 10);
    const minute = Number.parseInt(hhmmMatch[2], 10);
    if (
      Number.isFinite(hour) &&
      Number.isFinite(minute) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const jpMatch = normalized.match(/^(\d{1,2})時(?:(\d{1,2})分?)?$/);
  if (jpMatch) {
    const hour = Number.parseInt(jpMatch[1], 10);
    const minute = jpMatch[2] ? Number.parseInt(jpMatch[2], 10) : 0;
    if (
      Number.isFinite(hour) &&
      Number.isFinite(minute) &&
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  return null;
}

function normalizeColorValue(value: unknown): string | null {
  const text = toNonEmptyString(value);
  if (!text) {
    return null;
  }
  if (/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(text)) {
    return text.toUpperCase();
  }
  return text.toLowerCase();
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "終日", "all-day", "allday"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "0"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function normalizeEvent(value: unknown, yearMonth: string): TimeTreeScreenshotEvent | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title =
    toNonEmptyString(record.title) ??
    toNonEmptyString(record.event_title) ??
    toNonEmptyString(record.name);
  if (!title) {
    return null;
  }

  const date = normalizeDateValue(record.date ?? record.day ?? record.section_date, yearMonth);
  const startTime = normalizeTimeValue(record.start_time ?? record.start ?? record.from);
  const endTime = normalizeTimeValue(record.end_time ?? record.end ?? record.to);
  const isAllDay = normalizeBoolean(record.is_all_day ?? record.all_day ?? record.isAllDay);
  const tag =
    toNonEmptyString(record.tag) ??
    toNonEmptyString(record.tag_name) ??
    toNonEmptyString(record.category);
  const color = normalizeColorValue(record.color ?? record.event_color ?? record.tag_color);

  const normalizedEvent: TimeTreeScreenshotEvent = { title };
  if (date) {
    normalizedEvent.date = date;
  }
  if (startTime) {
    normalizedEvent.start_time = startTime;
  }
  if (endTime) {
    normalizedEvent.end_time = endTime;
  }
  if (isAllDay !== null) {
    normalizedEvent.is_all_day = isAllDay;
  }
  if (tag) {
    normalizedEvent.tag = tag;
  }
  if (color) {
    normalizedEvent.color = color;
  }

  return normalizedEvent;
}

function parseAssistantJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates: string[] = [];

  if (trimmed.length > 0) {
    candidates.push(trimmed);
  }

  const fencedMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  const uniqueCandidates = [...new Set(candidates)];
  for (const candidate of uniqueCandidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error("TimeTree解析結果のJSONを解釈できませんでした。");
}

function normalizeTimeTreePayload(payload: unknown): TimeTreeScreenshotParseResult {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("TimeTree解析結果の形式が不正です。");
  }
  const record = payload as Record<string, unknown>;

  const yearMonth = normalizeYearMonth(record.year_month ?? record.yearMonth);
  if (!yearMonth) {
    throw new Error("year_month は YYYY-MM 形式で必要です。");
  }

  if (!Array.isArray(record.events)) {
    throw new Error("events は配列である必要があります。");
  }

  const events = record.events
    .map((event) => normalizeEvent(event, yearMonth))
    .filter((event): event is TimeTreeScreenshotEvent => event !== null);

  if (events.length === 0) {
    throw new Error("有効な予定を抽出できませんでした。");
  }

  return {
    year_month: yearMonth,
    events,
  };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("画像の読み込みに失敗しました。"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました。"));
    reader.readAsDataURL(file);
  });
}

export async function analyzeTimeTreeScreenshotDataUrl(
  imageDataUrl: string,
  options: { modelId?: SecretaryMultimodalModelId; signal?: AbortSignal } = {},
): Promise<TimeTreeScreenshotParseResult> {
  const response = await sakuraFetch<ChatCompletionResponse>("/chat/completions", {
    body: {
      model: options.modelId ?? TIMETREE_IMPORT_MODEL_ID,
      messages: [
        {
          role: "system",
          content: TIMETREE_SCREENSHOT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: TIMETREE_SCREENSHOT_USER_PROMPT,
            },
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1600,
      stream: false,
    } satisfies TimeTreeChatCompletionRequest,
    signal: options.signal,
  });

  const assistantContent = response.choices[0]?.message?.content;
  if (!assistantContent) {
    throw new Error("TimeTree解析結果が取得できませんでした。");
  }

  const payload = parseAssistantJson(assistantContent);
  return normalizeTimeTreePayload(payload);
}

export async function analyzeTimeTreeScreenshot(
  file: File,
  options: { modelId?: SecretaryMultimodalModelId; signal?: AbortSignal } = {},
): Promise<TimeTreeScreenshotParseResult> {
  const imageDataUrl = await fileToDataUrl(file);
  return analyzeTimeTreeScreenshotDataUrl(imageDataUrl, options);
}

export const __internal__ = {
  normalizeYearMonth,
  normalizeDateValue,
  normalizeTimeValue,
  normalizeColorValue,
  parseAssistantJson,
  normalizeTimeTreePayload,
};
