import React, { useState, useEffect, useCallback } from "react";
import { Gpu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { EASE, SPRING, MONO } from "@/styles/viewStyles";

let _gpuCache: { data: GpuStats; ts: number } | null = null;
const GPU_POLL_MS = 30_000;
const GPU_HISTORY_MAX = 20;
const GPU_HISTORY: number[] = [];

const HUD_CYAN = "#06b6d4";
const HUD_GREEN = "#76b900";
const HUD_BLUE = "#3B82F6";
const HUD_AMBER = "#fbbf24";
const HUD_RED = "#f87171";

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
  if (t < 80) return HUD_AMBER;
  return HUD_RED;
}

/* ═══════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════ */

function HudCornerBrackets() {
  const bracketStyle = (
    top: boolean,
    left: boolean,
  ): React.CSSProperties => ({
    position: "absolute",
    [top ? "top" : "bottom"]: 6,
    [left ? "left" : "right"]: 6,
    width: 14,
    height: 14,
    pointerEvents: "none",
  });

  const corner = (top: boolean, left: boolean) => {
    const x1 = left ? 0 : 14;
    const x2 = left ? 14 : 0;
    const y1 = top ? 0 : 14;
    const y2 = top ? 14 : 0;
    return (
      <svg
        style={bracketStyle(top, left)}
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d={`M${x1} ${y2} L${x1} ${y1} L${x2} ${y1}`}
          stroke={HUD_CYAN}
          strokeWidth="1.5"
          strokeOpacity="0.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <>
      {corner(true, true)}
      {corner(true, false)}
      {corner(false, true)}
      {corner(false, false)}
    </>
  );
}

function ScanLineOverlay() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 3px)",
        borderRadius: "inherit",
        zIndex: 1,
      }}
    />
  );
}

function HudRingGauge({
  value,
  label,
  size = 62,
  stroke = 5,
  color,
  large = false,
}: {
  value: number;
  label?: string;
  size?: number;
  stroke?: number;
  color: string;
  large?: boolean;
}) {
  const s = large ? 100 : size;
  const sw = large ? 7 : stroke;
  const r = (s - sw) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / 100, 1);
  const dashOffset = circ * (1 - pct);
  const tickCount = 12;
  const tickR = r + sw / 2 + 3;
  const cx = s / 2;
  const cy = s / 2;
  const isHot = value > 80;

  return (
    <div
      style={{
        position: "relative",
        width: s,
        height: s,
        flexShrink: 0,
        transition: `transform 0.3s ${SPRING}`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "scale(1.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "";
      }}
    >
      <svg width={s} height={s} style={{ transform: "rotate(-90deg)" }}>
        {/* Tick marks */}
        {Array.from({ length: tickCount }).map((_, i) => {
          const angle = (i / tickCount) * 2 * Math.PI;
          const x1 = cx + (tickR - 3) * Math.cos(angle);
          const y1 = cy + (tickR - 3) * Math.sin(angle);
          const x2 = cx + (tickR + 1) * Math.cos(angle);
          const y2 = cy + (tickR + 1) * Math.sin(angle);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={HUD_CYAN}
              strokeWidth="0.8"
              strokeOpacity="0.15"
            />
          );
        })}
        {/* Track ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.035)"
          strokeWidth={sw}
        />
        {/* Progress ring */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={sw + 0.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={dashOffset}
          style={{
            transition: `stroke-dashoffset 1s ${EASE}`,
            filter: `drop-shadow(0 0 6px ${color})`,
          }}
        />
      </svg>
      {/* Center glow on high values */}
      {isHot && (
        <div
          style={{
            position: "absolute",
            inset: "25%",
            borderRadius: "50%",
            background: `radial-gradient(circle, color-mix(in srgb, ${color} 15%, transparent), transparent)`,
            animation: "hud-pulse 2s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Center label */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
        }}
      >
        <span
          style={{
            fontSize: large ? 22 : 14,
            fontWeight: 700,
            color: "var(--text)",
            fontFamily: MONO,
            lineHeight: 1,
          }}
        >
          {value}%
        </span>
        {label && (
          <span
            style={{
              fontSize: large ? 8 : 7,
              fontWeight: 600,
              color: "var(--text-muted)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              lineHeight: 1,
            }}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

function SegmentedBar({
  value,
  max = 100,
  color,
  segments = 20,
}: {
  value: number;
  max?: number;
  color: string;
  segments?: number;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const filledCount = Math.round(pct * segments);

  return (
    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
      {Array.from({ length: segments }).map((_, i) => {
        const filled = i < filledCount;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 1,
              background: filled
                ? color
                : "rgba(255,255,255,0.04)",
              boxShadow: filled
                ? `0 0 6px ${color}, 0 0 2px ${color}`
                : "none",
              border: filled
                ? "none"
                : "1px solid rgba(255,255,255,0.06)",
              transition: `all 0.6s ${EASE}`,
            }}
          />
        );
      })}
    </div>
  );
}

function UtilizationChart({ history }: { history: number[] }) {
  const maxBars = GPU_HISTORY_MAX;
  const barH = 40;

  return (
    <div style={{ position: "relative", height: barH + 16, overflow: "hidden" }}>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map((frac) => (
        <div
          key={frac}
          style={{
            position: "absolute",
            top: barH * (1 - frac),
            left: 0,
            right: 0,
            height: 1,
            background: `rgba(6,182,212,0.06)`,
            pointerEvents: "none",
          }}
        />
      ))}
      {/* Bars */}
      <div
        style={{
          display: "flex",
          gap: 2,
          alignItems: "flex-end",
          height: barH,
        }}
      >
        {Array.from({ length: maxBars }).map((_, i) => {
          const val = history[i] ?? 0;
          const h = Math.max((val / 100) * barH, 1);
          const barColor =
            val > 80
              ? HUD_AMBER
              : val > 50
                ? HUD_GREEN
                : "rgba(118,185,0,0.6)";
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: h,
                borderRadius: 1,
                background:
                  i < history.length ? barColor : "rgba(255,255,255,0.025)",
                boxShadow:
                  i < history.length && val > 0
                    ? `0 0 4px ${barColor}`
                    : "none",
                transition: `height 0.8s ${EASE}`,
              }}
            />
          );
        })}
      </div>
      {/* Time labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
        }}
      >
        <span
          style={{
            fontSize: 7,
            color: "var(--text-muted)",
            fontFamily: MONO,
            opacity: 0.5,
          }}
        >
          -{maxBars * (GPU_POLL_MS / 1000)}s
        </span>
        <span
          style={{
            fontSize: 7,
            color: "var(--text-muted)",
            fontFamily: MONO,
            opacity: 0.5,
          }}
        >
          now
        </span>
      </div>
    </div>
  );
}

export function HudSectionLabel({
  number,
  text,
}: {
  number: string;
  text: string;
}) {
  return (
    <p
      style={{
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: HUD_CYAN,
        marginBottom: 6,
        marginTop: 0,
        lineHeight: 1,
        fontFamily: MONO,
        opacity: 0.7,
      }}
    >
      <span style={{ opacity: 0.5 }}>{number}//</span>
      {text}
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Exports
   ═══════════════════════════════════════════════════════════════ */

export function NvidiaLogo({
  size = 18,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
    >
      <path d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════════════ */

export function GpuMonitor() {
  const [stats, setStats] = useState<GpuStats | null>(_gpuCache?.data ?? null);
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<number[]>([...GPU_HISTORY]);
  const currentView = useAppStore((s) => s.currentView);
  const isVisible = currentView === "home";

  const poll = useCallback(async () => {
    try {
      const result = await invoke<{
        stdout: string;
        stderr: string;
        code: number;
      }>("get_gpu_stats");
      if (result.code === 0) {
        const parsed = parseGpuStats(result.stdout);
        if (parsed) {
          _gpuCache = { data: parsed, ts: Date.now() };
          GPU_HISTORY.push(parsed.gpuUtil);
          if (GPU_HISTORY.length > GPU_HISTORY_MAX) GPU_HISTORY.shift();
          setHistory([...GPU_HISTORY]);
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
    position: "relative",
    background: "rgba(255,255,255,0.022)",
    border: "1px solid rgba(255,255,255,0.055)",
    borderRadius: 16,
    padding: "22px 24px 18px",
    boxShadow:
      "0 0 24px color-mix(in srgb, #3B82F6 6%, transparent), inset 0 1px 0 rgba(255,255,255,0.035)",
    transition: `all 0.3s ${EASE}`,
    overflow: "hidden",
  };

  function hoverLift(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.transform = "translateY(-2px) scale(1.005)";
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
    e.currentTarget.style.boxShadow =
      "0 8px 32px color-mix(in srgb, #3B82F6 12%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)";
  }
  function hoverReset(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.transform = "";
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  }

  if (error && !stats) {
    return (
      <div style={cardStyle} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <HudCornerBrackets />
        <ScanLineOverlay />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "4px 0",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <Gpu
              style={{
                width: 15,
                height: 15,
                color: "var(--text-muted)",
                opacity: 0.5,
              }}
            />
          </div>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
          >
            GPU unavailable
          </span>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={cardStyle} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
        <HudCornerBrackets />
        <ScanLineOverlay />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "12px 0",
            position: "relative",
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 18,
              height: 18,
              border: "2px solid rgba(59,130,246,0.2)",
              borderTopColor: HUD_BLUE,
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
            }}
          />
        </div>
      </div>
    );
  }

  const isNvidia = /nvidia/i.test(stats.name);
  const brandColor = isNvidia ? HUD_GREEN : HUD_BLUE;
  const vramPct = stats.memTotalMb > 0 ? (stats.memUsedMb / stats.memTotalMb) * 100 : 0;
  const powerPct = stats.powerLimitW > 0 ? (stats.powerW / stats.powerLimitW) * 100 : 0;
  const vramUsedGb = (stats.memUsedMb / 1024).toFixed(1);
  const vramTotalGb = (stats.memTotalMb / 1024).toFixed(0);
  const vramColor = vramPct < 50 ? HUD_BLUE : vramPct < 80 ? HUD_AMBER : HUD_RED;

  return (
    <div style={cardStyle} onMouseEnter={hoverLift} onMouseLeave={hoverReset}>
      <HudCornerBrackets />
      <ScanLineOverlay />

      {/* Content layer above scan lines */}
      <div style={{ position: "relative", zIndex: 2 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 18,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: `color-mix(in srgb, ${brandColor} 10%, transparent)`,
              }}
            >
              {isNvidia ? (
                <NvidiaLogo size={18} color={brandColor} />
              ) : (
                <Gpu
                  style={{
                    width: 15,
                    height: 15,
                    color: brandColor,
                    filter: `drop-shadow(0 0 4px ${brandColor})`,
                  }}
                />
              )}
            </div>
            <div>
              <span
                style={{
                  fontSize: 9,
                  color: HUD_CYAN,
                  fontWeight: 600,
                  fontFamily: MONO,
                  letterSpacing: "0.1em",
                  opacity: 0.6,
                }}
              >
                01//GPU MONITOR
              </span>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: 12,
                  color: "var(--text)",
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                }}
              >
                {stats.name.replace(/NVIDIA\s*(GeForce\s*)?/i, "")}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: error ? "var(--error)" : brandColor,
                boxShadow: error
                  ? "0 0 8px var(--error)"
                  : `0 0 8px ${brandColor}`,
                animation: error
                  ? "pulse-dot 2s ease-in-out infinite"
                  : "none",
              }}
            />
            <span
              style={{
                fontSize: 9,
                color: error ? "var(--error)" : brandColor,
                fontWeight: 500,
                fontFamily: MONO,
              }}
            >
              {error ? "Error" : "Active"}
            </span>
          </div>
        </div>

        {/* Rings Row: Large GPU Core + 3 small rings */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <HudRingGauge
            value={stats.gpuUtil}
            label="GPU Core"
            color={brandColor}
            large
          />
          <div
            style={{
              flex: 1,
              display: "flex",
              gap: 10,
              justifyContent: "space-around",
            }}
          >
            <HudRingGauge
              value={Math.round(vramPct)}
              label="VRAM"
              size={58}
              stroke={4}
              color={vramColor}
            />
            <HudRingGauge
              value={Math.min(stats.tempC, 100)}
              label="Temp"
              size={58}
              stroke={4}
              color={tempColor(stats.tempC)}
            />
            <HudRingGauge
              value={Math.round(powerPct)}
              label="Power"
              size={58}
              stroke={4}
              color={powerPct > 90 ? HUD_RED : HUD_AMBER}
            />
          </div>
        </div>

        {/* Segmented Bars */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            marginBottom: 16,
          }}
        >
          {/* VRAM bar */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                VRAM
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text)",
                    fontFamily: MONO,
                  }}
                >
                  {vramUsedGb}
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontWeight: 400,
                      fontSize: 9,
                    }}
                  >
                    /{vramTotalGb} GB
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: vramColor,
                    fontFamily: MONO,
                  }}
                >
                  {vramPct.toFixed(0)}%
                </span>
              </div>
            </div>
            <SegmentedBar value={vramPct} color={vramColor} />
          </div>

          {/* Power bar */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  fontWeight: 600,
                  color: "var(--text-muted)",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                POWER
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text)",
                    fontFamily: MONO,
                  }}
                >
                  {Math.round(stats.powerW)}
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontWeight: 400,
                      fontSize: 9,
                    }}
                  >
                    /{stats.powerLimitW}W
                  </span>
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: powerPct > 90 ? HUD_RED : HUD_AMBER,
                    fontFamily: MONO,
                  }}
                >
                  {powerPct.toFixed(0)}%
                </span>
              </div>
            </div>
            <SegmentedBar
              value={powerPct}
              color={powerPct > 90 ? HUD_RED : HUD_AMBER}
            />
          </div>
        </div>

        {/* Comp Stats Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            marginBottom: 16,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.015)",
            border: "1px solid rgba(255,255,255,0.035)",
          }}
        >
          <StatCell label="CORE" value={`${stats.gpuUtil}%`} color={brandColor} />
          <StatCell label="VRAM" value={`${vramPct.toFixed(0)}%`} color={vramColor} />
          <StatCell
            label="TEMP"
            value={`${stats.tempC}°C`}
            color={tempColor(stats.tempC)}
          />
          <StatCell label="PWR" value={`${Math.round(stats.powerW)}W`} color={HUD_AMBER} />
        </div>

        {/* Utilization History */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                flex: 1,
                height: 1,
                background: `linear-gradient(90deg, transparent, rgba(6,182,212,0.15), transparent)`,
              }}
            />
            <span
              style={{
                fontSize: 8,
                fontWeight: 600,
                color: HUD_CYAN,
                fontFamily: MONO,
                letterSpacing: "0.1em",
                opacity: 0.6,
              }}
            >
              UTILIZATION
            </span>
            <div
              style={{
                flex: 1,
                height: 1,
                background: `linear-gradient(90deg, transparent, rgba(6,182,212,0.15), transparent)`,
              }}
            />
          </div>
          <UtilizationChart history={history} />
        </div>
      </div>

      {/* CSS animation for pulse glow */}
      <style>{`
        @keyframes hud-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function StatCell({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <span
        style={{
          fontSize: 7,
          fontWeight: 600,
          color: "var(--text-muted)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          display: "block",
          marginBottom: 2,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color,
          fontFamily: MONO,
          lineHeight: 1,
          filter: `drop-shadow(0 0 4px ${color})`,
        }}
      >
        {value}
      </span>
    </div>
  );
}
