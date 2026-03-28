import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorage } from "@/hooks/useLocalStorage";

describe("useLocalStorage", () => {
  const TEST_KEY = "test-key";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should return initial value when localStorage is empty", () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, "initial"));
    expect(result.current[0]).toBe("initial");
  });

  it("should return stored value from localStorage", () => {
    localStorage.setItem(TEST_KEY, JSON.stringify("stored"));
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, "initial"));
    expect(result.current[0]).toBe("stored");
  });

  it("should update localStorage when value changes", () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, "initial"));

    act(() => {
      result.current[1]("updated");
    });

    expect(result.current[0]).toBe("updated");
    expect(JSON.parse(localStorage.getItem(TEST_KEY) || "")).toBe("updated");
  });

  it("should support function updates", () => {
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(1);
  });

  it("should work with complex objects", () => {
    const initialValue = { name: "test", count: 0 };
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, initialValue));

    act(() => {
      result.current[1]({ name: "updated", count: 5 });
    });

    expect(result.current[0]).toEqual({ name: "updated", count: 5 });
  });

  it("should work with arrays", () => {
    const { result } = renderHook(() => useLocalStorage<string[]>(TEST_KEY, []));

    act(() => {
      result.current[1](["item1", "item2"]);
    });

    expect(result.current[0]).toEqual(["item1", "item2"]);
  });

  it("syncs updates across hooks in same tab via custom event", () => {
    const first = renderHook(() => useLocalStorage(TEST_KEY, "initial"));
    const second = renderHook(() => useLocalStorage(TEST_KEY, "initial"));

    act(() => {
      first.result.current[1]("shared-value");
    });

    expect(first.result.current[0]).toBe("shared-value");
    expect(second.result.current[0]).toBe("shared-value");
  });

  it("ignores custom sync events from the same hook instance", () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const parseSpy = vi.spyOn(JSON, "parse");
    const { result } = renderHook(() => useLocalStorage(TEST_KEY, "initial"));

    act(() => {
      result.current[1]("self-update");
    });

    const parseCallCountAfterSet = parseSpy.mock.calls.length;
    const ownSyncEventDetail = dispatchSpy.mock.calls
      .map((call) => call[0])
      .find(
        (event): event is CustomEvent<{ key: string; newValue: string | null; sourceId: string }> =>
          event instanceof CustomEvent &&
          event.type === "grass-secretary-local-storage-sync" &&
          event.detail?.key === TEST_KEY &&
          event.detail?.newValue === JSON.stringify("self-update"),
      )?.detail;

    expect(ownSyncEventDetail).toBeDefined();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("grass-secretary-local-storage-sync", {
          detail: ownSyncEventDetail,
        }),
      );
    });

    expect(parseSpy.mock.calls.length).toBe(parseCallCountAfterSet);
    expect(result.current[0]).toBe("self-update");

    dispatchSpy.mockRestore();
    parseSpy.mockRestore();
  });

  it("recovers gracefully when latest photo result exceeds quota", () => {
    const quotaKey = "grass-secretary-latest-photo-check-result";
    const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");

    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function setItemWithQuota(this: Storage, key, value) {
        if (key === quotaKey) {
          throw quotaError;
        }
        void value;
        return undefined;
      });

    const { result } = renderHook(() => useLocalStorage(quotaKey, { ok: true }));

    act(() => {
      result.current[1]({ ok: false });
    });

    expect(result.current[0]).toEqual({ ok: true });
    expect(localStorage.getItem(quotaKey)).toBeNull();
    setItemSpy.mockRestore();
  });
});
