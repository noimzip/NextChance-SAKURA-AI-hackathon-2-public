import { describe, it, expect, beforeEach, afterEach } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useTags } from "@/hooks/useTags";

describe("useTags", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("should initialize with important tag as high priority", () => {
    const { result } = renderHook(() => useTags());
    const important = result.current.tags.find((tag) => tag.id === "tag-1");

    expect(important).toBeDefined();
    expect(important?.name).toBe("重要");
    expect(important?.priority).toBe("high");
    expect(important?.conflictWarningsEnabled).toBe(true);
  });

  it("should default newly added 重要 tag to high priority", () => {
    const { result } = renderHook(() => useTags());

    act(() => {
      result.current.addTag({ name: "重要", color: "#111111" });
    });

    const latestImportant = result.current.tags.find(
      (tag) => tag.name === "重要" && tag.id !== "tag-1",
    );
    expect(latestImportant?.priority).toBe("high");
  });

  it("should update tag priority", () => {
    const { result } = renderHook(() => useTags());

    let newTagId = "";
    act(() => {
      const tag = result.current.addTag({ name: "勉強", color: "#3B82F6", priority: "medium" });
      newTagId = tag.id;
    });

    act(() => {
      result.current.updateTag(newTagId, { priority: "low" });
    });

    const updated = result.current.tags.find((tag) => tag.id === newTagId);
    expect(updated?.priority).toBe("low");
  });

  it("should update conflict warning setting per tag", () => {
    const { result } = renderHook(() => useTags());

    let newTagId = "";
    act(() => {
      const tag = result.current.addTag({ name: "会議", color: "#3B82F6", priority: "medium" });
      newTagId = tag.id;
    });

    act(() => {
      result.current.updateTag(newTagId, { conflictWarningsEnabled: false });
    });

    const updated = result.current.tags.find((tag) => tag.id === newTagId);
    expect(updated?.conflictWarningsEnabled).toBe(false);
  });

  it("should default conflict warning setting to true for legacy tags", () => {
    localStorage.setItem(
      "grass-secretary-tags",
      JSON.stringify([
        {
          id: "tag-legacy",
          name: "旧タグ",
          color: "#123456",
          priority: "medium",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ]),
    );

    const { result } = renderHook(() => useTags());
    const legacy = result.current.tags.find((tag) => tag.id === "tag-legacy");
    expect(legacy?.conflictWarningsEnabled).toBe(true);
  });

  it("should keep default 重要 tag as high priority even if updated", () => {
    const { result } = renderHook(() => useTags());

    act(() => {
      result.current.updateTag("tag-1", { priority: "low" });
    });

    const important = result.current.tags.find((tag) => tag.id === "tag-1");
    expect(important?.priority).toBe("high");
  });
});
