import { create } from "zustand";

export type CommandCenterTabId = "calendar" | "workflows" | "scheduled" | "heartbeat";

export type AppView =
  | "home"
  | "conversation"
  | "command-center"
  | "agents"
  | "office"
  | "factory"
  | "marketplace"
  | "models"
  | "sessions"
  | "templates"
  | "channels"
  | "memory"
  | "tools"
  | "activity"
  | "settings"
  | "security"
  | "hooks"
  | "doctor"
  | "nodes"
  | "browser"
  | "workspace"
  | "messaging"
  | "directory"
  | "devices"
  | "subagents"
  | "webhooks"
  | "voicecall"
  | "tasks"
  | "approvals"
  | "city"
  | "usage";

export type VoiceState =
  | "idle"
  | "listening"
  | "processing"
  | "thinking"
  | "transcribing"
  | "awaiting_confirmation"
  | "executing"
  | "speaking"
  | "error";

export type ThinkingLevel = "auto" | "minimal" | "medium" | "high";

interface AppState {
  currentView: AppView;
  /** When opening Command Center, switch to this tab once (then cleared). */
  pendingCommandCenterTab: CommandCenterTabId | null;
  setView: (view: AppView, opts?: { centerTab?: CommandCenterTabId }) => void;
  clearPendingCommandCenterTab: () => void;

  voiceState: VoiceState;
  setVoiceState: (state: VoiceState) => void;

  isMinimized: boolean;
  setMinimized: (minimized: boolean) => void;

  transcript: string;
  setTranscript: (text: string) => void;

  gatewayConnected: boolean;
  setGatewayConnected: (c: boolean) => void;

  thinkingLevel: ThinkingLevel | undefined;
  setThinkingLevel: (level: ThinkingLevel | undefined) => void;
  cycleThinkingLevel: () => void;
}

const PERSISTED_VIEW_KEY = "crystal_current_view";

const VALID_VIEWS = new Set<string>([
  "home", "conversation", "command-center", "agents", "office", "factory",
  "marketplace", "models", "sessions", "templates", "channels", "memory",
  "tools", "activity", "settings", "security", "hooks", "doctor", "nodes",
  "browser", "workspace", "messaging", "directory", "devices", "subagents",
  "webhooks", "voicecall", "tasks", "approvals", "city", "usage",
]);

function loadPersistedNavigation(): { view: AppView; centerTab: CommandCenterTabId | null } {
  try {
    const saved = localStorage.getItem(PERSISTED_VIEW_KEY);
    if (saved === "cron") {
      localStorage.setItem(PERSISTED_VIEW_KEY, "command-center");
      return { view: "command-center", centerTab: "scheduled" };
    }
    if (saved === "office") {
      localStorage.setItem(PERSISTED_VIEW_KEY, "agents");
      return { view: "agents", centerTab: null };
    }
    if (saved && VALID_VIEWS.has(saved)) return { view: saved as AppView, centerTab: null };
  } catch { /* ignore */ }
  return { view: "home", centerTab: null };
}

const initialNav = loadPersistedNavigation();

export const useAppStore = create<AppState>((set, get) => ({
  currentView: initialNav.view,
  pendingCommandCenterTab: initialNav.centerTab,
  setView: (view, opts) => {
    const resolved = view === "office" ? "agents" : view;
    let pending = get().pendingCommandCenterTab;
    if (resolved === "command-center") {
      pending = opts?.centerTab ?? null;
    } else {
      pending = null;
    }
    try { localStorage.setItem(PERSISTED_VIEW_KEY, resolved); } catch { /* ignore */ }
    set({ currentView: resolved as AppView, pendingCommandCenterTab: pending });
  },
  clearPendingCommandCenterTab: () => set({ pendingCommandCenterTab: null }),

  voiceState: "idle",
  setVoiceState: (state) => set({ voiceState: state }),

  isMinimized: false,
  setMinimized: (minimized) => set({ isMinimized: minimized }),

  transcript: "",
  setTranscript: (text) => set({ transcript: text }),

  gatewayConnected: false,
  setGatewayConnected: (c) => set({ gatewayConnected: c }),

  thinkingLevel: (localStorage.getItem("crystal_thinking_level") as ThinkingLevel) || undefined,
  setThinkingLevel: (level) => {
    if (level) localStorage.setItem("crystal_thinking_level", level);
    else localStorage.removeItem("crystal_thinking_level");
    set({ thinkingLevel: level });
  },
  cycleThinkingLevel: () => set(state => {
    const order: (ThinkingLevel | undefined)[] = [undefined, "auto", "minimal", "medium", "high"];
    const idx = order.indexOf(state.thinkingLevel);
    const next = order[(idx + 1) % order.length];
    if (next) localStorage.setItem("crystal_thinking_level", next);
    else localStorage.removeItem("crystal_thinking_level");
    return { thinkingLevel: next };
  }),
}));
