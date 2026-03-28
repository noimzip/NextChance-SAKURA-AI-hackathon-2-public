import { describe, it, expect } from "vite-plus/test";
import { resolveTagPriority, sortScheduleItems, sortTagsByPriority } from "@/lib/tagPriority";
import type { ScheduleItem, Tag } from "@/types";

const makeTag = (id: string, priority: Tag["priority"]): Tag => ({
  id,
  name: id,
  color: "#000000",
  priority,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
});

const makeSchedule = (
  id: string,
  title: string,
  dueDate: string,
  tags: Tag[],
  mode: ScheduleItem["mode"] = "task",
): ScheduleItem => ({
  id,
  title,
  mode,
  dueDate: new Date(dueDate),
  completed: false,
  tags,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
});

describe("tagPriority", () => {
  it("should always resolve default important tag (tag-1) as high priority", () => {
    expect(resolveTagPriority({ id: "tag-1", priority: "low" })).toBe("high");
    expect(resolveTagPriority({ id: "tag-1" })).toBe("high");
  });

  it("should sort by highest tag priority then due date desc in priority mode", () => {
    const highEarly = makeSchedule("s1", "high-early", "2025-01-02T09:00:00.000Z", [
      makeTag("tag-high", "high"),
    ]);
    const mediumLatest = makeSchedule("s2", "medium-latest", "2025-01-05T09:00:00.000Z", [
      makeTag("tag-medium", "medium"),
    ]);
    const low = makeSchedule("s3", "low", "2025-01-06T09:00:00.000Z", [makeTag("tag-low", "low")]);
    const highLatest = makeSchedule("s4", "high-latest", "2025-01-08T09:00:00.000Z", [
      makeTag("tag-high2", "high"),
    ]);

    const sorted = sortScheduleItems([mediumLatest, highEarly, low, highLatest], "priority");

    expect(sorted.map((item) => item.id)).toEqual(["s4", "s1", "s2", "s3"]);
  });

  it("should use highest priority when schedule has multiple tags", () => {
    const multi = makeSchedule("s1", "multi", "2025-01-03T09:00:00.000Z", [
      makeTag("tag-low", "low"),
      makeTag("tag-high", "high"),
    ]);
    const medium = makeSchedule("s2", "medium", "2025-01-04T09:00:00.000Z", [
      makeTag("tag-medium", "medium"),
    ]);

    const sorted = sortScheduleItems([medium, multi], "priority");
    expect(sorted.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  it("should sort by due date asc in date mode", () => {
    const older = makeSchedule("s1", "older", "2025-01-02T09:00:00.000Z", [makeTag("t1", "high")]);
    const latest = makeSchedule("s2", "latest", "2025-01-08T09:00:00.000Z", [makeTag("t2", "low")]);
    const middle = makeSchedule("s3", "middle", "2025-01-05T09:00:00.000Z", [
      makeTag("t3", "medium"),
    ]);

    const sorted = sortScheduleItems([older, latest, middle], "date");
    expect(sorted.map((item) => item.id)).toEqual(["s1", "s3", "s2"]);
  });

  it("should sort tags in high -> medium -> low order", () => {
    const high = makeTag("tag-high", "high");
    const medium = makeTag("tag-medium", "medium");
    const low = makeTag("tag-low", "low");

    const sorted = sortTagsByPriority([low, medium, high]);
    expect(sorted.map((tag) => tag.id)).toEqual(["tag-high", "tag-medium", "tag-low"]);
  });

  it("should put newer due date first when priority is the same", () => {
    const oldDateHigh = makeSchedule("s1", "old-date-high", "2025-01-02T09:00:00.000Z", [
      makeTag("tag-high", "high"),
    ]);
    const newDateHigh = makeSchedule("s2", "new-date-high", "2025-01-03T09:00:00.000Z", [
      makeTag("tag-high-2", "high"),
    ]);

    const sorted = sortScheduleItems([oldDateHigh, newDateHigh], "priority");
    expect(sorted.map((item) => item.id)).toEqual(["s2", "s1"]);
  });
});
