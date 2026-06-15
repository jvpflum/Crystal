# Crystal (mogwai) — Load/Render Performance Notes

Profiling pass on view mount behavior + bundle. This file records (a) what was
**already done** in the codebase, (b) the **isolated fixes applied** in this
pass, and (c) **staged recommendations** for files owned by other in-flight
workers (do not apply here — hand to the listed owner).

---

## TL;DR — why "some pages are slow, others fast"

The app is split into two classes of views:

| Class | Data source | Caching | Feel |
|-------|-------------|---------|------|
| **Fast** | `dataStore` getters (`getAgents`, `getSessions`, `getCronJobs`, `getSkills`, `getMemoryStatus`, …) | TTL cache + disk hydration + stale-while-revalidate + concurrency-throttled CLI (`lib/cache.ts`) | Paint instantly from cache, refresh in background |
| **Slow** | `osStore` loaders → `openclawClient.os*` → `osExec()` | **None** — `osExec` spawned a cold `openclaw os … --json` process on **every mount**, bypassing both the `cachedCommand` cache *and* its 6-way concurrency limiter | Blocked on a cold CLI spawn every single visit |

So the "slow pages" were exactly the Crystal-OS-backed views, and the "fast
pages" were the ones already wired through `dataStore`.

---

## Already in place (no action needed)

- **Route-level code-splitting**: `App.tsx` already lazy-loads *every* view via
  `React.lazy` + a shared `<Suspense fallback={<ViewFallback/>}>`. First paint
  only pulls `index` + `vendor-react` + the active view's chunk.
- **Vendor chunking**: `vite.config.ts` already has
  `build.rollupOptions.output.manualChunks` for `vendor-react`,
  `vendor-markdown`, `vendor-zustand`. `lucide-react` is tree-shaken to one tiny
  chunk per icon.
- **`dataStore`**: TTL cache, `localStorage` hydration, `prefetchAll` on gateway
  connect (batched), stale-while-revalidate getters.
- **`lib/cache.ts`**: `cachedCommand` with TTL cache + in-flight dedupe + a
  `MAX_CONCURRENT = 6` CLI concurrency limiter.

---

## Ranked slow views + root cause

1. **BoardView** — `loadProjects()` + `loadTasks()` + `loadRuns({limit:100})`, all uncached `os` CLI spawns, on every mount (plus a debounced `loadTasks()` 250 ms later = a 4th spawn).
2. **ProjectsView** — `loadProjects()` uncached on every mount.
3. **LessonsView** — `loadLessons()` + `loadProjects()` uncached every mount.
4. **DecisionsView** — `loadDecisions()` + `loadProjects()` uncached every mount.
5. **TargetsView** — `loadTargets()` + `loadRuns({limit:25})` uncached every mount.
6. **StudioView** — `loadStudioRuns()` uncached every mount.
7. **SkillsRegistryView** — `loadSkills()` uncached every mount.
   - All of the above also **bypassed the concurrency limiter**, so opening one
     during the gateway-connect `prefetchAll` burst could contend for gateway
     lanes and stall.
8. **SessionsView** — own loader using raw `invoke("execute_command", "openclaw sessions --json")` (timeout 45 s), uncached on every mount. Not OS-backed but same anti-pattern.
9. **TasksView** — own loader, raw uncached `openclaw tasks list --json`, **and** re-runs it every 15 s on a poll.
10. **SubagentsView** — `fetchForgeAgentLists()` runs two **sequential** `dispatchToAgent` round-trips (`/subagents list` then `/acp status`) → ~2× latency; uncached. *(owned — see staged section)*

Fast views for contrast: HomeView, AgentsView, ModelsView, ChannelsView,
CommandCenterView — all read through `dataStore`/`cachedCommand`, run mount
loaders in parallel, and paint immediately.

---

## Fixes applied in this pass (isolated, behavior-preserving)

### `src/stores/osStore.ts` — stale-while-revalidate cache for all `os` loaders
Added a module-level freshness map (`osLoadedAt`) + `OS_CACHE_TTL = 20_000`
guard to `loadTasks`, `loadProjects`, `loadLessons`, `loadDecisions`,
`loadTargets`, `loadRuns`, `loadSkills`, `loadStudioRuns`:

- If the same query was fetched within the TTL, the loader **returns
  immediately** — no CLI spawn. Revisiting Board/Projects/etc. is now instant.
- Loaders **never flash a skeleton over data already on screen**: `loadingX` is
  only set when there's no data yet or on a forced refresh.
- All loaders accept an `opts?: { force?: boolean }` arg.
- Every **mutation** (`createTask`, `setTaskStatus`, `archiveProject`,
  `recordLesson`, `dispatchExec`, `importSkills`, …) and `refreshAll` now passes
  `{ force: true }`, so post-write reloads still bypass the cache and show fresh
  data — no behavior change.
- Exported `invalidateOsCache(prefix?)` for future targeted busting.

Cache keys include the effective filter/projectId/limit so different
queries cache independently.

### Fair-game OS views — refresh buttons now force
`BoardView`, `ProjectsView`, `LessonsView`, `DecisionsView`, `TargetsView`,
`StudioView`, `SkillsRegistryView`: the header refresh button now calls the
loader with `{ force: true }` so the explicit-refresh affordance still always
refetches (mount path benefits from the cache; manual refresh bypasses it).

**Expected impact:** Board/Projects/Lessons/Decisions/Targets/Studio/Skills now
paint from cached state on every revisit within 20 s (and keep showing data
while a background refresh runs), instead of blocking on a cold `openclaw os …`
spawn every time. Shared `projects` data is fetched once and reused across
Board/Projects/Lessons/Decisions instead of 4× per navigation.

---

## Follow-up fix — ModelsView slow first load

**Root cause:** `ModelsView` kept its catalog in component-local `useState([])`
with **no disk hydration**, and `loading` started `true` until `loadModels()`
finished. `loadModels()`'s first call (`openclaw models list --json` via
`cachedCommand`) ran on the critical render path with the **default 15s
timeout**, and the CLI's in-memory cache is wiped every app session — so the
first paint each session always blocked on a cold gateway round-trip (up to 15s
before falling through to the config-based path). Loaders were already parallel,
and it spawns the CLI directly, so it is **not** gated on the app's
`gatewayConnected` state (worker bd582c3c's connection-state bug does not block
this render).

**Fixed (confined to `ModelsView.tsx` — it has no dedicated store loader):**
- Disk-backed cache (`crystal_models_cache` in `localStorage`): `models` and
  `fallbacks` state hydrate synchronously from it via lazy `useState`
  initializers, and `loading` starts `false` whenever a cached catalog exists →
  instant paint with stale-while-revalidate background refresh.
- Persist the resolved catalog/fallbacks on every successful load
  (`saveModelsCache`) from both the `models list` and config-fallback paths.
- Bounded the primary `openclaw models list --json` call to a 6s timeout so a
  cold/stalled gateway falls through to the fast config-file path quickly
  instead of hanging the render up to 15s.
- Replaced the bare blocking spinner with a 6-row skeleton list for the genuine
  cold-start (no cache yet).

**Before/after:** before, every session's first Models open showed a centered
spinner for the full gateway round-trip (up to 15s). After, returning users see
the last-known model list immediately and it refreshes in the background; true
first-ever load shows a skeleton instantly and a worst-case 6s wait before the
config fallback fills it in. `ModelsView` chunk 24.71 → 26.01 kB (gz 6.19 →
6.53) for the cache + skeleton logic; build green.

---

## STAGED — recommendations for owned files (do NOT apply here)

### `src/lib/openclaw.ts` (owner: agents-subagents worker) — root-cause fix
`osExec()` bypasses the cache + concurrency limiter. Route it through
`cachedCommand` so the OS views get throttling for free and a short read cache
(the `osStore` TTL above is a frontend mitigation; this is the real fix):

```ts
// in OpenClawClient.osExec — replace the raw invoke with cachedCommand.
// Only cache read-shaped subcommands (list/get/search/status/runs/history),
// never mutations.
private async osExec<T>(args: string): Promise<T> {
  const command = `${OPENCLAW_CMD} os ${args} --json`;
  const isRead = /\b(list|get|search|status|runs|history|state get)\b/.test(args);
  const result = isRead
    ? await cachedCommand(command, { ttl: 15_000 })
    : await invoke<{ stdout: string; stderr: string; code: number }>(
        "execute_command", { command, cwd: null });
  const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
  // …unchanged envelope parsing…
}
```

Also parallelize `fetchForgeAgentLists()` (currently two sequential awaits):

```ts
const [sub, acp] = await Promise.all([
  this.dispatchToAgent("main", "/subagents list").catch(() => null),
  this.dispatchToAgent("main", "/acp status").catch(() => null),
]);
// …then parse sub/acp as before…
```

### `src/components/views/SubagentsView.tsx` (owner: agents-subagents worker)
Mount already runs its 4 loaders in parallel — good. The latency win comes from
parallelizing the two CLI round-trips inside `fetchForgeAgentLists` (above) and
giving `loadSubagents` the same SWR/TTL guard pattern used in `osStore` so
re-mounts don't re-spawn `/subagents list` + `/acp status` each time.

### `src/App.tsx` (owner: nav-overhaul worker)
Route code-splitting is **already done** (`React.lazy` + `Suspense`). Two
follow-ups belong here:

1. **Don't keep CPU-heavy views alive.** `ViewSlot` keeps every visited view
   mounted for `KEEP_ALIVE_MS = 30_000` with `display:none`. `CityView` runs a
   `requestAnimationFrame` render loop that keeps burning GPU/CPU while hidden.
   Either exclude animation views from keep-alive, or have CityView pause its
   rAF when not active (see CityView note below). Suggested:
   ```tsx
   const NO_KEEP_ALIVE = new Set(["city"]);
   // in ViewSlot: const keepAlive = !NO_KEEP_ALIVE.has(id);
   // …skip the 30s timer and unmount immediately when !active && keepAlive===false
   ```
2. **Prefetch-on-hover** (pairs with Navigation.tsx below).

### `src/components/shell/Navigation.tsx` (owner: nav-overhaul worker)
Warm the lazy chunk on hover so the click doesn't wait on a chunk download.
Each `React.lazy(() => import(...))` exposes the import; trigger it on
`onMouseEnter`/`onFocus` of the nav item:

```tsx
const PREFETCH: Partial<Record<AppView, () => Promise<unknown>>> = {
  board: () => import("@/components/views/BoardView"),
  conversation: () => import("@/components/views/ConversationView"), // pulls vendor-markdown early
  // …one per view…
};
<button
  onMouseEnter={() => PREFETCH[view]?.()}
  onFocus={() => PREFETCH[view]?.()}
  onClick={() => setView(view)}
/>
```
Highest value for `conversation` (it pulls the 335 kB `vendor-markdown` chunk).

### `src/components/shell/TitleBar.tsx` (owner: nav-overhaul worker)
No load-perf issue found. If it renders nav/launcher entries, apply the same
prefetch-on-hover pattern.

### Memory bridge — `scripts/mempalace_query.py`, `src/lib/memory-palace.ts`, HomeView/MemoryView memory read-wiring (owner: memory-pipeline-fix worker)
- HomeView calls `getMemoryStatus(true)` (force) on **every** mount, re-running
  `python mempalace_query.py status` (8 s timeout) each visit and bypassing the
  120 s `dataStore` TTL. It's fire-and-forget so it doesn't block paint, but
  drop the `true` to use the cached value with background revalidation:
  ```ts
  getMemoryStatus(); // was getMemoryStatus(true)
  ```
- Keep all memory reads off the first-paint critical path (they already are in
  HomeView via `Promise.allSettled` + separate effect — preserve that).

---

## Other fair-game opportunities (not applied — flagged for review)

- **`ConversationView.tsx`** imports `react-markdown` + `rehype-highlight`
  (`remark-gfm`) at the top, which is the 335 kB `vendor-markdown` chunk. It's
  already an isolated chunk that only loads with the (lazy) ConversationView, so
  it does **not** affect other pages or initial paint — only the first chat
  open. If desired, extract the `<ReactMarkdown>` block into a
  `React.lazy` sub-component with a `white-space:pre-wrap` text fallback so chat
  paints instantly and upgrades to rendered markdown a tick later. Left as a
  recommendation because it's a refactor in a ~2.5k-line file.
- **`SessionsView.tsx` / `TasksView.tsx`** — **DONE in Pass 3.** Now hydrate
  from `localStorage` (`@/lib/persistentCache`) for instant paint + restart
  persistence, with bounded timeouts and SWR background refresh that no longer
  wipes the list on error. (They keep their always-fetch behavior rather than
  `cachedCommand`, so the 15 s poll + mutation reloads stay correct without
  needing `force` semantics.)

---

## Pass 3 — app-wide caching + scroll virtualization

Goal: make navigation instant everywhere (data survives unmount/restart) and
make long lists scroll smoothly.

### New shared utilities
- **`src/lib/persistentCache.ts`** — tiny localStorage stale-while-revalidate
  helpers: `loadPersisted<T>(key, maxAgeMs=1d)`, `savePersisted(key, data)`,
  `clearPersisted(key?)`, and `withTimeout(promise, ms, label)`. Namespaced under
  `crystal_view_cache:`; all reads/writes are best-effort and never throw. This
  is the same pattern `ModelsView` proved out, now reusable.
- **`src/styles/viewStyles.ts` → `lazyRow(estimatedHeightPx)`** — returns
  `{ contentVisibility: "auto", containIntrinsicSize: "auto <px>" }`. Lightweight
  "virtualization": the browser skips layout **and** paint for off-screen rows
  while keeping them in the DOM, so it works with variable row heights and
  preserves scroll position, selection, and find-in-page. **No dependency added**
  (a full windowing lib was unnecessary and would have added bundle weight).

### Part A — caching applied (instant nav + restart persistence)
| View | Before | After |
|------|--------|-------|
| **SessionsView** | raw `invoke("openclaw sessions --json")`, uncached, `loading=true` every mount, wiped list on error | hydrates `sessions` synchronously from `crystal_view_cache:sessions`; `loading` starts `false` when cached; persists the canonical (unfiltered) list on success + after deletes; 20 s bounded timeout; keeps cached list visible on error (SWR) |
| **TasksView** | raw uncached `openclaw tasks list --json`, re-run every 15 s, blocking skeleton each mount | hydrates from `crystal_view_cache:tasks:all:all`; `loading` starts `false` when cached; persists per filter key on success; 15 s bounded timeout; 15 s poll now refreshes silently under the cached list (no skeleton flash); keeps last good list on error |
| **ChannelsView** | `cachedCommand` (in-memory only) → cold every restart, status CLI 15 s+ | adds disk hydration (`crystal_view_cache:channels`): paints last-known channels instantly, persists merged list on success, keeps cached list on error |

In each case the skeleton/spinner guard changed from `loading ?` to
`loading && list.length === 0 ?` so cached data shows immediately while a
background refresh runs. Mutations still refetch (delete/cleanup/login/logout/add).

LessonsView / DecisionsView were already covered by the Pass-2 `osStore` SWR
cache (and use selector subscriptions), so they needed no new caching — only the
memoization below.

### Part B — scroll smoothness applied
- **`content-visibility: auto`** (via `lazyRow`) on every long-list row:
  SessionsView cards, TasksView task cards, LessonsView `LessonCard`,
  DecisionsView `DecisionCard`, and ConversationView `MessageBubble` (excluded
  for the latest/streaming bubble so its growing height never nudges scroll).
- **`React.memo` on row components** so a data tick / parent re-render doesn't
  re-render the whole list:
  - `SessionCard` — also refactored to **stable id-based callbacks**
    (`deleteSession`/`toggleSelect` are now `useCallback`, helpers `formatAge`/
    `formatTokens` hoisted to module scope) so memo is actually effective; rows
    only re-render when their own `isSelected`/`isDeleting` flips.
  - `LessonCard`, `DecisionCard` — memoized (props are primitives / stable).
- **Selector-based subscriptions** were already used by Lessons/Decisions
  (`useOsStore(s => s.lessons)` etc.) — preserved.
- ConversationView `MessageBubble` was **not** wrapped in `React.memo`: it takes
  many inline-arrow callback props, so a correct memo would need a custom
  comparator and risks stale closures during streaming. The pure-CSS
  `content-visibility` win is behavior-free and already removes the dominant
  scroll cost (off-screen markdown subtrees aren't laid out/painted).

### Staged — virtualization/caching for OFF-LIMITS files (do NOT apply here)

**`SubagentsView.tsx` / `AgentsView.tsx` (owner: agents-subagents worker).**
Same pattern as SessionsView: import `lazyRow` from `@/styles/viewStyles` and
spread it into each agent/subagent row's style, e.g.
```tsx
<div style={{ ...glowCard(color), padding: 12, ...lazyRow(96) }}> … </div>
```
and wrap the row component in `React.memo`. For caching, hydrate the list from
`loadPersisted("subagents")` / `savePersisted` (from `@/lib/persistentCache`) so
the agent lists survive navigation, plus the `osExec`/`fetchForgeAgentLists`
fixes already staged above.

**`CityView.tsx` / `src/components/city/*` (owner: 456be57c).**
Any scrolling log/activity panels there should spread `lazyRow(estPx)` into row
styles. More importantly for that view: pause the `requestAnimationFrame` loop
when the view is inactive (see the App.tsx keep-alive note) — that's a bigger
CPU win than list virtualization for the animated city.

**`HomeView.tsx` / `MemoryView.tsx` (owner: memory-pipeline-fix worker).**
For the memory feed / recent-activity lists, spread `lazyRow(estPx)` into row
styles and `React.memo` the row component. Memory list data can also use
`loadPersisted`/`savePersisted` for instant repaint on revisit (in addition to
the `getMemoryStatus()`-without-`true` fix already staged above).

**`CommandCenterView.tsx` (a queued cron task will touch it).**
Left untouched to avoid a merge conflict. When that task lands, its long
event/feed list can adopt `lazyRow(estPx)` on rows + `React.memo` with **no**
behavioral/toggle changes — purely a rendering optimization.

---

## Typecheck + build

- `npm run build` = `tsc && vite build` — **green** before and after.
- `npm test` = `vitest run` — **green**: 9 files, 89 tests passing.
- **No dependency added** for virtualization (content-visibility is pure CSS).
- Bundle is essentially unchanged (the wins are runtime caching + CSS, not bundle
  shape):
  - New shared util chunk `persistentCache` **0.49 kB** (gz 0.34) — used by
    Sessions/Tasks/Channels.
  - `viewStyles` 3.69 kB (gz 1.22) — `lazyRow` helper added.
  - `SessionsView` 18.31 kB (gz 5.31), `TasksView` 10.81 kB (gz 3.29),
    `ChannelsView` 23.95 kB (gz 7.21), `LessonsView` 7.45 kB (gz 2.54),
    `DecisionsView` 8.12 kB (gz 2.61) — all within noise of their prior sizes.
  - `osStore` chunk 8.39 kB (gz 1.89) from Pass 2. Largest chunks unchanged:
    `index` 364 kB (gz 110.8), `vendor-markdown` 335 kB (gz 101.6,
    lazy/chat-only), `ConversationView` 79.7 kB, `CommandCenterView` 67.2 kB,
    `HomeView` 62.5 kB.
