import { create } from "zustand";
import { cachedCommand, invalidateCache } from "@/lib/cache";

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
  const r = await cachedCommand("openclaw agents list --json", { ttl: 60_000 });
  if (r.code === 0 && r.stdout.trim()) {
    try {
      const d = JSON.parse(r.stdout);
      return Array.isArray(d) ? d : (d.agents ?? d.items ?? []);
    } catch { /* malformed JSON */ }
  }
  return [];
}

async function fetchMemoryStatus(): Promise<Record<string, unknown>> {
  const r = await cachedCommand("openclaw ltm stats", { ttl: 60_000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const match = out.match(/Total memories:\s*(\d+)/i);
  const chunks = match ? parseInt(match[1], 10) : 0;
  if (chunks > 0) return { chunks, totalChunks: chunks };

  const jsonR = await cachedCommand("openclaw ltm list --json", { ttl: 120_000 });
  if (jsonR.code === 0 && jsonR.stdout.trim()) {
    try {
      const parsed = JSON.parse(jsonR.stdout.trim()) as unknown;
      const arr = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)?.memories;
      const n = Array.isArray(arr) ? arr.length : 0;
      return { chunks: n, totalChunks: n };
    } catch { /* ignore */ }
  }
  return { chunks: 0, totalChunks: 0 };
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
  const r = await cachedCommand(SKILLS_LIST_JSON_CMD, { ttl: 120_000 });
  return parseSkillsCliOutput(r.stdout || "", r.stderr || "");
}

const getSkillsBase = makeGetter("skills", fetchSkills);

async function fetchSessions(): Promise<Record<string, unknown>[]> {
  const r = await cachedCommand("openclaw sessions --json", { ttl: 30_000 });
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
