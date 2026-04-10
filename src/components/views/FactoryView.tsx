import React, { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useFactoryStore,
  PIPELINE_STAGES,
  type Build,
  type PipelineStage,
  type StageStatus,
} from "@/stores/factoryStore";
import { factoryService } from "@/lib/factory";
import { escapeShellArg } from "@/lib/tools";
import { FileTree } from "@/components/factory/FileTree";
import { FileViewer } from "@/components/factory/FileViewer";
import {
  EASE, glowCard, hoverLift, hoverReset, pressDown, pressUp,
  innerPanel, inputStyle, btnPrimary, btnSecondary, MONO,
} from "@/styles/viewStyles";
import {
  Loader2, Play, Zap, GitBranch, Terminal,
  Square, Eye, ChevronDown,
  Clock, ExternalLink,
  GitCommit, Upload, Globe, Check, AlertTriangle,
  RotateCcw, SkipForward, X, Search,
  FileCode, TestTube, ClipboardCheck, Lightbulb,
  Hammer,
} from "lucide-react";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS & SHARED STYLES
   ═══════════════════════════════════════════════════════════════ */

const NVIDIA_GREEN = "#76b900";

const STAGE_META: Record<PipelineStage, { label: string; icon: typeof Lightbulb; color: string }> = {
  plan:   { label: "Plan",   icon: Lightbulb,      color: "#60a5fa" },
  code:   { label: "Code",   icon: FileCode,        color: NVIDIA_GREEN },
  test:   { label: "Test",   icon: TestTube,        color: "#fbbf24" },
  review: { label: "Review", icon: ClipboardCheck,  color: "#a78bfa" },
};

const STATUS_DOT: Record<StageStatus | "done", string> = {
  pending: "var(--text-muted)",
  running: NVIDIA_GREEN,
  passed:  "#4ade80",
  failed:  "#f87171",
  skipped: "#fbbf24",
  done:    "#4ade80",
};

const BTN_DANGER: CSSProperties = {
  background: "rgba(239,68,68,0.1)", color: "#ef4444",
  border: "none", borderRadius: 10, padding: "6px 14px",
  fontSize: 11, fontWeight: 500, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
  transition: `all 0.2s ${EASE}`,
};

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

type FactoryTabId = "pipeline" | "workspace" | "history" | "deploy";

/* ═══════════════════════════════════════════════════════════════
   FACTORY VIEW — Main Shell
   ═══════════════════════════════════════════════════════════════ */

export function FactoryView() {
  const [tab, setTab] = useState<FactoryTabId>("pipeline");
  const { builds } = useFactoryStore();

  const activeBuilds = builds.filter((b) => b.currentStage !== "done" && b.currentStage !== "failed");
  const completedBuilds = builds.filter((b) => b.currentStage === "done" || b.currentStage === "failed");

  const tabs: { id: FactoryTabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "pipeline", label: "Pipeline", icon: <Zap style={{ width: 12, height: 12 }} />, badge: activeBuilds.length || undefined },
    { id: "workspace", label: "Workspace", icon: <Terminal style={{ width: 12, height: 12 }} /> },
    { id: "history", label: "History", icon: <Clock style={{ width: 12, height: 12 }} />, badge: completedBuilds.length || undefined },
    { id: "deploy", label: "Git & Deploy", icon: <GitBranch style={{ width: 12, height: 12 }} /> },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`
        @keyframes _spin { to { transform: rotate(360deg) } }
        @keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
        @keyframes stage-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(118,185,0,0.3) } 50% { box-shadow: 0 0 12px 3px rgba(118,185,0,0.15) } }
      `}</style>

      {/* Header */}
      <div style={{ padding: "18px 24px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
          <Hammer style={{ width: 18, height: 18, color: NVIDIA_GREEN }} />
          <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>The Forge</h2>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 12px" }}>
          AI Software Factory &middot; Plan &rarr; Code &rarr; Test &rarr; Review
        </p>

        {/* Stats bar */}
        <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
          {[
            { label: "Active", value: activeBuilds.length, color: NVIDIA_GREEN },
            { label: "Completed", value: completedBuilds.filter((b) => b.currentStage === "done").length, color: "#4ade80" },
            { label: "Failed", value: completedBuilds.filter((b) => b.currentStage === "failed").length, color: "#f87171" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", fontFamily: MONO }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t.id ? NVIDIA_GREEN : "var(--text-muted)",
              borderBottom: tab === t.id ? `2px solid ${NVIDIA_GREEN}` : "2px solid transparent",
              transition: `all 0.15s ${EASE}`, display: "flex", alignItems: "center", gap: 6,
            }}>
              {t.icon} {t.label}
              {t.badge != null && (
                <span style={{
                  fontSize: 9, fontWeight: 700, background: `color-mix(in srgb, ${NVIDIA_GREEN} 15%, transparent)`,
                  color: NVIDIA_GREEN, padding: "1px 6px", borderRadius: 10, fontFamily: MONO,
                }}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === "pipeline" && <PipelineTab />}
      {tab === "workspace" && <WorkspaceTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "deploy" && <DeployTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PIPELINE TAB
   ═══════════════════════════════════════════════════════════════ */

function PipelineTab() {
  const { builds, addBuild, setActiveBuild, activeBuildId } = useFactoryStore();
  const [showForm, setShowForm] = useState(false);

  const activeBuilds = builds.filter((b) => b.currentStage !== "done" && b.currentStage !== "failed");
  const activeBuild = activeBuildId ? builds.find((b) => b.id === activeBuildId) : null;

  const handleNewBuild = (b: { title: string; task: string; runtime: string; model: string; cwd: string; thinking: string }) => {
    const id = addBuild(b);
    setShowForm(false);
    factoryService.startPipeline(id);
  };

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
      {/* New Build button */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
        <button onClick={() => setShowForm(!showForm)} onMouseDown={pressDown} onMouseUp={pressUp}
          style={{ ...btnPrimary, background: NVIDIA_GREEN, display: "flex", alignItems: "center", gap: 6 }}>
          <Zap style={{ width: 13, height: 13 }} /> New Build
        </button>
      </div>

      {/* New build form */}
      {showForm && <NewBuildForm onSubmit={handleNewBuild} onCancel={() => setShowForm(false)} />}

      {/* Active builds */}
      {activeBuilds.length === 0 && !showForm && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 12, padding: "60px 24px", color: "var(--text-muted)", fontSize: 13, textAlign: "center",
        }}>
          <Hammer style={{ width: 36, height: 36, opacity: 0.3 }} />
          <div>No active builds</div>
          <div style={{ fontSize: 11 }}>Click <strong>New Build</strong> to start an automated pipeline</div>
        </div>
      )}

      {activeBuilds.map((build) => (
        <PipelineCard
          key={build.id}
          build={build}
          isSelected={build.id === activeBuildId}
          onSelect={() => setActiveBuild(build.id)}
        />
      ))}

      {/* Selected build detail */}
      {activeBuild && (activeBuild.currentStage !== "done" && activeBuild.currentStage !== "failed") && (
        <BuildOutputPanel build={activeBuild} />
      )}
    </div>
  );
}

/* ─── New Build Form ──────────────────────────────────────────── */

function NewBuildForm({ onSubmit, onCancel }: {
  onSubmit: (b: { title: string; task: string; runtime: string; model: string; cwd: string; thinking: string }) => void;
  onCancel: () => void;
}) {
  const [task, setTask] = useState("");
  const [cwd, setCwd] = useState("");
  const [runtime, setRuntime] = useState("codex");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("default");

  const handleSubmit = () => {
    if (!task.trim()) return;
    const title = task.length > 60 ? task.slice(0, 57) + "..." : task;
    onSubmit({ title, task: task.trim(), runtime, model, cwd: cwd.trim(), thinking });
  };

  return (
    <div style={{ ...glowCard(NVIDIA_GREEN), padding: 16, marginBottom: 16 }} data-glow={NVIDIA_GREEN}
      onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
        <Zap style={{ width: 14, height: 14, color: NVIDIA_GREEN }} /> New Pipeline Build
      </div>

      <textarea
        value={task} onChange={(e) => setTask(e.target.value)}
        placeholder="Describe what you want to build..."
        rows={3}
        style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", marginBottom: 10 }}
        autoFocus
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
        <div>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Runtime</label>
          <select value={runtime} onChange={(e) => setRuntime(e.target.value)}
            style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }}>
            <option value="codex">Codex</option>
            <option value="gemini-cli">Gemini CLI</option>
            <option value="claude-code">Claude Code</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Thinking</label>
          <select value={thinking} onChange={(e) => setThinking(e.target.value)}
            style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }}>
            <option value="default">Default</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Model (optional)</label>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="auto"
            style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }} />
        </div>
        <div>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Working Directory</label>
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="C:\path\to\project"
            style={{ ...inputStyle, fontSize: 12, padding: "6px 10px" }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ ...btnSecondary, fontSize: 11 }}>Cancel</button>
        <button onClick={handleSubmit} disabled={!task.trim()} onMouseDown={pressDown} onMouseUp={pressUp}
          style={{ ...btnPrimary, background: NVIDIA_GREEN, fontSize: 11, opacity: task.trim() ? 1 : 0.4 }}>
          <Play style={{ width: 12, height: 12 }} /> Start Pipeline
        </button>
      </div>
    </div>
  );
}

/* ─── Pipeline Card ──────────────────────────────────────────── */

function PipelineCard({ build, isSelected, onSelect }: {
  build: Build;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const isActive = build.currentStage !== "done" && build.currentStage !== "failed";
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [build.currentStage]);

  const duration = elapsed(((build.completedAt ?? now) - build.createdAt));
  const isActive = build.currentStage !== "done" && build.currentStage !== "failed";

  return (
    <div
      onClick={onSelect}
      style={{
        ...glowCard(isActive ? NVIDIA_GREEN : "var(--text-muted)"),
        padding: 14,
        marginBottom: 10,
        cursor: "pointer",
        borderColor: isSelected ? `color-mix(in srgb, ${NVIDIA_GREEN} 40%, transparent)` : undefined,
      }}
      data-glow={NVIDIA_GREEN}
      onMouseEnter={hoverLift}
      onMouseLeave={hoverReset}
    >
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: isActive ? NVIDIA_GREEN : build.currentStage === "done" ? "#4ade80" : "#f87171",
          animation: isActive ? "_pulse 1.5s ease-in-out infinite" : "none",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {build.title}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO, flexShrink: 0 }}>{duration}</span>
        <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0, textTransform: "capitalize" }}>{build.runtime}</span>
      </div>

      {/* Stage progress bar */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {build.stages.map((sr, i) => {
          const meta = STAGE_META[sr.stage];
          const Icon = meta.icon;
          return (
            <div key={sr.stage} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
              <StageIndicator status={sr.status} color={meta.color} />
              <Icon style={{ width: 11, height: 11, color: sr.status === "running" ? meta.color : "var(--text-muted)", transition: "color 0.2s" }} />
              <span style={{
                fontSize: 9, fontWeight: 600, color: sr.status === "running" ? meta.color : sr.status === "passed" ? "#4ade80" : sr.status === "failed" ? "#f87171" : "var(--text-muted)",
                transition: "color 0.2s",
              }}>
                {meta.label}
              </span>
              {i < 3 && (
                <div style={{ flex: 1, height: 1, background: sr.status === "passed" ? "#4ade80" : "var(--border)", transition: "background 0.3s", marginLeft: 4, marginRight: 2 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      {(build.currentStage === "failed") && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, justifyContent: "flex-end" }}>
          <button onClick={(e) => { e.stopPropagation(); factoryService.retryBuild(build.id); }}
            style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px", color: "#fbbf24", borderColor: "rgba(251,191,36,0.2)" }}>
            <RotateCcw style={{ width: 10, height: 10 }} /> Retry
          </button>
          <button onClick={(e) => { e.stopPropagation(); factoryService.skipStage(build.id); }}
            style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px" }}>
            <SkipForward style={{ width: 10, height: 10 }} /> Skip
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Stage Indicator ─────────────────────────────────────────── */

function StageIndicator({ status, color }: { status: StageStatus; color: string }) {
  const size = 14;

  if (status === "running") {
    return (
      <span style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: `color-mix(in srgb, ${color} 20%, transparent)`,
        border: `2px solid ${color}`,
        animation: "stage-pulse 1.5s ease-in-out infinite",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Loader2 style={{ width: 8, height: 8, color, animation: "_spin 1s linear infinite" }} />
      </span>
    );
  }

  if (status === "passed") {
    return (
      <span style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: "rgba(74,222,128,0.15)", border: "2px solid #4ade80",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Check style={{ width: 8, height: 8, color: "#4ade80" }} />
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: "rgba(248,113,113,0.15)", border: "2px solid #f87171",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <X style={{ width: 8, height: 8, color: "#f87171" }} />
      </span>
    );
  }

  if (status === "skipped") {
    return (
      <span style={{
        width: size, height: size, borderRadius: "50%", flexShrink: 0,
        background: "rgba(251,191,36,0.12)", border: "2px solid #fbbf24",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <SkipForward style={{ width: 6, height: 6, color: "#fbbf24" }} />
      </span>
    );
  }

  // pending
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "rgba(255,255,255,0.04)", border: "2px solid var(--border)",
    }} />
  );
}

/* ─── Build Output Panel ──────────────────────────────────────── */

function BuildOutputPanel({ build }: { build: Build }) {
  const outputRef = useRef<HTMLPreElement>(null);
  const [stageTab, setStageTab] = useState<PipelineStage>(build.currentStage as PipelineStage);

  useEffect(() => {
    if (PIPELINE_STAGES.includes(build.currentStage as PipelineStage)) {
      setStageTab(build.currentStage as PipelineStage);
    }
  }, [build.currentStage]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  });

  const stageResult = build.stages.find((s) => s.stage === stageTab);
  const isRunning = stageResult?.status === "running";

  return (
    <div style={{ ...glowCard(NVIDIA_GREEN), marginTop: 12, overflow: "hidden" }}>
      {/* Stage tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {build.stages.map((sr) => {
          const meta = STAGE_META[sr.stage];
          const Icon = meta.icon;
          const active = stageTab === sr.stage;
          return (
            <button key={sr.stage} onClick={() => setStageTab(sr.stage)} style={{
              padding: "8px 14px", fontSize: 11, fontWeight: active ? 600 : 500,
              border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              background: active ? "rgba(255,255,255,0.04)" : "transparent",
              color: active ? meta.color : "var(--text-muted)",
              borderBottom: active ? `2px solid ${meta.color}` : "2px solid transparent",
              transition: `all 0.15s ${EASE}`,
            }}>
              <Icon style={{ width: 11, height: 11 }} />
              {meta.label}
              {sr.status !== "pending" && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: STATUS_DOT[sr.status],
                  animation: sr.status === "running" ? "_pulse 1.5s ease-in-out infinite" : "none",
                }} />
              )}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* Cancel build */}
        <button onClick={() => factoryService.cancelBuild(build.id)}
          style={{ ...BTN_DANGER, margin: "4px 8px", padding: "4px 10px", fontSize: 10, borderRadius: 8 }}>
          <Square style={{ width: 8, height: 8 }} /> Cancel
        </button>
      </div>

      {/* Output */}
      <div style={{ position: "relative" }}>
        {isRunning && (
          <div style={{
            position: "absolute", top: 8, right: 12, display: "flex", alignItems: "center", gap: 5,
            fontSize: 9, color: NVIDIA_GREEN, zIndex: 1,
          }}>
            <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} />
            Streaming...
          </div>
        )}
        <pre
          ref={outputRef}
          style={{
            margin: 0, padding: "12px 14px", fontSize: 10.5, lineHeight: 1.65,
            fontFamily: MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
            overflowY: "auto", maxHeight: 320, minHeight: 120,
            background: "rgba(0,0,0,0.15)",
          }}
        >
          {stageResult?.output || (isRunning ? "Waiting for output..." : stageResult?.status === "pending" ? "Stage not started yet." : "No output.")}
        </pre>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WORKSPACE TAB
   ═══════════════════════════════════════════════════════════════ */

function WorkspaceTab() {
  const { builds, activeBuildId, setActiveBuild } = useFactoryStore();
  const build = activeBuildId ? builds.find((b) => b.id === activeBuildId) : null;

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<{ added: string[]; modified: string[]; deleted: string[] }>({ added: [], modified: [], deleted: [] });
  const [stageTab, setStageTab] = useState<PipelineStage>("plan");
  const baseSnapshotRef = useRef<Map<string, number> | null>(null);

  const isActive = build && build.currentStage !== "done" && build.currentStage !== "failed";

  const pollChanges = useCallback(async () => {
    if (!build?.cwd) return;
    try {
      const current = await factoryService.snapshotFiles(build.cwd);
      if (baseSnapshotRef.current) {
        const diff = factoryService.diffSnapshots(baseSnapshotRef.current, current);
        setChangedFiles(diff);
      }
    } catch { /* best effort */ }
  }, [build?.cwd]);

  useEffect(() => {
    if (!build?.cwd) return;
    let cancelled = false;
    factoryService.snapshotFiles(build.cwd).then((snap) => {
      if (!cancelled) baseSnapshotRef.current = snap;
    });
    const interval = isActive ? window.setInterval(pollChanges, 4000) : undefined;
    if (!isActive) pollChanges();
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [build?.cwd, isActive, pollChanges]);

  if (!build) {
    return (
      <div style={{ flex: 1, padding: 24 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Select a build to view its workspace</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {builds.slice(0, 10).map((b) => (
            <button key={b.id} onClick={() => setActiveBuild(b.id)}
              style={{
                ...innerPanel, padding: "10px 14px", border: "1px solid var(--border)", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 8, textAlign: "left", background: "rgba(255,255,255,0.015)",
              }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: b.currentStage === "done" ? "#4ade80" : b.currentStage === "failed" ? "#f87171" : NVIDIA_GREEN,
              }} />
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 500, flex: 1 }}>{b.title}</span>
              <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "capitalize" }}>{b.currentStage}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const stageResult = build.stages.find((s) => s.stage === stageTab);
  const totalChanges = changedFiles.added.length + changedFiles.modified.length + changedFiles.deleted.length;
  const outputRef = useRef<HTMLPreElement>(null);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Workspace header */}
      <div style={{
        padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10,
        background: "rgba(255,255,255,0.01)", flexShrink: 0,
      }}>
        <button onClick={() => setActiveBuild(null)}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
          <ChevronDown style={{ width: 10, height: 10, transform: "rotate(90deg)" }} /> Back
        </button>
        <div style={{ width: 1, height: 16, background: "var(--border)" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{build.title}</span>
        {totalChanges > 0 && (
          <span style={{ fontSize: 10, color: NVIDIA_GREEN, fontFamily: MONO }}>{totalChanges} file{totalChanges !== 1 ? "s" : ""} changed</span>
        )}
        <span style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 600,
          background: `color-mix(in srgb, ${STATUS_DOT[build.currentStage as StageStatus] ?? "#4ade80"} 12%, transparent)`,
          color: STATUS_DOT[build.currentStage as StageStatus] ?? "#4ade80",
          textTransform: "capitalize",
        }}>
          {build.currentStage}
        </span>
      </div>

      {/* Three-panel body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* File tree */}
        {build.cwd && (
          <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Files
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <FileTree rootPath={build.cwd} changedFiles={changedFiles} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
            </div>
          </div>
        )}

        {/* File viewer */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
          <FileViewer filePath={selectedFile} isRunActive={!!isActive} />
        </div>

        {/* Stage output */}
        <div style={{ width: 340, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
            {PIPELINE_STAGES.map((s) => {
              const meta = STAGE_META[s];
              const sr = build.stages.find((st) => st.stage === s);
              return (
                <button key={s} onClick={() => setStageTab(s)} style={{
                  padding: "6px 10px", fontSize: 10, fontWeight: stageTab === s ? 600 : 500,
                  border: "none", cursor: "pointer", background: stageTab === s ? "rgba(255,255,255,0.04)" : "transparent",
                  color: stageTab === s ? meta.color : "var(--text-muted)",
                  borderBottom: stageTab === s ? `2px solid ${meta.color}` : "2px solid transparent",
                  display: "flex", alignItems: "center", gap: 4, transition: `all 0.15s ${EASE}`,
                }}>
                  {meta.label}
                  {sr && sr.status !== "pending" && (
                    <span style={{ width: 4, height: 4, borderRadius: "50%", background: STATUS_DOT[sr.status] }} />
                  )}
                </button>
              );
            })}
          </div>
          <pre ref={outputRef} style={{
            flex: 1, margin: 0, padding: "10px 12px", fontSize: 10, lineHeight: 1.6,
            fontFamily: MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
            overflowY: "auto", background: "rgba(0,0,0,0.1)",
          }}>
            {stageResult?.output || (stageResult?.status === "running" ? "Streaming..." : stageResult?.status === "pending" ? "Pending" : "No output.")}
          </pre>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   HISTORY TAB
   ═══════════════════════════════════════════════════════════════ */

function HistoryTab() {
  const { builds, setActiveBuild, removeBuild } = useFactoryStore();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const completedBuilds = builds
    .filter((b) => b.currentStage === "done" || b.currentStage === "failed")
    .filter((b) => !search || b.title.toLowerCase().includes(search.toLowerCase()) || b.task.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
      {/* Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--text-muted)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search builds..."
            style={{ ...inputStyle, paddingLeft: 30, fontSize: 12 }} />
        </div>
      </div>

      {completedBuilds.length === 0 && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
          padding: "48px 24px", color: "var(--text-muted)", fontSize: 13, textAlign: "center",
        }}>
          <Clock style={{ width: 28, height: 28, opacity: 0.3 }} />
          {search ? "No builds match your search" : "No completed builds yet"}
        </div>
      )}

      {completedBuilds.map((build) => {
        const isExpanded = expandedId === build.id;
        const isDone = build.currentStage === "done";
        const duration = build.completedAt ? elapsed(build.completedAt - build.createdAt) : "—";

        return (
          <div key={build.id} style={{ ...glowCard(isDone ? "#4ade80" : "#f87171"), marginBottom: 8, overflow: "hidden" }}>
            {/* Header */}
            <div onClick={() => setExpandedId(isExpanded ? null : build.id)}
              style={{ padding: "10px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
              <ChevronDown style={{
                width: 12, height: 12, color: "var(--text-muted)", transition: `transform 0.15s ${EASE}`,
                transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
              }} />
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: isDone ? "#4ade80" : "#f87171",
              }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {build.title}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: MONO, flexShrink: 0 }}>{duration}</span>
              <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{build.runtime}</span>
              <span style={{
                fontSize: 9, fontWeight: 600, padding: "2px 8px", borderRadius: 10, flexShrink: 0,
                background: isDone ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                color: isDone ? "#4ade80" : "#f87171",
                textTransform: "capitalize",
              }}>
                {build.currentStage}
              </span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px" }}>
                {/* Stage summary */}
                <div style={{ display: "flex", gap: 4, marginBottom: 12, alignItems: "center" }}>
                  {build.stages.map((sr, i) => {
                    const meta = STAGE_META[sr.stage];
                    return (
                      <div key={sr.stage} style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
                        <StageIndicator status={sr.status} color={meta.color} />
                        <span style={{
                          fontSize: 9, fontWeight: 600,
                          color: sr.status === "passed" ? "#4ade80" : sr.status === "failed" ? "#f87171" : sr.status === "skipped" ? "#fbbf24" : "var(--text-muted)",
                        }}>{meta.label}</span>
                        {sr.completedAt && sr.startedAt && (
                          <span style={{ fontSize: 8, color: "var(--text-muted)", fontFamily: MONO }}>
                            {elapsed(sr.completedAt - sr.startedAt)}
                          </span>
                        )}
                        {i < 3 && <div style={{ flex: 1, height: 1, background: "var(--border)", marginLeft: 4, marginRight: 2 }} />}
                      </div>
                    );
                  })}
                </div>

                {/* Stage outputs */}
                {build.stages.filter((sr) => sr.output).map((sr) => {
                  const meta = STAGE_META[sr.stage];
                  return (
                    <div key={sr.stage} style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: meta.color, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <meta.icon style={{ width: 10, height: 10 }} /> {meta.label} Output
                      </div>
                      <pre style={{
                        margin: 0, padding: "8px 10px", fontSize: 9.5, lineHeight: 1.5,
                        fontFamily: MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                        background: "rgba(0,0,0,0.12)", borderRadius: 8, maxHeight: 200, overflowY: "auto",
                      }}>
                        {sr.output}
                      </pre>
                    </div>
                  );
                })}

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onClick={() => { setActiveBuild(build.id); }}
                    style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px" }}>
                    <Eye style={{ width: 10, height: 10 }} /> View Workspace
                  </button>
                  <button onClick={() => removeBuild(build.id)}
                    style={{ ...BTN_DANGER, fontSize: 10, padding: "4px 10px" }}>
                    <X style={{ width: 10, height: 10 }} /> Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   DEPLOY TAB — Git operations + preview server
   ═══════════════════════════════════════════════════════════════ */

interface GitFileEntry { status: string; path: string; staged: boolean }
interface GitLogEntry { hash: string; message: string; ago: string; author: string }

async function runGit(args: string, dir: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const escaped = escapeShellArg(dir);
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
    command: `git -C "${escaped}" ${args}`,
    cwd: null,
  });
}

function parseGitStatusOutput(raw: string): GitFileEntry[] {
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const x = line[0], y = line[1];
    const path = line.slice(3).trim();
    const staged = x !== " " && x !== "?";
    const statusMap: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", "?": "untracked" };
    return { status: statusMap[staged ? x : y] || "modified", path, staged };
  });
}

function parseGitLogOutput(raw: string): GitLogEntry[] {
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.replace(/^"|"$/g, "").split("<|>");
    return { hash: parts[0] ?? "", message: parts[1] ?? "", ago: parts[2] ?? "", author: parts[3] ?? "" };
  });
}

const PREVIEW_PRESETS = [
  { label: "npm dev", cmd: "npm run dev", ports: [3000, 5173] },
  { label: "pnpm dev", cmd: "pnpm dev", ports: [3000, 5173] },
  { label: "yarn dev", cmd: "yarn dev", ports: [3000, 5173] },
  { label: "python", cmd: "python -m http.server 8000", ports: [8000] },
];

function DeployTab() {
  const { projects, builds } = useFactoryStore();
  const allDirs = [
    ...projects.map((p) => ({ label: p.name, path: p.path })),
    ...builds.filter((b) => b.cwd).map((b) => ({ label: b.title, path: b.cwd })),
  ];
  const uniqueDirs = [...new Map(allDirs.map((d) => [d.path, d])).values()];

  const [dirPath, setDirPath] = useState(uniqueDirs[0]?.path ?? "");

  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null);
  const [branch, setBranch] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [gitFiles, setGitFiles] = useState<GitFileEntry[]>([]);
  const [gitLog, setGitLog] = useState<GitLogEntry[]>([]);
  const [commitMsg, setCommitMsg] = useState("");

  const [loading, setLoading] = useState(false);
  const [gitIniting, setGitIniting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [addingRemote, setAddingRemote] = useState(false);
  const [remoteInput, setRemoteInput] = useState("");

  const [previewCmd, setPreviewCmd] = useState("npm run dev");
  const [previewPid, setPreviewPid] = useState<number | null>(null);
  const [previewStarting, setPreviewStarting] = useState(false);
  const [previewPorts, setPreviewPorts] = useState<number[]>([3000, 5173]);

  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [cmdOutput, setCmdOutput] = useState<{ title: string; content: string } | null>(null);

  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 5000); return () => clearTimeout(t); }
  }, [feedback]);

  const loadGitInfo = useCallback(async () => {
    if (!dirPath) return;
    setLoading(true);
    try {
      const check = await runGit("rev-parse --is-inside-work-tree", dirPath);
      const isRepo = check.code === 0 && check.stdout.trim() === "true";
      setIsGitRepo(isRepo);
      if (!isRepo) { setBranch(""); setRemoteUrl(""); setGitFiles([]); setGitLog([]); setLoading(false); return; }

      const [branchRes, remoteRes, statusRes, logRes] = await Promise.all([
        runGit("branch --show-current", dirPath),
        runGit("remote get-url origin", dirPath).catch(() => ({ stdout: "", stderr: "", code: 1 })),
        runGit("status --porcelain", dirPath),
        runGit('log -20 --format="%h<|>%s<|>%ar<|>%an"', dirPath).catch(() => ({ stdout: "", stderr: "", code: 1 })),
      ]);

      setBranch(branchRes.stdout.trim());
      setRemoteUrl(remoteRes.code === 0 ? remoteRes.stdout.trim() : "");
      setGitFiles(parseGitStatusOutput(statusRes.stdout));
      setGitLog(parseGitLogOutput(logRes.stdout));
    } catch { setIsGitRepo(false); }
    setLoading(false);
  }, [dirPath]);

  useEffect(() => { if (dirPath) loadGitInfo(); else setIsGitRepo(null); }, [dirPath, loadGitInfo]);

  const gitInit = async () => {
    if (!dirPath) return;
    setGitIniting(true);
    try {
      const res = await runGit("init", dirPath);
      if (res.code === 0) { setFeedback({ type: "success", msg: "Git repository initialized" }); await loadGitInfo(); }
      else setFeedback({ type: "error", msg: res.stderr || "git init failed" });
    } catch (e) { setFeedback({ type: "error", msg: e instanceof Error ? e.message : "git init failed" }); }
    setGitIniting(false);
  };

  const stageAll = async () => {
    if (!dirPath) return;
    const res = await runGit("add -A", dirPath);
    if (res.code === 0) { setFeedback({ type: "success", msg: "Staged all changes" }); await loadGitInfo(); }
    else setFeedback({ type: "error", msg: res.stderr || "git add failed" });
  };

  const unstageAll = async () => {
    if (!dirPath) return;
    await runGit("reset HEAD", dirPath);
    setFeedback({ type: "success", msg: "Unstaged all files" });
    await loadGitInfo();
  };

  const commit = async () => {
    if (!dirPath || !commitMsg.trim()) return;
    setCommitting(true);
    try {
      const escaped = commitMsg.trim().replace(/`/g, "``").replace(/"/g, '`"').replace(/\$/g, "`$");
      const res = await runGit(`commit -m "${escaped}"`, dirPath);
      if (res.code === 0) {
        setFeedback({ type: "success", msg: "Committed successfully" });
        setCommitMsg("");
        setCmdOutput({ title: "Commit", content: res.stdout });
        await loadGitInfo();
      } else setFeedback({ type: "error", msg: res.stderr || res.stdout || "Commit failed" });
    } catch (e) { setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Commit failed" }); }
    setCommitting(false);
  };

  const push = async () => {
    if (!dirPath) return;
    setPushing(true);
    try {
      const res = await runGit(`push -u origin ${branch || "main"}`, dirPath);
      if (res.code === 0) { setFeedback({ type: "success", msg: `Pushed to origin` }); setCmdOutput({ title: "Push", content: res.stdout || res.stderr || "Success" }); }
      else { setFeedback({ type: "error", msg: res.stderr || "Push failed" }); if (res.stderr) setCmdOutput({ title: "Push Error", content: res.stderr }); }
    } catch (e) { setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Push failed" }); }
    setPushing(false);
  };

  const pull = async () => {
    if (!dirPath) return;
    setPulling(true);
    try {
      const res = await runGit("pull", dirPath);
      if (res.code === 0) { setFeedback({ type: "success", msg: "Pulled latest changes" }); setCmdOutput({ title: "Pull", content: res.stdout || res.stderr || "Already up to date." }); await loadGitInfo(); }
      else setFeedback({ type: "error", msg: res.stderr || "Pull failed" });
    } catch (e) { setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Pull failed" }); }
    setPulling(false);
  };

  const addRemote = async () => {
    if (!dirPath || !remoteInput.trim()) return;
    const res = await runGit(`remote add origin ${remoteInput.trim()}`, dirPath);
    if (res.code === 0) {
      setFeedback({ type: "success", msg: "Remote origin added" });
      setRemoteUrl(remoteInput.trim());
      setAddingRemote(false);
      setRemoteInput("");
    } else setFeedback({ type: "error", msg: res.stderr || "Failed to add remote" });
  };

  const startPreview = async () => {
    if (!dirPath || !previewCmd.trim()) return;
    setPreviewStarting(true);
    try {
      const streamId = await invoke<string>("start_streaming_command", { command: previewCmd.trim(), cwd: dirPath });
      setPreviewPid(parseInt(streamId, 10) || 1);
    } catch (e) { setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to start preview" }); }
    setPreviewStarting(false);
  };

  const stopPreview = () => { setPreviewPid(null); };

  const openInBrowser = (port: number) => {
    invoke("execute_command", { command: `Start-Process "http://localhost:${port}"`, cwd: null }).catch(() => {});
  };

  const staged = gitFiles.filter((f) => f.staged);

  const githubUrl = (() => {
    if (!remoteUrl) return null;
    const u = remoteUrl.toLowerCase();
    if (!u.includes("github.com")) return null;
    const path = remoteUrl.replace(/^git@github\.com:/i, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/$/, "");
    return path ? `https://github.com/${path}` : null;
  })();

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
      {/* Feedback */}
      {feedback && (
        <div style={{
          padding: "8px 14px", borderRadius: 10, marginBottom: 12, fontSize: 11, fontWeight: 500,
          background: feedback.type === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
          color: feedback.type === "success" ? "#4ade80" : "#f87171",
          border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}`,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {feedback.type === "success" ? <Check style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
          {feedback.msg}
        </div>
      )}

      {/* Directory selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Working Directory</label>
        {uniqueDirs.length > 0 ? (
          <select value={dirPath} onChange={(e) => setDirPath(e.target.value)} style={{ ...inputStyle, fontSize: 12 }}>
            {uniqueDirs.map((d) => (
              <option key={d.path} value={d.path}>{d.label} — {d.path}</option>
            ))}
          </select>
        ) : (
          <input value={dirPath} onChange={(e) => setDirPath(e.target.value)} placeholder="C:\path\to\project" style={{ ...inputStyle, fontSize: 12 }} />
        )}
      </div>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 20, color: "var(--text-muted)", fontSize: 12 }}>
          <Loader2 style={{ width: 14, height: 14, animation: "_spin 1s linear infinite" }} /> Loading git info...
        </div>
      )}

      {!loading && !dirPath && (
        <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
          Enter a project directory or create a build to get started
        </div>
      )}

      {!loading && dirPath && isGitRepo === false && (
        <div style={{ ...glowCard("#fbbf24"), padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Not a Git repository</div>
          <button onClick={gitInit} disabled={gitIniting} style={{ ...btnPrimary, fontSize: 11, background: "#fbbf24", color: "#000" }}>
            {gitIniting ? <Loader2 style={{ width: 12, height: 12, animation: "_spin 1s linear infinite" }} /> : <GitBranch style={{ width: 12, height: 12 }} />}
            Initialize Git
          </button>
        </div>
      )}

      {!loading && isGitRepo && (
        <>
          {/* Branch & remote info */}
          <div style={{ ...glowCard(NVIDIA_GREEN), padding: 14, marginBottom: 14 }} data-glow={NVIDIA_GREEN} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <GitBranch style={{ width: 14, height: 14, color: NVIDIA_GREEN }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{branch || "main"}</span>
              {remoteUrl && (
                <>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>&rarr;</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{remoteUrl}</span>
                </>
              )}
              {githubUrl && (
                <button onClick={() => invoke("execute_command", { command: `Start-Process "${githubUrl}"`, cwd: null }).catch(() => {})}
                  style={{ ...btnSecondary, fontSize: 9, padding: "3px 8px" }}>
                  <ExternalLink style={{ width: 10, height: 10 }} /> GitHub
                </button>
              )}
            </div>

            {/* Git actions */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => loadGitInfo()} style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px" }}>
                <RotateCcw style={{ width: 10, height: 10 }} /> Refresh
              </button>
              <button onClick={pull} disabled={pulling} style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px" }}>
                {pulling ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <ChevronDown style={{ width: 10, height: 10 }} />}
                Pull
              </button>
              <button onClick={push} disabled={pushing || !remoteUrl} style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px", color: NVIDIA_GREEN, borderColor: `color-mix(in srgb, ${NVIDIA_GREEN} 25%, transparent)` }}>
                {pushing ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <Upload style={{ width: 10, height: 10 }} />}
                Push
              </button>
              {!remoteUrl && !addingRemote && (
                <button onClick={() => setAddingRemote(true)} style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px", color: "#fbbf24" }}>
                  <GitBranch style={{ width: 10, height: 10 }} /> Add Remote
                </button>
              )}
            </div>

            {addingRemote && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <input value={remoteInput} onChange={(e) => setRemoteInput(e.target.value)} placeholder="https://github.com/user/repo.git"
                  style={{ ...inputStyle, fontSize: 11, flex: 1 }} />
                <button onClick={addRemote} style={{ ...btnPrimary, fontSize: 10, padding: "4px 10px", background: "#fbbf24", color: "#000" }}>Add</button>
                <button onClick={() => setAddingRemote(false)} style={{ ...btnSecondary, fontSize: 10, padding: "4px 10px" }}>Cancel</button>
              </div>
            )}
          </div>

          {/* Staging area */}
          {gitFiles.length > 0 && (
            <div style={{ ...glowCard("#60a5fa"), padding: 14, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                  <FileCode style={{ width: 13, height: 13, color: "#60a5fa" }} /> Changes ({gitFiles.length})
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={stageAll} style={{ ...btnSecondary, fontSize: 9, padding: "3px 8px" }}>Stage All</button>
                  {staged.length > 0 && <button onClick={unstageAll} style={{ ...btnSecondary, fontSize: 9, padding: "3px 8px" }}>Unstage All</button>}
                </div>
              </div>

              <div style={{ maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
                {gitFiles.map((f) => {
                  const colors: Record<string, string> = { added: "#4ade80", modified: "#60a5fa", deleted: "#f87171", untracked: "#fbbf24", renamed: "#a78bfa" };
                  return (
                    <div key={f.path} style={{
                      padding: "4px 8px", fontSize: 10, display: "flex", alignItems: "center", gap: 6,
                      borderRadius: 4, marginBottom: 1,
                      background: f.staged ? "rgba(74,222,128,0.05)" : "transparent",
                    }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: colors[f.status] ?? "var(--text-muted)", flexShrink: 0 }} />
                      <span style={{ fontSize: 9, color: colors[f.status] ?? "var(--text-muted)", fontWeight: 600, width: 14, textAlign: "center", flexShrink: 0 }}>
                        {f.status[0]?.toUpperCase()}
                      </span>
                      <span style={{ fontFamily: MONO, color: f.staged ? "#4ade80" : "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
                      {f.staged && <span style={{ fontSize: 8, color: "#4ade80" }}>STAGED</span>}
                    </div>
                  );
                })}
              </div>

              {/* Commit */}
              {staged.length > 0 && (
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message..."
                    style={{ ...inputStyle, fontSize: 11, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) commit(); }} />
                  <button onClick={commit} disabled={committing || !commitMsg.trim()}
                    style={{ ...btnPrimary, fontSize: 10, padding: "6px 12px", background: "#4ade80", color: "#000", opacity: commitMsg.trim() ? 1 : 0.4 }}>
                    {committing ? <Loader2 style={{ width: 10, height: 10, animation: "_spin 1s linear infinite" }} /> : <GitCommit style={{ width: 10, height: 10 }} />}
                    Commit
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          <div style={{ ...glowCard("#8b5cf6"), padding: 14, marginBottom: 14 }} data-glow="#8b5cf6" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                <Globe style={{ width: 14, height: 14, color: "#8b5cf6" }} /> Preview Server
              </span>
              {previewPid !== null && (
                <span style={{ fontSize: 9, color: "#4ade80", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#4ade80", animation: "_pulse 1.5s ease-in-out infinite" }} />
                  Running
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              {PREVIEW_PRESETS.map((p) => (
                <button key={p.cmd} onClick={() => { setPreviewCmd(p.cmd); setPreviewPorts(p.ports); }}
                  style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10, borderColor: previewCmd === p.cmd ? "rgba(139,92,246,0.4)" : "var(--border)", color: previewCmd === p.cmd ? "#a78bfa" : "var(--text-muted)" }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={previewCmd} onChange={(e) => setPreviewCmd(e.target.value)} placeholder="npm run dev"
                style={{ ...inputStyle, flex: 1, fontSize: 12 }} />
              {previewPid === null ? (
                <button onClick={startPreview} disabled={previewStarting || !previewCmd.trim()} onMouseDown={pressDown} onMouseUp={pressUp}
                  style={{ ...btnPrimary, background: "#8b5cf6", opacity: previewStarting || !previewCmd.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}>
                  {previewStarting ? <Loader2 style={{ width: 12, height: 12, animation: "_spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                  Start
                </button>
              ) : (
                <button onClick={stopPreview} style={{ ...BTN_DANGER, whiteSpace: "nowrap" }}>
                  <Square style={{ width: 10, height: 10 }} /> Stop
                </button>
              )}
            </div>
            {previewPid !== null && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 9, color: "var(--text-muted)", alignSelf: "center" }}>Open:</span>
                {previewPorts.map((port) => (
                  <button key={port} onClick={() => openInBrowser(port)} style={{ ...btnSecondary, padding: "4px 10px", fontSize: 10, color: "#8b5cf6", borderColor: "rgba(139,92,246,0.25)" }}>
                    <Globe style={{ width: 10, height: 10 }} /> localhost:{port}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Git History */}
          {gitLog.length > 0 && (
            <div style={{ ...glowCard("var(--text-muted)") }}>
              <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                <Clock style={{ width: 12, height: 12, color: "var(--text-muted)" }} /> Recent Commits ({gitLog.length})
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {gitLog.map((entry, i) => (
                  <div key={`${entry.hash}-${i}`} style={{
                    padding: "6px 14px", display: "flex", alignItems: "center", gap: 10,
                    borderBottom: "1px solid rgba(255,255,255,0.02)", fontSize: 11,
                  }}>
                    <span style={{ fontSize: 10, fontFamily: MONO, color: NVIDIA_GREEN, fontWeight: 600, flexShrink: 0 }}>{entry.hash}</span>
                    <span style={{ color: "var(--text-secondary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.message}</span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>{entry.ago}</span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.author}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Command Output */}
          {cmdOutput && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" }}>{cmdOutput.title}</span>
                <button onClick={() => setCmdOutput(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>Dismiss</button>
              </div>
              <pre style={{
                ...innerPanel, margin: 0, padding: "10px 14px",
                fontSize: 11, fontFamily: MONO, color: "var(--text-secondary)",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
                maxHeight: 200, overflowY: "auto",
              }}>
                {cmdOutput.content}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
