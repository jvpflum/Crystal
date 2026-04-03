import { describe, it, expect } from "vitest";
import { escapeShellArg, getToolByName, getEnabledTools, availableTools } from "@/lib/tools";

describe("escapeShellArg", () => {
  it("escapes backticks", () => {
    expect(escapeShellArg("hello`world")).toBe("hello``world");
  });

  it("escapes dollar signs", () => {
    expect(escapeShellArg("$variable")).toBe("`$variable");
  });

  it("escapes double quotes", () => {
    expect(escapeShellArg('say "hello"')).toBe('say `"hello`"');
  });

  it("escapes backslashes", () => {
    expect(escapeShellArg("C:\\Users\\test")).toBe("C:`\\Users`\\test");
  });

  it("replaces newlines with spaces", () => {
    expect(escapeShellArg("line1\nline2\nline3")).toBe("line1 line2 line3");
  });

  it("handles combined special characters", () => {
    const input = 'Run `cmd` with $env and "quotes"\nok';
    const result = escapeShellArg(input);
    expect(result).not.toContain("\n");
    expect(result).toContain("``cmd``");
    expect(result).toContain("`$env");
    expect(result).toContain('`"quotes`"');
  });

  it("handles empty string", () => {
    expect(escapeShellArg("")).toBe("");
  });

  it("passes through safe strings unchanged", () => {
    expect(escapeShellArg("hello world")).toBe("hello world");
  });
});

describe("availableTools", () => {
  it("has all expected tools", () => {
    const names = availableTools.map(t => t.name);
    expect(names).toContain("shell");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_directory");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
  });

  it("each tool has required fields", () => {
    for (const tool of availableTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(["filesystem", "shell", "web", "memory"]).toContain(tool.category);
      expect(typeof tool.enabled).toBe("boolean");
      expect(typeof tool.execute).toBe("function");
    }
  });
});

describe("getToolByName", () => {
  it("returns correct tool", () => {
    const tool = getToolByName("shell");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("shell");
    expect(tool!.category).toBe("shell");
  });

  it("returns undefined for unknown tool", () => {
    expect(getToolByName("nonexistent")).toBeUndefined();
  });
});

describe("getEnabledTools", () => {
  it("returns only enabled tools", () => {
    const enabled = getEnabledTools();
    for (const tool of enabled) {
      expect(tool.enabled).toBe(true);
    }
  });

  it("returns all tools by default (all enabled)", () => {
    expect(getEnabledTools().length).toBe(availableTools.length);
  });
});
