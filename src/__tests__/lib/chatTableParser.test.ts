import { describe, test, expect } from "vite-plus/test";
import { splitChatContentBlocks } from "@/lib/chatTableParser";

describe("chatTableParser", () => {
  test("parses markdown table blocks", () => {
    const input = `予定です
| 期限 | タスク名 | 重要度・備考 |
|------|----------|-------------|
| 2026-03-26 17:00 | 英語の課題 | 重要 |
| 2026-03-30 09:00 | aaaa |  |
よろしく`;

    const blocks = splitChatContentBlocks(input);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ type: "text", text: "予定です" });
    expect(blocks[1].type).toBe("table");
    if (blocks[1].type === "table") {
      expect(blocks[1].table.headers).toEqual(["期限", "タスク名", "重要度・備考"]);
      expect(blocks[1].table.rows).toHaveLength(2);
      expect(blocks[1].table.source).toBe("markdown");
    }
  });

  test("parses tab separated text as table", () => {
    const input = `期限\tタスク名\t備考
2026-03-26 17:00\t数学の課題\t重要
2026-03-30 09:00\taaaa\t`;

    const blocks = splitChatContentBlocks(input);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
    if (blocks[0].type === "table") {
      expect(blocks[0].table.headers).toEqual(["期限", "タスク名", "備考"]);
      expect(blocks[0].table.rows[0]).toEqual(["2026-03-26 17:00", "数学の課題", "重要"]);
      expect(blocks[0].table.source).toBe("tsv");
    }
  });

  test("parses csv text as table", () => {
    const input = `期限,タスク名,備考
2026-03-26 17:00,英語の課題,重要
2026-03-30 09:00,aaaa,`;

    const blocks = splitChatContentBlocks(input);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
    if (blocks[0].type === "table") {
      expect(blocks[0].table.source).toBe("csv");
      expect(blocks[0].table.headers).toEqual(["期限", "タスク名", "備考"]);
    }
  });

  test("keeps normal prose as text only", () => {
    const input = "今日は会議と買い物があります。よろしくお願いします。";
    const blocks = splitChatContentBlocks(input);

    expect(blocks).toEqual([{ type: "text", text: input }]);
  });

  test("parses fullwidth pipe markdown-style table", () => {
    const input = `予定一覧
｜ タイトル ｜ 期限 ｜ 状態 ｜
｜ --- ｜ --- ｜ --- ｜
｜ 契約レビュー ｜ 2026-03-26 10:00 ｜ 未完了 ｜`;

    const blocks = splitChatContentBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].type).toBe("table");
    if (blocks[1].type === "table") {
      expect(blocks[1].table.headers).toEqual(["タイトル", "期限", "状態"]);
      expect(blocks[1].table.rows[0]).toEqual(["契約レビュー", "2026-03-26 10:00", "未完了"]);
    }
  });

  test("parses pipe table without separator row", () => {
    const input = `| タイトル | 期限 | 状態 |
| 週次会議 | 2026-03-26 09:00 | 未完了 |
| 資料提出 | 2026-03-26 17:00 | 進行中 |`;

    const blocks = splitChatContentBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("table");
    if (blocks[0].type === "table") {
      expect(blocks[0].table.headers).toEqual(["タイトル", "期限", "状態"]);
      expect(blocks[0].table.rows).toHaveLength(2);
    }
  });

  test("does not parse tables inside code fences", () => {
    const input = `コード例
\`\`\`md
| タイトル | 期限 | 状態 |
| --- | --- | --- |
| これは表として扱わない | 2026-03-26 | text |
\`\`\`
完了`;

    const blocks = splitChatContentBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: "text", text: input });
  });
});
