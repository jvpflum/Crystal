import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AgentType = string;

export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface FactoryProject {
  id: string;
  name: string;
  description: string;
  path: string;
  techStack: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentRun {
  id: string;
  projectId: string;
  agentType: AgentType;
  objective: string;
  status: RunStatus;
  output: string;
  error?: string;
  pid?: number;
  logFile?: string;
  startedAt?: number;
  completedAt?: number;
  createdAt: number;
}

/** Saved Forge night / recurring build definitions (registered separately with OpenClaw cron). */
export interface ForgeSchedule {
  id: string;
  name: string;
  projectId: string | null;
  task: string;
  cwd: string;
  runtime: string;
  model: string;
  thinking: string;
  cronExpression: string;
  openclawJobName?: string;
  lastRegisteredAt?: number;
  createdAt: number;
}

export interface FileSnapshot {
  before: Map<string, number>;
  after: Map<string, number>;
}

interface FactoryState {
  projects: FactoryProject[];
  runs: AgentRun[];
  forgeSchedules: ForgeSchedule[];
  selectedProjectId: string | null;
  focusedRunId: string | null;
  fileSnapshots: Record<string, FileSnapshot>;

  addProject: (project: Omit<FactoryProject, "id" | "createdAt" | "updatedAt">) => string;
  updateProject: (id: string, update: Partial<FactoryProject>) => void;
  removeProject: (id: string) => void;
  selectProject: (id: string | null) => void;

  addRun: (run: Pick<AgentRun, "projectId" | "agentType" | "objective">) => string;
  updateRun: (id: string, update: Partial<AgentRun>) => void;
  appendRunOutput: (id: string, text: string) => void;
  removeRun: (id: string) => void;
  clearCompletedRuns: (projectId: string) => void;

  setFocusedRun: (id: string | null) => void;
  setFileSnapshot: (runId: string, snapshot: FileSnapshot) => void;

  addForgeSchedule: (s: Omit<ForgeSchedule, "id" | "createdAt">) => string;
  updateForgeSchedule: (id: string, update: Partial<Omit<ForgeSchedule, "id" | "createdAt">>) => void;
  removeForgeSchedule: (id: string) => void;
}

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useFactoryStore = create<FactoryState>()(
  persist(
    (set) => ({
      projects: [],
      runs: [],
      forgeSchedules: [],
      selectedProjectId: null,
      focusedRunId: null,
      fileSnapshots: {},

      addProject: (p) => {
        const id = uid();
        const now = Date.now();
        set((s) => ({
          projects: [...s.projects, { ...p, id, createdAt: now, updatedAt: now }],
          selectedProjectId: id,
        }));
        return id;
      },

      updateProject: (id, update) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, ...update, updatedAt: Date.now() } : p
          ),
        })),

      removeProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          runs: s.runs.filter((r) => r.projectId !== id),
          selectedProjectId: s.selectedProjectId === id ? null : s.selectedProjectId,
        })),

      selectProject: (id) => set({ selectedProjectId: id }),

      addRun: (r) => {
        const id = uid();
        set((s) => ({
          runs: [
            { ...r, id, status: "queued", output: "", createdAt: Date.now() },
            ...s.runs,
          ],
        }));
        return id;
      },

      updateRun: (id, update) =>
        set((s) => ({
          runs: s.runs.map((r) => (r.id === id ? { ...r, ...update } : r)),
        })),

      appendRunOutput: (id, text) =>
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === id ? { ...r, output: r.output + text } : r
          ),
        })),

      removeRun: (id) =>
        set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),

      clearCompletedRuns: (projectId) =>
        set((s) => ({
          runs: s.runs.filter(
            (r) => r.projectId !== projectId || r.status === "running" || r.status === "queued"
          ),
        })),

      setFocusedRun: (id) => set({ focusedRunId: id }),

      setFileSnapshot: (runId, snapshot) =>
        set((s) => ({
          fileSnapshots: { ...s.fileSnapshots, [runId]: snapshot },
        })),

      addForgeSchedule: (row) => {
        const id = uid();
        const now = Date.now();
        set((s) => ({
          forgeSchedules: [...s.forgeSchedules, { ...row, id, createdAt: now }],
        }));
        return id;
      },

      updateForgeSchedule: (id, update) =>
        set((s) => ({
          forgeSchedules: s.forgeSchedules.map((f) =>
            f.id === id ? { ...f, ...update } : f
          ),
        })),

      removeForgeSchedule: (id) =>
        set((s) => ({
          forgeSchedules: s.forgeSchedules.filter((f) => f.id !== id),
        })),
    }),
    {
      name: "crystal-factory",
      partialize: (state) => ({
        projects: state.projects,
        runs: state.runs,
        forgeSchedules: state.forgeSchedules,
        selectedProjectId: state.selectedProjectId,
      }),
    }
  )
);
