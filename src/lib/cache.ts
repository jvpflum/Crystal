import { invoke } from "@tauri-apps/api/core";

interface CacheEntry {
  result: { stdout: string; stderr: string; code: number };
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<{ stdout: string; stderr: string; code: number }>>();

const DEFAULT_TTL = 30_000;

export async function cachedCommand(
  command: string,
  opts?: { cwd?: string | null; ttl?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const ttl = opts?.ttl ?? DEFAULT_TTL;
  const key = command;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.result;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = invoke<{ stdout: string; stderr: string; code: number }>(
    "execute_command",
    { command, cwd: opts?.cwd ?? null },
  ).then(result => {
    cache.set(key, { result, ts: Date.now() });
    inflight.delete(key);
    return result;
  }).catch(err => {
    inflight.delete(key);
    throw err;
  });

  inflight.set(key, promise);
  return promise;
}

export function invalidateCache(command?: string) {
  if (command) {
    cache.delete(command);
  } else {
    cache.clear();
  }
}
