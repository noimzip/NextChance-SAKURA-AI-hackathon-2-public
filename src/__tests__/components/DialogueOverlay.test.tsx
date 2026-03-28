import { describe, expect, test, vi } from "vite-plus/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { DialogueOverlay } from "@/components/DialogueOverlay";
import type { DialogueTurn } from "@/store/useChatStore";

function createTurn(id: string, role: DialogueTurn["role"], content: string): DialogueTurn {
  return {
    id,
    role,
    content,
    timestamp: "2026-03-27T12:00:00.000Z",
  };
}

describe("DialogueOverlay", () => {
  test("renders turns in dialogue modal when open", () => {
    const turns: DialogueTurn[] = [
      createTurn("turn-1", "user", "今日の予定を教えて"),
      createTurn("turn-2", "assistant", "会議と買い物があるのだ。"),
    ];

    render(
      <DialogueOverlay
        open
        phase="listening"
        statusLabel="聞き取り中"
        sessionTitle="新しい対話#1"
        turns={turns}
        recordingTimeLabel="00:12"
        audioLevel={0.4}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("対話内容")).toBeInTheDocument();
    expect(screen.getByText("あなた")).toBeInTheDocument();
    expect(screen.getByText("さくら")).toBeInTheDocument();
    expect(screen.getByText("今日の予定を教えて")).toBeInTheDocument();
    expect(screen.getByText("会議と買い物があるのだ。")).toBeInTheDocument();
  });

  test("shows empty transcript hint when no turns exist", () => {
    render(
      <DialogueOverlay
        open
        phase="listening"
        statusLabel="聞き取り中"
        sessionTitle="新しい対話#1"
        turns={[]}
        recordingTimeLabel="00:00"
        audioLevel={0}
        onStop={vi.fn()}
      />,
    );

    expect(screen.getByText("まだ会話はありません。")).toBeInTheDocument();
  });

  test("calls onStop when stop button is clicked", () => {
    const onStop = vi.fn(async () => undefined);

    render(
      <DialogueOverlay
        open
        phase="speaking"
        statusLabel="話し中"
        sessionTitle="新しい対話#1"
        turns={[]}
        recordingTimeLabel="00:00"
        audioLevel={0}
        onStop={onStop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "終了" }));
    expect(onStop).toHaveBeenCalled();
  });
});
