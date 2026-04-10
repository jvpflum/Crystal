import { create } from "zustand";

export type ResponseStyle = "concise" | "balanced" | "detailed";

interface ChatSettings {
  offlineMode: boolean;
  cloudModel: string;
  temperature: number;
  maxTokens: number;
  topP: number;
  responseStyle: ResponseStyle;
  streamEnabled: boolean;

  setOfflineMode: (v: boolean) => void;
  setCloudModel: (v: string) => void;
  setTemperature: (v: number) => void;
  setMaxTokens: (v: number) => void;
  setTopP: (v: number) => void;
  setResponseStyle: (v: ResponseStyle) => void;
  setStreamEnabled: (v: boolean) => void;
}

const PREFIX = "crystal_chat_";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(PREFIX + key);
    if (v === null) return fallback;
    if (typeof fallback === "number") return parseFloat(v) as unknown as T;
    if (typeof fallback === "boolean") return (v === "true") as unknown as T;
    return v as unknown as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, String(value));
  } catch { /* quota */ }
}

export const useChatSettingsStore = create<ChatSettings>((set) => ({
  offlineMode: load("offlineMode", false),
  cloudModel: load("cloudModel", ""),
  temperature: load("temperature", 0.7),
  maxTokens: load("maxTokens", 1024),
  topP: load("topP", 1.0),
  responseStyle: load<ResponseStyle>("responseStyle", "balanced"),
  streamEnabled: load("streamEnabled", true),

  setOfflineMode: (v) => { save("offlineMode", v); set({ offlineMode: v }); },
  setCloudModel: (v) => { save("cloudModel", v); set({ cloudModel: v }); },
  setTemperature: (v) => { save("temperature", v); set({ temperature: v }); },
  setMaxTokens: (v) => { save("maxTokens", v); set({ maxTokens: v }); },
  setTopP: (v) => { save("topP", v); set({ topP: v }); },
  setResponseStyle: (v) => { save("responseStyle", v); set({ responseStyle: v }); },
  setStreamEnabled: (v) => { save("streamEnabled", v); set({ streamEnabled: v }); },
}));
