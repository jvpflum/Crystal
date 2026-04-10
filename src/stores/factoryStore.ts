import { create } from "zustand";
import { persist } from "zustand/middleware";

/* ─── Pipeline types ─────────────────────────────────────────── */

export type PipelineStage = "plan" | "code" | "test" | "review";
export type StageStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export const PIPELINE_STAGES: PipelineStage[] = ["plan", "code", "test", "review"];

export interface StageResult {
  stage: PipelineStage;
  status: StageStatus;
  output: string;
  startedAt?: number;
  completedAt?: number;
  streamId?: string;
  exitCode?: number;
}

export interface Build {
  id: string;
  title: string;
  task: string;
  runtime: string;
  model: string;
  cwd: string;
  thinking: string;
  stages: StageResult[];
  currentStage: PipelineStage | "done" | "failed";
  createdAt: number;
  completedAt?: number;
}

/* ─── Legacy / shared types ──────────────────────────────────── */

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

/* ─── Store ──────────────────────────────────────────────────── */

interface FactoryState {
  projects: FactoryProject[];
  builds: Build[];
  forgeSchedules: ForgeSchedule[];
  activeBuildId: string | null;

  addProject: (project: Omit<FactoryProject, "id" | "createdAt" | "updatedAt">) => string;
  updateProject: (id: string, update: Partial<FactoryProject>) => void;
  removeProject: (id: string) => void;

  addBuild: (b: Pick<Build, "title" | "task" | "runtime" | "model" | "cwd" | "thinking">) => string;
  updateBuild: (id: string, update: Partial<Build>) => void;
  removeBuild: (id: string) => void;
  setActiveBuild: (id: string | null) => void;

  updateStage: (buildId: string, stage: PipelineStage, update: Partial<StageResult>) => void;
  appendStageOutput: (buildId: string, stage: PipelineStage, text: string) => void;
  advanceStage: (buildId: string) => void;
  failBuild: (buildId: string) => void;

  addForgeSchedule: (s: Omit<ForgeSchedule, "id" | "createdAt">) => string;
  updateForgeSchedule: (id: string, update: Partial<Omit<ForgeSchedule, "id" | "createdAt">>) => void;
  removeForgeSchedule: (id: string) => void;
}

const uid = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function createEmptyStages(): StageResult[] {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    status: "pending" as StageStatus,
    output: "",
  }));
}

export const useFactoryStore = create<FactoryState>()(
  persist(
    (set) => ({
      projects: [],
      builds: [],
      forgeSchedules: [],
      activeBuildId: null,

      /* ─ Projects ─ */
      addProject: (p) => {
        const id = uid();
        const now = Date.now();
        set((s) => ({
          projects: [...s.projects, { ...p, id, createdAt: now, updatedAt: now }],
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
        })),

      /* ─ Builds (pipeline-aware) ─ */
      addBuild: (b) => {
        const id = uid();
        const build: Build = {
          ...b,
          id,
          stages: createEmptyStages(),
          currentStage: "plan",
          createdAt: Date.now(),
        };
        set((s) => ({
          builds: [build, ...s.builds],
          activeBuildId: id,
        }));
        return id;
      },
      updateBuild: (id, update) =>
        set((s) => ({
          builds: s.builds.map((b) => (b.id === id ? { ...b, ...update } : b)),
        })),
      removeBuild: (id) =>
        set((s) => ({
          builds: s.builds.filter((b) => b.id !== id),
          activeBuildId: s.activeBuildId === id ? null : s.activeBuildId,
        })),
      setActiveBuild: (id) => set({ activeBuildId: id }),

      updateStage: (buildId, stage, update) =>
        set((s) => ({
          builds: s.builds.map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  stages: b.stages.map((sr) =>
                    sr.stage === stage ? { ...sr, ...update } : sr
                  ),
                }
              : b
          ),
        })),

      appendStageOutput: (buildId, stage, text) =>
        set((s) => ({
          builds: s.builds.map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  stages: b.stages.map((sr) =>
                    sr.stage === stage ? { ...sr, output: sr.output + text } : sr
                  ),
                }
              : b
          ),
        })),

      advanceStage: (buildId) =>
        set((s) => ({
          builds: s.builds.map((b) => {
            if (b.id !== buildId) return b;
            const idx = PIPELINE_STAGES.indexOf(b.currentStage as PipelineStage);
            if (idx === -1) return b;
            const next = idx + 1 < PIPELINE_STAGES.length ? PIPELINE_STAGES[idx + 1] : "done";
            return {
              ...b,
              currentStage: next as PipelineStage | "done",
              completedAt: next === "done" ? Date.now() : undefined,
            };
          }),
        })),

      failBuild: (buildId) =>
        set((s) => ({
          builds: s.builds.map((b) =>
            b.id === buildId
              ? { ...b, currentStage: "failed", completedAt: Date.now() }
              : b
          ),
        })),

      /* ─ Schedules ─ */
      addForgeSchedule: (row) => {
        const id = uid();
        set((s) => ({
          forgeSchedules: [...s.forgeSchedules, { ...row, id, createdAt: Date.now() }],
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
        builds: state.builds,
        forgeSchedules: state.forgeSchedules,
      }),
    }
  )
);
