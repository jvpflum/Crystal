import { create } from "zustand";

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
  | "cron"
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
  | "approvals";

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
  setView: (view: AppView) => void;

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

export const useAppStore = create<AppState>((set) => ({
  currentView: "home",
  setView: (view) => set({ currentView: view }),

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
