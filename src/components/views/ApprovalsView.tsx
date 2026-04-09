import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ShieldCheck, RefreshCw, Loader2, AlertTriangle, Plus, Trash2,
  CheckCircle2, XCircle, Shield,
} from "lucide-react";
import { EASE, glowCard, hoverLift, hoverReset, pressDown, pressUp, innerPanel, emptyState, inputStyle, btnPrimary, MONO } from "@/styles/viewStyles";

interface ApprovalEntry {
  command: string;
  agent?: string;
  approvedAt?: string;
  scope?: string;
}

interface AllowlistEntry {
  pattern: string;
  agent: string;
  scope?: string;
}

/** PowerShell single-quoted literal: embed ' as '' */
function escapePowerShellSingleQuoted(s: string): string {
  return s.replace(/'/g, "''");
}

/** OpenClaw expects `allowlist add|remove <pattern> [--agent id]` (not `--add`). */
function allowlistCli(action: "add" | "remove", pattern: string, agent: string): string {
  const p = escapePowerShellSingleQuoted(pattern.trim());
  const agentArg = agent === "*" ? "--agent '*'" : `--agent ${agent}`;
  return `openclaw approvals allowlist ${action} '${p}' ${agentArg}`;
}

/** `openclaw approvals get --json` nests allowlists under file.agents.<id>.allowlist */
function parseAllowlistRows(data: Record<string, unknown>): AllowlistEntry[] {
  const legacy = data.allowlist ?? data.allowed;
  if (Array.isArray(legacy) && legacy.length > 0) {
    return legacy.map((a: Record<string, unknown>) => ({
      pattern: String(a.pattern ?? a.command ?? ""),
      agent: String(a.agent ?? a.agentId ?? "main"),
      scope: a.scope ? String(a.scope) : undefined,
    }));
  }
  const file = data.file as Record<string, unknown> | undefined;
  const agents = file?.agents as Record<string, Record<string, unknown>> | undefined;
  if (!agents || typeof agents !== "object") return [];
  const out: AllowlistEntry[] = [];
  for (const [agentId, agent] of Object.entries(agents)) {
    const list = agent?.allowlist;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const e = entry as Record<string, unknown>;
      const pattern = String(e.pattern ?? "").trim();
      if (pattern) out.push({ pattern, agent: agentId });
    }
  }
  return out;
}

export function ApprovalsView() {
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pending" | "allowlist">("pending");
  const [newPattern, setNewPattern] = useState("");
  const [newAgent, setNewAgent] = useState("main");
  const [adding, setAdding] = useState(false);

  const loadApprovals = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw approvals get --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        const pending = data.pending ?? data.approvals ?? [];
        setApprovals(pending.map((a: Record<string, unknown>) => ({
          command: String(a.command ?? a.cmd ?? ""),
          agent: a.agent ? String(a.agent) : a.agentId ? String(a.agentId) : undefined,
          approvedAt: a.approvedAt ? String(a.approvedAt) : undefined,
          scope: a.scope ? String(a.scope) : undefined,
        })));
        setAllowlist(parseAllowlistRows(data));
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadApprovals();
    const interval = setInterval(loadApprovals, 30_000);
    return () => clearInterval(interval);
  }, [loadApprovals]);

  const addToAllowlist = async () => {
    if (!newPattern.trim()) return;
    setAdding(true);
    try {
      await invoke("execute_command", {
        command: allowlistCli("add", newPattern, newAgent),
        cwd: null,
      });
      setNewPattern("");
      await loadApprovals();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add to allowlist");
    }
    setAdding(false);
  };

  const removeFromAllowlist = async (pattern: string, agent: string) => {
    try {
      await invoke("execute_command", {
        command: allowlistCli("remove", pattern, agent),
        cwd: null,
      });
      await loadApprovals();
    } catch { /* ignore */ }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldCheck style={{ width: 18, height: 18, color: "var(--accent)" }} />
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Exec Approvals</h2>
          </div>
          <button onClick={() => { setLoading(true); loadApprovals(); }} disabled={loading}
            style={{ display: "flex", alignItems: "center", padding: "4px 8px", borderRadius: 6, border: "none", background: "var(--bg-hover)", color: "var(--text-muted)", cursor: "pointer" }}>
            <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
          </button>
        </div>

        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--border)" }}>
          {(["pending", "allowlist"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 12,
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              background: tab === t ? "var(--bg-elevated)" : "transparent",
              color: tab === t ? "var(--accent)" : "var(--text-muted)",
              fontWeight: tab === t ? 600 : 500, borderRadius: "8px 8px 0 0",
            }}>
              {t === "pending" ? `Pending (${approvals.length})` : `Allowlist (${allowlist.length})`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#f87171" }} />
            <span style={{ fontSize: 11, color: "#f87171", flex: 1 }}>{error}</span>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : tab === "pending" ? (
          approvals.length === 0 ? (
            <div style={emptyState}>
              <CheckCircle2 style={{ width: 32, height: 32, color: "#4ade80" }} />
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No pending approvals</p>
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "4px 0 0" }}>
                Exec approvals appear when agents request to run commands that need authorization
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {approvals.map((a, i) => (
                <div key={i} data-glow="#fbbf24" onMouseEnter={hoverLift} onMouseLeave={hoverReset} style={glowCard("#fbbf24", { padding: "10px 14px" })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Shield style={{ width: 14, height: 14, color: "#fbbf24", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <code style={{ fontSize: 11, color: "var(--text)", fontFamily: MONO, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {a.command}
                      </code>
                      <div style={{ display: "flex", gap: 8, fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>
                        {a.agent && <span>Agent: {a.agent}</span>}
                        {a.scope && <span>Scope: {a.scope}</span>}
                        {a.approvedAt && <span>{a.approvedAt}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <div style={{ marginBottom: 16, ...innerPanel, padding: 14 }}>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, display: "block", marginBottom: 6 }}>Add Allowlist Pattern</span>
              <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "0 0 8px", lineHeight: 1.45 }}>
                Use the resolved executable path or a glob (e.g. <code style={{ fontSize: 9 }}>**/openhue.exe</code>).
                Cron jobs need the binary allowlisted for the job&apos;s agent; chained commands (<code style={{ fontSize: 9 }}>&amp;&amp;</code>) require each segment&apos;s binary to match.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={newPattern} onChange={e => setNewPattern(e.target.value)}
                  placeholder="e.g. C:\...\openhue.exe or **/openhue.exe" onKeyDown={e => { if (e.key === "Enter") addToAllowlist(); }}
                  style={{ ...inputStyle, flex: 1, fontFamily: MONO }} />
                <select value={newAgent} onChange={e => setNewAgent(e.target.value)}
                  style={{ padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, outline: "none" }}>
                  <option value="main">main</option>
                  <option value="research">research</option>
                  <option value="home">home</option>
                  <option value="finance">finance</option>
                  <option value="*">all agents</option>
                </select>
                <button onClick={addToAllowlist} disabled={adding || !newPattern.trim()}
                  onMouseDown={pressDown} onMouseUp={pressUp}
                  style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 4, opacity: adding || !newPattern.trim() ? 0.5 : 1 }}>
                  {adding ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Plus style={{ width: 11, height: 11 }} />}
                  Add
                </button>
              </div>
            </div>

            {allowlist.length === 0 ? (
              <div style={emptyState}>
                <XCircle style={{ width: 28, height: 28, color: "var(--text-muted)" }} />
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>No allowlist patterns</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {allowlist.map((a, i) => (
                  <div key={i} data-glow="#4ade80" onMouseEnter={hoverLift} onMouseLeave={hoverReset} style={glowCard("#4ade80", { padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 })}>
                    <CheckCircle2 style={{ width: 14, height: 14, color: "#4ade80", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <code style={{ fontSize: 11, color: "var(--text)", fontFamily: MONO }}>{a.pattern}</code>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 8 }}>agent: {a.agent}</span>
                    </div>
                    <button onClick={() => removeFromAllowlist(a.pattern, a.agent)}
                      onMouseDown={pressDown} onMouseUp={pressUp}
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.06)", color: "#f87171", cursor: "pointer", display: "flex", alignItems: "center", transition: `all 0.2s ${EASE}` }}>
                      <Trash2 style={{ width: 11, height: 11 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
