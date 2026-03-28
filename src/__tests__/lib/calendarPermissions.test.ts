import { describe, expect, it } from "vite-plus/test";
import type { CalendarAccessContext, ScheduleItem } from "@/types";
import {
  BOOKED_EVENT_TITLE,
  buildScheduleVisibilityView,
  canDelete,
  canEdit,
  canViewDetails,
  maskScheduleForViewer,
  resolveAccessContextForMember,
  resolveAccessContextForPublicLink,
} from "@/lib/calendarPermissions";

function createSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: overrides.id ?? "schedule-1",
    title: overrides.title ?? "機能レビュー",
    mode: overrides.mode ?? "schedule",
    dueDate: overrides.dueDate ?? new Date("2025-01-10T09:00:00.000Z"),
    endDate: overrides.endDate,
    completed: overrides.completed ?? false,
    tags: overrides.tags ?? [
      {
        id: "tag-1",
        name: "重要",
        color: "#EF4444",
        priority: "high",
        createdAt: new Date("2025-01-01T00:00:00.000Z"),
      },
    ],
    color: overrides.color,
    location: overrides.location ?? "会議室A",
    items: overrides.items ?? "資料",
    participants: overrides.participants ?? "Aさん",
    url: overrides.url ?? "https://example.com/meeting",
    notes: overrides.notes ?? "議題あり",
    isPrivate: overrides.isPrivate ?? false,
    ownerId: overrides.ownerId ?? "owner-local",
    ownerDisplayName: overrides.ownerDisplayName ?? "あなた",
    reminderOffsetsMinutes: overrides.reminderOffsetsMinutes,
    allDayReminderTime: overrides.allDayReminderTime,
    recurrence: overrides.recurrence,
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
  };
}

function createAccess(role: CalendarAccessContext["role"]): CalendarAccessContext {
  return resolveAccessContextForMember(
    role,
    "owner-local",
    role === "OWNER" ? "owner-local" : "member-1",
  );
}

describe("calendarPermissions", () => {
  it("allows editors to view and edit non-private schedules", () => {
    const schedule = createSchedule({ isPrivate: false });
    const editor = createAccess("EDITOR");

    expect(canViewDetails(editor, schedule)).toBe(true);
    expect(canEdit(editor, schedule)).toBe(true);
    expect(canDelete(editor, schedule)).toBe(true);
  });

  it("enforces private flag so non-owners cannot view or edit", () => {
    const privateSchedule = createSchedule({ isPrivate: true });
    const editor = createAccess("EDITOR");
    const viewer = createAccess("VIEWER_FULL");

    expect(canViewDetails(editor, privateSchedule)).toBe(false);
    expect(canEdit(editor, privateSchedule)).toBe(false);
    expect(canDelete(editor, privateSchedule)).toBe(false);

    expect(canViewDetails(viewer, privateSchedule)).toBe(false);
    expect(canEdit(viewer, privateSchedule)).toBe(false);
  });

  it("keeps owner access even when schedule is private", () => {
    const privateSchedule = createSchedule({ isPrivate: true });
    const owner = createAccess("OWNER");

    expect(canViewDetails(owner, privateSchedule)).toBe(true);
    expect(canEdit(owner, privateSchedule)).toBe(true);
    expect(canDelete(owner, privateSchedule)).toBe(true);
  });

  it("masks details for free-busy viewers", () => {
    const schedule = createSchedule({ isPrivate: false });
    const freeBusy = createAccess("VIEWER_FREE_BUSY");
    const masked = maskScheduleForViewer(freeBusy, schedule);

    expect(masked.title).toBe(BOOKED_EVENT_TITLE);
    expect(masked.location).toBeUndefined();
    expect(masked.items).toBeUndefined();
    expect(masked.participants).toBeUndefined();
    expect(masked.url).toBeUndefined();
    expect(masked.notes).toBeUndefined();
    expect(masked.tags).toEqual([]);
  });

  it("builds public-link access context with read-only role", () => {
    const context = resolveAccessContextForPublicLink("VIEWER_FULL", "owner-local");

    expect(context.role).toBe("VIEWER_FULL");
    expect(context.source).toBe("public_link");
    expect(context.ownerUserId).toBe("owner-local");
  });

  it("returns busy visibility with denied mutations for free-busy", () => {
    const schedule = createSchedule();
    const freeBusy = createAccess("VIEWER_FREE_BUSY");
    const view = buildScheduleVisibilityView(freeBusy, schedule);

    expect(view.visibility).toBe("busy");
    expect(view.canViewDetails).toBe(false);
    expect(view.canCreate).toBe(false);
    expect(view.canEdit).toBe(false);
    expect(view.canDelete).toBe(false);
    expect(view.item.title).toBe(BOOKED_EVENT_TITLE);
  });
});
