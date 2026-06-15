import type { District, DayPhase } from "./types";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — art direction
   A clean, modern, slightly toy-like isometric look with a living
   day/night cycle. Bright enough to read as a friendly SimCity town,
   cohesive accent palette per district.
   ═══════════════════════════════════════════════════════════════ */

export const PAL = {
  text: "#eef2ff",
  textDim: "rgba(238,242,255,0.55)",
  grassA: "#3f9d57",
  grassB: "#379150",
  grassC: "#2f8347",
  road: "#3a3f55",
  roadEdge: "#4a5070",
  plaza: "#565d7a",
  water: "#3aa6d6",
  shadow: "rgba(20,16,40,0.22)",
} as const;

/** District accent colors — cohesive, cheerful, distinct. */
export const ACCENT = {
  townhall: "#6c8cff",
  residences: "#4ade80",
  library: "#a78bfa",
  forge: "#fb923c",
  comms: "#22d3ee",
  workshop: "#f472b6",
  cafe: "#a3e635",
  clocktower: "#fbbf24",
  powerplant: "#f87171",
} as const;

/**
 * District layout — placed around a central plaza with radiating roads.
 * Offsets are in screen px relative to map center; oy is the ground anchor.
 */
export const DISTRICTS: District[] = [
  { id: "townhall",   name: "Town Hall",     subtitle: "Command HQ",   ox:    0, oy: -150, w: 46, d: 30, h: 92,  accent: ACCENT.townhall,   roof: "spire",   icon: "🏛️", linkedView: "agents" },
  { id: "residences", name: "The Commons",   subtitle: "Agent Homes",  ox: -190, oy: -64, w: 42, d: 28, h: 58,  accent: ACCENT.residences, roof: "pitched", icon: "🏘️", linkedView: "agents" },
  { id: "library",    name: "Grand Archive", subtitle: "Memory",       ox: -300, oy:  70, w: 40, d: 30, h: 74,  accent: ACCENT.library,    roof: "dome",    icon: "📚", linkedView: "memory" },
  { id: "forge",      name: "The Forge",     subtitle: "Builds & Skills", ox: -190, oy: 196, w: 52, d: 34, h: 56, accent: ACCENT.forge,    roof: "stack",   icon: "🏭", linkedView: "factory" },
  { id: "cafe",       name: "The Terminal",  subtitle: "Conversations", ox:    0, oy: 250, w: 46, d: 30, h: 48,  accent: ACCENT.cafe,       roof: "flat",    icon: "☕", linkedView: "conversation" },
  { id: "workshop",   name: "Tool Works",    subtitle: "Tools",        ox:  190, oy: 196, w: 40, d: 26, h: 54,  accent: ACCENT.workshop,   roof: "pitched", icon: "🛠️", linkedView: "tools" },
  { id: "comms",      name: "Signal Tower",  subtitle: "Channels",     ox:  300, oy:  70, w: 30, d: 22, h: 120, accent: ACCENT.comms,      roof: "antenna", icon: "📡", linkedView: "channels" },
  { id: "powerplant", name: "Power Core",    subtitle: "vLLM · GPU",   ox:  190, oy: -64, w: 44, d: 30, h: 64,  accent: ACCENT.powerplant, roof: "stack",   icon: "⚡", linkedView: "doctor" },
  { id: "clocktower", name: "Clock Tower",   subtitle: "Scheduler",    ox:  118, oy: -176, w: 26, d: 18, h: 132, accent: ACCENT.clocktower, roof: "spire",   icon: "⏱️", linkedView: "command-center", linkedCenterTab: "scheduled" },
];

export const DISTRICT_BY_ID: Record<string, District> = Object.fromEntries(
  DISTRICTS.map(d => [d.id, d]),
);

// ─── Iso grid config ───────────────────────────────────────────
export const TILE_W = 56;
export const TILE_H = 28;
export const GRID = 16;

// ─── Day / night sky palettes ──────────────────────────────────
interface SkyStops { top: string; mid: string; horizon: string; ground: string; }

export const SKY: Record<DayPhase, SkyStops> = {
  dawn:  { top: "#2b3a73", mid: "#7c6aa8", horizon: "#f4a06a", ground: "#caa6c4" },
  day:   { top: "#4f8fe0", mid: "#7fb4ec", horizon: "#cfe7fb", ground: "#bfe0d4" },
  dusk:  { top: "#2a2b63", mid: "#8a4d8f", horizon: "#f2885f", ground: "#7a5a86" },
  night: { top: "#0b1030", mid: "#1a1f4d", horizon: "#2d2f63", ground: "#1d1f44" },
};

/** Whether building windows/lights should glow (dusk + night). */
export function lightsOn(phase: DayPhase): boolean {
  return phase === "dusk" || phase === "night";
}

export function currentDayPhase(d = new Date()): DayPhase {
  const h = d.getHours();
  if (h >= 5 && h < 8) return "dawn";
  if (h >= 8 && h < 17) return "day";
  if (h >= 17 && h < 20) return "dusk";
  return "night";
}

// ─── Color helpers ─────────────────────────────────────────────
function clampByte(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }

/** Parse `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)` into an [r,g,b] triple. */
function parseColor(c: string): [number, number, number] {
  if (c[0] === "#") {
    const h = c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1].split(",").map(s => parseInt(s, 10));
    return [r || 0, g || 0, b || 0];
  }
  return [0, 0, 0];
}

export function shade(color: string, amt: number): string {
  const [r, g, b] = parseColor(color);
  return `rgb(${clampByte(r + amt)},${clampByte(g + amt)},${clampByte(b + amt)})`;
}

export function rgba(color: string, a: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseColor(a);
  const [br, bg, bb] = parseColor(b);
  return `rgb(${clampByte(ar + (br - ar) * t)},${clampByte(ag + (bg - ag) * t)},${clampByte(ab + (bb - ab) * t)})`;
}
