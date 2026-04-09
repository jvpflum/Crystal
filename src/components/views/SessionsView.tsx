import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, RefreshCw, Trash2, AlertTriangle, Clock,
  Cpu, MessageSquare, Zap, Filter, Settings2,
  CheckSquare, Square, XCircle, Calendar, ArrowUpDown,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  EASE, MONO, glowCard, innerPanel, emptyState, sectionLabel,
  hoverLift, hoverReset, pressDown, pressUp, scrollArea,
  btnPrimary, btnSecondary, viewContainer, headerRow, badge, iconTile,
} from "@/styles/viewStyles";

interface MaintenanceConfig {
  mode: string;
  [key: string]: unknown;
}

interface Session {
  key: string;
  sessionId: string;
  model: string;
  modelProvider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  agentId: string;
  updatedAt: number;
}

type SortKey = "age" | "tokens" | "model" | "agent";
type SortDir = "asc" | "desc";

const AGE_PRESETS = [
  { label: "Older than 1 hour", ms: 60 * 60 * 1000 },
  { label: "Older than 24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "Older than 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "Older than 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

export function SessionsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceConfig | null>(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [purging, setPurging] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (feedback) { const t = setTimeout(() => setFeedback(null), 4000); return () => clearTimeout(t); }
  }, [feedback]);

  const loadSessions = useCallback(async (useActive?: boolean | React.MouseEvent) => {
    setLoading(true);
    setError(null);
    const active = (typeof useActive === "boolean" ? useActive : undefined) ?? activeFilter;
    try {
      const cmd = active ? "openclaw sessions --json --active 24h" : "openclaw sessions --json";
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list sessions");
        setSessions([]);
      } else {
        const data = JSON.parse(result.stdout);
        setSessions((data.sessions || []).sort((a: Session, b: Session) => b.updatedAt - a.updatedAt));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
      setSessions([]);
    }
    setLoading(false);
    setSelected(new Set());
  }, [activeFilter]);

  const loadMaintenance = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config get session.maintenance --json", cwd: null,
      });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setMaintenance(data.value || data);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSessions(); loadMaintenance(); }, [loadSessions, loadMaintenance]);

  const cleanup = async () => {
    setCleaning(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw sessions cleanup --enforce", cwd: null,
      });
      const cleaned = result.stdout?.match(/(\d+)\s+session/i);
      setFeedback({ type: "success", msg: cleaned ? `Cleaned up ${cleaned[1]} sessions` : "Cleanup complete" });
      await loadSessions();
    } catch {
      setFeedback({ type: "error", msg: "Cleanup failed" });
    }
    setCleaning(false);
  };

  const setMaintenanceMode = async (mode: string) => {
    setMaintenanceLoading(true);
    try {
      await invoke("execute_command", {
        command: `openclaw config set session.maintenance.mode "${mode}"`, cwd: null,
      });
      setMaintenance(prev => prev ? { ...prev, mode } : { mode });
      setFeedback({ type: "success", msg: `Maintenance mode set to ${mode}` });
    } catch (e) {
      setFeedback({ type: "error", msg: e instanceof Error ? e.message : "Failed to set mode" });
    }
    setMaintenanceLoading(false);
  };

  const deleteSession = async (sessionId: string) => {
    setDeleting(sessionId);
    try {
      await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw sessions rm ${sessionId}`, cwd: null,
      });
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
      setSelected(prev => { const next = new Set(prev); next.delete(sessionId); return next; });
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const bulkDelete = async (ids: string[]) => {
    setBulkDeleting(true);
    setBulkProgress({ done: 0, total: ids.length });
    let deleted = 0;
    for (const id of ids) {
      try {
        await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
          command: `openclaw sessions rm ${id}`, cwd: null,
        });
        deleted++;
        setBulkProgress({ done: deleted, total: ids.length });
      } catch { /* continue */ }
    }
    setSessions(prev => prev.filter(s => !ids.includes(s.sessionId)));
    setSelected(new Set());
    setBulkDeleting(false);
    setBulkProgress(null);
    setFeedback({ type: "success", msg: `Deleted ${deleted} of ${ids.length} sessions` });
  };

  const deleteSelected = () => bulkDelete(Array.from(selected));

  const selectByAge = (olderThanMs: number) => {
    const cutoff = Date.now() - olderThanMs;
    const matching = sessions.filter(s => s.updatedAt < cutoff).map(s => s.sessionId);
    setSelected(new Set(matching));
    if (matching.length === 0) {
      setFeedback({ type: "success", msg: "No sessions match that age filter" });
    }
  };

  const purgeAll = async () => {
    setPurging(true);
    await bulkDelete(sessions.map(s => s.sessionId));
    setPurging(false);
    setShowPurgeConfirm(false);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === sortedSessions.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sortedSessions.map(s => s.sessionId)));
    }
  };

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions];
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "age": sorted.sort((a, b) => (a.updatedAt - b.updatedAt) * dir); break;
      case "tokens": sorted.sort((a, b) => (a.totalTokens - b.totalTokens) * dir); break;
      case "model": sorted.sort((a, b) => a.model.localeCompare(b.model) * dir); break;
      case "agent": sorted.sort((a, b) => a.agentId.localeCompare(b.agentId) * dir); break;
    }
    return sorted;
  }, [sessions, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const formatAge = (ts: number) => {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return `${Math.floor(days / 7)}w ago`;
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
  };

  const totalTokensUsed = sessions.reduce((a, s) => a + s.totalTokens, 0);

  // Stats
  const now = Date.now();
  const staleCount = sessions.filter(s => now - s.updatedAt > 24 * 60 * 60 * 1000).length;
  const ancientCount = sessions.filter(s => now - s.updatedAt > 7 * 24 * 60 * 60 * 1000).length;
  const recentCount = sessions.filter(s => now - s.updatedAt < 60 * 60 * 1000).length;

  return (
    <div style={viewContainer}>
      {/* Header */}
      <div style={headerRow}>
        <div>
          <h2 style={{ color: "var(--text)", fontSize: 17, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Sessions</h2>
          <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
            {sessions.length} total &middot; {formatTokens(totalTokensUsed)} tokens used
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => { const next = !activeFilter; setActiveFilter(next); loadSessions(next); }}
            style={{
              ...btnSecondary, padding: "5px 10px", fontSize: 10,
              background: activeFilter ? "rgba(59,130,246,0.15)" : undefined,
              color: activeFilter ? "var(--accent)" : undefined,
              fontWeight: activeFilter ? 600 : undefined,
            }}
          >
            <Filter style={{ width: 10, height: 10, marginRight: 4, verticalAlign: -1 }} />
            Active (24h)
          </button>
          <button onClick={cleanup} disabled={cleaning} onMouseDown={pressDown} onMouseUp={pressUp}
            style={{ ...btnSecondary, padding: "5px 10px", fontSize: 10, color: "var(--error)", borderColor: "rgba(248,113,113,0.15)", opacity: cleaning ? 0.5 : 1 }}>
            {cleaning ? <Loader2 style={{ width: 10, height: 10, marginRight: 4, verticalAlign: -1 }} className="animate-spin" /> : <Trash2 style={{ width: 10, height: 10, marginRight: 4, verticalAlign: -1 }} />}
            Auto Cleanup
          </button>
          <button onClick={() => loadSessions()} disabled={loading} onMouseDown={pressDown} onMouseUp={pressUp}
            style={{ ...btnSecondary, padding: "5px 10px", fontSize: 10 }}>
            <RefreshCw style={{ width: 10, height: 10, marginRight: 4, verticalAlign: -1 }} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 10,
          background: feedback.type === "success" ? "rgba(74,222,128,0.06)" : "rgba(248,113,113,0.06)",
          border: `1px solid ${feedback.type === "success" ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)"}`,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: feedback.type === "success" ? "#4ade80" : "#f87171", flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>{feedback.msg}</span>
          <button onClick={() => setFeedback(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, padding: 2 }}>×</button>
        </div>
      )}

      {/* Bulk progress bar */}
      {bulkProgress && (
        <div style={{ ...innerPanel, padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
          <Loader2 style={{ width: 12, height: 12, color: "var(--accent)" }} className="animate-spin" />
          <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            Deleting {bulkProgress.done} / {bulkProgress.total} sessions…
          </span>
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
            <div style={{ width: `${(bulkProgress.done / bulkProgress.total) * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: `width 0.2s ${EASE}` }} />
          </div>
        </div>
      )}

      {/* Stats row */}
      {!loading && sessions.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          <StatCard label="Total" value={sessions.length} color="#3b82f6" icon={MessageSquare} />
          <StatCard label="Active (<1h)" value={recentCount} color="#34d399" icon={Zap} />
          <StatCard label="Stale (>24h)" value={staleCount} color="#fbbf24" icon={Clock} />
          <StatCard label="Ancient (>7d)" value={ancientCount} color="#f87171" icon={AlertTriangle} />
        </div>
      )}

      {/* Quick purge actions */}
      {!loading && sessions.length > 5 && (
        <div style={{ ...innerPanel, padding: "10px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Calendar style={{ width: 11, height: 11, color: "var(--text-muted)" }} />
            <span style={sectionLabel}>Quick Select by Age</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {AGE_PRESETS.map(p => {
              const count = sessions.filter(s => now - s.updatedAt > p.ms).length;
              return (
                <button key={p.ms} onClick={() => selectByAge(p.ms)} disabled={count === 0}
                  style={{
                    ...btnSecondary, padding: "4px 10px", fontSize: 10,
                    opacity: count === 0 ? 0.35 : 1,
                  }}>
                  {p.label} ({count})
                </button>
              );
            })}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setShowPurgeConfirm(true)}
              disabled={sessions.length === 0 || purging}
              style={{
                ...btnSecondary, padding: "4px 12px", fontSize: 10,
                color: "#f87171", borderColor: "rgba(248,113,113,0.15)",
              }}>
              <XCircle style={{ width: 10, height: 10, marginRight: 4, verticalAlign: -1 }} />
              Purge All ({sessions.length})
            </button>
          </div>
        </div>
      )}

      {/* Purge confirmation */}
      {showPurgeConfirm && (
        <div style={{
          ...glowCard("#f87171"), padding: "12px 16px",
          background: "rgba(248,113,113,0.04)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle style={{ width: 16, height: 16, color: "#f87171", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f87171" }}>Confirm Purge All Sessions</div>
              <div style={{ fontSize: 10, color: "rgba(248,113,113,0.6)", marginTop: 2 }}>
                This will delete all {sessions.length} sessions. This cannot be undone.
              </div>
            </div>
            <button onClick={purgeAll} disabled={purging} onMouseDown={pressDown} onMouseUp={pressUp}
              style={{ ...btnPrimary, background: "#dc2626", padding: "6px 14px", fontSize: 11 }}>
              {purging ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : "Delete All"}
            </button>
            <button onClick={() => setShowPurgeConfirm(false)} style={{ ...btnSecondary, padding: "6px 12px", fontSize: 11 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Selection toolbar */}
      {selected.size > 0 && !bulkDeleting && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
          borderRadius: 12, background: "rgba(59,130,246,0.06)",
          border: "1px solid rgba(59,130,246,0.12)",
        }}>
          <CheckSquare style={{ width: 13, height: 13, color: "var(--accent)" }} />
          <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500 }}>
            {selected.size} session{selected.size !== 1 ? "s" : ""} selected
          </span>
          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
            ({formatTokens(sessions.filter(s => selected.has(s.sessionId)).reduce((a, s) => a + s.totalTokens, 0))} tokens)
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={deleteSelected} onMouseDown={pressDown} onMouseUp={pressUp}
            style={{ ...btnPrimary, background: "#dc2626", padding: "5px 14px", fontSize: 11 }}>
            <Trash2 style={{ width: 11, height: 11, marginRight: 4, verticalAlign: -1 }} />
            Delete Selected
          </button>
          <button onClick={() => setSelected(new Set())} style={{ ...btnSecondary, padding: "5px 12px", fontSize: 11 }}>
            Clear
          </button>
        </div>
      )}

      {/* Sort bar + select-all */}
      {!loading && sessions.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={toggleSelectAll} title={selected.size === sortedSessions.length ? "Deselect all" : "Select all"}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-muted)", display: "flex" }}>
            {selected.size === sortedSessions.length && sortedSessions.length > 0
              ? <CheckSquare style={{ width: 13, height: 13, color: "var(--accent)" }} />
              : <Square style={{ width: 13, height: 13 }} />}
          </button>
          <span style={{ fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.06em" }}>SORT:</span>
          {(["age", "tokens", "model", "agent"] as SortKey[]).map(k => (
            <button key={k} onClick={() => toggleSort(k)}
              style={{
                ...btnSecondary, padding: "3px 8px", fontSize: 9,
                background: sortKey === k ? "rgba(59,130,246,0.12)" : undefined,
                color: sortKey === k ? "var(--accent)" : undefined,
                fontWeight: sortKey === k ? 600 : undefined,
              }}>
              {k.charAt(0).toUpperCase() + k.slice(1)}
              {sortKey === k && <ArrowUpDown style={{ width: 8, height: 8, marginLeft: 3, verticalAlign: -1, transform: sortDir === "asc" ? "scaleY(-1)" : undefined }} />}
            </button>
          ))}
        </div>
      )}

      {/* Session list */}
      <div style={scrollArea}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "var(--accent)" }} className="animate-spin" />
          </div>
        ) : error ? (
          <div style={emptyState}>
            <AlertTriangle style={{ width: 24, height: 24, color: "var(--error)" }} />
            <p style={{ fontSize: 12, color: "var(--error)", textAlign: "center" }}>{error}</p>
            <button onClick={() => loadSessions()} style={{ ...btnSecondary, fontSize: 11 }}>Retry</button>
          </div>
        ) : sessions.length === 0 ? (
          <div style={emptyState}>
            <MessageSquare style={{ width: 28, height: 28, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No active sessions</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {sortedSessions.map(session => (
              <SessionCard
                key={session.sessionId}
                session={session}
                formatAge={formatAge}
                formatTokens={formatTokens}
                onDelete={() => deleteSession(session.sessionId)}
                isDeleting={deleting === session.sessionId}
                isSelected={selected.has(session.sessionId)}
                onToggleSelect={() => toggleSelect(session.sessionId)}
              />
            ))}
          </div>
        )}

        {/* Maintenance Config */}
        {!loading && (
          <div style={{ ...innerPanel, marginTop: 16, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Settings2 style={{ width: 12, height: 12, color: "var(--text-muted)" }} />
              <span style={sectionLabel}>Maintenance Settings</span>
              <button onClick={loadMaintenance} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 9, display: "flex", alignItems: "center", gap: 3 }}>
                <RefreshCw style={{ width: 8, height: 8 }} /> reload
              </button>
            </div>
            {maintenance ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Mode:</span>
                <div style={{ display: "flex", gap: 4 }}>
                  {["warn", "enforce"].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setMaintenanceMode(mode)}
                      disabled={maintenanceLoading || maintenance.mode === mode}
                      onMouseDown={pressDown} onMouseUp={pressUp}
                      style={{
                        ...btnSecondary, padding: "4px 12px", fontSize: 10,
                        fontWeight: maintenance.mode === mode ? 600 : undefined,
                        background: maintenance.mode === mode ? "rgba(59,130,246,0.12)" : undefined,
                        color: maintenance.mode === mode ? "var(--accent)" : undefined,
                        opacity: maintenanceLoading ? 0.5 : 1,
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                {maintenanceLoading && <Loader2 style={{ width: 10, height: 10, color: "var(--accent)" }} className="animate-spin" />}
              </div>
            ) : (
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>Could not load maintenance config</p>
            )}
            <p style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 6, lineHeight: 1.4 }}>
              <strong>warn</strong> — flag stale sessions without removing them.{" "}
              <strong>enforce</strong> — auto-cleanup runs automatically remove idle sessions.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, icon: Icon }: { label: string; value: number; color: string; icon: React.ElementType }) {
  return (
    <div style={{ ...glowCard(color), padding: "10px 12px" }} data-glow={color} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={iconTile(color, 28)}>
          <Icon style={{ width: 13, height: 13, color }} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: MONO, color: "var(--text)", lineHeight: 1 }}>{value}</div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{label}</div>
        </div>
      </div>
    </div>
  );
}

function SessionCard({ session, formatAge, formatTokens, onDelete, isDeleting, isSelected, onToggleSelect }: {
  session: Session;
  formatAge: (ts: number) => string;
  formatTokens: (n: number) => string;
  onDelete: () => void;
  isDeleting: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const usageRatio = session.contextTokens > 0
    ? Math.min(session.totalTokens / session.contextTokens, 1)
    : 0;
  const usagePercent = (usageRatio * 100).toFixed(1);

  const barColor = usageRatio > 0.85 ? "var(--error)"
    : usageRatio > 0.6 ? "var(--warning)"
    : "var(--accent)";

  const age = Date.now() - session.updatedAt;
  const isStale = age > 24 * 60 * 60 * 1000;
  const isAncient = age > 7 * 24 * 60 * 60 * 1000;

  return (
    <div
      style={{
        ...innerPanel, padding: "10px 12px",
        borderColor: isSelected ? "rgba(59,130,246,0.25)" : undefined,
        background: isSelected ? "rgba(59,130,246,0.04)" : undefined,
      }}
      data-glow="#3B82F6"
      onMouseEnter={hoverLift}
      onMouseLeave={hoverReset}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {/* Checkbox */}
        <button onClick={onToggleSelect} style={{
          background: "none", border: "none", cursor: "pointer", padding: 2, marginTop: 2,
          color: isSelected ? "var(--accent)" : "rgba(255,255,255,0.2)",
          display: "flex", flexShrink: 0, transition: `color 0.15s ${EASE}`,
        }}>
          {isSelected
            ? <CheckSquare style={{ width: 14, height: 14 }} />
            : <Square style={{ width: 14, height: 14 }} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500, fontFamily: MONO }}>
              {session.agentId}
            </span>
            <span style={badge("var(--accent)")}>
              {session.modelProvider}
            </span>
            {isAncient && <span style={badge("#f87171")}>ancient</span>}
            {!isAncient && isStale && <span style={badge("#fbbf24")}>stale</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <Cpu style={{ width: 10, height: 10, color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontFamily: MONO }}>
              {session.model}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Clock style={{ width: 10, height: 10, color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 10, color: isStale ? "#fbbf24" : "rgba(255,255,255,0.35)" }}>
              {formatAge(session.updatedAt)}
            </span>
          </div>
          <button onClick={onDelete} disabled={isDeleting} title="Delete this session"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 24, height: 24, borderRadius: 7, border: "none",
              cursor: isDeleting ? "wait" : "pointer",
              background: "rgba(248,113,113,0.06)",
              color: "rgba(248,113,113,0.6)",
              opacity: isDeleting ? 0.4 : 1,
              transition: `all 0.15s ${EASE}`,
            }}>
            {isDeleting
              ? <Loader2 style={{ width: 11, height: 11 }} className="animate-spin" />
              : <Trash2 style={{ width: 11, height: 11 }} />}
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, display: "flex", gap: 12 }}>
        <TokenStat icon={Zap} label="Input" value={formatTokens(session.inputTokens)} color="var(--accent)" />
        <TokenStat icon={MessageSquare} label="Output" value={formatTokens(session.outputTokens)} color="#a78bfa" />
        <TokenStat icon={Cpu} label="Total" value={formatTokens(session.totalTokens)} color="rgba(255,255,255,0.6)" />
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Context Usage</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: MONO }}>
            {formatTokens(session.totalTokens)} / {formatTokens(session.contextTokens)} ({usagePercent}%)
          </span>
        </div>
        <div style={{ width: "100%", height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
          <div style={{ width: `${usageRatio * 100}%`, height: "100%", borderRadius: 2, background: barColor, transition: `width 0.3s ${EASE}` }} />
        </div>
      </div>

      <div style={{ marginTop: 4 }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", fontFamily: MONO }}>{session.key}</span>
      </div>
    </div>
  );
}

function TokenStat({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string; color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <Icon style={{ width: 10, height: 10, color: "rgba(255,255,255,0.25)" }} />
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{label}</span>
      <span style={{ fontSize: 10, color, fontFamily: MONO, fontWeight: 500 }}>{value}</span>
    </div>
  );
}
