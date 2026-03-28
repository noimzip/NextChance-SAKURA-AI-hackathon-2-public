import { describe, expect, it, vi } from "vite-plus/test";
import {
  extractRetryableMaxTokens,
  requestChatCompletionWithRetry,
  resolveChatCompletionMaxTokens,
} from "@/lib/chatCompletion";
import { SakuraAIError } from "@/services/sakuraAI";

describe("chatCompletion helpers", () => {
  it("resolves model-specific default max tokens", () => {
    expect(resolveChatCompletionMaxTokens("llm-jp-3.1-8x13b-instruct4")).toBe(1024);
    expect(resolveChatCompletionMaxTokens("gpt-oss-120b")).toBe(2048);
    expect(resolveChatCompletionMaxTokens("preview/Qwen3-VL-30B-A3B-Instruct")).toBe(4096);
    expect(resolveChatCompletionMaxTokens("preview/Kimi-K2.5")).toBe(4096);
    expect(resolveChatCompletionMaxTokens("preview/Phi-4-multimodal-instruct")).toBe(4096);
    expect(resolveChatCompletionMaxTokens("unknown-model")).toBe(2048);
  });

  it("normalizes requested max tokens", () => {
    expect(resolveChatCompletionMaxTokens("gpt-oss-120b", 512.8)).toBe(512);
    expect(resolveChatCompletionMaxTokens("gpt-oss-120b", 0)).toBe(1);
    expect(resolveChatCompletionMaxTokens("gpt-oss-120b", Number.NaN)).toBe(1);
  });

  it("extracts retryable max tokens from context-length error message", () => {
    const error = new SakuraAIError(
      "max_tokens' or 'max_completion_tokens' is too large: 4096. This model's maximum context length is 4096 tokens and your request has 893 input tokens (4096 > 4096 - 893).",
      400,
    );
    expect(extractRetryableMaxTokens(error)).toBe(3203);
  });

  it("returns null for non-overflow errors", () => {
    const error = new SakuraAIError("Unauthorized", 401);
    expect(extractRetryableMaxTokens(error)).toBeNull();
    expect(extractRetryableMaxTokens(new Error("plain error"))).toBeNull();
  });

  it("retries once with reduced max_tokens on overflow errors", async () => {
    const maxTokensOverflow = new SakuraAIError(
      "max_tokens' or 'max_completion_tokens' is too large: 4096. This model's maximum context length is 4096 tokens and your request has 893 input tokens (4096 > 4096 - 893).",
      400,
    );
    const requestWithMaxTokens = vi
      .fn<(maxTokens: number) => Promise<string>>()
      .mockRejectedValueOnce(maxTokensOverflow)
      .mockResolvedValueOnce("ok");

    const result = await requestChatCompletionWithRetry(
      "llm-jp-3.1-8x13b-instruct4",
      4096,
      requestWithMaxTokens,
    );

    expect(result).toBe("ok");
    expect(requestWithMaxTokens).toHaveBeenCalledTimes(2);
    expect(requestWithMaxTokens).toHaveBeenNthCalledWith(1, 4096);
    expect(requestWithMaxTokens).toHaveBeenNthCalledWith(2, 3203);
  });

  it("does not retry when reduced max_tokens is not smaller than initial", async () => {
    const maxTokensOverflow = new SakuraAIError(
      "max_tokens' or 'max_completion_tokens' is too large: 4096. This model's maximum context length is 4096 tokens and your request has 893 input tokens (4096 > 4096 - 893).",
      400,
    );
    const requestWithMaxTokens = vi
      .fn<(maxTokens: number) => Promise<string>>()
      .mockRejectedValue(maxTokensOverflow);

    await expect(
      requestChatCompletionWithRetry("llm-jp-3.1-8x13b-instruct4", 1024, requestWithMaxTokens),
    ).rejects.toBe(maxTokensOverflow);
    expect(requestWithMaxTokens).toHaveBeenCalledTimes(1);
    expect(requestWithMaxTokens).toHaveBeenNthCalledWith(1, 1024);
  });
});
