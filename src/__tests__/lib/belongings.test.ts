import { describe, expect, test } from "vite-plus/test";
import {
  compareBelongings,
  collectExpectedItemsFromSchedules,
  getSchedulesByCheckMode,
  mergeBelongingsItems,
  parseItemsTextToList,
  suggestBelongingsFromHistory,
} from "@/lib/belongings";
import type { ScheduleItem } from "@/types";

describe("belongings", () => {
  test("parseItemsTextToList should split mixed delimiters", () => {
    const parsed = parseItemsTextToList("財布、鍵\nノートPC/充電器;社員証");
    expect(parsed).toEqual(["財布", "鍵", "ノートPC", "充電器", "社員証"]);
  });

  test("compareBelongings should match aliases with normal policy", () => {
    const compared = compareBelongings(["ノートPC", "社員証"], ["パソコン", "社員証"], "normal");
    expect(compared.matched).toEqual(["ノートPC", "社員証"]);
    expect(compared.missing).toEqual([]);
  });

  test("collectExpectedItemsFromSchedules should aggregate items", () => {
    const schedules: ScheduleItem[] = [
      {
        id: "a",
        title: "会議",
        mode: "schedule",
        dueDate: new Date(),
        completed: false,
        tags: [],
        items: "資料、ノートPC",
        createdAt: new Date(),
      },
      {
        id: "b",
        title: "外出",
        mode: "task",
        dueDate: new Date(),
        completed: false,
        tags: [],
        items: "財布",
        createdAt: new Date(),
      },
    ];
    expect(collectExpectedItemsFromSchedules(schedules)).toEqual(["資料", "ノートPC", "財布"]);
  });

  test("getSchedulesByCheckMode should return selected item in single mode", () => {
    const schedules: ScheduleItem[] = [
      {
        id: "s1",
        title: "予定1",
        mode: "schedule",
        dueDate: new Date(),
        completed: false,
        tags: [],
        items: "資料",
        createdAt: new Date(),
      },
      {
        id: "s2",
        title: "予定2",
        mode: "schedule",
        dueDate: new Date(),
        completed: false,
        tags: [],
        items: "ノート",
        createdAt: new Date(),
      },
    ];
    expect(getSchedulesByCheckMode(schedules, "single_schedule", "s2").map((s) => s.id)).toEqual([
      "s2",
    ]);
  });

  test("suggestBelongingsFromHistory should propose items from similar schedules", () => {
    const targetSchedules: ScheduleItem[] = [
      {
        id: "target-1",
        title: "客先打ち合わせ",
        mode: "schedule",
        dueDate: new Date("2026-03-20T10:00:00.000Z"),
        completed: false,
        tags: [
          { id: "tag-1", name: "仕事", color: "#111111", priority: "high", createdAt: new Date() },
        ],
        location: "会議室A",
        items: "ノートPC",
        createdAt: new Date(),
      },
    ];
    const historySchedules: ScheduleItem[] = [
      {
        id: "history-1",
        title: "客先打ち合わせ（週次）",
        mode: "schedule",
        dueDate: new Date("2026-03-18T10:00:00.000Z"),
        completed: true,
        tags: [
          { id: "tag-1", name: "仕事", color: "#111111", priority: "high", createdAt: new Date() },
        ],
        location: "会議室A",
        items: "ノートPC、名刺、充電器",
        createdAt: new Date(),
      },
      {
        id: "history-2",
        title: "ランチ",
        mode: "schedule",
        dueDate: new Date("2026-03-15T12:00:00.000Z"),
        completed: false,
        tags: [],
        items: "財布",
        createdAt: new Date(),
      },
    ];

    const suggestions = suggestBelongingsFromHistory({
      targetSchedules,
      historySchedules,
      maxSuggestions: 5,
    });

    expect(suggestions.some((entry) => entry.item === "名刺")).toBe(true);
    expect(suggestions.some((entry) => entry.item === "充電器")).toBe(true);
    expect(suggestions.some((entry) => entry.item === "ノートPC")).toBe(false);
    expect(suggestions[0]?.sourceScheduleTitles).toContain("客先打ち合わせ（週次）");
  });

  test("mergeBelongingsItems should deduplicate alias items", () => {
    const merged = mergeBelongingsItems(["ノートPC", "パソコン", "社員証", "社員証"]);
    expect(merged).toEqual(["ノートPC", "社員証"]);
  });
});
