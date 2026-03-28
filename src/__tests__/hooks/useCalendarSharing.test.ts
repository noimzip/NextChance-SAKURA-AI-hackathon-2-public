import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { renderHook } from "@testing-library/react";
import { useCalendarSharing } from "@/hooks/useCalendarSharing";

const SHARING_STORAGE_KEY = "grass-secretary-calendar-sharing";

describe("useCalendarSharing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("returns null for expired public link tokens", () => {
    localStorage.setItem(
      SHARING_STORAGE_KEY,
      JSON.stringify({
        calendarId: "calendar-local-1",
        owner: {
          userId: "owner-local",
          displayName: "あなた",
        },
        members: [],
        publicLink: {
          token: "expired-token",
          enabled: true,
          role: "VIEWER_FULL",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          expiresAt: "2025-01-01T00:00:00.000Z",
        },
      }),
    );

    const { result } = renderHook(() => useCalendarSharing());
    expect(result.current.resolvePublicRoleByToken("expired-token")).toBeNull();
  });

  it("returns role for valid non-expired public link token", () => {
    localStorage.setItem(
      SHARING_STORAGE_KEY,
      JSON.stringify({
        calendarId: "calendar-local-1",
        owner: {
          userId: "owner-local",
          displayName: "あなた",
        },
        members: [],
        publicLink: {
          token: "active-token",
          enabled: true,
          role: "VIEWER_FREE_BUSY",
          createdAt: "2099-01-01T00:00:00.000Z",
          updatedAt: "2099-01-01T00:00:00.000Z",
          expiresAt: "2099-12-31T00:00:00.000Z",
        },
      }),
    );

    const { result } = renderHook(() => useCalendarSharing());
    expect(result.current.resolvePublicRoleByToken("active-token")).toBe("VIEWER_FREE_BUSY");
  });
});
