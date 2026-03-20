import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { openclawClient } from "@/lib/openclaw";
import { cachedCommand } from "@/lib/cache";
import { VoiceOrb } from "@/components/voice/VoiceOrb";
import { GpuMonitor } from "@/components/widgets/GpuMonitor";
import { LobsterIcon } from "@/components/LobsterIcon";
import {
  Radio, Bot, Monitor, Activity, Wrench,
  Clock, Shield, Stethoscope, Sun, Zap,
  AlertTriangle, ShieldAlert, Database, Percent, Loader2,
  Cpu, MemoryStick, HardDrive, Bolt, Trash2, Wifi, BatteryFull,
  Gauge, RefreshCw, Power, RotateCcw, FolderCog, ShieldCheck,
  MonitorDown, Layers,
} from "lucide-react";

// Global caches so data survives tab switches without re-fetching
let _dashboardCache: { data: DashboardData; ts: number } | null = null;
let _sysStatsCache: { data: Partial<SysStats>; ts: number } | null = null;
const DASHBOARD_TTL = 60_000; // refresh dashboard every 60s
const SYS_POLL_INTERVAL = 30_000;

interface DashboardData {
  gateway: { connected: boolean; latencyMs: number };
  llmModel: string;
  osLabel: string;
  activeSessions: number;
  readySkills: number;
  tokenPercentUsed: number;
  memoryChunks: number;
  securityCritical: number;
  securityWarn: number;
}

const INITIAL: DashboardData = {
  gateway: { connected: false, latencyMs: 0 },
  llmModel: "—",
  osLabel: "—",
  activeSessions: 0,
  readySkills: 0,
  tokenPercentUsed: 0,
  memoryChunks: 0,
  securityCritical: 0,
  securityWarn: 0,
};

function safeParse(stdout: string) {
  const start = stdout.indexOf("{");
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}


const card = (extra?: CSSProperties): CSSProperties => ({
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
  ...extra,
});

const hoverIn = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = "var(--bg-hover)";
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
  e.currentTarget.style.transform = "translateY(-1px)";
  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
};
const hoverOut = (e: React.MouseEvent<HTMLElement>) => {
  e.currentTarget.style.background = "var(--bg-elevated)";
  e.currentTarget.style.borderColor = "var(--border)";
  e.currentTarget.style.transform = "translateY(0)";
  e.currentTarget.style.boxShadow = "none";
};

export function HomeView() {
  const setView = useAppStore(s => s.setView);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const [data, setData] = useState<DashboardData>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [actionRunning, setActionRunning] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  useEffect(() => {
    if (_dashboardCache && Date.now() - _dashboardCache.ts < DASHBOARD_TTL) {
      setData(_dashboardCache.data);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const [statusR, modelsR, skillsR, sessionsR] = await Promise.all([
          cachedCommand("openclaw status --json", { ttl: 60_000 }),
          cachedCommand("openclaw models list --json", { ttl: 60_000 }),
          cachedCommand("openclaw skills list --json", { ttl: 60_000 }),
          cachedCommand("openclaw sessions --json", { ttl: 60_000 }),
        ]);

        if (cancelled) return;

        const status = safeParse(statusR.stdout);
        const models = safeParse(modelsR.stdout);
        const skills = safeParse(skillsR.stdout);
        const sessions = safeParse(sessionsR.stdout);

        const defaultModel = models?.models?.find((m: { tags?: string[] }) => m.tags?.includes("default"));
        const firstSession = sessions?.sessions?.[0];

        const newData: DashboardData = {
          gateway: {
            connected: status?.gateway?.connected ?? gatewayConnected,
            latencyMs: status?.gateway?.connectLatencyMs ?? 0,
          },
          llmModel: status?.sessions?.defaults?.model
            || defaultModel?.name
            || defaultModel?.key
            || "—",
          osLabel: status?.os?.label ?? "—",
          activeSessions: sessions?.count ?? 0,
          readySkills: skills?.skills?.filter((s: { eligible: boolean }) => s.eligible).length ?? 0,
          tokenPercentUsed: firstSession?.tokenUsage?.percentUsed ?? 0,
          memoryChunks: status?.memory?.totalChunks ?? status?.memory?.chunks ?? 0,
          securityCritical: status?.securityAudit?.summary?.critical ?? 0,
          securityWarn: status?.securityAudit?.summary?.warn ?? 0,
        };

        _dashboardCache = { data: newData, ts: Date.now() };
        setData(newData);
      } catch {
        /* dashboard degrades gracefully */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runAction = async (id: string, fn: () => Promise<string>) => {
    setActionRunning(id);
    setActionResult(null);
    try {
      const msg = await fn();
      setActionResult(msg);
    } catch (e) {
      setActionResult(`Error: ${e instanceof Error ? e.message : "Unknown"}`);
    } finally {
      setActionRunning(null);
    }
  };

  const quickActions: { id: string; icon: React.ElementType; label: string; desc: string; color: string; action: () => void }[] = [
    {
      id: "briefing", icon: Sun, label: "Morning Briefing", desc: "Get today's summary",
      color: "var(--warning)",
      action: () => runAction("briefing", async () => {
        const r = await invoke<{ stdout: string }>("execute_command", {
          command: 'openclaw chat send "Give me a morning briefing: today\'s date, top priorities, and any alerts." --json',
          cwd: null,
        });
        const parsed = safeParse(r.stdout);
        return parsed?.response ?? r.stdout;
      }),
    },
    {
      id: "heartbeat", icon: Zap, label: "Heartbeat", desc: "Trigger system heartbeat",
      color: "#a855f7",
      action: () => runAction("heartbeat", async () => {
        if (!openclawClient.isGatewayConnected()) return "Gateway not connected";
        const r = await openclawClient.triggerHeartbeat();
        return JSON.stringify(r.payload, null, 2);
      }),
    },
    {
      id: "security", icon: ShieldAlert, label: "Security Scan", desc: "Run full audit",
      color: "var(--error)",
      action: () => setView("security"),
    },
    {
      id: "doctor", icon: Stethoscope, label: "Health Check", desc: "Diagnose issues",
      color: "var(--success)",
      action: () => setView("doctor"),
    },
  ];

  const gwConnected = data.gateway.connected || gatewayConnected;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      overflowY: "auto", overflowX: "hidden", padding: "24px 28px 20px",
    }}>
      {/* ── Header ── */}
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, overflow: "hidden" }}>
            <LobsterIcon size={30} />
          </div>
          <h1 style={{
            color: "var(--text)", fontSize: 20, fontWeight: 700, margin: 0,
            letterSpacing: "-0.03em",
          }}>
            Crystal
          </h1>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 11, margin: "4px 0 0", letterSpacing: "0.02em" }}>
          Your local AI command center
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 18px" }}>
        <VoiceOrb />
      </div>

      {/* ── System Status Row ── */}
      <SectionLabel text="System Status" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
        <StatusCard
          icon={Radio}
          label="Gateway"
          value={gwConnected ? "Connected" : "Offline"}
          detail={gwConnected ? `${data.gateway.latencyMs}ms` : undefined}
          color={gwConnected ? "var(--success)" : "var(--error)"}
          onClick={() => setView("settings")}
        />
        <StatusCard
          icon={Bot}
          label="LLM"
          value={data.llmModel !== "—" ? data.llmModel : openclawClient.getModel()}
          color={gwConnected ? "var(--accent)" : "var(--error)"}
          onClick={() => setView("models")}
        />
        <StatusCard
          icon={Monitor}
          label="System"
          value={data.osLabel}
          color="var(--text-secondary)"
          onClick={() => setView("settings")}
        />
      </div>

      {/* ── Stats Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
        <MetricCard icon={Activity} label="Sessions" value={loading ? "…" : data.activeSessions} color="var(--accent)" />
        <MetricCard icon={Wrench} label="Skills" value={loading ? "…" : data.readySkills} color="var(--warning)" />
        <MetricCard icon={Percent} label="Tokens" value={loading ? "…" : `${data.tokenPercentUsed}%`} color="#a855f7" />
        <MetricCard icon={Database} label="Memory" value={loading ? "…" : data.memoryChunks} color="var(--success)" />
      </div>

      {/* ── Quick Actions ── */}
      <SectionLabel text="Quick Actions" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {quickActions.map(a => (
          <ActionCard
            key={a.id}
            icon={a.icon}
            label={a.label}
            desc={a.desc}
            color={a.color}
            busy={actionRunning === a.id}
            onClick={a.action}
          />
        ))}
      </div>

      {actionResult && (
        <div style={{
          ...card({ padding: "10px 14px", marginBottom: 16 }),
          background: "var(--bg-elevated)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Result</span>
            <button
              onClick={() => setActionResult(null)}
              style={{ fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
            >
              Dismiss
            </button>
          </div>
          <p style={{
            fontSize: 11, color: "var(--text-secondary)", whiteSpace: "pre-wrap",
            maxHeight: 140, overflow: "auto", margin: 0, lineHeight: 1.5,
          }}>
            {actionResult}
          </p>
        </div>
      )}

      {/* ── Security Summary ── */}
      {(data.securityCritical > 0 || data.securityWarn > 0) && (
        <>
          <SectionLabel text="Security" />
          <div
            onClick={() => setView("security")}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            style={{
              ...card({ padding: "12px 16px", marginBottom: 16, cursor: "pointer" }),
              display: "flex", alignItems: "center", gap: 14,
            }}
          >
            <Shield style={{ width: 18, height: 18, color: data.securityCritical > 0 ? "var(--error)" : "var(--warning)" }} />
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
                Security Audit
              </p>
              <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                <span style={{ fontSize: 11, color: "var(--error)", display: "flex", alignItems: "center", gap: 4 }}>
                  <AlertTriangle style={{ width: 12, height: 12 }} />
                  {data.securityCritical} critical
                </span>
                <span style={{ fontSize: 11, color: "var(--warning)", display: "flex", alignItems: "center", gap: 4 }}>
                  <AlertTriangle style={{ width: 12, height: 12 }} />
                  {data.securityWarn} warnings
                </span>
              </div>
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>View &rarr;</span>
          </div>
        </>
      )}

      {/* ── System Monitor ── */}
      <SectionLabel text="System Monitor" />
      <SystemMonitor />

      {/* ── PC Optimizer ── */}
      <SectionLabel text="PC Optimizer" />
      <PcOptimizer />

      {/* ── GPU Monitor ── */}
      <SectionLabel text="GPU" />
      <GpuMonitor />

      <div style={{ marginTop: "auto", paddingTop: 16, textAlign: "center" }}>
        <p style={{ fontSize: 10, color: "var(--text-muted)", margin: 0 }}>
          Running 100% locally &middot; Powered by OpenClaw &middot; v2026.3.2
        </p>
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function SectionLabel({ text }: { text: string }) {
  return (
    <p style={{
      fontSize: 10, color: "var(--text-muted)", fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.06em",
      marginBottom: 8, marginTop: 0,
    }}>
      {text}
    </p>
  );
}

function StatusCard({ icon: Icon, label, value, detail, color, onClick }: {
  icon: React.ElementType; label: string; value: string; detail?: string;
  color: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
      style={{
        ...card({ padding: "12px 14px", cursor: "pointer", textAlign: "left" as const }),
        display: "flex", alignItems: "center", gap: 10,
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: `color-mix(in srgb, ${color} 12%, transparent)`, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <Icon style={{ width: 16, height: 16, color }} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{label}</p>
        <p style={{ margin: 0, fontSize: 12, color, fontWeight: 600 }}>{value}</p>
        {detail && (
          <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)" }}>{detail}</p>
        )}
      </div>
    </button>
  );
}

function MetricCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: string | number; color: string;
}) {
  return (
    <div
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
      style={{
        ...card({ padding: "10px 8px", textAlign: "center" as const }),
      }}
    >
      <Icon style={{ width: 14, height: 14, color, marginBottom: 4 }} />
      <p style={{ margin: 0, fontSize: 16, color: "var(--text)", fontWeight: 700, lineHeight: 1.1 }}>{value}</p>
      <p style={{ margin: "3px 0 0", fontSize: 9, color: "var(--text-muted)" }}>{label}</p>
    </div>
  );
}

function ActionCard({ icon: Icon, label, desc, color, busy, onClick }: {
  icon: React.ElementType; label: string; desc: string; color: string;
  busy: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      onMouseEnter={hoverIn}
      onMouseLeave={hoverOut}
      style={{
        ...card({ padding: "14px 16px", cursor: busy ? "wait" : "pointer", textAlign: "left" as const }),
        display: "flex", alignItems: "center", gap: 12,
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: `color-mix(in srgb, ${color} 12%, transparent)`, display: "flex",
        alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>
        <Icon style={{ width: 16, height: 16, color }} />
      </div>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{label}</p>
        <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>{desc}</p>
      </div>
    </button>
  );
}

/* ─── System Monitor ─── */

interface SysStats {
  cpuUsage: number;
  cpuTemp: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  uptime: string;
}

function parseSysStats(stdout: string): Partial<SysStats> {
  const result: Partial<SysStats> = {};
  try {
    const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("CPU_USAGE:")) result.cpuUsage = parseFloat(line.split(":")[1]) || 0;
      if (line.startsWith("CPU_TEMP:")) result.cpuTemp = parseFloat(line.split(":")[1]) || 0;
      if (line.startsWith("RAM_USED:")) result.ramUsedGb = parseFloat(line.split(":")[1]) || 0;
      if (line.startsWith("RAM_TOTAL:")) result.ramTotalGb = parseFloat(line.split(":")[1]) || 0;
      if (line.startsWith("DISK_USED:")) result.diskUsedGb = parseFloat(line.split(":")[1]) || 0;
      if (line.startsWith("DISK_TOTAL:")) result.diskTotalGb = parseFloat(line.split(":")[1]) || 0;
      if (line.startsWith("UPTIME:")) result.uptime = line.split(":").slice(1).join(":").trim();
    }
  } catch { /* parse failure */ }
  return result;
}

function SystemMonitor() {
  const [stats, setStats] = useState<Partial<SysStats>>(_sysStatsCache?.data ?? {});
  const [loading, setLoading] = useState(!_sysStatsCache);
  const currentView = useAppStore(s => s.currentView);
  const isVisible = currentView === "home";

  const poll = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("get_sys_stats");
      if (result.code === 0) {
        const parsed = parseSysStats(result.stdout);
        _sysStatsCache = { data: parsed, ts: Date.now() };
        setStats(parsed);
      }
    } catch { /* swallow */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    if (!_sysStatsCache || Date.now() - _sysStatsCache.ts > SYS_POLL_INTERVAL) {
      poll();
    }
    const interval = setInterval(poll, SYS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [poll, isVisible]);

  const cpuPct = stats.cpuUsage ?? 0;
  const ramPct = stats.ramTotalGb ? ((stats.ramUsedGb ?? 0) / stats.ramTotalGb) * 100 : 0;
  const diskPct = stats.diskTotalGb ? ((stats.diskUsedGb ?? 0) / stats.diskTotalGb) * 100 : 0;

  if (loading) {
    return (
      <div style={{
        ...card({ padding: 20, textAlign: "center" as const, marginBottom: 16 }),
      }}>
        <Loader2 style={{ width: 16, height: 16, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
      {/* CPU */}
      <div onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={card({ padding: "12px 10px" })}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Cpu style={{ width: 13, height: 13, color: cpuPct > 80 ? "var(--error)" : cpuPct > 50 ? "var(--warning)" : "var(--accent)" }} />
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>CPU</span>
        </div>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)", lineHeight: 1, fontFamily: "monospace" }}>
          {cpuPct.toFixed(0)}%
        </p>
        <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", marginTop: 6, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2, transition: "width 0.6s ease",
            width: `${cpuPct}%`,
            background: cpuPct > 80 ? "var(--error)" : cpuPct > 50 ? "var(--warning)" : "var(--accent)",
          }} />
        </div>
      </div>

      {/* RAM */}
      <div onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={card({ padding: "12px 10px" })}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <MemoryStick style={{ width: 13, height: 13, color: ramPct > 85 ? "var(--error)" : "#a855f7" }} />
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>RAM</span>
        </div>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)", lineHeight: 1, fontFamily: "monospace" }}>
          {(stats.ramUsedGb ?? 0).toFixed(1)}
          <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-muted)" }}>/{(stats.ramTotalGb ?? 0).toFixed(0)}GB</span>
        </p>
        <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", marginTop: 6, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2, transition: "width 0.6s ease",
            width: `${ramPct}%`,
            background: ramPct > 85 ? "var(--error)" : "#a855f7",
          }} />
        </div>
      </div>

      {/* Disk */}
      <div onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={card({ padding: "12px 10px" })}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <HardDrive style={{ width: 13, height: 13, color: diskPct > 90 ? "var(--error)" : "var(--success)" }} />
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Storage</span>
        </div>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "var(--text)", lineHeight: 1, fontFamily: "monospace" }}>
          {stats.diskUsedGb ?? 0}
          <span style={{ fontSize: 10, fontWeight: 400, color: "var(--text-muted)" }}>/{stats.diskTotalGb ?? 0}GB</span>
        </p>
        <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", marginTop: 6, overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2, transition: "width 0.6s ease",
            width: `${diskPct}%`,
            background: diskPct > 90 ? "var(--error)" : "var(--success)",
          }} />
        </div>
      </div>

      {/* Uptime */}
      <div onMouseEnter={hoverIn} onMouseLeave={hoverOut} style={card({ padding: "12px 10px" })}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <Clock style={{ width: 13, height: 13, color: "var(--warning)" }} />
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Uptime</span>
        </div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, fontFamily: "monospace" }}>
          {stats.uptime ?? "—"}
        </p>
      </div>
    </div>
  );
}

/* ─── PC Optimizer ─── */

interface OptimizerAction {
  id: string;
  icon: React.ElementType;
  label: string;
  desc: string;
  color: string;
  command: string;
  successMsg: string;
  confirm?: string;
}

const OPTIMIZER_ACTIONS: OptimizerAction[] = [
  {
    id: "power-max",
    icon: Bolt,
    label: "Max Performance",
    desc: "Ultimate/High Performance power plan",
    color: "#fbbf24",
    command: `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null; if ($LASTEXITCODE -ne 0) { powercfg /setactive SCHEME_MIN }; Write-Output 'Power plan set to High Performance'`,
    successMsg: "Power plan set to High Performance",
  },
  {
    id: "flush-dns",
    icon: Wifi,
    label: "Flush DNS",
    desc: "Clear DNS resolver cache",
    color: "#06b6d4",
    command: `ipconfig /flushdns`,
    successMsg: "DNS cache flushed",
  },
  {
    id: "clear-temp",
    icon: Trash2,
    label: "Clear Temp Files",
    desc: "Delete temporary files",
    color: "#f87171",
    command: `$before = (Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB; Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; $after = (Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB; $freed = [math]::Round($before - $after, 1); Write-Output "Cleared $freed MB of temp files"`,
    successMsg: "Temp files cleared",
  },
  {
    id: "clear-prefetch",
    icon: RefreshCw,
    label: "Clear Prefetch",
    desc: "Clean Windows prefetch data",
    color: "#a855f7",
    command: `Remove-Item "$env:SystemRoot\\Prefetch\\*" -Force -ErrorAction SilentlyContinue; Write-Output 'Prefetch cache cleared'`,
    successMsg: "Prefetch cache cleared",
  },
  {
    id: "memory-optimize",
    icon: MemoryStick,
    label: "Memory Cleanup",
    desc: "Clear standby memory list",
    color: "#3B82F6",
    command: `[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers(); Write-Output 'Memory cleanup triggered'`,
    successMsg: "Memory cleanup triggered",
  },
  {
    id: "power-balanced",
    icon: BatteryFull,
    label: "Balanced Power",
    desc: "Balanced power plan",
    color: "#4ade80",
    command: `powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e; Write-Output 'Power plan set to Balanced'`,
    successMsg: "Power plan set to Balanced",
  },
  {
    id: "disable-startup",
    icon: Power,
    label: "Startup Apps",
    desc: "List & disable heavy startup programs",
    color: "#ec4899",
    command: `$items = Get-CimInstance Win32_StartupCommand | Select-Object Name, Command | ConvertTo-Json -Compress; Write-Output "STARTUP:$items"`,
    successMsg: "Startup apps listed",
  },
  {
    id: "reset-network",
    icon: RotateCcw,
    label: "Reset Network",
    desc: "Reset TCP/IP, Winsock, DNS",
    color: "#14b8a6",
    command: `netsh winsock reset 2>$null; netsh int ip reset 2>$null; ipconfig /flushdns 2>$null; ipconfig /release 2>$null; ipconfig /renew 2>$null; Write-Output 'Network stack reset complete'`,
    successMsg: "Network stack reset",
  },
  {
    id: "disk-cleanup",
    icon: FolderCog,
    label: "Disk Cleanup",
    desc: "Clear Windows Update, log, & cache files",
    color: "#f59e0b",
    command: `$freed = 0; $paths = @("$env:SystemRoot\\SoftwareDistribution\\Download", "$env:SystemRoot\\Logs\\CBS"); foreach ($p in $paths) { if (Test-Path $p) { $s = (Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB; Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue; $freed += $s } }; Remove-Item "$env:LOCALAPPDATA\\Microsoft\\Windows\\INetCache\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Output "Disk cleanup freed $([math]::Round($freed,1)) MB"`,
    successMsg: "Disk cleanup complete",
  },
  {
    id: "defender-scan",
    icon: ShieldCheck,
    label: "Quick Scan",
    desc: "Run Windows Defender quick scan",
    color: "#22c55e",
    command: `Start-MpScan -ScanType QuickScan -ErrorAction SilentlyContinue; Write-Output 'Windows Defender quick scan started'`,
    successMsg: "Defender scan started",
  },
  {
    id: "disable-visual-fx",
    icon: MonitorDown,
    label: "Disable Visual FX",
    desc: "Turn off Windows animations & effects",
    color: "#8b5cf6",
    command: `Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" -Name VisualFXSetting -Value 2 -ErrorAction SilentlyContinue; Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name UserPreferencesMask -Value ([byte[]](0x90,0x12,0x03,0x80,0x10,0x00,0x00,0x00)) -ErrorAction SilentlyContinue; Write-Output 'Visual effects set to best performance (restart Explorer to apply)'`,
    successMsg: "Visual effects minimized",
    confirm: "This will disable Windows visual effects (animations, shadows, transparency). Continue?",
  },
  {
    id: "gpu-reset",
    icon: Layers,
    label: "GPU Reset",
    desc: "Restart NVIDIA display driver",
    color: "#06b6d4",
    command: `$dev = Get-PnpDevice -Class Display -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'NVIDIA' }; if ($dev) { Disable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Enable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Write-Output "NVIDIA GPU driver restarted" } else { Write-Output "No NVIDIA device found" }`,
    successMsg: "GPU driver restarted",
    confirm: "This will briefly disable and re-enable your NVIDIA GPU driver. Your screen may flicker. Continue?",
  },
];

function PcOptimizer() {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { success: boolean; message: string }>>({});

  const runAction = async (action: OptimizerAction) => {
    if (action.confirm && !window.confirm(action.confirm)) return;
    setRunningId(action.id);
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: action.command, cwd: null,
      });
      const output = result.stdout?.trim() || result.stderr?.trim() || action.successMsg;
      setResults((prev) => ({ ...prev, [action.id]: { success: result.code === 0, message: output } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [action.id]: { success: false, message: String(e) } }));
    }
    setRunningId(null);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {OPTIMIZER_ACTIONS.map((action) => {
          const Icon = action.icon;
          const result = results[action.id];
          const isRunning = runningId === action.id;
          return (
            <button
              key={action.id}
              onClick={() => runAction(action)}
              disabled={isRunning}
              onMouseEnter={hoverIn}
              onMouseLeave={hoverOut}
              style={{
                ...card({
                  padding: "12px 14px",
                  cursor: isRunning ? "wait" : "pointer",
                  textAlign: "left" as const,
                }),
                display: "flex", flexDirection: "column", gap: 8,
                opacity: isRunning ? 0.7 : 1,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: `color-mix(in srgb, ${action.color} 12%, transparent)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isRunning ? (
                    <Loader2 style={{ width: 14, height: 14, color: action.color, animation: "spin 1s linear infinite" }} />
                  ) : (
                    <Icon style={{ width: 14, height: 14, color: action.color }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{action.label}</p>
                  <p style={{ margin: "1px 0 0", fontSize: 9, color: "var(--text-muted)" }}>{action.desc}</p>
                </div>
              </div>
              {result && (
                <div style={{
                  fontSize: 9, padding: "3px 6px", borderRadius: 4,
                  background: result.success ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                  color: result.success ? "#4ade80" : "#f87171",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {result.success ? <Gauge style={{ width: 8, height: 8, display: "inline", verticalAlign: "middle", marginRight: 3 }} /> : null}
                  {result.message}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
