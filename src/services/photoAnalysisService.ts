import { sakuraFetch } from "./sakuraAI";
import { compareBelongings, parseItemsTextToList } from "@/lib/belongings";
import type { SecretaryMultimodalModelId } from "@/lib/secretaryModels";
import type {
  BelongingsCheckMode,
  BelongingsComparisonPolicy,
  BelongingsItemSuggestion,
  ChatCompletionResponse,
  DetectedItem,
  PhotoCheckResult,
} from "@/types";

export const PHOTO_CHECKER_MODEL_ID: SecretaryMultimodalModelId =
  "preview/Qwen3-VL-30B-A3B-Instruct";
export const LATEST_PHOTO_CHECK_RESULT_STORAGE_KEY = "grass-secretary-latest-photo-check-result";
export const PHOTO_CHECK_HISTORY_STORAGE_KEY = "grass-secretary-photo-check-history";
export const PHOTO_CHECK_HISTORY_LIMIT = 20;
const PHOTO_CHECK_HISTORY_IMAGE_PRESERVE_LIMIT = 3;
const STORAGE_IMAGE_MAX_EDGE = 960;
const STORAGE_IMAGE_QUALITY = 0.72;
const STORAGE_IMAGE_TARGET_MAX_LENGTH = 380_000;

const PHOTO_ANALYSIS_SYSTEM_PROMPT = `あなたは忘れ物チェッカーの画像解析アシスタントです。
ユーザーがアップロードした画像を確認し、持ち物として認識できるものと、忘れ物候補を推定してください。
必ずJSONのみを返し、説明文は一切出力しないでください。`;

const PHOTO_ANALYSIS_USER_PROMPT = `次のJSON形式で返答してください。
{
  "detectedItems": [
    { "name": "項目名", "confidence": 0.0-1.0 }
  ],
  "missingItems": ["忘れ物候補1", "忘れ物候補2"]
}

ルール:
- confidence は 0 から 1 の数値
- 画像から確認できる項目は detectedItems に入れる
- 忘れ物候補は missingItems に入れる
- 不明な場合は空配列でもよい`;

const PHOTO_ANALYSIS_USER_PROMPT_WITH_EXPECTED = `次のJSON形式で返答してください。
{
  "detectedItems": [
    { "name": "項目名", "confidence": 0.0-1.0 }
  ],
  "matchedItems": ["期待持ち物のうち画像で確認できたもの"],
  "missingItems": ["期待持ち物のうち確認できなかったもの"],
  "extraItems": ["画像にはあるが期待リストにないもの"]
}

ルール:
- confidence は 0 から 1 の数値
- 必ずJSONのみ
- matchedItems / missingItems / extraItems は配列
- 不明な場合は空配列でもよい`;

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

interface PhotoAnalysisChatCompletionRequest {
  model: string;
  messages: {
    role: "system" | "user";
    content: string | (ChatContentPartText | ChatContentPartImage)[];
  }[];
  temperature: number;
  max_tokens: number;
  stream: false;
}

function clampConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1 ? clampConfidence(value / 100) : clampConfidence(value);
  }

  if (typeof value === "string") {
    const numeric = Number.parseFloat(value.replace("%", ""));
    if (Number.isFinite(numeric)) {
      return numeric > 1 ? clampConfidence(numeric / 100) : clampConfidence(numeric);
    }
  }

  return 0.5;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDetectedItems(value: unknown): DetectedItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        const name = toNonEmptyString(entry);
        if (!name) return null;
        return { name, confidence: 0.5 };
      }

      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const name =
        toNonEmptyString(record.name) ??
        toNonEmptyString(record.item) ??
        toNonEmptyString(record.label);
      if (!name) return null;

      const confidence = normalizeConfidence(record.confidence ?? record.score);
      return { name, confidence };
    })
    .filter((item): item is DetectedItem => item !== null);
}

function toMissingItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const missing = value
    .map((item) => toNonEmptyString(item))
    .filter((item): item is string => item !== null);

  return [...new Set(missing)];
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.map((item) => toNonEmptyString(item)).filter((item): item is string => item !== null),
    ),
  ];
}

function parseAssistantJson(content: string): unknown {
  const candidates: string[] = [];
  const trimmed = content.trim();
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
      // try next candidate
    }
  }

  throw new Error("画像解析結果の形式が不正です。");
}

function normalizePhotoAnalysisPayload(payload: unknown): {
  detectedItems: DetectedItem[];
  missingItems: string[];
  matchedItems: string[];
  extraItems: string[];
} {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("画像解析結果の形式が不正です。");
  }

  const record = payload as Record<string, unknown>;
  const detectedItems = toDetectedItems(record.detectedItems ?? record.detected_items);
  const missingItems = toMissingItems(record.missingItems ?? record.missing_items);
  const matchedItems = toStringList(record.matchedItems ?? record.matched_items);
  const extraItems = toStringList(record.extraItems ?? record.extra_items);

  if (
    detectedItems.length === 0 &&
    missingItems.length === 0 &&
    matchedItems.length === 0 &&
    extraItems.length === 0
  ) {
    throw new Error("画像解析結果を解釈できませんでした。");
  }

  return { detectedItems, missingItems, matchedItems, extraItems };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("画像データの読み込みに失敗しました。"));
        return;
      }
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(new Error("画像データの読み込みに失敗しました。"));
    };

    reader.readAsDataURL(file);
  });
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeoutId = setTimeout(() => {
      reject(new Error("画像読み込みがタイムアウトしました。"));
    }, 800);

    image.onload = () => {
      clearTimeout(timeoutId);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error("画像のデコードに失敗しました。"));
    };
    image.src = src;
  });
}

interface CompressImageForStorageOptions {
  maxEdge?: number;
  quality?: number;
  targetMaxLength?: number;
}

export async function compressImageDataUrlForStorage(
  dataUrl: string,
  options: CompressImageForStorageOptions = {},
): Promise<string> {
  if (typeof document === "undefined") {
    return dataUrl;
  }

  try {
    const image = await loadImageElement(dataUrl);
    const maxEdgeLimit = options.maxEdge ?? STORAGE_IMAGE_MAX_EDGE;
    const initialQuality = options.quality ?? STORAGE_IMAGE_QUALITY;
    const targetMaxLength = options.targetMaxLength ?? STORAGE_IMAGE_TARGET_MAX_LENGTH;

    const maxEdge = Math.max(image.width, image.height);
    const scale = maxEdge > maxEdgeLimit ? maxEdgeLimit / maxEdge : 1;
    let width = Math.max(1, Math.round(image.width * scale));
    let height = Math.max(1, Math.round(image.height * scale));
    let quality = initialQuality;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return dataUrl;
    }

    let best = dataUrl;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const candidate = canvas.toDataURL("image/jpeg", quality);
      if (candidate.length > 0 && candidate.length < best.length) {
        best = candidate;
      }
      if (best.length <= targetMaxLength) {
        break;
      }

      quality = Math.max(0.45, quality - 0.08);
      width = Math.max(1, Math.round(width * 0.85));
      height = Math.max(1, Math.round(height * 0.85));
    }

    return best;
  } catch {
    return dataUrl;
  }
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

function toSerializableResult(
  result: PhotoCheckResult,
  options: { includeImage?: boolean },
): Omit<PhotoCheckResult, "timestamp"> & { timestamp: string } {
  return {
    ...result,
    imageUrl: options.includeImage ? result.imageUrl : "",
    timestamp: result.timestamp.toISOString(),
  };
}

function persistPhotoCheckHistory(
  entries: Array<Omit<PhotoCheckResult, "timestamp"> & { timestamp: string }>,
): void {
  let currentEntries = entries;
  while (currentEntries.length > 0) {
    try {
      window.localStorage.setItem(PHOTO_CHECK_HISTORY_STORAGE_KEY, JSON.stringify(currentEntries));
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        console.warn("Failed to save photo check history:", error);
        return;
      }
      currentEntries = currentEntries.slice(0, currentEntries.length - 1);
    }
  }

  try {
    window.localStorage.removeItem(PHOTO_CHECK_HISTORY_STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear photo check history after quota error:", error);
  }
}

export async function analyzePhotoWithQwenModel(
  file: File,
  options: {
    previewUrl?: string;
    signal?: AbortSignal;
    expectedItems?: string[];
    comparisonPolicy?: BelongingsComparisonPolicy;
    checkMode?: BelongingsCheckMode;
    targetScheduleIds?: string[];
    targetScheduleTitles?: string[];
    suggestedItems?: BelongingsItemSuggestion[];
    appliedSuggestedItems?: string[];
    modelId?: SecretaryMultimodalModelId;
  } = {},
): Promise<PhotoCheckResult> {
  const imageDataUrl = await fileToDataUrl(file);
  const storageImageDataUrl = await compressImageDataUrlForStorage(imageDataUrl);
  const expectedItems = parseItemsTextToList((options.expectedItems ?? []).join("\n"));
  const comparisonPolicy = options.comparisonPolicy ?? "normal";
  const hasExpectedItems = expectedItems.length > 0;
  const expectedItemsPrompt = hasExpectedItems
    ? `照合対象の持ち物リスト:
${expectedItems.map((item) => `- ${item}`).join("\n")}

上記の持ち物と画像を比較し、matchedItems / missingItems / extraItems を推定してください。`
    : "";

  const response = await sakuraFetch<ChatCompletionResponse>("/chat/completions", {
    body: {
      model: options.modelId ?? PHOTO_CHECKER_MODEL_ID,
      messages: [
        {
          role: "system",
          content: PHOTO_ANALYSIS_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: hasExpectedItems
                ? `${PHOTO_ANALYSIS_USER_PROMPT_WITH_EXPECTED}\n\n${expectedItemsPrompt}`
                : PHOTO_ANALYSIS_USER_PROMPT,
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 512,
      stream: false,
    } satisfies PhotoAnalysisChatCompletionRequest,
    signal: options.signal,
  });

  const assistantContent = response.choices[0]?.message?.content;
  if (!assistantContent) {
    throw new Error("画像解析結果を取得できませんでした。");
  }

  const parsed = parseAssistantJson(assistantContent);
  const normalized = normalizePhotoAnalysisPayload(parsed);
  const detectedItemNames = normalized.detectedItems.map((item) => item.name);

  const comparisonFromExpected = hasExpectedItems
    ? compareBelongings(expectedItems, detectedItemNames, comparisonPolicy)
    : null;
  const fallbackComparison = compareBelongings(
    hasExpectedItems ? expectedItems : normalized.missingItems,
    detectedItemNames,
    comparisonPolicy,
  );

  const matchedItems = comparisonFromExpected
    ? comparisonFromExpected.matched
    : normalized.matchedItems;
  const missingItems = comparisonFromExpected
    ? comparisonFromExpected.missing
    : normalized.missingItems.length > 0
      ? normalized.missingItems
      : fallbackComparison.missing;
  const extraItems = comparisonFromExpected
    ? comparisonFromExpected.extra
    : normalized.extraItems.length > 0
      ? normalized.extraItems
      : fallbackComparison.extra;

  return {
    id: `check-${Date.now()}`,
    imageUrl: storageImageDataUrl,
    detectedItems: normalized.detectedItems,
    missingItems,
    expectedItems: hasExpectedItems ? expectedItems : undefined,
    matchedItems,
    extraItems,
    comparisonPolicy,
    checkMode: options.checkMode,
    targetScheduleIds: options.targetScheduleIds,
    targetScheduleTitles: options.targetScheduleTitles,
    suggestedItems: options.suggestedItems,
    appliedSuggestedItems: options.appliedSuggestedItems,
    timestamp: new Date(),
  };
}

export function saveLatestPhotoCheckResult(result: PhotoCheckResult): void {
  if (typeof window === "undefined") return;
  const serializable = toSerializableResult(result, { includeImage: false });
  try {
    window.localStorage.setItem(
      LATEST_PHOTO_CHECK_RESULT_STORAGE_KEY,
      JSON.stringify(serializable),
    );
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      console.warn("Failed to save latest photo check result:", error);
      return;
    }
    try {
      window.localStorage.removeItem(LATEST_PHOTO_CHECK_RESULT_STORAGE_KEY);
    } catch (removeError) {
      console.warn("Failed to clear latest photo check result after quota error:", removeError);
    }
  }
}

export function loadPhotoCheckHistory(): PhotoCheckResult[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(PHOTO_CHECK_HISTORY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Array<
      Omit<PhotoCheckResult, "timestamp"> & { timestamp: string }
    >;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      ...item,
      timestamp: new Date(item.timestamp),
    }));
  } catch {
    return [];
  }
}

export function savePhotoCheckHistoryEntry(result: PhotoCheckResult): void {
  if (typeof window === "undefined") return;
  const nextEntry = toSerializableResult(result, { includeImage: true });
  const current = loadPhotoCheckHistory().map((item) => ({
    ...toSerializableResult(item, { includeImage: true }),
    imageUrl: item.imageUrl,
  }));
  const nextHistory = [nextEntry, ...current].slice(0, PHOTO_CHECK_HISTORY_LIMIT);
  const compactHistory = nextHistory.map((entry, index) =>
    index < PHOTO_CHECK_HISTORY_IMAGE_PRESERVE_LIMIT ? entry : { ...entry, imageUrl: "" },
  );
  persistPhotoCheckHistory(compactHistory);
}

export function loadLatestPhotoCheckResult(): PhotoCheckResult | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LATEST_PHOTO_CHECK_RESULT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Omit<PhotoCheckResult, "timestamp"> & { timestamp: string };
    return {
      ...parsed,
      timestamp: new Date(parsed.timestamp),
    };
  } catch {
    return null;
  }
}
