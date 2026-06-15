import { describe, it, expect } from "vitest";
import {
  buildFallbackCitizens,
  citizensFromData,
  cityTitle,
  computeDistricts,
  computeStats,
  levelForXp,
  progressionDelta,
  xpForLevelStart,
} from "@/components/city/gamify";
import type { RawCityData } from "@/components/city/types";

function emptyRaw(over: Partial<RawCityData> = {}): RawCityData {
  return {
    agents: [], sessions: [], tasks: [], cronJobs: [], skills: [],
    channels: [], memory: null, services: { gateway: "off", vllm: "off" },
    ...over,
  };
}

describe("leveling curve", () => {
  it("level 1 starts at 0 XP and is monotonically increasing", () => {
    expect(xpForLevelStart(1)).toBe(0);
    for (let l = 1; l < 30; l++) {
      expect(xpForLevelStart(l + 1)).toBeGreaterThan(xpForLevelStart(l));
    }
  });

  it("levelForXp returns a sane level + bounded progress", () => {
    const a = levelForXp(0);
    expect(a.level).toBe(1);
    expect(a.levelProgress).toBeGreaterThanOrEqual(0);

    const start3 = xpForLevelStart(3);
    expect(levelForXp(start3).level).toBe(3);
    expect(levelForXp(start3).xpIntoLevel).toBe(0);

    const mid = levelForXp(start3 + 1);
    expect(mid.levelProgress).toBeGreaterThan(0);
    expect(mid.levelProgress).toBeLessThanOrEqual(1);
  });

  it("never returns negative XP and clamps garbage", () => {
    expect(levelForXp(-50).level).toBe(1);
  });

  it("city title grows with level", () => {
    expect(cityTitle(1)).toBe("Outpost");
    expect(cityTitle(50)).toBe("Megalopolis");
  });
});

describe("citizen mapping + fallback", () => {
  it("returns [] for empty data so the store can fall back", () => {
    expect(citizensFromData(emptyRaw())).toEqual([]);
  });

  it("builds a lively, deterministic demo population", () => {
    const a = buildFallbackCitizens(9);
    const b = buildFallbackCitizens(9);
    expect(a).toHaveLength(9);
    expect(a.map(c => c.id)).toEqual(b.map(c => c.id));
    expect(a.some(c => c.busy)).toBe(true);
  });

  it("maps real agents to citizens and marks running tasks busy", () => {
    const raw = emptyRaw({
      agents: [{ id: "main", identityName: "Main Owl", model: "anthropic/claude" }],
      tasks: [{ id: "t1", agentId: "main", status: "running", label: "indexing memory" }],
    });
    const citizens = citizensFromData(raw);
    const main = citizens.find(c => c.id === "agent:main");
    expect(main).toBeTruthy();
    expect(main!.busy).toBe(true);
    expect(main!.workId).toBe("library"); // routed by "memory" keyword
  });
});

describe("districts + stats", () => {
  it("flags subsystem districts active from signals", () => {
    const raw = emptyRaw({
      cronJobs: [{ id: "c1", enabled: true }],
      channels: [{ id: "ch1", status: "connected" }],
      services: { gateway: "ready", vllm: "ready" },
    });
    const districts = computeDistricts(buildFallbackCitizens(), raw);
    expect(districts.clocktower.active).toBe(true);
    expect(districts.comms.active).toBe(true);
    expect(districts.powerplant.active).toBe(true);
  });

  it("computes productivity + bounded happiness", () => {
    const citizens = buildFallbackCitizens(9);
    const stats = computeStats(citizens, 500, 12, { gateway: "ready", vllm: "ready" });
    expect(stats.population).toBe(9);
    expect(stats.productivity).toBeGreaterThanOrEqual(0);
    expect(stats.productivity).toBeLessThanOrEqual(100);
    expect(stats.happiness).toBeGreaterThanOrEqual(0);
    expect(stats.happiness).toBeLessThanOrEqual(100);
    expect(stats.tasksCompleted).toBe(12);
  });
});

describe("progression", () => {
  it("awards XP for newly completed tasks (real data)", () => {
    const raw = emptyRaw({ tasks: [{ id: "t1", status: "done" }, { id: "t2", status: "completed" }] });
    const d = progressionDelta([], raw, 50, false);
    expect(d.completedGain).toBe(2);
    expect(d.xpGain).toBeGreaterThanOrEqual(60);
    expect(d.newDoneIds).toContain("t1");
  });

  it("does not re-award already-seen completed tasks", () => {
    const raw = emptyRaw({ tasks: [{ id: "t1", status: "done" }] });
    const d = progressionDelta(["t1"], raw, 0, false);
    expect(d.completedGain).toBe(0);
  });
});
