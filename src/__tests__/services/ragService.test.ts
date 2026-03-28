import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockedSakuraFetch = vi.hoisted(() => vi.fn());

vi.mock("@/services/sakuraAI", () => ({
  sakuraFetch: mockedSakuraFetch,
}));

import { queryBelongingsSuggestionsFromRag } from "@/services/ragService";

describe("ragService", () => {
  beforeEach(() => {
    mockedSakuraFetch.mockReset();
  });

  it("queries RAG endpoint and normalizes belongings suggestions", async () => {
    mockedSakuraFetch.mockResolvedValue({
      results: [
        {
          content: "名刺、充電器\nノートPC",
          document: { id: "doc-1", name: "客先訪問テンプレ" },
          chunk_index: 2,
        },
      ],
    });

    const result = await queryBelongingsSuggestionsFromRag("客先訪問の持ち物", {
      tags: ["personal/schedule"],
      topK: 5,
      threshold: 0.3,
    });

    expect(mockedSakuraFetch).toHaveBeenCalledWith(
      "/documents/query/",
      expect.objectContaining({
        body: expect.objectContaining({
          query: "客先訪問の持ち物",
          tags: ["personal/schedule"],
          top_k: 5,
          threshold: 0.3,
        }),
      }),
    );
    expect(result.suggestions.map((entry) => entry.item)).toEqual(["名刺", "充電器", "ノートPC"]);
    expect(result.sources[0]).toEqual(
      expect.objectContaining({
        documentId: "doc-1",
        title: "客先訪問テンプレ",
      }),
    );
  });
});
