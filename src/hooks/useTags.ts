import { useCallback, useEffect } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { resolveTagPriority, sortTagsByPriority } from "@/lib/tagPriority";
import type { Tag } from "@/types";

interface UseTagsReturn {
  tags: Tag[];
  addTag: (
    tag: Omit<Tag, "id" | "createdAt" | "priority" | "conflictWarningsEnabled"> & {
      priority?: Tag["priority"];
      conflictWarningsEnabled?: boolean;
    },
  ) => Tag;
  updateTag: (id: string, updates: Partial<Omit<Tag, "id" | "createdAt">>) => void;
  deleteTag: (id: string) => void;
  getTag: (id: string) => Tag | undefined;
}

const DEFAULT_COLORS = [
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#06B6D4", // cyan
  "#3B82F6", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
];

function normalizeTag(tag: Tag): Tag {
  const createdAtValue = (tag as Partial<Tag>).createdAt;
  const conflictWarningsEnabled =
    (tag as Partial<Tag>).conflictWarningsEnabled !== undefined
      ? Boolean((tag as Partial<Tag>).conflictWarningsEnabled)
      : true;
  return {
    ...tag,
    priority: resolveTagPriority(tag),
    conflictWarningsEnabled,
    createdAt:
      createdAtValue instanceof Date
        ? createdAtValue
        : createdAtValue
          ? new Date(createdAtValue)
          : new Date(),
  };
}

export function useTags(): UseTagsReturn {
  const [storedTags, setTags] = useLocalStorage<Tag[]>("grass-secretary-tags", [
    {
      id: "tag-1",
      name: "重要",
      color: "#EF4444",
      priority: "high",
      conflictWarningsEnabled: true,
      createdAt: new Date(),
    },
  ]);

  useEffect(() => {
    setTags((prev) => {
      const normalized = prev.map(normalizeTag);
      if (JSON.stringify(prev) !== JSON.stringify(normalized)) {
        return normalized;
      }
      return prev;
    });
  }, [setTags]);

  const tags = sortTagsByPriority(storedTags.map(normalizeTag));

  const addTag = useCallback(
    (
      tag: Omit<Tag, "id" | "createdAt" | "priority" | "conflictWarningsEnabled"> & {
        priority?: Tag["priority"];
        conflictWarningsEnabled?: boolean;
      },
    ) => {
      const newTag: Tag = {
        ...tag,
        id: `tag-${Date.now()}`,
        priority: tag.priority ?? (tag.name === "重要" ? "high" : "medium"),
        conflictWarningsEnabled: tag.conflictWarningsEnabled ?? true,
        createdAt: new Date(),
      };
      setTags((prev) => [...prev.map(normalizeTag), newTag]);
      return newTag;
    },
    [setTags],
  );

  const updateTag = useCallback(
    (id: string, updates: Partial<Omit<Tag, "id" | "createdAt">>) => {
      setTags((prev) =>
        prev.map((tag) => {
          if (tag.id !== id) return normalizeTag(tag);
          return normalizeTag({
            ...tag,
            ...updates,
          });
        }),
      );
    },
    [setTags],
  );

  const deleteTag = useCallback(
    (id: string) => {
      // Don't allow deleting the default "重要" tag
      if (id === "tag-1") return;
      setTags((prev) => prev.filter((tag) => tag.id !== id).map(normalizeTag));
    },
    [setTags],
  );

  const getTag = useCallback(
    (id: string) => {
      return tags.find((tag) => tag.id === id);
    },
    [tags],
  );

  return {
    tags,
    addTag,
    updateTag,
    deleteTag,
    getTag,
  };
}

export { DEFAULT_COLORS };
