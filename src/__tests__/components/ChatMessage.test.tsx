import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { copyTextToClipboard } from "@/lib/clipboard";
import type { ChatMessage as ChatMessageType } from "@/types";

vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: vi.fn(async () => true),
}));

const mockedCopyTextToClipboard = vi.mocked(copyTextToClipboard);

function createAssistantMessage(content: string): ChatMessageType {
  return {
    id: "assistant-1",
    role: "assistant",
    content,
    timestamp: new Date("2026-03-24T10:00:00.000Z"),
  };
}

function createUserMessage(content: string): ChatMessageType {
  return {
    id: "user-1",
    role: "user",
    content,
    timestamp: new Date("2026-03-24T10:00:00.000Z"),
    hasImageAttachment: true,
    imageAttachmentName: "bag.png",
    imageAttachmentDataUrl: "data:image/png;base64,AAA",
  };
}

describe("ChatMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("copies message text via copy button", async () => {
    render(<ChatMessage message={createAssistantMessage("コピー対象メッセージ")} />);

    fireEvent.click(screen.getByRole("button", { name: "コピー" }));

    await waitFor(() => {
      expect(mockedCopyTextToClipboard).toHaveBeenCalledWith("コピー対象メッセージ");
    });
  });

  test("renders schedule list as table when markdown table is provided", () => {
    const message = createAssistantMessage(`今日の予定なのだ。

| タイトル | 期限 | 状態 |
| --- | --- | --- |
| 数学の課題 | 2026-03-24 17:00 | 未完了 |
| 買い物 | 2026-03-24 19:00 | 未完了 |`);

    render(<ChatMessage message={message} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("数学の課題")).toBeInTheDocument();
    expect(screen.getByText("買い物")).toBeInTheDocument();
  });

  test("makes title cells clickable and invokes callback for schedule tables", () => {
    const message = createAssistantMessage(`| タスク名 | 期限 | 状態 |
| --- | --- | --- |
| 英語の復習 | 2026-03-24 20:00 | 未完了 |`);
    const onScheduleClick = vi.fn();

    render(<ChatMessage message={message} onScheduleClick={onScheduleClick} />);

    fireEvent.click(screen.getByRole("button", { name: "英語の復習" }));
    expect(onScheduleClick).toHaveBeenCalledWith("英語の復習");
  });

  test("does not make non-schedule tables clickable", () => {
    const message = createAssistantMessage(`| 指標 | 値 |
| --- | --- |
| 直近スコア | 12 |`);
    const onScheduleClick = vi.fn();

    render(<ChatMessage message={message} onScheduleClick={onScheduleClick} />);

    expect(screen.queryByRole("button", { name: "直近スコア" })).toBeNull();
    expect(onScheduleClick).not.toHaveBeenCalled();
  });

  test("renders markdown formatting and code block", () => {
    const message = createAssistantMessage(`## 今日の方針

- 優先は **課題提出**
- 次に [会議準備](https://example.com)

\`\`\`ts
const status = "ready";
\`\`\``);

    render(<ChatMessage message={message} />);

    expect(screen.getByText("今日の方針")).toBeInTheDocument();
    expect(screen.getByText("課題提出")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "会議準備" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.getByText('const status = "ready";')).toBeInTheDocument();
  });

  test("renders markdown table as table but keeps code-fenced table as plain code text", () => {
    const message = createAssistantMessage(`| タイトル | 期限 | 状態 |
| --- | --- | --- |
| 宿題 | 2026-03-26 | 未完了 |

\`\`\`md
| fake | table |
| --- | --- |
| A | B |
\`\`\``);

    render(<ChatMessage message={message} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("宿題")).toBeInTheDocument();
    expect(screen.getByText(/fake \| table/)).toBeInTheDocument();
  });

  test("renders image attachment badge for user message", () => {
    render(<ChatMessage message={createUserMessage("これで忘れ物チェックして")} />);
    expect(screen.getByText("bag.png")).toBeInTheDocument();
  });

  test("renders image thumbnail and opens preview dialog", () => {
    render(<ChatMessage message={createUserMessage("画像を確認して")} />);
    fireEvent.click(screen.getByRole("button", { name: /bag\.png.*表示/ }));
    expect(screen.getAllByAltText("bag.png").length).toBeGreaterThanOrEqual(1);
  });

  test("retries specific user message via per-message button", () => {
    const onRetryMessage = vi.fn();
    render(
      <ChatMessage
        message={createUserMessage("この内容を再質問")}
        onRetryMessage={onRetryMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "この質問を再実行" }));
    expect(onRetryMessage).toHaveBeenCalledWith("user-1");
  });

  test("hides retry button for assistant messages", () => {
    render(
      <ChatMessage
        message={createAssistantMessage("再質問ボタンは表示しない")}
        onRetryMessage={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "この質問を再実行" })).toBeNull();
  });

  test("deletes specific message via per-message delete button", () => {
    const onDeleteMessage = vi.fn();
    render(
      <ChatMessage
        message={createUserMessage("このメッセージを消したい")}
        onDeleteMessage={onDeleteMessage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "このメッセージを削除" }));
    expect(screen.getByText("メッセージを削除")).toBeInTheDocument();
    expect(onDeleteMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onDeleteMessage).toHaveBeenCalledWith("user-1");
  });
});
