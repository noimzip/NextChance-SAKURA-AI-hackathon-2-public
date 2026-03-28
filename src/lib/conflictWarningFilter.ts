import type { ScheduleConflict, Tag } from "@/types";

/**
 * Build visible conflicts based on existing schedule tags and per-tag warning settings.
 * A conflict is visible only when the conflicting schedule has at least one tag whose
 * conflict warning setting is enabled.
 */
export function getVisibleScheduleConflicts(
  conflicts: ScheduleConflict[],
  tags: Tag[],
): ScheduleConflict[] {
  const enabledWarningTagNames = new Set(
    tags
      .filter((tag) => tag.conflictWarningsEnabled !== false)
      .map((tag) => tag.name)
      .filter((name) => name.length > 0),
  );

  if (enabledWarningTagNames.size === 0) {
    return [];
  }

  return conflicts.filter((conflict) =>
    conflict.conflictingSchedule.tags.some((tagName) => enabledWarningTagNames.has(tagName)),
  );
}
