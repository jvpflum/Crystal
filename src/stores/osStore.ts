import { create } from "zustand";
import {
  openclawClient,
  type OsTask,
  type OsProject,
  type OsProjectState,
  type OsTaskStatus,
  type OsTaskFilter,
  type OsCreateTaskInput,
  type OsUpdateTaskInput,
  type OsCreateProjectInput,
  type OsUpdateProjectInput,
  type OsLesson,
  type OsRecordLessonInput,
  type OsDecision,
  type OsCreateDecisionInput,
  type OsSetProjectStateInput,
  type OsExecutionTarget,
  type OsRegisterTargetInput,
  type OsExecutionRun,
  type OsExecDispatchInput,
  type OsTaskExecutionHistoryEntry,
  type OsSkill,
  type OsSkillFilter,
  type OsRegisterSkillInput,
  type OsInvokeSkillInput,
  type OsSkillInvokeResult,
  type OsSkillImportSummary,
  type OsCreateStudioRunInput,
} from "@/lib/openclaw";

/**
 * Crystal OS store — projects + tasks for the Board / Projects views.
 *
 * Backed entirely by the `openclaw os ... --json` CLI (see lib/openclaw.ts
 * os* methods). Board moves are optimistic: local state updates immediately,
 * then the backend call reconciles (and reloads on failure, since the service
 * layer may auto-(un)block dependent tasks). The crystal-os plugin is opt-in;
 * when disabled, loads set `unavailable` so views can show an enable hint.
 */

interface OsState {
  tasks: OsTask[];
  projects: OsProject[];
  projectState: Record<string, OsProjectState>;
  lessons: OsLesson[];
  decisions: OsDecision[];
  targets: OsExecutionTarget[];
  runs: OsExecutionRun[];
  skills: OsSkill[];
  studioRuns: OsExecutionRun[];
  /** Execution/PEVIC history keyed by task id. */
  execHistory: Record<string, OsTaskExecutionHistoryEntry[]>;

  loadingTasks: boolean;
  loadingProjects: boolean;
  loadingLessons: boolean;
  loadingDecisions: boolean;
  loadingTargets: boolean;
  loadingSkills: boolean;
  loadingStudio: boolean;
  error: string | null;
  /** True once a load failed because the plugin appears disabled/missing. */
  unavailable: boolean;

  /** Board filters. */
  activeProjectId: string | null;
  searchQuery: string;

  setActiveProject: (id: string | null) => void;
  setSearchQuery: (q: string) => void;

  loadTasks: (filter?: OsTaskFilter, opts?: { force?: boolean }) => Promise<void>;
  loadProjects: (opts?: { force?: boolean }) => Promise<void>;
  refreshAll: () => Promise<void>;

  createTask: (input: OsCreateTaskInput) => Promise<OsTask | null>;
  updateTask: (id: string, input: OsUpdateTaskInput) => Promise<OsTask | null>;
  setTaskStatus: (id: string, status: OsTaskStatus) => Promise<void>;
  completeTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  createProject: (input: OsCreateProjectInput) => Promise<OsProject | null>;
  updateProject: (id: string, input: OsUpdateProjectInput) => Promise<OsProject | null>;
  archiveProject: (id: string) => Promise<void>;
  loadProjectDetail: (id: string) => Promise<OsProject | null>;
  loadProjectState: (id: string) => Promise<OsProjectState | null>;
  setProjectState: (id: string, input: OsSetProjectStateInput) => Promise<OsProjectState | null>;
  addMilestone: (projectId: string, title: string, dueDate?: string) => Promise<void>;
  completeMilestone: (projectId: string, milestoneId: string) => Promise<void>;
  addGoal: (projectId: string, text: string) => Promise<void>;

  loadLessons: (projectId?: string, opts?: { force?: boolean }) => Promise<void>;
  searchLessons: (query: string) => Promise<void>;
  recordLesson: (input: OsRecordLessonInput) => Promise<OsLesson | null>;

  loadDecisions: (projectId?: string, opts?: { force?: boolean }) => Promise<void>;
  searchDecisions: (query: string) => Promise<void>;
  createDecision: (input: OsCreateDecisionInput) => Promise<OsDecision | null>;

  loadTargets: (opts?: { force?: boolean }) => Promise<void>;
  registerTarget: (input: OsRegisterTargetInput) => Promise<OsExecutionTarget | null>;
  healthCheckTargets: (id?: string) => Promise<void>;
  loadRuns: (filter?: { taskId?: string; targetId?: string; limit?: number }, opts?: { force?: boolean }) => Promise<void>;
  dispatchExec: (input: OsExecDispatchInput) => Promise<OsExecutionRun | null>;
  cancelRun: (runId: string) => Promise<void>;
  loadExecHistory: (taskId: string) => Promise<OsTaskExecutionHistoryEntry[]>;

  loadSkills: (filter?: OsSkillFilter, opts?: { force?: boolean }) => Promise<void>;
  searchSkills: (query: string) => Promise<void>;
  registerSkill: (input: OsRegisterSkillInput) => Promise<OsSkill | null>;
  invokeSkill: (idOrName: string, input?: OsInvokeSkillInput) => Promise<OsSkillInvokeResult | null>;
  importSkills: (source?: "nvidia" | "crystal" | "all") => Promise<OsSkillImportSummary[] | null>;

  loadStudioRuns: (limit?: number, opts?: { force?: boolean }) => Promise<void>;
  analyzeDataset: (path: string) => Promise<unknown>;
  createStudioRun: (input: OsCreateStudioRunInput) => Promise<OsExecutionRun | null>;
  refreshStudioRun: (runId: string) => Promise<OsExecutionRun | null>;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isUnavailable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("not enabled") || m.includes("crystal-os plugin") || m.includes("unknown command");
}

/**
 * Stale-while-revalidate cache for the `openclaw os ... --json` CLI loaders.
 *
 * Every os* method spawns a cold CLI process (bypassing lib/cache's throttle),
 * so without this guard each view re-ran the command on every mount — the main
 * reason the Board / Projects / Lessons / Decisions / Targets / Studio / Skills
 * pages felt slow on every visit. Loaders now skip the spawn when the same
 * query was fetched within OS_CACHE_TTL, and never flash a skeleton over data
 * that is already on screen. Mutations and the refresh buttons pass
 * `{ force: true }` to bypass the cache.
 */
const OS_CACHE_TTL = 20_000;
const osLoadedAt = new Map<string, number>();

function osFresh(key: string, ttl = OS_CACHE_TTL): boolean {
  const t = osLoadedAt.get(key);
  return t != null && Date.now() - t < ttl;
}

function markOsLoaded(key: string): void {
  osLoadedAt.set(key, Date.now());
}

/** Drop cached freshness for a key (or all keys) so the next load refetches. */
export function invalidateOsCache(prefix?: string): void {
  if (!prefix) {
    osLoadedAt.clear();
    return;
  }
  for (const key of [...osLoadedAt.keys()]) {
    if (key.startsWith(prefix)) osLoadedAt.delete(key);
  }
}

export const useOsStore = create<OsState>((set, get) => ({
  tasks: [],
  projects: [],
  projectState: {},
  lessons: [],
  decisions: [],
  targets: [],
  runs: [],
  skills: [],
  studioRuns: [],
  execHistory: {},
  loadingTasks: false,
  loadingProjects: false,
  loadingLessons: false,
  loadingDecisions: false,
  loadingTargets: false,
  loadingSkills: false,
  loadingStudio: false,
  error: null,
  unavailable: false,
  activeProjectId: null,
  searchQuery: "",

  setActiveProject: (id) => {
    set({ activeProjectId: id });
    void get().loadTasks();
  },
  setSearchQuery: (q) => set({ searchQuery: q }),

  loadTasks: async (filter, opts) => {
    const { activeProjectId, searchQuery } = get();
    const effective: OsTaskFilter = {
      ...(activeProjectId ? { projectId: activeProjectId } : {}),
      ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
      ...filter,
    };
    const force = opts?.force ?? false;
    const key = `tasks:${JSON.stringify(effective)}`;
    if (!force && osFresh(key)) return;
    if (force || get().tasks.length === 0) set({ loadingTasks: true });
    try {
      const tasks = await openclawClient.osListTasks(effective);
      markOsLoaded(key);
      set({ tasks, loadingTasks: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingTasks: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  loadProjects: async (opts) => {
    const force = opts?.force ?? false;
    const key = "projects";
    if (!force && osFresh(key)) return;
    if (force || get().projects.length === 0) set({ loadingProjects: true });
    try {
      const projects = await openclawClient.osListProjects();
      markOsLoaded(key);
      set({ projects, loadingProjects: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingProjects: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  refreshAll: async () => {
    await Promise.allSettled([
      get().loadProjects({ force: true }),
      get().loadTasks(undefined, { force: true }),
    ]);
  },

  createTask: async (input) => {
    try {
      const task = await openclawClient.osCreateTask(input);
      await get().loadTasks(undefined, { force: true });
      return task;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  updateTask: async (id, input) => {
    try {
      const task = await openclawClient.osUpdateTask(id, input);
      await get().loadTasks(undefined, { force: true });
      return task;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  setTaskStatus: async (id, status) => {
    const prev = get().tasks;
    // Optimistic: reflect the move immediately.
    set({ tasks: prev.map((t) => (t.id === id ? { ...t, status } : t)) });
    try {
      await openclawClient.osSetTaskStatus(id, status);
      // Reload: the service may auto-(un)block dependents on this change.
      await get().loadTasks(undefined, { force: true });
    } catch (e) {
      set({ tasks: prev, error: describeError(e) });
    }
  },

  completeTask: async (id) => {
    const prev = get().tasks;
    set({ tasks: prev.map((t) => (t.id === id ? { ...t, status: "completed" } : t)) });
    try {
      await openclawClient.osCompleteTask(id);
      await get().loadTasks(undefined, { force: true });
    } catch (e) {
      set({ tasks: prev, error: describeError(e) });
    }
  },

  deleteTask: async (id) => {
    const prev = get().tasks;
    set({ tasks: prev.filter((t) => t.id !== id) });
    try {
      await openclawClient.osDeleteTask(id);
      await get().loadTasks(undefined, { force: true });
    } catch (e) {
      set({ tasks: prev, error: describeError(e) });
    }
  },

  createProject: async (input) => {
    try {
      const project = await openclawClient.osCreateProject(input);
      await get().loadProjects({ force: true });
      return project;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  updateProject: async (id, input) => {
    try {
      const project = await openclawClient.osUpdateProject(id, input);
      await get().loadProjects({ force: true });
      return project;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  archiveProject: async (id) => {
    try {
      await openclawClient.osArchiveProject(id);
      await get().loadProjects({ force: true });
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  loadProjectDetail: async (id) => {
    try {
      const project = await openclawClient.osGetProject(id);
      set((s) => ({ projects: s.projects.map((p) => (p.id === id ? project : p)) }));
      return project;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  loadProjectState: async (id) => {
    try {
      const state = await openclawClient.osGetProjectState(id);
      set((s) => ({ projectState: { ...s.projectState, [id]: state } }));
      return state;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  setProjectState: async (id, input) => {
    try {
      const state = await openclawClient.osSetProjectState(id, input);
      set((s) => ({ projectState: { ...s.projectState, [id]: state } }));
      return state;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  addMilestone: async (projectId, title, dueDate) => {
    try {
      await openclawClient.osAddMilestone(projectId, title, dueDate);
      await get().loadProjectDetail(projectId);
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  completeMilestone: async (projectId, milestoneId) => {
    try {
      await openclawClient.osCompleteMilestone(milestoneId);
      await get().loadProjectDetail(projectId);
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  addGoal: async (projectId, text) => {
    try {
      await openclawClient.osAddGoal(projectId, text);
      await get().loadProjectDetail(projectId);
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  loadLessons: async (projectId, opts) => {
    const force = opts?.force ?? false;
    const key = `lessons:${projectId ?? ""}`;
    if (!force && osFresh(key)) return;
    if (force || get().lessons.length === 0) set({ loadingLessons: true });
    try {
      const lessons = await openclawClient.osListLessons(projectId);
      markOsLoaded(key);
      set({ lessons, loadingLessons: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingLessons: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  searchLessons: async (query) => {
    if (!query.trim()) {
      await get().loadLessons();
      return;
    }
    set({ loadingLessons: true });
    try {
      const lessons = await openclawClient.osSearchLessons(query);
      set({ lessons, loadingLessons: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingLessons: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  recordLesson: async (input) => {
    try {
      const lesson = await openclawClient.osRecordLesson(input);
      await get().loadLessons(undefined, { force: true });
      return lesson;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  loadDecisions: async (projectId, opts) => {
    const force = opts?.force ?? false;
    const key = `decisions:${projectId ?? ""}`;
    if (!force && osFresh(key)) return;
    if (force || get().decisions.length === 0) set({ loadingDecisions: true });
    try {
      const decisions = await openclawClient.osListDecisions(projectId);
      markOsLoaded(key);
      set({ decisions, loadingDecisions: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingDecisions: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  searchDecisions: async (query) => {
    if (!query.trim()) {
      await get().loadDecisions();
      return;
    }
    set({ loadingDecisions: true });
    try {
      const decisions = await openclawClient.osSearchDecisions(query);
      set({ decisions, loadingDecisions: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingDecisions: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  createDecision: async (input) => {
    try {
      const decision = await openclawClient.osCreateDecision(input);
      await get().loadDecisions(undefined, { force: true });
      return decision;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  loadTargets: async (opts) => {
    const force = opts?.force ?? false;
    const key = "targets";
    if (!force && osFresh(key)) return;
    if (force || get().targets.length === 0) set({ loadingTargets: true });
    try {
      const targets = await openclawClient.osListTargets();
      markOsLoaded(key);
      set({ targets, loadingTargets: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingTargets: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  registerTarget: async (input) => {
    try {
      const target = await openclawClient.osRegisterTarget(input);
      await get().loadTargets({ force: true });
      return target;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  healthCheckTargets: async (id) => {
    try {
      await openclawClient.osHealthCheckTargets(id);
      await get().loadTargets({ force: true });
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  loadRuns: async (filter, opts) => {
    const force = opts?.force ?? false;
    const key = `runs:${JSON.stringify(filter ?? {})}`;
    if (!force && osFresh(key)) return;
    try {
      const runs = await openclawClient.osListRuns(filter ?? {});
      markOsLoaded(key);
      set({ runs, error: null });
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  dispatchExec: async (input) => {
    try {
      const run = await openclawClient.osDispatchExec(input);
      await get().loadRuns(undefined, { force: true });
      if (input.taskId) await get().loadExecHistory(input.taskId);
      return run;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  cancelRun: async (runId) => {
    try {
      await openclawClient.osCancelRun(runId);
      await get().loadRuns(undefined, { force: true });
    } catch (e) {
      set({ error: describeError(e) });
    }
  },

  loadExecHistory: async (taskId) => {
    try {
      const history = await openclawClient.osPevicHistory(taskId);
      set((s) => ({ execHistory: { ...s.execHistory, [taskId]: history } }));
      return history;
    } catch (e) {
      set({ error: describeError(e) });
      return [];
    }
  },

  loadSkills: async (filter, opts) => {
    const force = opts?.force ?? false;
    const key = `skills:${JSON.stringify(filter ?? {})}`;
    if (!force && osFresh(key)) return;
    if (force || get().skills.length === 0) set({ loadingSkills: true });
    try {
      const skills = await openclawClient.osListSkills(filter ?? {});
      markOsLoaded(key);
      set({ skills, loadingSkills: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingSkills: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  searchSkills: async (query) => {
    if (!query.trim()) {
      await get().loadSkills();
      return;
    }
    set({ loadingSkills: true });
    try {
      const skills = await openclawClient.osSearchSkills(query);
      set({ skills, loadingSkills: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingSkills: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  registerSkill: async (input) => {
    try {
      const skill = await openclawClient.osRegisterSkill(input);
      await get().loadSkills(undefined, { force: true });
      return skill;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  invokeSkill: async (idOrName, input) => {
    try {
      const result = await openclawClient.osInvokeSkill(idOrName, input ?? {});
      await get().loadRuns(undefined, { force: true });
      return result;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  importSkills: async (source) => {
    set({ loadingSkills: true });
    try {
      const summaries = await openclawClient.osImportSkills(source ?? "all");
      await get().loadSkills(undefined, { force: true });
      set({ loadingSkills: false });
      return summaries;
    } catch (e) {
      const message = describeError(e);
      set({ loadingSkills: false, error: message, unavailable: isUnavailable(message) });
      return null;
    }
  },

  loadStudioRuns: async (limit, opts) => {
    const force = opts?.force ?? false;
    const key = `studioRuns:${limit ?? 50}`;
    if (!force && osFresh(key)) return;
    if (force || get().studioRuns.length === 0) set({ loadingStudio: true });
    try {
      const studioRuns = await openclawClient.osStudioListRuns(limit ?? 50);
      markOsLoaded(key);
      set({ studioRuns, loadingStudio: false, error: null, unavailable: false });
    } catch (e) {
      const message = describeError(e);
      set({ loadingStudio: false, error: message, unavailable: isUnavailable(message) });
    }
  },

  analyzeDataset: async (path) => {
    try {
      return await openclawClient.osStudioAnalyzeDataset(path);
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  createStudioRun: async (input) => {
    try {
      const run = await openclawClient.osStudioCreateRun(input);
      await get().loadStudioRuns(undefined, { force: true });
      return run;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },

  refreshStudioRun: async (runId) => {
    try {
      const run = await openclawClient.osStudioRunStatus(runId);
      set((s) => ({ studioRuns: s.studioRuns.map((r) => (r.id === runId ? run : r)) }));
      return run;
    } catch (e) {
      set({ error: describeError(e) });
      return null;
    }
  },
}));
