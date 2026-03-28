import { describe, expect, it, vi, beforeEach } from "vite-plus/test";

const mockedSakuraFetch = vi.hoisted(() => vi.fn());

vi.mock("@/services/sakuraAI", () => ({
  sakuraFetch: mockedSakuraFetch,
}));

import {
  analyzePhotoWithQwenModel,
  compressImageDataUrlForStorage,
  loadPhotoCheckHistory,
  PHOTO_CHECKER_MODEL_ID,
  PHOTO_CHECK_HISTORY_LIMIT,
  loadLatestPhotoCheckResult,
  savePhotoCheckHistoryEntry,
  saveLatestPhotoCheckResult,
} from "@/services/photoAnalysisService";

describe("photoAnalysisService", () => {
  beforeEach(() => {
    mockedSakuraFetch.mockReset();
    localStorage.clear();
  });

  it("uses preview/Qwen3-VL-30B-A3B-Instruct model for photo analysis", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              detectedItems: [{ name: "財布", confidence: 0.92 }],
              missingItems: ["傘"],
            }),
          },
        },
      ],
    });

    const file = new File(["image-bytes"], "bag.png", { type: "image/png" });
    const result = await analyzePhotoWithQwenModel(file, {
      previewUrl: "blob:preview",
    });

    expect(result.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.detectedItems).toEqual([{ name: "財布", confidence: 0.92 }]);
    expect(result.missingItems).toEqual(["傘"]);

    expect(mockedSakuraFetch).toHaveBeenCalledTimes(1);
    expect(mockedSakuraFetch).toHaveBeenCalledWith(
      "/chat/completions",
      expect.objectContaining({
        body: expect.objectContaining({
          model: PHOTO_CHECKER_MODEL_ID,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
        }),
      }),
    );
  });

  it("uses selected multimodal model when modelId is provided", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              detectedItems: [{ name: "財布", confidence: 0.92 }],
              missingItems: [],
            }),
          },
        },
      ],
    });

    const file = new File(["image-bytes"], "bag.png", { type: "image/png" });
    await analyzePhotoWithQwenModel(file, {
      modelId: "preview/Kimi-K2.5",
    });

    expect(mockedSakuraFetch).toHaveBeenCalledWith(
      "/chat/completions",
      expect.objectContaining({
        body: expect.objectContaining({
          model: "preview/Kimi-K2.5",
        }),
      }),
    );
  });

  it("parses JSON inside markdown code fence and normalizes confidence", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: `\`\`\`json
{
  "detectedItems": [
    { "name": "スマートフォン", "confidence": "87%" },
    "鍵"
  ],
  "missingItems": ["マスク", "マスク", "  "]
}
\`\`\``,
          },
        },
      ],
    });

    const file = new File(["image-bytes"], "bag.png", { type: "image/png" });
    const result = await analyzePhotoWithQwenModel(file);

    expect(result.detectedItems).toEqual([
      { name: "スマートフォン", confidence: 0.87 },
      { name: "鍵", confidence: 0.5 },
    ]);
    expect(result.missingItems).toEqual(["マスク"]);
  });

  it("compares detected items against expected items with normal policy", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              detectedItems: [
                { name: "パソコン", confidence: 0.95 },
                { name: "社員証", confidence: 0.9 },
              ],
              matchedItems: ["パソコン", "社員証"],
              missingItems: [],
              extraItems: [],
            }),
          },
        },
      ],
    });

    const file = new File(["image-bytes"], "bag.png", { type: "image/png" });
    const result = await analyzePhotoWithQwenModel(file, {
      expectedItems: ["ノートPC", "社員証"],
      comparisonPolicy: "normal",
    });

    expect(result.expectedItems).toEqual(["ノートPC", "社員証"]);
    expect(result.matchedItems).toEqual(["ノートPC", "社員証"]);
    expect(result.missingItems).toEqual([]);
  });

  it("keeps suggested/applied suggested items in analysis result", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              detectedItems: [{ name: "名刺", confidence: 0.88 }],
              matchedItems: ["名刺"],
              missingItems: [],
              extraItems: [],
            }),
          },
        },
      ],
    });

    const file = new File(["image-bytes"], "bag.png", { type: "image/png" });
    const result = await analyzePhotoWithQwenModel(file, {
      expectedItems: ["名刺"],
      suggestedItems: [
        {
          item: "名刺",
          score: 0.95,
          sourceScheduleTitles: ["客先打ち合わせ（週次）"],
        },
      ],
      appliedSuggestedItems: ["名刺"],
    });

    expect(result.suggestedItems).toEqual([
      {
        item: "名刺",
        score: 0.95,
        sourceScheduleTitles: ["客先打ち合わせ（週次）"],
      },
    ]);
    expect(result.appliedSuggestedItems).toEqual(["名刺"]);
  });

  it("persists and restores latest result in localStorage", () => {
    const now = new Date("2026-03-25T00:00:00.000Z");
    const sample = {
      id: "check-1",
      imageUrl: "blob:test",
      detectedItems: [{ name: "財布", confidence: 0.9 }],
      missingItems: ["鍵"],
      expectedItems: ["財布", "鍵"],
      matchedItems: ["財布"],
      extraItems: [],
      timestamp: now,
    };
    saveLatestPhotoCheckResult(sample);
    const restored = loadLatestPhotoCheckResult();
    expect(restored).not.toBeNull();
    expect(restored?.id).toBe("check-1");
    expect(restored?.imageUrl).toBe("");
    expect(restored?.timestamp.toISOString()).toBe(now.toISOString());
  });

  it("stores photo check history with limit", () => {
    for (let i = 0; i < PHOTO_CHECK_HISTORY_LIMIT + 2; i += 1) {
      savePhotoCheckHistoryEntry({
        id: `check-${i}`,
        imageUrl: "blob:test",
        detectedItems: [{ name: "財布", confidence: 0.8 }],
        missingItems: [],
        timestamp: new Date(`2026-03-25T00:00:${String(i).padStart(2, "0")}.000Z`),
      });
    }

    const history = loadPhotoCheckHistory();
    expect(history).toHaveLength(PHOTO_CHECK_HISTORY_LIMIT);
    expect(history[0]?.id).toBe(`check-${PHOTO_CHECK_HISTORY_LIMIT + 1}`);
    expect(history[PHOTO_CHECK_HISTORY_LIMIT - 1]?.imageUrl).toBe("");
  });

  it("keeps original data url when compression cannot run", async () => {
    const original = "data:image/png;base64,AAA";
    const compressed = await compressImageDataUrlForStorage(original);
    expect(compressed).toBe(original);
  });
});
