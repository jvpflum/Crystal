import { describe, it, expect } from "vitest";
import { NAV_SECTIONS } from "@/components/shell/Navigation";

const ALL_ITEMS = NAV_SECTIONS.flatMap(s => s.items);
const ALL_IDS = ALL_ITEMS.map(i => i.id);

describe("Navigation structure", () => {
  it("does NOT expose Home as a nav item (it lives on the Crystal logo)", () => {
    expect(ALL_IDS).not.toContain("home");
  });

  it("does NOT expose a standalone Skills registry item (folded into Tools & Skills)", () => {
    expect(ALL_IDS).not.toContain("skills");
  });

  it("does NOT contain legacy 'office' or 'acp' entries", () => {
    expect(ALL_IDS).not.toContain("office");
    expect(ALL_IDS).not.toContain("acp");
  });

  it("has unique ids across all sections", () => {
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
  });

  it("defines the curated section groups", () => {
    const sectionIds = NAV_SECTIONS.map(s => s.id);
    expect(sectionIds).toEqual(["workspace", "openclaw", "crystal-os", "system"]);
  });

  it("tucks System away as the only secondary (More) group", () => {
    const secondary = NAV_SECTIONS.filter(s => s.secondary);
    expect(secondary).toHaveLength(1);
    expect(secondary[0].id).toBe("system");
  });

  it("keeps Tools & Skills reachable (skills consolidation target)", () => {
    expect(ALL_IDS).toContain("tools");
  });

  it("all nav items have non-empty labels", () => {
    for (const item of ALL_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
