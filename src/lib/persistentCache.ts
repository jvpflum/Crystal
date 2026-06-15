/**
 * Tiny localStorage-backed stale-while-revalidate cache for view data.
 *
 * Views that hold their list in component-local `useState` lose it on every
 * unmount/app-restart and re-fetch cold (blocking first paint). Hydrating the
 * initial state from here lets a page paint the last-known data instantly and
 * refresh in the background — the same pattern used by `dataStore` (disk
 * snapshot) and `ModelsView`/`osStore`.
 *
 * Keep payloads small (lists of plain JSON). Reads/writes are best-effort and
 * never throw (quota / private-mode / serialisation errors are swallowed).
 */

const PREFIX = "crystal_view_cache:";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

interface Entry<T> {
  data: T;
  ts: number;
}

/** Returns the cached value for `key`, or null if missing/expired/corrupt. */
export function loadPersisted<T>(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.ts !== "number") return null;
    if (Date.now() - entry.ts > maxAgeMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/** Persists `data` under `key` with the current timestamp. Best-effort. */
export function savePersisted<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now() } satisfies Entry<T>));
  } catch {
    /* quota / serialisation error — non-fatal */
  }
}

/** Drops a cached entry (or all view-cache entries when no key is given). */
export function clearPersisted(key?: string): void {
  try {
    if (key) {
      localStorage.removeItem(PREFIX + key);
      return;
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* non-fatal */
  }
}

/**
 * Races a promise against a timeout so a cold/stalled CLI spawn can't block the
 * UI indefinitely. Rejects with an Error after `ms` if `p` hasn't settled.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}
