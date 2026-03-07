import { useState, useEffect, useRef, useCallback } from "react";
import { Thermometer, Zap, MemoryStick, Gpu } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";

let _gpuCache: { data: GpuStats; ts: number } | null = null;
const GPU_POLL_MS = 5000;

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

function vramGradient(pct: number): string {
  if (pct < 50) return "linear-gradient(90deg, #3B82F6, #60a5fa)";
  if (pct < 80) return "linear-gradient(90deg, #3B82F6, #fbbf24)";
  return "linear-gradient(90deg, #fbbf24, #f87171)";
}

function CircularProgress({ value, size = 40, stroke = 3.5, color = "#3B82F6" }: {
  value: number; size?: number; stroke?: number; color?: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
    </svg>
  );
}

export function GpuMonitor() {
  const [stats, setStats] = useState<GpuStats | null>(_gpuCache?.data ?? null);
  const [error, setError] = useState(false);
  const currentView = useAppStore(s => s.currentView);
  const isVisible = currentView === "home";

  const poll = useCallback(async () => {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: "nvidia-smi --query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits",
        cwd: null,
      });
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

  if (error && !stats) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 8,
      }}>
        <Gpu style={{ width: 14, height: 14, color: "rgba(255,255,255,0.25)" }} />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>GPU unavailable</span>
      </div>
    );
  }

  if (!stats) {
    return (
      <div style={{
        background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10, padding: 14, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: 14, height: 14, border: "2px solid rgba(59,130,246,0.3)",
          borderTopColor: "#3B82F6", borderRadius: "50%",
          animation: "gpuSpin 0.8s linear infinite",
        }} />
        <style>{`@keyframes gpuSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const vramPct = stats.memTotalMb > 0 ? (stats.memUsedMb / stats.memTotalMb) * 100 : 0;
  const powerPct = stats.powerLimitW > 0 ? (stats.powerW / stats.powerLimitW) * 100 : 0;
  const vramUsedGb = (stats.memUsedMb / 1024).toFixed(1);
  const vramTotalGb = (stats.memTotalMb / 1024).toFixed(0);

  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Gpu style={{ width: 13, height: 13, color: "#3B82F6" }} />
          <span style={{ fontSize: 11, color: "white", fontWeight: 600 }}>
            {stats.name.replace("NVIDIA GeForce ", "")}
          </span>
        </div>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: error ? "#f87171" : "#4ade80",
          boxShadow: error ? "0 0 4px #f87171" : "0 0 4px #4ade80",
        }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
          <CircularProgress value={stats.gpuUtil} />
          <span style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 9, fontWeight: 700, color: "white",
          }}>
            {stats.gpuUtil}%
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <MemoryStick style={{ width: 10, height: 10, color: "rgba(255,255,255,0.4)" }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>VRAM</span>
            </div>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontFamily: "monospace" }}>
              {vramUsedGb}/{vramTotalGb}GB
            </span>
          </div>
          <div style={{
            height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden",
          }}>
            <div style={{
              height: "100%", borderRadius: 3, width: `${Math.min(vramPct, 100)}%`,
              background: vramGradient(vramPct),
              transition: "width 0.6s ease",
            }} />
          </div>
          <span style={{
            fontSize: 8, color: "rgba(255,255,255,0.35)", marginTop: 2, display: "block",
          }}>
            {vramPct.toFixed(1)}% used
          </span>
        </div>
      </div>

      <div style={{
        display: "flex", gap: 8, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8,
      }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 5 }}>
          <Thermometer style={{ width: 11, height: 11, color: tempColor(stats.tempC) }} />
          <div>
            <span style={{
              fontSize: 12, fontWeight: 600, color: tempColor(stats.tempC), fontFamily: "monospace",
            }}>
              {stats.tempC}°C
            </span>
          </div>
        </div>

        <div style={{
          width: 1, background: "rgba(255,255,255,0.06)", alignSelf: "stretch",
        }} />

        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 5 }}>
          <Zap style={{ width: 11, height: 11, color: "#fbbf24" }} />
          <div>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.7)", fontFamily: "monospace" }}>
              {Math.round(stats.powerW)}W
            </span>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>
              /{stats.powerLimitW}W
            </span>
          </div>
        </div>
      </div>

      {powerPct > 0 && (
        <div style={{
          height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", overflow: "hidden",
        }}>
          <div style={{
            height: "100%", borderRadius: 2,
            width: `${Math.min(powerPct, 100)}%`,
            background: powerPct > 90 ? "linear-gradient(90deg, #fbbf24, #f87171)" : "linear-gradient(90deg, #4ade80, #fbbf24)",
            transition: "width 0.6s ease",
          }} />
        </div>
      )}
    </div>
  );
}
