import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore, THEMES } from "@/stores/themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("has 11 themes", () => {
    expect(THEMES).toHaveLength(11);
  });

  it("all themes have valid structure", () => {
    for (const theme of THEMES) {
      expect(theme.id).toBeTruthy();
      expect(theme.name).toBeTruthy();
      expect(theme.description).toBeTruthy();
      expect(theme.preview).toHaveLength(4);
      expect(theme.colors).toBeDefined();

      const { colors } = theme;
      expect(colors.bgBase).toBeTruthy();
      expect(colors.bgSurface).toBeTruthy();
      expect(colors.text).toBeTruthy();
      expect(colors.accent).toBeTruthy();
      expect(colors.success).toBeTruthy();
      expect(colors.error).toBeTruthy();
      expect(colors.warning).toBeTruthy();
    }
  });

  it("has all expected theme ids", () => {
    const ids = THEMES.map(t => t.id);
    expect(ids).toContain("midnight");
    expect(ids).toContain("socal");
    expect(ids).toContain("arctic");
    expect(ids).toContain("ember");
    expect(ids).toContain("slate");
    expect(ids).toContain("nvidia");
    expect(ids).toContain("cyberpunk");
    expect(ids).toContain("forest");
    expect(ids).toContain("ocean");
    expect(ids).toContain("rose");
    expect(ids).toContain("aurora");
  });

  it("defaults to midnight theme", () => {
    expect(useThemeStore.getState().themeId).toBe("midnight");
  });

  it("changes theme", () => {
    useThemeStore.getState().setTheme("nvidia");
    expect(useThemeStore.getState().themeId).toBe("nvidia");
  });

  it("getTheme returns correct theme object", () => {
    useThemeStore.getState().setTheme("ember");
    const theme = useThemeStore.getState().getTheme();
    expect(theme.id).toBe("ember");
    expect(theme.name).toBe("Ember");
  });

  it("ignores invalid theme ids", () => {
    useThemeStore.getState().setTheme("midnight");
    useThemeStore.getState().setTheme("nonexistent");
    expect(useThemeStore.getState().themeId).toBe("midnight");
  });

  it("persists theme to localStorage", () => {
    useThemeStore.getState().setTheme("socal");
    expect(localStorage.getItem("crystal_theme")).toBe("socal");
  });

  it("arctic and slate are light themes", () => {
    const arctic = THEMES.find(t => t.id === "arctic")!;
    const slate = THEMES.find(t => t.id === "slate")!;
    expect(arctic.colors.bgBase).toMatch(/^#[ef]/i);
    expect(slate.colors.bgBase).toMatch(/^#[ef]/i);
  });

  it("dark themes have dark backgrounds", () => {
    const dark = THEMES.filter(t => !["arctic", "slate"].includes(t.id));
    for (const theme of dark) {
      const hex = theme.colors.bgBase;
      const r = parseInt(hex.slice(1, 3), 16);
      expect(r).toBeLessThan(50);
    }
  });
});
