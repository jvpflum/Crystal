import { useEffect, useRef, useCallback } from "react";
import { useAppStore, type AppView, type CommandCenterTabId } from "@/stores/appStore";
import { useDataStore } from "@/stores/dataStore";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — Technoir arcade / 90s fighter lobby isometric hub
   (neon street, chunky outlines, floating nametags, CRT polish)
   ═══════════════════════════════════════════════════════════════ */

// ─── Types ─────────────────────────────────────────────────────

interface BuildingDef {
  id: string; name: string; ox: number; oy: number;
  w: number; d: number; h: number;
  top: string; left: string; right: string; accent: string;
  linkedView: AppView; icon: string;
  linkedCenterTab?: CommandCenterTabId;
  /** Two-line rooftop / facade neon (Technoir-style signage). */
  sign?: readonly [string, string];
}

interface AgentSprite {
  id: string; name: string; emoji: string; color: string;
  x: number; y: number; tx: number; ty: number;
  state: "idle" | "walking" | "working"; timer: number;
  task: string; trail: { x: number; y: number; age: number }[];
  model?: string; sessions?: number; targetBldg?: string;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; }
interface Raindrop { x: number; y: number; speed: number; len: number; }
interface Star { x: number; y: number; phase: number; bright: number; }
interface DataPulse { fromIdx: number; t: number; speed: number; color: string; }
interface Drone { x: number; y: number; tx: number; ty: number; speed: number; color: string; trail: { x: number; y: number }[]; timer: number; }
interface Billboard { x: number; y: number; w: number; h: number; lines: string[]; accent: string; phase: number; }
interface ActivityEntry { text: string; color: string; time: number; }
interface SteamVent { x: number; y: number; timer: number; interval: number; }
interface ShootingStar { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; }
interface ElectricArc { fromIdx: number; toIdx: number; life: number; points: { x: number; y: number }[]; }

// ─── Neon Palette ──────────────────────────────────────────────

const N = {
  cyan: "#00fff2", magenta: "#ff2d95", purple: "#b744ff", amber: "#ffb800",
  green: "#39ff14", orange: "#ff6a00", blue: "#0088ff", red: "#ff003c",
  white: "#e0e8ff", pink: "#ff69b4", lime: "#7fff00",
  hotPink: "#ff3eb8", streetPurple: "#160828", asphalt: "#0c0618",
  arcadeYellow: "#ffe600", signGreen: "#5cff5c", deepViolet: "#2d0a4a",
};

// ─── Buildings ─────────────────────────────────────────────────

const BUILDINGS: BuildingDef[] = [
  { id: "clock",    name: "CHRONO SPIRE",    ox:    0, oy: -135, w: 22, d: 16, h: 88,  top: "#1a1a2e", left: "#0d0d1a", right: "#141428", accent: N.amber,   linkedView: "command-center", linkedCenterTab: "scheduled", icon: "⏱", sign: ["24HR", "CRON"] },
  { id: "barracks", name: "AGENT BARRACKS",  ox: -100, oy:  -68, w: 26, d: 18, h: 50,  top: "#1a2e1a", left: "#0d1a0d", right: "#142814", accent: N.lime,    linkedView: "agents",       icon: "⬡", sign: ["FIGHTER", "SELECT"] },
  { id: "memory",   name: "MEMORY CORE",     ox: -195, oy:   20, w: 28, d: 22, h: 55,  top: "#1a102e", left: "#0d0818", right: "#140e24", accent: N.purple,  linkedView: "memory",       icon: "◈", sign: ["NEON", "DATA"] },
  { id: "office",   name: "COMMAND HQ",      ox:  195, oy:   20, w: 30, d: 22, h: 68,  top: "#101a2e", left: "#080d1a", right: "#0e1428", accent: N.blue,    linkedView: "office",       icon: "◉", sign: ["BOSS", "ROOM"] },
  { id: "factory",  name: "THE FORGE",       ox: -195, oy:  140, w: 35, d: 25, h: 48,  top: "#2e1a10", left: "#1a0d08", right: "#28140e", accent: N.orange,  linkedView: "factory",      icon: "⚙", sign: ["TECH", "NOIR"] },
  { id: "comms",    name: "COMM ARRAY",      ox:  195, oy:  140, w: 20, d: 15, h: 92,  top: "#102e2e", left: "#081a1a", right: "#0e2828", accent: N.cyan,    linkedView: "channels",     icon: "◇", sign: ["LINK", "UP"] },
  { id: "vault",    name: "TOOL VAULT",      ox:  100, oy:  -68, w: 24, d: 16, h: 42,  top: "#2e2e1a", left: "#1a1a0d", right: "#282814", accent: N.pink,    linkedView: "tools",        icon: "⚒", sign: ["POWER", "UP"] },
  { id: "terminal", name: "THE TERMINAL",    ox:    0, oy:  215, w: 32, d: 20, h: 38,  top: "#102e10", left: "#081a08", right: "#0e280e", accent: N.green,   linkedView: "conversation", icon: "▣", sign: ["VERSUS", "MODE"] },
];

const AGENT_HOMES: Record<string, string> = { main: "office", research: "memory", home: "terminal", finance: "factory", default: "barracks" };
const AGENT_COLORS: Record<string, string> = { main: N.blue, research: N.purple, home: N.green, finance: N.amber };
const AGENT_EMOJI: Record<string, string> = { main: "🦉", research: "🔬", home: "🏡", finance: "💰" };

const PYLON_POS: [number, number][] = [
  [-50, -110], [50, -110], [-275, 75], [275, 75],
  [-130, 75], [130, 75], [-90, 190], [90, 190],
  [0, -50], [-50, 175], [50, 175], [-275, 160], [275, 160],
];

const STEAM_VENTS: SteamVent[] = [
  { x: -60, y: -20, timer: 0, interval: 120 },
  { x: 80, y: 80, timer: 40, interval: 150 },
  { x: -140, y: 170, timer: 80, interval: 100 },
  { x: 150, y: -40, timer: 20, interval: 180 },
  { x: 0, y: 100, timer: 60, interval: 130 },
];

const GROUND_N = 14;
const TW = 50;
const TH = 25;
const RAIN_COUNT = 220;

/** Slower phase for building lights (was ~frame*0.03–0.08 @ 60fps = too frantic). */
function lightPhase(frame: number): number {
  return frame * 0.011;
}

// ─── Drawing Primitives ───────────────────────────────────────

function drawIsoBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, topC: string, leftC: string, rightC: string) {
  ctx.fillStyle = rightC;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y - d); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = leftC;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - w, y - d); ctx.lineTo(x - w, y - d - h); ctx.lineTo(x, y - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = topC;
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h); ctx.closePath(); ctx.fill();
}

/** Street Fighter–style chunky black outline on isometric mass. */
function strokeIsoBlack(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, lineW: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.94)"; ctx.lineWidth = lineW; ctx.lineJoin = "round"; ctx.miterLimit = 2;
  ctx.beginPath(); ctx.moveTo(x - w, y - d); ctx.lineTo(x, y); ctx.lineTo(x + w, y - d); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - w, y - d); ctx.lineTo(x - w, y - d - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w, y - d); ctx.lineTo(x + w, y - d - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h); ctx.closePath(); ctx.stroke();
  ctx.restore();
}

function drawBuildingNeonSign(
  ctx: CanvasRenderingContext2D, bx: number, by: number, w: number, d: number, h: number,
  lines: readonly [string, string], accent: string, frame: number,
) {
  const px = bx + w * 0.42;
  const py = by - h * 0.5 - d * 0.38;
  const pulse = 0.72 + Math.sin(lightPhase(frame) * 2.2) * 0.28;
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = 0; i < lines.length; i++) {
    const ly = py + i * 9;
    ctx.font = "bold 7px monospace";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#000";
    ctx.strokeText(lines[i], px, ly);
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14 * pulse;
    ctx.fillStyle = i === 0 ? "#fff" : accent;
    ctx.globalAlpha = pulse;
    ctx.fillText(lines[i], px, ly);
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawNeonEdges(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number, color: string, alpha: number) {
  ctx.strokeStyle = color; ctx.lineWidth = 1.85; ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(x - w, y - d); ctx.lineTo(x, y); ctx.lineTo(x + w, y - d); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - w, y - d); ctx.lineTo(x - w, y - d - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + w, y - d); ctx.lineTo(x + w, y - d - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h); ctx.closePath(); ctx.stroke();
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 0.65; ctx.globalAlpha = alpha * 0.45;
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h); ctx.closePath(); ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c; ctx.beginPath();
  ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w / 2, y); ctx.lineTo(x, y + h / 2); ctx.lineTo(x - w / 2, y);
  ctx.closePath(); ctx.fill();
}

function lighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)})`;
}
function darken(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.max(0, r - 80)},${Math.max(0, g - 80)},${Math.max(0, b - 80)})`;
}

// ─── Sky + Atmosphere ──────────────────────────────────────────

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, stars: Star[], frame: number, shootingStars: ShootingStar[]) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#050010"); g.addColorStop(0.25, N.deepViolet); g.addColorStop(0.55, "#1a0638"); g.addColorStop(0.78, "#240a4a"); g.addColorStop(1, "#18022e");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // Nebula / club-district bloom
  for (let i = 0; i < 4; i++) {
    const nx = (w * 0.15 + i * w * 0.28 + Math.sin(frame * 0.0009 + i) * 40);
    const ny = h * (0.12 + (i % 2) * 0.1);
    const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, 100 + i * 28);
    const cols = [N.hotPink, N.magenta, N.cyan, N.purple];
    ng.addColorStop(0, `${cols[i]}14`); ng.addColorStop(0.45, `${cols[i]}06`); ng.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ng; ctx.fillRect(0, 0, w, h);
  }

  // Strong magenta–cyan street haze (reference: wet pavement + neon bounce)
  const horizonY = h * 0.78;
  const hg = ctx.createRadialGradient(w / 2, horizonY, 0, w / 2, horizonY, w * 0.85);
  hg.addColorStop(0, "rgba(255,62,184,0.14)"); hg.addColorStop(0.22, "rgba(183,68,255,0.09)");
  hg.addColorStop(0.5, "rgba(0,255,242,0.05)"); hg.addColorStop(0.75, "rgba(57,255,20,0.02)"); hg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg; ctx.fillRect(0, 0, w, h);

  // Stars
  for (const s of stars) {
    const twinkle = (Math.sin(lightPhase(frame) * 1.6 + s.phase) * 0.3 + 0.7) * s.bright;
    const col = s.bright > 0.7 ? N.cyan : s.bright > 0.4 ? N.purple : N.white;
    ctx.globalAlpha = twinkle * 0.6; ctx.fillStyle = col;
    const sz = s.bright > 0.7 ? 2 : 1.2;
    ctx.fillRect(s.x * w, s.y * h * 0.5, sz, sz);
    if (s.bright > 0.85) {
      ctx.globalAlpha = twinkle * 0.1;
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h * 0.5, 6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // Shooting stars
  for (let i = shootingStars.length - 1; i >= 0; i--) {
    const ss = shootingStars[i];
    ss.x += ss.vx; ss.y += ss.vy; ss.life--;
    if (ss.life <= 0) { shootingStars.splice(i, 1); continue; }
    const a = ss.life / ss.maxLife;
    ctx.strokeStyle = N.white; ctx.lineWidth = 1.5; ctx.globalAlpha = a * 0.7;
    ctx.beginPath(); ctx.moveTo(ss.x, ss.y);
    ctx.lineTo(ss.x - ss.vx * 8, ss.y - ss.vy * 8); ctx.stroke();
    ctx.globalAlpha = a * 0.15; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(ss.x, ss.y);
    ctx.lineTo(ss.x - ss.vx * 12, ss.y - ss.vy * 12); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (frame % 900 === 0 && shootingStars.length < 1) {
    shootingStars.push({ x: Math.random() * w, y: Math.random() * h * 0.3, vx: 3 + Math.random() * 4, vy: 1.5 + Math.random() * 2, life: 40 + Math.random() * 30, maxLife: 70 });
  }

  // Distant city silhouette with lights
  const silY = h * 0.5;
  for (let i = 0; i < 45; i++) {
    const bx = (i / 45) * w;
    const bh = 6 + Math.sin(i * 1.7) * 14 + Math.sin(i * 3.2) * 8 + Math.cos(i * 0.8) * 5;
    ctx.fillStyle = `rgba(6,0,18,${0.85 + Math.sin(i * 0.5) * 0.1})`;
    ctx.fillRect(bx, silY - bh, w / 45 - 1, bh);
    // Flickering windows
    for (let wy = 0; wy < bh - 3; wy += 4) {
      if (Math.sin(i * 3.7 + wy * 0.9 + lightPhase(frame) * 0.65) > 0.2) {
        const wCol = [N.cyan, N.magenta, N.amber, N.blue][i % 4];
        ctx.fillStyle = wCol; ctx.globalAlpha = 0.08 + Math.sin(lightPhase(frame) * 1.2 + i + wy) * 0.035;
        ctx.fillRect(bx + 1, silY - bh + wy, 1.5, 1.5);
      }
    }
  }
  ctx.globalAlpha = 1;

  // Distant flying vehicles
  for (let i = 0; i < 3; i++) {
    const vx = ((frame * (0.3 + i * 0.15) + i * 200) % (w + 60)) - 30;
    const vy = silY - 30 - i * 18 + Math.sin(frame * 0.01 + i * 2) * 5;
    ctx.fillStyle = i % 2 === 0 ? N.red : N.cyan; ctx.globalAlpha = 0.3;
    ctx.fillRect(vx, vy, 4, 1.5);
    ctx.globalAlpha = 0.08;
    ctx.beginPath(); ctx.arc(vx + 2, vy, 6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRain(ctx: CanvasRenderingContext2D, rain: Raindrop[], w: number, h: number) {
  for (const r of rain) {
    const a = 0.06 + (r.speed / 7) * 0.12;
    ctx.strokeStyle = `rgba(100,150,255,${a})`; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 1.5, r.y + r.len); ctx.stroke();
    r.y += r.speed; r.x -= 0.7;
    if (r.y > h + 10) { r.y = -r.len; r.x = Math.random() * (w + 60); }
  }
  // Puddle reflections at bottom
  ctx.fillStyle = "rgba(100,150,255,0.015)";
  ctx.fillRect(0, h * 0.85, w, h * 0.15);
}

// ─── Ground ────────────────────────────────────────────────────

function drawGround(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number) {
  const oy = cy + 25;
  const mid = (GROUND_N - 1) / 2;
  for (let gy = 0; gy < GROUND_N; gy++) {
    for (let gx = 0; gx < GROUND_N; gx++) {
      const sx = cx + (gx - gy) * TW / 2;
      const sy = oy - GROUND_N * TH / 2 + (gx + gy) * TH / 2;
      const dist = Math.abs(gx - mid) + Math.abs(gy - mid);
      const base = dist <= 2 ? N.asphalt : (gx + gy) % 2 === 0 ? "#10081f" : "#0a0614";
      drawDiamond(ctx, sx, sy, TW, TH, base);
      const zebra = Math.abs(gx - mid) <= 1 && gy >= mid - 1 && gy <= mid + 2 && (gx + gy) % 2 === 0;
      if (zebra) {
        ctx.fillStyle = "rgba(180,100,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(sx, sy - TH / 2); ctx.lineTo(sx + TW / 2, sy); ctx.lineTo(sx, sy + TH / 2); ctx.lineTo(sx - TW / 2, sy);
        ctx.closePath(); ctx.fill();
      }
      const edgeAlpha = 0.14 + Math.sin(frame * 0.006 + gx * 0.5 + gy * 0.3) * 0.08;
      ctx.strokeStyle = zebra ? `rgba(255,62,184,${edgeAlpha})` : `rgba(0,255,242,${edgeAlpha})`;
      ctx.lineWidth = zebra ? 0.85 : 0.55;
      ctx.beginPath();
      ctx.moveTo(sx, sy - TH / 2); ctx.lineTo(sx + TW / 2, sy); ctx.lineTo(sx, sy + TH / 2); ctx.lineTo(sx - TW / 2, sy);
      ctx.closePath(); ctx.stroke();
    }
  }
  const fog = ctx.createRadialGradient(cx, oy, 0, cx, oy, GROUND_N * TW * 0.48);
  fog.addColorStop(0, "rgba(255,62,184,0.04)"); fog.addColorStop(0.35, "rgba(0,255,242,0.03)"); fog.addColorStop(0.65, "rgba(183,68,255,0.02)"); fog.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fog; ctx.fillRect(cx - 450, oy - 250, 900, 500);
}

// ─── Steam Vents ───────────────────────────────────────────────

function drawSteamVents(ctx: CanvasRenderingContext2D, cx: number, cy: number, vents: SteamVent[], particles: Particle[], _frame: number, hasActivity?: boolean) {
  for (const v of vents) {
    const vx = cx + v.x, vy = cy + v.y;
    ctx.fillStyle = "rgba(20,20,30,0.6)"; ctx.fillRect(vx - 3, vy - 1, 6, 2);
    ctx.strokeStyle = `rgba(0,255,242,0.15)`; ctx.lineWidth = 0.5; ctx.strokeRect(vx - 3, vy - 1, 6, 2);

    if (!hasActivity) continue;

    v.timer--;
    if (v.timer <= 0) {
      v.timer = v.interval + Math.floor(Math.random() * 60);
      if (particles.length < 150) {
        for (let i = 0; i < 4; i++) {
          particles.push({
            x: vx + (Math.random() - 0.5) * 4, y: vy,
            vx: (Math.random() - 0.5) * 0.4, vy: -0.8 - Math.random() * 0.6,
            life: 40 + Math.random() * 30, maxLife: 70,
            color: "rgba(200,220,255,0.3)", size: 2 + Math.random() * 3,
          });
        }
      }
    }

    // Subtle glow when active
    if (v.timer > v.interval - 20) {
      ctx.globalAlpha = 0.04 * (1 - (v.interval - v.timer) / 20);
      ctx.fillStyle = N.cyan;
      ctx.beginPath(); ctx.arc(vx, vy, 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// ─── Paths + Pulses ────────────────────────────────────────────

function drawPaths(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number, pulses: DataPulse[]) {
  const center = { x: cx, y: cy + 20 };
  for (let bi = 0; bi < BUILDINGS.length; bi++) {
    const b = BUILDINGS[bi];
    const ex = cx + b.ox, ey = cy + b.oy;
    ctx.strokeStyle = "rgba(15,15,30,0.7)"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `${b.accent}18`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = `${b.accent}40`; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(ex, ey); ctx.stroke();
  }
  for (const p of pulses) {
    const b = BUILDINGS[p.fromIdx]; const ex = cx + b.ox, ey = cy + b.oy;
    const px = center.x + (ex - center.x) * p.t, py = center.y + (ey - center.y) * p.t;
    ctx.save(); ctx.shadowColor = p.color; ctx.shadowBlur = 10;
    ctx.fillStyle = p.color; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    p.t += p.speed; if (p.t > 1) p.t = 0;
  }
  if (frame % 200 === 0) {
    const idx = Math.floor(Math.random() * BUILDINGS.length);
    pulses.push({ fromIdx: idx, t: 0, speed: 0.0018 + Math.random() * 0.0022, color: BUILDINGS[idx].accent });
    if (pulses.length > 12) pulses.shift();
  }
}

// ─── Holo Pylons + Core ───────────────────────────────────────

function drawHoloPylon(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, i: number) {
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  const grd = ctx.createLinearGradient(x, y, x, y - 24);
  grd.addColorStop(0, "#1a1a2e"); grd.addColorStop(1, "#2a2a4e");
  ctx.fillStyle = grd; ctx.fillRect(x - 1, y - 24, 2, 24);
  const pulse = Math.sin(lightPhase(frame) + i * 1.2) * 0.3 + 0.7;
  const col = i % 3 === 0 ? N.cyan : i % 3 === 1 ? N.magenta : N.purple;
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 8 * pulse;
  ctx.strokeStyle = col; ctx.globalAlpha = pulse * 0.8; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y - 26, 3.5, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  ctx.globalAlpha = pulse * 0.05; ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x - 1, y - 24); ctx.lineTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.lineTo(x + 1, y - 24); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHoloCore(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  ctx.fillStyle = "rgba(10,10,20,0.6)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `${N.cyan}44`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(x, y + 2, 22, 11, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = `${N.cyan}66`;
  ctx.beginPath(); ctx.ellipse(x, y, 14, 7, 0, 0, Math.PI * 2); ctx.stroke();
  const colH = 40 + Math.sin(lightPhase(frame) * 2.5) * 6;
  const colAlpha = 0.09 + Math.sin(lightPhase(frame) * 3) * 0.04;
  const hg = ctx.createLinearGradient(x, y, x, y - colH);
  hg.addColorStop(0, `rgba(0,255,242,${colAlpha * 2.5})`); hg.addColorStop(0.3, `rgba(183,68,255,${colAlpha})`);
  hg.addColorStop(0.7, `rgba(0,136,255,${colAlpha * 0.8})`); hg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg; ctx.beginPath();
  ctx.moveTo(x - 7, y); ctx.lineTo(x - 3, y - colH); ctx.lineTo(x + 3, y - colH); ctx.lineTo(x + 7, y);
  ctx.closePath(); ctx.fill();
  for (let i = 0; i < 4; i++) {
    const ringY = y - 8 - i * 7;
    const ringR = 9 - i * 1.5;
    const rot = lightPhase(frame) * 1.8 * (i % 2 === 0 ? 1 : -1);
    ctx.save(); ctx.translate(x, ringY); ctx.rotate(rot);
    ctx.strokeStyle = [N.cyan, N.magenta, N.purple, N.blue][i];
    ctx.globalAlpha = 0.4 + Math.sin(lightPhase(frame) * 1.6 + i) * 0.15; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, 0, ringR, ringR * 0.35, 0, 0, Math.PI * 1.6); ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.shadowColor = N.cyan; ctx.shadowBlur = 14;
  ctx.fillStyle = N.cyan; ctx.globalAlpha = 0.6 + Math.sin(lightPhase(frame) * 2.2) * 0.3;
  ctx.beginPath(); ctx.arc(x, y - 5, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

// ─── Electric Arcs ─────────────────────────────────────────────

function updateArcs(arcs: ElectricArc[], frame: number, cx: number, cy: number, activeBuildings?: Set<string>) {
  for (let i = arcs.length - 1; i >= 0; i--) {
    arcs[i].life--;
    if (arcs[i].life <= 0) arcs.splice(i, 1);
    else {
      const arc = arcs[i];
      const from = BUILDINGS[arc.fromIdx], to = BUILDINGS[arc.toIdx];
      const fx = cx + from.ox, fy = cy + from.oy - from.h;
      const tx = cx + to.ox, ty = cy + to.oy - to.h;
      arc.points = [{ x: fx, y: fy }];
      const segs = 6 + Math.floor(Math.random() * 4);
      for (let j = 1; j < segs; j++) {
        const t = j / segs;
        arc.points.push({ x: fx + (tx - fx) * t + (Math.random() - 0.5) * 30, y: fy + (ty - fy) * t + (Math.random() - 0.5) * 20 });
      }
      arc.points.push({ x: tx, y: ty });
    }
  }
  const activeCount = activeBuildings?.size ?? 0;
  if (activeCount >= 2 && frame % 480 === 0 && arcs.length < 1) {
    const activeIdxs = BUILDINGS.map((b, i) => activeBuildings?.has(b.id) ? i : -1).filter(i => i >= 0);
    if (activeIdxs.length >= 2) {
      const a = activeIdxs[Math.floor(Math.random() * activeIdxs.length)];
      let b = activeIdxs[Math.floor(Math.random() * activeIdxs.length)];
      while (b === a && activeIdxs.length > 1) b = activeIdxs[Math.floor(Math.random() * activeIdxs.length)];
      arcs.push({ fromIdx: a, toIdx: b, life: 10 + Math.floor(Math.random() * 6), points: [] });
    }
  }
}

function drawArcs(ctx: CanvasRenderingContext2D, arcs: ElectricArc[]) {
  for (const arc of arcs) {
    if (arc.points.length < 2) continue;
    const a = arc.life / 20;
    ctx.save(); ctx.shadowColor = N.cyan; ctx.shadowBlur = 12;
    ctx.strokeStyle = N.cyan; ctx.globalAlpha = a * 0.6; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(arc.points[0].x, arc.points[0].y);
    for (let i = 1; i < arc.points.length; i++) ctx.lineTo(arc.points[i].x, arc.points[i].y);
    ctx.stroke();
    ctx.strokeStyle = N.white; ctx.globalAlpha = a * 0.3; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(arc.points[0].x, arc.points[0].y);
    for (let i = 1; i < arc.points.length; i++) ctx.lineTo(arc.points[i].x, arc.points[i].y);
    ctx.stroke(); ctx.restore();
  }
}

// ─── Drones ────────────────────────────────────────────────────

function updateDrones(drones: Drone[], frame: number, activeBuildings?: Set<string>) {
  const activeCount = activeBuildings?.size ?? 0;
  const desiredDrones = Math.min(activeCount, 2);

  for (const d of drones) {
    const dx = d.tx - d.x, dy = d.ty - d.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) {
      const activeIdxs = BUILDINGS.map((b, i) => activeBuildings?.has(b.id) ? i : -1).filter(i => i >= 0);
      const target = activeIdxs.length > 0
        ? BUILDINGS[activeIdxs[Math.floor(Math.random() * activeIdxs.length)]]
        : BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
      d.tx = target.ox + (Math.random() - 0.5) * 30;
      d.ty = target.oy - target.h - 20 + (Math.random() - 0.5) * 20;
    } else {
      d.x += (dx / dist) * d.speed; d.y += (dy / dist) * d.speed;
    }
    d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > 12) d.trail.shift();
  }

  while (drones.length > desiredDrones) drones.pop();

  if (drones.length < desiredDrones && frame % 220 === 0) {
    const activeIdxs = BUILDINGS.map((b, i) => activeBuildings?.has(b.id) ? i : -1).filter(i => i >= 0);
    if (activeIdxs.length > 0) {
      const srcIdx = activeIdxs[Math.floor(Math.random() * activeIdxs.length)];
      const src = BUILDINGS[srcIdx];
      drones.push({
        x: src.ox, y: src.oy - src.h - 30,
        tx: src.ox + 40, ty: src.oy - src.h - 50,
        speed: 0.32 + Math.random() * 0.22,
        color: [N.cyan, N.magenta, N.green, N.amber][drones.length % 4],
        trail: [], timer: 0,
      });
    }
  }
}

function drawDrones(ctx: CanvasRenderingContext2D, drones: Drone[], cx: number, cy: number, frame: number) {
  for (const d of drones) {
    const sx = cx + d.x, sy = cy + d.y;
    // Trail
    for (let i = 0; i < d.trail.length; i++) {
      const t = d.trail[i]; const a = (i / d.trail.length) * 0.3;
      ctx.fillStyle = d.color; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.arc(cx + t.x, cy + t.y, 1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Body
    ctx.save(); ctx.shadowColor = d.color; ctx.shadowBlur = 6;
    ctx.fillStyle = "#0a0a14";
    ctx.fillRect(sx - 4, sy - 1.5, 8, 3);
    ctx.strokeStyle = d.color; ctx.lineWidth = 0.8; ctx.globalAlpha = 0.8;
    ctx.strokeRect(sx - 4, sy - 1.5, 8, 3);
    // Blinking light
    if (frame % 72 < 36) {
      ctx.fillStyle = d.color; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(sx, sy, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

// ─── Holographic Billboards ────────────────────────────────────

function initBillboards(billboards: Billboard[]) {
  if (billboards.length > 0) return;
  billboards.push(
    { x: -310, y: -100, w: 96, h: 46, lines: ["PLAYER 1", "OPENCLAW"], accent: N.cyan, phase: 0 },
    { x: 310, y: -80, w: 92, h: 46, lines: ["ARCADE", "MODE"], accent: N.hotPink, phase: 2 },
    { x: 0, y: -235, w: 112, h: 40, lines: ["VERSUS", "READY"], accent: N.signGreen, phase: 4 },
  );
}

function drawBillboards(ctx: CanvasRenderingContext2D, billboards: Billboard[], cx: number, cy: number, frame: number, agents: AgentSprite[], activeCount: number) {
  if (billboards.length >= 3) {
    const working = agents.filter(a => a.state === "working" && a.task).length;
    const walking = agents.filter(a => a.state === "walking").length;
    billboards[0].lines = [`${agents.length} AGENTS`, working > 0 ? `${working} ON TASK` : "ALL IDLE"];
    billboards[2].lines = [
      activeCount > 0 ? `${activeCount} ZONES HOT` : "STANDBY",
      working > 0 ? "COMBO RUN" : walking > 0 ? "DASH" : "IDLE",
    ];
  }

  for (const bb of billboards) {
    const bx = cx + bb.x, by = cy + bb.y;
    const hover = Math.sin(lightPhase(frame) * 1.2 + bb.phase) * 3;

    // Support struts
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(bx - bb.w / 2, by + bb.h + hover); ctx.lineTo(bx - bb.w / 2, by + bb.h + hover + 15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + bb.w / 2, by + bb.h + hover); ctx.lineTo(bx + bb.w / 2, by + bb.h + hover + 15); ctx.stroke();

    // Background
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.beginPath(); ctx.roundRect(bx - bb.w / 2, by + hover, bb.w, bb.h, 2); ctx.fill();

    // Border with glow — billboard neon
    const pulse = 0.45 + Math.sin(lightPhase(frame) * 1.4 + bb.phase) * 0.22;
    ctx.save(); ctx.shadowColor = bb.accent; ctx.shadowBlur = 14;
    ctx.strokeStyle = bb.accent; ctx.globalAlpha = pulse; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(bx - bb.w / 2, by + hover, bb.w, bb.h, 3); ctx.stroke();
    ctx.strokeStyle = "#000"; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx - bb.w / 2 - 1, by + hover - 1, bb.w + 2, bb.h + 2, 4); ctx.stroke();
    ctx.restore();

    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lineGap = bb.h > 34 ? 16 : 14;
    const y0 = by + hover + (bb.lines.length === 1 ? bb.h / 2 : 15);
    for (let i = 0; i < bb.lines.length; i++) {
      ctx.font = i === 0 ? "bold 12px monospace" : "bold 10px monospace";
      ctx.globalAlpha = 0.98;
      strokeArcadeText(ctx, bb.lines[i], bx, y0 + i * lineGap, 3);
      ctx.fillStyle = i === 0 ? "#fff" : bb.accent;
      ctx.fillText(bb.lines[i], bx, y0 + i * lineGap);
    }
    ctx.globalAlpha = 1;

    // Scan line across billboard
    const scanT = ((frame * 0.22 + bb.phase * 14) % (bb.h + 6)) - 3;
    ctx.fillStyle = bb.accent; ctx.globalAlpha = 0.08;
    ctx.fillRect(bx - bb.w / 2 + 1, by + hover + scanT, bb.w - 2, 2);
    ctx.globalAlpha = 1;
  }
}

// ─── Buildings ─────────────────────────────────────────────────

function countWorkingAt(agents: AgentSprite[], buildingId: string): number {
  return agents.filter(a => a.state === "working" && a.targetBldg === buildingId).length;
}

function drawBuildingExtras(
  ctx: CanvasRenderingContext2D, b: BuildingDef, bx: number, by: number, frame: number, active: boolean,
  agents: AgentSprite[], stats: Record<string, { count: number; label: string }>,
) {
  if (b.sign) drawBuildingNeonSign(ctx, bx, by, b.w, b.d, b.h, b.sign, b.accent, frame);
  const ph = lightPhase(frame);
  const edgePulse = active ? 0.52 + Math.sin(ph * 2) * 0.12 : 0.22 + Math.sin(ph * 0.8) * 0.04;
  drawNeonEdges(ctx, bx, by, b.w, b.d, b.h, b.accent, edgePulse);
  if (active) {
    ctx.save(); ctx.globalAlpha = 0.06 + Math.sin(ph * 1.8) * 0.02;
    const grd = ctx.createRadialGradient(bx, by - b.h / 2, 0, bx, by - b.h / 2, b.w * 2.5);
    grd.addColorStop(0, b.accent); grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd; ctx.fillRect(bx - b.w * 3, by - b.h - b.d * 2, b.w * 6, b.h + b.d * 4); ctx.restore();
  }
  switch (b.id) {
    case "clock": {
      ctx.fillStyle = "#0d0d1a"; ctx.beginPath();
      ctx.moveTo(bx, by - b.h - b.d * 2 - 22); ctx.lineTo(bx + b.w * 0.6, by - b.h - b.d);
      ctx.lineTo(bx - b.w * 0.6, by - b.h - b.d); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = N.amber; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(bx, by - b.h - b.d * 2 - 22); ctx.lineTo(bx + b.w * 0.6, by - b.h - b.d);
      ctx.moveTo(bx, by - b.h - b.d * 2 - 22); ctx.lineTo(bx - b.w * 0.6, by - b.h - b.d); ctx.stroke(); ctx.globalAlpha = 1;
      const clockY = by - b.h - b.d - 6;
      ctx.save(); ctx.shadowColor = N.amber; ctx.shadowBlur = 10;
      ctx.fillStyle = "#0a0a14"; ctx.beginPath(); ctx.arc(bx, clockY, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = N.amber; ctx.globalAlpha = 0.7; ctx.lineWidth = 1.2; ctx.stroke(); ctx.globalAlpha = 1;
      const now = new Date();
      const ha = (now.getHours() % 12 / 12) * Math.PI * 2 - Math.PI / 2;
      const ma = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = N.amber; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(bx, clockY); ctx.lineTo(bx + Math.cos(ha) * 4, clockY + Math.sin(ha) * 4); ctx.stroke();
      ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.moveTo(bx, clockY); ctx.lineTo(bx + Math.cos(ma) * 6.5, clockY + Math.sin(ma) * 6.5); ctx.stroke();
      ctx.restore();
      if (active && (stats.clock?.count ?? 0) + countWorkingAt(agents, "clock") > 0) {
        for (let i = 0; i < 3; i++) {
          const r = ((frame * 0.09 + i * 20) % 55) + 9;
          const a = Math.max(0, 1 - r / 64) * 0.18;
          ctx.strokeStyle = N.amber; ctx.globalAlpha = a; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(bx, clockY, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "factory": {
      drawIsoBox(ctx, bx + b.w * 0.55, by - b.d * 0.6, 6, 5, b.h + 22, "#1a1008", "#0d0804", "#14100a");
      drawNeonEdges(ctx, bx + b.w * 0.55, by - b.d * 0.6, 6, 5, b.h + 22, N.orange, 0.3);
      if (active && (countWorkingAt(agents, "factory") > 0 || (stats.factory?.count ?? 0) > 0)) {
        ctx.save(); ctx.translate(bx + 10, by - b.h * 0.4); ctx.rotate(frame * 0.0075);
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.fillStyle = N.orange; ctx.globalAlpha = 0.5; ctx.fillRect(-1 + Math.cos(a) * 7, -1 + Math.sin(a) * 7, 2, 2); }
        ctx.fillStyle = N.orange; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#0a0804"; ctx.fillRect(bx - 4, by - 10, 8, 10);
      ctx.strokeStyle = N.orange; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.8; ctx.strokeRect(bx - 4, by - 10, 8, 10); ctx.globalAlpha = 1;
      break;
    }
    case "memory": {
      ctx.fillStyle = "#140e24"; ctx.beginPath(); ctx.arc(bx, by - b.h - b.d, b.w * 0.7, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = N.purple; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by - b.h - b.d, b.w * 0.7, Math.PI, 0); ctx.stroke(); ctx.globalAlpha = 1;
      if (active && (countWorkingAt(agents, "memory") > 0 || (stats.memory?.count ?? 0) > 0)) {
        for (let i = 0; i < 5; i++) {
          const sy = ((frame * 0.14 + i * 15) % 55);
          const sa = Math.max(0, 1 - sy / 55) * 0.45;
          ctx.fillStyle = N.purple; ctx.globalAlpha = sa;
          ctx.fillRect(bx - 8 + Math.sin(ph + i * 2) * 8, by - b.h * 0.3 - sy, 1.5, 3);
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = N.purple; ctx.globalAlpha = active ? 0.65 : 0.2; ctx.font = "bold 7px monospace"; ctx.textAlign = "center";
      ctx.fillText((Math.floor(frame * 0.35) % 0xFFFF).toString(16).toUpperCase().padStart(4, "0"), bx, by - b.h * 0.35); ctx.globalAlpha = 1;
      break;
    }
    case "comms": {
      ctx.strokeStyle = N.cyan; ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, by - b.h - 2 * b.d); ctx.lineTo(bx, by - b.h - 2 * b.d - 24); ctx.stroke(); ctx.globalAlpha = 1;
      const beaconOn = frame % 90 < 45;
      ctx.save(); ctx.shadowColor = N.red; ctx.shadowBlur = beaconOn ? 12 : 0;
      ctx.fillStyle = beaconOn ? N.red : "#330010";
      ctx.beginPath(); ctx.arc(bx, by - b.h - 2 * b.d - 26, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      if (active && (countWorkingAt(agents, "comms") > 0 || (stats.comms?.count ?? 0) > 0)) {
        for (let i = 0; i < 5; i++) {
          const r = ((frame * 0.12 + i * 12) % 65) + 5;
          const a = Math.max(0, 1 - r / 70) * 0.32;
          ctx.strokeStyle = N.cyan; ctx.globalAlpha = a; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(bx, by - b.h - 2 * b.d - 18, r, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "office": {
      const workingHere = countWorkingAt(agents, "office");
      const taskN = stats.office?.count ?? 0;
      const litCap = Math.min(30, workingHere * 6 + Math.min(10, taskN * 2) + (active && agents.length > 0 && workingHere + taskN === 0 ? 1 : 0));
      let winIdx = 0;
      for (let face = 0; face < 2; face++) { const sign = face === 0 ? -1 : 1;
        for (let row = 0; row < 5; row++) { for (let col = 0; col < 3; col++) {
          const u = 0.2 + col * 0.25; const v = 0.08 + row * 0.18;
          const wx = bx + sign * u * b.w; const wy = by - u * b.d - v * b.h;
          const lit = winIdx < litCap;
          winIdx++;
          if (lit) {
            const wCol = row % 2 === 0 ? N.blue : N.cyan;
            ctx.fillStyle = wCol; ctx.globalAlpha = 0.32 + Math.sin(ph * 1.4 + row * 0.4 + col * 0.3) * 0.07;
            ctx.fillRect(wx - 2, wy - 3, 3, 3); ctx.globalAlpha = 0.06; ctx.fillRect(wx - 3, wy - 4, 5, 5);
          } else { ctx.fillStyle = "#020208"; ctx.globalAlpha = 0.5; ctx.fillRect(wx - 2, wy - 3, 3, 3); }
        }}
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#020210"; ctx.fillRect(bx - 3, by - 8, 6, 8);
      ctx.strokeStyle = N.blue; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.8; ctx.strokeRect(bx - 3, by - 8, 6, 8); ctx.globalAlpha = 1;
      break;
    }
    case "barracks": {
      const atBarracks = agents.filter(a =>
        a.targetBldg === "barracks" || (AGENT_HOMES[a.id] === "barracks" && (a.state === "idle" || a.state === "walking")),
      ).length;
      const workingHere = countWorkingAt(agents, "barracks");
      const slots = Math.min(6, Math.max(workingHere * 2, Math.min(agents.length, atBarracks + 1)));
      let slot = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const wx = bx + (col - 0.5) * 10; const wy = by - b.h * (0.25 + row * 0.2);
          const lit = active && slot < slots;
          slot++;
          ctx.fillStyle = lit ? N.lime : "#0a1a0a"; ctx.globalAlpha = lit ? 0.42 + Math.sin(ph * 1.2 + row + col) * 0.08 : 0.2;
          ctx.fillRect(wx - 2, wy - 2, 4, 3);
        }
      }
      ctx.globalAlpha = 1;
      if (active && (workingHere > 0 || agents.length > 0)) {
        for (let i = 0; i < 3; i++) {
          const pulseR = ((frame * 0.11 + i * 20) % 40) + 5;
          ctx.strokeStyle = N.lime; ctx.globalAlpha = Math.max(0, 0.28 - pulseR / 130); ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.arc(bx, by - b.h * 0.6, pulseR, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#0a140a"; ctx.fillRect(bx - 3, by - 6, 6, 6);
      ctx.strokeStyle = N.lime; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.7; ctx.strokeRect(bx - 3, by - 6, 6, 6); ctx.globalAlpha = 1;
      break;
    }
    case "vault": {
      ctx.fillStyle = "#1a1a0d"; ctx.beginPath();
      ctx.arc(bx, by - b.h - b.d + 2, b.w * 0.6, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = N.pink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by - b.h - b.d + 2, b.w * 0.6, Math.PI, 0); ctx.stroke(); ctx.globalAlpha = 1;
      if (active && (countWorkingAt(agents, "vault") > 0 || (stats.vault?.count ?? 0) > 0)) {
        ctx.save(); ctx.translate(bx, by - b.h * 0.55);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + ph * 1.6;
          ctx.fillStyle = N.pink; ctx.globalAlpha = 0.38 + Math.sin(ph * 1.8 + i) * 0.1;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 6, Math.sin(a) * 6, 1.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = N.pink; ctx.globalAlpha = active ? 0.6 : 0.15;
      ctx.font = "bold 8px monospace"; ctx.textAlign = "center";
      ctx.fillText("⚒", bx, by - b.h * 0.35); ctx.globalAlpha = 1;
      break;
    }
    case "terminal": {
      const scA = active ? 0.5 : 0.15;
      ctx.fillStyle = N.green; ctx.globalAlpha = scA; ctx.fillRect(bx + 3, by - b.h * 0.8, b.w * 0.45, b.h * 0.45);
      ctx.fillStyle = N.green; ctx.globalAlpha = scA * 0.7; ctx.fillRect(bx - b.w * 0.5 - 2, by - b.h * 0.75, b.w * 0.38, b.h * 0.4); ctx.globalAlpha = 1;
      if (active && (countWorkingAt(agents, "terminal") > 0 || (stats.terminal?.count ?? 0) > 0)) {
        ctx.font = "5px monospace"; ctx.fillStyle = N.green;
        for (let i = 0; i < 4; i++) {
          ctx.globalAlpha = 0.28 + Math.sin(ph * 1.5 + i) * 0.08;
          ctx.fillText(String.fromCharCode(...Array.from({ length: 5 }, (_, j) => 0x30 + (Math.floor(frame * 0.12) + i * 7 + j * 3) % 42)), bx + 5, by - b.h * 0.72 + i * 5);
        }
        ctx.globalAlpha = 1;
      }
      if (active && (stats.terminal?.count ?? 0) > 0 && frame % 110 < 55) { ctx.fillStyle = N.green; ctx.globalAlpha = 0.75; ctx.fillRect(bx + 5, by - b.h * 0.45, 3, 1.5); ctx.globalAlpha = 1; }
      break;
    }
  }
}

function strokeArcadeText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, lineWidth: number) {
  ctx.lineJoin = "round"; ctx.miterLimit = 2;
  ctx.strokeStyle = "#000"; ctx.lineWidth = lineWidth; ctx.strokeText(text, x, y);
}

function drawBuildingLabel(ctx: CanvasRenderingContext2D, b: BuildingDef, bx: number, by: number, hovered: boolean, stat?: { count: number; label: string }) {
  const ly = by - b.h - b.d * 2 - (b.id === "clock" ? 42 : 18);
  const titleFont = hovered ? "bold 12px monospace" : "bold 10px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const label = `${b.icon} ${b.name}`; const padX = 22;
  ctx.font = titleFont;
  let lw = ctx.measureText(label).width + padX * 2;
  if (stat) {
    ctx.font = "bold 8px monospace";
    lw = Math.max(lw, ctx.measureText(stat.label).width + padX * 2);
  }
  const totalH = stat ? 40 : 24;
  ctx.fillStyle = hovered ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.72)";
  ctx.beginPath(); ctx.roundRect(bx - lw / 2, ly - 12, lw, totalH, 3); ctx.fill();
  ctx.strokeStyle = N.arcadeYellow; ctx.globalAlpha = hovered ? 0.55 : 0.22; ctx.lineWidth = hovered ? 2 : 1;
  ctx.beginPath(); ctx.roundRect(bx - lw / 2, ly - 12, lw, totalH, 3); ctx.stroke();
  ctx.strokeStyle = b.accent; ctx.globalAlpha = hovered ? 0.95 : 0.4; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx - lw / 2 - 2, ly - 14, lw + 4, totalH + 4, 4); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.font = titleFont;
  strokeArcadeText(ctx, label, bx, ly - (stat ? 2 : 0), 3);
  ctx.fillStyle = hovered ? "#fff" : N.white; ctx.fillText(label, bx, ly - (stat ? 2 : 0));
  if (stat) {
    ctx.font = "bold 8px monospace";
    strokeArcadeText(ctx, stat.label, bx, ly + 14, 2);
    ctx.fillStyle = b.accent; ctx.globalAlpha = 0.95;
    ctx.fillText(stat.label, bx, ly + 14); ctx.globalAlpha = 1;
  }
  if (hovered) {
    ctx.strokeStyle = b.accent; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx - lw / 2 - 4, ly); ctx.lineTo(bx - lw / 2 - 20, ly); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + lw / 2 + 4, ly); ctx.lineTo(bx + lw / 2 + 20, ly); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ─── Agent Sprites ─────────────────────────────────────────────

function drawAgentSprite(ctx: CanvasRenderingContext2D, a: AgentSprite, frame: number, cx: number, cy: number, isHovered: boolean) {
  const sx = cx + a.x, sy = cy + a.y;
  const bob = a.state === "walking" ? Math.sin(frame * 0.12) * 2.5 : Math.sin(frame * 0.03) * 0.8;

  // Trail
  if (a.state === "walking" && a.trail.length > 0) {
    for (const t of a.trail) {
      const ta = (1 - t.age / 20) * 0.35;
      if (ta > 0) { ctx.fillStyle = a.color; ctx.globalAlpha = ta; ctx.beginPath(); ctx.arc(cx + t.x, cy + t.y, 1.5 * (1 - t.age / 20), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  // Ground glow
  ctx.save(); ctx.shadowColor = a.color; ctx.shadowBlur = isHovered ? 12 : 6;
  ctx.fillStyle = a.color; ctx.globalAlpha = isHovered ? 0.25 : 0.15;
  ctx.beginPath(); ctx.ellipse(sx, sy + 1, isHovered ? 10 : 7, isHovered ? 5 : 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  // Hover selection ring
  if (isHovered) {
    ctx.strokeStyle = a.color; ctx.globalAlpha = 0.5 + Math.sin(frame * 0.06) * 0.2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(sx, sy + 1, 14, 7, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }

  // Legs
  if (a.state === "walking") {
    const leg = Math.sin(frame * 0.12) * 2.5;
    ctx.strokeStyle = a.color; ctx.lineWidth = 1.8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(sx - 2, sy - 2 + bob); ctx.lineTo(sx - 2 + leg, sy + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 2, sy - 2 + bob); ctx.lineTo(sx + 2 - leg, sy + 1); ctx.stroke();
  }

  // Body
  ctx.fillStyle = darken(a.color); ctx.beginPath(); ctx.roundRect(sx - 4, sy - 12 + bob, 8, 10, 2); ctx.fill();
  ctx.strokeStyle = a.color; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.8; ctx.stroke(); ctx.globalAlpha = 1;

  // Head
  ctx.fillStyle = lighten(a.color); ctx.beginPath(); ctx.arc(sx, sy - 16 + bob, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = a.color; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.6; ctx.stroke(); ctx.globalAlpha = 1;

  // Emoji
  ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(a.emoji, sx, sy - 28 + bob);

  // Status indicator ring around head
  const stateCol = a.state === "working" ? N.amber : a.state === "walking" ? N.green : N.white;
  ctx.strokeStyle = stateCol; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(sx, sy - 16 + bob, 6.5, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;

  // MMO-style floating nametag: NAME (LV) — reference: cyber plaza tags
  const lvl = Math.min(99, 1 + (a.sessions ?? 0) * 4 + (a.id.length % 9));
  const nm = a.name.length > 9 ? a.name.slice(0, 9) : a.name;
  const lvStr = ` (${lvl})`;
  ctx.font = "bold 7px monospace";
  const w1 = ctx.measureText(nm).width;
  ctx.font = "bold 7px monospace";
  const w2 = ctx.measureText(lvStr).width;
  const nw = w1 + w2 + 12;
  const tagY = sy - 24 + bob;
  ctx.fillStyle = "rgba(0,0,0,0.88)"; ctx.beginPath(); ctx.roundRect(sx - nw / 2, tagY, nw, 12, 2); ctx.fill();
  ctx.strokeStyle = a.color; ctx.globalAlpha = 0.75; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(sx - nw / 2, tagY, nw, 12, 2); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.textAlign = "left"; ctx.textBaseline = "middle";
  const tx = sx - nw / 2 + 6;
  strokeArcadeText(ctx, nm, tx, tagY + 6, 2);
  strokeArcadeText(ctx, lvStr, tx + w1, tagY + 6, 2);
  ctx.fillStyle = "#fff"; ctx.fillText(nm, tx, tagY + 6);
  ctx.fillStyle = N.cyan;
  ctx.fillText(lvStr, tx + w1, tagY + 6);
  ctx.textAlign = "center";

  // Working spark
  if (a.state === "working") {
    const sparkA = Math.sin(frame * 0.08) * 0.3 + 0.7;
    ctx.save(); ctx.shadowColor = N.amber; ctx.shadowBlur = 5;
    ctx.fillStyle = N.amber; ctx.globalAlpha = sparkA; ctx.font = "8px sans-serif";
    ctx.fillText("⚡", sx + 10, sy - 15 + bob); ctx.restore();
  }

  // Task speech bubble (only when agent has a task)
  if (a.task && a.task.length > 0) {
    const taskText = a.task.length > 28 ? a.task.slice(0, 26) + "…" : a.task;
    ctx.font = "6px monospace";
    const tw = ctx.measureText(taskText).width + 12;
    const bby = sy - 42 + bob;

    ctx.fillStyle = "rgba(0,0,0,0.85)"; ctx.beginPath(); ctx.roundRect(sx - tw / 2, bby - 8, tw, 14, 3); ctx.fill();
    ctx.strokeStyle = N.amber; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.roundRect(sx - tw / 2, bby - 8, tw, 14, 3); ctx.stroke(); ctx.globalAlpha = 1;
    // Bubble pointer
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.beginPath(); ctx.moveTo(sx - 3, bby + 6); ctx.lineTo(sx, bby + 10); ctx.lineTo(sx + 3, bby + 6); ctx.fill();
    // Text
    ctx.fillStyle = N.amber; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(taskText, sx, bby - 1);
  }

  // Hover tooltip with details
  if (isHovered) {
    const tooltipY = sy + 12;
    const lines = [
      `ID: ${a.id}`,
      `State: ${a.state.toUpperCase()}`,
      a.model ? `Model: ${a.model.split("/").pop()}` : "",
      a.task ? `Task: ${a.task.slice(0, 30)}` : "",
    ].filter(l => l);

    ctx.font = "7px monospace";
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
    const ttH = lines.length * 11 + 8;

    ctx.fillStyle = "rgba(0,0,0,0.9)"; ctx.beginPath(); ctx.roundRect(sx - maxW / 2, tooltipY, maxW, ttH, 4); ctx.fill();
    ctx.strokeStyle = a.color; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(sx - maxW / 2, tooltipY, maxW, ttH, 4); ctx.stroke(); ctx.globalAlpha = 1;

    ctx.fillStyle = a.color; ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.globalAlpha = i === 0 ? 0.9 : 0.6;
      ctx.fillText(lines[i], sx - maxW / 2 + 8, tooltipY + 5 + i * 11);
    }
    ctx.globalAlpha = 1;
  }
}

// ─── Particles ─────────────────────────────────────────────────

function emitNeonSmoke(p: Particle[], bx: number, by: number, b: BuildingDef) { if (p.length > 150) return; p.push({ x: bx + b.w * 0.55 + (Math.random() - 0.5) * 4, y: by - b.d * 0.6 - b.h - 22, vx: (Math.random() - 0.5) * 0.3, vy: -0.5 - Math.random() * 0.3, life: 60 + Math.random() * 40, maxLife: 100, color: N.orange, size: 2 + Math.random() * 2 }); }
function emitDataSparkle(p: Particle[], bx: number, by: number, b: BuildingDef) { if (p.length > 150) return; p.push({ x: bx + (Math.random() - 0.5) * b.w * 1.2, y: by - b.h * 0.5 + (Math.random() - 0.5) * b.h * 0.6, vx: (Math.random() - 0.5) * 0.5, vy: -0.7 - Math.random() * 0.5, life: 35 + Math.random() * 25, maxLife: 60, color: N.purple, size: 1 + Math.random() * 1.5 }); }
function emitCyanSpark(p: Particle[], bx: number, by: number, b: BuildingDef) { if (p.length > 150) return; p.push({ x: bx + (Math.random() - 0.5) * b.w, y: by - b.h - b.d * 2 - 14, vx: (Math.random() - 0.5) * 0.8, vy: -0.3 - Math.random() * 0.4, life: 25 + Math.random() * 20, maxLife: 45, color: N.cyan, size: 1 + Math.random() }); }

function updateParticles(particles: Particle[]) { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.life--; if (p.life <= 0) particles.splice(i, 1); } }

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    const a = (p.life / p.maxLife) * 0.55; const sz = p.size * (p.life / p.maxLife);
    ctx.save(); ctx.shadowColor = p.color; ctx.shadowBlur = 4;
    ctx.fillStyle = p.color; ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

// ─── HUD ───────────────────────────────────────────────────────

function drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number, agents: AgentSprite[], activeCount: number, frame: number, activityLog: ActivityEntry[], cronCount: number, skillCount: number, channelCount: number) {
  // Title — arcade cabinet bezel
  ctx.fillStyle = "rgba(0,0,0,0.88)"; ctx.beginPath(); ctx.roundRect(10, 8, 248, 48, 4); ctx.fill();
  ctx.strokeStyle = N.arcadeYellow; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(10, 8, 248, 48, 4); ctx.stroke();
  ctx.strokeStyle = N.hotPink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(8, 6, 252, 52, 5); ctx.stroke(); ctx.globalAlpha = 1;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.font = "bold 16px monospace"; ctx.fillStyle = N.cyan;
  strokeArcadeText(ctx, "CRYSTAL CITY", 22, 18, 3.5);
  ctx.fillText("CRYSTAL CITY", 22, 18);
  ctx.font = "bold 8px monospace"; ctx.fillStyle = N.arcadeYellow;
  ctx.fillText("◆ OPENCLAW ARCADE NET ◆", 22, 38);
  ctx.font = "7px monospace"; ctx.fillStyle = N.magenta; ctx.globalAlpha = 0.75;
  ctx.fillText("PLAYER 1 — SELECT DESTINATION", 22, 46); ctx.globalAlpha = 1;

  // Stats panel (top right) — VS screen style
  ctx.fillStyle = "rgba(0,0,0,0.88)"; ctx.beginPath(); ctx.roundRect(w - 272, 8, 260, 72, 4); ctx.fill();
  ctx.strokeStyle = N.cyan; ctx.globalAlpha = 0.45; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(w - 272, 8, 260, 72, 4); ctx.stroke();
  ctx.strokeStyle = N.purple; ctx.globalAlpha = 0.3; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(w - 274, 6, 264, 76, 5); ctx.stroke(); ctx.globalAlpha = 1;
  const dotCol = activeCount > 0 ? N.green : N.red;
  ctx.save(); ctx.shadowColor = dotCol; ctx.shadowBlur = 8;
  ctx.fillStyle = dotCol; ctx.beginPath(); ctx.arc(w - 252, 30, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.font = "bold 10px monospace"; ctx.fillStyle = N.white; ctx.globalAlpha = 0.92;
  ctx.fillText(`${agents.length} FIGHTERS  |  ${activeCount} ZONES HOT`, w - 258, 22);
  ctx.font = "9px monospace"; ctx.fillStyle = N.amber; ctx.globalAlpha = 0.82;
  ctx.fillText(`CRON ${cronCount}  ·  SKILLS ${skillCount}  ·  CH ${channelCount}`, w - 258, 40);
  ctx.fillStyle = N.cyan; ctx.globalAlpha = 0.65;
  ctx.fillText(`TIME ${new Date().toLocaleTimeString("en-US", { hour12: false })}`, w - 258, 56);
  ctx.globalAlpha = 1;

  // Agent roster (right side)
  if (agents.length > 0) {
    const rosterW = 168;
    const rosterX = w - rosterW - 14, rosterY = 78;
    const rowH = 24;
    ctx.fillStyle = "rgba(0,0,0,0.88)"; ctx.beginPath(); ctx.roundRect(rosterX - 8, rosterY - 6, rosterW, agents.length * rowH + 22, 4); ctx.fill();
    ctx.strokeStyle = N.arcadeYellow; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(rosterX - 8, rosterY - 6, rosterW, agents.length * rowH + 22, 4); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = "bold 8px monospace"; ctx.fillStyle = N.cyan; ctx.globalAlpha = 0.9;
    ctx.fillText("◆ ROSTER ◆", rosterX, rosterY); ctx.globalAlpha = 1;

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]; const ay = rosterY + 16 + i * rowH;
      const stColor = a.state === "working" ? N.amber : a.state === "walking" ? N.green : "rgba(255,255,255,0.3)";
      ctx.fillStyle = stColor; ctx.beginPath(); ctx.arc(rosterX + 4, ay + 5, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 9px monospace"; ctx.fillStyle = a.color; ctx.textAlign = "left";
      ctx.fillText(`${a.emoji} ${a.name}`, rosterX + 12, ay);
      ctx.font = "7px monospace"; ctx.fillStyle = N.white; ctx.globalAlpha = 0.5;
      const stateLabel = a.state === "working" ? (a.task ? a.task.slice(0, 22) : "WORKING") : a.state.toUpperCase();
      ctx.fillText(stateLabel, rosterX + 12, ay + 12); ctx.globalAlpha = 1;
    }
  }

  // Activity feed (bottom left)
  if (activityLog.length > 0) {
    const feedX = 14, feedY = h - 14;
    const shown = activityLog.slice(-5);
    const lineH = 15;
    ctx.fillStyle = "rgba(0,0,0,0.68)"; ctx.beginPath(); ctx.roundRect(feedX - 4, feedY - shown.length * lineH - 22, 268, shown.length * lineH + 26, 5); ctx.fill();
    ctx.strokeStyle = N.green; ctx.globalAlpha = 0.18; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(feedX - 4, feedY - shown.length * lineH - 22, 268, shown.length * lineH + 26, 5); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = "bold 8px monospace"; ctx.fillStyle = N.green; ctx.globalAlpha = 0.55;
    ctx.fillText("ACTIVITY LOG", feedX, feedY - shown.length * lineH - 12); ctx.globalAlpha = 1;

    for (let i = 0; i < shown.length; i++) {
      const entry = shown[i];
      const age = (Date.now() - entry.time) / 1000;
      ctx.font = "8px monospace"; ctx.fillStyle = entry.color;
      ctx.globalAlpha = Math.max(0.22, 1 - age / 60);
      ctx.textAlign = "left";
      ctx.fillText(`› ${entry.text}`, feedX, feedY - (shown.length - 1 - i) * lineH);
    }
    ctx.globalAlpha = 1;
  }

  // Bottom — attract mode blink
  ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.fillStyle = N.signGreen;
  ctx.globalAlpha = 0.2 + Math.sin(frame * 0.04) * 0.12;
  strokeArcadeText(ctx, "CLICK ZONE TO ENTER  ·  HOVER AGENT FOR INTEL", w / 2, h - 12, 2);
  ctx.fillText("CLICK ZONE TO ENTER  ·  HOVER AGENT FOR INTEL", w / 2, h - 12);
  ctx.globalAlpha = 1;
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) {
  ctx.fillStyle = "rgba(0,0,0,0.055)";
  for (let y = 0; y < h; y += 2) ctx.fillRect(0, y, w, 1);
  ctx.fillStyle = "rgba(255,255,255,0.012)";
  for (let y = 1; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  const scanY = (frame * 1.35) % (h + 50) - 25;
  const scanG = ctx.createLinearGradient(0, scanY - 18, 0, scanY + 18);
  scanG.addColorStop(0, "rgba(255,62,184,0)"); scanG.addColorStop(0.45, "rgba(0,255,242,0.028)"); scanG.addColorStop(1, "rgba(255,62,184,0)");
  ctx.fillStyle = scanG; ctx.fillRect(0, scanY - 18, w, 36);
}

/** CRT / arcade cabinet vignette. */
function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.28, w / 2, h / 2, Math.max(w, h) * 0.72);
  vg.addColorStop(0, "rgba(20,0,40,0)");
  vg.addColorStop(0.55, "rgba(10,0,24,0.12)");
  vg.addColorStop(1, "rgba(0,0,0,0.62)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  const corner = ctx.createLinearGradient(0, 0, w * 0.35, h * 0.35);
  corner.addColorStop(0, "rgba(255,45,149,0.06)"); corner.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = corner; ctx.fillRect(0, 0, w * 0.5, h * 0.5);
}

// ─── Main Component ────────────────────────────────────────────

export function CityView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const worldRef = useRef({
    agents: [] as AgentSprite[], particles: [] as Particle[], rain: [] as Raindrop[],
    pulses: [] as DataPulse[], drones: [] as Drone[], billboards: [] as Billboard[],
    arcs: [] as ElectricArc[], shootingStars: [] as ShootingStar[],
    activityLog: [] as ActivityEntry[], steamVents: [...STEAM_VENTS],
    frame: 0, hoveredBuilding: null as string | null, hoveredAgent: null as string | null,
    mouseX: 0, mouseY: 0, activeBuildings: new Set<string>(),
    buildingStats: {} as Record<string, { count: number; label: string }>,
    stars: Array.from({ length: 120 }, () => ({ x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2, bright: Math.random() })) as Star[],
    canvasW: 900, canvasH: 600, lastDataPoll: 0, rainInited: false, cronCount: 0,
    skillCount: 0, channelCount: 0,
  });

  const setView = useAppStore(s => s.setView);
  const getAgents = useDataStore(s => s.getAgents);
  const getTasks = useDataStore(s => s.getTasks);
  const getCronJobs = useDataStore(s => s.getCronJobs);
  const getSessions = useDataStore(s => s.getSessions);
  const getSkills = useDataStore(s => s.getSkills);
  const getChannelStatus = useDataStore(s => s.getChannelStatus);

  const addActivity = useCallback((text: string, color: string) => {
    const w = worldRef.current;
    w.activityLog.push({ text, color, time: Date.now() });
    if (w.activityLog.length > 20) w.activityLog.shift();
  }, []);

  const pollData = useCallback(async () => {
    const w = worldRef.current;
    try {
      const [agentsRaw, tasksRaw, cronRaw, sessionsRaw, skillsRaw, channelRaw] = await Promise.all([
        getAgents(), getTasks(), getCronJobs(), getSessions(), getSkills(), getChannelStatus(),
      ]);
      const agents = (agentsRaw ?? []) as Record<string, unknown>[];
      const tasks = (tasksRaw ?? []) as Record<string, unknown>[];
      const sessions = (sessionsRaw ?? []) as Record<string, unknown>[];
      const runningTasks = tasks.filter(t => t.status === "running" || t.status === "in_progress");
      const cronJobs = (cronRaw ?? []) as Record<string, unknown>[];
      const skills = Array.isArray(skillsRaw) ? skillsRaw : [];
      const channels = channelRaw as Record<string, unknown>;
      const channelList = Array.isArray(channels?.channels) ? channels.channels as Record<string, unknown>[] : [];
      const activeCronCount = cronJobs.filter(c => c.enabled !== false).length;
      w.cronCount = activeCronCount;
      w.skillCount = skills.length;
      w.channelCount = channelList.length;

      w.activeBuildings.clear();
      const stats: Record<string, { count: number; label: string }> = {};

      stats.clock = { count: activeCronCount, label: activeCronCount > 0 ? `${activeCronCount} JOBS` : "IDLE" };
      if (activeCronCount > 0) w.activeBuildings.add("clock");

      stats.barracks = { count: agents.length, label: `${agents.length} AGENTS` };
      if (agents.length > 0) w.activeBuildings.add("barracks");

      const activeChannels = channelList.filter(c => c.status === "connected" || c.status === "active" || c.connected === true);
      stats.comms = { count: activeChannels.length, label: activeChannels.length > 0 ? `${activeChannels.length} LIVE` : `${channelList.length} CH` };
      if (activeChannels.length > 0) w.activeBuildings.add("comms");

      const enabledSkills = skills.filter(s => (s as Record<string, unknown>).enabled !== false);
      stats.vault = { count: enabledSkills.length, label: `${enabledSkills.length} SKILLS` };
      if (enabledSkills.length > 0) w.activeBuildings.add("vault");

      let forgeTaskCount = 0;
      let memoryTaskCount = 0;
      let commsTaskCount = 0;
      let officeTaskCount = 0;
      for (const t of runningTasks) {
        const kind = String(t.kind ?? t.type ?? "").toLowerCase();
        if (kind.includes("cron")) { w.activeBuildings.add("clock"); }
        else if (kind.includes("skill") || kind.includes("build")) { w.activeBuildings.add("factory"); forgeTaskCount++; }
        else if (kind.includes("memory") || kind.includes("search") || kind.includes("embed")) { w.activeBuildings.add("memory"); memoryTaskCount++; }
        else if (kind.includes("channel") || kind.includes("message") || kind.includes("telegram")) { w.activeBuildings.add("comms"); commsTaskCount++; }
        else { w.activeBuildings.add("office"); officeTaskCount++; }
      }
      stats.factory = { count: forgeTaskCount, label: forgeTaskCount > 0 ? `${forgeTaskCount} BUILDS` : "IDLE" };
      stats.memory = { count: memoryTaskCount, label: memoryTaskCount > 0 ? `${memoryTaskCount} OPS` : "READY" };
      stats.office = { count: officeTaskCount + runningTasks.length, label: runningTasks.length > 0 ? `${runningTasks.length} TASKS` : "CLEAR" };

      const chatSessions = sessions.filter(s => s.kind === "chat" || s.kind === "conversation");
      stats.terminal = { count: chatSessions.length, label: chatSessions.length > 0 ? `${chatSessions.length} CHATS` : "IDLE" };
      if (chatSessions.length > 0) w.activeBuildings.add("terminal");
      if (runningTasks.length > 0 && !w.activeBuildings.has("office")) w.activeBuildings.add("office");

      w.buildingStats = stats;

      const existingIds = new Set(w.agents.map(a => a.id));
      for (const raw of agents) {
        const id = String(raw.id ?? ""); if (!id) continue;
        const name = String(raw.identityName ?? raw.id ?? "agent");
        const shortName = name.length > 12 ? name.split(/[\s(]/)[0] : name;
        const agentTasks = runningTasks.filter(t => String(t.agentId ?? "") === id);
        const agentSessions = sessions.filter(s => String(s.agentId ?? "") === id);
        const homeId = AGENT_HOMES[id] ?? "barracks";
        const home = BUILDINGS.find(b => b.id === homeId)!;
        const model = String(raw.model ?? "");

        if (!existingIds.has(id)) {
          w.agents.push({ id, name: shortName, emoji: AGENT_EMOJI[id] ?? "🤖", color: AGENT_COLORS[id] ?? N.cyan,
            x: home.ox + (Math.random() - 0.5) * 20, y: home.oy + (Math.random() - 0.5) * 10,
            tx: home.ox, ty: home.oy, state: "idle", timer: 1 + Math.random() * 3, task: "", trail: [],
            model, sessions: agentSessions.length,
          });
          addActivity(`${shortName} came online`, AGENT_COLORS[id] ?? N.cyan);
        } else {
          const sprite = w.agents.find(a => a.id === id)!;
          sprite.name = shortName; sprite.model = model; sprite.sessions = agentSessions.length;
          if (agentTasks.length > 0) {
            const taskMsg = String(agentTasks[0].label ?? agentTasks[0].message ?? "");
            const taskKind = String(agentTasks[0].kind ?? "");
            const newTask = taskMsg.slice(0, 40);
            if (newTask !== sprite.task && newTask) addActivity(`${shortName}: ${newTask.slice(0, 35)}`, sprite.color);
            sprite.task = newTask;
            let targetBldg = "office";
            if (taskKind.includes("cron")) targetBldg = "clock";
            else if (taskKind.includes("build") || taskKind.includes("skill")) targetBldg = "factory";
            else if (taskKind.includes("agent")) targetBldg = "barracks";
            else if (taskKind.includes("memory") || taskKind.includes("search") || taskKind.includes("embed")) targetBldg = "memory";
            else if (taskKind.includes("channel") || taskKind.includes("message")) targetBldg = "comms";
            else if (taskKind.includes("tool")) targetBldg = "vault";
            sprite.targetBldg = targetBldg;
            const tb = BUILDINGS.find(b => b.id === targetBldg)!;
            sprite.tx = tb.ox + (Math.random() - 0.5) * 10; sprite.ty = tb.oy + (Math.random() - 0.5) * 6;
            if (sprite.state === "idle") { sprite.state = "walking"; sprite.timer = 0; }
          } else { sprite.task = ""; }
        }
      }
    } catch { /* non-fatal */ }
  }, [getAgents, getTasks, getCronJobs, getSessions, getSkills, getChannelStatus, addActivity]);

  const updateAgents = useCallback((dt: number, frame: number) => {
    const w = worldRef.current;
    for (const a of w.agents) {
      a.timer -= dt;
      if (a.state === "walking" && frame % 3 === 0) { a.trail.push({ x: a.x, y: a.y, age: 0 }); if (a.trail.length > 15) a.trail.shift(); }
      for (const t of a.trail) t.age++;
      while (a.trail.length > 0 && a.trail[0].age > 20) a.trail.shift();

      if (a.state === "walking") {
        const dx = a.tx - a.x, dy = a.ty - a.y, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 4) {
          a.x = a.tx; a.y = a.ty;
          a.state = a.task ? "working" : "idle";
          a.timer = a.task ? 10 + Math.random() * 12 : 5 + Math.random() * 10;
        } else {
          const speed = 42; a.x += (dx / dist) * speed * dt; a.y += (dy / dist) * speed * dt;
        }
      } else if (a.state === "working" && a.timer <= 0) {
        if (a.task) {
          a.timer = 8 + Math.random() * 10;
        } else {
          const homeId = AGENT_HOMES[a.id] ?? "barracks";
          const home = BUILDINGS.find(b => b.id === homeId)!;
          a.tx = home.ox + (Math.random() - 0.5) * 10;
          a.ty = home.oy + (Math.random() - 0.5) * 6;
          a.state = "walking";
        }
      } else if (a.state === "idle" && a.timer <= 0) {
        if (a.task) {
          const tb = BUILDINGS.find(b => b.id === (a.targetBldg ?? "barracks"))!;
          a.tx = tb.ox + (Math.random() - 0.5) * 10;
          a.ty = tb.oy + (Math.random() - 0.5) * 6;
          a.state = "walking";
        } else {
          const homeId = AGENT_HOMES[a.id] ?? "barracks";
          const home = BUILDINGS.find(b => b.id === homeId)!;
          const dx = home.ox - a.x, dy = home.oy - a.y;
          if (Math.sqrt(dx * dx + dy * dy) > 15) {
            a.tx = home.ox + (Math.random() - 0.5) * 8;
            a.ty = home.oy + (Math.random() - 0.5) * 4;
            a.state = "walking";
          } else {
            a.timer = 6 + Math.random() * 10;
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    let lastTime = 0;
    const w = worldRef.current;

    function loop(time: number) {
      const dt = Math.min((time - lastTime) / 1000, 0.1); lastTime = time; w.frame++;

      if (!w.rainInited && w.canvasW > 0) {
        w.rainInited = true;
        for (let i = 0; i < RAIN_COUNT; i++) w.rain.push({ x: Math.random() * (w.canvasW + 60), y: Math.random() * w.canvasH, speed: 3 + Math.random() * 5, len: 8 + Math.random() * 14 });
      }

      if (time - w.lastDataPoll > 15000) { w.lastDataPoll = time; pollData(); }
      updateAgents(dt, w.frame);
      initBillboards(w.billboards);
      updateDrones(w.drones, w.frame, w.activeBuildings);
      updateArcs(w.arcs, w.frame, w.canvasW / 2, w.canvasH / 2, w.activeBuildings);

      if (w.frame % 8 === 0) {
        for (const b of BUILDINGS) {
          if (!w.activeBuildings.has(b.id)) continue;
          const bx = w.canvasW / 2 + b.ox, by = w.canvasH / 2 + b.oy;
          if (b.id === "factory") emitNeonSmoke(w.particles, bx, by, b);
          if (b.id === "memory") emitDataSparkle(w.particles, bx, by, b);
          if (b.id === "comms") emitCyanSpark(w.particles, bx, by, b);
        }
      }
      updateParticles(w.particles);

      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

      const dpr = window.devicePixelRatio || 1;
      const cw = w.canvasW, ch = w.canvasH;
      const targetW = Math.round(cw * dpr), targetH = Math.round(ch * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) { canvas.width = targetW; canvas.height = targetH; canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`; }
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cx = cw / 2, cy = ch / 2;

      drawSky(ctx, cw, ch, w.stars, w.frame, w.shootingStars);
      drawRain(ctx, w.rain, cw, ch);
      drawGround(ctx, cx, cy, w.frame);
      drawSteamVents(ctx, cx, cy, w.steamVents, w.particles, w.frame, w.activeBuildings.size > 0);
      drawPaths(ctx, cx, cy, w.frame, w.pulses);
      drawHoloCore(ctx, cx, cy + 20, w.frame);

      const drawables: { type: "pylon" | "building" | "agent" | "drone"; y: number; idx: number }[] = [];
      PYLON_POS.forEach((_, i) => drawables.push({ type: "pylon", y: PYLON_POS[i][1], idx: i }));
      BUILDINGS.forEach((b, i) => drawables.push({ type: "building", y: b.oy, idx: i }));
      w.agents.forEach((a, i) => drawables.push({ type: "agent", y: a.y, idx: i }));
      w.drones.forEach((d, i) => drawables.push({ type: "drone", y: d.y, idx: i }));
      drawables.sort((a, b) => a.y - b.y);

      for (const d of drawables) {
        if (d.type === "pylon") { const [tx, ty] = PYLON_POS[d.idx]; drawHoloPylon(ctx, cx + tx, cy + ty, w.frame, d.idx); }
        else if (d.type === "building") {
          const b = BUILDINGS[d.idx]; const bx = cx + b.ox, by = cy + b.oy; const hovered = w.hoveredBuilding === b.id;
          if (hovered) { ctx.save(); ctx.shadowColor = b.accent; ctx.shadowBlur = 25; }
          drawIsoBox(ctx, bx, by, b.w, b.d, b.h, b.top, b.left, b.right);
          strokeIsoBlack(ctx, bx, by, b.w, b.d, b.h, hovered ? 2.35 : 1.85);
          if (hovered) ctx.restore();
          drawBuildingExtras(ctx, b, bx, by, w.frame, w.activeBuildings.has(b.id), w.agents, w.buildingStats);
          drawBuildingLabel(ctx, b, bx, by, hovered, w.buildingStats[b.id]);
        } else if (d.type === "agent") {
          drawAgentSprite(ctx, w.agents[d.idx], w.frame, cx, cy, w.hoveredAgent === w.agents[d.idx].id);
        } else if (d.type === "drone") {
          drawDrones(ctx, [w.drones[d.idx]], cx, cy, w.frame);
        }
      }

      drawArcs(ctx, w.arcs);
      drawBillboards(ctx, w.billboards, cx, cy, w.frame, w.agents, w.activeBuildings.size);
      drawParticles(ctx, w.particles);
      drawHUD(ctx, cw, ch, w.agents, w.activeBuildings.size, w.frame, w.activityLog, w.cronCount, w.skillCount, w.channelCount);
      drawScanlines(ctx, cw, ch, w.frame);
      drawVignette(ctx, cw, ch);

      ctx.restore();
      rafRef.current = requestAnimationFrame(loop);
    }

    pollData();
    addActivity("Crystal City initialized", N.cyan);
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pollData, updateAgents, addActivity]);

  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    const observer = new ResizeObserver((entries) => { for (const e of entries) { worldRef.current.canvasW = e.contentRect.width; worldRef.current.canvasH = e.contentRect.height; } });
    observer.observe(container);
    worldRef.current.canvasW = container.clientWidth; worldRef.current.canvasH = container.clientHeight;
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = worldRef.current; const cx = w.canvasW / 2, cy = w.canvasH / 2;
    w.mouseX = mx; w.mouseY = my;

    let hovered: string | null = null;
    for (const b of BUILDINGS) {
      const bx = cx + b.ox, by = cy + b.oy;
      if (mx > bx - b.w - 8 && mx < bx + b.w + 8 && my > by - b.h - b.d * 2 - 20 && my < by + 8) { hovered = b.id; break; }
    }
    w.hoveredBuilding = hovered;

    let hoveredAgent: string | null = null;
    for (const a of w.agents) {
      const ax = cx + a.x, ay = cy + a.y;
      if (Math.abs(mx - ax) < 15 && Math.abs(my - ay) < 25) { hoveredAgent = a.id; break; }
    }
    w.hoveredAgent = hoveredAgent;
    canvas.style.cursor = hovered || hoveredAgent ? "pointer" : "default";
  }, []);

  const handleClick = useCallback(() => {
    const w = worldRef.current;
    if (!w.hoveredBuilding) return;
    const b = BUILDINGS.find(bl => bl.id === w.hoveredBuilding);
    if (!b) return;
    if (b.linkedCenterTab) setView(b.linkedView, { centerTab: b.linkedCenterTab });
    else setView(b.linkedView);
  }, [setView]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#050010",
        filter: "contrast(1.07) saturate(1.18)",
      }}
    >
      <canvas ref={canvasRef} onMouseMove={handleMouseMove} onClick={handleClick} style={{ display: "block" }} />
    </div>
  );
}
