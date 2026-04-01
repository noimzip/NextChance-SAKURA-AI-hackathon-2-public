// Chat Message Types
export type ChatRequestMode = "default" | "generative_ui" | "tailwind_theme";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  requestMode?: ChatRequestMode;
  audioUrl?: string;
  hasImageAttachment?: boolean;
  imageAttachmentName?: string;
  imageAttachmentDataUrl?: string;
  actions?: SecretaryAction[]; // Parsed actions from assistant response
}

export interface ChatThread {
  id: string;
  title: string;
  isTitleManuallyEdited?: boolean;
  messages: ChatMessage[];
  pendingActions: SecretaryAction[];
  lastExecutedAction: ExecutedAction | null;
  createdAt: Date;
  updatedAt: Date;
}

export type GenerativeUILayout = "grid" | "stack";
export type GenerativeUIThemeMode = "dark" | "light";
export type GenerativeUIComponentType = "Card" | "List" | "Calendar" | "Chart" | "Button";
export type GenerativeUIComponentPriority = "high" | "medium" | "low";

export interface GenerativeUITheme {
  mode: GenerativeUIThemeMode;
  primaryColor: string;
}

export interface GenerativeUIComponentSpec {
  type: GenerativeUIComponentType;
  props: Record<string, unknown>;
  priority: GenerativeUIComponentPriority;
}

export interface GenerativeUIOutput {
  layout: GenerativeUILayout;
  theme: GenerativeUITheme;
  components: GenerativeUIComponentSpec[];
}

export interface TailwindThemeLayeredDarks {
  base: string;
  surface: string;
  elevated: string;
}

export interface TailwindThemeColors {
  layeredDarks: TailwindThemeLayeredDarks;
  background: string;
  primary: string;
  primaryForeground: string;
}

export interface TailwindThemePaddingScale {
  "3": string;
  "4": string;
  "6": string;
  "8": string;
}

export interface TailwindThemeExtendOutput {
  colors: TailwindThemeColors;
  padding: TailwindThemePaddingScale;
}

// Calendar Sharing Types
export type CalendarRole = "OWNER" | "EDITOR" | "VIEWER_FULL" | "VIEWER_FREE_BUSY";
export type CalendarVisibility = "full" | "busy";

export interface CalendarIdentity {
  userId: string;
  email?: string;
  displayName?: string;
}

export interface CalendarShareMember extends CalendarIdentity {
  id: string;
  role: Exclude<CalendarRole, "OWNER">;
  color: string;
  invitedAt: Date;
  updatedAt: Date;
}

export interface CalendarShareLink {
  token: string;
  enabled: boolean;
  role: "VIEWER_FULL" | "VIEWER_FREE_BUSY";
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface SharedCalendarMeta {
  calendarId: string;
  owner: CalendarIdentity;
  members: CalendarShareMember[];
  publicLink: CalendarShareLink | null;
}

export interface CalendarAccessContext {
  role: CalendarRole;
  ownerUserId: string;
  viewerUserId?: string;
  source: "owner" | "member" | "public_link";
}

export interface ScheduleVisibilityView {
  item: ScheduleItem;
  visibility: CalendarVisibility;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canToggleComplete: boolean;
  canViewDetails: boolean;
}

// Calendar Event Types (for displaying in calendar cells)
export interface CalendarEvent {
  scheduleId?: string;
  title: string;
  time: string; // "HH:MM" formatted
  isAllDay?: boolean;
  mode: "task" | "schedule";
  isStart: boolean; // First day of multi-day schedule
  isEnd: boolean; // Last day of multi-day schedule
  isMultiDay: boolean; // Whether this is a multi-day event
  spanDays?: number; // Total number of days this event spans (for ordering)
  completed: boolean; // Whether the event is completed
  color?: string;
  edgeColor?: string; // Priority color for event edge (tag > item > mode)
  ownerId?: string;
  ownerDisplayName?: string;
  isOwnedByViewer?: boolean;
  visibility?: CalendarVisibility;
}

// Google Calendar API Types
export interface GoogleOAuthToken {
  accessToken: string;
  tokenType: string;
  scope: string;
  expiresAt: number;
  obtainedAt: number;
}

export interface GoogleOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
}

export interface GoogleCalendarEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: "needsAction" | "declined" | "tentative" | "accepted";
}

export interface GoogleCalendarEventItem {
  id: string;
  etag?: string;
  status?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  organizer?: {
    email?: string;
    displayName?: string;
    self?: boolean;
  };
  htmlLink?: string;
  start?: GoogleCalendarEventDateTime;
  end?: GoogleCalendarEventDateTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleCalendarEventDateTime;
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
  attendees?: GoogleCalendarEventAttendee[];
}

export interface GoogleCalendarListEventsOptions {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  singleEvents?: boolean;
  showDeleted?: boolean;
  updatedMin?: string;
  pageToken?: string;
  orderBy?: "startTime" | "updated";
}

export interface GoogleCalendarCreateEventInput {
  calendarId?: string;
  summary: string;
  description?: string;
  location?: string;
  colorId?: string;
  start: GoogleCalendarEventDateTime;
  end: GoogleCalendarEventDateTime;
  recurrence?: string[];
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
  attendees?: Pick<GoogleCalendarEventAttendee, "email" | "displayName">[];
}

export interface GoogleCalendarUpdateEventInput extends GoogleCalendarCreateEventInput {
  eventId: string;
}

export interface GoogleCalendarCalendarListItem {
  id: string;
  summary?: string;
  primary?: boolean;
  accessRole?: "none" | "freeBusyReader" | "reader" | "writer" | "owner";
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
}

export interface GoogleCalendarSyncConflict {
  id: string;
  scheduleId: string;
  eventId: string;
  calendarId: string;
  scheduleTitle?: string;
  remoteTitle?: string;
  remoteUpdatedAt?: string;
  detectedAt: string;
}

// Tag Types
export type TagPriority = "high" | "medium" | "low";

export interface Tag {
  id: string;
  name: string;
  color: string; // Hex color code
  priority: TagPriority;
  conflictWarningsEnabled?: boolean; // Whether overlap/conflict warnings are enabled for this tag
  createdAt: Date;
}

// Warning Settings Types
export interface WarningSettings {
  conflictWarnings: boolean; // Show conflict/overlap warnings
  overdueWarnings: boolean; // Show overdue warnings
}

export type RepeatWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface ScheduleRecurrenceInput {
  weekdays: RepeatWeekday[];
  count?: number;
  isInfinite?: boolean;
}

export interface ScheduleRecurrenceRule extends ScheduleRecurrenceInput {
  seriesId?: string;
  occurrenceIndex?: number;
}

export type ScheduleMutationScope = "single" | "all" | "future";

// Schedule Types
export interface ScheduleItem {
  id: string;
  title: string;
  mode: "task" | "schedule"; // 'task' = due date only, 'schedule' = start and end date
  dueDate: Date; // Start date for schedules, due date for tasks
  endDate?: Date; // End date for schedules (optional)
  isAllDay?: boolean; // All-day schedule flag (schedule mode only)
  completed: boolean;
  tags: Tag[]; // Changed from category to tags array
  color?: string; // Hex color code for the item (optional)
  location?: string; // Location (optional)
  items?: string; // Items/belongings (optional)
  participants?: string; // Other participants (optional)
  url?: string; // URL (optional)
  notes?: string; // Additional notes/remarks (optional)
  isPrivate?: boolean; // Hide details from everyone except OWNER
  ownerId?: string; // Creator/owner user id for collaborative view
  ownerDisplayName?: string; // Display name for collaborative view
  reminderOffsetsMinutes?: number[]; // Reminder offsets in minutes before due/start time
  allDayReminderTime?: string; // "HH:MM" base time used for all-day schedule reminders
  recurrence?: ScheduleRecurrenceRule;
  googleCalendarId?: string; // Target Google Calendar id for per-item sync
  createdAt: Date;
}

// Future API contract types for sharing
export interface CalendarShareInviteRequest {
  calendarId: string;
  email: string;
  role: Exclude<CalendarRole, "OWNER">;
}

export interface CalendarShareInviteResponse {
  calendar: SharedCalendarMeta;
  invited: CalendarShareMember;
}

export interface CalendarShareRoleUpdateRequest {
  calendarId: string;
  memberId: string;
  role: Exclude<CalendarRole, "OWNER">;
}

export interface CalendarShareLinkToggleRequest {
  calendarId: string;
  enabled: boolean;
  role?: "VIEWER_FULL" | "VIEWER_FREE_BUSY";
}

export interface CalendarShareLinkResponse {
  calendarId: string;
  publicLink: CalendarShareLink | null;
}

// Secretary Action Types (for AI-driven schedule operations)
export type SecretaryActionType =
  | "add_schedule"
  | "update_schedule"
  | "complete_schedule"
  | "delete_schedule";

export interface SecretaryActionAddSchedule {
  type: "add_schedule";
  payload: {
    title: string;
    mode: "task" | "schedule";
    dueDate: string; // ISO 8601 format
    endDate?: string; // ISO 8601 format (for multi-day schedules)
    isAllDay?: boolean;
    tags?: string[]; // Tag names
    recurrence?: ScheduleRecurrenceInput;
    location?: string;
    items?: string;
    participants?: string;
    url?: string;
    notes?: string;
  };
}

export interface SecretaryActionUpdateSchedule {
  type: "update_schedule";
  payload: {
    id?: string; // Schedule ID if known
    title?: string; // Schedule title for fuzzy matching
    scope?: ScheduleMutationScope;
    updates: {
      title?: string;
      dueDate?: string;
      endDate?: string;
      isAllDay?: boolean;
      tags?: string[]; // Tag names
      recurrence?: ScheduleRecurrenceInput | null;
      location?: string;
      items?: string;
      participants?: string;
      url?: string;
      notes?: string;
    };
  };
}

export interface SecretaryActionCompleteSchedule {
  type: "complete_schedule";
  payload: {
    id?: string; // Schedule ID if known
    title?: string; // Schedule title for fuzzy matching
  };
}

export interface SecretaryActionDeleteSchedule {
  type: "delete_schedule";
  payload: {
    id?: string; // Schedule ID if known
    title?: string; // Schedule title for fuzzy matching
    scope?: ScheduleMutationScope;
  };
}

export type SecretaryAction =
  | SecretaryActionAddSchedule
  | SecretaryActionUpdateSchedule
  | SecretaryActionCompleteSchedule
  | SecretaryActionDeleteSchedule;

// Executed action for undo functionality
export interface ExecutedAction {
  action: SecretaryAction;
  timestamp: Date;
  undoData?: {
    type: "restore" | "toggle" | "revert";
    scheduleData?: ScheduleItem; // For delete/add undo
    previousState?: Partial<ScheduleItem>; // For update undo
  };
}

// Secretary Context (injected into AI system prompt)
export interface SecretaryScheduleContext {
  id: string;
  title: string;
  mode: "task" | "schedule";
  dueDate: string; // Human-readable date
  endDate?: string; // Human-readable date
  isAllDay?: boolean;
  completed: boolean;
  isOverdue: boolean;
  tags: string[]; // Tag names only
  location?: string;
  items?: string;
  recurrence?: ScheduleRecurrenceInput & { occurrenceIndex?: number };
}

export interface SecretaryPriorityItem {
  title: string;
  reason: "overdue" | "deadline_soon" | "schedule_conflict" | "upcoming";
  dueDate: string; // Human-readable date
  priority: 1 | 2 | 3;
}

export interface SecretaryPriorityHints {
  hasUrgentItems: boolean;
  hasScheduleConflicts: boolean;
  items: SecretaryPriorityItem[];
}

export interface SecretaryEffortSummary {
  currentStreak: number;
  todayActivityCount: number;
  recentActivityCount: number;
  recentActiveDays: number;
  topCategories: string[];
}

export type SecretarySchedulingVisibilityMode = "full_details" | "free_busy_only";

export interface SecretarySchedulingParticipant {
  id: string;
  displayName?: string;
  calendarId?: string;
  visibilityMode: SecretarySchedulingVisibilityMode;
}

export interface SecretaryParticipantBusyWindow {
  participantId: string;
  start: string; // ISO 8601 date-time
  end: string; // ISO 8601 date-time
  isAllDay?: boolean;
  title?: string; // Available when visibilityMode is full_details
  notes?: string;
}

export interface SecretaryExternalContextNote {
  type: "weather" | "travel" | "custom";
  note: string;
  date?: string; // ISO 8601 date
  source?: string;
}

export interface SecretaryFreeSlotCandidate {
  start: string; // ISO 8601 date-time
  end: string; // ISO 8601 date-time
  durationMinutes: number;
  participantIds: string[];
  score?: number;
  reason?: string;
}

export interface SecretarySchedulingContext {
  searchWindowDays: number; // Usually 14 days
  allowOutsideWorkingHours: boolean; // true = unrestricted hours
  participants: SecretarySchedulingParticipant[];
  busyWindows: SecretaryParticipantBusyWindow[];
  freeSlotCandidates: SecretaryFreeSlotCandidate[];
  externalContextNotes?: SecretaryExternalContextNote[];
}

// Conflict detection result
export interface ScheduleConflict {
  conflictingSchedule: SecretaryScheduleContext;
  type: "exact" | "overlap";
}

export interface SecretaryContext {
  currentDate: string; // Current date for context
  schedules: SecretaryScheduleContext[];
  upcomingCount: number;
  overdueCount: number;
  completedTodayCount: number;
  effortSummary: SecretaryEffortSummary;
  priorityHints: SecretaryPriorityHints;
  scheduling?: SecretarySchedulingContext;
}

export interface SecretaryModelOption {
  id: string;
  label: string;
}

// Effort Log Types
export type EffortCategory = "ai_chat" | "schedule_create" | "task_complete" | "photo_check";

export interface EffortLog {
  date: string; // YYYY-MM-DD format
  count: number;
  activities: EffortActivity[];
}

export interface EffortActivity {
  id: string;
  type: EffortCategory;
  description: string;
  timestamp: Date;
  score?: number;
  metadata?: {
    tags?: string[];
    scheduleMode?: "task" | "schedule";
    scheduleId?: string;
  };
}

export interface EffortDailySummary {
  date: string;
  totalCount: number;
  totalScore: number;
  categoryCounts: Record<EffortCategory, number>;
  categoryScores: Record<EffortCategory, number>;
  activities: EffortActivity[];
}

// Photo Checker Types
export interface BelongingsItemSuggestion {
  item: string;
  score: number; // 0.0 - 1.0 (higher means more likely useful)
  sourceScheduleTitles: string[];
}

export interface PhotoCheckResult {
  id: string;
  imageUrl: string;
  detectedItems: DetectedItem[];
  missingItems: string[];
  timestamp: Date;
  expectedItems?: string[];
  matchedItems?: string[];
  extraItems?: string[];
  comparisonPolicy?: BelongingsComparisonPolicy;
  checkMode?: BelongingsCheckMode;
  targetScheduleIds?: string[];
  targetScheduleTitles?: string[];
  suggestedItems?: BelongingsItemSuggestion[];
  appliedSuggestedItems?: string[];
}

export interface DetectedItem {
  name: string;
  confidence: number;
}

export type BelongingsComparisonPolicy = "strict" | "normal" | "lenient";

export type BelongingsCheckMode = "single_schedule" | "today_bundle" | "next_24h_bundle";

// API Response Types
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
      reasoning_content?: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// App State Types
export interface AppState {
  activeTab: "chat" | "schedule" | "photo" | "grass";
  isLoading: boolean;
  error: string | null;
}
