import { useState, useEffect, useRef, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFactoryStore, type AgentType, type AgentRun, type FactoryProject } from "@/stores/factoryStore";
import { useDataStore } from "@/stores/dataStore";
import { factoryService } from "@/lib/factory";
import { openclawClient } from "@/lib/openclaw";
import { RunWorkspace } from "@/components/factory/RunWorkspace";
import {
  Loader2, RefreshCw, Search, CheckCircle2, XCircle,
  AlertTriangle, Play, Zap,
} from "lucide-react";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };
const CARD: CSSProperties = { background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" };
const BTN: CSSProperties = { padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500, border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: "all .15s ease" };
const BTN_PRIMARY: CSSProperties = { ...BTN, background: "var(--accent-bg)", color: "var(--accent)" };
const BTN_GHOST: CSSProperties = { ...BTN, background: "transparent", color: "var(--text-muted)" };
const BTN_DANGER: CSSProperties = { ...BTN, background: "rgba(239,68,68,0.1)", color: "#ef4444" };
const INPUT: CSSProperties = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px", color: "var(--text)", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box", ...MONO };
const LABEL: CSSProperties = { fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 };

const STATUS_COLORS: Record<string, string> = {
  queued: "var(--text-muted)", running: "var(--accent)", completed: "var(--success)", failed: "var(--error)", cancelled: "var(--text-muted)",
};

interface OCSkill {
  name: string;
  description: string;
  emoji: string;
  eligible: boolean;
  disabled: boolean;
  source: string;
  bundled: boolean;
  homepage?: string;
  missing: { bins: string[]; anyBins: string[]; env: string[]; config: string[]; os: string[] };
}

type TabId = "skills" | "projects";

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function IconPlus() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
}
function IconPlay() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21" /></svg>;
}
function IconStop() {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;
}
function IconTrash() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
}
function IconFolder() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
}
function IconChevron({ open }: { open: boolean }) {
  return <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}><polyline points="9 18 15 12 9 6" /></svg>;
}

export function FactoryView() {
  const [tab, setTab] = useState<TabId>("skills");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`@keyframes _spin { to { transform: rotate(360deg) } } @keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }`}</style>

      <div style={{ padding: "18px 24px 0", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>Factory</h2>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 12px" }}>
          Skills, agents, and autonomous builds
        </p>
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
          {(["skills", "projects"] as TabId[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 20px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer",
              background: "transparent", color: tab === t ? "var(--accent)" : "var(--text-muted)",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s", textTransform: "capitalize",
            }}>
              {t === "skills" ? "Skills" : "Projects"}
            </button>
          ))}
        </div>
      </div>

      {tab === "skills" ? <SkillsTab /> : <ProjectsTab />}
    </div>
  );
}

/* ── Skills Tab ── */

function SkillsTab() {
  const [skills, setSkills] = useState<OCSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "workspace" | "bundled" | "eligible">("all");
  const [selectedSkill, setSelectedSkill] = useState<OCSkill | null>(null);
  const [launchPrompt, setLaunchPrompt] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<string | null>(null);

  const getSkills = useDataStore(s => s.getSkills);

  const loadSkills = useCallback(async (force = false) => {
    try {
      const data = await getSkills(force);
      if (Array.isArray(data)) {
        setSkills(data.map((s: Record<string, unknown>) => ({
          name: String(s.name || ""),
          description: String(s.description || ""),
          emoji: String(s.emoji || ""),
          eligible: s.eligible === true,
          disabled: s.disabled === true,
          source: String(s.source || ""),
          bundled: s.bundled === true,
          homepage: s.homepage ? String(s.homepage) : undefined,
          missing: {
            bins: Array.isArray((s.missing as Record<string, unknown>)?.bins) ? (s.missing as Record<string, unknown[]>).bins.map(String) : [],
            anyBins: Array.isArray((s.missing as Record<string, unknown>)?.anyBins) ? (s.missing as Record<string, unknown[]>).anyBins.map(String) : [],
            env: Array.isArray((s.missing as Record<string, unknown>)?.env) ? (s.missing as Record<string, unknown[]>).env.map(String) : [],
            config: Array.isArray((s.missing as Record<string, unknown>)?.config) ? (s.missing as Record<string, unknown[]>).config.map(String) : [],
            os: Array.isArray((s.missing as Record<string, unknown>)?.os) ? (s.missing as Record<string, unknown[]>).os.map(String) : [],
          },
        })));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [getSkills]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  const filtered = skills.filter(s => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !s.description.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "workspace") return !s.bundled;
    if (filter === "bundled") return s.bundled;
    if (filter === "eligible") return s.eligible;
    return true;
  });

  const workspaceSkills = filtered.filter(s => !s.bundled);
  const bundledSkills = filtered.filter(s => s.bundled);

  const launchSkill = async () => {
    if (!selectedSkill || !launchPrompt.trim()) return;
    setLaunching(true);
    setLaunchResult(null);
    try {
      const result = await openclawClient.invokeSkill(selectedSkill.name, launchPrompt.trim());
      setLaunchResult(String(result.payload.text || "Done"));
    } catch (e) {
      setLaunchResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLaunching(false);
  };

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
      {/* Skill List */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "var(--text-muted)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search skills..."
              style={{ ...INPUT, paddingLeft: 30, fontFamily: "inherit" }} />
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} style={{
            ...INPUT, width: "auto", fontFamily: "inherit", fontSize: 11,
          }}>
            <option value="all">All ({skills.length})</option>
            <option value="workspace">Workspace ({skills.filter(s => !s.bundled).length})</option>
            <option value="bundled">Bundled ({skills.filter(s => s.bundled).length})</option>
            <option value="eligible">Eligible ({skills.filter(s => s.eligible).length})</option>
          </select>
          <button onClick={() => loadSkills(true)} style={BTN_GHOST}>
            <RefreshCw style={{ width: 12, height: 12 }} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--accent)", animation: "_spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {workspaceSkills.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                  Workspace Skills ({workspaceSkills.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {workspaceSkills.map(s => (
                    <SkillCard key={s.name} skill={s} selected={selectedSkill?.name === s.name} onSelect={() => setSelectedSkill(selectedSkill?.name === s.name ? null : s)} />
                  ))}
                </div>
              </div>
            )}
            {bundledSkills.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8 }}>
                  Bundled Skills ({bundledSkills.length})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
                  {bundledSkills.map(s => (
                    <SkillCard key={s.name} skill={s} selected={selectedSkill?.name === s.name} onSelect={() => setSelectedSkill(selectedSkill?.name === s.name ? null : s)} />
                  ))}
                </div>
              </div>
            )}
            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 12 }}>
                No skills found
              </div>
            )}
          </>
        )}
      </div>

      {/* Skill Detail Panel */}
      {selectedSkill && (
        <div style={{
          width: 340, flexShrink: 0, borderLeft: "1px solid var(--border)",
          overflow: "auto", padding: 20, background: "var(--bg-surface)",
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{selectedSkill.emoji || "🔧"}</div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>{selectedSkill.name}</h3>
          <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 9, padding: "2px 8px", borderRadius: 6,
              background: selectedSkill.eligible ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
              color: selectedSkill.eligible ? "var(--success)" : "var(--error)",
              fontWeight: 600,
            }}>
              {selectedSkill.eligible ? "Eligible" : "Not Eligible"}
            </span>
            <span style={{
              fontSize: 9, padding: "2px 8px", borderRadius: 6,
              background: "rgba(255,255,255,0.05)", color: "var(--text-muted)", fontWeight: 600,
            }}>
              {selectedSkill.bundled ? "Bundled" : "Workspace"}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 16px" }}>
            {selectedSkill.description}
          </p>

          {/* Missing dependencies */}
          {!selectedSkill.eligible && (
            <div style={{
              padding: 10, borderRadius: 8, background: "rgba(248,113,113,0.06)",
              border: "1px solid rgba(248,113,113,0.15)", marginBottom: 16,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--error)", marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle style={{ width: 11, height: 11 }} /> Missing Dependencies
              </div>
              {selectedSkill.missing.bins.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
                  Binaries: {selectedSkill.missing.bins.join(", ")}
                </div>
              )}
              {selectedSkill.missing.env.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
                  Environment: {selectedSkill.missing.env.join(", ")}
                </div>
              )}
              {selectedSkill.missing.config.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>
                  Config: {selectedSkill.missing.config.join(", ")}
                </div>
              )}
              {selectedSkill.missing.os.length > 0 && (
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  OS: {selectedSkill.missing.os.join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Launch */}
          {selectedSkill.eligible && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "var(--text-muted)", marginBottom: 6 }}>
                Launch Skill
              </div>
              <textarea
                value={launchPrompt}
                onChange={e => setLaunchPrompt(e.target.value)}
                placeholder={`Tell ${selectedSkill.name} what to do...`}
                rows={3}
                style={{ ...INPUT, resize: "vertical", fontFamily: "inherit", marginBottom: 8 }}
              />
              <button onClick={launchSkill} disabled={!launchPrompt.trim() || launching}
                style={{ ...BTN_PRIMARY, width: "100%", justifyContent: "center", opacity: !launchPrompt.trim() || launching ? 0.5 : 1 }}>
                {launching ? <Loader2 style={{ width: 12, height: 12, animation: "_spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                {launching ? "Running..." : "Launch"}
              </button>
            </div>
          )}

          {/* Launch result */}
          {launchResult && (
            <div style={{
              padding: 10, borderRadius: 8, background: "var(--bg-base)",
              border: "1px solid var(--border)", marginBottom: 16,
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>Result</div>
              <pre style={{
                fontSize: 10, color: "var(--text-secondary)", whiteSpace: "pre-wrap",
                wordBreak: "break-word", maxHeight: 200, overflowY: "auto", margin: 0, ...MONO,
              }}>
                {launchResult}
              </pre>
            </div>
          )}

          {selectedSkill.homepage && (
            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
              <a href={selectedSkill.homepage} target="_blank" rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "none" }}>
                Documentation
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, selected, onSelect }: { skill: OCSkill; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} style={{
      ...CARD, padding: "12px 14px", cursor: "pointer", textAlign: "left", width: "100%",
      borderColor: selected ? "var(--accent)" : "var(--border)",
      background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
      display: "flex", alignItems: "flex-start", gap: 10, transition: "all 0.15s",
    }}>
      <span style={{ fontSize: 20, flexShrink: 0, lineHeight: 1 }}>{skill.emoji || "🔧"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{skill.name}</span>
          {skill.eligible ? (
            <CheckCircle2 style={{ width: 10, height: 10, color: "var(--success)", flexShrink: 0 }} />
          ) : (
            <XCircle style={{ width: 10, height: 10, color: "var(--text-muted)", flexShrink: 0 }} />
          )}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {skill.description}
        </div>
      </div>
    </button>
  );
}

/* ── Projects Tab (original Factory functionality) ── */

function ProjectsTab() {
  const {
    projects, runs, selectedProjectId,
    addProject, removeProject, selectProject, updateProject,
    addRun, updateRun, removeRun, clearCompletedRuns,
  } = useFactoryStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [focusedRunId, setFocusedRunId] = useState<string | null>(null);
  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;
  const projectRuns = runs.filter(r => r.projectId === selectedProjectId);
  const focusedRun = focusedRunId ? runs.find(r => r.id === focusedRunId) ?? null : null;
  const focusedProject = focusedRun ? projects.find(p => p.id === focusedRun.projectId) ?? null : null;

  const activeRunCount = (pid: string) => runs.filter(r => r.projectId === pid && r.status === "running").length;

  const handleStartRun = useCallback(async (agentType: AgentType, objective: string) => {
    if (!selectedProject) return;
    const runId = addRun({ projectId: selectedProject.id, agentType, objective });
    updateRun(runId, { status: "running", startedAt: Date.now() });
    updateProject(selectedProject.id, {});
    setFocusedRunId(runId);
    try {
      const handle = await factoryService.startRun(runId, agentType, objective, selectedProject.path);
      updateRun(runId, { pid: handle.pid, logFile: handle.logFile });
      factoryService.startPolling(runId, handle.logFile, (output, finished, exitCode) => {
        if (finished) {
          updateRun(runId, { output, status: exitCode === 0 ? "completed" : "failed", completedAt: Date.now(), error: exitCode !== 0 ? `Exited with code ${exitCode}` : undefined });
        } else {
          updateRun(runId, { output });
        }
      }, handle.pid);
    } catch (err) {
      updateRun(runId, { status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: Date.now() });
    }
  }, [selectedProject, addRun, updateRun, updateProject]);

  const handleCancelRun = useCallback(async (run: AgentRun) => {
    if (run.pid) await factoryService.cancelRun(run.pid);
    factoryService.stopPolling(run.id);
    updateRun(run.id, { status: "cancelled", completedAt: Date.now() });
  }, [updateRun]);

  useEffect(() => {
    for (const run of runs) {
      if (run.status === "running" && run.logFile) {
        factoryService.startPolling(run.id, run.logFile, (output, finished, exitCode) => {
          if (finished) updateRun(run.id, { output, status: exitCode === 0 ? "completed" : "failed", completedAt: Date.now() });
          else updateRun(run.id, { output });
        }, run.pid);
      }
    }
    return () => { for (const run of runs) factoryService.stopPolling(run.id); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (focusedRun && focusedProject) {
    return (
      <RunWorkspace run={focusedRun} project={focusedProject}
        onBack={() => setFocusedRunId(null)} onCancel={() => handleCancelRun(focusedRun)} />
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden", padding: "12px 24px 24px", gap: 16 }}>
      {/* Project Sidebar */}
      <div style={{ width: 240, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
        <button onClick={() => setShowNewProject(true)} style={{ ...BTN_PRIMARY, marginBottom: 8 }}>
          <IconPlus /> New Project
        </button>
        {projects.map(p => {
          const active = p.id === selectedProjectId;
          const running = activeRunCount(p.id);
          return (
            <button key={p.id} onClick={() => { selectProject(p.id); setFocusedRunId(null); }}
              style={{ ...CARD, padding: "10px 12px", cursor: "pointer", textAlign: "left", borderColor: active ? "var(--accent)" : "var(--border)", background: active ? "var(--accent-bg)" : "var(--bg-elevated)", transition: "all .15s ease" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: active ? "var(--accent)" : "var(--text)", marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.path}</div>
              {running > 0 && (
                <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "_pulse 1.5s ease-in-out infinite" }} />
                  <span style={{ fontSize: 9, color: "var(--accent)" }}>{running} running</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: 12 }}>
        {showNewProject && <NewProjectForm onSubmit={p => { addProject(p); setShowNewProject(false); }} onCancel={() => setShowNewProject(false)} />}
        {selectedProject ? (
          <>
            <ProjectHeader project={selectedProject} runCount={projectRuns.length} activeCount={activeRunCount(selectedProject.id)} onDelete={() => removeProject(selectedProject.id)} />
            <NewRunForm onSubmit={handleStartRun} />
            <RunsList runs={projectRuns} onCancel={handleCancelRun} onRemove={removeRun} onClearCompleted={() => clearCompletedRuns(selectedProject.id)} onOpenWorkspace={setFocusedRunId} />
          </>
        ) : !showNewProject ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
              <Zap style={{ width: 32, height: 32, marginBottom: 8 }} />
              <p style={{ fontSize: 13, margin: 0 }}>Select or create a project</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Sub-Components (Projects) ── */

function ProjectHeader({ project, runCount, activeCount, onDelete }: {
  project: FactoryProject; runCount: number; activeCount: number; onDelete: () => void;
}) {
  return (
    <div style={{ ...CARD, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{project.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{project.path}</span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>&middot; {runCount} run{runCount !== 1 ? "s" : ""}</span>
          {activeCount > 0 && <span style={{ fontSize: 10, color: "var(--accent)" }}>&middot; {activeCount} active</span>}
        </div>
      </div>
      <button onClick={onDelete} style={BTN_DANGER} title="Delete project"><IconTrash /></button>
    </div>
  );
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "project";
}

function NewProjectForm({ onSubmit, onCancel }: {
  onSubmit: (p: { name: string; description: string; path: string; techStack: string[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [stack, setStack] = useState("");
  const [creating, setCreating] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const slug = slugify(name);
      const mkdirCmd = `$base = Join-Path $env:USERPROFILE 'Projects'; if (!(Test-Path $base)) { New-Item -ItemType Directory -Path $base -Force | Out-Null }; $dir = Join-Path $base '${slug}'; if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; Write-Output $dir`;
      const result = await invoke<{ stdout: string }>("execute_command", { command: mkdirCmd, cwd: null });
      onSubmit({ name: name.trim(), description: desc.trim(), path: result.stdout.trim(), techStack: stack.split(",").map(s => s.trim()).filter(Boolean) });
    } catch (err) { console.error("Failed to create project directory:", err); }
    setCreating(false);
  };

  return (
    <div style={{ ...CARD, padding: 16, flexShrink: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>New Project</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <span style={LABEL}>Project Name *</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="My App" style={INPUT} autoFocus onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }} />
        </div>
        <div>
          <span style={LABEL}>Folder</span>
          <div style={{ ...INPUT, background: "var(--bg-base)", color: "var(--text-muted)", fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <IconFolder /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>~/Projects/{name.trim() ? slugify(name) : "..."}</span>
          </div>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={LABEL}>Description</span>
          <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="A React dashboard with auth..." style={INPUT} />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={LABEL}>Tech Stack (comma separated)</span>
          <input value={stack} onChange={e => setStack(e.target.value)} placeholder="react, typescript, tailwind" style={INPUT} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={handleSubmit} disabled={!name.trim() || creating} style={{ ...BTN_PRIMARY, opacity: !name.trim() || creating ? 0.5 : 1 }}>
          <IconPlus /> {creating ? "Creating..." : "Create Project"}
        </button>
        <button onClick={onCancel} style={BTN_GHOST}>Cancel</button>
      </div>
    </div>
  );
}

function NewRunForm({ onSubmit }: { onSubmit: (agentType: AgentType, objective: string) => void }) {
  const [agentType, setAgentType] = useState<AgentType>("claude-code");
  const [objective, setObjective] = useState("");
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ ...CARD, flexShrink: 0, overflow: "visible" }}>
      <button onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", padding: "10px 16px", display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}>
        <IconChevron open={expanded} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>New Build</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>Dispatch an agent to build</span>
      </button>
      {expanded && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid var(--border)" }}>
          <div style={{ marginTop: 12 }}>
            <span style={LABEL}>Agent ID</span>
            <input value={agentType} onChange={e => setAgentType(e.target.value)}
              placeholder="claude-code, cortex, main, ..."
              style={{ ...INPUT, fontFamily: "inherit", marginBottom: 10 }} />
          </div>
          <div>
            <span style={LABEL}>Objective</span>
            <textarea value={objective} onChange={e => setObjective(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && e.ctrlKey) { if (objective.trim()) { onSubmit(agentType, objective.trim()); setObjective(""); } } }}
              placeholder="Describe what to build (Ctrl+Enter to start)"
              rows={3} style={{ ...INPUT, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button onClick={() => { if (objective.trim()) { onSubmit(agentType, objective.trim()); setObjective(""); } }}
              disabled={!objective.trim()} style={{ ...BTN_PRIMARY, opacity: !objective.trim() ? 0.5 : 1 }}>
              <IconPlay /> Build
            </button>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Ctrl+Enter</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RunsList({ runs, onCancel, onRemove, onClearCompleted, onOpenWorkspace }: {
  runs: AgentRun[]; onCancel: (run: AgentRun) => void; onRemove: (id: string) => void;
  onClearCompleted: () => void; onOpenWorkspace: (runId: string) => void;
}) {
  const hasCompleted = runs.some(r => r.status !== "running" && r.status !== "queued");
  return (
    <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
      {runs.length > 0 && hasCompleted && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClearCompleted} style={{ ...BTN_GHOST, fontSize: 10 }}>Clear Completed</button>
        </div>
      )}
      {runs.length === 0 && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>No runs yet</p>
        </div>
      )}
      {runs.map(run => (
        <RunCard key={run.id} run={run} onCancel={() => onCancel(run)} onRemove={() => onRemove(run.id)} onOpenWorkspace={() => onOpenWorkspace(run.id)} />
      ))}
    </div>
  );
}

function RunCard({ run, onCancel, onRemove, onOpenWorkspace }: {
  run: AgentRun; onCancel: () => void; onRemove: () => void; onOpenWorkspace: () => void;
}) {
  const [expanded, setExpanded] = useState(run.status === "running");
  const outputRef = useRef<HTMLPreElement>(null);
  const isActive = run.status === "running" || run.status === "queued";
  const color = "var(--accent)";

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isActive]);

  useEffect(() => {
    if (expanded && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [run.output, expanded]);

  const duration = run.startedAt ? elapsed((run.completedAt ?? now) - run.startedAt) : "—";

  return (
    <div style={{ ...CARD, borderColor: isActive ? "var(--accent)" + "40" : "var(--border)" }}>
      <button onClick={() => setExpanded(!expanded)}
        style={{ width: "100%", padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", color: "var(--text)" }}>
        <span style={{ width: 20, height: 20, borderRadius: 5, fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: color, color: "#fff" }}>
          {run.agentType.charAt(0).toUpperCase()}
        </span>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 600 }}>
            {run.agentType}
            <span style={{ fontWeight: 400, color: "var(--text-secondary)", marginLeft: 8 }}>
              {run.objective.length > 80 ? run.objective.slice(0, 80) + "..." : run.objective}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{duration}</span>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLORS[run.status] ?? "var(--text-muted)" }} />
          <span style={{ fontSize: 10, color: STATUS_COLORS[run.status], textTransform: "capitalize" }}>{run.status}</span>
          <IconChevron open={expanded} />
        </div>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {run.error && <div style={{ padding: "8px 14px", background: "rgba(239,68,68,0.06)", fontSize: 11, color: "#ef4444" }}>{run.error}</div>}
          {(run.output || !isActive) && (
            <pre ref={outputRef} style={{ margin: 0, padding: "10px 14px", fontSize: 10, lineHeight: 1.6, ...MONO, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto", background: "var(--bg-base)" }}>
              {run.output || "No output captured."}
            </pre>
          )}
          <div style={{ padding: "8px 14px", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
            <button onClick={onOpenWorkspace} style={BTN_PRIMARY}><IconFolder /> Workspace</button>
            {isActive && <button onClick={onCancel} style={BTN_DANGER}><IconStop /> Cancel</button>}
            {!isActive && <button onClick={onRemove} style={BTN_GHOST}><IconTrash /> Remove</button>}
          </div>
        </div>
      )}
    </div>
  );
}
