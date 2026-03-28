import { useState, useCallback } from "react";
import { useLocalStorage } from "./useLocalStorage";
import { sendChatMessage } from "@/services/chatService";
import { synthesizeSpeech, createAudioUrl, revokeAudioUrl } from "@/services/speechService";
import type { ChatMessage } from "@/types";

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  playVoice: (messageId: string) => Promise<void>;
  isPlaying: string | null;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useLocalStorage<ChatMessage[]>("grass-secretary-chat", []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      try {
        const response = await sendChatMessage([...messages, userMessage]);

        const assistantMessage: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: response,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "メッセージの送信に失敗しました";
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, setMessages],
  );

  const clearMessages = useCallback(() => {
    // Clean up audio URLs
    audioUrls.forEach((url) => revokeAudioUrl(url));
    setAudioUrls(new Map());
    setMessages([]);
    setError(null);
  }, [audioUrls, setMessages]);

  const playVoice = useCallback(
    async (messageId: string) => {
      const message = messages.find((m) => m.id === messageId);
      if (!message || message.role !== "assistant") return;

      setIsPlaying(messageId);

      try {
        // Check if we already have the audio cached
        let audioUrl = audioUrls.get(messageId);

        if (!audioUrl) {
          const blob = await synthesizeSpeech(message.content);
          audioUrl = createAudioUrl(blob);
          setAudioUrls((prev) => new Map(prev).set(messageId, audioUrl!));
        }

        const audio = new Audio(audioUrl);
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Failed to play audio"));
          audio.play().catch(reject);
        });
      } catch (err) {
        console.error("Failed to play voice:", err);
      } finally {
        setIsPlaying(null);
      }
    },
    [messages, audioUrls],
  );

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    playVoice,
    isPlaying,
  };
}
