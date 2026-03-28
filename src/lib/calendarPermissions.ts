import type {
  CalendarAccessContext,
  CalendarRole,
  CalendarVisibility,
  ScheduleItem,
  ScheduleVisibilityView,
} from "@/types";

export const BOOKED_EVENT_TITLE = "予定あり (Booked)";

function isOwnerContext(access: CalendarAccessContext): boolean {
  return access.role === "OWNER";
}

export function canViewDetails(access: CalendarAccessContext, schedule: ScheduleItem): boolean {
  if (isOwnerContext(access)) {
    return true;
  }
  if (schedule.isPrivate) {
    return false;
  }
  return access.role === "EDITOR" || access.role === "VIEWER_FULL";
}

export function canViewBusySlot(_access: CalendarAccessContext): boolean {
  return true;
}

export function canCreate(access: CalendarAccessContext): boolean {
  return access.role === "OWNER" || access.role === "EDITOR";
}

export function canEdit(access: CalendarAccessContext, schedule: ScheduleItem): boolean {
  if (isOwnerContext(access)) {
    return true;
  }
  if (schedule.isPrivate) {
    return false;
  }
  return access.role === "EDITOR";
}

export function canDelete(access: CalendarAccessContext, schedule: ScheduleItem): boolean {
  if (isOwnerContext(access)) {
    return true;
  }
  if (schedule.isPrivate) {
    return false;
  }
  return access.role === "EDITOR";
}

export function canToggleComplete(access: CalendarAccessContext, schedule: ScheduleItem): boolean {
  return canEdit(access, schedule);
}

export function getScheduleVisibility(
  access: CalendarAccessContext,
  schedule: ScheduleItem,
): CalendarVisibility {
  return canViewDetails(access, schedule) ? "full" : "busy";
}

export function maskScheduleForViewer(
  access: CalendarAccessContext,
  schedule: ScheduleItem,
): ScheduleItem {
  if (canViewDetails(access, schedule)) {
    return schedule;
  }

  return {
    ...schedule,
    title: BOOKED_EVENT_TITLE,
    location: undefined,
    items: undefined,
    participants: undefined,
    url: undefined,
    notes: undefined,
    tags: [],
    color: undefined,
  };
}

export function buildScheduleVisibilityView(
  access: CalendarAccessContext,
  schedule: ScheduleItem,
): ScheduleVisibilityView {
  const canViewDetailsValue = canViewDetails(access, schedule);
  const visibility = canViewDetailsValue ? "full" : "busy";

  return {
    item: maskScheduleForViewer(access, schedule),
    visibility,
    canCreate: canCreate(access),
    canEdit: canEdit(access, schedule),
    canDelete: canDelete(access, schedule),
    canToggleComplete: canToggleComplete(access, schedule),
    canViewDetails: canViewDetailsValue,
  };
}

export function resolveAccessContextForMember(
  role: CalendarRole,
  ownerUserId: string,
  viewerUserId?: string,
): CalendarAccessContext {
  return {
    role,
    ownerUserId,
    viewerUserId,
    source: role === "OWNER" ? "owner" : "member",
  };
}

export function resolveAccessContextForPublicLink(
  role: "VIEWER_FULL" | "VIEWER_FREE_BUSY",
  ownerUserId: string,
): CalendarAccessContext {
  return {
    role,
    ownerUserId,
    source: "public_link",
  };
}
