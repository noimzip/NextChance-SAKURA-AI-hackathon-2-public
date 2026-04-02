import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ScheduleItem, Tag } from "@/types";
import { ScreenshotImporter } from "@/features/import/ScreenshotImporter";

const mockAnalyzeTimeTreeScreenshot = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sakura-ai-client", () => ({
  analyzeTimeTreeScreenshot: mockAnalyzeTimeTreeScreenshot,
}));

vi.mock("@/components/photo-checker/ImageUpload", () => ({
  ImageUpload: ({
    onImageSelect,
    selectedImage,
  }: {
    onImageSelect: (file: File, previewUrl: string) => void;
    selectedImage: string | null;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onImageSelect(new File(["img"], "sample.png", { type: "image/png" }), "blob:preview")
        }
      >
        モック画像選択
      </button>
      <span>{selectedImage ? "選択済み" : "未選択"}</span>
    </div>
  ),
}));

function createSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  const dueDate = new Date("2026-03-12T09:00:00");
  const endDate = new Date("2026-03-12T10:00:00");
  return {
    id: "schedule-1",
    title: "英会話",
    mode: "schedule",
    dueDate,
    endDate,
    isAllDay: false,
    completed: false,
    tags: [],
    createdAt: new Date("2026-03-01T00:00:00"),
    ...overrides,
  };
}

function createTag(overrides: Partial<Tag> = {}): Tag {
  return {
    id: "tag-1",
    name: "重要",
    color: "#EF4444",
    priority: "high",
    conflictWarningsEnabled: true,
    createdAt: new Date("2026-03-01T00:00:00"),
    ...overrides,
  };
}

describe("ScreenshotImporter", () => {
  beforeEach(() => {
    mockAnalyzeTimeTreeScreenshot.mockReset();
  });

  it("creates unknown tags and imports selected rows", async () => {
    mockAnalyzeTimeTreeScreenshot.mockResolvedValue({
      year_month: "2026-03",
      events: [
        {
          title: "英会話",
          date: "2026-03-12",
          start_time: "09:00",
          end_time: "10:00",
          tag: "習い事",
          color: "#F97316",
        },
      ],
    });

    const addTag = vi.fn((input: { name: string; color: string; priority?: Tag["priority"] }) =>
      createTag({
        id: "tag-new-1",
        name: input.name,
        color: input.color,
        priority: input.priority ?? "medium",
      }),
    );
    const addSchedule = vi.fn();
    const onImported = vi.fn();

    render(
      <ScreenshotImporter
        open
        onOpenChange={vi.fn()}
        schedules={[]}
        tags={[createTag()]}
        addTag={addTag}
        addSchedule={addSchedule}
        onImported={onImported}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "モック画像選択" }));
    fireEvent.click(screen.getByRole("button", { name: "スクリーンショットを解析" }));

    await waitFor(() => {
      expect(screen.getByText("行1を取り込む")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "1件を取り込む" }));

    await waitFor(() => {
      expect(addTag).toHaveBeenCalledTimes(1);
    });
    expect(addTag).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "習い事",
        color: "#F97316",
      }),
    );
    expect(addSchedule).toHaveBeenCalledTimes(1);
    expect(addSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "英会話",
        mode: "schedule",
        color: "#F97316",
        tags: [expect.objectContaining({ name: "習い事" })],
      }),
    );
    expect(onImported).toHaveBeenCalledWith(1);
  });

  it("does not auto-include duplicate candidates and keeps existing tag color", async () => {
    mockAnalyzeTimeTreeScreenshot.mockResolvedValue({
      year_month: "2026-03",
      events: [
        {
          title: "英会話",
          date: "2026-03-12",
          start_time: "09:00",
          end_time: "10:00",
          tag: "習い事",
          color: "#22C55E",
        },
      ],
    });

    const existingTag = createTag({
      id: "tag-2",
      name: "習い事",
      color: "#3B82F6",
      priority: "medium",
    });
    const addTag = vi.fn();
    const addSchedule = vi.fn();

    render(
      <ScreenshotImporter
        open
        onOpenChange={vi.fn()}
        schedules={[createSchedule()]}
        tags={[existingTag]}
        addTag={addTag}
        addSchedule={addSchedule}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "モック画像選択" }));
    fireEvent.click(screen.getByRole("button", { name: "スクリーンショットを解析" }));

    await waitFor(() => {
      expect(screen.getByText("重複候補")).toBeInTheDocument();
    });

    expect(
      (screen.getByLabelText("行1を取り込む") as HTMLButtonElement).getAttribute("data-state"),
    ).toBe("unchecked");

    fireEvent.click(screen.getByLabelText("行1を取り込む"));
    fireEvent.click(screen.getByRole("button", { name: "1件を取り込む" }));

    await waitFor(() => {
      expect(addSchedule).toHaveBeenCalledTimes(1);
    });
    expect(addTag).not.toHaveBeenCalled();
    expect(addSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: [expect.objectContaining({ name: "習い事", color: "#3B82F6" })],
      }),
    );
  });
});
