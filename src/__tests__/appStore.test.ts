import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore, type AppView } from "@/stores/appStore";

describe("appStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      currentView: "home",
      pendingCommandCenterTab: null,
      voiceState: "idle",
      isMinimized: false,
      transcript: "",
      gatewayConnected: false,
      thinkingLevel: undefined,
    });
  });

  it("starts with home view", () => {
    expect(useAppStore.getState().currentView).toBe("home");
  });

  it("changes view", () => {
    useAppStore.getState().setView("conversation");
    expect(useAppStore.getState().currentView).toBe("conversation");
  });

  it("accepts all valid AppView values", () => {
    const views: AppView[] = [
      "home", "conversation", "command-center", "agents", "office",
      "factory", "models", "sessions", "templates",
      "channels", "memory", "tools", "activity", "settings",
      "security", "hooks", "doctor", "nodes", "browser", "workspace",
      "messaging", "directory", "devices", "subagents", "webhooks", "voicecall",
    ];
    for (const view of views) {
      useAppStore.getState().setView(view);
      expect(useAppStore.getState().currentView).toBe(view);
    }
  });

  it("opens Command Center with a specific tab", () => {
    useAppStore.getState().setView("command-center", { centerTab: "scheduled" });
    expect(useAppStore.getState().currentView).toBe("command-center");
    expect(useAppStore.getState().pendingCommandCenterTab).toBe("scheduled");
    useAppStore.getState().clearPendingCommandCenterTab();
    expect(useAppStore.getState().pendingCommandCenterTab).toBeNull();
  });

  it("does not include 'acp' as a valid view (consolidated into subagents)", () => {
    const state = useAppStore.getState();
    state.setView("subagents");
    expect(state.currentView).not.toBe("acp");
  });

  it("manages voice state", () => {
    useAppStore.getState().setVoiceState("listening");
    expect(useAppStore.getState().voiceState).toBe("listening");

    useAppStore.getState().setVoiceState("processing");
    expect(useAppStore.getState().voiceState).toBe("processing");
  });

  it("manages minimized state", () => {
    expect(useAppStore.getState().isMinimized).toBe(false);
    useAppStore.getState().setMinimized(true);
    expect(useAppStore.getState().isMinimized).toBe(true);
  });

  it("manages transcript", () => {
    useAppStore.getState().setTranscript("Hello world");
    expect(useAppStore.getState().transcript).toBe("Hello world");
  });

  it("manages gateway connection state", () => {
    expect(useAppStore.getState().gatewayConnected).toBe(false);
    useAppStore.getState().setGatewayConnected(true);
    expect(useAppStore.getState().gatewayConnected).toBe(true);
  });

  it("manages thinking level", () => {
    expect(useAppStore.getState().thinkingLevel).toBeUndefined();

    useAppStore.getState().setThinkingLevel("auto");
    expect(useAppStore.getState().thinkingLevel).toBe("auto");

    useAppStore.getState().setThinkingLevel("high");
    expect(useAppStore.getState().thinkingLevel).toBe("high");

    useAppStore.getState().setThinkingLevel(undefined);
    expect(useAppStore.getState().thinkingLevel).toBeUndefined();
  });

  it("cycles thinking levels", () => {
    const store = useAppStore.getState();

    store.cycleThinkingLevel();
    expect(useAppStore.getState().thinkingLevel).toBe("auto");

    useAppStore.getState().cycleThinkingLevel();
    expect(useAppStore.getState().thinkingLevel).toBe("minimal");

    useAppStore.getState().cycleThinkingLevel();
    expect(useAppStore.getState().thinkingLevel).toBe("medium");

    useAppStore.getState().cycleThinkingLevel();
    expect(useAppStore.getState().thinkingLevel).toBe("high");

    useAppStore.getState().cycleThinkingLevel();
    expect(useAppStore.getState().thinkingLevel).toBeUndefined();
  });

  it("persists thinking level to localStorage", () => {
    useAppStore.getState().setThinkingLevel("medium");
    expect(localStorage.getItem("crystal_thinking_level")).toBe("medium");

    useAppStore.getState().setThinkingLevel(undefined);
    expect(localStorage.getItem("crystal_thinking_level")).toBeNull();
  });
});
