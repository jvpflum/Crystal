import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { FileTree } from "./FileTree";
import { FileViewer } from "./FileViewer";
import { factoryService } from "@/lib/factory";
import { PIPELINE_STAGES, type Build, type PipelineStage } from "@/stores/factoryStore";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const STAGE_META: Record<PipelineStage, { label: string; color: string }> = {
  plan:   { label: "Plan",   color: "#60a5fa" },
  code:   { label: "Code",   color: "#76b900" },
  test:   { label: "Test",   color: "#fbbf24" },
  review: { label: "Review", color: "#a78bfa" },
};

interface Props {
  build: Build;
  onBack: () => void;
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function RunWorkspace({ build, onBack }: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [changedFiles, setChangedFiles] = useState<{ added: string[]; modified: string[]; deleted: string[] }>({ added: [], modified: [], deleted: [] });
  const [stageTab, setStageTab] = useState<PipelineStage>("plan");
  const [now, setNow] = useState(Date.now());
  const outputRef = useRef<HTMLPreElement>(null);
  const baseSnapshotRef = useRef<Map<string, number> | null>(null);

  const isActive = build.currentStage !== "done" && build.currentStage !== "failed";

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  });

  const pollChanges = useCallback(async () => {
    if (!build.cwd) return;
    try {
      const current = await factoryService.snapshotFiles(build.cwd);
      if (baseSnapshotRef.current) {
        const diff = factoryService.diffSnapshots(baseSnapshotRef.current, current);
        setChangedFiles(diff);
      }
    } catch { /* best effort */ }
  }, [build.cwd]);

  useEffect(() => {
    if (!build.cwd) return;
    let cancelled = false;
    factoryService.snapshotFiles(build.cwd).then((snap) => {
      if (!cancelled) baseSnapshotRef.current = snap;
    });
    const interval = isActive ? window.setInterval(pollChanges, 4000) : undefined;
    if (!isActive) pollChanges();
    return () => { cancelled = true; if (interval) clearInterval(interval); };
  }, [build.cwd, isActive, pollChanges]);

  const duration = elapsed((build.completedAt ?? now) - build.createdAt);
  const totalChanges = changedFiles.added.length + changedFiles.modified.length;
  const stageResult = build.stages.find((s) => s.stage === stageTab);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } } @keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header bar */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: "var(--bg-elevated)" }}>
        <button onClick={onBack} style={{ padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", background: "transparent", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 5 }} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          Back
        </button>
        <div style={{ width: 1, height: 20, background: "var(--border)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {build.title}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {totalChanges > 0 && (
            <span style={{ fontSize: 10, color: "#76b900", ...MONO }}>{totalChanges} file{totalChanges !== 1 ? "s" : ""} changed</span>
          )}
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{duration}</span>
          <span style={{ fontSize: 10, textTransform: "capitalize", color: isActive ? "#76b900" : build.currentStage === "done" ? "#4ade80" : "#f87171" }}>
            {build.currentStage}
          </span>
        </div>
      </div>

      {/* Three-panel body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* File tree panel */}
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

        {/* File viewer panel */}
        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
          <FileViewer filePath={selectedFile} isRunActive={isActive} />
        </div>

        {/* Stage output panel */}
        <div style={{ width: 320, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
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
                  transition: "all 0.15s ease",
                }}>
                  {meta.label}
                  {sr && sr.status !== "pending" && (
                    <span style={{ width: 4, height: 4, borderRadius: "50%", marginLeft: 4, display: "inline-block", background: sr.status === "passed" ? "#4ade80" : sr.status === "failed" ? "#f87171" : sr.status === "running" ? "#76b900" : "var(--text-muted)" }} />
                  )}
                </button>
              );
            })}
          </div>
          <pre ref={outputRef} style={{
            flex: 1, margin: 0, padding: "10px 12px", fontSize: 10, lineHeight: 1.6,
            ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
            overflowY: "auto", background: "rgba(0,0,0,0.1)",
          }}>
            {stageResult?.output || (stageResult?.status === "running" ? "Streaming..." : stageResult?.status === "pending" ? "Pending" : "No output.")}
          </pre>
        </div>
      </div>
    </div>
  );
}
