import type {
  GoogleCalendarCalendarListItem,
  GoogleCalendarCreateEventInput,
  GoogleCalendarEventItem,
  GoogleCalendarListEventsOptions,
  GoogleCalendarUpdateEventInput,
} from "@/types";

const GOOGLE_CALENDAR_API_BASE_URL = "https://www.googleapis.com/calendar/v3";

interface GoogleCalendarApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export class GoogleCalendarApiError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "GoogleCalendarApiError";
    this.status = status;
    this.code = code;
  }
}

interface GoogleCalendarListEventsResponse {
  items?: GoogleCalendarEventItem[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleCalendarListCalendarsResponse {
  items?: GoogleCalendarCalendarListItem[];
}

function buildEventsUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(`${GOOGLE_CALENDAR_API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }
  return url.toString();
}

async function parseApiError(response: Response): Promise<GoogleCalendarApiError> {
  let payload: GoogleCalendarApiErrorPayload | null = null;
  try {
    payload = (await response.json()) as GoogleCalendarApiErrorPayload;
  } catch {
    // Ignore parse errors and use fallback message.
  }
  const message =
    payload?.error?.message || `Google Calendar API request failed with status ${response.status}.`;
  const code = payload?.error?.status;
  return new GoogleCalendarApiError(message, response.status, code);
}

export async function listGoogleCalendarEvents(
  accessToken: string,
  options: GoogleCalendarListEventsOptions = {},
): Promise<GoogleCalendarEventItem[]> {
  const {
    calendarId = "primary",
    timeMin,
    timeMax,
    maxResults = 100,
    singleEvents = true,
    showDeleted,
    updatedMin,
    pageToken,
    orderBy = "startTime",
  } = options;

  const url = buildEventsUrl(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    timeMin,
    timeMax,
    maxResults: String(maxResults),
    singleEvents: String(singleEvents),
    showDeleted: showDeleted !== undefined ? String(showDeleted) : undefined,
    updatedMin,
    pageToken,
    orderBy,
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  const payload = (await response.json()) as GoogleCalendarListEventsResponse;
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  input: GoogleCalendarCreateEventInput,
): Promise<GoogleCalendarEventItem> {
  const { calendarId = "primary", ...eventPayload } = input;

  const url = buildEventsUrl(`/calendars/${encodeURIComponent(calendarId)}/events`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventPayload),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return (await response.json()) as GoogleCalendarEventItem;
}

export async function updateGoogleCalendarEvent(
  accessToken: string,
  input: GoogleCalendarUpdateEventInput,
): Promise<GoogleCalendarEventItem> {
  const { calendarId = "primary", eventId, ...eventPayload } = input;
  const url = buildEventsUrl(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(eventPayload),
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return (await response.json()) as GoogleCalendarEventItem;
}

export async function deleteGoogleCalendarEvent(
  accessToken: string,
  input: {
    calendarId?: string;
    eventId: string;
  },
): Promise<void> {
  const calendarId = input.calendarId ?? "primary";
  const url = buildEventsUrl(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}`,
  );
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }
}

export async function listGoogleCalendars(
  accessToken: string,
): Promise<GoogleCalendarCalendarListItem[]> {
  const url = buildEventsUrl("/users/me/calendarList", {
    minAccessRole: "reader",
  });
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  const payload = (await response.json()) as GoogleCalendarListCalendarsResponse;
  return Array.isArray(payload.items) ? payload.items : [];
}
