import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_SECRETARY_MODEL,
  DEFAULT_SECRETARY_MULTIMODAL_MODEL,
  getSecretaryModelOptionsForInput,
  normalizeSecretaryModelSelection,
} from "@/lib/secretaryModels";

describe("secretaryModels", () => {
  test("getSecretaryModelOptionsForInput should include all models when no image is attached", () => {
    const options = getSecretaryModelOptionsForInput(false);
    expect(options.length).toBeGreaterThan(3);
    expect(options.some((option) => option.id === "gpt-oss-120b")).toBe(true);
    expect(options.some((option) => option.id === "preview/Qwen3-VL-30B-A3B-Instruct")).toBe(true);
  });

  test("getSecretaryModelOptionsForInput should only include multimodal models when image is attached", () => {
    const options = getSecretaryModelOptionsForInput(true);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.id.startsWith("preview/"))).toBe(true);
    expect(options.some((option) => option.id === "gpt-oss-120b")).toBe(false);
  });

  test("normalizeSecretaryModelSelection should keep text model when no image is attached", () => {
    const normalized = normalizeSecretaryModelSelection("gpt-oss-120b", {
      hasImageAttachment: false,
    });
    expect(normalized).toBe("gpt-oss-120b");
  });

  test("normalizeSecretaryModelSelection should fallback to multimodal model when image is attached and text model is selected", () => {
    const normalized = normalizeSecretaryModelSelection("gpt-oss-120b", {
      hasImageAttachment: true,
    });
    expect(normalized).toBe(DEFAULT_SECRETARY_MULTIMODAL_MODEL);
  });

  test("normalizeSecretaryModelSelection should fallback to defaults for unknown model id", () => {
    const normalizedWithoutImage = normalizeSecretaryModelSelection("unknown-model", {
      hasImageAttachment: false,
    });
    const normalizedWithImage = normalizeSecretaryModelSelection("unknown-model", {
      hasImageAttachment: true,
    });

    expect(normalizedWithoutImage).toBe(DEFAULT_SECRETARY_MODEL);
    expect(normalizedWithImage).toBe(DEFAULT_SECRETARY_MULTIMODAL_MODEL);
  });
});
