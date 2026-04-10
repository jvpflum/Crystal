import { invoke } from "@tauri-apps/api/core";

interface CacheEntry {
  result: { stdout: string; stderr: string; code: number };
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<{ stdout: string; stderr: string; code: number }>>();

const DEFAULT_TTL = 120_000;

// Concurrency limiter: at most MAX_CONCURRENT CLI commands running at once.
// Each `openclaw` CLI call opens a WS connection to the gateway; flooding it
// causes handshake timeouts and lane wait stalls.
const MAX_CONCURRENT = 6;
let running = 0;
const waiting: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => waiting.push(resolve));
}

function releaseSlot() {
  if (waiting.length > 0) {
    const next = waiting.shift()!;
    next();
  } else {
    running--;
  }
}

const COMMAND_TIMEOUT = 15_000;

async function throttledInvoke(
  command: string,
  cwd: string | null,
  timeout = COMMAND_TIMEOUT,
): Promise<{ stdout: string; stderr: string; code: number }> {
  await acquireSlot();
  try {
    const result = await Promise.race([
      invoke<{ stdout: string; stderr: string; code: number }>(
        "execute_command",
        { command, cwd },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Command timed out after ${timeout / 1000}s: ${command.slice(0, 60)}`)), timeout),
      ),
    ]);
    return result;
  } finally {
    releaseSlot();
  }
}

export async function cachedCommand(
  command: string,
  opts?: { cwd?: string | null; ttl?: number; timeout?: number },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const ttl = opts?.ttl ?? DEFAULT_TTL;
  const key = opts?.cwd ? `${command}@${opts.cwd}` : command;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.result;
  }

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = throttledInvoke(command, opts?.cwd ?? null, opts?.timeout)
    .then(result => {
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
