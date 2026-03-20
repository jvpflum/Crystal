import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { factoryService } from "@/lib/factory";
import type { AgentRun, FactoryProject } from "@/stores/factoryStore";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const BTN: CSSProperties = {
  padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
  border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center",
  gap: 5, transition: "all .15s ease",
};

const AGENT_META: Record<string, { label: string; color: string; icon: string }> = {
  "claude-code":  { label: "Claude Code",  color: "#d4a574", icon: "C" },
  "cortex":       { label: "Cortex",       color: "#8b5cf6", icon: "X" },
};

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--text-muted)", running: "var(--accent)",
  completed: "var(--success)", failed: "var(--error)", cancelled: "var(--text-muted)",
};

interface Props {
  run: AgentRun;
  project: FactoryProject;
  onBack: () => void;
  onCancel: () => void;
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function RunWorkspace({ run, project, onBack, onCancel }: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<{ added: string[]; modified: string[]; deleted: string[] }>({ added: [], modified: [], deleted: [] });
  const [now, setNow] = useState(Date.now());
  const outputRef = useRef<HTMLPreElement>(null);
  const baseSnapshotRef = useRef<Map<string, number> | null>(null);

  const isActive = run.status === "running" || run.status === "queued";
  const meta = AGENT_META[run.agentType] ?? { label: run.agentType, color: "#888", icon: "?" };

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [run.output]);

  // File change detection: take baseline snapshot, then poll
  const pollChanges = useCallback(async () => {
    try {
      const current = await factoryService.snapshotFiles(project.path);
      if (baseSnapshotRef.current) {
        const diff = factoryService.diffSnapshots(baseSnapshotRef.current, current);
        setChangedFiles(diff);
      }
    } catch { /* best effort */ }
  }, [project.path]);

  useEffect(() => {
    let interval: number | undefined;
    let cancelled = false;

    factoryService.snapshotFiles(project.path).then((snap) => {
      if (cancelled) return;
      baseSnapshotRef.current = snap;
    });

    if (isActive) {
      interval = window.setInterval(pollChanges, 3000);
    } else {
      pollChanges();
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [isActive, pollChanges, project.path]);

  const duration = run.startedAt ? elapsed((run.completedAt ?? now) - run.startedAt) : "—";
  const totalChanges = changedFiles.added.length + changedFiles.modified.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } } @keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header bar */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: "var(--bg-elevated)" }}>
        <button onClick={onBack} style={{ ...BTN, background: "transparent", color: "var(--text-muted)", padding: "4px 8px" }} title="Back to runs list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>

        <div style={{ width: 1, height: 20, background: "var(--border)" }} />

        <span style={{
          width: 22, height: 22, borderRadius: 5, fontSize: 10, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          background: meta.color, color: "#fff",
        }}>{meta.icon}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {run.objective.length > 100 ? run.objective.slice(0, 100) + "..." : run.objective}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {totalChanges > 0 && (
            <span style={{ fontSize: 10, color: "var(--accent)", ...MONO }}>
              {totalChanges} file{totalChanges !== 1 ? "s" : ""} changed
            </span>
          )}
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{duration}</span>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: STATUS_COLORS[run.status] ?? "var(--text-muted)",
            animation: run.status === "running" ? "_pulse 1.5s ease-in-out infinite" : "none",
          }} />
          <span style={{ fontSize: 10, color: STATUS_COLORS[run.status], textTransform: "capitalize" }}>
            {run.status}
          </span>
          {isActive && (
            <button onClick={onCancel} style={{ ...BTN, background: "rgba(239,68,68,0.1)", color: "#ef4444", padding: "4px 10px" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Three-panel body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* File tree panel */}
        <div style={{ width: 240, flexShrink: 0, borderRight: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Files
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <FileTree
              rootPath={project.path}
              changedFiles={changedFiles}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
            />
          </div>
        </div>

        {/* File viewer panel */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
          <FileViewer filePath={selectedFile} isRunActive={isActive} />
        </div>

        {/* Agent output panel */}
        <div style={{ width: 320, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Agent Output
            </span>
            {isActive && (
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--accent)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                {duration}
              </span>
            )}
          </div>
          {isActive && !run.output && (
            <div style={{ padding: "20px 14px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border)", background: "var(--bg-elevated)" }}>
              <div style={{ position: "relative", width: 36, height: 36 }}>
                <svg width="36" height="36" viewBox="0 0 36 36" style={{ animation: "spin 2s linear infinite" }}>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke={meta.color} strokeWidth="3" strokeDasharray="30 65" strokeLinecap="round" />
                </svg>
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.icon}</span>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
                  {meta.label} is working...
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>
                  OpenClaw dispatched the agent {duration} ago
                </div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                  Output streams here as the agent works.<br />
                  This can take a few minutes for complex tasks.
                </div>
              </div>
            </div>
          )}
          <pre
            ref={outputRef}
            style={{
              flex: 1, margin: 0, padding: "10px 12px", fontSize: 10, lineHeight: 1.6,
              ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
              overflowY: "auto", background: "var(--bg-base)",
            }}
          >
            {run.output || (isActive ? "" : "No output captured.")}
          </pre>
          {run.error && (
            <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.06)", fontSize: 10, color: "#ef4444", borderTop: "1px solid var(--border)" }}>
              {run.error}
            </div>
          )}
          {!isActive && run.status === "completed" && (
            <div style={{ padding: "8px 12px", background: "rgba(74,222,128,0.06)", fontSize: 10, color: "#4ade80", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              Completed in {duration}
            </div>
          )}
          {!isActive && run.status === "failed" && !run.error && (
            <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.06)", fontSize: 10, color: "#ef4444", borderTop: "1px solid var(--border)" }}>
              Agent run failed after {duration}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
