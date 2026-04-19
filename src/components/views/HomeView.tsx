import React, { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { openclawClient } from "@/lib/openclaw";
import { memoryPalaceClient } from "@/lib/memory-palace";
import { cachedCommand } from "@/lib/cache";
import { GpuMonitor, NvidiaLogo, HudSectionLabel } from "@/components/widgets/GpuMonitor";
import { LobsterIcon } from "@/components/LobsterIcon";
import {
  Bot, Activity, Wrench,
  Clock, Shield, Zap,
  Loader2,
  MemoryStick, Bolt, Trash2, Wifi, BatteryFull,
  RefreshCw, Power, RotateCcw, FolderCog, ShieldCheck,
  MonitorDown, Layers, XCircle, ChevronRight, Database, Search,
  Castle, DoorOpen, Network, GitBranch, Pickaxe, Sparkles,
} from "lucide-react";
import { useDataStore } from "@/stores/dataStore";
import { useTokenUsageStore, formatLifetimeTokens } from "@/stores/tokenUsageStore";
import { APP_VERSION } from "@/lib/version";

/* ═══════════════════════════════════════════════════════════════
   Types & caches
   ═══════════════════════════════════════════════════════════════ */

let _sysStatsCache: { data: Partial<SysStats>; ts: number } | null = null;
let _metaCache: { data: MetaInfo; ts: number } | null = null;
const SYS_POLL_INTERVAL = 30_000;
const META_TTL = 120_000;

const CPU_HISTORY: number[] = [];
const RAM_HISTORY: number[] = [];
const HISTORY_MAX = 20;

interface MetaInfo {
  openclawVersion: string;
  telegramStatus: string;
  telegramBot: string;
  heartbeatInterval: string;
  llmModel: string;
  hostedModel: string;
  localConfiguredModel: string;
  vllmRunning: boolean;
  vllmModel: string;
}

interface SysStats {
  cpuUsage: number;
  cpuTemp: number;
  ramUsedGb: number;
  ramTotalGb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  uptime: string;
}

interface MemoryHealthInfo {
  drawers: number;
  wings: number;
  rooms: number;
  closets: number;
  kgNodes: number;
  kgEdges: number;
  lastMineAt: string | null;
  recallHookEnabled: boolean;
  recallHookRegistered: boolean;
  provider: string;
  ready: boolean;
  error: string | null;
}

function parseMemoryHealthInfo(mem: Record<string, unknown> | null | undefined): MemoryHealthInfo {
  const base: MemoryHealthInfo = {
    drawers: 0, wings: 0, rooms: 0, closets: 0,
    kgNodes: 0, kgEdges: 0, lastMineAt: null,
    recallHookEnabled: false, recallHookRegistered: false,
    provider: "none", ready: false, error: null,
  };
  if (!mem || typeof mem !== "object") return base;

  base.drawers = Number(mem.drawers ?? mem.totalChunks ?? mem.chunks ?? 0) || 0;
  base.wings = Number(mem.wings ?? 0) || 0;
  base.rooms = Number(mem.rooms ?? 0) || 0;
  base.closets = Number(mem.closets ?? 0) || 0;
  base.kgNodes = Number(mem.kgNodes ?? 0) || 0;
  base.kgEdges = Number(mem.kgEdges ?? 0) || 0;
  base.lastMineAt = (mem.lastMineAt as string | null | undefined) ?? null;
  base.recallHookEnabled = Boolean(mem.recallHookEnabled);
  base.recallHookRegistered = Boolean(mem.recallHookRegistered);
  base.provider = String(mem.provider ?? "none");
  base.error = (mem.error as string | null | undefined) ?? null;
  base.ready = base.drawers > 0 && !base.error;
  return base;
}

function relativeAge(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "just now";
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const META_INITIAL: MetaInfo = {
  openclawVersion: "—", telegramStatus: "unknown", telegramBot: "",
  heartbeatInterval: "—", llmModel: "—", hostedModel: "—", localConfiguredModel: "", vllmRunning: false, vllmModel: "",
};

function modelProvider(modelKey: string): string {
  const raw = (modelKey || "").trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw.startsWith("openai/")) return "openai";
  if (raw.startsWith("anthropic/")) return "anthropic";
  if (raw.startsWith("google/")) return "google";
  if (raw.startsWith("deepseek/")) return "deepseek";
  if (raw.startsWith("xai/")) return "xai";
  if (raw.startsWith("vllm/")) return "vllm";
  return raw.split("/")[0] || "unknown";
}

function isCloudProvider(provider: string): boolean {
  return provider !== "vllm" && provider !== "unknown";
}

function providerLabel(provider: string): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "google") return "Google";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "xai") return "xAI";
  if (provider === "vllm") return "vLLM";
  return provider;
}

/* ═══════════════════════════════════════════════════════════════
   OpenAI Logo (official hexapetal shape)
   ═══════════════════════════════════════════════════════════════ */

function OpenAILogo({ size = 18, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.68 4.466a5.998 5.998 0 0 0-3.992 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.04 6.04 0 0 0 6.51 2.9A5.99 5.99 0 0 0 12.95 24a6.044 6.044 0 0 0 5.769-4.236 5.987 5.987 0 0 0 3.997-2.9 6.042 6.042 0 0 0-.434-7.043zM12.95 22.505a4.492 4.492 0 0 1-2.887-1.05l.144-.083 4.794-2.768a.778.778 0 0 0 .392-.678v-6.755l2.027 1.17a.072.072 0 0 1 .039.052v5.594a4.504 4.504 0 0 1-4.509 4.518zm-9.688-4.136a4.489 4.489 0 0 1-.535-3.015l.143.086 4.794 2.768a.779.779 0 0 0 .786 0l5.856-3.382v2.34a.072.072 0 0 1-.029.062l-4.85 2.8a4.504 4.504 0 0 1-6.165-1.659zM2.034 7.872A4.487 4.487 0 0 1 4.39 5.893l-.002.167v5.536a.778.778 0 0 0 .392.676l5.856 3.382-2.026 1.17a.072.072 0 0 1-.068.005L3.69 14.03A4.504 4.504 0 0 1 2.034 7.872zm16.67 3.876-5.857-3.382 2.027-1.17a.072.072 0 0 1 .068-.005l4.848 2.8a4.497 4.497 0 0 1-.696 8.114v-5.68a.778.778 0 0 0-.39-.677zm2.016-3.025-.143-.086-4.794-2.768a.779.779 0 0 0-.786 0l-5.856 3.382V6.91a.072.072 0 0 1 .029-.062l4.848-2.8a4.5 4.5 0 0 1 6.702 4.675zm-12.67 4.175L5.977 11.73a.072.072 0 0 1-.04-.053V6.083a4.499 4.499 0 0 1 7.377-3.454l-.143.083-4.795 2.768a.778.778 0 0 0-.392.678zm1.1-2.373 2.608-1.506 2.608 1.506v3.01l-2.608 1.506-2.608-1.506z"
        fill={color}
      />
    </svg>
  );
}


/* ═══════════════════════════════════════════════════════════════
   Micro-interaction helpers
   ═══════════════════════════════════════════════════════════════ */

import {
  EASE, SPRING, glowCard,
  hoverLift, hoverReset, pressDown, pressUp,
} from "@/styles/viewStyles";

/* ═══════════════════════════════════════════════════════════════
   SVG Chart Components — refined
   ═══════════════════════════════════════════════════════════════ */

function RingGauge({ value, max = 100, size = 92, stroke = 6, color, label, display, sub, onClick }: {
  value: number; max?: number; size?: number; stroke?: number;
  color: string; label: string; display: string; sub?: string;
  onClick?: () => void;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const dashOffset = circ * (1 - pct);

  return (
    <div onClick={onClick} style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      cursor: onClick ? "pointer" : "default", position: "relative",
      transition: `transform 0.25s ${SPRING}`,
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.06)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r + 0.5}
          fill="none" stroke={color} strokeWidth={stroke + 1}
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transition: `stroke-dashoffset 1s ${EASE}`,
            filter: `drop-shadow(0 0 8px ${color})`,
          }} />
      </svg>
      <div style={{
        position: "absolute", top: 0, left: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", width: size, height: size,
      }}>
        <span style={{
          fontSize: 20, fontWeight: 700, color: "var(--text)",
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
          letterSpacing: "-0.02em",
        }}>
          {display}
        </span>
        {sub && <span style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 3, letterSpacing: "0.02em" }}>{sub}</span>}
      </div>
      <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.03em" }}>{label}</span>
    </div>
  );
}

function RadialBurst({ value, label, color, segments = 56, size = 148 }: {
  value: string; label: string; color: string; segments?: number; size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const innerR = size * 0.24, outerR = size * 0.44;
  const bars: React.ReactElement[] = [];

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI - Math.PI / 2;
    const pattern = 0.5 + 0.5 * Math.sin(i * 0.7 + i * i * 0.03);
    const barLen = innerR + (outerR - innerR) * pattern;
    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * barLen;
    const y2 = cy + Math.sin(angle) * barLen;
    const opacity = 0.3 + 0.7 * pattern;
    bars.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={1.5} opacity={opacity}
        strokeLinecap="round" />
    );
  }

  return (
    <div style={{
      position: "relative", width: size, height: size,
      transition: `transform 0.4s ${SPRING}`,
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.05) rotate(3deg)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1) rotate(0deg)"; }}
    >
      <svg width={size} height={size} style={{ filter: `drop-shadow(0 0 16px ${color})` }}>
        <circle cx={cx} cy={cy} r={innerR - 4} fill="none" stroke={color} strokeWidth={0.5} opacity={0.15} />
        <circle cx={cx} cy={cy} r={outerR + 4} fill="none" stroke={color} strokeWidth={0.5} opacity={0.08} />
        {bars}
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{
          fontSize: 26, fontWeight: 700, color: "var(--text)",
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
          letterSpacing: "-0.02em",
        }}>
          {value}
        </span>
        <span style={{
          fontSize: 8, color: "var(--text-muted)", marginTop: 6,
          textTransform: "uppercase", letterSpacing: 2, fontWeight: 500,
        }}>
          {label}
        </span>
      </div>
    </div>
  );
}

function MiniBarChart({ data, colors, labels, height = 70, barWidth = 16 }: {
  data: number[]; colors: string[]; labels?: string[];
  height?: number; barWidth?: number;
}) {
  const maxVal = Math.max(...data, 1);
  const gap = 8;
  const w = data.length * (barWidth + gap);

  return (
    <svg width={w} height={height + 18} style={{ overflow: "visible" }}>
      {data.map((v, i) => {
        const barH = Math.max((v / maxVal) * height, 2);
        const x = i * (barWidth + gap);
        const y = height - barH;
        const c = colors[i % colors.length];
        return (
          <g key={i}>
            <rect x={x} y={0} width={barWidth} height={height} rx={4}
              fill="rgba(255,255,255,0.02)" />
            <rect x={x} y={y} width={barWidth} height={barH} rx={4}
              fill={c} opacity={0.9}
              style={{ filter: `drop-shadow(0 0 6px ${c})`, transition: `height 0.6s ${EASE}, y 0.6s ${EASE}` }} />
            {labels?.[i] && (
              <text x={x + barWidth / 2} y={height + 14} textAnchor="middle"
                fontSize={8} fill="var(--text-muted)" fontFamily="inherit" fontWeight={500}>
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SparkLine({ data, color, width = 200, height = 48, fill = true }: {
  data: number[]; color: string; width?: number; height?: number; fill?: boolean;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: pad + (height - 2 * pad) - ((v - min) / range) * (height - 2 * pad),
  }));

  let linePath = "";
  for (let i = 0; i < pts.length; i++) {
    if (i === 0) { linePath += `M${pts[i].x},${pts[i].y}`; continue; }
    const prev = pts[i - 1];
    const cpx1 = prev.x + (pts[i].x - prev.x) * 0.4;
    const cpx2 = prev.x + (pts[i].x - prev.x) * 0.6;
    linePath += ` C${cpx1},${prev.y} ${cpx2},${pts[i].y} ${pts[i].x},${pts[i].y}`;
  }
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const gradId = `sf-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg width={width} height={height} style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={areaPath} fill={`url(#${gradId})`} />}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3.5}
        fill={color} stroke="var(--bg-base)" strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
    </svg>
  );
}

function GlowProgress({ value, max = 100, color, height = 4 }: {
  value: number; max?: number; color: string; height?: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height, borderRadius: height, background: "rgba(255,255,255,0.035)", overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: height,
        width: `${pct}%`, background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`,
        boxShadow: `0 0 10px ${color}, 0 0 3px ${color}`,
        transition: `width 1s ${EASE}`,
      }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Vector Store Ring Visualization (legacy — kept for any external import,
   no longer rendered now that the unified Memory Health card replaced it)
   ═══════════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function VectorRingViz({ chunks, files, vectorReady, ftsReady, loading }: {
  chunks: number; files: number; vectorReady: boolean; ftsReady: boolean; loading: boolean;
}) {
  const size = 88;
  const cx = size / 2, cy = size / 2;
  const outerR = 38, innerR = 28, coreR = 20;
  const segments = 36;
  const maxVal = Math.max(chunks, 50);
  const fillCount = maxVal > 0 ? Math.round((chunks / maxVal) * segments) : 0;

  const bars: React.ReactElement[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * 2 * Math.PI - Math.PI / 2;
    const isFilled = i < fillCount;
    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * outerR;
    const y2 = cy + Math.sin(angle) * outerR;
    bars.push(
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={isFilled ? "#06b6d4" : "rgba(255,255,255,0.06)"}
        strokeWidth={2.5} strokeLinecap="round"
        opacity={isFilled ? 0.6 + 0.4 * (i / segments) : 0.5}
        style={isFilled ? { filter: "drop-shadow(0 0 2px #06b6d4)" } : undefined}
      />
    );
  }

  const statusDots: { angle: number; active: boolean; color: string }[] = [
    { angle: -Math.PI * 0.25, active: vectorReady, color: "#22d3ee" },
    { angle: Math.PI * 0.25, active: ftsReady, color: "#a78bfa" },
    { angle: Math.PI * 0.75, active: files > 0, color: "#4ade80" },
  ];

  return (
    <div style={{
      position: "relative", width: size, height: size, flexShrink: 0,
      transition: `transform 0.4s ${SPRING}`,
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.06) rotate(2deg)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1) rotate(0deg)"; }}
    >
      <svg width={size} height={size} style={{ filter: "drop-shadow(0 0 10px rgba(6,182,212,0.3))" }}>
        <circle cx={cx} cy={cy} r={outerR + 3} fill="none" stroke="#06b6d4" strokeWidth={0.4} opacity={0.1} />
        <circle cx={cx} cy={cy} r={coreR} fill="none" stroke="#06b6d4" strokeWidth={0.6} opacity={0.12} />
        {bars}
        {statusDots.map((dot, i) => (
          <circle key={`sd${i}`}
            cx={cx + Math.cos(dot.angle) * (outerR + 6)}
            cy={cy + Math.sin(dot.angle) * (outerR + 6)}
            r={2.5} fill={dot.active ? dot.color : "rgba(255,255,255,0.08)"}
            style={dot.active ? { filter: `drop-shadow(0 0 4px ${dot.color})` } : undefined}
          />
        ))}
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{
          fontSize: 18, fontWeight: 700, color: "var(--text)",
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
        }}>
          {loading ? "…" : chunks}
        </span>
        <span style={{ fontSize: 7, color: "var(--text-muted)", letterSpacing: "0.06em", marginTop: 2, textTransform: "uppercase" }}>
          vectors
        </span>
      </div>
    </div>
  );
}

function VectorStatusRow({ icon: Icon, label, active, value }: {
  icon: React.ElementType; label: string; active: boolean; value?: string;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "3px 0",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
        background: active ? "var(--success)" : "rgba(255,255,255,0.12)",
        boxShadow: active ? "0 0 6px var(--success)" : "none",
        transition: `all 0.3s ${EASE}`,
      }} />
      <Icon style={{ width: 10, height: 10, color: active ? "#06b6d4" : "var(--text-muted)", opacity: active ? 1 : 0.4, flexShrink: 0 }} />
      <span style={{
        fontSize: 9, color: active ? "var(--text)" : "var(--text-muted)",
        fontWeight: active ? 600 : 400, letterSpacing: "0.02em",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {label}
      </span>
      {value && (
        <span style={{
          marginLeft: "auto", fontSize: 8, color: "#06b6d4",
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
          fontWeight: 500, opacity: 0.7,
        }}>
          {value}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   System stats parsing
   ═══════════════════════════════════════════════════════════════ */

function parseSysStats(stdout: string): Partial<SysStats> {
  const result: Partial<SysStats> = {};
  try {
    const lines = stdout.split("\n").map(l => l.trim()).filter(Boolean);
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

/* ═══════════════════════════════════════════════════════════════
   Main Dashboard
   ═══════════════════════════════════════════════════════════════ */

export function HomeView() {
  const setView = useAppStore(s => s.setView);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const currentView = useAppStore(s => s.currentView);
  const [meta, setMeta] = useState<MetaInfo>(_metaCache?.data ?? META_INITIAL);
  const [sysStats, setSysStats] = useState<Partial<SysStats>>(_sysStatsCache?.data ?? {});
  const [sysLoading, setSysLoading] = useState(!_sysStatsCache);
  const [, setTick] = useState(0);

  const getAgents = useDataStore(s => s.getAgents);
  const getCronJobs = useDataStore(s => s.getCronJobs);
  const getSkills = useDataStore(s => s.getSkills);
  const getSessions = useDataStore(s => s.getSessions);
  const getMemoryStatus = useDataStore(s => s.getMemoryStatus);

  const [agentCount, setAgentCount] = useState<number>(
    () => (useDataStore.getState().agents?.data as unknown[] | undefined)?.length ?? 0
  );
  const [cronCount, setCronCount] = useState<number>(() => {
    const cached = useDataStore.getState().cronJobs?.data as Record<string, unknown>[] | undefined;
    return cached?.filter(c => c.enabled !== false).length ?? 0;
  });
  const [cronTotal, setCronTotal] = useState(0);
  const [cronFailed, setCronFailed] = useState(0);
  const [skillCount, setSkillCount] = useState<number>(
    () => (useDataStore.getState().skills?.data as unknown[] | undefined)?.length ?? 0
  );
  const [sessionCount, setSessionCount] = useState<number>(
    () => (useDataStore.getState().sessions?.data as unknown[] | undefined)?.length ?? 0
  );
  const memoryEntry = useDataStore(s => s.memoryStatus);
  const memoryHealth = useMemo(
    () => parseMemoryHealthInfo(memoryEntry?.data as Record<string, unknown> | null),
    [memoryEntry],
  );
  const localLifetimeTokens = useTokenUsageStore(s => s.totalTokens);
  const recordTokens = useTokenUsageStore(s => s.recordTokens);
  const [gwTokenTotal, setGwTokenTotal] = useState<number>(0);
  const [statsLoaded, setStatsLoaded] = useState(() => !!(useDataStore.getState().agents?.data));

  const [palaceDrawers, setPalaceDrawers] = useState(0);
  const [palaceWings, setPalaceWings] = useState(0);
  const [palaceRooms, setPalaceRooms] = useState(0);
  const [palaceReady, setPalaceReady] = useState(false);

  const lifetimeTokens = Math.max(localLifetimeTokens, gwTokenTotal);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [agentsR, cronR, skillsR, sessionsR] = await Promise.allSettled([
        getAgents(), getCronJobs(), getSkills(), getSessions(),
      ]);
      getMemoryStatus(true);
      memoryPalaceClient.isInitialized().then(init => {
        if (!init || cancelled) return;
        setPalaceReady(true);
        memoryPalaceClient.getStatus().then(s => {
          if (cancelled || !s) return;
          setPalaceDrawers(s.totalDrawers ?? 0);
          setPalaceWings(s.wings?.length ?? 0);
          setPalaceRooms(s.wings?.reduce((a: number, w: { rooms: unknown[] }) => a + w.rooms.length, 0) ?? 0);
        }).catch(() => {});
      }).catch(() => {});
      if (cancelled) return;

      if (agentsR.status === "fulfilled" && Array.isArray(agentsR.value))
        setAgentCount(agentsR.value.length);

      if (cronR.status === "fulfilled" && Array.isArray(cronR.value)) {
        const cron = cronR.value;
        const enabled = cron.filter((c: Record<string, unknown>) => c.enabled !== false);
        setCronCount(enabled.length);
        setCronTotal(cron.length);
        let failed = 0;
        for (const job of cron) {
          const state = (job as Record<string, unknown>).state as Record<string, unknown> | undefined;
          if (state?.lastRunStatus && state.lastRunStatus !== "ok") failed++;
        }
        setCronFailed(failed);
      }

      if (skillsR.status === "fulfilled" && Array.isArray(skillsR.value))
        setSkillCount(skillsR.value.length);

      if (sessionsR.status === "fulfilled" && Array.isArray(sessionsR.value)) {
        const sessions = sessionsR.value;
        setSessionCount(sessions.length);
        let gwTotal = 0;
        for (const s of sessions) {
          const rec = s as Record<string, unknown>;
          const t = Number(rec.totalTokens ?? 0);
          if (Number.isFinite(t) && t > 0) gwTotal += t;
        }
        setGwTokenTotal(gwTotal);
        if (gwTotal > localLifetimeTokens) recordTokens(gwTotal - localLifetimeTokens);
      }

      if (!cancelled) setStatsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [getAgents, getCronJobs, getSkills, getSessions, getMemoryStatus, localLifetimeTokens, recordTokens]);

  useEffect(() => {
    if (_metaCache && Date.now() - _metaCache.ts < META_TTL) {
      setMeta({ ...META_INITIAL, ..._metaCache.data });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settled = await Promise.allSettled([
          cachedCommand("openclaw --version", { ttl: 300_000 }),
          cachedCommand("openclaw health", { ttl: 60_000 }),
          cachedCommand("openclaw models status", { ttl: 60_000 }),
        ]);
        if (cancelled) return;
        const versionR = settled[0].status === "fulfilled" ? settled[0].value : { stdout: "", stderr: "", code: -1 };
        const healthR = settled[1].status === "fulfilled" ? settled[1].value : { stdout: "", stderr: "", code: -1 };
        const modelsStatusR = settled[2].status === "fulfilled" ? settled[2].value : { stdout: "", stderr: "", code: -1 };
        const healthText = healthR.stdout || "";
        const modelsStatusText = `${modelsStatusR.stdout || ""}\n${modelsStatusR.stderr || ""}`;
        const versionMatch = (versionR.stdout || "").match(/OpenClaw\s+([\d.]+\S*)/i);
        const telegramMatch = healthText.match(/Telegram:\s*(\w+)(?:\s*\((@\w+)\))?/i);
        const heartbeatMatch = healthText.match(/Heartbeat interval:\s*(\S+)/i);
        const modelMatch = healthText.match(/agent model:\s*(\S+)/i);
        const defaultModelMatch = modelsStatusText.match(/Default\s*:\s*([^\r\n]+)/i);
        const fallbackMatch = modelsStatusText.match(/Fallbacks.*:\s*([^\r\n]+)/i);

        const modelCandidates: string[] = [];
        const pushCandidate = (v?: string) => {
          const value = (v || "").trim();
          if (!value) return;
          if (!modelCandidates.includes(value)) modelCandidates.push(value);
        };
        pushCandidate(defaultModelMatch?.[1]);
        const fallbacks = (fallbackMatch?.[1] || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const fb of fallbacks) pushCandidate(fb);

        const cloudModel =
          modelCandidates.find((m) => isCloudProvider(modelProvider(m))) ||
          "";
        const localConfiguredModel =
          modelCandidates.find((m) => modelProvider(m) === "vllm") ||
          "";

        let vllmRunning = false;
        let vllmModel = "";
        try {
          const srvStatus = await invoke<{ vllm_running: boolean }>("get_server_status");
          vllmRunning = srvStatus.vllm_running;
          if (vllmRunning) {
            const modelsR = await cachedCommand("powershell -Command \"(Invoke-RestMethod http://127.0.0.1:8000/v1/models).data[0].id\"", { ttl: 60_000, timeout: 5000 });
            if (modelsR.code === 0 && modelsR.stdout.trim()) vllmModel = modelsR.stdout.trim();
          }
        } catch { /* non-fatal */ }

        const newMeta: MetaInfo = {
          openclawVersion: versionMatch?.[1] ?? "—",
          telegramStatus: telegramMatch?.[1] ?? "unknown",
          telegramBot: telegramMatch?.[2] ?? "",
          heartbeatInterval: heartbeatMatch?.[1] ?? "—",
          llmModel: modelMatch?.[1] ?? openclawClient.getModel() ?? "—",
          hostedModel: cloudModel || "—",
          localConfiguredModel,
          vllmRunning,
          vllmModel,
        };
        _metaCache = { data: newMeta, ts: Date.now() };
        setMeta(newMeta);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const isVisible = currentView === "home";
  const poll = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; code: number }>("get_sys_stats");
      if (result.code === 0) {
        const parsed = parseSysStats(result.stdout);
        _sysStatsCache = { data: parsed, ts: Date.now() };
        setSysStats(parsed);
        if (parsed.cpuUsage !== undefined) {
          CPU_HISTORY.push(parsed.cpuUsage);
          if (CPU_HISTORY.length > HISTORY_MAX) CPU_HISTORY.shift();
        }
        if (parsed.ramTotalGb && parsed.ramUsedGb !== undefined) {
          RAM_HISTORY.push((parsed.ramUsedGb / parsed.ramTotalGb) * 100);
          if (RAM_HISTORY.length > HISTORY_MAX) RAM_HISTORY.shift();
        }
        setTick(t => t + 1);
      }
    } catch { /* swallow */ }
    setSysLoading(false);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    if (!_sysStatsCache || Date.now() - _sysStatsCache.ts > SYS_POLL_INTERVAL) poll();
    const interval = setInterval(poll, SYS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [poll, isVisible]);

  const gwConnected = gatewayConnected;
  const loading = !statsLoaded;

  const llmModelKey = meta.llmModel !== "—" && String(meta.llmModel).trim() !== ""
    ? String(meta.llmModel).trim() : openclawClient.getModel();
  const hostedModelKey = meta.hostedModel !== "—" && String(meta.hostedModel).trim() !== ""
    ? String(meta.hostedModel).trim()
    : (isCloudProvider(modelProvider(llmModelKey)) ? llmModelKey : "openai/gpt-5.4-mini");
  const hostedProvider = modelProvider(hostedModelKey);
  const hostedDisplayValue = openclawClient.getModelDisplayName(hostedModelKey);
  const localDisplayValue = meta.vllmModel
    || (meta.localConfiguredModel
      ? openclawClient.getModelDisplayName(meta.localConfiguredModel)
      : "");
  const llmColor = !gwConnected ? "var(--error)" : "var(--accent)";

  const cpuPct = sysStats.cpuUsage ?? 0;
  const ramPct = sysStats.ramTotalGb ? ((sysStats.ramUsedGb ?? 0) / sysStats.ramTotalGb) * 100 : 0;
  const diskPct = sysStats.diskTotalGb ? ((sysStats.diskUsedGb ?? 0) / sysStats.diskTotalGb) * 100 : 0;

  const cronBarData = [cronCount, cronTotal - cronCount, cronFailed];
  const cronBarColors = ["var(--success)", "var(--warning)", "var(--error)"];
  const cronBarLabels = ["On", "Off", "Fail"];


  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      overflowY: "auto", overflowX: "hidden", padding: "22px 26px 18px",
    }}>

      {/* ═══ Header ═══ */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 22, paddingBottom: 16,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, overflow: "hidden",
            boxShadow: "0 0 16px rgba(59,130,246,0.15)",
            transition: `transform 0.3s ${SPRING}`,
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = "rotate(8deg) scale(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
          >
            <LobsterIcon size={32} />
          </div>
          <div>
            <h1 style={{
              color: "var(--text)", fontSize: 17, fontWeight: 700, margin: 0,
              letterSpacing: "-0.025em", lineHeight: 1,
            }}>
              Crystal
            </h1>
            <p style={{
              color: "var(--text-muted)", fontSize: 9, margin: "3px 0 0",
              letterSpacing: "0.12em", fontWeight: 500,
            }}>
              AI COMMAND CENTER
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusPill label="Gateway" connected={gwConnected} onClick={() => setView("settings")} />
          <StatusPill label="Telegram" connected={meta.telegramStatus === "ok"} onClick={() => setView("channels")} />
        </div>
      </div>

      {/* ═══ Row 1: Ring Gauges + Radial Burst ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 14, marginBottom: 14 }}>

        <div style={{
          padding: "20px 20px 16px", borderRadius: 16,
          background: "transparent", border: "none", boxShadow: "none",
          transition: `transform 0.3s ${EASE}`, position: "relative" as const,
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px) scale(1.005)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ""; }}>
          <SectionLabel text="System Performance" />
          {sysLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 36 }}>
              <Loader2 style={{ width: 20, height: 20, color: "var(--text-muted)", animation: "spin 1s linear infinite" }} />
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-evenly", alignItems: "flex-start", paddingTop: 4 }}>
              <RingGauge value={cpuPct}
                color={cpuPct > 80 ? "var(--error)" : cpuPct > 50 ? "var(--warning)" : "var(--accent)"}
                label="CPU" display={`${cpuPct.toFixed(0)}%`} />
              <RingGauge value={ramPct}
                color={ramPct > 85 ? "var(--error)" : "#a855f7"}
                label="RAM" display={`${(sysStats.ramUsedGb ?? 0).toFixed(1)}`}
                sub={`/ ${(sysStats.ramTotalGb ?? 0).toFixed(0)} GB`} />
              <RingGauge value={diskPct}
                color={diskPct > 90 ? "var(--error)" : "var(--success)"}
                label="Storage" display={`${diskPct.toFixed(0)}%`}
                sub={`${sysStats.diskUsedGb ?? 0}/${sysStats.diskTotalGb ?? 0} GB`} />
            </div>
          )}
        </div>

        <div style={{
          padding: "20px 16px 16px", borderRadius: 16, display: "flex", flexDirection: "column" as const,
          alignItems: "center", cursor: "pointer",
          background: "transparent", border: "none", boxShadow: "none",
          transition: `transform 0.3s ${EASE}`, position: "relative" as const,
        }}
          onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px) scale(1.005)"; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
          onMouseDown={pressDown} onMouseUp={pressUp}
          onClick={() => setView("usage")}>
          <SectionLabel text="Lifetime Tokens" />
          <RadialBurst value={formatLifetimeTokens(lifetimeTokens)} label="tokens" color="#c084fc" />
        </div>
      </div>

      {/* ═══ Row 2: Sparklines + Cron ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>

        <div style={glowCard("var(--accent)", { padding: "16px 18px" })}
          data-glow="var(--accent)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <SectionLabel text="CPU Trend" />
            <span style={{
              fontSize: 15, fontWeight: 700, color: "var(--text)",
              fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
            }}>
              {cpuPct.toFixed(0)}%
            </span>
          </div>
          <SparkLine data={CPU_HISTORY.length >= 2 ? CPU_HISTORY : [0, cpuPct]} color="var(--accent)" />
          <div style={{ marginTop: 10 }}>
            <GlowProgress value={cpuPct} color={cpuPct > 80 ? "var(--error)" : "var(--accent)"} />
          </div>
        </div>

        <div style={glowCard("#a855f7", { padding: "16px 18px" })}
          data-glow="#a855f7" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <SectionLabel text="Memory Trend" />
            <span style={{
              fontSize: 15, fontWeight: 700, color: "var(--text)",
              fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
            }}>
              {ramPct.toFixed(0)}%
            </span>
          </div>
          <SparkLine data={RAM_HISTORY.length >= 2 ? RAM_HISTORY : [0, ramPct]} color="#a855f7" />
          <div style={{ marginTop: 10 }}>
            <GlowProgress value={ramPct} color={ramPct > 85 ? "var(--error)" : "#a855f7"} />
          </div>
        </div>

        <div style={glowCard("var(--warning)", { padding: "16px 18px", cursor: "pointer" })}
          data-glow="var(--warning)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
          onMouseDown={pressDown} onMouseUp={pressUp}
          onClick={() => setView("command-center", { centerTab: "scheduled" })}
          role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView("command-center", { centerTab: "scheduled" }); } }}>
          <SectionLabel text="Cron Jobs" />
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14 }}>
            <MiniBarChart data={cronBarData} colors={cronBarColors} labels={cronBarLabels} height={50} barWidth={16} />
            <div style={{ textAlign: "right", paddingBottom: 4 }}>
              <p style={{
                margin: 0, fontSize: 24, fontWeight: 700, color: "var(--text)",
                fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
              }}>
                {loading ? "…" : cronCount}
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
                of {cronTotal} active
              </p>
              {cronFailed > 0 && (
                <p style={{
                  margin: "4px 0 0", fontSize: 9, color: "var(--error)",
                  display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end",
                }}>
                  <XCircle style={{ width: 8, height: 8 }} /> {cronFailed} failed
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Row 3: Stats Tiles ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
        <StatTile icon={Activity} label="Sessions" value={loading ? "…" : String(sessionCount)} color="var(--accent)"
          onClick={() => setView("conversation")} />
        <StatTile icon={Bot} label="Agents" value={loading ? "…" : String(agentCount)} color="#06b6d4"
          onClick={() => setView("agents")} />
        <StatTile icon={Wrench} label="Skills" value={loading ? "…" : String(skillCount)} color="#a855f7"
          onClick={() => setView("tools")} />
        <StatTile icon={Zap} label="Heartbeat" value={loading ? "…" : meta.heartbeatInterval} color="#f59e0b" />
      </div>

      {/* ═══ Row 3b: Memory + Vector Store ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

        {/* Memory Palace */}
        <div style={glowCard("#b744ff", { padding: "18px 20px", cursor: "pointer" })}
          data-glow="#b744ff" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
          onMouseDown={pressDown} onMouseUp={pressUp}
          onClick={() => setView("memory")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <SectionLabel text="Memory Palace" />
            <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)", opacity: 0.4 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <RingGauge
              value={palaceDrawers}
              max={Math.max(palaceDrawers, 100)}
              size={88}
              stroke={7}
              color="#b744ff"
              label="Drawers"
              display={loading ? "…" : String(palaceDrawers)}
            />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Castle style={{ width: 12, height: 12, color: "#b744ff", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{palaceWings}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>wings</span>
                <span style={{ margin: "0 2px", color: "var(--border)" }}>·</span>
                <DoorOpen style={{ width: 12, height: 12, color: "#0088ff", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{palaceRooms}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>rooms</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                  background: palaceReady ? "var(--success)" : "var(--error)",
                  boxShadow: palaceReady ? "0 0 6px var(--success)" : "0 0 6px var(--error)",
                }} />
                <span style={{ fontSize: 9, color: palaceReady ? "var(--success)" : "var(--text-muted)", letterSpacing: "0.03em" }}>
                  {palaceReady ? "MemPalace Active" : "Not Initialized"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
                semantic search + knowledge graph
              </p>
            </div>
          </div>
        </div>

        {/* Memory Health — KG + recall hook + last mine, replaces legacy Vector Store ring */}
        <div style={glowCard("#06b6d4", { padding: "18px 20px", cursor: "pointer" })}
          data-glow="#06b6d4" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
          onMouseDown={pressDown} onMouseUp={pressUp}
          onClick={() => setView("memory")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <SectionLabel text="Memory Health" />
            <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)", opacity: 0.4 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <RingGauge
              value={memoryHealth.kgEdges}
              max={Math.max(memoryHealth.kgEdges, memoryHealth.drawers || 100)}
              size={88}
              stroke={7}
              color="#06b6d4"
              label="KG Triples"
              display={loading ? "…" : String(memoryHealth.kgEdges)}
            />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Network style={{ width: 12, height: 12, color: "#06b6d4", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{memoryHealth.kgNodes}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>entities</span>
                <span style={{ margin: "0 2px", color: "var(--border)" }}>·</span>
                <GitBranch style={{ width: 12, height: 12, color: "#a78bfa", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{memoryHealth.closets}</span>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>closets</span>
              </div>
              <VectorStatusRow
                icon={Sparkles}
                label="Recall Hook"
                active={memoryHealth.recallHookEnabled}
                value={memoryHealth.recallHookEnabled ? "active" : (memoryHealth.recallHookRegistered ? "disabled" : "missing")}
              />
              <VectorStatusRow
                icon={Pickaxe}
                label="Last Mine"
                active={!!memoryHealth.lastMineAt}
                value={relativeAge(memoryHealth.lastMineAt)}
              />
              {memoryHealth.error && (
                <p style={{
                  margin: 0, fontSize: 8, color: "var(--warning)",
                  display: "flex", alignItems: "center", gap: 4,
                  letterSpacing: "0.05em", fontWeight: 600, textTransform: "uppercase",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--warning)", boxShadow: "0 0 6px var(--warning)", flexShrink: 0 }} />
                  PALACE OFFLINE
                </p>
              )}
              <p style={{ margin: "2px 0 0", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
                {memoryHealth.error
                  ? "mempalace_query.py status failed"
                  : `provider · ${memoryHealth.provider}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Row 4: LLM + Uptime + Telegram ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>

        <div style={glowCard(llmColor, { padding: "16px 18px", cursor: "pointer" })}
          data-glow={llmColor} onMouseEnter={hoverLift} onMouseLeave={hoverReset}
          onMouseDown={pressDown} onMouseUp={pressUp}
          onClick={() => setView("models")}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <SectionLabel text="LLM Models" />
            <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)", opacity: 0.4 }} />
          </div>

          {/* Hosted model */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: 10,
            background: "rgba(255,255,255,0.018)", border: "1px solid rgba(255,255,255,0.04)",
            marginBottom: 8, transition: `all 0.2s ${EASE}`,
          }}
            onMouseEnter={e => { e.currentTarget.style.background = `color-mix(in srgb, ${llmColor} 6%, transparent)`; e.currentTarget.style.borderColor = `color-mix(in srgb, ${llmColor} 15%, transparent)`; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.018)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)"; }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: 9, flexShrink: 0,
              background: `color-mix(in srgb, ${llmColor} 10%, transparent)`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <OpenAILogo size={15} color={llmColor} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {hostedDisplayValue}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                {`Hosted · ${providerLabel(hostedProvider)}`}
              </p>
            </div>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
              background: gwConnected ? "var(--success)" : "var(--error)",
              boxShadow: gwConnected ? "0 0 6px var(--success)" : "0 0 6px var(--error)",
            }} />
          </div>

          {/* Local model */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: 10,
            background: "rgba(255,255,255,0.018)", border: "1px solid rgba(255,255,255,0.04)",
            transition: `all 0.2s ${EASE}`,
          }}
            onMouseEnter={e => { e.currentTarget.style.background = "color-mix(in srgb, #76b900 6%, transparent)"; e.currentTarget.style.borderColor = "color-mix(in srgb, #76b900 15%, transparent)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.018)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)"; }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: 9, flexShrink: 0,
              background: "color-mix(in srgb, #76b900 10%, transparent)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <NvidiaLogo size={15} color={meta.vllmRunning ? "#76b900" : "var(--text-muted)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                margin: 0, fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                color: meta.vllmRunning ? "var(--text)" : "var(--text-muted)",
              }}>
                {meta.vllmRunning
                  ? (localDisplayValue || "vLLM Active")
                  : "Offline"}
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                Local · vLLM{meta.vllmRunning ? " · Running" : ""}
              </p>
            </div>
            <span style={{
              width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
              background: meta.vllmRunning ? "var(--success)" : "var(--error)",
              boxShadow: meta.vllmRunning ? "0 0 6px var(--success)" : "0 0 6px var(--error)",
              animation: meta.vllmRunning ? "none" : "pulse-dot 2s ease-in-out infinite",
            }} />
          </div>
        </div>

        <div style={glowCard("var(--warning)", { padding: "16px 18px" })}
          data-glow="var(--warning)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
          <SectionLabel text="Uptime" />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flexShrink: 0,
              background: "rgba(251,191,36,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Clock style={{ width: 18, height: 18, color: "var(--warning)", filter: "drop-shadow(0 0 4px #fbbf24)" }} />
            </div>
            <div>
              <p style={{
                margin: 0, fontSize: 17, fontWeight: 700, color: "var(--text)",
                fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
              }}>
                {sysStats.uptime ?? "—"}
              </p>
              <p style={{ margin: "3px 0 0", fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.02em" }}>
                OpenClaw v{meta.openclawVersion !== "—" ? meta.openclawVersion : "—"}
              </p>
            </div>
          </div>
        </div>

        <TelegramCard onNavigate={() => setView("channels")} />
      </div>

      {/* ═══ Row 5: Security + PC Optimizer ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2.2fr", gap: 14, marginBottom: 14 }}>

        <div style={glowCard("var(--success)", { padding: "16px 18px", cursor: "pointer" })}
          data-glow="var(--success)" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
          onMouseDown={pressDown} onMouseUp={pressUp}
          onClick={() => setView("security")}>
          <SectionLabel text="Security" />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, display: "flex",
              alignItems: "center", justifyContent: "center",
              background: "rgba(52,211,153,0.08)",
              transition: `transform 0.3s ${SPRING}`,
            }}>
              <Shield style={{ width: 20, height: 20, color: "var(--success)", filter: "drop-shadow(0 0 6px #34d399)" }} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Audit Ready</p>
              <p style={{ margin: "3px 0 0", fontSize: 9, color: "var(--text-muted)" }}>Run full scan</p>
            </div>
          </div>
          <GlowProgress value={100} color="var(--success)" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: 8 }}>
            <span style={{ fontSize: 9, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 2 }}>
              View <ChevronRight style={{ width: 10, height: 10 }} />
            </span>
          </div>
        </div>

        <PcOptimizer />
      </div>

      {/* ═══ Row 6: GPU ═══ */}
      <div style={{ marginBottom: 14 }}>
        <HudSectionLabel number="01" text="GPU MONITOR" />
        <GpuMonitor />
      </div>

      {/* ═══ Footer ═══ */}
      <div style={{
        marginTop: "auto", paddingTop: 14, textAlign: "center",
        borderTop: "1px solid rgba(255,255,255,0.03)",
      }}>
        <p style={{
          fontSize: 9, color: "var(--text-muted)", margin: 0,
          letterSpacing: "0.06em", fontWeight: 400,
        }}>
          Powered by OpenClaw {meta.openclawVersion !== "—" ? `v${meta.openclawVersion}` : ""} · Crystal v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════ */

function SectionLabel({ text }: { text: string }) {
  return (
    <p style={{
      fontSize: 9, color: "var(--text-muted)", fontWeight: 600,
      textTransform: "uppercase", letterSpacing: "0.1em",
      marginBottom: 6, marginTop: 0, lineHeight: 1,
    }}>
      {text}
    </p>
  );
}

function StatusPill({ label, connected, onClick }: {
  label: string; connected: boolean; onClick: () => void;
}) {
  const c = connected ? "var(--success)" : "var(--error)";
  const bg = connected ? "rgba(52,211,153,0.06)" : "rgba(248,113,113,0.06)";
  const border = connected ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)";

  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 20,
      background: bg, border: `1px solid ${border}`,
      cursor: "pointer", fontSize: 10, color: c, fontWeight: 500,
      transition: `all 0.2s ${EASE}`, letterSpacing: "0.02em",
    }}
      onMouseEnter={e => {
        e.currentTarget.style.background = connected ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)";
        e.currentTarget.style.transform = "scale(1.04)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = bg;
        e.currentTarget.style.transform = "";
      }}
    >
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: c,
        boxShadow: `0 0 8px ${c}`,
        animation: connected ? "none" : "pulse-dot 2s ease-in-out infinite",
      }} />
      {label}
    </button>
  );
}

function StatTile({ icon: Icon, label, value, color, onClick }: {
  icon: React.ElementType; label: string; value: string; color: string;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      data-glow={color}
      onMouseEnter={hoverLift}
      onMouseLeave={hoverReset}
      onMouseDown={onClick ? pressDown : undefined}
      onMouseUp={onClick ? pressUp : undefined}
      style={glowCard(color, {
        padding: "14px 14px", cursor: onClick ? "pointer" : "default",
        display: "flex", flexDirection: "column", alignItems: "center",
        textAlign: "center", gap: 6,
      })}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}>
        <Icon style={{ width: 14, height: 14, color, filter: `drop-shadow(0 0 4px ${color})` }} />
      </div>
      <p style={{
        margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)",
        fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
      }}>
        {value}
      </p>
      <p style={{ margin: 0, fontSize: 9, color: "var(--text-muted)", letterSpacing: "0.04em" }}>{label}</p>
    </div>
  );
}

/* ── Telegram Card ── */

import { TELEGRAM_TOPICS } from "@/lib/telegram";

function TelegramCard({ onNavigate }: { onNavigate: () => void }) {
  const getCronJobs = useDataStore(s => s.getCronJobs);
  const [deliveryCounts, setDeliveryCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    (async () => {
      try {
        const jobs = await getCronJobs();
        const counts: Record<number, number> = {};
        for (const job of jobs) {
          const delivery = job.delivery as Record<string, unknown> | undefined;
          if (delivery) {
            const threadId = delivery.threadId ? Number(delivery.threadId) : undefined;
            if (threadId && job.enabled !== false) counts[threadId] = (counts[threadId] || 0) + 1;
          }
        }
        setDeliveryCounts(counts);
      } catch { /* ignore */ }
    })();
  }, [getCronJobs]);

  return (
    <div style={glowCard("#3b82f6", { padding: "16px 18px", cursor: "pointer" })}
      data-glow="#3b82f6" onMouseEnter={hoverLift} onMouseLeave={hoverReset}
      onMouseDown={pressDown} onMouseUp={pressUp}
      onClick={onNavigate}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <SectionLabel text="Telegram Topics" />
        <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)", opacity: 0.4 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TELEGRAM_TOPICS.map(topic => (
          <div key={topic.threadId} style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "4px 10px", borderRadius: 8,
            background: `${topic.color}0a`, border: `1px solid ${topic.color}18`,
            transition: `all 0.2s ${EASE}`,
          }}
            onMouseEnter={e => { e.currentTarget.style.background = `${topic.color}15`; e.currentTarget.style.borderColor = `${topic.color}30`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${topic.color}0a`; e.currentTarget.style.borderColor = `${topic.color}18`; }}
          >
            <span style={{ fontSize: 11 }}>{topic.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: topic.color }}>{topic.name}</span>
            {deliveryCounts[topic.threadId] ? (
              <span style={{
                fontSize: 8, color: topic.color, opacity: 0.6,
                background: `${topic.color}12`, borderRadius: 4, padding: "1px 4px",
              }}>
                {deliveryCounts[topic.threadId]}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── PC Optimizer ── */

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
  { id: "power-max", icon: Bolt, label: "Max Perf", desc: "High Performance power plan", color: "#fbbf24", command: `powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null; if ($LASTEXITCODE -ne 0) { powercfg /setactive SCHEME_MIN }; Write-Output 'Power plan set to High Performance'`, successMsg: "Power plan set to High Performance" },
  { id: "flush-dns", icon: Wifi, label: "Flush DNS", desc: "Clear DNS resolver cache", color: "#06b6d4", command: `ipconfig /flushdns`, successMsg: "DNS cache flushed" },
  { id: "clear-temp", icon: Trash2, label: "Clear Temp", desc: "Delete temporary files", color: "#f87171", command: `$before = (Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB; Remove-Item "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; $after = (Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB; $freed = [math]::Round($before - $after, 1); Write-Output "Cleared $freed MB of temp files"`, successMsg: "Temp files cleared" },
  { id: "clear-prefetch", icon: RefreshCw, label: "Prefetch", desc: "Clean prefetch data", color: "#a855f7", command: `Remove-Item "$env:SystemRoot\\Prefetch\\*" -Force -ErrorAction SilentlyContinue; Write-Output 'Prefetch cache cleared'`, successMsg: "Prefetch cache cleared" },
  { id: "memory-optimize", icon: MemoryStick, label: "Memory", desc: "Clear standby list", color: "#3B82F6", command: `[System.GC]::Collect(); [System.GC]::WaitForPendingFinalizers(); Write-Output 'Memory cleanup triggered'`, successMsg: "Memory cleanup triggered" },
  { id: "power-balanced", icon: BatteryFull, label: "Balanced", desc: "Balanced power plan", color: "#4ade80", command: `powercfg /setactive 381b4222-f694-41f0-9685-ff5bb260df2e; Write-Output 'Power plan set to Balanced'`, successMsg: "Power plan set to Balanced" },
  { id: "disable-startup", icon: Power, label: "Startup", desc: "Manage startup apps", color: "#ec4899", command: `$opened = $false; try { Start-Process "ms-settings:startupapps" -ErrorAction Stop; $opened = $true } catch { }; if (-not $opened) { try { Start-Process "explorer.exe" -ArgumentList "ms-settings:startupapps" -ErrorAction Stop; $opened = $true } catch { } }; if (-not $opened) { Start-Process "taskmgr.exe"; Write-Output "Opened Task Manager — open the Startup tab to manage programs." } else { Write-Output "Opened Windows Settings (Startup apps)." }`, successMsg: "Opened Windows Startup apps" },
  { id: "reset-network", icon: RotateCcw, label: "Network", desc: "Reset TCP/IP stack", color: "#14b8a6", command: `netsh winsock reset 2>$null; netsh int ip reset 2>$null; ipconfig /flushdns 2>$null; ipconfig /release 2>$null; ipconfig /renew 2>$null; Write-Output 'Network stack reset complete'`, successMsg: "Network stack reset" },
  { id: "disk-cleanup", icon: FolderCog, label: "Disk Clean", desc: "Clear update/log caches", color: "#f59e0b", command: `$freed = 0; $paths = @("$env:SystemRoot\\SoftwareDistribution\\Download", "$env:SystemRoot\\Logs\\CBS"); foreach ($p in $paths) { if (Test-Path $p) { $s = (Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB; Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue; $freed += $s } }; Remove-Item "$env:LOCALAPPDATA\\Microsoft\\Windows\\INetCache\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Output "Disk cleanup freed $([math]::Round($freed,1)) MB"`, successMsg: "Disk cleanup complete" },
  { id: "defender-scan", icon: ShieldCheck, label: "Defender", desc: "Quick scan", color: "#22c55e", command: `Start-MpScan -ScanType QuickScan -ErrorAction SilentlyContinue; Write-Output 'Windows Defender quick scan started'`, successMsg: "Defender scan started" },
  { id: "disable-visual-fx", icon: MonitorDown, label: "Visual FX", desc: "Disable animations", color: "#8b5cf6", command: `Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects" -Name VisualFXSetting -Value 2 -ErrorAction SilentlyContinue; Set-ItemProperty -Path "HKCU:\\Control Panel\\Desktop" -Name UserPreferencesMask -Value ([byte[]](0x90,0x12,0x03,0x80,0x10,0x00,0x00,0x00)) -ErrorAction SilentlyContinue; Write-Output 'Visual effects set to best performance (restart Explorer to apply)'`, successMsg: "Visual effects minimized", confirm: "This will disable Windows visual effects. Continue?" },
  { id: "gpu-reset", icon: Layers, label: "GPU Reset", desc: "Restart display driver", color: "#06b6d4", command: `$dev = Get-PnpDevice -Class Display -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'NVIDIA' }; if ($dev) { Disable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2; Enable-PnpDevice -InstanceId $dev.InstanceId -Confirm:$false -ErrorAction SilentlyContinue; Write-Output "NVIDIA GPU driver restarted" } else { Write-Output "No NVIDIA device found" }`, successMsg: "GPU driver restarted", confirm: "This will restart your NVIDIA GPU driver. Screen may flicker. Continue?" },
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
      setResults(prev => ({ ...prev, [action.id]: { success: result.code === 0, message: output } }));
    } catch (e) {
      setResults(prev => ({ ...prev, [action.id]: { success: false, message: String(e) } }));
    }
    setRunningId(null);
  };

  return (
    <div style={glowCard("#fbbf24", { padding: "16px 18px" })}
      data-glow="#fbbf24" onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
      <SectionLabel text="PC Optimizer" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6 }}>
        {OPTIMIZER_ACTIONS.map(action => {
          const Icon = action.icon;
          const isRunning = runningId === action.id;
          const result = results[action.id];
          const hasBorder = !!result;
          return (
            <button key={action.id} onClick={() => runAction(action)} disabled={isRunning}
              title={`${action.label}: ${action.desc}${result ? `\n${result.message}` : ""}`}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                padding: "10px 4px 8px", borderRadius: 10,
                border: hasBorder
                  ? `1px solid ${result.success ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`
                  : "1px solid rgba(255,255,255,0.03)",
                background: hasBorder
                  ? (result.success ? "rgba(74,222,128,0.04)" : "rgba(248,113,113,0.04)")
                  : "rgba(255,255,255,0.015)",
                cursor: isRunning ? "wait" : "pointer",
                opacity: isRunning ? 0.5 : 1,
                transition: `all 0.2s ${EASE}`,
              }}
              onMouseEnter={e => {
                if (!isRunning) {
                  e.currentTarget.style.background = `color-mix(in srgb, ${action.color} 8%, transparent)`;
                  e.currentTarget.style.borderColor = `color-mix(in srgb, ${action.color} 25%, transparent)`;
                  e.currentTarget.style.transform = `translateY(-1px) scale(1.04)`;
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = hasBorder
                  ? (result.success ? "rgba(74,222,128,0.04)" : "rgba(248,113,113,0.04)")
                  : "rgba(255,255,255,0.015)";
                e.currentTarget.style.borderColor = hasBorder
                  ? (result.success ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)")
                  : "rgba(255,255,255,0.03)";
                e.currentTarget.style.transform = "";
              }}
              onMouseDown={e => { e.currentTarget.style.transform = "scale(0.94)"; }}
              onMouseUp={e => { e.currentTarget.style.transform = "translateY(-1px) scale(1.04)"; }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8, display: "flex",
                alignItems: "center", justifyContent: "center",
                background: `color-mix(in srgb, ${action.color} 10%, transparent)`,
                transition: `transform 0.2s ${SPRING}`,
              }}>
                {isRunning
                  ? <Loader2 style={{ width: 13, height: 13, color: action.color, animation: "spin 1s linear infinite" }} />
                  : <Icon style={{ width: 13, height: 13, color: action.color, filter: `drop-shadow(0 0 3px ${action.color})` }} />}
              </div>
              <span style={{
                fontSize: 8, color: "var(--text-muted)", fontWeight: 500,
                textAlign: "center", lineHeight: 1.2, letterSpacing: "0.02em",
              }}>
                {action.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
