import { getSecretaryDefaultMaxOutputTokens } from "@/lib/secretaryModels";
import { SakuraAIError } from "@/services/sakuraAI";

const MIN_COMPLETION_TOKENS = 1;

function normalizeCompletionTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_COMPLETION_TOKENS;
  }
  return Math.max(MIN_COMPLETION_TOKENS, Math.floor(value));
}

function isMaxTokensOverflowMessage(message: string): boolean {
  return (
    /max_tokens|max_completion_tokens/i.test(message) &&
    /(too large|maximum context length|input tokens)/i.test(message)
  );
}

function parseAvailableTokensFromContextMessage(message: string): number | null {
  const contextLengthMatch = message.match(/maximum context length is\s*(\d+)\s*tokens/i);
  const inputTokensMatch = message.match(/request has\s*(\d+)\s*input tokens/i);
  if (!contextLengthMatch || !inputTokensMatch) {
    return null;
  }

  const contextLength = Number.parseInt(contextLengthMatch[1], 10);
  const inputTokens = Number.parseInt(inputTokensMatch[1], 10);
  if (!Number.isFinite(contextLength) || !Number.isFinite(inputTokens)) {
    return null;
  }

  return normalizeCompletionTokens(contextLength - inputTokens);
}

function parseAvailableTokensFromInequality(message: string): number | null {
  const inequalityMatch = message.match(/\((\d+)\s*>\s*(\d+)\s*-\s*(\d+)\)/);
  if (!inequalityMatch) {
    return null;
  }

  const contextLength = Number.parseInt(inequalityMatch[2], 10);
  const inputTokens = Number.parseInt(inequalityMatch[3], 10);
  if (!Number.isFinite(contextLength) || !Number.isFinite(inputTokens)) {
    return null;
  }

  return normalizeCompletionTokens(contextLength - inputTokens);
}

export function resolveChatCompletionMaxTokens(model: string, requestedMaxTokens?: number): number {
  const baseValue = requestedMaxTokens ?? getSecretaryDefaultMaxOutputTokens(model);
  return normalizeCompletionTokens(baseValue);
}

export function extractRetryableMaxTokens(error: unknown): number | null {
  if (!(error instanceof SakuraAIError)) {
    return null;
  }
  if (!isMaxTokensOverflowMessage(error.message)) {
    return null;
  }

  return (
    parseAvailableTokensFromContextMessage(error.message) ??
    parseAvailableTokensFromInequality(error.message)
  );
}

export async function requestChatCompletionWithRetry<T>(
  model: string,
  requestedMaxTokens: number | undefined,
  requestWithMaxTokens: (maxTokens: number) => Promise<T>,
): Promise<T> {
  const initialMaxTokens = resolveChatCompletionMaxTokens(model, requestedMaxTokens);
  try {
    return await requestWithMaxTokens(initialMaxTokens);
  } catch (error) {
    const retryableMaxTokens = extractRetryableMaxTokens(error);
    if (retryableMaxTokens === null || retryableMaxTokens >= initialMaxTokens) {
      throw error;
    }
    return requestWithMaxTokens(retryableMaxTokens);
  }
}
