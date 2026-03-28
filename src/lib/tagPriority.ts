import type { ScheduleItem, Tag, TagPriority } from "@/types";

export type ScheduleSortMode = "priority" | "date";

export const SCHEDULE_SORT_STORAGE_KEY = "grass-secretary-schedule-sort-mode";

export const TAG_PRIORITY_ORDER: Record<TagPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export const TAG_PRIORITY_LABELS: Record<TagPriority, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

function isTagPriority(value: unknown): value is TagPriority {
  return value === "high" || value === "medium" || value === "low";
}

export function resolveTagPriority(
  tag: Pick<Tag, "id"> & Partial<Pick<Tag, "priority">>,
): TagPriority {
  if (tag.id === "tag-1") return "high";
  if (isTagPriority(tag.priority)) return tag.priority;
  return "medium";
}

export function sortTagsByPriority(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => {
    const rankDiff =
      TAG_PRIORITY_ORDER[resolveTagPriority(a)] - TAG_PRIORITY_ORDER[resolveTagPriority(b)];
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name, "ja");
  });
}

export function getSchedulePriorityRank(item: Pick<ScheduleItem, "tags">): number {
  if (!item.tags || item.tags.length === 0) return TAG_PRIORITY_ORDER.medium;
  return Math.min(...item.tags.map((tag) => TAG_PRIORITY_ORDER[resolveTagPriority(tag)]));
}

export function sortScheduleItems(
  items: ScheduleItem[],
  sortMode: ScheduleSortMode,
): ScheduleItem[] {
  const sorted = [...items];
  sorted.sort((a, b) => {
    const dateDiffAsc = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    const dateDiffDesc = -dateDiffAsc;
    if (sortMode === "date") {
      if (dateDiffAsc !== 0) return dateDiffAsc;
      return a.title.localeCompare(b.title, "ja");
    }

    const priorityDiff = getSchedulePriorityRank(a) - getSchedulePriorityRank(b);
    if (priorityDiff !== 0) return priorityDiff;
    if (dateDiffDesc !== 0) return dateDiffDesc;
    return a.title.localeCompare(b.title, "ja");
  });
  return sorted;
}
