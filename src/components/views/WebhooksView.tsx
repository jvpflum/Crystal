import { useState, useEffect, useCallback } from "react";
import {
  Webhook,
  Settings,
  Play,
  Mail,
  Copy,
  Loader2,
  CheckCircle2,
  Shield,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { EASE, hoverLift, hoverReset, pressDown, pressUp, innerPanel, sectionLabel, MONO } from "@/styles/viewStyles";

interface HookConfig {
  enabled: boolean;
  token: string;
  path: string;
  allowedAgentIds?: string[];
}

const DEFAULT_BASE = "http://localhost:18789";

function maskToken(token: string): string {
  if (!token || token.length < 8) return "••••••••";
  return token.slice(0, 4) + "••••" + token.slice(-4);
}

async function runCmd(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command, cwd: null });
}

export function WebhooksView() {
  const [config, setConfig] = useState<HookConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState("");
  const [path, setPath] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const [testResult, setTestResult] = useState<{ type: string; output: string; ok: boolean } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const [gmailEmail, setGmailEmail] = useState("");
  const [gmailStatus, setGmailStatus] = useState<string | null>(null);
  const [gmailLoading, setGmailLoading] = useState<string | null>(null);

  const [copied, setCopied] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await runCmd("openclaw config get hooks --json");
      if (result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const cfg: HookConfig = {
          enabled: parsed.enabled ?? false,
          token: parsed.token ?? "",
          path: parsed.path ?? "/hooks",
          allowedAgentIds: parsed.allowedAgentIds ?? parsed.allowed_agent_ids ?? [],
        };
        setConfig(cfg);
        setEnabled(cfg.enabled);
        setToken(cfg.token);
        setPath(cfg.path);
      } else {
        setConfig({ enabled: false, token: "", path: "/hooks", allowedAgentIds: [] });
        setEnabled(false);
        setToken("");
        setPath("/hooks");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load webhook config");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const toggleEnabled = async () => {
    const next = !enabled;
    setSaving("enabled");
    try {
      const result = await runCmd(`openclaw config set hooks.enabled ${next}`);
      if (result.code !== 0 && result.stderr) {
        setError(result.stderr);
      } else {
        setEnabled(next);
        showFeedback(`Webhooks ${next ? "enabled" : "disabled"}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    }
    setSaving(null);
  };

  const saveToken = async () => {
    if (!token.trim()) return;
    setSaving("token");
    try {
      const escaped = token.trim().replace(/"/g, '\\"');
      const result = await runCmd(`openclaw config set hooks.token "${escaped}"`);
      if (result.code !== 0 && result.stderr) {
        setError(result.stderr);
      } else {
        showFeedback("Token updated");
        await loadConfig();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set token");
    }
    setSaving(null);
  };

  const savePath = async () => {
    if (!path.trim()) return;
    setSaving("path");
    try {
      const escaped = path.trim().replace(/"/g, '\\"');
      const result = await runCmd(`openclaw config set hooks.path "${escaped}"`);
      if (result.code !== 0 && result.stderr) {
        setError(result.stderr);
      } else {
        showFeedback("Path updated");
        await loadConfig();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set path");
    }
    setSaving(null);
  };

  const testWebhook = async (type: "wake" | "agent") => {
    setTesting(type);
    setTestResult(null);
    const hookPath = config?.path || "/hooks";
    const url = `${DEFAULT_BASE}${hookPath}/${type}`;
    const curlCmd = `curl -s -X POST "${url}" -H "Authorization: Bearer ${config?.token || "<TOKEN>"}" -H "Content-Type: application/json" -d "{\\"message\\":\\"test from mogwai\\"}"`;

    try {
      const result = await runCmd(curlCmd);
      const output = result.stdout?.trim() || result.stderr?.trim() || "No response";
      setTestResult({ type, output, ok: result.code === 0 });
    } catch (e) {
      setTestResult({ type, output: e instanceof Error ? e.message : "Test failed", ok: false });
    }
    setTesting(null);
  };

  const gmailSetup = async () => {
    if (!gmailEmail.trim()) return;
    setGmailLoading("setup");
    try {
      const escaped = gmailEmail.trim().replace(/"/g, '\\"');
      const result = await runCmd(`openclaw webhooks gmail setup --account "${escaped}"`);
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      setGmailStatus(result.code === 0 ? output || "Setup complete" : `Error: ${output}`);
    } catch (e) {
      setGmailStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setGmailLoading(null);
  };

  const gmailRun = async () => {
    setGmailLoading("run");
    try {
      const result = await runCmd("openclaw webhooks gmail run");
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      setGmailStatus(result.code === 0 ? output || "Gmail webhook running" : `Error: ${output}`);
    } catch (e) {
      setGmailStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setGmailLoading(null);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* */ }
  };

  const hookPath = config?.path || "/hooks";
  const wakeUrl = `${DEFAULT_BASE}${hookPath}/wake`;
  const agentUrl = `${DEFAULT_BASE}${hookPath}/agent`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Webhook style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Webhooks</h2>
          {config && (
            <span style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 10,
              background: enabled ? "rgba(74,222,128,0.1)" : "var(--bg-hover)",
              color: enabled ? "var(--success)" : "var(--text-muted)",
              border: `1px solid ${enabled ? "rgba(74,222,128,0.2)" : "var(--border)"}`,
            }}>
              {enabled ? "Enabled" : "Disabled"}
            </span>
          )}
        </div>
        <button
          onClick={() => loadConfig()}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 8px",
            borderRadius: 6, border: "none", background: "var(--bg-hover)",
            color: "var(--text-muted)", fontSize: 11, cursor: "pointer",
          }}
        >
          <RefreshCw style={{ width: 12, height: 12, ...(loading ? { animation: "spin 1s linear infinite" } : {}) }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {/* Error */}
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <Shield style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Feedback */}
        {feedback && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.2)", marginBottom: 12 }}>
            <CheckCircle2 style={{ width: 14, height: 14, color: "var(--success)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--success)" }}>{feedback}</span>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
          </div>
        ) : (
          <>
            {/* Configuration Card */}
            <div style={{ marginBottom: 16 }}>
              <SectionLabel text="CONFIGURATION" />
              <div style={{ ...innerPanel, padding: "14px" }} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
                {/* Enable/Disable toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>Webhook Endpoint</span>
                    <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>Enable to accept external HTTP triggers</p>
                  </div>
                  <button
                    onClick={toggleEnabled}
                    disabled={saving === "enabled"}
                    style={{
                      width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
                      background: enabled ? "rgba(74,222,128,0.3)" : "var(--border)",
                      position: "relative", flexShrink: 0, transition: `background 0.2s ${EASE}`,
                      opacity: saving === "enabled" ? 0.5 : 1,
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: enabled ? "var(--success)" : "rgba(255,255,255,0.4)",
                      position: "absolute", top: 3,
                      left: enabled ? 21 : 3,
                      transition: `left 0.2s ${EASE}, background 0.2s ${EASE}`,
                    }} />
                  </button>
                </div>

                {/* Token */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
                    Token {config?.token && <span style={{ fontFamily: MONO, color: "var(--text-secondary)" }}>({maskToken(config.token)})</span>}
                  </label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Bearer token for authentication"
                      style={{
                        flex: 1, fontSize: 12, padding: "7px 10px", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg-hover)",
                        color: "var(--text)", outline: "none",
                      }}
                    />
                    <button
                      onClick={saveToken}
                      disabled={saving === "token" || !token.trim()}
                      style={{
                        padding: "7px 12px", borderRadius: 6, border: "none",
                        background: "var(--accent-bg)", color: "var(--accent)",
                        fontSize: 11, fontWeight: 500, cursor: "pointer",
                        opacity: saving === "token" || !token.trim() ? 0.5 : 1,
                        display: "flex", alignItems: "center", gap: 4,
                      }}
                    >
                      {saving === "token" ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Settings style={{ width: 11, height: 11 }} />}
                      Set
                    </button>
                  </div>
                </div>

                {/* Path */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Path</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="/hooks"
                      style={{
                        flex: 1, fontSize: 12, padding: "7px 10px", borderRadius: 6,
                        border: "1px solid var(--border)", background: "var(--bg-hover)",
                        color: "var(--text)", fontFamily: MONO, outline: "none",
                      }}
                    />
                    <button
                      onClick={savePath}
                      disabled={saving === "path" || !path.trim()}
                      style={{
                        padding: "7px 12px", borderRadius: 6, border: "none",
                        background: "var(--accent-bg)", color: "var(--accent)",
                        fontSize: 11, fontWeight: 500, cursor: "pointer",
                        opacity: saving === "path" || !path.trim() ? 0.5 : 1,
                        display: "flex", alignItems: "center", gap: 4,
                      }}
                    >
                      {saving === "path" ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Settings style={{ width: 11, height: 11 }} />}
                      Set
                    </button>
                  </div>
                </div>

                {/* Allowed Agent IDs */}
                {config?.allowedAgentIds && config.allowedAgentIds.length > 0 && (
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>Allowed Agent IDs</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {config.allowedAgentIds.map((id) => (
                        <span key={id} style={{
                          fontSize: 10, fontFamily: MONO, padding: "2px 8px", borderRadius: 6,
                          background: "var(--accent-bg)", color: "var(--accent)", border: "1px solid rgba(59,130,246,0.15)",
                        }}>
                          {id}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Webhook URLs */}

            <div style={{ marginBottom: 16 }}>
              <SectionLabel text="WEBHOOK URLS" />
              <div style={{ ...innerPanel, overflow: "hidden" }}>
                <UrlRow label="Wake" url={wakeUrl} copied={copied} onCopy={copyToClipboard} />
                <UrlRow label="Agent" url={agentUrl} copied={copied} onCopy={copyToClipboard} last />
              </div>
            </div>

            {/* Test Card */}
            <div style={{ marginBottom: 16 }}>
              <SectionLabel text="TEST WEBHOOKS" />
              <div style={{ ...innerPanel, padding: "14px" }} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
                <div style={{ display: "flex", gap: 8, marginBottom: testResult ? 10 : 0 }}>
                  <button
                    onClick={() => testWebhook("wake")}
                    disabled={testing !== null}
                    onMouseDown={pressDown}
                    onMouseUp={pressUp}
                    style={{
                      flex: 1, padding: "8px 14px", borderRadius: 8, border: "none",
                      background: "rgba(74,222,128,0.1)", color: "var(--success)",
                      fontSize: 11, fontWeight: 500, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      opacity: testing !== null ? 0.6 : 1,
                    }}
                  >
                    {testing === "wake" ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                    Test Wake
                  </button>
                  <button
                    onClick={() => testWebhook("agent")}
                    disabled={testing !== null}
                    onMouseDown={pressDown}
                    onMouseUp={pressUp}
                    style={{
                      flex: 1, padding: "8px 14px", borderRadius: 8, border: "none",
                      background: "var(--accent-bg)", color: "var(--accent)",
                      fontSize: 11, fontWeight: 500, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      opacity: testing !== null ? 0.6 : 1,
                    }}
                  >
                    {testing === "agent" ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                    Test Agent
                  </button>
                </div>

                {testResult && (
                  <div style={{
                    padding: "8px 10px", borderRadius: 6, fontSize: 10, fontFamily: MONO,
                    background: testResult.ok ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                    border: `1px solid ${testResult.ok ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                    color: testResult.ok ? "var(--success)" : "var(--error)",
                    maxHeight: 100, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    <span style={{ fontSize: 9, textTransform: "uppercase", opacity: 0.7 }}>{testResult.type} response:</span>
                    <br />
                    {testResult.output}
                  </div>
                )}
              </div>
            </div>

            {/* Gmail Integration Card */}
            <div style={{ marginBottom: 16 }}>
              <SectionLabel text="GMAIL INTEGRATION" />
              <div style={{ ...innerPanel, padding: "14px" }} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <input
                    value={gmailEmail}
                    onChange={(e) => setGmailEmail(e.target.value)}
                    placeholder="your-email@gmail.com"
                    onKeyDown={(e) => e.key === "Enter" && gmailSetup()}
                    style={{
                      flex: 1, fontSize: 12, padding: "7px 10px", borderRadius: 6,
                      border: "1px solid var(--border)", background: "var(--bg-hover)",
                      color: "var(--text)", outline: "none",
                    }}
                  />
                  <button
                    onClick={gmailSetup}
                    disabled={gmailLoading !== null || !gmailEmail.trim()}
                    style={{
                      padding: "7px 14px", borderRadius: 6, border: "none",
                      background: "rgba(168,85,247,0.12)", color: "#c084fc",
                      fontSize: 11, fontWeight: 500, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 5,
                      opacity: gmailLoading !== null || !gmailEmail.trim() ? 0.5 : 1,
                    }}
                  >
                    {gmailLoading === "setup" ? <Loader2 style={{ width: 11, height: 11, animation: "spin 1s linear infinite" }} /> : <Mail style={{ width: 11, height: 11 }} />}
                    Setup
                  </button>
                </div>
                <button
                  onClick={gmailRun}
                  disabled={gmailLoading !== null}
                  style={{
                    width: "100%", padding: "8px 14px", borderRadius: 8, border: "none",
                    background: "rgba(74,222,128,0.1)", color: "var(--success)",
                    fontSize: 11, fontWeight: 500, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    opacity: gmailLoading !== null ? 0.6 : 1,
                  }}
                >
                  {gmailLoading === "run" ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Play style={{ width: 12, height: 12 }} />}
                  Run Gmail Webhook
                </button>

                {gmailStatus && (
                  <div style={{
                    marginTop: 10, padding: "8px 10px", borderRadius: 6, fontSize: 10, fontFamily: MONO,
                    background: gmailStatus.startsWith("Error") ? "rgba(248,113,113,0.08)" : "rgba(74,222,128,0.08)",
                    border: `1px solid ${gmailStatus.startsWith("Error") ? "rgba(248,113,113,0.2)" : "rgba(74,222,128,0.2)"}`,
                    color: gmailStatus.startsWith("Error") ? "var(--error)" : "var(--success)",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {gmailStatus}
                  </div>
                )}
              </div>
            </div>

            {/* Docs */}
            <div>
              <SectionLabel text="DOCUMENTATION" />
              <div style={{ ...innerPanel, padding: "12px 14px" }}>
                <a
                  href="https://docs.openclaw.ai/webhooks"
                  target="_blank"
                  rel="noopener"
                  style={{ fontSize: 11, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
                >
                  <ExternalLink style={{ width: 12, height: 12 }} />
                  OpenClaw Webhooks documentation
                </a>
              </div>
            </div>
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <span style={{ ...sectionLabel, display: "block", marginBottom: 8 }}>
      {text}
    </span>
  );
}

function UrlRow({ label, url, copied, onCopy, last }: {
  label: string;
  url: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
  last?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
      borderBottom: last ? "none" : "1px solid var(--border)",
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-muted)", width: 44, textTransform: "uppercase" }}>{label}</span>
      <code style={{ flex: 1, fontSize: 11, color: "var(--text-secondary)", fontFamily: MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {url}
      </code>
      <button
        onClick={() => onCopy(url, label)}
        style={{
          background: "none", border: "none", cursor: "pointer", padding: 4,
          color: copied === label ? "var(--success)" : "var(--text-muted)",
          display: "flex", alignItems: "center",
        }}
      >
        {copied === label ? <CheckCircle2 style={{ width: 13, height: 13 }} /> : <Copy style={{ width: 13, height: 13 }} />}
      </button>
    </div>
  );
}
