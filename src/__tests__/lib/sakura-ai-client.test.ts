import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockedSakuraFetch = vi.hoisted(() => vi.fn());

vi.mock("@/services/sakuraAI", () => ({
  sakuraFetch: mockedSakuraFetch,
}));

import { analyzeTimeTreeScreenshotDataUrl, TIMETREE_IMPORT_MODEL_ID } from "@/lib/sakura-ai-client";

describe("sakura-ai-client", () => {
  beforeEach(() => {
    mockedSakuraFetch.mockReset();
  });

  it("parses and normalizes TimeTree screenshot JSON", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: `\`\`\`json
{
  "year_month": "2026-3",
  "events": [
    {
      "title": "英会話",
      "date": "12",
      "start_time": "9:00",
      "end_time": "10:00",
      "tag": "習い事",
      "color": "#ff5733"
    },
    {
      "title": "部活",
      "date": "03-13",
      "is_all_day": true,
      "tag": "部活",
      "color": "orange"
    }
  ]
}
\`\`\``,
          },
        },
      ],
    });

    const output = await analyzeTimeTreeScreenshotDataUrl("data:image/png;base64,AAA");

    expect(output.year_month).toBe("2026-03");
    expect(output.events).toEqual([
      {
        title: "英会話",
        date: "2026-03-12",
        start_time: "09:00",
        end_time: "10:00",
        tag: "習い事",
        color: "#FF5733",
      },
      {
        title: "部活",
        date: "2026-03-13",
        is_all_day: true,
        tag: "部活",
        color: "orange",
      },
    ]);

    expect(mockedSakuraFetch).toHaveBeenCalledTimes(1);
    expect(mockedSakuraFetch).toHaveBeenCalledWith(
      "/chat/completions",
      expect.objectContaining({
        body: expect.objectContaining({
          model: TIMETREE_IMPORT_MODEL_ID,
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "system" }),
            expect.objectContaining({ role: "user" }),
          ]),
        }),
      }),
    );
  });

  it("throws when year_month is missing", async () => {
    mockedSakuraFetch.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              events: [{ title: "予定A", date: "2026-03-01" }],
            }),
          },
        },
      ],
    });

    await expect(analyzeTimeTreeScreenshotDataUrl("data:image/png;base64,AAA")).rejects.toThrow(
      "year_month は YYYY-MM 形式で必要です。",
    );
  });
});
