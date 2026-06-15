import { create } from "zustand";
import { useDataStore } from "@/stores/dataStore";
import { useAppStore } from "@/stores/appStore";
import {
  buildFallbackCitizens,
  citizensFromData,
  computeDistricts,
  computeStats,
  levelForXp,
  progressionDelta,
} from "@/components/city/gamify";
import type {
  ActivityEvent,
  ActivityKind,
  Citizen,
  CitySnapshot,
  DistrictId,
  RawCityData,
  ServiceState,
} from "@/components/city/types";
import { currentDayPhase } from "@/components/city/theme";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — game state store
   Owns ALL city state (kept out of appStore on purpose). Reads the
   existing data/app stores read-only, derives a gamified snapshot,
   and persists progression (XP / level / tasks completed) to disk.
   ═══════════════════════════════════════════════════════════════ */

const PROGRESS_KEY = "crystal_city_progress";
const MAX_EVENTS = 24;

interface PersistedProgress {
  xp: number;
  tasksCompleted: number;
  doneIds: string[];
  peakPopulation: number;
}

function loadProgress(): PersistedProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<PersistedProgress>;
      return {
        xp: Math.max(0, Number(p.xp) || 0),
        tasksCompleted: Math.max(0, Number(p.tasksCompleted) || 0),
        doneIds: Array.isArray(p.doneIds) ? p.doneIds.slice(-200) : [],
        peakPopulation: Math.max(0, Number(p.peakPopulation) || 0),
      };
    }
  } catch { /* ignore */ }
  return { xp: 0, tasksCompleted: 0, doneIds: [], peakPopulation: 0 };
}

function saveProgress(p: PersistedProgress) {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* quota */ }
}

function initialSnapshot(progress: PersistedProgress): CitySnapshot {
  const citizens = buildFallbackCitizens();
  return {
    citizens,
    districts: computeDistricts(citizens, {
      agents: [], sessions: [], tasks: [], cronJobs: [], skills: [],
      channels: [], memory: null, services: { gateway: "off", vllm: "off" },
    }),
    stats: computeStats(citizens, progress.xp, progress.tasksCompleted, { gateway: "off", vllm: "off" }),
    events: [],
    dayPhase: currentDayPhase(),
    weather: "clear",
    usingFallback: true,
    services: { gateway: "off", vllm: "off" },
    lastUpdated: 0,
  };
}

interface CityState {
  snapshot: CitySnapshot;
  _progress: PersistedProgress;
  _eventSeq: number;
  _prevCitizenIds: Set<string>;
  poll: () => Promise<void>;
}

function readServices(): { gateway: ServiceState; vllm: ServiceState } {
  try {
    const ss = useAppStore.getState().serviceStatus;
    return { gateway: ss.gateway, vllm: ss.vllm };
  } catch {
    return { gateway: "off", vllm: "off" };
  }
}

async function fetchRaw(): Promise<RawCityData> {
  const ds = useDataStore.getState();
  const [agents, sessions, tasks, cronJobs, skills, channelStatus, memory] = await Promise.all([
    ds.getAgents().catch(() => []),
    ds.getSessions().catch(() => []),
    ds.getTasks().catch(() => []),
    ds.getCronJobs().catch(() => []),
    ds.getSkills().catch(() => []),
    ds.getChannelStatus().catch(() => ({})),
    ds.getMemoryStatus().catch(() => ({})),
  ]);
  const chRaw = channelStatus as Record<string, unknown>;
  const channels = Array.isArray(chRaw?.channels) ? chRaw.channels as Record<string, unknown>[] : [];
  return {
    agents: (agents ?? []) as Record<string, unknown>[],
    sessions: (sessions ?? []) as Record<string, unknown>[],
    tasks: (tasks ?? []) as Record<string, unknown>[],
    cronJobs: (cronJobs ?? []) as Record<string, unknown>[],
    skills: (skills ?? []) as Record<string, unknown>[],
    channels,
    memory: (memory ?? {}) as Record<string, unknown>,
    services: readServices(),
  };
}

export const useCityStore = create<CityState>((set, get) => {
  const progress = loadProgress();
  return {
    snapshot: initialSnapshot(progress),
    _progress: progress,
    _eventSeq: 1,
    _prevCitizenIds: new Set(buildFallbackCitizens().map(c => c.id)),

    poll: async () => {
      let raw: RawCityData;
      try {
        raw = await fetchRaw();
      } catch {
        return;
      }

      const prev = get();
      const newEvents: ActivityEvent[] = [];
      let seq = prev._eventSeq;
      const pushEvent = (text: string, kind: ActivityKind, color: string) => {
        newEvents.push({ id: seq++, text, kind, color, time: Date.now() });
      };

      let citizens = citizensFromData(raw);
      const usingFallback = citizens.length === 0;
      if (usingFallback) citizens = buildFallbackCitizens();

      // Diff arrivals (skip noise on the very first real poll from demo set).
      const ids = new Set(citizens.map(c => c.id));
      if (!usingFallback) {
        for (const c of citizens) {
          if (!prev._prevCitizenIds.has(c.id) && prev.snapshot.lastUpdated > 0) {
            pushEvent(`${c.name} arrived in the city`, "spawn", c.color);
          }
        }
      }

      const productivity = citizens.length > 0
        ? Math.round((citizens.filter(c => c.busy).length / citizens.length) * 100)
        : 0;

      // Progression
      const delta = progressionDelta(prev._progress.doneIds, raw, productivity, usingFallback);
      const prevLevel = levelForXp(prev._progress.xp).level;
      const nextProgress: PersistedProgress = {
        xp: prev._progress.xp + delta.xpGain,
        tasksCompleted: prev._progress.tasksCompleted + delta.completedGain,
        doneIds: delta.newDoneIds.slice(-200),
        peakPopulation: Math.max(prev._progress.peakPopulation, citizens.length),
      };
      const nextLevel = levelForXp(nextProgress.xp).level;
      if (delta.completedGain > 0 && !usingFallback) {
        pushEvent(`Completed ${delta.completedGain} task${delta.completedGain === 1 ? "" : "s"}`, "done", "#4ade80");
      }
      if (nextLevel > prevLevel) {
        pushEvent(`City reached level ${nextLevel}!`, "level", "#fbbf24");
      }
      saveProgress(nextProgress);

      const services = raw.services;
      const districts = computeDistricts(citizens, raw);
      const stats = computeStats(citizens, nextProgress.xp, nextProgress.tasksCompleted, services);
      const weather = services.gateway === "off" ? "rain" : "clear";

      // Service status transitions
      if (services.gateway !== prev.snapshot.services.gateway) {
        pushEvent(
          services.gateway === "ready" ? "Gateway online" : services.gateway === "starting" ? "Gateway warming up" : "Gateway offline",
          "system",
          services.gateway === "ready" ? "#4ade80" : "#f87171",
        );
      }

      const events = [...prev.snapshot.events, ...newEvents].slice(-MAX_EVENTS);

      set({
        snapshot: {
          citizens,
          districts,
          stats,
          events,
          dayPhase: currentDayPhase(),
          weather,
          usingFallback,
          services,
          lastUpdated: Date.now(),
        },
        _progress: nextProgress,
        _eventSeq: seq,
        _prevCitizenIds: ids,
      });
    },
  };
});

/** Stable selector helpers (avoid re-renders from unrelated fields). */
export const selectStats = (s: CityState) => s.snapshot.stats;
export const selectEvents = (s: CityState) => s.snapshot.events;
export const selectCitizens = (s: CityState): Citizen[] => s.snapshot.citizens;
export const selectDistrict = (id: DistrictId) => (s: CityState) => s.snapshot.districts[id];
