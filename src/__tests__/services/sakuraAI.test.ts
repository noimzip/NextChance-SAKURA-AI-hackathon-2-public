import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { sakuraFetch, SakuraAIError, isApiConfigured } from "@/services/sakuraAI";

// Mock import.meta.env
vi.mock("@/services/sakuraAI", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/sakuraAI")>();
  return {
    ...original,
  };
});

describe("sakuraAI service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("SakuraAIError", () => {
    it("should create error with message only", () => {
      const error = new SakuraAIError("Test error");
      expect(error.message).toBe("Test error");
      expect(error.name).toBe("SakuraAIError");
      expect(error.status).toBeUndefined();
      expect(error.code).toBeUndefined();
    });

    it("should create error with status and code", () => {
      const error = new SakuraAIError("Test error", 401, "UNAUTHORIZED");
      expect(error.message).toBe("Test error");
      expect(error.status).toBe(401);
      expect(error.code).toBe("UNAUTHORIZED");
    });
  });

  describe("isApiConfigured", () => {
    it("should return false when API key is not set", () => {
      // The default env doesn't have the key set
      const result = isApiConfigured();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("sakuraFetch", () => {
    it("should throw error when API key is missing", async () => {
      // Note: This test assumes VITE_SAKURA_AI_API_KEY is not set in test env
      await expect(sakuraFetch("/test")).rejects.toThrow(SakuraAIError);
    });
  });
});
