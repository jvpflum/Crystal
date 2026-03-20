import { useState, useEffect, useCallback } from "react";
import {
  Loader2, RefreshCw, Trash2, AlertTriangle, Clock,
  Cpu, MessageSquare, Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

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

export function SessionsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw sessions --json",
        cwd: null,
      });
      if (result.code !== 0) {
        setError(result.stderr || "Failed to list sessions");
        setSessions([]);
      } else {
        const data = JSON.parse(result.stdout);
        const sorted = (data.sessions || []).sort(
          (a: Session, b: Session) => b.updatedAt - a.updatedAt
        );
        setSessions(sorted);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
      setSessions([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const cleanup = async () => {
    setCleaning(true);
    try {
      await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw sessions cleanup",
        cwd: null,
      });
      await loadSessions();
    } catch { /* ignore */ }
    setCleaning(false);
  };

  const deleteSession = async (sessionId: string) => {
    setDeleting(sessionId);
    try {
      await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw sessions rm ${sessionId}`,
        cwd: null,
      });
      setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
    } catch { /* ignore */ }
    setDeleting(null);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Sessions</h2>
            <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {sessions.length} active &middot; {formatTokens(totalTokensUsed)} tokens used
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 9, color: "rgba(255,255,255,0.25)", maxWidth: 320 }}>
              Each chat and agent task creates a backend session. Cleanup old ones to free context.
            </p>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={cleanup}
              disabled={cleaning}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(248,113,113,0.1)", color: "var(--error)",
                opacity: cleaning ? 0.5 : 1,
              }}
            >
              {cleaning
                ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
                : <Trash2 style={{ width: 10, height: 10 }} />
              }
              Cleanup
            </button>
            <button
              onClick={loadSessions}
              disabled={loading}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, border: "none", fontSize: 10, cursor: "pointer",
                background: "rgba(59,130,246,0.15)", color: "var(--accent)",
              }}
            >
              <RefreshCw style={{ width: 10, height: 10 }} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 16px" }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 24, height: 24, color: "var(--accent)" }} className="animate-spin" />
          </div>
        ) : error ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <AlertTriangle style={{ width: 24, height: 24, color: "var(--error)" }} />
            <p style={{ fontSize: 12, color: "var(--error)", textAlign: "center" }}>{error}</p>
            <button onClick={loadSessions} style={{
              padding: "4px 12px", borderRadius: 6, border: "none",
              background: "var(--border)", color: "rgba(255,255,255,0.6)",
              fontSize: 11, cursor: "pointer",
            }}>
              Retry
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 40, gap: 8 }}>
            <MessageSquare style={{ width: 28, height: 28, color: "rgba(255,255,255,0.15)" }} />
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>No active sessions</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sessions.map((session) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                formatAge={formatAge}
                formatTokens={formatTokens}
                onDelete={() => deleteSession(session.sessionId)}
                isDeleting={deleting === session.sessionId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({ session, formatAge, formatTokens, onDelete, isDeleting }: {
  session: Session;
  formatAge: (ts: number) => string;
  formatTokens: (n: number) => string;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const usageRatio = session.contextTokens > 0
    ? Math.min(session.totalTokens / session.contextTokens, 1)
    : 0;
  const usagePercent = (usageRatio * 100).toFixed(1);

  const barColor = usageRatio > 0.85 ? "var(--error)"
    : usageRatio > 0.6 ? "var(--warning)"
    : "var(--accent)";

  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{
              fontSize: 12, color: "var(--text)", fontWeight: 500, fontFamily: "monospace",
            }}>
              {session.agentId}
            </span>
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 3,
              background: "rgba(59,130,246,0.12)", color: "var(--accent)",
            }}>
              {session.modelProvider}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <Cpu style={{ width: 10, height: 10, color: "rgba(255,255,255,0.35)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", fontFamily: "monospace" }}>
              {session.model}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Clock style={{ width: 10, height: 10, color: "rgba(255,255,255,0.3)" }} />
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
              {formatAge(session.updatedAt)}
            </span>
          </div>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            title="End this session"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: 5, border: "none",
              cursor: isDeleting ? "wait" : "pointer",
              background: "rgba(248,113,113,0.08)",
              color: "rgba(248,113,113,0.7)",
              opacity: isDeleting ? 0.4 : 1,
              transition: "all 0.15s",
            }}
          >
            {isDeleting
              ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />
              : <Trash2 style={{ width: 10, height: 10 }} />
            }
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
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>
            {formatTokens(session.totalTokens)} / {formatTokens(session.contextTokens)} ({usagePercent}%)
          </span>
        </div>
        <div style={{
          width: "100%", height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.06)", overflow: "hidden",
        }}>
          <div style={{
            width: `${usageRatio * 100}%`, height: "100%", borderRadius: 2,
            background: barColor, transition: "width 0.3s ease",
          }} />
        </div>
      </div>

      <div style={{
        marginTop: 6, display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
          {session.key}
        </span>
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
      <span style={{ fontSize: 10, color, fontFamily: "monospace", fontWeight: 500 }}>{value}</span>
    </div>
  );
}
