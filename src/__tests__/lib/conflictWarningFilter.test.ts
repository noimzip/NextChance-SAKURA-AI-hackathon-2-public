import { describe, it, expect } from "vite-plus/test";
import { getVisibleScheduleConflicts } from "@/lib/conflictWarningFilter";
import type { ScheduleConflict, Tag } from "@/types";

const makeTag = (id: string, name: string, conflictWarningsEnabled = true): Tag => ({
  id,
  name,
  color: "#000000",
  priority: "medium",
  conflictWarningsEnabled,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
});

const makeConflict = (title: string, tags: string[]): ScheduleConflict => ({
  type: "overlap",
  conflictingSchedule: {
    id: `schedule-${title}`,
    title,
    mode: "schedule",
    dueDate: "1月1日 10:00",
    completed: false,
    isOverdue: false,
    tags,
  },
});

describe("conflictWarningFilter", () => {
  it("returns no conflicts when no warning-enabled tag exists", () => {
    const conflicts = [makeConflict("A", ["会議"]), makeConflict("B", ["移動"])];
    const visible = getVisibleScheduleConflicts(conflicts, [
      makeTag("tag-meeting", "会議", false),
      makeTag("tag-move", "移動", false),
    ]);
    expect(visible).toEqual([]);
  });

  it("shows conflicts that include warning-enabled tags", () => {
    const conflicts = [makeConflict("A", ["会議"]), makeConflict("B", ["移動"])];
    const visible = getVisibleScheduleConflicts(conflicts, [makeTag("tag-1", "会議", true)]);
    expect(visible.map((item) => item.conflictingSchedule.title)).toEqual(["A"]);
  });

  it("hides conflicts that only have warning-disabled tags", () => {
    const conflicts = [
      makeConflict("会議A", ["会議", "重要"]),
      makeConflict("移動B", ["移動"]),
      makeConflict("会議C", ["会議"]),
      makeConflict("タグなしD", []),
    ];
    const visible = getVisibleScheduleConflicts(conflicts, [
      makeTag("tag-meeting", "会議", true),
      makeTag("tag-move", "移動", false),
      makeTag("tag-important", "重要", false),
    ]);
    expect(visible.map((item) => item.conflictingSchedule.title)).toEqual(["会議A", "会議C"]);
  });

  it("ignores caller-side tag selection and filters by conflicting schedule tags only", () => {
    const conflicts = [
      makeConflict("会議A", ["会議"]),
      makeConflict("移動B", ["移動"]),
      makeConflict("学習C", ["学習"]),
    ];
    const visible = getVisibleScheduleConflicts(conflicts, [
      makeTag("tag-meeting", "会議", true),
      makeTag("tag-move", "移動", false),
      makeTag("tag-study", "学習", true),
    ]);
    expect(visible.map((item) => item.conflictingSchedule.title)).toEqual(["会議A", "学習C"]);
  });
});
