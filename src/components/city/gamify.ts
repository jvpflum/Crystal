import type {
  Citizen,
  CitizenKind,
  CityStats,
  DistrictActivity,
  DistrictId,
  RawCityData,
  ServiceState,
} from "./types";
import { ACCENT, DISTRICTS } from "./theme";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — pure game logic
   Mapping real Crystal data → citizens + districts + stats, plus
   the leveling curve and a lively demo population for empty data.
   Everything here is deterministic & side-effect free (easy to test).
   ═══════════════════════════════════════════════════════════════ */

// ─── Leveling curve ────────────────────────────────────────────

/** Cumulative XP required to *reach* a given level (level 1 = 0 XP). */
export function xpForLevelStart(level: number): number {
  if (level <= 1) return 0;
  // Smooth, slightly super-linear curve: feels rewarding early, longer later.
  return Math.round(120 * (level - 1) + 40 * (level - 1) * (level - 1));
}

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  levelProgress: number;
}

export function levelForXp(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  while (xpForLevelStart(level + 1) <= safeXp && level < 999) level++;
  const start = xpForLevelStart(level);
  const next = xpForLevelStart(level + 1);
  const span = Math.max(1, next - start);
  const into = safeXp - start;
  return {
    level,
    xpIntoLevel: into,
    xpForLevel: span,
    levelProgress: Math.max(0, Math.min(1, into / span)),
  };
}

const TITLES: [number, string][] = [
  [1, "Outpost"],
  [3, "Hamlet"],
  [5, "Village"],
  [8, "Township"],
  [12, "Town"],
  [16, "City"],
  [22, "Metropolis"],
  [30, "Megalopolis"],
];

export function cityTitle(level: number): string {
  let title = TITLES[0][1];
  for (const [lv, name] of TITLES) if (level >= lv) title = name;
  return title;
}

// ─── Citizen mapping ───────────────────────────────────────────

const ROLE_HOME: Record<string, DistrictId> = {
  main: "townhall",
  research: "library",
  finance: "forge",
  home: "cafe",
};

const KIND_EMOJI: Record<CitizenKind, string> = {
  agent: "🦉",
  subagent: "🤖",
  session: "💬",
  resident: "🧑",
};

const ROLE_EMOJI: Record<string, string> = {
  main: "🦉",
  research: "🔬",
  finance: "💰",
  home: "🏡",
};

const PALETTE = [
  ACCENT.townhall, ACCENT.residences, ACCENT.library, ACCENT.forge,
  ACCENT.comms, ACCENT.workshop, ACCENT.cafe, ACCENT.clocktower,
];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function str(v: unknown): string { return v == null ? "" : String(v); }

const TASK_DISTRICT: [RegExp, DistrictId][] = [
  [/cron|schedule/i, "clocktower"],
  [/build|skill|forge|compile/i, "forge"],
  [/memory|search|embed|recall|index/i, "library"],
  [/channel|message|telegram|matrix|notify/i, "comms"],
  [/tool|mcp|exec/i, "workshop"],
  [/chat|conversation|reply|respond/i, "cafe"],
  [/model|gpu|infer|vllm/i, "powerplant"],
];

function districtForTask(task: string, fallback: DistrictId): DistrictId {
  for (const [re, id] of TASK_DISTRICT) if (re.test(task)) return id;
  return fallback;
}

export function isTaskRunning(t: Record<string, unknown>): boolean {
  const s = str(t.status ?? t.state).toLowerCase();
  return s === "running" || s === "in_progress" || s === "active" || s === "started";
}

export function isTaskDone(t: Record<string, unknown>): boolean {
  const s = str(t.status ?? t.state).toLowerCase();
  return s === "done" || s === "completed" || s === "complete" || s === "success" || s === "succeeded" || s === "finished";
}

function taskLabel(t: Record<string, unknown>): string {
  return str(t.label ?? t.message ?? t.title ?? t.name ?? t.kind ?? t.type ?? "working").slice(0, 48);
}

/** Build citizens from real Crystal data. Returns [] when there's nothing live. */
export function citizensFromData(data: RawCityData): Citizen[] {
  const citizens: Citizen[] = [];
  const running = data.tasks.filter(isTaskRunning);

  for (const raw of data.agents) {
    const id = str(raw.id ?? raw.identityName);
    if (!id) continue;
    const name = str(raw.identityName ?? raw.name ?? raw.id) || id;
    const short = name.length > 14 ? name.split(/[\s(]/)[0].slice(0, 14) : name;
    const agentTasks = running.filter(t => str(t.agentId ?? t.agent) === id);
    const busy = agentTasks.length > 0;
    const task = busy ? taskLabel(agentTasks[0]) : "";
    const home = ROLE_HOME[id] ?? "residences";
    citizens.push({
      id: `agent:${id}`,
      name: short,
      role: busy ? "On task" : "Agent",
      kind: "agent",
      emoji: ROLE_EMOJI[id] ?? KIND_EMOJI.agent,
      color: colorFor(id),
      homeId: home,
      workId: busy ? districtForTask(`${task} ${str(agentTasks[0].kind)}`, "townhall") : home,
      busy,
      task,
      model: str(raw.model) || undefined,
    });
  }

  // Live chat / conversation sessions become citizens hanging around the café.
  const sessions = data.sessions.filter(s => {
    const k = str(s.kind ?? s.type).toLowerCase();
    return k === "" || k.includes("chat") || k.includes("conversation") || k.includes("session");
  });
  for (let i = 0; i < sessions.length && i < 8; i++) {
    const s = sessions[i];
    const id = str(s.id ?? s.sessionId ?? `s${i}`);
    citizens.push({
      id: `session:${id}`,
      name: str(s.title ?? s.name ?? `Session ${i + 1}`).slice(0, 14) || `Visitor ${i + 1}`,
      role: "Visitor",
      kind: "session",
      emoji: KIND_EMOJI.session,
      color: colorFor(`sess${id}`),
      homeId: "cafe",
      workId: "cafe",
      busy: str(s.status ?? s.state).toLowerCase() === "active",
      task: "",
    });
  }

  // Running tasks with no owning agent become roaming "subagent" workers.
  const orphanTasks = running.filter(t => !str(t.agentId ?? t.agent));
  for (let i = 0; i < orphanTasks.length && i < 6; i++) {
    const t = orphanTasks[i];
    const label = taskLabel(t);
    const work = districtForTask(`${label} ${str(t.kind)}`, "forge");
    citizens.push({
      id: `task:${str(t.id ?? i)}`,
      name: `Worker ${i + 1}`,
      role: "Subagent",
      kind: "subagent",
      emoji: KIND_EMOJI.subagent,
      color: colorFor(`task${i}`),
      homeId: "residences",
      workId: work,
      busy: true,
      task: label,
    });
  }

  return citizens;
}

// ─── Demo / fallback population ────────────────────────────────

const DEMO_NAMES = [
  "Ada", "Cyrus", "Mira", "Otis", "Juno", "Bram", "Nova", "Pax",
  "Wren", "Idris", "Soren", "Vale", "Echo", "Lyra", "Quill", "Rune",
];
const DEMO_ROLES: { role: string; kind: CitizenKind; work: DistrictId; emoji: string; task: string }[] = [
  { role: "Researcher", kind: "agent", work: "library", emoji: "🔬", task: "Indexing memory" },
  { role: "Builder", kind: "subagent", work: "forge", emoji: "🛠️", task: "Compiling a skill" },
  { role: "Operator", kind: "agent", work: "townhall", emoji: "🦉", task: "Routing requests" },
  { role: "Courier", kind: "subagent", work: "comms", emoji: "📨", task: "Relaying a message" },
  { role: "Tinkerer", kind: "agent", work: "workshop", emoji: "⚙️", task: "Wiring a tool" },
  { role: "Barista", kind: "session", work: "cafe", emoji: "💬", task: "Holding a chat" },
  { role: "Engineer", kind: "subagent", work: "powerplant", emoji: "⚡", task: "Tuning the core" },
  { role: "Timekeeper", kind: "agent", work: "clocktower", emoji: "⏱️", task: "Checking schedules" },
];

/**
 * A lively representative population so the city always looks alive even
 * when live agent/session data is empty (e.g. while a fix is in flight).
 * Deterministic given `count` so re-polls don't churn the world.
 */
export function buildFallbackCitizens(count = 9): Citizen[] {
  const citizens: Citizen[] = [];
  for (let i = 0; i < count; i++) {
    const spec = DEMO_ROLES[i % DEMO_ROLES.length];
    const busy = i % 3 !== 0; // ~2/3 working
    citizens.push({
      id: `demo:${i}`,
      name: DEMO_NAMES[i % DEMO_NAMES.length],
      role: spec.role,
      kind: spec.kind,
      emoji: spec.emoji,
      color: PALETTE[i % PALETTE.length],
      homeId: i % 2 === 0 ? "residences" : "cafe",
      workId: busy ? spec.work : (i % 2 === 0 ? "residences" : "cafe"),
      busy,
      task: busy ? spec.task : "",
    });
  }
  return citizens;
}

// ─── District activity ─────────────────────────────────────────

function emptyDistricts(): Record<DistrictId, DistrictActivity> {
  const out = {} as Record<DistrictId, DistrictActivity>;
  for (const d of DISTRICTS) out[d.id] = { active: false, workers: 0, label: "" };
  return out;
}

export function computeDistricts(citizens: Citizen[], data: RawCityData): Record<DistrictId, DistrictActivity> {
  const out = emptyDistricts();

  for (const c of citizens) {
    if (c.busy) {
      out[c.workId].workers++;
      out[c.workId].active = true;
    }
  }

  // Subsystem signals independent of citizens.
  const cron = data.cronJobs.filter(c => c.enabled !== false).length;
  if (cron > 0) { out.clocktower.active = true; out.clocktower.label = `${cron} job${cron === 1 ? "" : "s"}`; }

  const skills = data.skills.filter(s => (s as Record<string, unknown>).enabled !== false).length;
  if (skills > 0) out.workshop.label = `${skills} tools`;

  const liveCh = data.channels.filter(c => {
    const s = str(c.status ?? c.state).toLowerCase();
    return s === "connected" || s === "active" || c.connected === true;
  }).length;
  if (liveCh > 0) { out.comms.active = true; out.comms.label = `${liveCh} live`; }

  const drawers = Number(data.memory?.drawers ?? 0) || 0;
  if (drawers > 0) out.library.label = `${drawers} drawers`;

  if (data.services.vllm === "ready") { out.powerplant.active = true; out.powerplant.label = "online"; }
  else if (data.services.vllm === "starting") out.powerplant.label = "warming";

  // Fill in worker-count labels where we don't have a richer signal.
  for (const d of DISTRICTS) {
    const a = out[d.id];
    if (!a.label) a.label = a.workers > 0 ? `${a.workers} working` : "quiet";
  }
  return out;
}

// ─── Stats / happiness ─────────────────────────────────────────

export function computeStats(
  citizens: Citizen[],
  xp: number,
  tasksCompleted: number,
  services: { gateway: ServiceState; vllm: ServiceState },
): CityStats {
  const population = citizens.length;
  const working = citizens.filter(c => c.busy).length;
  const productivity = population > 0 ? Math.round((working / population) * 100) : 0;

  const svcScore =
    (services.gateway === "ready" ? 50 : services.gateway === "starting" ? 25 : 0) +
    (services.vllm === "ready" ? 30 : services.vllm === "starting" ? 15 : 0);
  // A little busyness makes citizens happy; being totally idle or maxed both dip slightly.
  const busyBonus = 20 - Math.abs(productivity - 60) * 0.15;
  const happiness = Math.max(0, Math.min(100, Math.round(svcScore + busyBonus)));

  const lvl = levelForXp(xp);
  return {
    population,
    working,
    productivity,
    happiness,
    tasksCompleted,
    xp: Math.floor(xp),
    level: lvl.level,
    xpIntoLevel: lvl.xpIntoLevel,
    xpForLevel: lvl.xpForLevel,
    levelProgress: lvl.levelProgress,
    title: cityTitle(lvl.level),
  };
}

/**
 * Progression increment for a single poll.
 * Awards XP for completed tasks (real signal) plus a small passive trickle
 * proportional to productivity so a busy city keeps leveling. In fallback
 * mode the passive trickle alone keeps progression feeling alive.
 */
export function progressionDelta(
  prevDoneIds: string[],
  data: RawCityData,
  productivity: number,
  usingFallback: boolean,
): { xpGain: number; newDoneIds: string[]; completedGain: number } {
  const doneNow = data.tasks.filter(isTaskDone).map(t => str(t.id ?? t.taskId ?? taskLabel(t)));
  const prevSet = new Set(prevDoneIds);
  const fresh = doneNow.filter(id => id && !prevSet.has(id));

  let xpGain = Math.round((productivity / 100) * 6); // passive: up to ~6 XP/poll
  let completedGain = 0;

  if (!usingFallback) {
    xpGain += fresh.length * 30;
    completedGain += fresh.length;
  } else {
    // Demo: occasionally "complete" something so the counter ticks up believably.
    if (Math.random() < 0.18) { xpGain += 30; completedGain += 1; }
  }

  return { xpGain, newDoneIds: doneNow, completedGain };
}
