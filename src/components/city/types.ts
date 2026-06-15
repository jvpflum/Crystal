import type { AppView, CommandCenterTabId } from "@/stores/appStore";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — shared types
   A gamified, living mini-city (SimCity meets The Sims) where the
   citizens are Crystal's agents / sessions / subagents and the
   districts are its subsystems.
   ═══════════════════════════════════════════════════════════════ */

export type DistrictId =
  | "townhall"
  | "residences"
  | "library"
  | "forge"
  | "comms"
  | "workshop"
  | "cafe"
  | "clocktower"
  | "powerplant";

export type RoofType = "flat" | "pitched" | "dome" | "spire" | "antenna" | "stack";

export interface District {
  id: DistrictId;
  name: string;
  subtitle: string;
  /** Iso-projected offset from the map center, in screen px. */
  ox: number;
  oy: number;
  /** Footprint half-width / depth, and height, in iso units. */
  w: number;
  d: number;
  h: number;
  accent: string;
  roof: RoofType;
  icon: string;
  linkedView: AppView;
  linkedCenterTab?: CommandCenterTabId;
}

export type CitizenKind = "agent" | "subagent" | "session" | "resident";
export type CitizenState = "idle" | "walking" | "working";

/** Logical inhabitant of the city, produced from Crystal data (or demo fallback). */
export interface Citizen {
  id: string;
  name: string;
  role: string;
  kind: CitizenKind;
  emoji: string;
  color: string;
  homeId: DistrictId;
  workId: DistrictId;
  /** True when actively running a task / live session. */
  busy: boolean;
  task: string;
  model?: string;
}

export interface DistrictActivity {
  active: boolean;
  workers: number;
  /** Short status label shown on the building plaque. */
  label: string;
}

export type DayPhase = "dawn" | "day" | "dusk" | "night";
export type Weather = "clear" | "rain";
export type ServiceState = "off" | "starting" | "ready";

export interface CityStats {
  population: number;
  working: number;
  /** 0–100 — share of citizens actively working. */
  productivity: number;
  /** 0–100 — derived from service health + productivity. */
  happiness: number;
  /** Cumulative tasks completed (persisted across sessions). */
  tasksCompleted: number;
  xp: number;
  level: number;
  /** XP accumulated within the current level. */
  xpIntoLevel: number;
  /** XP span of the current level. */
  xpForLevel: number;
  /** 0–1 progress toward next level. */
  levelProgress: number;
  title: string;
}

export type ActivityKind = "spawn" | "task" | "done" | "level" | "system" | "city";

export interface ActivityEvent {
  id: number;
  text: string;
  kind: ActivityKind;
  color: string;
  time: number;
}

export interface CitySnapshot {
  citizens: Citizen[];
  districts: Record<DistrictId, DistrictActivity>;
  stats: CityStats;
  events: ActivityEvent[];
  dayPhase: DayPhase;
  weather: Weather;
  usingFallback: boolean;
  services: { gateway: ServiceState; vllm: ServiceState };
  lastUpdated: number;
}

/** Raw data pulled (read-only) from the existing stores for one poll. */
export interface RawCityData {
  agents: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  cronJobs: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  channels: Record<string, unknown>[];
  memory: Record<string, unknown> | null;
  services: { gateway: ServiceState; vllm: ServiceState };
}
