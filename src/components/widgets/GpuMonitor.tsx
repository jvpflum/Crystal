import React, { useState, useEffect, useCallback } from "react";
import { Thermometer, Zap, MemoryStick, Gpu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";

let _gpuCache: { data: GpuStats; ts: number } | null = null;
const GPU_POLL_MS = 30_000;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

interface GpuStats {
  name: string;
  gpuUtil: number;
  memUtil: number;
  memUsedMb: number;
  memTotalMb: number;
  tempC: number;
  powerW: number;
  powerLimitW: number;
}

function parseGpuStats(stdout: string): GpuStats | null {
  const line = stdout.trim().split("\n").pop();
  if (!line) return null;
  const parts = line.split(",").map((s) => s.trim());
  if (parts.length < 8) return null;
  return {
    name: parts[0],
    gpuUtil: parseFloat(parts[1]) || 0,
    memUtil: parseFloat(parts[2]) || 0,
    memUsedMb: parseFloat(parts[3]) || 0,
    memTotalMb: parseFloat(parts[4]) || 0,
    tempC: parseFloat(parts[5]) || 0,
    powerW: parseFloat(parts[6]) || 0,
    powerLimitW: parseFloat(parts[7]) || 0,
  };
}

function tempColor(t: number): string {
  if (t < 60) return "#4ade80";
  if (t < 80) return "#fbbf24";
  return "#f87171";
}

function GpuRingGauge({ value, size = 56, stroke = 5, color }: {
  value: number; size?: number; stroke?: number; color: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / 100, 1);
  const dashOffset = circ * (1 - pct);

  return (
    <div style={{
      position: "relative", width: size, height: size, flexShrink: 0,
      transition: `transform 0.3s ${SPRING}`,
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={stroke + 0.5}
          strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={dashOffset}
          style={{
            transition: `stroke-dashoffset 1s ${EASE}`,
            filter: `drop-shadow(0 0 6px ${color})`,
          }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{
          fontSize: 13, fontWeight: 700, color: "var(--text)",
          fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
        }}>
          {value}%
        </span>
      </div>
    </div>
  );
}

function GlowBar({ value, max = 100, color, height = 5 }: {
  value: number; max?: number; color: string; height?: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ height, borderRadius: height, background: "rgba(255,255,255,0.035)", overflow: "hidden" }}>
      <div style={{
        height: "100%", borderRadius: height,
        width: `${pct}%`,
        background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 70%, white))`,
        boxShadow: `0 0 10px ${color}, 0 0 3px ${color}`,
        transition: `width 1s ${EASE}`,
      }} />
    </div>
  );
}

function MetricChip({ icon: Icon, label, value, color, sub }: {
  icon: React.ElementType; label: string; value: string; color: string; sub?: string;
}) {
  return (
    <div style={{
      flex: 1, display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px", borderRadius: 12,
      background: "rgba(255,255,255,0.018)",
      border: "1px solid rgba(255,255,255,0.04)",
      transition: `all 0.2s ${EASE}`,
    }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `color-mix(in srgb, ${color} 6%, transparent)`;
        e.currentTarget.style.borderColor = `color-mix(in srgb, ${color} 15%, transparent)`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = "rgba(255,255,255,0.018)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.04)";
      }}
    >
      <div style={{
        width: 30, height: 30, borderRadius: 9, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}>
        <Icon style={{ width: 14, height: 14, color, filter: `drop-shadow(0 0 4px ${color})` }} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{
            fontSize: 15, fontWeight: 700, color,
            fontFamily: "'SF Mono', 'JetBrains Mono', monospace", lineHeight: 1,
            filter: `drop-shadow(0 0 4px ${color})`,
          }}>
            {value}
          </span>
          {sub && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{sub}</span>}
        </div>
        <span style={{ fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}>
          {label}
        </span>
      </div>
    </div>
  );
}

export function GpuMonitor() {
  const [stats, setStats] = useState<GpuStats | null>(_gpuCache?.data ?? null);
  const [error, setError] = useState(false);
  const currentView = useAppStore(s => s.currentView);
  const isVisible = currentView === "home";

  const poll = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("get_gpu_stats");
      if (result.code === 0) {
        const parsed = parseGpuStats(result.stdout);
        if (parsed) {
          _gpuCache = { data: parsed, ts: Date.now() };
          setStats(parsed);
          setError(false);
          return;
        }
      }
      setError(true);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    if (!_gpuCache || Date.now() - _gpuCache.ts > GPU_POLL_MS) poll();
    const id = setInterval(poll, GPU_POLL_MS);
    return () => clearInterval(id);
  }, [poll, isVisible]);

  const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.022)",
    border: "1px solid rgba(255,255,255,0.055)",
    borderRadius: 16,
    padding: "18px 20px",
    boxShadow: "0 0 24px color-mix(in srgb, #3B82F6 6%, transparent), inset 0 1px 0 rgba(255,255,255,0.035)",
    transition: `all 0.3s ${EASE}`,
    overflow: "hidden",
  };

  function hoverLift(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.transform = "translateY(-2px) scale(1.005)";
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
    e.currentTarget.style.boxShadow = "0 8px 32px color-mix(in srgb, #3B82F6 12%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)";
  }
  function hoverReset(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  }

  if (error && !stats) {
    return (
      <div style={cardStyle} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "rgba(255,255,255,0.04)",
          }}>
            <Gpu style={{ width: 15, height: 15, color: "var(--text-muted)", opacity: 0.5 }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.02em" }}>
            GPU unavailable
          </span>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={cardStyle} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 0" }}>
          <div style={{
            width: 18, height: 18, border: "2px solid rgba(59,130,246,0.2)",
            borderTopColor: "#3B82F6", borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
          }} />
        </div>
      </div>
    );
  }

  const vramPct = stats.memTotalMb > 0 ? (stats.memUsedMb / stats.memTotalMb) * 100 : 0;
  const powerPct = stats.powerLimitW > 0 ? (stats.powerW / stats.powerLimitW) * 100 : 0;
  const vramUsedGb = (stats.memUsedMb / 1024).toFixed(1);
  const vramTotalGb = (stats.memTotalMb / 1024).toFixed(0);
  const vramColor = vramPct < 50 ? "#3B82F6" : vramPct < 80 ? "#fbbf24" : "#f87171";

  return (
    <div style={cardStyle} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, display: "flex",
            alignItems: "center", justifyContent: "center",
            background: "color-mix(in srgb, #76b900 10%, transparent)",
          }}>
            <Gpu style={{ width: 15, height: 15, color: "#76b900", filter: "drop-shadow(0 0 4px #76b900)" }} />
          </div>
          <div>
            <span style={{
              fontSize: 12, color: "var(--text)", fontWeight: 600, letterSpacing: "-0.01em",
            }}>
              {stats.name.replace("NVIDIA GeForce ", "")}
            </span>
            <p style={{
              margin: "2px 0 0", fontSize: 8, color: "var(--text-muted)",
              letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 500,
            }}>
              NVIDIA GPU
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: error ? "var(--error)" : "#76b900",
            boxShadow: error ? "0 0 8px var(--error)" : "0 0 8px #76b900",
            animation: error ? "pulse-dot 2s ease-in-out infinite" : "none",
          }} />
          <span style={{ fontSize: 9, color: error ? "var(--error)" : "#76b900", fontWeight: 500 }}>
            {error ? "Error" : "Active"}
          </span>
        </div>
      </div>

      {/* GPU Util Ring + VRAM Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
        <GpuRingGauge value={stats.gpuUtil} color="#76b900" />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <MemoryStick style={{ width: 11, height: 11, color: vramColor, filter: `drop-shadow(0 0 3px ${vramColor})` }} />
              <span style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                VRAM
              </span>
            </div>
            <span style={{
              fontSize: 11, color: "var(--text)", fontWeight: 600,
              fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
            }}>
              {vramUsedGb}<span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/{vramTotalGb} GB</span>
            </span>
          </div>
          <GlowBar value={vramPct} color={vramColor} height={5} />
          <p style={{ margin: "5px 0 0", fontSize: 8, color: "var(--text-muted)", letterSpacing: "0.03em" }}>
            {vramPct.toFixed(1)}% utilized
          </p>
        </div>
      </div>

      {/* Metric Chips */}
      <div style={{ display: "flex", gap: 10 }}>
        <MetricChip
          icon={Thermometer} label="Temperature"
          value={`${stats.tempC}°C`} color={tempColor(stats.tempC)}
        />
        <MetricChip
          icon={Zap} label="Power Draw"
          value={`${Math.round(stats.powerW)}W`} color="#fbbf24"
          sub={`/ ${stats.powerLimitW}W`}
        />
      </div>

      {/* Power Bar */}
      {powerPct > 0 && (
        <div style={{ marginTop: 12 }}>
          <GlowBar value={powerPct}
            color={powerPct > 90 ? "#f87171" : "#fbbf24"} height={4} />
        </div>
      )}
    </div>
  );
}
