import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { openclawClient, SUPPORTED_CHANNELS } from "@/lib/openclaw";

const mockInvoke = vi.mocked(invoke);

describe("openclawClient", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("SUPPORTED_CHANNELS", () => {
    it("has 11 channels", () => {
      expect(SUPPORTED_CHANNELS).toHaveLength(11);
    });

    it("each channel has required fields", () => {
      for (const ch of SUPPORTED_CHANNELS) {
        expect(ch.id).toBeTruthy();
        expect(ch.name).toBeTruthy();
        expect(ch.type).toBeTruthy();
        expect(ch.icon).toBeTruthy();
        expect(ch.description).toBeTruthy();
      }
    });

    it("has all expected platforms", () => {
      const types = SUPPORTED_CHANNELS.map(c => c.type);
      expect(types).toContain("whatsapp");
      expect(types).toContain("discord");
      expect(types).toContain("telegram");
      expect(types).toContain("slack");
      expect(types).toContain("email");
      expect(types).toContain("signal");
      expect(types).toContain("matrix");
      expect(types).toContain("irc");
      expect(types).toContain("linear");
      expect(types).toContain("nostr");
      expect(types).toContain("googlechat");
    });

    it("has unique ids", () => {
      const ids = SUPPORTED_CHANNELS.map(c => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("gateway", () => {
    it("starts disconnected", () => {
      expect(openclawClient.getGatewayStatus()).toBe("disconnected");
    });
  });

  describe("activity log", () => {
    it("starts empty", () => {
      openclawClient.clearActivityLog();
      expect(openclawClient.getActivityLog()).toEqual([]);
    });
  });

  describe("model management", () => {
    it("returns default model when not set", () => {
      localStorage.removeItem("crystal_openclaw_model");
      expect(openclawClient.getModel()).toBeTruthy();
    });

    it("getModels returns empty array on failure", async () => {
      mockInvoke.mockRejectedValue(new Error("not running"));
      const models = await openclawClient.getModels();
      expect(Array.isArray(models)).toBe(true);
    });
  });

  describe("memory path correctness", () => {
    it("getMemory reads from workspace/MEMORY.md (not workspace/memory/MEMORY.md)", async () => {
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "execute_command") {
          return { stdout: "C:\\Users\\test\\.openclaw", code: 0 };
        }
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (path.endsWith("workspace\\MEMORY.md")) {
            return "# Memory\n\n## Test Entry\nSome fact";
          }
          throw new Error("File not found");
        }
        return null;
      });

      const entries = await openclawClient.getMemory();
      expect(entries.length).toBeGreaterThan(0);

      const readCalls = mockInvoke.mock.calls.filter(c => c[0] === "read_file");
      const memoryPath = (readCalls[0]?.[1] as { path: string })?.path ?? "";
      expect(memoryPath).toContain("workspace\\MEMORY.md");
      expect(memoryPath).not.toContain("workspace\\memory\\MEMORY.md");
    });

    it("getDailyMemory reads YYYY-MM-DD.md (not daily-YYYY-MM-DD.md)", async () => {
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "execute_command") {
          return { stdout: "C:\\Users\\test\\.openclaw", stderr: "", code: 0 };
        }
        if (cmd === "read_file") {
          const path = (args as { path: string }).path;
          if (path.match(/memory\\2026-03-20\.md$/)) {
            return "# Daily Log\n\n## Session\nStuff happened";
          }
          throw new Error("File not found");
        }
        return null;
      });

      const entries = await openclawClient.getDailyMemory("2026-03-20");
      expect(entries.length).toBeGreaterThan(0);

      const readCalls = mockInvoke.mock.calls.filter(c => c[0] === "read_file");
      const dailyPath = (readCalls[0]?.[1] as { path: string })?.path ?? "";
      expect(dailyPath).toContain("memory\\2026-03-20.md");
      expect(dailyPath).not.toContain("daily-2026-03-20.md");
    });

    it("addMemory writes curated to workspace/MEMORY.md", async () => {
      const writtenPaths: string[] = [];
      mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
        if (cmd === "execute_command") {
          const command = (args as { command: string }).command;
          if (command.includes("memory index")) return { stdout: "Done", stderr: "", code: 0 };
          return { stdout: "C:\\Users\\test\\.openclaw", stderr: "", code: 0 };
        }
        if (cmd === "read_file") {
          throw new Error("File not found");
        }
        if (cmd === "write_file") {
          writtenPaths.push((args as { path: string }).path);
          return null;
        }
        return null;
      });

      await openclawClient.addMemory("Remember this fact");

      const curatedWrite = writtenPaths.find(p => p.includes("MEMORY.md"));
      expect(curatedWrite).toBeDefined();
      expect(curatedWrite).toContain("workspace\\MEMORY.md");
      expect(curatedWrite).not.toContain("workspace\\memory\\MEMORY.md");

      const dailyWrite = writtenPaths.find(p => p.includes("memory\\") && !p.includes("MEMORY.md"));
      expect(dailyWrite).toBeDefined();
      expect(dailyWrite).not.toContain("daily-");
      expect(dailyWrite).toMatch(/memory\\\d{4}-\d{2}-\d{2}\.md$/);
    });
  });

  describe("parseMemoryMd", () => {
    it("parses markdown sections correctly", async () => {
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === "execute_command") {
          return { stdout: "C:\\Users\\test\\.openclaw", code: 0 };
        }
        if (cmd === "read_file") {
          return `# Crystal User Memory

## User Preferences
- Dark themes
- Minimal UI

## Project Info
Crystal is an AI assistant`;
        }
        return null;
      });

      const entries = await openclawClient.getMemory();
      expect(entries.length).toBe(2);
      expect(entries[0].content).toContain("Dark themes");
      expect(entries[1].content).toContain("Crystal is an AI assistant");
    });
  });
});
