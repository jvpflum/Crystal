import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { cachedCommand, invalidateCache } from "@/lib/cache";

let _openclawHome: string | null = null;
async function getOpenClawHome(): Promise<string> {
  if (_openclawHome) return _openclawHome;
  const r = await invoke<{ stdout: string }>("execute_command", { command: "echo $env:USERPROFILE\\.openclaw", cwd: null });
  _openclawHome = r.stdout.trim().replace(/\r?\n/g, "");
  return _openclawHome;
}

/** CLI string used by `fetchCronJobs`; bust this cache after any cron add/remove/toggle/run. */
export const CRON_LIST_JSON_ALL_CMD = "openclaw cron list --json --all";

export function invalidateCronJobsCliCache(): void {
  invalidateCache(CRON_LIST_JSON_ALL_CMD);
}

/** CLI string used by `fetchSkills`; bust when forcing refresh on Tools → Skills. */
export const SKILLS_LIST_JSON_CMD = "openclaw skills list --json";

export function invalidateSkillsCliCache(): void {
  invalidateCache(SKILLS_LIST_JSON_CMD);
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

type CacheKey = "cronJobs" | "agents" | "memoryStatus" | "systemStatus" | "tasks" | "channelStatus" | "skills" | "sessions";

interface DataState {
  cronJobs: CacheEntry<Record<string, unknown>[]> | null;
  agents: CacheEntry<Record<string, unknown>[]> | null;
  memoryStatus: CacheEntry<Record<string, unknown>> | null;
  systemStatus: CacheEntry<Record<string, unknown>> | null;
  tasks: CacheEntry<Record<string, unknown>[]> | null;
  channelStatus: CacheEntry<Record<string, unknown>> | null;
  skills: CacheEntry<Record<string, unknown>[]> | null;
  sessions: CacheEntry<Record<string, unknown>[]> | null;

  _inflight: Record<string, Promise<unknown>>;
  _hydrated: boolean;
  _lastPrefetch: number;

  hydrateFromDisk: () => void;
  prefetchAll: () => Promise<void>;

  getCronJobs: (force?: boolean) => Promise<Record<string, unknown>[]>;
  getAgents: (force?: boolean) => Promise<Record<string, unknown>[]>;
  getMemoryStatus: (force?: boolean) => Promise<Record<string, unknown>>;
  getSystemStatus: (force?: boolean) => Promise<Record<string, unknown>>;
  getTasks: (force?: boolean) => Promise<Record<string, unknown>[]>;
  getChannelStatus: (force?: boolean) => Promise<Record<string, unknown>>;
  getSkills: (force?: boolean) => Promise<Record<string, unknown>[]>;
  getSessions: (force?: boolean) => Promise<Record<string, unknown>[]>;
  invalidate: (key?: CacheKey) => void;
}

const TTL: Record<CacheKey, number> = {
  skills:        300_000,
  agents:        180_000,
  memoryStatus:  120_000,
  cronJobs:      120_000,
  channelStatus: 120_000,
  systemStatus:   60_000,
  tasks:          30_000,
  sessions:       30_000,
};

const DISK_KEY = "crystal_data_cache";
const DISK_MAX_AGE = 24 * 60 * 60 * 1000;
const PREFETCH_COOLDOWN = 30_000;

function isFresh<T>(entry: CacheEntry<T> | null, ttl: number): entry is CacheEntry<T> {
  return entry !== null && Date.now() - entry.fetchedAt < ttl;
}

function persistToDisk(state: DataState) {
  try {
    const snapshot: Record<string, CacheEntry<unknown>> = {};
    for (const key of Object.keys(TTL) as CacheKey[]) {
      const entry = state[key];
      if (entry) snapshot[key] = entry as CacheEntry<unknown>;
    }
    localStorage.setItem(DISK_KEY, JSON.stringify(snapshot));
  } catch { /* quota or serialisation error */ }
}

function loadFromDisk(): Partial<Record<CacheKey, CacheEntry<unknown>>> {
  try {
    const raw = localStorage.getItem(DISK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CacheEntry<unknown>>;
    const now = Date.now();
    const result: Partial<Record<CacheKey, CacheEntry<unknown>>> = {};
    for (const key of Object.keys(TTL) as CacheKey[]) {
      const entry = parsed[key];
      if (entry && now - entry.fetchedAt < DISK_MAX_AGE) {
        result[key] = entry;
      }
    }
    return result;
  } catch { return {}; }
}

function makeGetter<T>(
  key: CacheKey,
  fetcher: () => Promise<T>,
) {
  return async (force = false): Promise<T> => {
    const state = useDataStore.getState();
    const existing = state[key] as CacheEntry<T> | null;

    if (!force && isFresh(existing, TTL[key])) {
      return existing!.data;
    }

    if (existing && !force) {
      if (!(key in state._inflight)) {
        const bgPromise = fetcher()
          .then(data => {
            useDataStore.setState({ [key]: { data, fetchedAt: Date.now() } } as Partial<DataState>);
            persistToDisk(useDataStore.getState());
          })
          .catch(() => {})
          .finally(() => {
            const inf = { ...useDataStore.getState()._inflight };
            delete inf[key];
            useDataStore.setState({ _inflight: inf });
          });
        useDataStore.setState({ _inflight: { ...state._inflight, [key]: bgPromise } });
      }
      return existing.data;
    }

    if (key in state._inflight) {
      return state._inflight[key]!.then(() => {
        const refreshed = useDataStore.getState()[key] as CacheEntry<T> | null;
        return refreshed?.data ?? (Array.isArray(existing?.data) ? [] : {}) as T;
      });
    }

    const promise = fetcher()
      .then(data => {
        useDataStore.setState({ [key]: { data, fetchedAt: Date.now() } } as Partial<DataState>);
        persistToDisk(useDataStore.getState());
        return data;
      })
      .catch(() => {
        return existing?.data ?? (Array.isArray(existing?.data) ? [] : {}) as T;
      })
      .finally(() => {
        const inf = { ...useDataStore.getState()._inflight };
        delete inf[key];
        useDataStore.setState({ _inflight: inf });
      });

    useDataStore.setState({ _inflight: { ...state._inflight, [key]: promise } });
    return promise;
  };
}

// All fetchers now go through cachedCommand which has a concurrency limiter

async function fetchCronJobs(): Promise<Record<string, unknown>[]> {
  // Primary: read directly from cron jobs file (no gateway dependency)
  try {
    const home = `${await getOpenClawHome()}\\cron\\jobs.json`;
    const raw = await invoke<string>("read_file", { path: home });
    const parsed = JSON.parse(raw);
    const jobs = parsed?.jobs ?? (Array.isArray(parsed) ? parsed : []);
    if (jobs.length > 0) return jobs;
  } catch { /* fall through to CLI */ }
  // Fallback: CLI (may hang if gateway is down)
  const r = await cachedCommand(CRON_LIST_JSON_ALL_CMD, { ttl: 120_000 });
  if (r.code === 0 && r.stdout.trim()) {
    try {
      const p = JSON.parse(r.stdout);
      return Array.isArray(p) ? p : p.jobs ?? [];
    } catch { /* malformed JSON */ }
  }
  return [];
}

async function fetchAgents(): Promise<Record<string, unknown>[]> {
  // Primary: read directly from openclaw.json config (no gateway dependency)
  try {
    const home = await getOpenClawHome();
    const raw = await invoke<string>("read_file", { path: `${home}\\openclaw.json` });
    const cfg = JSON.parse(raw);
    const list = cfg?.agents?.list;
    if (Array.isArray(list) && list.length > 0) {
      const primary = cfg?.agents?.defaults?.model?.primary || "";
      return list.map((a: Record<string, unknown>, i: number) => ({
        ...a,
        model: a.model || primary,
        isDefault: i === 0 || a.id === "main",
        bindings: 0,
        routes: [],
      }));
    }
  } catch { /* fall through to CLI */ }
  // Fallback: CLI (may hang if gateway is down)
  const r = await cachedCommand("openclaw agents list --json", { ttl: 60_000 });
  if (r.code === 0 && r.stdout.trim()) {
    try {
      const d = JSON.parse(r.stdout);
      return Array.isArray(d) ? d : (d.agents ?? d.items ?? []);
    } catch { /* malformed JSON */ }
  }
  return [];
}

/**
 * Unified memory status, post-MemPalace canonical migration.
 *
 * Single source of truth: `python mempalace_query.py status` (JSON one-shot,
 * <100 ms). Returns drawers + wings + rooms + closets + KG node/edge counts +
 * last successful mine timestamp.
 *
 * Backwards-compat shape: still exposes `chunks`/`status.{provider,vector,…}`
 * so legacy consumers in HomeView keep rendering, with `provider="mempalace"`
 * to make the swap obvious.
 */
async function fetchMemoryStatus(): Promise<Record<string, unknown>> {
  const home = await getOpenClawHome();
  const scriptPath = `${home}\\scripts\\mempalace_query.py`;

  let palace: Record<string, unknown> | null = null;
  let palaceError: string | null = null;
  try {
    const r = await cachedCommand(`python "${scriptPath}" status`, { ttl: 60_000, timeout: 8_000 });
    if (r.code === 0 && r.stdout.trim()) {
      try {
        palace = JSON.parse(r.stdout) as Record<string, unknown>;
      } catch (err) {
        palaceError = `parse: ${(err as Error).message}`;
      }
    } else if (r.code !== 0) {
      palaceError = `exit ${r.code}: ${(r.stderr || r.stdout).slice(0, 200)}`;
    }
  } catch (err) {
    palaceError = `spawn: ${(err as Error).message}`;
  }

  // Recall-hook + extension health: confirm the hook plugin is enabled in the
  // gateway config so the UI can flag a misconfiguration even if the palace
  // status itself succeeds.
  let recallHookEnabled = false;
  let recallHookRegistered = false;
  try {
    const cfg = await invoke<string>("read_file", { path: `${home}\\openclaw.json` });
    const parsed = JSON.parse(cfg) as Record<string, unknown>;
    const plugins = (parsed?.plugins as Record<string, unknown>)?.entries as Record<string, unknown> | undefined;
    const recall = plugins?.["palace-recall"] as Record<string, unknown> | undefined;
    recallHookRegistered = !!recall;
    recallHookEnabled = recall?.enabled !== false && !!recall;
  } catch { /* config unreadable */ }

  const drawers = Number(palace?.drawers ?? 0) || 0;
  const wings = Number(palace?.wings ?? 0) || 0;
  const rooms = Number(palace?.rooms ?? 0) || 0;
  const closets = Number(palace?.closets ?? 0) || 0;
  const kgNodes = Number(palace?.kg_nodes ?? 0) || 0;
  const kgEdges = Number(palace?.kg_edges ?? 0) || 0;
  const lastMineAt = (palace?.last_mine_at as string | null | undefined) ?? null;

  const ready = drawers > 0 && !palaceError;

  return {
    // Canonical fields
    provider: "mempalace",
    drawers,
    wings,
    rooms,
    closets,
    kgNodes,
    kgEdges,
    lastMineAt,
    recallHookEnabled,
    recallHookRegistered,
    palacePath: (palace?.palace as string | undefined) ?? null,
    error: palaceError,

    // Backwards-compat for legacy HomeView consumers
    chunks: drawers,
    totalChunks: drawers,
    palaceDrawers: drawers,
    status: {
      chunks: drawers,
      files: drawers,
      dirty: false,
      provider: "mempalace",
      vector: { available: ready },
      fts: { available: ready },
      custom: { searchMode: ready ? "hybrid+kg" : "unavailable" },
    },
  };
}

async function fetchSystemStatus(): Promise<Record<string, unknown>> {
  const r = await cachedCommand("openclaw health", { ttl: 30_000 });
  return { healthy: r.code === 0, text: r.stdout, fetchedAt: Date.now() };
}

async function fetchTasks(): Promise<Record<string, unknown>[]> {
  const r = await cachedCommand("openclaw tasks list --json", { ttl: 30_000 });
  if (r.code === 0 && r.stdout.trim()) {
    try {
      const p = JSON.parse(r.stdout);
      return Array.isArray(p) ? p : p.tasks ?? p.runs ?? [];
    } catch { /* malformed JSON */ }
  }
  return [];
}

async function fetchChannelStatus(): Promise<Record<string, unknown>> {
  const r = await cachedCommand("openclaw channels status --json", { ttl: 60_000 });
  if (r.code === 0 && r.stdout.trim()) {
    try { return JSON.parse(r.stdout); } catch { /* malformed JSON */ }
  }
  return {};
}

/** Parse `openclaw skills list --json` from stdout and/or stderr (CLI may log to either stream). */
export function parseSkillsCliOutput(stdout: string, stderr: string): Record<string, unknown>[] {
  const combined = `${stdout || ""}\n${stderr || ""}`.trim();
  const toArray = (p: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(p)) return p as Record<string, unknown>[];
    if (p && typeof p === "object") {
      const obj = p as Record<string, unknown>;
      const skills =
        obj.skills ??
        obj.items ??
        obj.entries ??
        obj.list ??
        obj.data ??
        obj.results;
      if (Array.isArray(skills)) return skills as Record<string, unknown>[];
    }
    return null;
  };

  const tryParse = (s: string): Record<string, unknown>[] | null => {
    const t = s.trim();
    if (!t) return null;
    try {
      return toArray(JSON.parse(t));
    } catch {
      return null;
    }
  };

  let found = tryParse(combined);
  if (found) return found;

  const firstArr = combined.indexOf("[");
  const firstObj = combined.indexOf("{");
  const slices: string[] = [];
  if (firstArr >= 0 && (firstObj < 0 || firstArr < firstObj)) {
    const last = combined.lastIndexOf("]");
    if (last > firstArr) slices.push(combined.slice(firstArr, last + 1));
  }
  if (firstObj >= 0) {
    const last = combined.lastIndexOf("}");
    if (last > firstObj) slices.push(combined.slice(firstObj, last + 1));
  }
  for (const slice of slices) {
    found = tryParse(slice);
    if (found) return found;
  }
  return [];
}

async function fetchSkills(): Promise<Record<string, unknown>[]> {
  // `openclaw skills list --json` walks every skill folder, validates bins/env/config,
  // and can take 30–45s on a cold gateway with ~25+ skills. 12s was far too tight and
  // caused the Skills tab to render empty while the command was still running. 60s
  // matches other enumeration CLIs (plugins list, ltm stats).
  const r = await cachedCommand(SKILLS_LIST_JSON_CMD, { ttl: 120_000, timeout: 60_000 });
  return parseSkillsCliOutput(r.stdout || "", r.stderr || "");
}

const getSkillsBase = makeGetter("skills", fetchSkills);

async function fetchSessions(): Promise<Record<string, unknown>[]> {
  const r = await cachedCommand("openclaw sessions --json", { ttl: 30_000, timeout: 45_000 });
  if (r.code === 0 && r.stdout.trim()) {
    try {
      const p = JSON.parse(r.stdout);
      return p.sessions ?? (Array.isArray(p) ? p : []);
    } catch { /* malformed JSON */ }
  }
  return [];
}

export const useDataStore = create<DataState>((set, get) => ({
  cronJobs: null,
  agents: null,
  memoryStatus: null,
  systemStatus: null,
  tasks: null,
  channelStatus: null,
  skills: null,
  sessions: null,
  _inflight: {},
  _hydrated: false,
  _lastPrefetch: 0,

  hydrateFromDisk: () => {
    if (get()._hydrated) return;
    const disk = loadFromDisk();
    set({
      ...(disk as Partial<DataState>),
      _hydrated: true,
    });
  },

  prefetchAll: async () => {
    const now = Date.now();
    if (now - get()._lastPrefetch < PREFETCH_COOLDOWN) return;
    set({ _lastPrefetch: now });

    const state = get();

    // Batch 1: critical data (agents + system status)
    const batch1: Promise<unknown>[] = [];
    if (!isFresh(state.agents, TTL.agents)) batch1.push(state.getAgents());
    if (!isFresh(state.systemStatus, TTL.systemStatus)) batch1.push(state.getSystemStatus());
    if (batch1.length > 0) await Promise.allSettled(batch1);

    // Batch 2: secondary data
    const batch2: Promise<unknown>[] = [];
    if (!isFresh(state.cronJobs, TTL.cronJobs)) batch2.push(state.getCronJobs());
    if (!isFresh(state.sessions, TTL.sessions)) batch2.push(state.getSessions());
    if (!isFresh(state.channelStatus, TTL.channelStatus)) batch2.push(state.getChannelStatus());
    if (batch2.length > 0) await Promise.allSettled(batch2);

    // Batch 3: less urgent data
    const batch3: Promise<unknown>[] = [];
    if (!isFresh(state.skills, TTL.skills)) batch3.push(state.getSkills());
    if (!isFresh(state.tasks, TTL.tasks)) batch3.push(state.getTasks());
    if (!isFresh(state.memoryStatus, TTL.memoryStatus)) batch3.push(state.getMemoryStatus());
    if (batch3.length > 0) await Promise.allSettled(batch3);
  },

  getCronJobs: makeGetter("cronJobs", fetchCronJobs),
  getAgents: makeGetter("agents", fetchAgents),
  getMemoryStatus: makeGetter("memoryStatus", fetchMemoryStatus),
  getSystemStatus: makeGetter("systemStatus", fetchSystemStatus),
  getTasks: makeGetter("tasks", fetchTasks),
  getChannelStatus: makeGetter("channelStatus", fetchChannelStatus),
  getSkills: async (force = false) => {
    if (force) invalidateSkillsCliCache();
    return getSkillsBase(force);
  },
  getSessions: makeGetter("sessions", fetchSessions),

  invalidate: (key) => {
    if (key) {
      set({ [key]: null } as Partial<DataState>);
    } else {
      set({
        cronJobs: null, agents: null, memoryStatus: null,
        systemStatus: null, tasks: null, channelStatus: null,
        skills: null, sessions: null,
      });
    }
    persistToDisk(get());
  },
}));
