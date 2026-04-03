import { describe, it, expect } from "vitest";
import type { AppView } from "@/stores/appStore";

const NAV_ITEMS: { id: AppView; label: string; group: string }[] = [
  { id: "home", label: "Home", group: "main" },
  { id: "conversation", label: "Chat", group: "main" },
  { id: "command-center", label: "Center", group: "main" },
  { id: "agents", label: "Agents", group: "openclaw" },
  { id: "factory", label: "Factory", group: "openclaw" },
  { id: "office", label: "Office", group: "openclaw" },
  { id: "marketplace", label: "Skills", group: "openclaw" },
  { id: "models", label: "Models", group: "openclaw" },
  { id: "channels", label: "Channels", group: "openclaw" },
  { id: "memory", label: "Memory", group: "openclaw" },
  { id: "hooks", label: "Hooks", group: "openclaw" },
  { id: "workspace", label: "Workspace", group: "openclaw" },
  { id: "messaging", label: "Messaging", group: "openclaw" },
  { id: "directory", label: "Directory", group: "openclaw" },
  { id: "subagents", label: "Sub-Agents", group: "openclaw" },
  { id: "tools", label: "Tools", group: "system" },
  { id: "security", label: "Security", group: "system" },
  { id: "doctor", label: "Doctor", group: "system" },
  { id: "activity", label: "Activity", group: "system" },
  { id: "settings", label: "Settings", group: "system" },
  { id: "devices", label: "Devices", group: "system" },
  { id: "webhooks", label: "Webhooks", group: "system" },
  { id: "voicecall", label: "Voice", group: "system" },
];

describe("Navigation structure", () => {
  it("does NOT contain ACP (consolidated into Sub-Agents)", () => {
    const ids = NAV_ITEMS.map(n => n.id);
    expect(ids).not.toContain("acp");
  });

  it("contains Sub-Agents", () => {
    const ids = NAV_ITEMS.map(n => n.id);
    expect(ids).toContain("subagents");
  });

  it("has unique ids", () => {
    const ids = NAV_ITEMS.map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has 3 main items", () => {
    expect(NAV_ITEMS.filter(n => n.group === "main")).toHaveLength(3);
  });

  it("has correct group distribution", () => {
    const main = NAV_ITEMS.filter(n => n.group === "main");
    const openclaw = NAV_ITEMS.filter(n => n.group === "openclaw");
    const system = NAV_ITEMS.filter(n => n.group === "system");
    expect(main.length).toBeGreaterThan(0);
    expect(openclaw.length).toBeGreaterThan(0);
    expect(system.length).toBeGreaterThan(0);
    expect(main.length + openclaw.length + system.length).toBe(NAV_ITEMS.length);
  });

  it("all nav items have non-empty labels", () => {
    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
