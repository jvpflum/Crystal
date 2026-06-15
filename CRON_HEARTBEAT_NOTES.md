# Cron master toggle + Heartbeat page — staged frontend wiring

> **Status:** Backend is DONE and green (typecheck + cron tests). The frontend
> snippets below are **staged only** — apply them once the mogwai files
> (`CommandCenterView.tsx`, `openclaw.ts`) are free from the other live workers.
> Nothing in `mogwai/` has been edited by this change.

---

## 0. TL;DR — what changed in the backend (`openclaw-fork`)

The cron scheduler had **no runtime master switch**. The only "off" control was
the static `cron.enabled: false` config (read once at gateway boot into
`deps.cronEnabled`). So Crystal's UI toggle (which only flipped a heartbeat
config / per-job flags) could never start or stop the scheduler loop — jobs
looked enabled but the scheduler was gated off (or vice-versa) and nothing the
UI did changed that without editing `openclaw.json` + restarting the gateway.

Now there is a real, persistent, idempotent **master enable/disable** with an
**anti-stampede resume**, exposed over RPC **and** CLI. Use the CLI from Crystal
(matches every other cron call in `openclaw.ts`).

---

## 1. Backend API the frontend should call

### Master scheduler toggle (NEW)

| Concern | Value |
| --- | --- |
| RPC method | `cron.setEnabled` |
| RPC params | `{ "enabled": boolean }` |
| RPC result | `{ enabled: boolean, changed: boolean, storePath: string, jobs: number, nextWakeAtMs: number \| null }` |
| CLI (enable) | `openclaw cron scheduler enable --json` |
| CLI (disable) | `openclaw cron scheduler disable --json` |
| CLI (status) | `openclaw cron scheduler status --json` |
| Scope | `ADMIN_SCOPE` |

`changed` is `true` only when the flag actually flipped (idempotent: calling
enable twice is a no-op the second time). The choice is persisted in a sidecar
file next to the cron store (`<store>-scheduler.json`), so it **survives gateway
restarts** without touching `~/.openclaw/openclaw.json`.

### Read current scheduler state

| Concern | Value |
| --- | --- |
| RPC method | `cron.status` |
| RPC result | `{ enabled: boolean, storePath: string, jobs: number, nextWakeAtMs: number \| null }` |
| CLI | `openclaw cron status --json` (or `cron scheduler status --json`) |

`enabled` here is the **master** flag. Use it to drive the toggle's checked state.

### Per-job toggle (already existed — documented for completeness)

| Concern | Value |
| --- | --- |
| RPC method | `cron.update` with `{ id, patch: { enabled } }` |
| CLI (enable) | `openclaw cron enable <id> --json` |
| CLI (disable) | `openclaw cron disable <id> --json` |

### Anti-stampede behavior (no frontend action needed — just so you know)

On **re-enable** (or gateway restart after a pause) the scheduler does **not**
fire every overdue job at once. Default strategy is `skip-missed`: every
recurring job is rescheduled to its **next** future slot, missed slots dropped.
A `catchup` strategy (replays missed runs, but capped + staggered) is opt-in via
config `cron.resumeStrategy: "skip-missed" | "catchup"` (default `skip-missed`).
Even under catchup, runs are bounded by `maxConcurrentRuns`,
`maxMissedJobsPerRestart`, and `missedJobStaggerMs`.

---

## 2. `mogwai/src/lib/openclaw.ts` — add cron client methods

Add these inside the existing `/* ── Cron ── */` section (right after
`removeCronJob`). They mirror the existing `listCronJobs` / `addCronJob` style
(Tauri `execute_command` → `openclaw …` CLI).

```ts
  /** Master scheduler switch — enables/disables ALL cron jobs at once. */
  async setCronSchedulerEnabled(enabled: boolean): Promise<{
    enabled: boolean;
    changed: boolean;
    jobs: number;
    nextWakeAtMs: number | null;
  } | null> {
    try {
      const sub = enabled ? "enable" : "disable";
      const r = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} cron scheduler ${sub} --json`,
        cwd: null,
      });
      if (r.code === 0 && r.stdout.trim()) {
        const d = JSON.parse(r.stdout);
        return {
          enabled: Boolean(d.enabled),
          changed: Boolean(d.changed),
          jobs: Number(d.jobs ?? 0),
          nextWakeAtMs: d.nextWakeAtMs ?? null,
        };
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Read the master scheduler status (enabled flag + next wake). */
  async getCronSchedulerStatus(): Promise<{
    enabled: boolean;
    jobs: number;
    nextWakeAtMs: number | null;
  } | null> {
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} cron status --json`,
        cwd: null,
      });
      if (r.code === 0 && r.stdout.trim()) {
        const d = JSON.parse(r.stdout);
        return {
          enabled: Boolean(d.enabled),
          jobs: Number(d.jobs ?? 0),
          nextWakeAtMs: d.nextWakeAtMs ?? null,
        };
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Per-job enable/disable (id or exact name). */
  async setCronJobEnabled(id: string, enabled: boolean): Promise<boolean> {
    try {
      const sub = enabled ? "enable" : "disable";
      const r = await invoke<{ code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} cron ${sub} "${escapeShellArg(id)}"`,
        cwd: null,
      });
      return r.code === 0;
    } catch { return false; }
  }
```

> If `listCronJobs` uses `cachedCommand`, the master status read is fine as a
> direct `invoke` (it must reflect the latest toggle immediately). If you prefer
> caching, give it a short TTL (≤5s) and bust it inside `setCronSchedulerEnabled`.

---

## 3. `mogwai/src/components/views/CommandCenterView.tsx` — master toggle in the Scheduled tab

Put a single master switch in the **Scheduled** tab header (`ScheduledTab`). It
reads `cron.status` on mount and calls `setCronSchedulerEnabled` on click. The
per-job rows already render; this just adds the global gate above them.

Add near the top of `ScheduledTab` (with the other `useState`s):

```tsx
  const [schedulerEnabled, setSchedulerEnabled] = useState<boolean | null>(null);
  const [schedulerBusy, setSchedulerBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    openclawClient.getCronSchedulerStatus().then(s => {
      if (alive && s) setSchedulerEnabled(s.enabled);
    });
    return () => { alive = false; };
  }, []);

  const toggleScheduler = async () => {
    if (schedulerEnabled === null || schedulerBusy) return;
    const next = !schedulerEnabled;
    setSchedulerBusy(true);
    setSchedulerEnabled(next);            // optimistic
    const res = await openclawClient.setCronSchedulerEnabled(next);
    if (!res) setSchedulerEnabled(!next); // revert on failure
    else setSchedulerEnabled(res.enabled);
    setSchedulerBusy(false);
  };
```

Render the switch in the `ScheduledTab` header row (mirror the Heartbeat
tab's enable/disable button styling — `btnPrimary` + the purple/red accent):

```tsx
  <button
    onClick={toggleScheduler}
    disabled={schedulerEnabled === null || schedulerBusy}
    style={{
      ...btnPrimary,
      padding: "6px 14px",
      fontSize: 11,
      display: "flex",
      alignItems: "center",
      gap: 6,
      background: schedulerEnabled ? "rgba(248,113,113,0.15)" : "var(--accent)",
      color: schedulerEnabled ? "#f87171" : "#fff",
      opacity: schedulerBusy ? 0.7 : 1,
    }}
  >
    {schedulerBusy && <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />}
    {schedulerEnabled === null ? "…" : schedulerEnabled ? "Scheduler: On" : "Scheduler: Off"}
  </button>
```

> Semantics: this is the **master** switch. When off, no jobs run regardless of
> per-job state. When flipped back on, jobs resume at their **next** scheduled
> time (no stampede). The per-job `Managed in Heartbeat tab` / enable rows are
> unaffected.

---

## 4. Heartbeat page — root cause + staged fix

**Where it lives:** the "Heartbeat page" is the `HeartbeatTab` inside
`CommandCenterView.tsx` (`tab === "heartbeat"`). Route/tab wiring is fine
(`appStore.CommandCenterTabId` includes `"heartbeat"`, `CommandPalette`
navigates correctly, `Heart`/`HeartPulse` icons are imported). It is **not** a
bad route or a missing-import crash.

**Root cause (stuck "Loading heartbeat config…"):** the initial-load effect gates
the whole page on a **gateway round-trip**:

```ts
useEffect(() => {
  (async () => {
    await resolvePath();
    await Promise.all([fetchConfig(), fetchLast()]); // fetchLast hits the gateway
    await loadInstructions();
    setLoading(false);                                // never reached if a call hangs
  })();
}, [...]);
```

`fetchLast()` shells out to `openclaw system heartbeat last`, which is a
**gateway-backed** CLI command (`callGatewayFromCli("last-heartbeat", …)` with a
**30s default timeout**). When the gateway is down/unreachable (common in dev,
or because another worker owns the socket), that command blocks for up to ~30s
(or indefinitely if the spawned process hangs). Because `setLoading(false)` runs
only **after** the `Promise.all`, the page sits on the spinner the whole time and
looks broken. There's no `try/finally` and no per-call timeout.

Secondary bug: `fetchLast` derives the toggle state from `p.enabled`, but the
`last-heartbeat` payload (`HeartbeatEventPayload`) has **no `enabled` field**, so
the Enable/Disable state is never reflected from the backend.

**Staged fix (drop-in replacement for the load effect + `fetchLast`):**

```ts
  // Race any gateway-backed CLI call against a short timeout so a slow/offline
  // gateway can never wedge the page on the loading spinner.
  const withTimeout = async <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> => {
    let t: ReturnType<typeof setTimeout>;
    const timeout = new Promise<T>(res => { t = setTimeout(() => res(fallback), ms); });
    try { return await Promise.race([p, timeout]); }
    finally { clearTimeout(t!); }
  };

  const fetchLast = useCallback(async () => {
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", {
        // bound the gateway wait so it can't block the page
        command: "openclaw system heartbeat last --json --timeout 4000", cwd: null,
      });
      if (r.code === 0 && r.stdout.trim()) {
        const p = JSON.parse(r.stdout);
        if (p && typeof p === "object") {
          const ts = p.timestamp ?? p.ts ?? p.lastRun ?? p.last;
          if (ts) setStatus(prev => ({ ...prev, lastRun: String(ts) }));
        }
      }
    } catch { /* may not have run yet / gateway offline */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await resolvePath();
        // Gate the spinner ONLY on the fast local config read.
        await withTimeout(fetchConfig(), 4000, undefined);
        await loadInstructions();
      } finally {
        setLoading(false);                 // always clear, even on error/timeout
      }
      // Non-blocking: let the gateway-backed "last run" fill in afterwards.
      void withTimeout(fetchLast(), 4000, undefined);
    })();
  }, [resolvePath, fetchConfig, fetchLast, loadInstructions]);
```

Also derive `enabled` from config rather than the heartbeat-last payload — in
`fetchConfig`, set it from the heartbeat config object:

```ts
        setStatus(prev => ({
          ...prev, every, prompt: cfg.prompt || "", target: cfg.target || "none",
          activeHours: cfg.activeHours, lightContext: cfg.lightContext,
          isolatedSession: cfg.isolatedSession,
          enabled: cfg.enabled !== false,   // <-- reflect actual heartbeat enabled state
        }));
```

Net effect: the page always renders within ~4s (usually instantly from the local
config read), the "last run" line backfills when the gateway answers, and the
Enable/Disable button reflects the real config state.

---

## 5. Files touched by the backend (for reference / review)

Core + RPC + CLI (all in `openclaw-fork/`, none in the telegram/voice worker dirs):

- `src/cron/scheduler-state.ts` *(new)* — sidecar persistence + boot precedence
- `src/cron/service/state.ts` — `schedulerEnabled` runtime flag + `isSchedulerEnabled()`
- `src/cron/service/ops.ts` — `setEnabled()` + `status()`/`start()` gating, `CronSetEnabledResult`
- `src/cron/service/timer.ts` — `resumeScheduler()` + `skip-missed`/`catchup` anti-stampede
- `src/cron/service/store.ts`, `src/cron/service.ts`, `src/cron/service-contract.ts`
- `src/config/types.cron.ts`, `src/config/zod-schema.ts` — `resumeStrategy`
- `src/gateway/server-cron.ts`, `src/gateway/server-cron-lazy.ts` — boot resolution + lazy `setEnabled`
- `src/gateway/server-methods/cron.ts` — `cron.setEnabled` handler
- `src/gateway/protocol/schema/cron.ts` + `protocol-schemas.ts` + `types.ts` + `index.ts` — schema/validator
- `src/gateway/server-methods-list.ts`, `src/gateway/method-scopes.ts` — register + ADMIN scope
- `src/cli/cron-cli/register.cron-simple.ts` — `cron scheduler enable|disable|status` CLI

Tests:

- `src/cron/service.master-enable.test.ts` *(new)* — toggle persistence, idempotency, anti-stampede
- `src/gateway/protocol/cron-validators.test.ts` — `validateCronSetEnabledParams`
- updated mocks/harness: `service.test-harness.ts`, `server-cron-lazy.test.ts`,
  `plugins/contracts/scheduled-turns.contract.test.ts`

**Results:** core typecheck clean; cron suite `831 passed / 4 skipped (92 files)`.
(The unrelated talk/voicewake/realtimeVoice errors in the core *test* typecheck
are pre-existing and owned by the live telegram/voice worker — none touch cron.)
