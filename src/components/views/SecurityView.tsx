import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Loader2,
  Wrench,
  Lock,
  Eye,
  KeyRound,
  ClipboardCheck,
  Database,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AuditItem {
  id?: string;
  check: string;
  status: "pass" | "fail" | "warn";
  message: string;
  fixable?: boolean;
}

interface AuditResult {
  items: AuditItem[];
  summary?: { pass: number; fail: number; warn: number };
}

export function SecurityView() {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [deepScan, setDeepScan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolsAllow, setToolsAllow] = useState<string[]>([]);
  const [gatewayAuth, setGatewayAuth] = useState<"enabled" | "disabled" | "unknown">("unknown");
  const [configLoaded, setConfigLoaded] = useState(false);

  const [secretsReloading, setSecretsReloading] = useState(false);
  const [secretsStatus, setSecretsStatus] = useState<string | null>(null);

  const [approvals, setApprovals] = useState<Record<string, unknown>[] | null>(null);
  const [approvalsLoading, setApprovalsLoading] = useState(false);

  const [memoryReindexing, setMemoryReindexing] = useState(false);
  const [memoryReindexStatus, setMemoryReindexStatus] = useState<string | null>(null);
  const [memoryStats, setMemoryStats] = useState<Record<string, unknown> | null>(null);
  const [memoryStatsLoading, setMemoryStatsLoading] = useState(false);

  const parseAuditOutput = (stdout: string): AuditResult => {
    if (!stdout.trim()) return { items: [], summary: { pass: 0, fail: 0, warn: 0 } };
    try {
      const parsed = JSON.parse(stdout);
      if (Array.isArray(parsed)) {
        const items = parsed as AuditItem[];
        return { items, summary: { pass: items.filter(i => i.status === "pass").length, fail: items.filter(i => i.status === "fail").length, warn: items.filter(i => i.status === "warn").length } };
      }
      const items: AuditItem[] = parsed.items ?? parsed.results ?? parsed.checks ?? [];
      return { items, summary: parsed.summary ?? { pass: items.filter(i => i.status === "pass").length, fail: items.filter(i => i.status === "fail").length, warn: items.filter(i => i.status === "warn").length } };
    } catch {
      return { items: [], summary: { pass: 0, fail: 0, warn: 0 } };
    }
  };

  const runAgentFallbackAudit = useCallback(async (deep: boolean): Promise<AuditResult> => {
    const prompt = deep
      ? `Run a deep security audit on this system. Check: Windows Defender status, firewall, open ports (netstat), outdated packages, exposed credentials in common config files, recent login attempts, disk encryption status. Return ONLY a JSON array where each item has: "check" (string), "status" ("pass"|"fail"|"warn"), "message" (string), "fixable" (boolean). No markdown, no explanation, just the JSON array.`
      : `Run a quick security scan on this system. Check: Windows Defender status, firewall status, open ports, and any obvious security issues. Return ONLY a JSON array where each item has: "check" (string), "status" ("pass"|"fail"|"warn"), "message" (string), "fixable" (boolean). No markdown, no explanation, just the JSON array.`;
    const escaped = prompt.replace(/"/g, '\\"');
    const result = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `openclaw agent --agent main --message "${escaped}"`,
      cwd: null,
    });
    const jsonMatch = result.stdout.match(/\[[\s\S]*\]/);
    if (jsonMatch) return parseAuditOutput(jsonMatch[0]);
    return { items: [{ check: "Agent Scan", status: "warn", message: result.stdout.trim() || "Scan completed but output was not structured", fixable: false }], summary: { pass: 0, fail: 0, warn: 1 } };
  }, []);

  const runAudit = useCallback(async (deep = false) => {
    setLoading(true);
    setError(null);
    try {
      const cmd = deep ? "openclaw security audit --deep --json" : "openclaw security audit --json";
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: cmd, cwd: null });
      if (result.code === 0 && result.stdout.trim()) {
        setAudit(parseAuditOutput(result.stdout));
      } else {
        const fallback = await runAgentFallbackAudit(deep);
        setAudit(fallback);
      }
    } catch {
      try {
        const fallback = await runAgentFallbackAudit(deep);
        setAudit(fallback);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : "Failed to run security audit");
      }
    }
    setLoading(false);
  }, [runAgentFallbackAudit]);

  const loadConfig = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw config get --json",
        cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const cfg = JSON.parse(result.stdout);
        setToolsAllow(cfg?.tools?.allow ?? cfg?.permissions?.tools ?? []);
        const auth = cfg?.gateway?.auth ?? cfg?.auth;
        setGatewayAuth(auth ? "enabled" : "disabled");
      }
    } catch {
      /* config read is best-effort */
    }
    setConfigLoaded(true);
  }, []);

  const reloadSecrets = useCallback(async () => {
    setSecretsReloading(true);
    setSecretsStatus(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw secrets reload",
        cwd: null,
      });
      setSecretsStatus(result.code === 0 ? "Secrets reloaded successfully" : (result.stderr || "Reload failed"));
    } catch (e) {
      setSecretsStatus(e instanceof Error ? e.message : "Reload failed");
    }
    setSecretsReloading(false);
  }, []);

  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw approvals list --json",
        cwd: null,
      });
      if (result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const items: Record<string, unknown>[] = Array.isArray(parsed)
          ? parsed
          : (parsed.approvals ?? parsed.items ?? parsed.rules ?? []);
        setApprovals(items);
      } else {
        setApprovals([]);
      }
    } catch {
      setApprovals([]);
    }
    setApprovalsLoading(false);
  }, []);

  const reindexMemory = useCallback(async () => {
    setMemoryReindexing(true);
    setMemoryReindexStatus(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw memory reindex",
        cwd: null,
      });
      setMemoryReindexStatus(result.code === 0 ? "Reindex completed" : (result.stderr || "Reindex failed"));
    } catch (e) {
      setMemoryReindexStatus(e instanceof Error ? e.message : "Reindex failed");
    }
    setMemoryReindexing(false);
  }, []);

  const loadMemoryStats = useCallback(async () => {
    setMemoryStatsLoading(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw memory status --json",
        cwd: null,
      });
      if (result.stdout.trim()) {
        setMemoryStats(JSON.parse(result.stdout));
      }
    } catch {
      /* best-effort */
    }
    setMemoryStatsLoading(false);
  }, []);

  useEffect(() => {
    runAudit(false);
    loadConfig();
    loadApprovals();
    loadMemoryStats();
  }, [runAudit, loadConfig, loadApprovals, loadMemoryStats]);

  const handleFix = async () => {
    setFixing(true);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw security audit --fix",
        cwd: null,
      });
      if (result.code !== 0 && result.stderr) {
        setError(result.stderr);
      }
      await runAudit(deepScan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fix failed");
    }
    setFixing(false);
  };

  const handleDeepScan = async () => {
    setDeepScan(true);
    await runAudit(true);
  };

  const statusIcon = (status: string) => {
    if (status === "pass") return <CheckCircle style={{ width: 14, height: 14, color: "var(--success)", flexShrink: 0 }} />;
    if (status === "warn") return <AlertTriangle style={{ width: 14, height: 14, color: "var(--warning)", flexShrink: 0 }} />;
    return <XCircle style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />;
  };

  const statusColor = (status: string) => {
    if (status === "pass") return "var(--success)";
    if (status === "warn") return "var(--warning)";
    return "var(--error)";
  };

  const hasFixable = audit?.items.some((i) => i.fixable || i.status === "fail" || i.status === "warn");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Security</h2>
          {audit?.summary && !loading && (
            <div style={{ display: "flex", gap: 8 }}>
              <Badge color="#4ade80" count={audit.summary.pass} label="pass" />
              {audit.summary.warn > 0 && <Badge color="#fbbf24" count={audit.summary.warn} label="warn" />}
              {audit.summary.fail > 0 && <Badge color="#f87171" count={audit.summary.fail} label="fail" />}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {hasFixable && (
            <button onClick={handleFix} disabled={fixing} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "none", background: "rgba(74,222,128,0.15)", color: "var(--success)", fontSize: 11, cursor: "pointer" }}>
              {fixing ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Wrench style={{ width: 12, height: 12 }} />}
              Auto Fix
            </button>
          )}
          {!deepScan && (
            <button onClick={handleDeepScan} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer" }}>
              <Eye style={{ width: 12, height: 12 }} /> Deep Scan
            </button>
          )}
          <button onClick={() => runAudit(deepScan)} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)", fontSize: 11, cursor: "pointer" }}>
            <RefreshCw style={{ width: 12, height: 12 }} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Score card */}
        {audit?.summary && !loading && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>Overview</span>
            <div style={{ display: "flex", gap: 8 }}>
              <ScoreCard icon={ShieldCheck} label="Passed" count={audit.summary.pass} color="var(--success)" />
              <ScoreCard icon={AlertTriangle} label="Warnings" count={audit.summary.warn} color="var(--warning)" />
              <ScoreCard icon={ShieldAlert} label="Failed" count={audit.summary.fail} color="var(--error)" />
            </div>
          </div>
        )}

        {/* Audit items */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>
            Audit Results {deepScan && <span style={{ color: "rgba(255,255,255,0.25)" }}>(deep)</span>}
          </span>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <Loader2 style={{ width: 20, height: 20, color: "rgba(255,255,255,0.3)" }} className="animate-spin" />
            </div>
          ) : !audit || audit.items.length === 0 ? (
            <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", borderRadius: 10, padding: "24px 16px", textAlign: "center" }}>
              <Shield style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>No audit results available</p>
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: "4px 0 0" }}>Run an audit to check your security posture</p>
            </div>
          ) : (
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
              {audit.items.map((item, i) => (
                <div
                  key={item.id || i}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px",
                    borderBottom: i < audit.items.length - 1 ? "1px solid rgba(255,255,255,0.07)" : "none",
                  }}
                >
                  {statusIcon(item.status)}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{item.check}</span>
                      {item.fixable && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 8, background: "rgba(74,222,128,0.1)", color: "var(--success)", border: "1px solid rgba(74,222,128,0.2)" }}>
                          fixable
                        </span>
                      )}
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: 10, color: statusColor(item.status), opacity: 0.8 }}>
                      {item.message}
                    </p>
                  </div>
                  <span style={{ fontSize: 10, color: statusColor(item.status), flexShrink: 0, textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.5 }}>
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tool permissions */}
        {configLoaded && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>Tool Permissions</span>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
              {toolsAllow.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {toolsAllow.map((tool) => (
                    <span key={tool} style={{ fontSize: 11, fontFamily: "monospace", padding: "3px 10px", borderRadius: 6, background: "rgba(59,130,246,0.12)", color: "var(--accent)", border: "1px solid rgba(59,130,246,0.25)" }}>
                      {tool}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle style={{ width: 13, height: 13, color: "var(--success)" }} />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                    All tools allowed (no restrictions configured)
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Gateway auth */}
        {configLoaded && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>Gateway Authentication</span>
            <div style={{ background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Lock style={{ width: 14, height: 14, color: gatewayAuth === "enabled" ? "var(--success)" : "rgba(255,255,255,0.3)" }} />
                <div>
                  <span style={{ fontSize: 12, color: "var(--text)", display: "block" }}>
                    {gatewayAuth === "enabled" ? "Authentication Enabled" : gatewayAuth === "disabled" ? "Authentication Disabled" : "Unknown"}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {gatewayAuth === "enabled"
                      ? "API requests require a valid auth token"
                      : "Gateway trusts all localhost connections"}
                  </span>
                </div>
                <span style={{
                  marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                  background: gatewayAuth === "enabled" ? "var(--success)" : gatewayAuth === "disabled" ? "var(--warning)" : "rgba(255,255,255,0.2)",
                }} />
              </div>
            </div>
          </div>
        )}

        {/* Secrets Management */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontWeight: 600, display: "block", marginBottom: 6 }}>
            SECRETS MANAGEMENT
          </span>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <KeyRound style={{ width: 16, height: 16, color: "var(--warning)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, color: "var(--text)", display: "block", fontWeight: 500 }}>Secrets Store</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Reload secrets from the secrets provider
                </span>
              </div>
              <button
                onClick={reloadSecrets}
                disabled={secretsReloading}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "6px 14px",
                  borderRadius: 8, border: "1px solid rgba(251,191,36,0.25)",
                  background: "rgba(251,191,36,0.1)", color: "var(--warning)",
                  fontSize: 11, fontWeight: 500, cursor: "pointer",
                  opacity: secretsReloading ? 0.5 : 1,
                }}
              >
                {secretsReloading ? (
                  <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                ) : (
                  <RefreshCw style={{ width: 12, height: 12 }} />
                )}
                Reload Secrets
              </button>
            </div>
            {secretsStatus && (
              <div style={{
                marginTop: 10, padding: "6px 10px", borderRadius: 6,
                background: secretsStatus.toLowerCase().includes("success") ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                border: secretsStatus.toLowerCase().includes("success") ? "1px solid rgba(74,222,128,0.15)" : "1px solid rgba(248,113,113,0.15)",
              }}>
                <span style={{
                  fontSize: 10,
                  color: secretsStatus.toLowerCase().includes("success") ? "var(--success)" : "var(--error)",
                }}>
                  {secretsStatus}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Approvals Management */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontWeight: 600, display: "block", marginBottom: 6 }}>
            APPROVALS MANAGEMENT
          </span>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <ClipboardCheck style={{ width: 16, height: 16, color: "var(--accent)", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500 }}>Tool Execution Approvals</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)", display: "block" }}>
                  Controls which tool executions require approval
                </span>
              </div>
              <button
                onClick={loadApprovals}
                disabled={approvalsLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
                  borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.5)", fontSize: 11, cursor: "pointer",
                }}
              >
                <RefreshCw style={{ width: 11, height: 11, ...(approvalsLoading ? { animation: "spin 1s linear infinite" } : {}) }} />
              </button>
            </div>
            {approvalsLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
                <Loader2 style={{ width: 16, height: 16, color: "rgba(255,255,255,0.3)", animation: "spin 1s linear infinite" }} />
              </div>
            ) : !approvals || approvals.length === 0 ? (
              <div style={{ padding: "16px 14px", textAlign: "center" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                  No approval rules configured
                </span>
              </div>
            ) : (
              approvals.map((rule, i) => {
                const name = String(rule.name ?? rule.tool ?? rule.id ?? `Rule ${i + 1}`);
                const mode = String(rule.mode ?? rule.policy ?? rule.type ?? "unknown");
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                      borderBottom: i < approvals.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "monospace", flex: 1 }}>{name}</span>
                    <span style={{
                      fontSize: 9, padding: "2px 8px", borderRadius: 8,
                      background: mode === "auto" ? "rgba(74,222,128,0.1)" : "rgba(251,191,36,0.1)",
                      color: mode === "auto" ? "var(--success)" : "var(--warning)",
                      border: mode === "auto" ? "1px solid rgba(74,222,128,0.2)" : "1px solid rgba(251,191,36,0.2)",
                      textTransform: "uppercase", fontWeight: 600, letterSpacing: 0.5,
                    }}>
                      {mode}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Memory Reindex */}
        <div style={{ marginBottom: 16 }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", color: "rgba(255,255,255,0.35)", letterSpacing: 1, fontWeight: 600, display: "block", marginBottom: 6 }}>
            MEMORY REINDEX
          </span>
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: memoryStats ? 12 : 0 }}>
              <Database style={{ width: 16, height: 16, color: "#c084fc", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 500, display: "block" }}>Memory Index</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Rebuild the memory search index
                </span>
              </div>
              <button
                onClick={loadMemoryStats}
                disabled={memoryStatsLoading}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
                  borderRadius: 6, border: "none", background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.5)", fontSize: 11, cursor: "pointer",
                }}
              >
                <RefreshCw style={{ width: 11, height: 11, ...(memoryStatsLoading ? { animation: "spin 1s linear infinite" } : {}) }} />
              </button>
              <button
                onClick={reindexMemory}
                disabled={memoryReindexing}
                style={{
                  display: "flex", alignItems: "center", gap: 4, padding: "6px 14px",
                  borderRadius: 8, border: "1px solid rgba(192,132,252,0.25)",
                  background: "rgba(192,132,252,0.1)", color: "#c084fc",
                  fontSize: 11, fontWeight: 500, cursor: "pointer",
                  opacity: memoryReindexing ? 0.5 : 1,
                }}
              >
                {memoryReindexing ? (
                  <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                ) : (
                  <Database style={{ width: 12, height: 12 }} />
                )}
                Reindex
              </button>
            </div>
            {memoryReindexStatus && (
              <div style={{
                marginBottom: memoryStats ? 10 : 0, padding: "6px 10px", borderRadius: 6,
                background: memoryReindexStatus.toLowerCase().includes("complete") ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                border: memoryReindexStatus.toLowerCase().includes("complete") ? "1px solid rgba(74,222,128,0.15)" : "1px solid rgba(248,113,113,0.15)",
              }}>
                <span style={{
                  fontSize: 10,
                  color: memoryReindexStatus.toLowerCase().includes("complete") ? "var(--success)" : "var(--error)",
                }}>
                  {memoryReindexStatus}
                </span>
              </div>
            )}
            {memoryStats && (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8,
                borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 10,
              }}>
                {Object.entries(memoryStats).map(([key, value]) => (
                  <div key={key} style={{ background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#c084fc", display: "block" }}>
                      {typeof value === "number" ? value.toLocaleString() : String(value)}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {key.replace(/[_-]/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ScoreCard({ icon: Icon, label, count, color }: { icon: React.ElementType; label: string; count: number; color: string }) {
  return (
    <div style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
      <Icon style={{ width: 18, height: 18, color, margin: "0 auto 6px", display: "block" }} />
      <span style={{ fontSize: 20, fontWeight: 700, color, display: "block" }}>{count}</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

function Badge({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${color}15`, color, border: `1px solid ${color}30` }}>
      {count} {label}
    </span>
  );
}
