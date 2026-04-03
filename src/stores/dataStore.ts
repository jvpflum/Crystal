import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

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
  skills:        300_000, // 5 min – rarely change
  agents:        180_000, // 3 min
  memoryStatus:  120_000, // 2 min
  cronJobs:      120_000, // 2 min
  channelStatus: 120_000, // 2 min
  systemStatus:   60_000, // 1 min
  tasks:          30_000, // 30 s – more dynamic
  sessions:       30_000, // 30 s
};

const DISK_KEY = "crystal_data_cache";
const DISK_MAX_AGE = 24 * 60 * 60 * 1000; // 24 h

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
  } catch { /* quota or serialisation error – ignore */ }
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

async function runCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
}

function makeGetter<T>(
  key: CacheKey,
  fetcher: () => Promise<T>,
) {
  return async (force = false): Promise<T> => {
    const state = useDataStore.getState();
    if (!force && isFresh(state[key] as CacheEntry<T> | null, TTL[key])) {
      return (state[key] as CacheEntry<T>).data;
    }
    if (key in state._inflight) return state._inflight[key] as Promise<T>;

    const promise = fetcher()
      .then(data => {
        useDataStore.setState({ [key]: { data, fetchedAt: Date.now() } } as Partial<DataState>);
        persistToDisk(useDataStore.getState());
        return data;
      })
      .catch(() => {
        const fallback = useDataStore.getState()[key];
        return (fallback as CacheEntry<T> | null)?.data ?? (Array.isArray((useDataStore.getState()[key] as CacheEntry<T> | null)?.data) ? [] : {}) as T;
      })
      .finally(() => {
        const inf = { ...useDataStore.getState()._inflight };
        delete inf[key];
        useDataStore.setState({ _inflight: inf });
      });

    useDataStore.setState({ _inflight: { ...useDataStore.getState()._inflight, [key]: promise } });
    return promise;
  };
}

async function fetchCronJobs(): Promise<Record<string, unknown>[]> {
  const r = await runCommand("openclaw cron list --json --all");
  if (r.code === 0 && r.stdout.trim()) {
    const p = JSON.parse(r.stdout);
    return Array.isArray(p) ? p : p.jobs ?? [];
  }
  return [];
}

async function fetchAgents(): Promise<Record<string, unknown>[]> {
  const r = await runCommand("openclaw agents list --json");
  if (r.code === 0 && r.stdout.trim()) {
    const d = JSON.parse(r.stdout);
    return Array.isArray(d) ? d : (d.agents ?? d.items ?? []);
  }
  return [];
}

async function fetchMemoryStatus(): Promise<Record<string, unknown>> {
  const r = await runCommand("openclaw memory status --json");
  if (r.code === 0 && r.stdout.trim()) return JSON.parse(r.stdout);
  return {};
}

async function fetchSystemStatus(): Promise<Record<string, unknown>> {
  const r = await runCommand("openclaw health");
  return { healthy: r.code === 0, text: r.stdout, fetchedAt: Date.now() };
}

async function fetchTasks(): Promise<Record<string, unknown>[]> {
  const r = await runCommand("openclaw tasks list --json");
  if (r.code === 0 && r.stdout.trim()) {
    const p = JSON.parse(r.stdout);
    return Array.isArray(p) ? p : p.tasks ?? p.runs ?? [];
  }
  return [];
}

async function fetchChannelStatus(): Promise<Record<string, unknown>> {
  const r = await runCommand("openclaw channels status --json");
  if (r.code === 0 && r.stdout.trim()) return JSON.parse(r.stdout);
  return {};
}

async function fetchSkills(): Promise<Record<string, unknown>[]> {
  const r = await runCommand("openclaw skills list --json");
  if (r.code === 0 && r.stdout.trim()) {
    const p = JSON.parse(r.stdout);
    return Array.isArray(p) ? p : p.skills ?? [];
  }
  return [];
}

async function fetchSessions(): Promise<Record<string, unknown>[]> {
  const r = await runCommand("openclaw sessions --json");
  if (r.code === 0 && r.stdout.trim()) {
    const p = JSON.parse(r.stdout);
    return p.sessions ?? (Array.isArray(p) ? p : []);
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

  hydrateFromDisk: () => {
    if (get()._hydrated) return;
    const disk = loadFromDisk();
    set({
      ...(disk as Partial<DataState>),
      _hydrated: true,
    });
  },

  prefetchAll: async () => {
    const state = get();
    const fetchers: Promise<unknown>[] = [];
    if (!isFresh(state.agents, TTL.agents)) fetchers.push(state.getAgents());
    if (!isFresh(state.cronJobs, TTL.cronJobs)) fetchers.push(state.getCronJobs());
    if (!isFresh(state.skills, TTL.skills)) fetchers.push(state.getSkills());
    if (!isFresh(state.systemStatus, TTL.systemStatus)) fetchers.push(state.getSystemStatus());
    if (!isFresh(state.channelStatus, TTL.channelStatus)) fetchers.push(state.getChannelStatus());
    if (!isFresh(state.tasks, TTL.tasks)) fetchers.push(state.getTasks());
    if (!isFresh(state.sessions, TTL.sessions)) fetchers.push(state.getSessions());
    if (!isFresh(state.memoryStatus, TTL.memoryStatus)) fetchers.push(state.getMemoryStatus());
    await Promise.allSettled(fetchers);
  },

  getCronJobs: makeGetter("cronJobs", fetchCronJobs),
  getAgents: makeGetter("agents", fetchAgents),
  getMemoryStatus: makeGetter("memoryStatus", fetchMemoryStatus),
  getSystemStatus: makeGetter("systemStatus", fetchSystemStatus),
  getTasks: makeGetter("tasks", fetchTasks),
  getChannelStatus: makeGetter("channelStatus", fetchChannelStatus),
  getSkills: makeGetter("skills", fetchSkills),
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
