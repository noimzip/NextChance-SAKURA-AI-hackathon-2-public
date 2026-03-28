import { useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import type { WarningSettings } from "@/types";

const STORAGE_KEY = "grass-secretary-warning-settings";

const DEFAULT_SETTINGS: WarningSettings = {
  conflictWarnings: true,
  overdueWarnings: true,
};

interface UseWarningSettingsReturn {
  settings: WarningSettings;
  setConflictWarnings: (enabled: boolean) => void;
  setOverdueWarnings: (enabled: boolean) => void;
  updateSettings: (updates: Partial<WarningSettings>) => void;
  resetToDefaults: () => void;
}

/**
 * Hook to manage global warning settings
 * Settings are persisted to localStorage
 */
export function useWarningSettings(): UseWarningSettingsReturn {
  const [settings, setSettings] = useLocalStorage<WarningSettings>(STORAGE_KEY, DEFAULT_SETTINGS);

  const setConflictWarnings = useCallback(
    (enabled: boolean) => {
      setSettings((prev) => ({ ...prev, conflictWarnings: enabled }));
    },
    [setSettings],
  );

  const setOverdueWarnings = useCallback(
    (enabled: boolean) => {
      setSettings((prev) => ({ ...prev, overdueWarnings: enabled }));
    },
    [setSettings],
  );

  const updateSettings = useCallback(
    (updates: Partial<WarningSettings>) => {
      setSettings((prev) => ({ ...prev, ...updates }));
    },
    [setSettings],
  );

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  return {
    settings,
    setConflictWarnings,
    setOverdueWarnings,
    updateSettings,
    resetToDefaults,
  };
}
