import { useCallback, useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import type {
  GoogleCalendarCalendarListItem,
  GoogleCalendarCreateEventInput,
  GoogleCalendarEventItem,
  GoogleOAuthToken,
  GoogleCalendarUpdateEventInput,
} from "@/types";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  listGoogleCalendarEvents,
  listGoogleCalendars,
  GoogleCalendarApiError,
  updateGoogleCalendarEvent,
} from "@/services/googleCalendarApi";
import {
  requestGoogleAccessToken,
  revokeGoogleAccessToken,
} from "@/services/googleIdentityService";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;
const GOOGLE_CALENDAR_DEFAULT_SCOPE = GOOGLE_CALENDAR_SCOPES.join(" ");
export const GOOGLE_CALENDAR_TOKEN_STORAGE_KEY = "grass-secretary-google-calendar-token";
export const GOOGLE_CALENDAR_SELECTED_CALENDAR_STORAGE_KEY =
  "grass-secretary-google-calendar-selected-calendar-id";
export const GOOGLE_CALENDAR_DEFAULT_FETCH_RANGE_DAYS = 30;
const TOKEN_EXPIRY_BUFFER_MS = 30 * 1000;

function getGoogleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
}

function normalizeToken(input: GoogleOAuthToken | null): GoogleOAuthToken | null {
  if (!input) {
    return null;
  }
  return {
    accessToken: input.accessToken,
    tokenType: input.tokenType,
    scope: input.scope,
    expiresAt: input.expiresAt,
    obtainedAt: input.obtainedAt,
  };
}

function isTokenExpired(token: GoogleOAuthToken | null): boolean {
  if (!token) {
    return true;
  }
  const now = Date.now();
  return token.expiresAt <= now + TOKEN_EXPIRY_BUFFER_MS;
}

function normalizeScopeList(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function hasRequiredScopes(actualScope: string, requiredScopes: string[]): boolean {
  const granted = new Set(normalizeScopeList(actualScope));
  return requiredScopes.every((scope) => granted.has(scope));
}

function calculateTimeRange(days: number): { timeMin: string; timeMax: string } {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return {
    timeMin: now.toISOString(),
    timeMax: end.toISOString(),
  };
}

interface UseGoogleCalendarResult {
  token: GoogleOAuthToken | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isFetchingEvents: boolean;
  isListingCalendars: boolean;
  isCreatingEvent: boolean;
  isUpdatingEvent: boolean;
  isDeletingEvent: boolean;
  calendars: GoogleCalendarCalendarListItem[];
  selectedCalendarId: string;
  events: GoogleCalendarEventItem[];
  error: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshCalendars: () => Promise<GoogleCalendarCalendarListItem[]>;
  setSelectedCalendarId: (calendarId: string) => void;
  fetchEvents: (options?: {
    days?: number;
    calendarId?: string;
  }) => Promise<GoogleCalendarEventItem[]>;
  createEvent: (input: GoogleCalendarCreateEventInput) => Promise<GoogleCalendarEventItem>;
  updateEvent: (input: GoogleCalendarUpdateEventInput) => Promise<GoogleCalendarEventItem>;
  deleteEvent: (input: { eventId: string; calendarId?: string }) => Promise<void>;
  clearError: () => void;
}

interface UseGoogleCalendarOptions {
  clientId?: string;
  tokenStorageKey?: string;
  scope?: string;
}

export function useGoogleCalendar(options: UseGoogleCalendarOptions = {}): UseGoogleCalendarResult {
  const requiredScopes = useMemo(
    () => normalizeScopeList(options.scope ?? GOOGLE_CALENDAR_DEFAULT_SCOPE),
    [options.scope],
  );
  const requiredScopeString = requiredScopes.join(" ");
  const [storedToken, setStoredToken] = useLocalStorage<GoogleOAuthToken | null>(
    options.tokenStorageKey ?? GOOGLE_CALENDAR_TOKEN_STORAGE_KEY,
    null,
  );
  const [selectedCalendarId, setSelectedCalendarIdStorage] = useLocalStorage<string>(
    GOOGLE_CALENDAR_SELECTED_CALENDAR_STORAGE_KEY,
    "primary",
  );
  const [calendars, setCalendars] = useState<GoogleCalendarCalendarListItem[]>([]);
  const [events, setEvents] = useState<GoogleCalendarEventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingEvents, setIsFetchingEvents] = useState(false);
  const [isListingCalendars, setIsListingCalendars] = useState(false);
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);
  const [isUpdatingEvent, setIsUpdatingEvent] = useState(false);
  const [isDeletingEvent, setIsDeletingEvent] = useState(false);

  const token = useMemo(() => normalizeToken(storedToken), [storedToken]);
  const isAuthenticated = useMemo(() => {
    if (isTokenExpired(token)) {
      return false;
    }
    return Boolean(token && hasRequiredScopes(token.scope, requiredScopes));
  }, [requiredScopes, token]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const assertReadyToken = useCallback(() => {
    if (!token || isTokenExpired(token)) {
      const message = "Google Calendar token is missing or expired. Please login again.";
      setError(message);
      throw new Error(message);
    }
    if (!hasRequiredScopes(token.scope, requiredScopes)) {
      const message = `Google token does not include required scopes: ${requiredScopeString}`;
      setError(message);
      throw new Error(message);
    }
    return token;
  }, [requiredScopeString, requiredScopes, token]);

  const login = useCallback(async () => {
    const clientId = options.clientId ?? getGoogleClientId();
    if (!clientId) {
      const message = "VITE_GOOGLE_CLIENT_ID is not configured in .env.";
      setError(message);
      throw new Error(message);
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await requestGoogleAccessToken({
        clientId,
        scope: requiredScopeString,
        prompt: "consent",
      });
      if (!hasRequiredScopes(response.scope, requiredScopes)) {
        const message = `Required Google scopes were not granted: ${requiredScopeString}`;
        setError(message);
        throw new Error(message);
      }
      const now = Date.now();
      const nextToken: GoogleOAuthToken = {
        accessToken: response.access_token,
        tokenType: response.token_type,
        scope: response.scope,
        obtainedAt: now,
        expiresAt: now + response.expires_in * 1000,
      };
      setStoredToken(nextToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google login failed.";
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [options.clientId, requiredScopeString, requiredScopes, setStoredToken]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (token?.accessToken) {
        await revokeGoogleAccessToken(token.accessToken);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to revoke Google token.";
      setError(message);
      throw err;
    } finally {
      setStoredToken(null);
      setEvents([]);
      setCalendars([]);
      setIsLoading(false);
    }
  }, [setStoredToken, token?.accessToken]);

  const refreshCalendars = useCallback(async () => {
    const readyToken = assertReadyToken();
    setIsListingCalendars(true);
    setError(null);
    try {
      const fetched = await listGoogleCalendars(readyToken.accessToken);
      setCalendars(fetched);
      const selectedExists = fetched.some((calendar) => calendar.id === selectedCalendarId);
      if (!selectedExists) {
        const primary = fetched.find((calendar) => calendar.primary)?.id;
        setSelectedCalendarIdStorage(primary ?? "primary");
      }
      return fetched;
    } catch (err) {
      const message =
        err instanceof GoogleCalendarApiError || err instanceof Error
          ? err.message
          : "Failed to fetch Google Calendar list.";
      setError(message);
      throw err;
    } finally {
      setIsListingCalendars(false);
    }
  }, [assertReadyToken, selectedCalendarId, setSelectedCalendarIdStorage]);

  const setSelectedCalendarId = useCallback(
    (calendarId: string) => {
      const normalized = calendarId.trim();
      if (!normalized) {
        return;
      }
      setSelectedCalendarIdStorage(normalized);
    },
    [setSelectedCalendarIdStorage],
  );

  const fetchEvents = useCallback(
    async (options?: { days?: number; calendarId?: string }) => {
      const readyToken = assertReadyToken();

      const days = options?.days ?? GOOGLE_CALENDAR_DEFAULT_FETCH_RANGE_DAYS;
      const { timeMin, timeMax } = calculateTimeRange(days);

      setIsFetchingEvents(true);
      setError(null);

      try {
        const fetched = await listGoogleCalendarEvents(readyToken.accessToken, {
          calendarId: options?.calendarId ?? selectedCalendarId ?? "primary",
          timeMin,
          timeMax,
          maxResults: 100,
          singleEvents: true,
          orderBy: "startTime",
        });
        setEvents(fetched);
        return fetched;
      } catch (err) {
        const message =
          err instanceof GoogleCalendarApiError || err instanceof Error
            ? err.message
            : "Failed to fetch Google Calendar events.";
        setError(message);
        throw err;
      } finally {
        setIsFetchingEvents(false);
      }
    },
    [assertReadyToken, selectedCalendarId],
  );

  const createEvent = useCallback(
    async (input: GoogleCalendarCreateEventInput) => {
      const readyToken = assertReadyToken();

      setIsCreatingEvent(true);
      setError(null);

      try {
        const created = await createGoogleCalendarEvent(readyToken.accessToken, {
          ...input,
          calendarId: input.calendarId ?? selectedCalendarId ?? "primary",
        });
        setEvents((prev) => [...prev, created]);
        return created;
      } catch (err) {
        const message =
          err instanceof GoogleCalendarApiError || err instanceof Error
            ? err.message
            : "Failed to create Google Calendar event.";
        setError(message);
        throw err;
      } finally {
        setIsCreatingEvent(false);
      }
    },
    [assertReadyToken, selectedCalendarId],
  );

  const updateEvent = useCallback(
    async (input: GoogleCalendarUpdateEventInput) => {
      const readyToken = assertReadyToken();
      setIsUpdatingEvent(true);
      setError(null);
      try {
        const updated = await updateGoogleCalendarEvent(readyToken.accessToken, {
          ...input,
          calendarId: input.calendarId ?? selectedCalendarId ?? "primary",
        });
        setEvents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        return updated;
      } catch (err) {
        const message =
          err instanceof GoogleCalendarApiError || err instanceof Error
            ? err.message
            : "Failed to update Google Calendar event.";
        setError(message);
        throw err;
      } finally {
        setIsUpdatingEvent(false);
      }
    },
    [assertReadyToken, selectedCalendarId],
  );

  const deleteEvent = useCallback(
    async (input: { eventId: string; calendarId?: string }) => {
      const readyToken = assertReadyToken();
      setIsDeletingEvent(true);
      setError(null);
      try {
        await deleteGoogleCalendarEvent(readyToken.accessToken, {
          ...input,
          calendarId: input.calendarId ?? selectedCalendarId ?? "primary",
        });
        setEvents((prev) => prev.filter((item) => item.id !== input.eventId));
      } catch (err) {
        const message =
          err instanceof GoogleCalendarApiError || err instanceof Error
            ? err.message
            : "Failed to delete Google Calendar event.";
        setError(message);
        throw err;
      } finally {
        setIsDeletingEvent(false);
      }
    },
    [assertReadyToken, selectedCalendarId],
  );

  return {
    token,
    isAuthenticated,
    isLoading,
    isFetchingEvents,
    isListingCalendars,
    isCreatingEvent,
    isUpdatingEvent,
    isDeletingEvent,
    calendars,
    selectedCalendarId,
    events,
    error,
    login,
    logout,
    refreshCalendars,
    setSelectedCalendarId,
    fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    clearError,
  };
}
