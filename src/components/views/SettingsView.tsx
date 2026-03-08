import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { cachedCommand } from "@/lib/cache";
import { useOpenClaw } from "@/hooks/useOpenClaw";
import { useVoice } from "@/hooks/useVoice";
import { InferenceBackend, openclawClient } from "@/lib/openclaw";
import { useAppStore } from "@/stores/appStore";
import { useThemeStore, THEMES } from "@/stores/themeStore";
import { LobsterIcon } from "@/components/LobsterIcon";

/* ── Keyframes (no className allowed, inject once) ── */

const KEYFRAMES = `
@keyframes _spin { to { transform: rotate(360deg) } }
@keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
`;

/* ── Shared style tokens ── */

const SECTION_HEADER: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 1,
  color: "var(--text-muted)",
  marginBottom: 8,
  userSelect: "none",
};

const CARD: CSSProperties = {
  background: "var(--bg-elevated)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  overflow: "hidden",
};

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid var(--border)",
};

const LABEL: CSSProperties = { fontSize: 12, color: "var(--text-secondary)" };
const VALUE: CSSProperties = { fontSize: 12, color: "var(--text)" };
const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const BTN_BASE: CSSProperties = {
  padding: "6px 14px",
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  border: "none",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "opacity .15s",
};

const BTN_PRIMARY: CSSProperties = { ...BTN_BASE, background: "var(--accent-bg)", color: "var(--accent)" };
const BTN_GHOST: CSSProperties = { ...BTN_BASE, background: "transparent", color: "var(--text-muted)" };

const INPUT: CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "6px 10px",
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  ...MONO,
};

const dot = (color: string): CSSProperties => ({
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: color,
  flexShrink: 0,
});

/* ── Inline SVG helpers (no lucide dep / no className needed) ── */

function IconRefresh({ spin }: { spin?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={spin ? { animation: "_spin .8s linear infinite" } : undefined}>
      <path d="M21.5 2v6h-6M2.5 22v-6h6" /><path d="M2.5 11.5a10 10 0 0 1 18.37-4.5M21.5 12.5a10 10 0 0 1-18.37 4.5" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function IconEye({ open }: { open: boolean }) {
  if (open) return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" />
    </svg>
  );
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/* ── Main component ── */

export function SettingsView() {
  const {
    backend, setBackend, isConnected, checkConnection,
    getModel, setModel, getModels,
  } = useOpenClaw();
  const {
    isWhisperConnected, isTTSConnected, checkConnections,
  } = useVoice();
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const { themeId, setTheme } = useThemeStore();

  /* ── local state ── */
  const [checking, setChecking] = useState(false);
  const [checkingVoice, setCheckingVoice] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [gatewayPort] = useState("18789");
  const [gatewayLatency, setGatewayLatency] = useState<number | null>(null);

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState("4096");
  const [contextWindow, setContextWindow] = useState("32768");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are Crystal, an intelligent AI assistant powered by OpenClaw."
  );

  const [auditResult, setAuditResult] = useState<{
    pass: number; warn: number; fail: number; details?: string;
  } | null>(null);
  const [auditing, setAuditing] = useState(false);

  const [appVersion] = useState("0.1.0");
  const [openclawVersion, setOpenclawVersion] = useState("...");
  const [updateChannel, setUpdateChannel] = useState<"stable" | "beta" | "dev">("stable");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const [configText, setConfigText] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [configPath] = useState("~/.openclaw/openclaw.json");

  const [whisperModel, setWhisperModel] = useState("base.en");

  const [daemonInstalled, setDaemonInstalled] = useState(false);
  const [daemonBusy, setDaemonBusy] = useState(false);
  const [daemonOutput, setDaemonOutput] = useState("");

  const [configKey, setConfigKey] = useState("");
  const [configValue, setConfigValue] = useState("");
  const [configOutput, setConfigOutput] = useState("");

  const dropdownRef = useRef<HTMLDivElement>(null);

  /* ── effects ── */

  useEffect(() => {
    checkConnection();
    checkConnections();
    loadConfig();
    loadOpenClawVersion();
    measureLatency();
    checkDaemonStatus();
    homeDir().then(home => {
      const sep = home.endsWith("\\") || home.endsWith("/") ? "" : "\\";
      const configPath = `${home}${sep}.openclaw\\openclaw.json`;
      invoke<string>("read_file", { path: configPath }).then(raw => {
        try {
          const cfg = JSON.parse(raw);
          const t = cfg?.gateway?.auth?.token;
          if (t && typeof t === "string") setAuthToken(t);
        } catch { /* malformed config */ }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isConnected) getModels().then(setAvailableModels);
  }, [isConnected, getModels]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setShowModelPicker(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── helpers ── */

  const measureLatency = async () => {
    try {
      const start = performance.now();
      await invoke<{ openclaw_running: boolean }>("get_server_status");
      setGatewayLatency(Math.round(performance.now() - start));
    } catch {
      setGatewayLatency(null);
    }
  };

  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const cfg = await openclawClient.getConfig();
      setConfigText(JSON.stringify(cfg, null, 2));
      if (cfg.systemPrompt) setSystemPrompt(cfg.systemPrompt);
      if (cfg.contextLength) setContextWindow(String(cfg.contextLength));
    } catch {
      setConfigText("{}");
    }
    setLoadingConfig(false);
  };

  const saveConfig = async () => {
    try {
      const cfg = JSON.parse(configText);
      await openclawClient.updateConfig(cfg);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch { /* invalid json */ }
  };

  const loadOpenClawVersion = async () => {
    try {
      const result = await cachedCommand("npx openclaw --version", { ttl: 300_000 });
      if (result.code === 0) setOpenclawVersion(result.stdout.trim());
    } catch {
      setOpenclawVersion("unknown");
    }
  };

  const handleBackendChange = async (b: InferenceBackend) => {
    setBackend(b);
    setChecking(true);
    await checkConnection();
    setChecking(false);
  };

  const handleRefreshLLM = async () => {
    setChecking(true);
    await checkConnection();
    if (isConnected) setAvailableModels(await getModels());
    setChecking(false);
  };

  const handleRefreshVoice = async () => {
    setCheckingVoice(true);
    await checkConnections();
    setCheckingVoice(false);
  };

  const handleStartGateway = async () => {
    await openclawClient.startDaemon();
    await measureLatency();
  };

  const runAudit = async () => {
    setAuditing(true);
    setAuditResult(null);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "npx openclaw security audit --json",
        cwd: null,
      });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setAuditResult({
          pass: data.pass ?? 0,
          warn: data.warn ?? 0,
          fail: data.fail ?? 0,
          details: result.stdout.trim(),
        });
      } else {
        setAuditResult({ pass: 0, warn: 0, fail: 1, details: result.stdout });
      }
    } catch {
      setAuditResult({ pass: 0, warn: 0, fail: 1, details: "Audit command failed" });
    }
    setAuditing(false);
  };

  const checkForUpdates = async () => {
    setCheckingUpdates(true);
    setUpdateStatus(null);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "npx openclaw update status --json",
        cwd: null,
      });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setUpdateStatus(
          data.updateAvailable
            ? `Update available: v${data.latestVersion}`
            : "You're on the latest version"
        );
      } else {
        setUpdateStatus("Could not check for updates");
      }
    } catch {
      setUpdateStatus("Could not check for updates");
    }
    setCheckingUpdates(false);
  };

  const saveAISettings = async () => {
    await openclawClient.updateConfig({
      systemPrompt,
      contextLength: parseInt(contextWindow) || 32768,
    });
  };

  const checkDaemonStatus = async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "npx openclaw daemon status", cwd: null,
      });
      setDaemonInstalled(result.code === 0 && !result.stdout.includes("not installed"));
    } catch { setDaemonInstalled(false); }
  };

  const runDaemonCmd = async (cmd: string) => {
    setDaemonBusy(true);
    setDaemonOutput("");
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `npx openclaw daemon ${cmd}`, cwd: null,
      });
      setDaemonOutput(result.stdout || result.stderr);
      await checkDaemonStatus();
    } catch (e) {
      setDaemonOutput(e instanceof Error ? e.message : "Command failed");
    }
    setDaemonBusy(false);
  };

  const installDaemon = () => runDaemonCmd("install");
  const uninstallDaemon = () => runDaemonCmd("uninstall");
  const restartDaemon = () => runDaemonCmd("restart");
  const stopDaemon = () => runDaemonCmd("stop");

  const getConfigValue = async () => {
    if (!configKey.trim()) return;
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `npx openclaw config get ${configKey.trim()}`, cwd: null,
      });
      setConfigOutput(result.stdout.trim());
    } catch { setConfigOutput("Failed to get config value"); }
  };

  const setConfigValue_ = async () => {
    if (!configKey.trim() || !configValue.trim()) return;
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `npx openclaw config set ${configKey.trim()} ${configValue.trim()}`, cwd: null,
      });
      setConfigOutput(result.stdout.trim() || "Value set");
    } catch { setConfigOutput("Failed to set config value"); }
  };

  const unsetConfigValue = async () => {
    if (!configKey.trim()) return;
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `npx openclaw config unset ${configKey.trim()}`, cwd: null,
      });
      setConfigOutput(result.stdout.trim() || "Value unset");
    } catch { setConfigOutput("Failed to unset config value"); }
  };

  /* ── render ── */

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>

      {/* Header */}
      <div style={{ padding: "18px 24px 8px", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          Settings
        </h2>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Crystal &middot; OpenClaw frontend configuration
        </p>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "4px 24px 28px" }}>

        {/* ───────── THEME ───────── */}
        <Section title="THEME">
          <div style={CARD}>
            <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {THEMES.map((theme) => {
                const active = themeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    style={{
                      padding: 0, border: active ? "2px solid var(--accent)" : "2px solid var(--border)",
                      borderRadius: 10, cursor: "pointer", background: "transparent",
                      transition: "all 0.2s", overflow: "hidden",
                      transform: active ? "scale(1.02)" : "scale(1)",
                      boxShadow: active ? "0 0 12px var(--accent-bg)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", height: 32 }}>
                      {theme.preview.map((color, i) => (
                        <div key={i} style={{ flex: 1, background: color }} />
                      ))}
                    </div>
                    <div style={{
                      padding: "6px 8px",
                      background: active ? "var(--accent-bg)" : "var(--bg-elevated)",
                      textAlign: "center",
                    }}>
                      <div style={{
                        fontSize: 10, fontWeight: 600,
                        color: active ? "var(--accent)" : "var(--text-secondary)",
                      }}>
                        {theme.name}
                      </div>
                      <div style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 1 }}>
                        {theme.description}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        {/* ───────── GATEWAY ───────── */}
        <Section title="GATEWAY">
          <div style={CARD}>
            {/* status row */}
            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={dot(gatewayConnected ? "var(--success)" : "var(--error)")} />
                <span style={LABEL}>Gateway</span>
              </div>
              <span style={{ ...VALUE, color: gatewayConnected ? "var(--success)" : "var(--error)" }}>
                {gatewayConnected ? "Connected" : "Offline"}
              </span>
            </div>

            {/* mode */}
            <div style={ROW}>
              <span style={LABEL}>Mode</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11, color: "var(--text-muted)" }}>
                local
              </span>
            </div>

            {/* port */}
            <div style={ROW}>
              <span style={LABEL}>Port</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{gatewayPort}</span>
            </div>

            {/* latency */}
            <div style={ROW}>
              <span style={LABEL}>Latency</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11, color: gatewayLatency !== null && gatewayLatency < 100 ? "var(--success)" : "var(--warning)" }}>
                {gatewayLatency !== null ? `${gatewayLatency}ms` : "—"}
              </span>
            </div>

            {/* auth token */}
            <div style={{ ...ROW, borderBottom: "none", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={LABEL}>Gateway Token</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                  Use this to connect Chrome, dashboards, etc.
                </span>
              </div>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "var(--bg-elevated)", borderRadius: 8, padding: "6px 10px",
                border: "1px solid var(--border)",
              }}>
                <code style={{
                  flex: 1, fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
                  color: authToken ? "var(--text-secondary)" : "var(--text-muted)",
                  letterSpacing: 0.5, wordBreak: "break-all", lineHeight: 1.4,
                  userSelect: showAuthToken ? "text" : "none",
                }}>
                  {authToken
                    ? showAuthToken
                      ? authToken
                      : "••••••••••••••••••••••••••••••••"
                    : "No token found"}
                </code>
                <button
                  onClick={() => setShowAuthToken(!showAuthToken)}
                  title={showAuthToken ? "Hide token" : "Show token"}
                  style={{ ...BTN_GHOST, padding: 4, color: "var(--text-muted)", flexShrink: 0 }}
                >
                  <IconEye open={showAuthToken} />
                </button>
                <button
                  onClick={() => {
                    if (authToken) {
                      navigator.clipboard.writeText(authToken);
                      setTokenCopied(true);
                      setTimeout(() => setTokenCopied(false), 2000);
                    }
                  }}
                  title="Copy token"
                  style={{
                    ...BTN_GHOST, padding: 4, flexShrink: 0,
                    color: tokenCopied ? "var(--success)" : "var(--text-muted)",
                    transition: "color 0.2s",
                  }}
                >
                  {tokenCopied ? <IconCheck /> : <IconCopy />}
                </button>
              </div>
            </div>

            {/* start / restart */}
            <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8 }}>
              <button onClick={handleStartGateway} style={BTN_PRIMARY}>
                <IconRefresh /> {gatewayConnected ? "Restart Gateway" : "Start Gateway"}
              </button>
              <button
                onClick={measureLatency}
                style={{ ...BTN_GHOST, fontSize: 11 }}
              >
                Ping
              </button>
            </div>
          </div>
        </Section>

        {/* ───────── LLM BACKEND ───────── */}
        <Section title="LLM BACKEND">
          <div style={CARD}>
            {/* segmented control */}
            <div style={{ padding: "10px 14px 6px", display: "flex", gap: 6 }}>
              {(["ollama", "lmstudio"] as InferenceBackend[]).map((b) => {
                const selected = backend === b;
                const label = b === "ollama" ? "Ollama" : "LM Studio";
                return (
                  <button
                    key={b}
                    onClick={() => handleBackendChange(b)}
                    style={{
                      flex: 1,
                      padding: "8px 0",
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      color: selected ? "var(--text)" : "var(--text-muted)",
                      background: selected ? "var(--accent-bg)" : "var(--bg-elevated)",
                      border: selected
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
                      transition: "all .15s ease",
                    }}
                  >
                    {checking && selected ? (
                      <IconRefresh spin />
                    ) : selected && isConnected ? (
                      <span style={{ color: "var(--success)" }}><IconCheck /></span>
                    ) : selected ? (
                      <span style={dot("var(--error)")} />
                    ) : null}
                    {label}
                  </button>
                );
              })}
            </div>

            {/* base url */}
            <div style={ROW}>
              <span style={LABEL}>Base URL</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11, color: "var(--text-muted)" }}>
                {openclawClient.getBaseUrl()}
              </span>
            </div>

            {/* model selector */}
            <div style={{ ...ROW, position: "relative" }} ref={dropdownRef}>
              <span style={LABEL}>Model</span>
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  ...MONO,
                  fontSize: 11,
                  color: "var(--text)",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "5px 10px",
                  cursor: "pointer",
                }}
              >
                {getModel()} <IconChevron />
              </button>

              {showModelPicker && availableModels.length > 0 && (
                <div style={{
                  position: "absolute",
                  right: 14,
                  top: "100%",
                  marginTop: 2,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  overflow: "hidden",
                  zIndex: 100,
                  minWidth: 200,
                  maxHeight: 220,
                  overflowY: "auto",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
                  backdropFilter: "blur(20px)",
                }}>
                  {availableModels.map((m) => {
                    const active = m === getModel();
                    const sizeMatch = m.match(/:(\d+)b/i);
                    const sizeB = sizeMatch ? parseInt(sizeMatch[1]) : null;
                    const speedTag = sizeB
                      ? sizeB <= 8 ? { label: "Blazing", color: "#4ade80" }
                      : sizeB <= 14 ? { label: "Fast", color: "#60a5fa" }
                      : sizeB <= 32 ? { label: "Balanced", color: "#fbbf24" }
                      : { label: "Slow", color: "#f87171" }
                      : null;
                    return (
                      <button
                        key={m}
                        onClick={() => { setModel(m); setShowModelPicker(false); }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          width: "100%",
                          padding: "8px 12px",
                          fontSize: 11,
                          ...MONO,
                          color: active ? "var(--accent)" : "var(--text-secondary)",
                          background: active ? "var(--accent-bg)" : "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {active && <IconCheck />}
                        <span style={{ marginLeft: active ? 0 : 18, flex: 1 }}>{m}</span>
                        {speedTag && (
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 4,
                            background: `${speedTag.color}22`, color: speedTag.color,
                            fontFamily: "system-ui", fontWeight: 600,
                          }}>{speedTag.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* connection status */}
            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {checking ? (
                  <span style={{ animation: "_spin .8s linear infinite", display: "inline-flex" }}>
                    <IconRefresh />
                  </span>
                ) : (
                  <span style={dot(isConnected ? "var(--success)" : "var(--error)")} />
                )}
                <span style={{ fontSize: 11, color: isConnected ? "var(--success)" : "var(--error)" }}>
                  {checking ? "Checking..." : isConnected ? `Connected to ${backend}` : `${backend} offline`}
                </span>
              </div>
              <button onClick={handleRefreshLLM} style={{ ...BTN_PRIMARY, padding: "4px 10px" }}>
                <IconRefresh spin={checking} /> Test
              </button>
            </div>

            {/* context window */}
            <div style={{ ...ROW, borderBottom: "none" }}>
              <span style={LABEL}>Context Window</span>
              <input
                type="text"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                onBlur={saveAISettings}
                style={{ ...INPUT, width: 80, textAlign: "right" }}
              />
            </div>
          </div>
        </Section>

        {/* ───────── VOICE ───────── */}
        <Section title="VOICE">
          <div style={CARD}>
            {/* Whisper STT */}
            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    ...dot(isWhisperConnected ? "var(--success)" : "var(--text-muted)"),
                  }}
                />
                <div>
                  <span style={{ ...LABEL, display: "block" }}>Whisper STT</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>
                    localhost:8080
                  </span>
                </div>
              </div>
              <span style={{ fontSize: 10, color: isWhisperConnected ? "var(--success)" : "var(--text-muted)" }}>
                {isWhisperConnected ? "Connected" : "Offline (using browser voice)"}
              </span>
            </div>

            {/* TTS */}
            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    ...dot(isTTSConnected ? "var(--success)" : "var(--text-muted)"),
                  }}
                />
                <div>
                  <span style={{ ...LABEL, display: "block" }}>TTS Engine</span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>
                    localhost:8081
                  </span>
                </div>
              </div>
              <span style={{ fontSize: 10, color: isTTSConnected ? "var(--success)" : "var(--text-muted)" }}>
                {isTTSConnected ? "Connected" : "Offline (using browser TTS)"}
              </span>
            </div>

            {/* Whisper model */}
            <div style={ROW}>
              <span style={LABEL}>Whisper Model</span>
              <select
                value={whisperModel}
                onChange={(e) => setWhisperModel(e.target.value)}
                style={{
                  ...INPUT,
                  appearance: "none",
                  paddingRight: 24,
                  backgroundImage:
                    `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 8px center",
                }}
              >
                {["tiny.en", "base.en", "small.en", "medium.en", "large-v3"].map((m) => (
                  <option key={m} value={m} style={{ background: "var(--bg-elevated)", color: "var(--text)" }}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* test buttons */}
            <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
              <button onClick={handleRefreshVoice} style={BTN_PRIMARY}>
                <IconRefresh spin={checkingVoice} /> Test Connections
              </button>
            </div>
          </div>
        </Section>

        {/* ───────── AI CONFIGURATION ───────── */}
        <Section title="AI CONFIGURATION">
          <div style={CARD}>
            {/* temperature */}
            <div style={ROW}>
              <span style={LABEL}>Temperature</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  style={{
                    width: 100,
                    height: 4,
                    accentColor: "var(--accent)",
                    cursor: "pointer",
                  }}
                />
                <span style={{ ...VALUE, ...MONO, fontSize: 11, minWidth: 28, textAlign: "right" }}>
                  {temperature.toFixed(2)}
                </span>
              </div>
            </div>

            {/* max tokens */}
            <div style={ROW}>
              <span style={LABEL}>Max Tokens</span>
              <input
                type="text"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                style={{ ...INPUT, width: 80, textAlign: "right" }}
              />
            </div>

            {/* system prompt */}
            <div style={{ padding: "10px 14px", borderBottom: "none" }}>
              <span style={{ ...LABEL, display: "block", marginBottom: 6 }}>System Prompt</span>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={saveAISettings}
                spellCheck={false}
                rows={5}
                style={{
                  width: "100%",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "8px 10px",
                  color: "var(--text-secondary)",
                  fontSize: 11,
                  lineHeight: 1.6,
                  resize: "vertical",
                  outline: "none",
                  ...MONO,
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        </Section>

        {/* ───────── SECURITY ───────── */}
        <Section title="SECURITY">
          <div style={CARD}>
            {/* audit button */}
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ ...LABEL, display: "block" }}>Security Audit</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Run OpenClaw security checks
                </span>
              </div>
              <button onClick={runAudit} disabled={auditing} style={BTN_PRIMARY}>
                {auditing ? <IconRefresh spin /> : null}
                {auditing ? "Auditing..." : "Run Audit"}
              </button>
            </div>

            {/* audit results */}
            {auditResult && (
              <div style={{ padding: "0 14px 10px" }}>
                <div style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 12px",
                  background: "var(--bg-elevated)",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                }}>
                  <AuditBadge label="PASS" count={auditResult.pass} color="var(--success)" />
                  <AuditBadge label="WARN" count={auditResult.warn} color="var(--warning)" />
                  <AuditBadge label="FAIL" count={auditResult.fail} color="var(--error)" />
                </div>
                {auditResult.details && (
                  <pre style={{
                    marginTop: 6,
                    fontSize: 10,
                    ...MONO,
                    color: "var(--text-muted)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 120,
                    overflowY: "auto",
                  }}>
                    {auditResult.details}
                  </pre>
                )}
              </div>
            )}

            {/* tool permissions */}
            <div style={ROW}>
              <span style={LABEL}>Tool Permissions</span>
              <span style={{ fontSize: 11, color: "var(--success)" }}>All Enabled</span>
            </div>
            <div style={{ ...ROW, borderBottom: "none" }}>
              <span style={LABEL}>Gateway Auth</span>
              <span style={{ fontSize: 11, color: authToken ? "var(--success)" : "var(--text-muted)" }}>
                {authToken ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </Section>

        {/* ───────── UPDATES ───────── */}
        <Section title="UPDATES">
          <div style={CARD}>
            {/* current version */}
            <div style={ROW}>
              <span style={LABEL}>Crystal Version</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>v{appVersion}</span>
            </div>

            {/* update channel */}
            <div style={ROW}>
              <span style={LABEL}>Update Channel</span>
              <div style={{ display: "flex", gap: 4 }}>
                {(["stable", "beta", "dev"] as const).map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setUpdateChannel(ch)}
                    style={{
                      padding: "3px 10px",
                      borderRadius: 5,
                      fontSize: 10,
                      fontWeight: 500,
                      cursor: "pointer",
                      textTransform: "capitalize",
                      border: updateChannel === ch
                        ? "1px solid var(--accent)"
                        : "1px solid var(--border)",
                      background: updateChannel === ch
                        ? "var(--accent-bg)"
                        : "var(--bg-elevated)",
                      color: updateChannel === ch ? "var(--accent)" : "var(--text-muted)",
                      transition: "all .15s ease",
                    }}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            {/* check for updates */}
            <div style={{ padding: "8px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)" }}>
              {updateStatus && (
                <span style={{ fontSize: 11, color: updateStatus.includes("available") ? "var(--warning)" : "var(--success)" }}>
                  {updateStatus}
                </span>
              )}
              {!updateStatus && <span />}
              <button onClick={checkForUpdates} disabled={checkingUpdates} style={BTN_PRIMARY}>
                {checkingUpdates ? <IconRefresh spin /> : null}
                {checkingUpdates ? "Checking..." : "Check for Updates"}
              </button>
            </div>
          </div>
        </Section>

        {/* ───────── OPENCLAW CONFIG ───────── */}
        <Section title="OPENCLAW CONFIG">
          <div style={CARD}>
            {/* config path */}
            <div style={{ ...ROW, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>
                  {configPath}
                </span>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(configPath); }}
                style={{ ...BTN_GHOST, padding: 4, color: "var(--text-muted)" }}
              >
                <IconCopy />
              </button>
            </div>

            {/* editor */}
            <div style={{ padding: "10px 14px" }}>
              <textarea
                value={configText}
                onChange={(e) => setConfigText(e.target.value)}
                spellCheck={false}
                style={{
                  width: "100%",
                  minHeight: 160,
                  maxHeight: 300,
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: "10px 12px",
                  color: "var(--text-secondary)",
                  fontSize: 11,
                  lineHeight: 1.7,
                  resize: "vertical",
                  outline: "none",
                  ...MONO,
                  boxSizing: "border-box",
                  tabSize: 2,
                }}
              />
            </div>

            {/* actions */}
            <div style={{ padding: "0 14px 10px", display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={loadConfig} disabled={loadingConfig} style={BTN_GHOST}>
                <IconRefresh spin={loadingConfig} /> Reload
              </button>
              <button onClick={saveConfig} style={BTN_PRIMARY}>
                {configSaved ? <IconCheck /> : null}
                {configSaved ? "Saved" : "Save"}
              </button>
            </div>
          </div>
        </Section>

        {/* ───────── GATEWAY SERVICE ───────── */}
        <Section title="GATEWAY SERVICE">
          <div style={CARD}>
            <div style={ROW}>
              <span style={LABEL}>Daemon Status</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: daemonInstalled ? "var(--success)" : "var(--error)",
                  flexShrink: 0,
                }} />
                <span style={{ ...VALUE, fontSize: 11, color: daemonInstalled ? "var(--success)" : "var(--error)" }}>
                  {daemonInstalled ? "Installed" : "Not Installed"}
                </span>
              </div>
            </div>
            <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={installDaemon} disabled={daemonBusy} style={BTN_PRIMARY}>
                {daemonBusy ? <IconRefresh spin /> : null} Install
              </button>
              <button onClick={uninstallDaemon} disabled={daemonBusy} style={{ ...BTN_GHOST, color: "var(--error)" }}>
                Uninstall
              </button>
              <button onClick={restartDaemon} disabled={daemonBusy} style={BTN_PRIMARY}>
                Restart
              </button>
              <button onClick={stopDaemon} disabled={daemonBusy} style={BTN_GHOST}>
                Stop
              </button>
            </div>
            {daemonOutput && (
              <pre style={{
                margin: 0, padding: "8px 14px", fontSize: 10, ...MONO,
                color: "var(--text-muted)", whiteSpace: "pre-wrap",
                maxHeight: 80, overflowY: "auto",
                borderTop: "1px solid var(--border)",
              }}>
                {daemonOutput}
              </pre>
            )}
          </div>
        </Section>

        {/* ───────── CONFIG CLI ───────── */}
        <Section title="CONFIG CLI">
          <div style={CARD}>
            <div style={{ padding: "10px 14px" }}>
              <span style={{ ...LABEL, display: "block", marginBottom: 6 }}>Get / Set Configuration</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={configKey}
                  onChange={(e) => setConfigKey(e.target.value)}
                  placeholder="config.key"
                  style={{ ...INPUT, flex: 1 }}
                />
                <button onClick={getConfigValue} style={BTN_PRIMARY}>Get</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input
                  type="text"
                  value={configValue}
                  onChange={(e) => setConfigValue(e.target.value)}
                  placeholder="new value"
                  style={{ ...INPUT, flex: 1 }}
                />
                <button onClick={setConfigValue_} style={BTN_PRIMARY}>Set</button>
                <button onClick={unsetConfigValue} style={{ ...BTN_GHOST, color: "var(--error)" }}>Unset</button>
              </div>
            </div>
            {configOutput && (
              <pre style={{
                margin: 0, padding: "8px 14px", fontSize: 10, ...MONO,
                color: "var(--text-muted)", whiteSpace: "pre-wrap",
                maxHeight: 80, overflowY: "auto",
                borderTop: "1px solid var(--border)",
              }}>
                {configOutput}
              </pre>
            )}
          </div>
        </Section>

        {/* ───────── ABOUT ───────── */}
        <Section title="ABOUT">
          <div style={CARD}>
            {/* app info */}
            <div style={{ ...ROW, gap: 12, borderBottom: "1px solid var(--border)" }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, overflow: "hidden", flexShrink: 0,
              }}>
                <LobsterIcon size={36} />
              </div>
              <div style={{ flex: 1 }}>
                <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 600, display: "block" }}>
                  Crystal
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  The OpenClaw Desktop Frontend
                </span>
              </div>
            </div>

            <div style={ROW}>
              <span style={LABEL}>App Version</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>v{appVersion}</span>
            </div>

            <div style={ROW}>
              <span style={LABEL}>OpenClaw Version</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{openclawVersion}</span>
            </div>

            <div style={ROW}>
              <span style={LABEL}>Runtime</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>Tauri 2</span>
            </div>

            {/* links */}
            <div style={{ padding: "10px 14px 12px", display: "flex", gap: 12, borderTop: "1px solid var(--border)" }}>
              <a
                href="https://docs.openclaw.ai"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...BTN_PRIMARY, textDecoration: "none" }}
              >
                <IconExternal /> Docs
              </a>
              <a
                href="https://github.com/openclaw"
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...BTN_GHOST, textDecoration: "none" }}
              >
                <IconExternal /> GitHub
              </a>
            </div>
          </div>
        </Section>

        {/* bottom spacer */}
        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={SECTION_HEADER}>{title}</div>
      {children}
    </div>
  );
}

function AuditBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
      }} />
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{count}</span>
      <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </span>
    </div>
  );
}
