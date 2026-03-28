import { useState, useEffect, useCallback, useRef } from "react";

const LOCAL_STORAGE_SYNC_EVENT = "grass-secretary-local-storage-sync";

interface LocalStorageSyncDetail {
  key: string;
  newValue: string | null;
  sourceId: string;
}

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22
  );
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const sourceIdRef = useRef(`local-storage-sync-${Math.random().toString(36).slice(2, 10)}`);
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      console.warn(`Error reading localStorage key "${key}"`);
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        try {
          const serialized = JSON.stringify(valueToStore);
          window.localStorage.setItem(key, serialized);
          window.dispatchEvent(
            new CustomEvent<LocalStorageSyncDetail>(LOCAL_STORAGE_SYNC_EVENT, {
              detail: { key, newValue: serialized, sourceId: sourceIdRef.current },
            }),
          );
        } catch (error) {
          if (isQuotaExceededError(error) && key === "grass-secretary-latest-photo-check-result") {
            console.warn(
              `Quota exceeded for "${key}". Clearing the latest photo-check result to keep app responsive.`,
            );
            window.localStorage.removeItem(key);
            window.dispatchEvent(
              new CustomEvent<LocalStorageSyncDetail>(LOCAL_STORAGE_SYNC_EVENT, {
                detail: { key, newValue: null, sourceId: sourceIdRef.current },
              }),
            );
            return prev;
          }
          console.warn(`Error setting localStorage key "${key}"`, error);
        }
        return valueToStore;
      });
    },
    [key],
  );

  useEffect(() => {
    const applyStoredValue = (rawValue: string | null) => {
      if (rawValue == null) {
        setStoredValue(initialValue);
        return;
      }
      try {
        setStoredValue(JSON.parse(rawValue) as T);
      } catch {
        // Ignore invalid JSON
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key) {
        applyStoredValue(e.newValue);
      }
    };

    const handleLocalStorageSync = (event: Event) => {
      const detail = (event as CustomEvent<LocalStorageSyncDetail>).detail;
      if (!detail || detail.key !== key || detail.sourceId === sourceIdRef.current) {
        return;
      }
      applyStoredValue(detail.newValue);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalStorageSync as EventListener);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(LOCAL_STORAGE_SYNC_EVENT, handleLocalStorageSync as EventListener);
    };
  }, [initialValue, key]);

  return [storedValue, setValue];
}
