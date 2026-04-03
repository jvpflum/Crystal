import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { cachedCommand } from "@/lib/cache";
import { useOpenClaw } from "@/hooks/useOpenClaw";
import { useVoice } from "@/hooks/useVoice";
import { openclawClient } from "@/lib/openclaw";
import { useAppStore, type ThinkingLevel } from "@/stores/appStore";
import { useThemeStore, THEMES } from "@/stores/themeStore";
import { LobsterIcon } from "@/components/LobsterIcon";

/* ── Keyframes ── */

const KEYFRAMES = `
@keyframes _spin { to { transform: rotate(360deg) } }
@keyframes _pulse { 0%,100% { opacity:1 } 50% { opacity:.4 } }
`;

/* ── Shared style tokens ── */

const SECTION_HEADER: CSSProperties = {
  fontSize: 10, fontWeight: 600, textTransform: "uppercase",
  letterSpacing: 1, color: "var(--text-muted)", marginBottom: 8, userSelect: "none",
};

const CARD: CSSProperties = {
  background: "var(--bg-elevated)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
};

const ROW: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 14px", borderBottom: "1px solid var(--border)",
};

const LABEL: CSSProperties = { fontSize: 12, color: "var(--text-secondary)" };
const VALUE: CSSProperties = { fontSize: 12, color: "var(--text)" };
const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const BTN_BASE: CSSProperties = {
  padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500,
  border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, transition: "opacity .15s",
};
const BTN_PRIMARY: CSSProperties = { ...BTN_BASE, background: "var(--accent-bg)", color: "var(--accent)" };
const BTN_GHOST: CSSProperties = { ...BTN_BASE, background: "transparent", color: "var(--text-muted)" };

const INPUT: CSSProperties = {
  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6,
  padding: "6px 10px", color: "var(--text)", fontSize: 12, outline: "none", ...MONO,
};

const dot = (color: string): CSSProperties => ({
  width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0,
});

const VOICE_PROVIDER_META: Record<string, { label: string; port?: string }> = {
  "nvidia-nemotron": { label: "NVIDIA Nemotron/Parakeet", port: "8090" },
  "whisper":         { label: "Whisper STT", port: "8080" },
  "browser-stt":     { label: "Browser Speech API" },
  "nvidia-magpie":   { label: "NVIDIA Magpie TTS", port: "8091" },
  "kokoro":          { label: "Kokoro TTS", port: "8081" },
  "browser-tts":     { label: "Browser TTS" },
};

/* ── SVG helpers ── */

function IconRefresh({ spin }: { spin?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={spin ? { animation: "_spin .8s linear infinite" } : undefined}>
      <path d="M21.5 2v6h-6M2.5 22v-6h6" /><path d="M2.5 11.5a10 10 0 0 1 18.37-4.5M21.5 12.5a10 10 0 0 1-18.37 4.5" />
    </svg>
  );
}

function IconCheck() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
}

function IconEye({ open }: { open: boolean }) {
  if (open) return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></svg>;
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>;
}

function IconExternal() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>;
}

function IconCopy() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

/* ── Main component ── */

export function SettingsView() {
  const { isConnected, checkConnection } = useOpenClaw();
  const setView = useAppStore(s => s.setView);
  const {
    checkConnections, providerStatuses,
    preferredStt, preferredTts, setSttProvider, setTtsProvider,
  } = useVoice();
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const { themeId, setTheme } = useThemeStore();

  const [checking, setChecking] = useState(false);
  const [checkingVoice, setCheckingVoice] = useState(false);
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [authToken, setAuthToken] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [gatewayPort] = useState("18789");
  const [gatewayLatency, setGatewayLatency] = useState<number | null>(null);

  const [temperature, setTemperature] = useState(() => parseFloat(localStorage.getItem("crystal_ai_temperature") || "0.7"));
  const [maxTokens, setMaxTokens] = useState(() => localStorage.getItem("crystal_ai_max_tokens") || "1024");
  const [contextWindow, setContextWindow] = useState(() => localStorage.getItem("crystal_ai_context_window") || "32768");
  const [systemPrompt, setSystemPrompt] = useState(
    () => localStorage.getItem("crystal_ai_system_prompt") || "You are Crystal, an intelligent AI assistant powered by OpenClaw."
  );

  const [auditResult, setAuditResult] = useState<{ pass: number; warn: number; fail: number; details?: string } | null>(null);
  const [auditing, setAuditing] = useState(false);

  const [appVersion] = useState("0.1.0");
  const [openclawVersion, setOpenclawVersion] = useState("...");
  const [updateChannel, setUpdateChannel] = useState<"stable" | "beta" | "dev">("stable");
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateOutput, setUpdateOutput] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState(false);

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

  const [dnsExpanded, setDnsExpanded] = useState(false);
  const [dnsConfig, setDnsConfig] = useState<Record<string, unknown> | null>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [dnsStatusOutput, setDnsStatusOutput] = useState<string | null>(null);
  const [dnsStatusLoading, setDnsStatusLoading] = useState(false);
  const [dnsDomain, setDnsDomain] = useState("");
  const [dnsSaving, setDnsSaving] = useState(false);
  const [dnsSaveResult, setDnsSaveResult] = useState<string | null>(null);

  /* OpenClaw Configuration panel state */
  const [ocExpanded, setOcExpanded] = useState<Record<string, boolean>>({});
  const [ocValidating, setOcValidating] = useState(false);
  const [ocValidateResult, setOcValidateResult] = useState<{ valid: boolean; errors?: string[] } | null>(null);
  const [ocMemoryConfig, setOcMemoryConfig] = useState<Record<string, unknown> | null>(null);
  const [ocMemoryLoading, setOcMemoryLoading] = useState(false);
  const [ocReindexing, setOcReindexing] = useState(false);
  const [ocReindexResult, setOcReindexResult] = useState<string | null>(null);
  const [ocSessionConfig, setOcSessionConfig] = useState<Record<string, unknown> | null>(null);
  const [ocSessionLoading, setOcSessionLoading] = useState(false);
  const [ocHeartbeatConfig, setOcHeartbeatConfig] = useState<Record<string, unknown> | null>(null);
  const [ocHeartbeatLoading, setOcHeartbeatLoading] = useState(false);
  const [ocMaintenanceToggling, setOcMaintenanceToggling] = useState(false);

  const thinkingLevel = useAppStore(s => s.thinkingLevel);
  const setThinkingLevel = useAppStore(s => s.setThinkingLevel);

  const toggleOcSection = (key: string) => setOcExpanded(prev => ({ ...prev, [key]: !prev[key] }));

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
      const cfgPath = `${home}${sep}.openclaw\\openclaw.json`;
      invoke<string>("read_file", { path: cfgPath }).then(raw => {
        try {
          const cfg = JSON.parse(raw);
          const t = cfg?.gateway?.auth?.token;
          if (t && typeof t === "string") setAuthToken(t);
        } catch { /* malformed config */ }
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  /* ── helpers ── */

  const measureLatency = async () => {
    try {
      const start = performance.now();
      await invoke<{ openclaw_running: boolean }>("get_server_status");
      setGatewayLatency(Math.round(performance.now() - start));
    } catch { setGatewayLatency(null); }
  };

  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const cfg = await openclawClient.getConfig();
      setConfigText(JSON.stringify(cfg, null, 2));
    } catch { setConfigText("{}"); }
    const savedPrompt = localStorage.getItem("crystal_ai_system_prompt");
    if (savedPrompt) setSystemPrompt(savedPrompt);
    const savedContext = localStorage.getItem("crystal_ai_context_window");
    if (savedContext) setContextWindow(savedContext);
    setLoadingConfig(false);
  };

  const saveConfig = async () => {
    try {
      const cfg = JSON.parse(configText);
      delete cfg.systemPrompt;
      delete cfg.contextLength;
      await openclawClient.updateConfig(cfg);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch { /* invalid json */ }
  };

  const loadOpenClawVersion = async () => {
    try {
      const result = await cachedCommand("openclaw --version", { ttl: 300_000 });
      if (result.code === 0) setOpenclawVersion(result.stdout.trim());
    } catch { setOpenclawVersion("unknown"); }
  };

  const handleRefreshGateway = async () => {
    setChecking(true);
    await checkConnection();
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
        command: "openclaw security audit --json", cwd: null,
      });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setAuditResult({ pass: data.pass ?? 0, warn: data.warn ?? 0, fail: data.fail ?? 0, details: result.stdout.trim() });
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
        command: "openclaw update status --json", cwd: null,
      });
      if (result.code === 0) {
        const data = JSON.parse(result.stdout);
        setUpdateStatus(data.updateAvailable ? `Update available: v${data.latestVersion}` : "You're on the latest version");
      } else { setUpdateStatus("Could not check for updates"); }
    } catch { setUpdateStatus("Could not check for updates"); }
    setCheckingUpdates(false);
  };

  const runUpdate = async () => {
    setUpdating(true);
    setUpdateOutput(null);
    setUpdateSuccess(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw update --json", cwd: null,
      });
      const output = result.stdout?.trim() || result.stderr?.trim() || "";
      setUpdateSuccess(result.code === 0);
      if (result.code === 0) {
        try {
          const data = JSON.parse(output);
          const from = data.previousVersion ?? data.from ?? "";
          const to = data.newVersion ?? data.version ?? data.to ?? "";
          setUpdateOutput(from && to ? `Updated: v${from} → v${to}` : data.message ?? "Update completed successfully");
        } catch {
          setUpdateOutput(output || "Update completed");
        }
      } else {
        setUpdateOutput(output || "Update failed");
      }
    } catch (e) {
      setUpdateSuccess(false);
      setUpdateOutput(e instanceof Error ? e.message : "Update command failed");
    }
    setUpdating(false);
  };

  const restartGatewayAfterUpdate = async () => {
    setRestarting(true);
    try {
      await invoke("execute_command", { command: "openclaw gateway restart", cwd: null });
      setUpdateOutput(prev => (prev ? prev + "\nGateway restarted successfully." : "Gateway restarted."));
    } catch {
      setUpdateOutput(prev => (prev ? prev + "\nFailed to restart gateway." : "Failed to restart gateway."));
    }
    setRestarting(false);
  };

  const saveAISettings = () => {
    localStorage.setItem("crystal_ai_temperature", temperature.toString());
    localStorage.setItem("crystal_ai_max_tokens", maxTokens);
    localStorage.setItem("crystal_ai_context_window", contextWindow);
    localStorage.setItem("crystal_ai_system_prompt", systemPrompt);
  };

  const checkDaemonStatus = async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw gateway status", cwd: null,
      });
      setDaemonInstalled(result.code === 0 && !result.stdout.includes("not installed"));
    } catch { setDaemonInstalled(false); }
  };

  const runDaemonCmd = async (cmd: string) => {
    setDaemonBusy(true);
    setDaemonOutput("");
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `openclaw gateway ${cmd}`, cwd: null,
      });
      setDaemonOutput(result.stdout || result.stderr);
      await checkDaemonStatus();
    } catch (e) { setDaemonOutput(e instanceof Error ? e.message : "Command failed"); }
    setDaemonBusy(false);
  };

  const restartDaemon = () => runDaemonCmd("restart");
  const stopDaemon = () => runDaemonCmd("stop");

  const getConfigValue = async () => {
    if (!configKey.trim()) return;
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", { command: `openclaw config get ${configKey.trim()}`, cwd: null });
      setConfigOutput(result.stdout.trim());
    } catch { setConfigOutput("Failed to get config value"); }
  };

  const setConfigValue_ = async () => {
    if (!configKey.trim() || !configValue.trim()) return;
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", { command: `openclaw config set ${configKey.trim()} ${configValue.trim()}`, cwd: null });
      setConfigOutput(result.stdout.trim() || "Value set");
    } catch { setConfigOutput("Failed to set config value"); }
  };

  const unsetConfigValue = async () => {
    if (!configKey.trim()) return;
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", { command: `openclaw config unset ${configKey.trim()}`, cwd: null });
      setConfigOutput(result.stdout.trim() || "Value unset");
    } catch { setConfigOutput("Failed to unset config value"); }
  };

  /* ── DNS helpers ── */

  const loadDnsConfig = async () => {
    setDnsLoading(true);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config get dns --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        setDnsConfig(data);
        if (data.domain) setDnsDomain(String(data.domain));
      }
    } catch { /* ignore */ }
    setDnsLoading(false);
  };

  const checkDnsStatus = async () => {
    setDnsStatusLoading(true);
    setDnsStatusOutput(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw dns status", cwd: null,
      });
      setDnsStatusOutput(result.code === 0 ? (result.stdout.trim() || "DNS status OK") : (result.stderr?.trim() || result.stdout?.trim() || "DNS status check failed"));
    } catch {
      setDnsStatusOutput("DNS status command failed");
    }
    setDnsStatusLoading(false);
  };

  const saveDnsDomain = async () => {
    if (!dnsDomain.trim()) return;
    setDnsSaving(true);
    setDnsSaveResult(null);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `openclaw config set dns.domain "${dnsDomain.trim()}"`, cwd: null,
      });
      setDnsSaveResult(result.code === 0 ? "Domain saved" : "Failed to save domain");
      if (result.code === 0) await loadDnsConfig();
    } catch {
      setDnsSaveResult("Failed to save domain");
    }
    setDnsSaving(false);
    setTimeout(() => setDnsSaveResult(null), 3000);
  };

  /* ── OpenClaw Configuration helpers ── */

  const runConfigValidate = async () => {
    setOcValidating(true);
    setOcValidateResult(null);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config validate --json", cwd: null,
      });
      if (result.code === 0) {
        try {
          const data = JSON.parse(result.stdout);
          setOcValidateResult({ valid: data.valid !== false, errors: data.errors });
        } catch {
          setOcValidateResult({ valid: true });
        }
      } else {
        try {
          const data = JSON.parse(result.stdout);
          setOcValidateResult({ valid: false, errors: data.errors || [result.stdout.trim()] });
        } catch {
          setOcValidateResult({ valid: false, errors: [result.stdout.trim() || "Validation failed"] });
        }
      }
    } catch {
      setOcValidateResult({ valid: false, errors: ["Failed to run config validate"] });
    }
    setOcValidating(false);
  };

  const loadMemoryConfig = async () => {
    setOcMemoryLoading(true);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config get memory --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        setOcMemoryConfig(JSON.parse(result.stdout));
      }
    } catch { /* ignore */ }
    setOcMemoryLoading(false);
  };

  const runReindex = async () => {
    setOcReindexing(true);
    setOcReindexResult(null);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "openclaw memory index --force", cwd: null,
      });
      setOcReindexResult(result.code === 0 ? (result.stdout.trim() || "Reindex complete") : (result.stderr?.trim() || result.stdout?.trim() || "Reindex failed"));
    } catch {
      setOcReindexResult("Reindex command failed");
    }
    setOcReindexing(false);
  };

  const loadSessionConfig = async () => {
    setOcSessionLoading(true);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config get session --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        setOcSessionConfig(JSON.parse(result.stdout));
      }
    } catch { /* ignore */ }
    setOcSessionLoading(false);
  };

  const toggleMaintenanceMode = async () => {
    if (!ocSessionConfig) return;
    setOcMaintenanceToggling(true);
    const current = String(ocSessionConfig.maintenanceMode || "off");
    const next = current === "off" ? "warn" : current === "warn" ? "enforce" : "off";
    try {
      await invoke("execute_command", {
        command: `openclaw config set session.maintenanceMode ${next}`, cwd: null,
      });
      setOcSessionConfig(prev => prev ? { ...prev, maintenanceMode: next } : prev);
    } catch { /* ignore */ }
    setOcMaintenanceToggling(false);
  };

  const loadHeartbeatConfig = async () => {
    setOcHeartbeatLoading(true);
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: "openclaw config get agents.defaults.heartbeat --json", cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        setOcHeartbeatConfig(JSON.parse(result.stdout));
      }
    } catch { /* ignore */ }
    setOcHeartbeatLoading(false);
  };

  /* ── render ── */

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{KEYFRAMES}</style>

      <div style={{ padding: "18px 24px 8px", flexShrink: 0 }}>
        <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>Settings</h2>
        <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 0" }}>
          Crystal &middot; OpenClaw configuration
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "4px 24px 28px" }}>

        {/* ───────── THEME ───────── */}
        <Section title="THEME">
          <div style={CARD}>
            <div style={{ padding: "12px 14px", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
              {THEMES.map((theme) => {
                const active = themeId === theme.id;
                return (
                  <button key={theme.id} onClick={() => setTheme(theme.id)} style={{
                    padding: 0, border: active ? "2px solid var(--accent)" : "2px solid var(--border)",
                    borderRadius: 10, cursor: "pointer", background: "transparent", transition: "all 0.2s",
                    overflow: "hidden", transform: active ? "scale(1.02)" : "scale(1)",
                    boxShadow: active ? "0 0 12px var(--accent-bg)" : "none",
                  }}>
                    <div style={{ display: "flex", height: 32 }}>
                      {theme.preview.map((color, i) => <div key={i} style={{ flex: 1, background: color }} />)}
                    </div>
                    <div style={{ padding: "6px 8px", background: active ? "var(--accent-bg)" : "var(--bg-elevated)", textAlign: "center" }}>
                      <div style={{ fontSize: 10, fontWeight: 600, color: active ? "var(--accent)" : "var(--text-secondary)" }}>{theme.name}</div>
                      <div style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 1 }}>{theme.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        {/* ───────── OPENCLAW GATEWAY ───────── */}
        <Section title="OPENCLAW GATEWAY">
          <div style={CARD}>
            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={dot(gatewayConnected ? "var(--success)" : "var(--error)")} />
                <span style={LABEL}>Connection</span>
              </div>
              <span style={{ ...VALUE, color: gatewayConnected ? "var(--success)" : "var(--error)" }}>
                {gatewayConnected ? "Connected" : "Offline"}
              </span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Port</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{gatewayPort}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Latency</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11, color: gatewayLatency !== null && gatewayLatency < 100 ? "var(--success)" : "var(--warning)" }}>
                {gatewayLatency !== null ? `${gatewayLatency}ms` : "—"}
              </span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Daemon</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: daemonInstalled ? "var(--success)" : "var(--error)", flexShrink: 0 }} />
                <span style={{ ...VALUE, fontSize: 11, color: daemonInstalled ? "var(--success)" : "var(--error)" }}>{daemonInstalled ? "Installed" : "Not Installed"}</span>
              </div>
            </div>

            {/* auth token */}
            <div style={{ ...ROW, borderBottom: "none", flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={LABEL}>Gateway Token</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>For external clients</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--bg-elevated)", borderRadius: 8, padding: "6px 10px", border: "1px solid var(--border)" }}>
                <code style={{ flex: 1, fontSize: 12, ...MONO, color: authToken ? "var(--text-secondary)" : "var(--text-muted)", letterSpacing: 0.5, wordBreak: "break-all", lineHeight: 1.4, userSelect: showAuthToken ? "text" : "none" }}>
                  {authToken ? (showAuthToken ? authToken : "••••••••••••••••••••••••••••••••") : "No token found"}
                </code>
                <button onClick={() => setShowAuthToken(!showAuthToken)} style={{ ...BTN_GHOST, padding: 4, flexShrink: 0 }}><IconEye open={showAuthToken} /></button>
                <button onClick={() => { if (authToken) { navigator.clipboard.writeText(authToken); setTokenCopied(true); setTimeout(() => setTokenCopied(false), 2000); } }} style={{ ...BTN_GHOST, padding: 4, flexShrink: 0, color: tokenCopied ? "var(--success)" : "var(--text-muted)" }}>
                  {tokenCopied ? <IconCheck /> : <IconCopy />}
                </button>
              </div>
            </div>

            <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={handleStartGateway} style={BTN_PRIMARY}>
                <IconRefresh /> {gatewayConnected ? "Restart Gateway" : "Start Gateway"}
              </button>
              <button onClick={measureLatency} style={{ ...BTN_GHOST, fontSize: 11 }}>Ping</button>
              <button onClick={restartDaemon} disabled={daemonBusy} style={BTN_PRIMARY}>{daemonBusy ? <IconRefresh spin /> : null} Restart Daemon</button>
              <button onClick={stopDaemon} disabled={daemonBusy} style={BTN_GHOST}>Stop</button>
            </div>
            {daemonOutput && <pre style={{ margin: 0, padding: "8px 14px", fontSize: 10, ...MONO, color: "var(--text-muted)", whiteSpace: "pre-wrap", maxHeight: 80, overflowY: "auto", borderTop: "1px solid var(--border)" }}>{daemonOutput}</pre>}
          </div>
        </Section>

        {/* ───────── DNS ───────── */}
        <Section title="DNS">
          <div style={{ ...CARD, marginBottom: 8 }}>
            <button onClick={() => { setDnsExpanded(!dnsExpanded); if (!dnsExpanded && !dnsConfig) loadDnsConfig(); }} style={{ ...ROW, cursor: "pointer", border: "none", width: "100%", background: "transparent", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d={dnsExpanded ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} /></svg>
                <span style={{ ...LABEL, margin: 0 }}>DNS Configuration</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Domain & DNS settings</span>
            </button>
            {dnsExpanded && (
              <div style={{ padding: "0 14px 12px" }}>
                {dnsLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <IconRefresh spin /> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading...</span>
                  </div>
                ) : dnsConfig ? (
                  <>
                    {Object.entries(dnsConfig).map(([key, val]) => (
                      <div key={key} style={{ ...ROW, padding: "8px 0" }}>
                        <span style={LABEL}>{key}</span>
                        <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{typeof val === "object" ? JSON.stringify(val) : String(val ?? "—")}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div style={{ padding: "8px 0", fontSize: 11, color: "var(--text-muted)" }}>No DNS config loaded yet.</div>
                )}

                <div style={{ marginTop: 8 }}>
                  <span style={{ ...LABEL, display: "block", marginBottom: 4 }}>Domain</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="text" value={dnsDomain} onChange={e => setDnsDomain(e.target.value)} placeholder="example.com" style={{ ...INPUT, flex: 1 }} />
                    <button onClick={saveDnsDomain} disabled={dnsSaving || !dnsDomain.trim()} style={BTN_PRIMARY}>
                      {dnsSaving ? <IconRefresh spin /> : null} {dnsSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                  {dnsSaveResult && (
                    <span style={{ fontSize: 10, color: dnsSaveResult.includes("Failed") ? "var(--error)" : "var(--success)", marginTop: 4, display: "inline-block" }}>
                      {dnsSaveResult}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={checkDnsStatus} disabled={dnsStatusLoading} style={BTN_PRIMARY}>
                    {dnsStatusLoading ? <IconRefresh spin /> : null} {dnsStatusLoading ? "Checking..." : "DNS Status"}
                  </button>
                  <button onClick={loadDnsConfig} style={BTN_GHOST}><IconRefresh /> Refresh</button>
                </div>

                {dnsStatusOutput && (
                  <pre style={{ marginTop: 8, fontSize: 10, ...MONO, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflowY: "auto", padding: "8px 10px", background: "var(--bg-elevated)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    {dnsStatusOutput}
                  </pre>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* ───────── OPENCLAW MODEL ───────── */}
        <Section title="OPENCLAW MODEL">
          <div style={CARD}>
            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={dot(openclawClient.getModel() !== "default" ? "var(--accent)" : "var(--text-muted)")} />
                <div>
                  <span style={{ ...LABEL, display: "block" }}>Active Model</span>
                  <span style={{ fontSize: 12, color: "var(--text)", ...MONO, fontWeight: 500 }}>
                    {openclawClient.getModelDisplayName(openclawClient.getModel())}
                  </span>
                </div>
              </div>
              <button onClick={() => setView("models")} style={{ ...BTN_PRIMARY, padding: "5px 14px" }}>
                Change Model
              </button>
            </div>

            <div style={ROW}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {checking ? <span style={{ animation: "_spin .8s linear infinite", display: "inline-flex" }}><IconRefresh /></span> : <span style={dot(isConnected ? "var(--success)" : "var(--error)")} />}
                <span style={{ fontSize: 11, color: isConnected ? "var(--success)" : "var(--error)" }}>
                  {checking ? "Checking..." : isConnected ? "OpenClaw gateway connected" : "Gateway offline"}
                </span>
              </div>
              <button onClick={handleRefreshGateway} style={{ ...BTN_PRIMARY, padding: "4px 10px" }}>
                <IconRefresh spin={checking} /> Test
              </button>
            </div>

            <div style={{ ...ROW, borderBottom: "none" }}>
              <span style={LABEL}>Context Window</span>
              <input type="text" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} onBlur={saveAISettings} style={{ ...INPUT, width: 80, textAlign: "right" }} />
            </div>
          </div>
        </Section>

        {/* ───────── API KEYS ───────── */}
        <Section title="API KEYS">
          <ApiKeysSection />
        </Section>

        {/* ───────── VOICE ───────── */}
        <Section title="VOICE">
          <div style={CARD}>
            <VoiceProviderRow
              label="Speech to Text"
              providers={providerStatuses?.stt ?? []}
              preferredId={preferredStt}
              onSelect={setSttProvider}
            />
            <VoiceProviderRow
              label="Text to Speech"
              providers={providerStatuses?.tts ?? []}
              preferredId={preferredTts}
              onSelect={setTtsProvider}
            />
            {preferredStt === "whisper" && (
              <div style={ROW}>
                <span style={LABEL}>Whisper Model</span>
                <select value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)} style={{ ...INPUT, appearance: "none", paddingRight: 24, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center" }}>
                  {["tiny.en", "base.en", "small.en", "medium.en", "large-v3"].map((m) => <option key={m} value={m} style={{ background: "var(--bg-elevated)", color: "var(--text)" }}>{m}</option>)}
                </select>
              </div>
            )}
            <div style={{ padding: "8px 14px 10px", display: "flex", gap: 8, borderTop: "1px solid var(--border)" }}>
              <button onClick={handleRefreshVoice} style={BTN_PRIMARY}><IconRefresh spin={checkingVoice} /> Test Connections</button>
            </div>
          </div>
        </Section>

        {/* ───────── AI CONFIGURATION ───────── */}
        <Section title="AI CONFIGURATION">
          <div style={CARD}>
            <div style={ROW}>
              <span style={LABEL}>Temperature</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="range" min="0" max="2" step="0.05" value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} onMouseUp={saveAISettings} style={{ width: 100, height: 4, accentColor: "var(--accent)", cursor: "pointer" }} />
                <span style={{ ...VALUE, ...MONO, fontSize: 11, minWidth: 28, textAlign: "right" }}>{temperature.toFixed(2)}</span>
              </div>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Max Tokens</span>
              <input type="text" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} onBlur={saveAISettings} style={{ ...INPUT, width: 80, textAlign: "right" }} />
            </div>
            <div style={{ padding: "10px 14px", borderBottom: "none" }}>
              <span style={{ ...LABEL, display: "block", marginBottom: 6 }}>System Prompt</span>
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} onBlur={saveAISettings} spellCheck={false} rows={5} style={{ width: "100%", background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.6, resize: "vertical", outline: "none", ...MONO, boxSizing: "border-box" }} />
            </div>
          </div>
        </Section>

        {/* ───────── SECURITY ───────── */}
        <Section title="SECURITY">
          <div style={CARD}>
            <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ ...LABEL, display: "block" }}>Security Audit</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Run OpenClaw security checks</span>
              </div>
              <button onClick={runAudit} disabled={auditing} style={BTN_PRIMARY}>
                {auditing ? <IconRefresh spin /> : null} {auditing ? "Auditing..." : "Run Audit"}
              </button>
            </div>
            {auditResult && (
              <div style={{ padding: "0 14px 10px" }}>
                <div style={{ display: "flex", gap: 12, padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: 6, border: "1px solid var(--border)" }}>
                  <AuditBadge label="PASS" count={auditResult.pass} color="var(--success)" />
                  <AuditBadge label="WARN" count={auditResult.warn} color="var(--warning)" />
                  <AuditBadge label="FAIL" count={auditResult.fail} color="var(--error)" />
                </div>
                {auditResult.details && <pre style={{ marginTop: 6, fontSize: 10, ...MONO, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 120, overflowY: "auto" }}>{auditResult.details}</pre>}
              </div>
            )}
            <div style={ROW}>
              <span style={LABEL}>Tool Permissions</span>
              <span style={{ fontSize: 11, color: "var(--success)" }}>All Enabled</span>
            </div>
            <div style={{ ...ROW, borderBottom: "none" }}>
              <span style={LABEL}>Gateway Auth</span>
              <span style={{ fontSize: 11, color: authToken ? "var(--success)" : "var(--text-muted)" }}>{authToken ? "Enabled" : "Disabled"}</span>
            </div>
          </div>
        </Section>

        {/* ───────── UPDATES ───────── */}
        <Section title="UPDATES">
          <div style={CARD}>
            <div style={ROW}>
              <span style={LABEL}>Crystal Version</span>
              <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>v{appVersion}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Update Channel</span>
              <div style={{ display: "flex", gap: 4 }}>
                {(["stable", "beta", "dev"] as const).map((ch) => (
                  <button key={ch} onClick={() => setUpdateChannel(ch)} style={{
                    padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 500, cursor: "pointer", textTransform: "capitalize",
                    border: updateChannel === ch ? "1px solid var(--accent)" : "1px solid var(--border)",
                    background: updateChannel === ch ? "var(--accent-bg)" : "var(--bg-elevated)",
                    color: updateChannel === ch ? "var(--accent)" : "var(--text-muted)", transition: "all .15s ease",
                  }}>{ch}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: "8px 14px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)" }}>
              {updateStatus ? <span style={{ fontSize: 11, color: updateStatus.includes("available") ? "var(--warning)" : "var(--success)" }}>{updateStatus}</span> : <span />}
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={checkForUpdates} disabled={checkingUpdates} style={BTN_PRIMARY}>
                  {checkingUpdates ? <IconRefresh spin /> : null} {checkingUpdates ? "Checking..." : "Check for Updates"}
                </button>
                {updateStatus?.includes("available") && (
                  <button onClick={runUpdate} disabled={updating} style={{ ...BTN_BASE, background: "var(--accent)", color: "#fff" }}>
                    {updating ? <IconRefresh spin /> : null} {updating ? "Updating..." : "Update Now"}
                  </button>
                )}
              </div>
            </div>
            {(updateOutput || updating) && (
              <div style={{ padding: "8px 14px 10px", borderTop: "1px solid var(--border)" }}>
                <div style={{
                  padding: "8px 12px", borderRadius: 6,
                  background: updateSuccess === true ? "rgba(74,222,128,0.08)" : updateSuccess === false ? "rgba(248,113,113,0.08)" : "var(--bg-elevated)",
                  border: `1px solid ${updateSuccess === true ? "rgba(74,222,128,0.2)" : updateSuccess === false ? "rgba(248,113,113,0.2)" : "var(--border)"}`,
                }}>
                  {updating ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ display: "inline-flex", animation: "_spin .8s linear infinite" }}><IconRefresh /></span>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Updating OpenClaw...</span>
                    </div>
                  ) : (
                    <pre style={{ margin: 0, fontSize: 11, color: updateSuccess ? "var(--success)" : "var(--error)", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'JetBrains Mono', monospace" }}>
                      {updateOutput}
                    </pre>
                  )}
                </div>
                {updateSuccess === true && (
                  <button onClick={restartGatewayAfterUpdate} disabled={restarting} style={{ ...BTN_PRIMARY, marginTop: 8 }}>
                    {restarting ? <IconRefresh spin /> : null} {restarting ? "Restarting..." : "Restart Gateway"}
                  </button>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* ───────── OPENCLAW CONFIG ───────── */}
        <Section title="OPENCLAW CONFIG">
          <div style={CARD}>
            <div style={{ ...ROW, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>{configPath}</span>
              </div>
              <button onClick={() => navigator.clipboard.writeText(configPath)} style={{ ...BTN_GHOST, padding: 4 }}><IconCopy /></button>
            </div>
            <div style={{ padding: "10px 14px" }}>
              <textarea value={configText} onChange={(e) => setConfigText(e.target.value)} spellCheck={false} style={{ width: "100%", minHeight: 160, maxHeight: 300, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 6, padding: "10px 12px", color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.7, resize: "vertical", outline: "none", ...MONO, boxSizing: "border-box", tabSize: 2 }} />
            </div>
            <div style={{ padding: "0 14px 10px", display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={loadConfig} disabled={loadingConfig} style={BTN_GHOST}><IconRefresh spin={loadingConfig} /> Reload</button>
              <button onClick={saveConfig} style={BTN_PRIMARY}>{configSaved ? <IconCheck /> : null} {configSaved ? "Saved" : "Save"}</button>
            </div>
          </div>
        </Section>


        {/* ───────── CONFIG CLI ───────── */}
        <Section title="CONFIG CLI">
          <div style={CARD}>
            <div style={{ padding: "10px 14px" }}>
              <span style={{ ...LABEL, display: "block", marginBottom: 6 }}>Get / Set Configuration</span>
              <div style={{ display: "flex", gap: 6 }}>
                <input type="text" value={configKey} onChange={(e) => setConfigKey(e.target.value)} placeholder="config.key" style={{ ...INPUT, flex: 1 }} />
                <button onClick={getConfigValue} style={BTN_PRIMARY}>Get</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                <input type="text" value={configValue} onChange={(e) => setConfigValue(e.target.value)} placeholder="new value" style={{ ...INPUT, flex: 1 }} />
                <button onClick={setConfigValue_} style={BTN_PRIMARY}>Set</button>
                <button onClick={unsetConfigValue} style={{ ...BTN_GHOST, color: "var(--error)" }}>Unset</button>
              </div>
            </div>
            {configOutput && <pre style={{ margin: 0, padding: "8px 14px", fontSize: 10, ...MONO, color: "var(--text-muted)", whiteSpace: "pre-wrap", maxHeight: 80, overflowY: "auto", borderTop: "1px solid var(--border)" }}>{configOutput}</pre>}
          </div>
        </Section>

        {/* ───────── OPENCLAW CONFIGURATION ───────── */}
        <Section title="OPENCLAW CONFIGURATION">
          {/* Config Validate */}
          <div style={{ ...CARD, marginBottom: 8 }}>
            <button onClick={() => toggleOcSection("validate")} style={{ ...ROW, cursor: "pointer", border: "none", width: "100%", background: "transparent", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d={ocExpanded.validate ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} /></svg>
                <span style={{ ...LABEL, margin: 0 }}>Config Validate</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Check config integrity</span>
            </button>
            {ocExpanded.validate && (
              <div style={{ padding: "8px 14px 12px" }}>
                <button onClick={runConfigValidate} disabled={ocValidating} style={BTN_PRIMARY}>
                  {ocValidating ? <IconRefresh spin /> : null} {ocValidating ? "Validating..." : "Validate Config"}
                </button>
                {ocValidateResult && (
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: ocValidateResult.valid ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)", border: `1px solid ${ocValidateResult.valid ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={dot(ocValidateResult.valid ? "var(--success)" : "var(--error)")} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: ocValidateResult.valid ? "var(--success)" : "var(--error)" }}>
                        {ocValidateResult.valid ? "Valid" : "Invalid"}
                      </span>
                    </div>
                    {ocValidateResult.errors && ocValidateResult.errors.length > 0 && (
                      <pre style={{ margin: "6px 0 0", fontSize: 10, ...MONO, color: "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {ocValidateResult.errors.join("\n")}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Memory Config */}
          <div style={{ ...CARD, marginBottom: 8 }}>
            <button onClick={() => { toggleOcSection("memory"); if (!ocExpanded.memory && !ocMemoryConfig) loadMemoryConfig(); }} style={{ ...ROW, cursor: "pointer", border: "none", width: "100%", background: "transparent", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d={ocExpanded.memory ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} /></svg>
                <span style={{ ...LABEL, margin: 0 }}>Memory Config</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Embedding & index settings</span>
            </button>
            {ocExpanded.memory && (
              <div style={{ padding: "0 14px 12px" }}>
                {ocMemoryLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <IconRefresh spin /> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading...</span>
                  </div>
                ) : ocMemoryConfig ? (
                  <>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>Embedding Provider</span>
                      <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{String(ocMemoryConfig.embeddingProvider || ocMemoryConfig.provider || "—")}</span>
                    </div>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>Index Status</span>
                      <span style={{ ...VALUE, fontSize: 11, color: ocMemoryConfig.indexed ? "var(--success)" : "var(--text-muted)" }}>
                        {ocMemoryConfig.indexed ? "Indexed" : (ocMemoryConfig.indexStatus ? String(ocMemoryConfig.indexStatus) : "Unknown")}
                      </span>
                    </div>
                    {ocMemoryConfig.totalEntries !== undefined && (
                      <div style={{ ...ROW, padding: "8px 0" }}>
                        <span style={LABEL}>Total Entries</span>
                        <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{String(ocMemoryConfig.totalEntries)}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button onClick={runReindex} disabled={ocReindexing} style={BTN_PRIMARY}>
                        {ocReindexing ? <IconRefresh spin /> : null} {ocReindexing ? "Reindexing..." : "Reindex"}
                      </button>
                      <button onClick={loadMemoryConfig} style={BTN_GHOST}><IconRefresh /> Refresh</button>
                    </div>
                    {ocReindexResult && (
                      <pre style={{ marginTop: 6, fontSize: 10, ...MONO, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{ocReindexResult}</pre>
                    )}
                  </>
                ) : (
                  <button onClick={loadMemoryConfig} style={{ ...BTN_GHOST, marginTop: 4 }}>Load Memory Config</button>
                )}
              </div>
            )}
          </div>

          {/* Session Config */}
          <div style={{ ...CARD, marginBottom: 8 }}>
            <button onClick={() => { toggleOcSection("session"); if (!ocExpanded.session && !ocSessionConfig) loadSessionConfig(); }} style={{ ...ROW, cursor: "pointer", border: "none", width: "100%", background: "transparent", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d={ocExpanded.session ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} /></svg>
                <span style={{ ...LABEL, margin: 0 }}>Session Config</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>DM scope, reset & maintenance</span>
            </button>
            {ocExpanded.session && (
              <div style={{ padding: "0 14px 12px" }}>
                {ocSessionLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <IconRefresh spin /> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading...</span>
                  </div>
                ) : ocSessionConfig ? (
                  <>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>DM Scope</span>
                      <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{String(ocSessionConfig.dmScope ?? "—")}</span>
                    </div>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>Reset Mode</span>
                      <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{String(ocSessionConfig.resetMode ?? "—")}</span>
                    </div>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>Maintenance Mode</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, ...MONO,
                          color: String(ocSessionConfig.maintenanceMode || "off") === "off" ? "var(--success)" : String(ocSessionConfig.maintenanceMode) === "warn" ? "var(--warning)" : "var(--error)",
                        }}>
                          {String(ocSessionConfig.maintenanceMode || "off")}
                        </span>
                        <button onClick={toggleMaintenanceMode} disabled={ocMaintenanceToggling} style={{ ...BTN_GHOST, padding: "2px 8px", fontSize: 9 }}>
                          {ocMaintenanceToggling ? "..." : "Toggle"}
                        </button>
                      </div>
                    </div>
                    <button onClick={loadSessionConfig} style={{ ...BTN_GHOST, marginTop: 4 }}><IconRefresh /> Refresh</button>
                  </>
                ) : (
                  <button onClick={loadSessionConfig} style={{ ...BTN_GHOST, marginTop: 4 }}>Load Session Config</button>
                )}
              </div>
            )}
          </div>

          {/* Heartbeat Config */}
          <div style={{ ...CARD, marginBottom: 8 }}>
            <button onClick={() => { toggleOcSection("heartbeat"); if (!ocExpanded.heartbeat && !ocHeartbeatConfig) loadHeartbeatConfig(); }} style={{ ...ROW, cursor: "pointer", border: "none", width: "100%", background: "transparent", textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d={ocExpanded.heartbeat ? "m6 9 6 6 6-6" : "m9 18 6-6-6-6"} /></svg>
                <span style={{ ...LABEL, margin: 0 }}>Heartbeat Config</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Read-only summary</span>
            </button>
            {ocExpanded.heartbeat && (
              <div style={{ padding: "0 14px 12px" }}>
                {ocHeartbeatLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
                    <IconRefresh spin /> <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading...</span>
                  </div>
                ) : ocHeartbeatConfig ? (
                  <>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>Interval</span>
                      <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{String(ocHeartbeatConfig.interval ?? ocHeartbeatConfig.intervalMs ?? "—")}</span>
                    </div>
                    <div style={{ ...ROW, padding: "8px 0" }}>
                      <span style={LABEL}>Target</span>
                      <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{String(ocHeartbeatConfig.target ?? "—")}</span>
                    </div>
                    <div style={{ ...ROW, padding: "8px 0", flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                      <span style={LABEL}>Prompt</span>
                      <span style={{ ...VALUE, ...MONO, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5, maxHeight: 48, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {String(ocHeartbeatConfig.prompt ?? "—").slice(0, 200)}{String(ocHeartbeatConfig.prompt ?? "").length > 200 ? "..." : ""}
                      </span>
                    </div>
                    {ocHeartbeatConfig.activeHours && (
                      <div style={{ ...ROW, padding: "8px 0" }}>
                        <span style={LABEL}>Active Hours</span>
                        <span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{typeof ocHeartbeatConfig.activeHours === "object" ? JSON.stringify(ocHeartbeatConfig.activeHours) : String(ocHeartbeatConfig.activeHours)}</span>
                      </div>
                    )}
                    <button onClick={loadHeartbeatConfig} style={{ ...BTN_GHOST, marginTop: 4 }}><IconRefresh /> Refresh</button>
                  </>
                ) : (
                  <button onClick={loadHeartbeatConfig} style={{ ...BTN_GHOST, marginTop: 4 }}>Load Heartbeat Config</button>
                )}
              </div>
            )}
          </div>

          {/* Thinking Level */}
          <div style={{ ...CARD, marginBottom: 8 }}>
            <div style={ROW}>
              <span style={LABEL}>Thinking Level</span>
              <div style={{ display: "flex", gap: 4 }}>
                {([undefined, "auto", "minimal", "medium", "high"] as (ThinkingLevel | undefined)[]).map(level => {
                  const label = level ?? "default";
                  const active = thinkingLevel === level;
                  return (
                    <button key={label} onClick={() => setThinkingLevel(level)} style={{
                      padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 500, cursor: "pointer", textTransform: "capitalize",
                      border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                      background: active ? "var(--accent-bg)" : "var(--bg-elevated)",
                      color: active ? "var(--accent)" : "var(--text-muted)", transition: "all .15s ease",
                    }}>{label}</button>
                  );
                })}
              </div>
            </div>
          </div>
        </Section>

        {/* ───────── OPENSHELL SANDBOX ───────── */}
        <Section title="OPENSHELL SANDBOX">
          <SandboxPanel />
        </Section>

        {/* ───────── ABOUT ───────── */}
        <Section title="ABOUT">
          <div style={CARD}>
            <div style={{ ...ROW, gap: 12, borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, overflow: "hidden", flexShrink: 0 }}><LobsterIcon size={36} /></div>
              <div style={{ flex: 1 }}>
                <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 600, display: "block" }}>Crystal</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>The OpenClaw Desktop Frontend</span>
              </div>
            </div>
            <div style={ROW}><span style={LABEL}>App Version</span><span style={{ ...VALUE, ...MONO, fontSize: 11 }}>v{appVersion}</span></div>
            <div style={ROW}><span style={LABEL}>OpenClaw Version</span><span style={{ ...VALUE, ...MONO, fontSize: 11 }}>{openclawVersion}</span></div>
            <div style={ROW}><span style={LABEL}>Runtime</span><span style={{ ...VALUE, ...MONO, fontSize: 11 }}>Tauri 2</span></div>
            <div style={{ padding: "10px 14px 12px", display: "flex", gap: 12, borderTop: "1px solid var(--border)" }}>
              <a href="https://docs.openclaw.ai" target="_blank" rel="noopener noreferrer" style={{ ...BTN_PRIMARY, textDecoration: "none" }}><IconExternal /> Docs</a>
              <a href="https://github.com/openclaw" target="_blank" rel="noopener noreferrer" style={{ ...BTN_GHOST, textDecoration: "none" }}><IconExternal /> GitHub</a>
            </div>
          </div>
        </Section>

        <div style={{ height: 20 }} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div style={{ marginBottom: 18 }}><div style={SECTION_HEADER}>{title}</div>{children}</div>;
}

/* ── Voice Provider Selector ── */

function VoiceProviderRow({ label, providers, preferredId, onSelect }: {
  label: string;
  providers: Array<{ id: string; name: string; available: boolean; active: boolean }>;
  preferredId: string;
  onSelect: (id: string) => void;
}) {
  const preferred = providers.find((p) => p.id === preferredId);
  const active = providers.find((p) => p.active);
  const meta = preferred ? VOICE_PROVIDER_META[preferred.id] : null;
  const activeMeta = active ? VOICE_PROVIDER_META[active.id] : null;
  const isFallback = preferred && active && preferred.id !== active.id;

  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
      <span style={{ ...LABEL, display: "block", marginBottom: 8 }}>{label}</span>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {providers.map((p) => {
          const isSelected = p.id === preferredId;
          const pmeta = VOICE_PROVIDER_META[p.id];
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 10, fontWeight: 500,
                cursor: "pointer", transition: "all .15s ease",
                display: "flex", alignItems: "center", gap: 6,
                border: isSelected ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: isSelected ? "var(--accent-bg)" : "var(--bg-elevated)",
                color: isSelected ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <span style={{
                width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                background: p.available ? "var(--success)" : "var(--text-muted)",
              }} />
              {pmeta?.label ?? p.name}
            </button>
          );
        })}
      </div>
      {providers.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
          {preferred?.available ? (
            <>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--success)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--success)" }}>Connected</span>
              {meta?.port && <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO }}>:{meta.port}</span>}
            </>
          ) : (
            <>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--warning, #f59e0b)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--warning, #f59e0b)" }}>
                {isFallback
                  ? `Offline — using ${activeMeta?.label ?? active?.name ?? "fallback"}`
                  : "Offline"}
              </span>
            </>
          )}
        </div>
      )}
      {providers.length === 0 && (
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic" }}>Loading providers...</span>
      )}
    </div>
  );
}

/* ── API Keys Manager ── */

const API_PROVIDERS = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-...", color: "#d4a574" },
  { id: "openai", label: "OpenAI", placeholder: "sk-...", color: "#10a37f" },
  { id: "google", label: "Google AI", placeholder: "AIza...", color: "#4285f4" },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-...", color: "#8b5cf6" },
  { id: "groq", label: "Groq", placeholder: "gsk_...", color: "#f55036" },
  { id: "mistral", label: "Mistral", placeholder: "...", color: "#ff7000" },
] as const;

const CARD_S: CSSProperties = {
  background: "var(--bg-elevated)", backdropFilter: "blur(20px)",
  border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
};

const ROW_S: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "10px 14px", borderBottom: "1px solid var(--border)",
};

const MONO_S: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

function ApiKeysSection() {
  const [profiles, setProfiles] = useState<Record<string, { type: string; provider: string; key: string }>>({});
  const [loading, setLoading] = useState(true);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const getProfilePath = async (): Promise<string> => {
    const result = await invoke<{ stdout: string }>("execute_command", {
      command: "echo $env:USERPROFILE\\.openclaw\\agents\\main\\agent\\auth-profiles.json",
      cwd: null,
    });
    return result.stdout.trim().replace(/\r?\n/g, "");
  };

  const loadProfiles = async () => {
    try {
      const path = await getProfilePath();
      const raw = await invoke<string>("read_file", { path });
      const data = JSON.parse(raw);
      setProfiles(data.profiles || {});
    } catch {
      setProfiles({});
    }
    setLoading(false);
  };

  useEffect(() => { loadProfiles(); }, []);

  useEffect(() => {
    if (feedback) {
      const t = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(t);
    }
  }, [feedback]);

  const saveKey = async (providerId: string, apiKey: string) => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setFeedback(null);
    try {
      const path = await getProfilePath();

      let data: Record<string, unknown> = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
      try {
        const raw = await invoke<string>("read_file", { path });
        data = JSON.parse(raw);
      } catch { /* new file */ }

      const profileKey = `${providerId}:default`;
      const profs = (data.profiles || {}) as Record<string, unknown>;

      if (providerId === "ollama") {
        profs[profileKey] = { type: "api_key", provider: providerId, key: "ollama", baseUrl: "http://127.0.0.1:11434" };
      } else {
        profs[profileKey] = { type: "api_key", provider: providerId, key: apiKey };
      }
      data.profiles = profs;

      const lastGood = (data.lastGood || {}) as Record<string, string>;
      lastGood[providerId] = profileKey;
      data.lastGood = lastGood;

      const jsonStr = JSON.stringify(data, null, 2);
      await invoke("write_file", { path, content: jsonStr });

      const verify = await invoke<string>("read_file", { path });
      const verifyData = JSON.parse(verify);
      if (verifyData.profiles?.[profileKey]?.key === apiKey || providerId === "ollama") {
        setFeedback({ type: "success", msg: `${providerId} key saved successfully` });
        await loadProfiles();
        setEditingProvider(null);
        setEditKey("");
      } else {
        setFeedback({ type: "error", msg: "Key was written but verification failed — file may be locked by gateway" });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("EPERM") || msg.includes("Access")) {
        setFeedback({ type: "error", msg: "File locked by OpenClaw gateway. Trying alternative save..." });
        try {
          const escaped = apiKey.replace(/'/g, "''");
          const cmd = `$p = "$env:USERPROFILE\\.openclaw\\agents\\main\\agent\\auth-profiles.json"; $d = Get-Content $p | ConvertFrom-Json; $d.profiles.'${providerId}:default' = @{type='api_key';provider='${providerId}';key='${escaped}'}; $d | ConvertTo-Json -Depth 10 | Set-Content $p -Encoding UTF8`;
          const result = await invoke<{ code: number; stderr: string }>("execute_command", { command: cmd, cwd: null });
          if (result.code === 0) {
            setFeedback({ type: "success", msg: `${providerId} key saved via fallback` });
            await loadProfiles();
            setEditingProvider(null);
            setEditKey("");
          } else {
            setFeedback({ type: "error", msg: `Save failed: ${result.stderr || "Unknown error"}` });
          }
        } catch (e2) {
          setFeedback({ type: "error", msg: `Both save methods failed: ${e2 instanceof Error ? e2.message : String(e2)}` });
        }
      } else {
        setFeedback({ type: "error", msg: `Save failed: ${msg}` });
      }
    }
    setSaving(false);
  };

  const removeKey = async (providerId: string) => {
    setFeedback(null);
    try {
      const path = await getProfilePath();
      const raw = await invoke<string>("read_file", { path });
      const data = JSON.parse(raw);
      const profileKey = `${providerId}:default`;
      if (data.profiles) delete data.profiles[profileKey];
      if (data.lastGood) delete data.lastGood[providerId];
      if (data.usageStats) delete data.usageStats[profileKey];

      await invoke("write_file", { path, content: JSON.stringify(data, null, 2) });
      setFeedback({ type: "success", msg: `${providerId} key removed` });
      await loadProfiles();
    } catch (e) {
      setFeedback({ type: "error", msg: `Remove failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const maskKey = (key: string) => {
    if (key.length <= 12) return "••••••••";
    return key.slice(0, 7) + "••••••••" + key.slice(-4);
  };

  if (loading) {
    return <div style={{ ...CARD_S, padding: 20, textAlign: "center" }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading API keys...</span>
    </div>;
  }

  return (
    <div style={CARD_S}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          API keys for cloud LLM providers. Stored in OpenClaw's auth-profiles.
        </span>
      </div>

      {feedback && (
        <div style={{
          padding: "8px 14px", display: "flex", alignItems: "center", gap: 8,
          background: feedback.type === "success" ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
          borderBottom: "1px solid var(--border)",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: feedback.type === "success" ? "#4ade80" : "#f87171",
          }} />
          <span style={{ fontSize: 11, color: feedback.type === "success" ? "#4ade80" : "#f87171", flex: 1 }}>
            {feedback.msg}
          </span>
          <button onClick={() => setFeedback(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>×</button>
        </div>
      )}

      {API_PROVIDERS.map(provider => {
        const profileKey = `${provider.id}:default`;
        const profile = profiles[profileKey];
        const hasKey = !!profile?.key;
        const isEditing = editingProvider === provider.id;
        const isVisible = showKeys[provider.id];

        return (
          <div key={provider.id} style={{ ...ROW_S, flexDirection: "column", alignItems: "stretch", gap: 6, borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: hasKey ? provider.color : "var(--border)", flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{provider.label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {hasKey && !isEditing && (
                  <>
                    <span style={{ fontSize: 10, color: "var(--success)", fontWeight: 500 }}>Active</span>
                    <button
                      onClick={() => setShowKeys(prev => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--text-muted)", display: "flex" }}
                    >
                      <IconEye open={isVisible} />
                    </button>
                    <button
                      onClick={() => { setEditingProvider(provider.id); setEditKey(profile.key); }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px", fontSize: 9, color: "var(--accent)", borderRadius: 4 }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeKey(provider.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 6px", fontSize: 9, color: "var(--error)", borderRadius: 4 }}
                    >
                      Remove
                    </button>
                  </>
                )}
                {!hasKey && !isEditing && (
                  <button
                    onClick={() => { setEditingProvider(provider.id); setEditKey(""); }}
                    style={{
                      background: "var(--accent-bg)", border: "1px solid rgba(59,130,246,0.2)",
                      borderRadius: 6, padding: "3px 10px", fontSize: 10, fontWeight: 500,
                      color: "var(--accent)", cursor: "pointer",
                    }}
                  >
                    Add Key
                  </button>
                )}
              </div>
            </div>

            {/* Show masked key */}
            {hasKey && !isEditing && (
              <code style={{ fontSize: 10, color: "var(--text-muted)", ...MONO_S, letterSpacing: 0.5 }}>
                {isVisible ? profile.key : maskKey(profile.key)}
              </code>
            )}

            {/* Edit mode */}
            {isEditing && (
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={editKey}
                  onChange={e => setEditKey(e.target.value)}
                  placeholder={provider.placeholder}
                  autoFocus
                  style={{
                    flex: 1, background: "var(--bg-surface)", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "6px 10px", color: "var(--text)", fontSize: 11,
                    outline: "none", ...MONO_S,
                  }}
                />
                <button
                  onClick={() => saveKey(provider.id, editKey)}
                  disabled={!editKey.trim() || saving}
                  style={{
                    background: editKey.trim() ? "var(--accent)" : "var(--bg-surface)",
                    border: "none", borderRadius: 6, padding: "6px 12px",
                    fontSize: 10, fontWeight: 600, color: editKey.trim() ? "#fff" : "var(--text-muted)",
                    cursor: editKey.trim() ? "pointer" : "default",
                  }}
                >
                  {saving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setEditingProvider(null); setEditKey(""); }}
                  style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 10px", fontSize: 10, color: "var(--text-muted)", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AuditBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      <span style={{ fontSize: 11, color, fontWeight: 600 }}>{count}</span>
      <span style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
    </div>
  );
}

/* ── OpenShell Sandbox Panel ── */

function SandboxPanel() {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [dockerOk, setDockerOk] = useState<boolean | null>(null);
  const [sandboxes, setSandboxes] = useState<{ name: string; status: string; image?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [sandboxMode, setSandboxMode] = useState<"off" | "openshell">("off");
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "warn"; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [openshellVersion, setOpenshellVersion] = useState("");

  const showFeedback = (type: "success" | "error" | "warn", text: string) => {
    setFeedback({ type, text }); setTimeout(() => setFeedback(null), 6000);
  };

  const checkDocker = async (): Promise<boolean> => {
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", { command: "docker info --format '{{.ServerVersion}}'", cwd: null });
      const ok = r.code === 0 && !r.stdout.toLowerCase().includes("error");
      setDockerOk(ok);
      return ok;
    } catch {
      setDockerOk(false);
      return false;
    }
  };

  const checkInstalled = async (): Promise<boolean> => {
    try {
      const r = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: "openshell --version", cwd: null });
      const ok = r.code === 0 && r.stdout.trim().length > 0;
      setInstalled(ok);
      if (ok) setOpenshellVersion(r.stdout.trim());
      return ok;
    } catch {
      setInstalled(false);
      return false;
    }
  };

  const loadSandboxes = async () => {
    if (!installed) { setSandboxes([]); return; }
    try {
      const r = await invoke<{ stdout: string; code: number }>("execute_command", { command: "openshell sandbox list --json", cwd: null });
      if (r.code === 0 && r.stdout.trim()) {
        try {
          const data = JSON.parse(r.stdout);
          const list = Array.isArray(data) ? data : data.sandboxes ?? data.items ?? [];
          setSandboxes(list);
          return;
        } catch { /* fall through to line parsing */ }
        const lines = r.stdout.trim().split("\n").filter(l => l.trim() && !l.startsWith("NAME"));
        setSandboxes(lines.map(l => {
          const parts = l.trim().split(/\s{2,}/);
          return { name: parts[0] || "unknown", status: parts[1] || "unknown", image: parts[2] };
        }));
      } else {
        setSandboxes([]);
      }
    } catch {
      setSandboxes([]);
    }
  };

  const loadSandboxMode = async () => {
    try {
      const r = await cachedCommand("openclaw config get agents.defaults.sandbox --json", { ttl: 30_000 });
      if (r.code === 0 && r.stdout.trim()) {
        try {
          const data = JSON.parse(r.stdout);
          const mode = data.mode ?? data.value?.mode ?? data.value ?? data ?? "off";
          setSandboxMode(typeof mode === "string" && mode !== "off" ? "openshell" : "off");
        } catch { /* keep default */ }
      }
    } catch { /* keep default */ }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [isInstalled] = await Promise.all([checkInstalled(), checkDocker(), loadSandboxMode()]);
      if (isInstalled) await loadSandboxes();
      setLoading(false);
    })();
  }, []);

  const handleInstall = async () => {
    setInstalling(true);
    showFeedback("warn", "Installing OpenShell... This may take a minute.");
    try {
      const uvR = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "uv tool install -U openshell", cwd: null,
      });
      if (uvR.code === 0) {
        const vr = await invoke<{ stdout: string; code: number }>("execute_command", { command: "openshell --version", cwd: null });
        if (vr.code === 0 && vr.stdout.trim()) {
          setInstalled(true);
          setOpenshellVersion(vr.stdout.trim());
          showFeedback("success", `OpenShell installed: ${vr.stdout.trim()}`);
          await loadSandboxes();
          setInstalling(false);
          return;
        }
      }
      const pipR = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "pip install -U openshell", cwd: null,
      });
      if (pipR.code === 0) {
        const vr = await invoke<{ stdout: string; code: number }>("execute_command", { command: "openshell --version", cwd: null });
        if (vr.code === 0 && vr.stdout.trim()) {
          setInstalled(true);
          setOpenshellVersion(vr.stdout.trim());
          showFeedback("success", `OpenShell installed: ${vr.stdout.trim()}`);
          await loadSandboxes();
        } else {
          showFeedback("error", "Package installed but CLI not found. Install manually: uv tool install -U openshell");
        }
      } else {
        showFeedback("error", "Install failed. Run manually in a terminal: uv tool install -U openshell");
      }
    } catch (e) {
      showFeedback("error", `Install error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setInstalling(false);
  };

  const setConfigMode = async (mode: "openshell" | "off"): Promise<boolean> => {
    try {
      const r = await invoke<{ code: number }>("execute_command", {
        command: `openclaw config set agents.defaults.sandbox.mode ${mode}`, cwd: null,
      });
      return r.code === 0;
    } catch { return false; }
  };

  const handleToggle = async () => {
    setToggling(true);
    const enabling = sandboxMode === "off";

    try {
      if (enabling) {
        if (!dockerOk) {
          const ok = await checkDocker();
          if (!ok) {
            showFeedback("error", "Docker is not running. Start Docker Desktop first, then try again.");
            setToggling(false);
            return;
          }
        }

        const hasOcSandbox = sandboxes.some(s =>
          s.name === "openclaw" || s.name === "openclaw-crystal" || s.image?.includes("openclaw"),
        );

        if (!hasOcSandbox && installed) {
          showFeedback("warn", "Creating OpenShell sandbox for OpenClaw... This may take a minute on first run.");
          const createR = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
            command: "openshell sandbox create --from openclaw --name openclaw-crystal", cwd: null,
          });
          if (createR.code !== 0) {
            const errMsg = (createR.stderr || createR.stdout || "").trim();
            if (errMsg.toLowerCase().includes("docker") || errMsg.toLowerCase().includes("daemon")) {
              showFeedback("error", "Docker is not responding. Make sure Docker Desktop is running.");
            } else {
              showFeedback("error", `Sandbox creation failed: ${errMsg}`.slice(0, 150));
            }
            setToggling(false);
            return;
          }
        }

        const ok = await setConfigMode("openshell");
        if (ok) {
          setSandboxMode("openshell");
          showFeedback("success", "Sandbox mode enabled — agents will run inside OpenShell");
        } else {
          showFeedback("error", "Failed to update OpenClaw config. Sandbox not enabled.");
        }
      } else {
        const ok = await setConfigMode("off");
        if (ok) {
          setSandboxMode("off");
          showFeedback("success", "Sandbox mode disabled — agents run on host");
        } else {
          showFeedback("error", "Failed to update OpenClaw config. Sandbox mode unchanged.");
        }
      }
      await loadSandboxes();
    } catch (e) {
      if (enabling) {
        await setConfigMode("off").catch(() => {});
        setSandboxMode("off");
        showFeedback("error", `Toggle failed and config reverted: ${e instanceof Error ? e.message : String(e)}`);
      } else {
        showFeedback("error", `Toggle failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setToggling(false);
  };

  const handleViewLogs = async () => {
    setLogsLoading(true);
    try {
      const name = sandboxes[0]?.name || "openclaw-crystal";
      const r = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `openshell logs ${name} --tail 40`, cwd: null,
      });
      setLogs(r.stdout || "(no output)");
    } catch { setLogs("(failed to fetch logs)"); }
    setLogsLoading(false);
  };

  const CARD_S: React.CSSProperties = {
    background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden",
  };
  const ROW_S: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 14px", borderBottom: "1px solid var(--border)",
  };
  const feedbackColors: Record<string, { bg: string; fg: string; border: string }> = {
    success: { bg: "rgba(74,222,128,0.08)", fg: "#4ade80", border: "rgba(74,222,128,0.2)" },
    error:   { bg: "rgba(248,113,113,0.08)", fg: "#f87171", border: "rgba(248,113,113,0.2)" },
    warn:    { bg: "rgba(251,191,36,0.08)", fg: "#fbbf24", border: "rgba(251,191,36,0.2)" },
  };

  if (loading) {
    return (
      <div style={{ ...CARD_S, padding: "20px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <IconRefresh spin />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Checking OpenShell...</span>
      </div>
    );
  }

  const fb = feedback ? feedbackColors[feedback.type] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {feedback && fb && (
        <div style={{ padding: "8px 12px", borderRadius: 8, fontSize: 11,
          background: fb.bg, color: fb.fg, border: `1px solid ${fb.border}` }}>
          {feedback.text}
        </div>
      )}

      {/* Docker warning */}
      {dockerOk === false && (
        <div style={{ padding: "8px 12px", borderRadius: 8, fontSize: 11,
          background: "rgba(251,191,36,0.06)", color: "#fbbf24",
          border: "1px solid rgba(251,191,36,0.15)", display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Docker Desktop is not running. Sandbox mode requires Docker to create isolated containers.
        </div>
      )}

      {/* Main toggle card */}
      <div style={CARD_S}>
        <div style={{ ...ROW_S, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              background: sandboxMode !== "off" ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.04)",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={sandboxMode !== "off" ? "#4ade80" : "var(--text-muted)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 7V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v3" /><line x1="12" y1="12" x2="12" y2="16" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Sandbox Mode</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {sandboxMode !== "off"
                  ? "Agents execute inside isolated OpenShell containers"
                  : "Agents execute directly on the host system"}
              </div>
            </div>
          </div>

          {installed ? (
            <button onClick={handleToggle} disabled={toggling} style={{
              width: 48, height: 26, borderRadius: 13, border: "none", cursor: toggling ? "wait" : "pointer",
              background: sandboxMode !== "off" ? "#4ade80" : "rgba(255,255,255,0.12)",
              position: "relative", transition: "background 0.2s", flexShrink: 0,
              opacity: toggling ? 0.6 : 1,
            }}>
              <div style={{
                width: 20, height: 20, borderRadius: "50%", background: "#fff",
                position: "absolute", top: 3,
                left: sandboxMode !== "off" ? 25 : 3,
                transition: "left 0.2s",
                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
              }} />
            </button>
          ) : (
            <button onClick={handleInstall} disabled={installing} style={{
              padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: "pointer",
              background: "var(--accent-bg)", color: "var(--accent)", border: "none",
              opacity: installing ? 0.6 : 1, display: "flex", alignItems: "center", gap: 4,
            }}>
              {installing ? <IconRefresh spin /> : null}
              {installing ? "Installing..." : "Install OpenShell"}
            </button>
          )}
        </div>

        {/* Status row */}
        <div style={{ ...ROW_S, borderBottom: expanded ? "1px solid var(--border)" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: installed ? "#4ade80" : "#f87171",
            }} />
            <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {installed === null ? "Checking..." : installed ? `OpenShell ${openshellVersion}` : "OpenShell not installed"}
            </span>
            {installed && (
              <>
                <span style={{ color: "var(--border)", margin: "0 2px" }}>·</span>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dockerOk ? "#4ade80" : "#f87171" }} />
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{dockerOk ? "Docker running" : "Docker stopped"}</span>
              </>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {installed && sandboxes.length > 0 && (
              <span style={{ fontSize: 10, color: "var(--text-muted)", padding: "2px 8px", borderRadius: 4, background: "rgba(59,130,246,0.08)" }}>
                {sandboxes.length} sandbox{sandboxes.length !== 1 ? "es" : ""}
              </span>
            )}
            <button onClick={() => setExpanded(!expanded)} style={{
              background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 10,
              display: "flex", alignItems: "center", gap: 2, padding: "2px 6px",
            }}>
              {expanded ? "▲ Less" : "▼ Details"}
            </button>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div style={{ padding: "8px 14px 12px" }}>
            {/* Sandbox list */}
            {installed && sandboxes.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Active Sandboxes</div>
                {sandboxes.map((sb, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 8px", background: "var(--bg)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: sb.status === "running" ? "#4ade80" : sb.status === "stopped" ? "#fbbf24" : "var(--text-muted)" }} />
                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", fontFamily: "monospace" }}>{sb.name}</span>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{sb.status} {sb.image ? `· ${sb.image}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : installed ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "8px 0" }}>
                No sandboxes created yet. Toggle sandbox mode to create one.
              </div>
            ) : null}

            {/* Actions */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={async () => { await Promise.all([checkInstalled(), checkDocker()]); await loadSandboxes(); await loadSandboxMode(); }} style={{
                padding: "5px 12px", borderRadius: 6, fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)",
                color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
              }}><IconRefresh /> Refresh</button>
              {installed && sandboxes.length > 0 && (
                <button onClick={handleViewLogs} disabled={logsLoading} style={{
                  padding: "5px 12px", borderRadius: 6, fontSize: 10, background: "var(--bg)", border: "1px solid var(--border)",
                  color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                  opacity: logsLoading ? 0.5 : 1,
                }}>
                  {logsLoading ? <IconRefresh spin /> : null} View Logs
                </button>
              )}
            </div>

            {/* Logs output */}
            {logs !== null && (
              <pre style={{
                marginTop: 8, padding: 10, borderRadius: 6, background: "var(--bg)", border: "1px solid var(--border)",
                fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", maxHeight: 200, overflowY: "auto",
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{logs}</pre>
            )}

            {/* Info */}
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.1)" }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)", marginBottom: 4 }}>About OpenShell</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.5 }}>
                <a href="https://github.com/NVIDIA/OpenShell" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>NVIDIA OpenShell</a> provides
                sandboxed execution environments with policy-enforced egress routing, filesystem isolation, and process constraints.
                Each sandbox runs inside a container with kernel-level security (Landlock, seccomp, OPA policy proxy).
              </div>
            </div>

            {/* Install instructions when not installed */}
            {!installed && (
              <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>Install Manually</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.6, fontFamily: "monospace" }}>
                  # Recommended (requires uv)<br />
                  uv tool install -U openshell<br /><br />
                  # Or via pip<br />
                  pip install -U openshell
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
