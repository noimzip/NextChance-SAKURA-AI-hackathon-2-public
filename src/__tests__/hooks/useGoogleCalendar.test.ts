import { describe, it, expect, beforeEach, vi } from "vite-plus/test";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  useGoogleCalendar,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_CALENDAR_DEFAULT_FETCH_RANGE_DAYS,
} from "@/hooks/useGoogleCalendar";
import { GoogleCalendarApiError } from "@/services/googleCalendarApi";

const mockRequestGoogleAccessToken = vi.hoisted(() => vi.fn());
const mockRevokeGoogleAccessToken = vi.hoisted(() => vi.fn());
const mockListGoogleCalendarEvents = vi.hoisted(() => vi.fn());
const mockCreateGoogleCalendarEvent = vi.hoisted(() => vi.fn());

vi.mock("@/services/googleIdentityService", () => ({
  requestGoogleAccessToken: mockRequestGoogleAccessToken,
  revokeGoogleAccessToken: mockRevokeGoogleAccessToken,
}));

vi.mock("@/services/googleCalendarApi", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/services/googleCalendarApi")>();
  return {
    ...original,
    listGoogleCalendarEvents: mockListGoogleCalendarEvents,
    createGoogleCalendarEvent: mockCreateGoogleCalendarEvent,
  };
});

describe("useGoogleCalendar", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("logs in and stores OAuth token in localStorage", async () => {
    const now = new Date("2026-04-01T09:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    mockRequestGoogleAccessToken.mockResolvedValue({
      access_token: "token-1",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      token_type: "Bearer",
    });

    const { result } = renderHook(() =>
      useGoogleCalendar({
        clientId: "test-client-id",
        tokenStorageKey: "test-google-token",
      }),
    );

    await act(async () => {
      await result.current.login();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token?.accessToken).toBe("token-1");
    expect(result.current.token?.expiresAt).toBe(now.getTime() + 3600 * 1000);
    expect(mockRequestGoogleAccessToken).toHaveBeenCalledWith({
      clientId: "test-client-id",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      prompt: "consent",
    });

    const persisted = localStorage.getItem("test-google-token");
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted || "{}").accessToken).toBe("token-1");
  });

  it("fetches events with default 30-day range", async () => {
    mockListGoogleCalendarEvents.mockResolvedValue([{ id: "ev-1", summary: "event" }]);

    const { result } = renderHook(() =>
      useGoogleCalendar({
        clientId: "test-client-id",
        tokenStorageKey: "test-google-token",
      }),
    );

    mockRequestGoogleAccessToken.mockResolvedValue({
      access_token: "token-fetch",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      token_type: "Bearer",
    });

    await act(async () => {
      await result.current.login();
    });

    await act(async () => {
      await result.current.fetchEvents();
    });

    expect(result.current.events).toHaveLength(1);
    expect(mockListGoogleCalendarEvents).toHaveBeenCalledTimes(1);
    expect(mockListGoogleCalendarEvents).toHaveBeenCalledWith(
      "token-fetch",
      expect.objectContaining({
        calendarId: "primary",
        maxResults: 100,
        singleEvents: true,
        orderBy: "startTime",
      }),
    );

    const options = mockListGoogleCalendarEvents.mock.calls[0]?.[1];
    const timeMin = new Date(options.timeMin);
    const timeMax = new Date(options.timeMax);
    const diffDays = Math.round((timeMax.getTime() - timeMin.getTime()) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(GOOGLE_CALENDAR_DEFAULT_FETCH_RANGE_DAYS);
  });

  it("creates an event and appends it to local events state", async () => {
    mockRequestGoogleAccessToken.mockResolvedValue({
      access_token: "token-create",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      token_type: "Bearer",
    });
    mockCreateGoogleCalendarEvent.mockResolvedValue({
      id: "created-1",
      summary: "created event",
    });

    const { result } = renderHook(() =>
      useGoogleCalendar({
        clientId: "test-client-id",
        tokenStorageKey: "test-google-token",
      }),
    );

    await act(async () => {
      await result.current.login();
    });

    await act(async () => {
      await result.current.createEvent({
        summary: "Test",
        start: { dateTime: "2026-04-01T10:00:00.000Z" },
        end: { dateTime: "2026-04-01T11:00:00.000Z" },
      });
    });

    expect(result.current.events.map((item) => item.id)).toContain("created-1");
    expect(mockCreateGoogleCalendarEvent).toHaveBeenCalledWith(
      "token-create",
      expect.objectContaining({
        summary: "Test",
      }),
    );
  });

  it("logs out, revokes token and clears persisted state", async () => {
    mockRequestGoogleAccessToken.mockResolvedValue({
      access_token: "token-logout",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      token_type: "Bearer",
    });
    mockRevokeGoogleAccessToken.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useGoogleCalendar({
        clientId: "test-client-id",
        tokenStorageKey: "test-google-token",
      }),
    );

    await act(async () => {
      await result.current.login();
    });
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(mockRevokeGoogleAccessToken).toHaveBeenCalledWith("token-logout");
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(localStorage.getItem("test-google-token")).toBe("null");
  });

  it("exposes API errors when fetching events fails", async () => {
    mockRequestGoogleAccessToken.mockResolvedValue({
      access_token: "token-error",
      expires_in: 3600,
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      token_type: "Bearer",
    });
    mockListGoogleCalendarEvents.mockRejectedValue(
      new GoogleCalendarApiError("calendar list failed", 403, "PERMISSION_DENIED"),
    );

    const { result } = renderHook(() =>
      useGoogleCalendar({
        clientId: "test-client-id",
        tokenStorageKey: "test-google-token",
      }),
    );

    await act(async () => {
      await result.current.login();
    });

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.fetchEvents();
      } catch (err) {
        caughtError = err;
      }
    });

    expect(caughtError).toBeInstanceOf(GoogleCalendarApiError);
    await waitFor(() => {
      expect(result.current.error).toBe("calendar list failed");
    });
  });
});
