export const SECRETARY_MODEL_STORAGE_KEY = "grass-secretary-selected-model";

export const SECRETARY_MULTIMODAL_MODEL_IDS = [
  "preview/Qwen3-VL-30B-A3B-Instruct",
  "preview/Kimi-K2.5",
  "preview/Phi-4-multimodal-instruct",
] as const;

export type SecretaryMultimodalModelId = (typeof SECRETARY_MULTIMODAL_MODEL_IDS)[number];
export const DEFAULT_SECRETARY_MULTIMODAL_MODEL: SecretaryMultimodalModelId =
  SECRETARY_MULTIMODAL_MODEL_IDS[0];

export const SECRETARY_MODEL_OPTIONS = [
  { id: "gpt-oss-120b", label: "gpt-oss-120b", defaultMaxOutputTokens: 2048 },
  {
    id: "llm-jp-3.1-8x13b-instruct4",
    label: "llm-jp-3.1-8x13b-instruct4",
    defaultMaxOutputTokens: 1024,
  },
  {
    id: "Qwen3-Coder-480B-A35B-Instruct-FP8",
    label: "Qwen3-Coder-480B-A35B-Instruct-FP8",
    defaultMaxOutputTokens: 2048,
  },
  {
    id: "Qwen3-Coder-30B-A3B-Instruct",
    label: "Qwen3-Coder-30B-A3B-Instruct",
    defaultMaxOutputTokens: 2048,
  },
  {
    id: "preview/Qwen3-VL-30B-A3B-Instruct",
    label: "preview/Qwen3-VL-30B-A3B-Instruct",
    defaultMaxOutputTokens: 4096,
  },
  {
    id: "preview/Kimi-K2.5",
    label: "preview/Kimi-K2.5",
    defaultMaxOutputTokens: 4096,
  },
  {
    id: "preview/Phi-4-multimodal-instruct",
    label: "preview/Phi-4-multimodal-instruct",
    defaultMaxOutputTokens: 4096,
  },
] as const;

export type SecretaryModelId = (typeof SECRETARY_MODEL_OPTIONS)[number]["id"];

export const DEFAULT_SECRETARY_MODEL: SecretaryModelId = SECRETARY_MODEL_OPTIONS[0].id;

const DEFAULT_SECRETARY_MODEL_OPTION = SECRETARY_MODEL_OPTIONS[0];

export const DEFAULT_SECRETARY_MAX_OUTPUT_TOKENS =
  DEFAULT_SECRETARY_MODEL_OPTION.defaultMaxOutputTokens;

const SECRETARY_MODEL_ID_SET = new Set<string>(SECRETARY_MODEL_OPTIONS.map((option) => option.id));
const SECRETARY_MODEL_CONFIG_MAP = new Map<string, (typeof SECRETARY_MODEL_OPTIONS)[number]>(
  SECRETARY_MODEL_OPTIONS.map((option) => [option.id, option]),
);
const SECRETARY_MULTIMODAL_MODEL_ID_SET = new Set<string>(SECRETARY_MULTIMODAL_MODEL_IDS);

export function isSecretaryModelId(value: string): value is SecretaryModelId {
  return SECRETARY_MODEL_ID_SET.has(value);
}

export function isSecretaryMultimodalModelId(value: string): value is SecretaryMultimodalModelId {
  return SECRETARY_MULTIMODAL_MODEL_ID_SET.has(value);
}

export function getSecretaryModelOptionsForInput(
  hasImageAttachment: boolean,
): ReadonlyArray<(typeof SECRETARY_MODEL_OPTIONS)[number]> {
  if (!hasImageAttachment) {
    return SECRETARY_MODEL_OPTIONS;
  }
  return SECRETARY_MODEL_OPTIONS.filter((option) => isSecretaryMultimodalModelId(option.id));
}

export function normalizeSecretaryModelSelection(
  model: string,
  options: { hasImageAttachment?: boolean } = {},
): SecretaryModelId {
  const { hasImageAttachment = false } = options;
  if (!isSecretaryModelId(model)) {
    return hasImageAttachment ? DEFAULT_SECRETARY_MULTIMODAL_MODEL : DEFAULT_SECRETARY_MODEL;
  }
  if (hasImageAttachment && !isSecretaryMultimodalModelId(model)) {
    return DEFAULT_SECRETARY_MULTIMODAL_MODEL;
  }
  return model;
}

export function getSecretaryDefaultMaxOutputTokens(model: string): number {
  return (
    SECRETARY_MODEL_CONFIG_MAP.get(model)?.defaultMaxOutputTokens ??
    DEFAULT_SECRETARY_MAX_OUTPUT_TOKENS
  );
}
