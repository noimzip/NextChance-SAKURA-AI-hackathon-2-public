# Copilot Instructions - Grass Secretary

A React + TypeScript personal productivity assistant with schedule management, effort tracking, chat interface, and photo verification features.

## Build, Test & Lint

This project uses **Vite+** (unified toolchain). Always use `vp` commands, never package managers or raw tool names.

- **Dev server:** `vp dev` (watches and hot-reloads)
- **Type check + lint + format:** `vp check` (validates everything)
- **Lint only:** `vp lint` (with `--type-aware` for TypeScript)
- **Format code:** `vp fmt`
- **Tests:** `vp test` (single test: `vp test <file_name>`)
- **Build:** `vp build` (compiles for production)
- **Preview build:** `vp preview`

**Critical:** Do NOT use `npm`, `pnpm`, `yarn`, `npx`, `vp vitest`, or `vp oxlint` directly. All tools are wrapped by `vp`.

## Architecture Overview

### Core Structure

```
src/
├── components/          # React UI components
│   ├── ui/             # Radix UI-based primitives (Card, Button, Input, Dialog, etc.)
│   ├── layout/         # App layout: Header, Sidebar
│   ├── chat/           # Chat UI and messaging interface
│   ├── schedule/       # Schedule list and items
│   ├── effort-grass/   # GitHub-style activity visualization
│   └── photo-checker/  # Image upload and detection UI
├── hooks/              # Custom React hooks for state management
├── services/           # API and external integrations
├── types/              # TypeScript interfaces (single index.ts)
├── lib/                # Utilities (classname merging, etc.)
└── App.tsx             # Root component with view mode toggle
```

### State Management

**No Redux/Zustand.** Uses custom hooks + localStorage:

- `useSchedule()` — CRUD operations on `ScheduleItem[]` (title, description, dueDate, completed, tags)
- `useChat()` — Chat message history and API integration
- `useEffortLog()` — Activity tracking (type: "chat" | "schedule_complete" | "photo_check" | "custom")
- `useTags()` — Tag management for schedule categorization
- `useLocalStorage()` — Generic hook wrapping browser localStorage
- `useEffortLog()` — Effort/activity history by date

Data persists to localStorage with keys like `"grass-secretary-schedules"`, `"grass-secretary-chat"`, etc.

### UI Components

- **Shadcn-style components:** Located in `src/components/ui/`, built on Radix UI
- **Styling:** Tailwind CSS v4 + tailwindcss/vite plugin
- **Icons:** Lucide React (react icons)
- **Path alias:** `@/*` → `./src/*` in tsconfig

### Key Services

- **sakuraAI.ts** — Claude API integration for AI responses
- **chatService.ts** — Chat completion and message handling
- **speechService.ts** — Text-to-speech capability

## Key Conventions

### Types

All types live in `src/types/index.ts`. Key interfaces:

```typescript
interface ScheduleItem {
  id: string; // "schedule-{timestamp}"
  title: string;
  description?: string;
  dueDate: Date;
  completed: boolean;
  tags: Tag[]; // Array of Tag objects (not category string)
  createdAt: Date;
}

interface Tag {
  id: string; // "tag-1", "tag-2", etc.
  name: string;
  color: string; // Hex color code
  createdAt: Date;
}

interface EffortLog {
  date: string; // "YYYY-MM-DD"
  count: number;
  activities: EffortActivity[];
}

interface EffortActivity {
  id: string;
  type: "chat" | "schedule_complete" | "photo_check" | "custom";
  description: string;
  timestamp: Date;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  audioUrl?: string;
}
```

### Hook Patterns

Custom hooks return callback functions and state:

```typescript
const {
  schedules,
  addSchedule,
  updateSchedule,
  deleteSchedule,
  toggleComplete,
  getUpcoming,
  getOverdue,
  getSchedulesByDate,
  getDatesWithSchedules,
} = useSchedule();
```

All hooks use `useCallback` to prevent unnecessary re-renders in child components.

### Component Props

- **className:** Always include for Tailwind styling flexibility
- **selectedDate/onDateSelect:** Calendar selection pattern (optional)
- **Dialog state management:** Use `useState` for `open` and `onOpenChange` callbacks

### Date Handling

- Store as `Date` objects in state
- Use `formatDateKey(date)` to convert to "YYYY-MM-DD" strings
- Calendar component expects `selectedDate: Date | null` and event map with "YYYY-MM-DD" keys

### Tag System

- Predefined colors in `useTags()` via `DEFAULT_COLORS`
- Schedule items reference tags by array (not a single category)
- `tag-1` is reserved as "重要" (important) default tag

### Mobile Responsiveness

- Layout toggles between "single" (one panel) and "dashboard" (grid layout)
- Sidebar hidden on `sm` breakpoint, shown as bottom nav on mobile
- Use `hidden sm:flex` and responsive grid (`lg:col-span-2`) patterns

### Effort Tracking

Activities auto-logged when:

- User completes a schedule item
- Chat message sent
- Photo check performed
- Custom activity logged manually

## View Modes

App supports two layouts:

1. **Single Tab View:** Navigation via Sidebar on left (desktop) or bottom (mobile), one panel at a time
2. **Dashboard View:** Grid layout showing Chat + Schedule side-by-side, Effort Grass and Photo Checker below

Toggle via Header component; mobile has dedicated UI below content.

## Testing

Tests are located in `src/__tests__/` mirroring src structure (e.g., `src/__tests__/hooks/useSchedule.test.ts`).

Test utilities imported from `vite-plus/test` (not `vitest`):

```typescript
import { expect, test, vi } from "vite-plus/test";
```

Test environment is jsdom with globals enabled (see vite.config.ts).

## Development Tips

- **Environment:** Configure API keys in `.env` (check `.env.example` for required variables)
- **Date consistency:** Always convert API responses to Date objects; store "YYYY-MM-DD" keys for maps
- **Component composition:** Prefer composition with callback props over prop drilling (e.g., `onEdit`, `onDelete`, `onToggleComplete`)
- **Effort logging:** Remember to call `addActivity()` when user performs significant actions
- **Tag selection UI:** Use the badge+selection pattern in modals (border-2 with scale-105 when selected)
