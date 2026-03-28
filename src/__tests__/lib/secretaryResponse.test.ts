import { describe, expect, it } from "vite-plus/test";
import { formatSecretaryResponse } from "@/lib/secretaryResponse";

describe("secretaryResponse formatter", () => {
  it("keeps response within default max length", () => {
    const longText =
      "今日は締切が近い課題が複数あるので、最優先はレポート提出です。次に会議準備を進め、最後に持ち物チェックを行いましょう。必要なら今から30分単位で区切って着手してください。";
    const formatted = formatSecretaryResponse(longText);
    expect(formatted.length).toBeLessThanOrEqual(180);
  });

  it("adds zundamon tone when missing", () => {
    const plainText = "最優先は明日の提出物です。今日中に草稿まで終わらせましょう。";
    const formatted = formatSecretaryResponse(plainText);
    expect(formatted).toMatch(/のだ|なのだ/);
  });

  it("returns fallback response for empty input", () => {
    const formatted = formatSecretaryResponse("   ");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toMatch(/のだ|なのだ/);
  });

  it("preserves markdown tables without collapsing line breaks", () => {
    const table = `今日の予定なのだ。

| タイトル | 期限 | 状態 |
| --- | --- | --- |
| 数学の課題 | 2026-03-24 17:00 | 未完了 |`;

    const formatted = formatSecretaryResponse(table);
    expect(formatted).toContain("\n| タイトル | 期限 | 状態 |");
    expect(formatted).toContain("| 数学の課題 | 2026-03-24 17:00 | 未完了 |");
  });

  it("preserves fullwidth-pipe table text without collapsing line breaks", () => {
    const table = `予定一覧なのだ。
｜ タイトル ｜ 期限 ｜ 状態 ｜
｜ --- ｜ --- ｜ --- ｜
｜ 契約レビュー ｜ 2026-03-26 10:00 ｜ 未完了 ｜`;

    const formatted = formatSecretaryResponse(table);
    expect(formatted).toContain("｜ タイトル ｜ 期限 ｜ 状態 ｜");
    expect(formatted).toContain("｜ 契約レビュー ｜ 2026-03-26 10:00 ｜ 未完了 ｜");
    expect(formatted).toContain("\n");
  });

  it("preserves pipe table without separator row", () => {
    const table = `| タイトル | 期限 | 状態 |
| 週次会議 | 2026-03-26 09:00 | 未完了 |
| 資料提出 | 2026-03-26 17:00 | 進行中 |`;

    const formatted = formatSecretaryResponse(table);
    expect(formatted).toContain("| タイトル | 期限 | 状態 |");
    expect(formatted).toContain("| 週次会議 | 2026-03-26 09:00 | 未完了 |");
    expect(formatted).toContain("\n| 週次会議 | 2026-03-26 09:00 | 未完了 |");
  });
});
