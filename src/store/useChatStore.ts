import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type DialogueRole = "user" | "assistant" | "system";

export interface DialogueTurn {
  id: string;
  role: DialogueRole;
  content: string;
  timestamp: string;
}

export interface DialogueSession {
  id: string;
  title: string;
  threadId?: string;
  startedAt: string;
  endedAt?: string;
  endReason?: string;
  turns: DialogueTurn[];
}

interface ChatStoreState {
  sessions: DialogueSession[];
  activeSessionId: string | null;
  startDialogueSession: () => DialogueSession;
  setSessionThreadId: (sessionId: string, threadId: string) => void;
  addTurn: (sessionId: string, role: DialogueRole, content: string) => void;
  finishDialogueSession: (sessionId: string, reason?: string) => void;
  clearSessions: () => void;
}

function createSessionId(): string {
  return `dialogue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTurnId(): string {
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getNextDialogueTitle(sessions: DialogueSession[]): string {
  return `新しい対話#${sessions.length + 1}`;
}

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      startDialogueSession: () => {
        const sessions = get().sessions;
        const title = getNextDialogueTitle(sessions);
        const session: DialogueSession = {
          id: createSessionId(),
          title,
          startedAt: new Date().toISOString(),
          turns: [],
        };

        set((state) => ({
          sessions: [session, ...state.sessions],
          activeSessionId: session.id,
        }));

        return session;
      },
      setSessionThreadId: (sessionId, threadId) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, threadId } : session,
          ),
        }));
      },
      addTurn: (sessionId, role, content) => {
        const trimmedContent = content.trim();
        if (!trimmedContent) return;

        const turn: DialogueTurn = {
          id: createTurnId(),
          role,
          content: trimmedContent,
          timestamp: new Date().toISOString(),
        };

        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId ? { ...session, turns: [...session.turns, turn] } : session,
          ),
        }));
      },
      finishDialogueSession: (sessionId, reason) => {
        set((state) => ({
          sessions: state.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  endedAt: new Date().toISOString(),
                  endReason: reason,
                }
              : session,
          ),
          activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId,
        }));
      },
      clearSessions: () => set({ sessions: [], activeSessionId: null }),
    }),
    {
      name: "grass-secretary-dialogue-sessions",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessions: state.sessions,
      }),
    },
  ),
);

export const __internal__ = {
  getNextDialogueTitle,
};
