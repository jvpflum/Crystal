import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

interface DataState {
  cronJobs: CacheEntry<Record<string, unknown>[]> | null;
  agents: CacheEntry<Record<string, unknown>[]> | null;
  memoryStatus: CacheEntry<Record<string, unknown>> | null;
  systemStatus: CacheEntry<Record<string, unknown>> | null;

  _inflight: Record<string, Promise<unknown>>;

  getCronJobs: (force?: boolean) => Promise<Record<string, unknown>[]>;
  getAgents: (force?: boolean) => Promise<Record<string, unknown>[]>;
  getMemoryStatus: (force?: boolean) => Promise<Record<string, unknown>>;
  getSystemStatus: (force?: boolean) => Promise<Record<string, unknown>>;
  invalidate: (key?: "cronJobs" | "agents" | "memoryStatus" | "systemStatus") => void;
}

const TTL = {
  cronJobs: 30_000,
  agents: 60_000,
  memoryStatus: 60_000,
  systemStatus: 30_000,
};

function isFresh<T>(entry: CacheEntry<T> | null, ttl: number): entry is CacheEntry<T> {
  return entry !== null && Date.now() - entry.fetchedAt < ttl;
}

async function runCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
}

export const useDataStore = create<DataState>((set, get) => ({
  cronJobs: null,
  agents: null,
  memoryStatus: null,
  systemStatus: null,
  _inflight: {},

  getCronJobs: async (force = false) => {
    const state = get();
    if (!force && isFresh(state.cronJobs, TTL.cronJobs)) return state.cronJobs.data;
    if ("cronJobs" in state._inflight) return state._inflight["cronJobs"] as Promise<Record<string, unknown>[]>;

    const promise = (async () => {
      try {
        const result = await runCommand("openclaw cron list --json --all");
        if (result.code === 0 && result.stdout.trim()) {
          const parsed = JSON.parse(result.stdout);
          const data = Array.isArray(parsed) ? parsed : parsed.jobs ?? [];
          set({ cronJobs: { data, fetchedAt: Date.now() } });
          return data;
        }
      } catch { /* fall through */ }
      const fallback = get().cronJobs?.data ?? [];
      return fallback;
    })().finally(() => {
      const inf = { ...get()._inflight };
      delete inf["cronJobs"];
      set({ _inflight: inf });
    });

    set({ _inflight: { ...get()._inflight, cronJobs: promise } });
    return promise;
  },

  getAgents: async (force = false) => {
    const state = get();
    if (!force && isFresh(state.agents, TTL.agents)) return state.agents.data;
    if ("agents" in state._inflight) return state._inflight["agents"] as Promise<Record<string, unknown>[]>;

    const promise = (async () => {
      try {
        const result = await runCommand("openclaw agents list --json");
        if (result.code === 0 && result.stdout.trim()) {
          const data = JSON.parse(result.stdout);
          const arr = Array.isArray(data) ? data : (data.agents ?? data.items ?? []);
          set({ agents: { data: arr, fetchedAt: Date.now() } });
          return arr;
        }
      } catch { /* fall through */ }
      return get().agents?.data ?? [];
    })().finally(() => {
      const inf = { ...get()._inflight };
      delete inf["agents"];
      set({ _inflight: inf });
    });

    set({ _inflight: { ...get()._inflight, agents: promise } });
    return promise;
  },

  getMemoryStatus: async (force = false) => {
    const state = get();
    if (!force && isFresh(state.memoryStatus, TTL.memoryStatus)) return state.memoryStatus.data;
    if ("memoryStatus" in state._inflight) return state._inflight["memoryStatus"] as Promise<Record<string, unknown>>;

    const promise = (async () => {
      try {
        const result = await runCommand("openclaw memory status --json");
        if (result.code === 0 && result.stdout.trim()) {
          const data = JSON.parse(result.stdout);
          set({ memoryStatus: { data, fetchedAt: Date.now() } });
          return data;
        }
      } catch { /* fall through */ }
      return get().memoryStatus?.data ?? {};
    })().finally(() => {
      const inf = { ...get()._inflight };
      delete inf["memoryStatus"];
      set({ _inflight: inf });
    });

    set({ _inflight: { ...get()._inflight, memoryStatus: promise } });
    return promise;
  },

  getSystemStatus: async (force = false) => {
    const state = get();
    if (!force && isFresh(state.systemStatus, TTL.systemStatus)) return state.systemStatus.data;
    if ("systemStatus" in state._inflight) return state._inflight["systemStatus"] as Promise<Record<string, unknown>>;

    const promise = (async () => {
      try {
        const result = await runCommand("openclaw health");
        const data = { healthy: result.code === 0, text: result.stdout, fetchedAt: Date.now() };
        set({ systemStatus: { data, fetchedAt: Date.now() } });
        return data;
      } catch { /* fall through */ }
      return get().systemStatus?.data ?? { healthy: false };
    })().finally(() => {
      const inf = { ...get()._inflight };
      delete inf["systemStatus"];
      set({ _inflight: inf });
    });

    set({ _inflight: { ...get()._inflight, systemStatus: promise } });
    return promise;
  },

  invalidate: (key) => {
    if (key) {
      set({ [key]: null });
    } else {
      set({ cronJobs: null, agents: null, memoryStatus: null, systemStatus: null });
    }
  },
}));
