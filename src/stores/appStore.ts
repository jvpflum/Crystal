import { create } from "zustand";

export type AppView =
  | "home"
  | "conversation"
  | "agents"
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
  | "browser";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

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
}));
