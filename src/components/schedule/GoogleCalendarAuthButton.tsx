import { useCallback, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CalendarCheck2, LogIn, LogOut, RefreshCw, AlertTriangle, Check, X } from "lucide-react";
import { useGoogleCalendarSync } from "@/hooks/useGoogleCalendarSync";
import type { ScheduleItem } from "@/types";

interface GoogleCalendarAuthButtonProps {
  className?: string;
  schedules: ScheduleItem[];
  addSchedule: (
    item: Omit<ScheduleItem, "id" | "completed" | "createdAt">,
    options?: { idSeed?: number },
  ) => void;
  updateSchedule: (
    id: string,
    updates: Omit<Partial<ScheduleItem>, "recurrence"> & {
      recurrence?: ScheduleItem["recurrence"] | null;
    },
    scope?: "single" | "all" | "future",
  ) => void;
  deleteSchedule: (id: string, scope?: "single" | "all" | "future") => void;
}

export function GoogleCalendarAuthButton({
  className,
  schedules,
  addSchedule,
  updateSchedule,
  deleteSchedule,
}: GoogleCalendarAuthButtonProps) {
  const {
    isSyncing,
    isAuthenticated,
    calendars,
    selectedCalendarId,
    conflicts,
    syncError,
    calendarError,
    lastSyncedAt,
    login,
    logout,
    refreshCalendars,
    setSelectedCalendarId,
    syncNow,
    resolveConflictKeepLocal,
    resolveConflictKeepRemote,
    clearSyncError,
    clearCalendarError,
  } = useGoogleCalendarSync({
    schedules,
    addSchedule,
    updateSchedule,
    deleteSchedule,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    void refreshCalendars().catch(() => undefined);
  }, [isAuthenticated, refreshCalendars]);

  const handleLogin = useCallback(async () => {
    clearSyncError();
    clearCalendarError();
    try {
      await login();
      await refreshCalendars();
      await syncNow();
    } catch {
      // Error is exposed by hook state.
    }
  }, [clearCalendarError, clearSyncError, login, refreshCalendars, syncNow]);

  const handleManualSync = useCallback(async () => {
    clearSyncError();
    clearCalendarError();
    try {
      await syncNow();
    } catch {
      // Error is exposed by hook state.
    }
  }, [clearCalendarError, clearSyncError, syncNow]);

  const handleLogout = useCallback(async () => {
    clearSyncError();
    clearCalendarError();
    try {
      await logout();
    } catch {
      // Error is exposed by hook state.
    }
  }, [clearCalendarError, clearSyncError, logout]);

  const hasError = Boolean(syncError || calendarError);

  return (
    <div className={cn("flex flex-col items-end gap-1", className)}>
      <div className="flex items-center gap-2">
        <Badge variant={isAuthenticated ? "secondary" : "outline"} className="whitespace-nowrap">
          <CalendarCheck2 className="h-3.5 w-3.5" />
          {isAuthenticated ? "Google連携済み" : "Google未連携"}
        </Badge>

        {!isAuthenticated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void handleLogin();
            }}
            disabled={isSyncing}
          >
            <LogIn className="h-4 w-4" />
            {isSyncing ? "ログイン中..." : "Googleログイン"}
          </Button>
        ) : (
          <>
            <div className="hidden items-center gap-1 lg:flex">
              <label htmlFor="google-calendar-select" className="text-xs text-muted-foreground">
                カレンダー
              </label>
              <select
                id="google-calendar-select"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                value={selectedCalendarId || "primary"}
                onChange={(event) => {
                  setSelectedCalendarId(event.target.value);
                }}
                disabled={isSyncing}
              >
                {(calendars.length > 0 ? calendars : [{ id: "primary", summary: "Primary" }]).map(
                  (calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.summary || calendar.id}
                    </option>
                  ),
                )}
              </select>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void handleManualSync();
              }}
              disabled={isSyncing}
            >
              <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
              {isSyncing ? "同期中..." : "今すぐ同期"}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void handleLogout();
              }}
              disabled={isSyncing}
            >
              <LogOut className="h-4 w-4" />
              ログアウト
            </Button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isAuthenticated ? <span>競合: {conflicts.length}件</span> : <span>未連携</span>}
        {lastSyncedAt && (
          <span>
            最終同期:{" "}
            {lastSyncedAt.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {hasError && (
        <div className="flex items-center gap-1 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>{syncError || calendarError}</span>
          <button
            type="button"
            className="underline"
            onClick={() => {
              clearSyncError();
              clearCalendarError();
            }}
          >
            クリア
          </button>
        </div>
      )}

      {conflicts.length > 0 && isAuthenticated && (
        <div className="flex max-h-32 w-full flex-col gap-1 overflow-auto rounded-md border p-2 text-xs">
          {conflicts.slice(0, 5).map((conflict) => (
            <div key={conflict.id} className="flex items-center justify-between gap-2">
              <span
                className="truncate"
                title={conflict.scheduleTitle || conflict.remoteTitle || "競合予定"}
              >
                {conflict.scheduleTitle || conflict.remoteTitle || "競合予定"}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => {
                    void resolveConflictKeepLocal(conflict.id);
                  }}
                  disabled={isSyncing}
                >
                  <Check className="h-3 w-3" />
                  ローカル優先
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2"
                  onClick={() => {
                    void resolveConflictKeepRemote(conflict.id);
                  }}
                  disabled={isSyncing}
                >
                  <X className="h-3 w-3" />
                  Google優先
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
