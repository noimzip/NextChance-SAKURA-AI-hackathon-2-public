import { describe, expect, test } from "vite-plus/test";
import { formatDialogueSpeechText } from "@/lib/dialogueSpeech";

describe("formatDialogueSpeechText", () => {
  test("keeps normal text and summarizes schedule table as title plus details", () => {
    const source = `今日の予定なのだ。

| タイトル | 期限 | 状態 | 備考 |
| --- | --- | --- | --- |
| 数学の課題 | 2026-03-24 17:00 | 未完了 | 教科書p20 |
| 買い物 | 2026-03-24 19:00 | 未完了 | 牛乳 |`;

    const result = formatDialogueSpeechText(source);

    expect(result).toContain("今日の予定なのだ。");
    expect(result).toContain(
      "1件目は数学の課題。期限は2026-03-24 17:00。状態は未完了。備考は教科書p20",
    );
    expect(result).toContain("2件目は買い物。期限は2026-03-24 19:00。状態は未完了。備考は牛乳");
  });

  test("falls back to normalized original text when schedule table rows are unavailable", () => {
    const source = `| 指標 | 値 |
| --- | --- |
| 継続日数 | 5 |`;

    const result = formatDialogueSpeechText(source);

    expect(result).toContain("| 指標 | 値 |");
    expect(result).toContain("| 継続日数 | 5 |");
  });
});
