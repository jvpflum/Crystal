import { useEffect, useRef, useCallback } from "react";
import { useAppStore, type AppView } from "@/stores/appStore";
import { useDataStore } from "@/stores/dataStore";

/* ═══════════════════════════════════════════════════════
   Crystal City — Isometric visualization of OpenClaw
   ═══════════════════════════════════════════════════════ */

// ─── Types ───────────────────────────────────────────────

interface BuildingDef {
  id: string;
  name: string;
  ox: number;
  oy: number;
  w: number;   // half-width (screen px)
  d: number;   // half-depth (screen px)
  h: number;   // height (screen px)
  top: string;
  left: string;
  right: string;
  accent: string;
  linkedView: AppView;
  icon: string;
}

interface AgentSprite {
  id: string;
  name: string;
  emoji: string;
  color: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: "idle" | "walking" | "working";
  timer: number;
  task: string;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
}

interface Star { x: number; y: number; phase: number; }

// ─── Constants ───────────────────────────────────────────

const BUILDINGS: BuildingDef[] = [
  { id: "clock",    name: "Clock Tower",  ox:    0, oy: -135, w: 22, d: 16, h: 88,  top: "#c4a87a", left: "#8b7355", right: "#a08960", accent: "#f59e0b", linkedView: "cron",         icon: "🕐" },
  { id: "memory",   name: "Memory Vault", ox: -170, oy:  -25, w: 28, d: 22, h: 55,  top: "#7a5ca3", left: "#4a2c73", right: "#5a3c83", accent: "#a855f7", linkedView: "memory",       icon: "🧠" },
  { id: "office",   name: "The Office",   ox:  170, oy:  -25, w: 30, d: 22, h: 68,  top: "#5a7a9a", left: "#2a4a6a", right: "#3a5a7a", accent: "#3B82F6", linkedView: "office",       icon: "🏢" },
  { id: "factory",  name: "The Factory",  ox: -170, oy:  100, w: 35, d: 25, h: 48,  top: "#9a6a4a", left: "#6a3a1a", right: "#7a4a2a", accent: "#f97316", linkedView: "factory",      icon: "🏭" },
  { id: "comms",    name: "Signal Tower", ox:  170, oy:  100, w: 20, d: 15, h: 92,  top: "#3a9a9a", left: "#1a6a6a", right: "#2a7a7a", accent: "#06b6d4", linkedView: "channels",     icon: "📡" },
  { id: "terminal", name: "The Terminal", ox:    0, oy:  185, w: 32, d: 20, h: 38,  top: "#4a6a4a", left: "#1a3a1a", right: "#2a4a2a", accent: "#4ade80", linkedView: "conversation", icon: "💻" },
];

const AGENT_HOMES: Record<string, string> = {
  main: "office", research: "memory", home: "terminal", finance: "factory",
};
const AGENT_COLORS: Record<string, string> = {
  main: "#3B82F6", research: "#a855f7", home: "#10b981", finance: "#f59e0b",
};
const AGENT_EMOJI: Record<string, string> = {
  main: "🦉", research: "🔬", home: "🏡", finance: "💰",
};

const TREE_POS: [number, number][] = [
  [-90, -95], [90, -95], [-250, 30], [250, 30],
  [-100, 45], [105, 45], [-70, 155], [75, 155],
  [0, -75], [-40, 145], [45, 145], [-250, 120], [250, 120],
];

const GROUND_N = 14;
const TW = 50;
const TH = 25;

// ─── Drawing Primitives ─────────────────────────────────

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, d: number, h: number,
  topC: string, leftC: string, rightC: string,
) {
  ctx.fillStyle = rightC;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y - d);
  ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.fillStyle = leftC;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x - w, y - d);
  ctx.lineTo(x - w, y - d - h); ctx.lineTo(x, y - h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = topC;
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h);
  ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string) {
  ctx.fillStyle = c;
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x, y + h / 2); ctx.lineTo(x - w / 2, y);
  ctx.closePath();
  ctx.fill();
}

// ─── Environment Drawing ────────────────────────────────

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, stars: Star[], frame: number) {
  const hr = new Date().getHours();
  let t1: string, t2: string;
  if (hr >= 6 && hr < 12) { t1 = "#0f172a"; t2 = "#1e293b"; }
  else if (hr >= 12 && hr < 18) { t1 = "#0c1524"; t2 = "#1a2744"; }
  else if (hr >= 18 && hr < 21) { t1 = "#1a0a2e"; t2 = "#2d1b4e"; }
  else { t1 = "#050510"; t2 = "#0a0a1a"; }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, t1); g.addColorStop(1, t2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  if (hr >= 19 || hr < 6) {
    for (const s of stars) {
      const a = (Math.sin(frame * 0.015 + s.phase) * 0.3 + 0.7) * 0.6;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(s.x * w, s.y * h * 0.5, 1.2, 1.2);
    }
  }
}

function drawGround(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const oy = cy + 25;
  for (let gy = 0; gy < GROUND_N; gy++) {
    for (let gx = 0; gx < GROUND_N; gx++) {
      const sx = cx + (gx - gy) * TW / 2;
      const sy = oy - GROUND_N * TH / 2 + (gx + gy) * TH / 2;
      const shade = (gx + gy) % 2 === 0 ? "#2f5a26" : "#377030";
      drawDiamond(ctx, sx, sy, TW, TH, shade);
    }
  }
}

function drawPaths(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.strokeStyle = "rgba(180,160,130,0.35)";
  ctx.lineWidth = 8;
  ctx.lineCap = "round";
  const center = { x: cx, y: cy + 20 };
  for (const b of BUILDINGS) {
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(cx + b.ox, cy + b.oy);
    ctx.stroke();
  }
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number, i: number) {
  const sway = Math.sin(frame * 0.01 + i * 1.5) * 1.5;
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4a2a10";
  ctx.fillRect(x - 1.5, y - 16, 3, 14);
  ctx.fillStyle = "#275a1f";
  ctx.beginPath(); ctx.arc(x + sway, y - 22, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2f6a25";
  ctx.beginPath(); ctx.arc(x + sway - 3, y - 18, 6, 0, Math.PI * 2); ctx.fill();
}

function drawFountain(ctx: CanvasRenderingContext2D, x: number, y: number, frame: number) {
  ctx.fillStyle = "rgba(40,90,140,0.25)";
  ctx.beginPath(); ctx.ellipse(x, y + 2, 18, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(60,130,200,0.35)";
  ctx.beginPath(); ctx.ellipse(x, y, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6a6a7a";
  ctx.fillRect(x - 2, y - 12, 4, 12);
  const spray = Math.sin(frame * 0.06) * 2;
  ctx.fillStyle = "rgba(120,190,255,0.5)";
  ctx.beginPath(); ctx.arc(x, y - 14 + spray, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(120,190,255,0.25)";
  ctx.beginPath(); ctx.arc(x - 4, y - 10 + spray * 0.7, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 4, y - 10 - spray * 0.5, 2, 0, Math.PI * 2); ctx.fill();
}

// ─── Building Details ────────────────────────────────────

function drawBuildingExtras(
  ctx: CanvasRenderingContext2D, b: BuildingDef,
  bx: number, by: number, frame: number, active: boolean,
) {
  switch (b.id) {
    case "clock": {
      // Pointed roof
      ctx.fillStyle = "#7a6345";
      ctx.beginPath();
      ctx.moveTo(bx, by - b.h - b.d * 2 - 18);
      ctx.lineTo(bx + b.w * 0.7, by - b.h - b.d);
      ctx.lineTo(bx - b.w * 0.7, by - b.h - b.d);
      ctx.closePath();
      ctx.fill();
      // Clock face
      const cy = by - b.h - b.d - 4;
      ctx.fillStyle = "#f5f0e0";
      ctx.beginPath(); ctx.arc(bx, cy, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#444"; ctx.lineWidth = 0.8; ctx.stroke();
      const now = new Date();
      const ha = (now.getHours() % 12 / 12) * Math.PI * 2 - Math.PI / 2;
      const ma = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = "#333"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx, cy); ctx.lineTo(bx + Math.cos(ha) * 4, cy + Math.sin(ha) * 4); ctx.stroke();
      ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(bx, cy); ctx.lineTo(bx + Math.cos(ma) * 5.5, cy + Math.sin(ma) * 5.5); ctx.stroke();
      if (active) {
        ctx.save();
        ctx.globalAlpha = 0.15 + Math.sin(frame * 0.04) * 0.1;
        ctx.fillStyle = b.accent;
        ctx.beginPath(); ctx.arc(bx, by - b.h / 2, b.w * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      break;
    }
    case "factory": {
      // Chimney
      drawIsoBox(ctx, bx + b.w * 0.55, by - b.d * 0.6, 6, 5, b.h + 22, "#5a3015", "#4a2008", "#4a2510");
      // Gear on front face
      if (active) {
        ctx.save();
        ctx.translate(bx + 8, by - b.h * 0.4);
        ctx.rotate(frame * 0.02);
        ctx.fillStyle = "rgba(255,200,100,0.55)";
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.fillRect(-1.5 + Math.cos(a) * 5, -1.5 + Math.sin(a) * 5, 3, 3);
        }
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      // Door
      ctx.fillStyle = "#3a2010";
      ctx.fillRect(bx - 4, by - 10, 8, 10);
      break;
    }
    case "memory": {
      // Dome
      ctx.fillStyle = "#6a4c93";
      ctx.beginPath(); ctx.arc(bx, by - b.h - b.d, b.w * 0.65, Math.PI, 0); ctx.closePath(); ctx.fill();
      // Rune glow
      ctx.save();
      const glow = 0.12 + Math.sin(frame * 0.025) * 0.08;
      ctx.globalAlpha = active ? glow * 2 : glow;
      ctx.fillStyle = b.accent;
      ctx.beginPath(); ctx.arc(bx, by - b.h * 0.5, b.w * 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Rune symbols
      ctx.fillStyle = `rgba(168,85,247,${active ? 0.7 : 0.3})`;
      ctx.font = "8px serif";
      ctx.textAlign = "center";
      ctx.fillText("✦", bx - 8, by - b.h * 0.35);
      ctx.fillText("✦", bx + 8, by - b.h * 0.35);
      break;
    }
    case "comms": {
      // Antenna mast
      ctx.strokeStyle = "#3a9a9a"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, by - b.h - 2 * b.d);
      ctx.lineTo(bx, by - b.h - 2 * b.d - 18);
      ctx.stroke();
      // Blinking light
      ctx.fillStyle = frame % 50 < 25 ? "#ff4444" : "#661111";
      ctx.beginPath(); ctx.arc(bx, by - b.h - 2 * b.d - 20, 2.5, 0, Math.PI * 2); ctx.fill();
      // Signal rings
      if (active) {
        for (let i = 0; i < 3; i++) {
          const r = ((frame * 0.6 + i * 18) % 55) + 5;
          const a = Math.max(0, 1 - r / 60) * 0.35;
          ctx.strokeStyle = `rgba(6,182,212,${a})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(bx, by - b.h - 2 * b.d - 14, r, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
        }
      }
      break;
    }
    case "office": {
      // Windows on left face
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const u = 0.3 + col * 0.35;
          const v = 0.15 + row * 0.27;
          const wx = bx - u * b.w;
          const wy = by - u * b.d - v * b.h;
          const lit = ((row + col + Math.floor(frame / 90)) % 3) !== 0;
          ctx.fillStyle = lit ? "rgba(255,255,180,0.45)" : "rgba(0,0,30,0.25)";
          ctx.fillRect(wx - 2, wy - 4, 4, 4);
        }
      }
      // Windows on right face
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
          const u = 0.3 + col * 0.35;
          const v = 0.15 + row * 0.27;
          const wx = bx + u * b.w;
          const wy = by - u * b.d - v * b.h;
          const lit = ((row + col + Math.floor(frame / 110)) % 3) !== 0;
          ctx.fillStyle = lit ? "rgba(255,255,180,0.45)" : "rgba(0,0,30,0.25)";
          ctx.fillRect(wx - 2, wy - 4, 4, 4);
        }
      }
      // Door
      ctx.fillStyle = "#1a3050";
      ctx.fillRect(bx - 3, by - 8, 6, 8);
      break;
    }
    case "terminal": {
      // Screen glow
      const screenGlow = active ? 0.5 : 0.2;
      ctx.fillStyle = `rgba(74,222,128,${screenGlow})`;
      ctx.fillRect(bx + 3, by - b.h * 0.75, b.w * 0.5, b.h * 0.4);
      ctx.fillStyle = `rgba(74,222,128,${screenGlow * 0.5})`;
      ctx.fillRect(bx - b.w * 0.5 - 3, by - b.h * 0.7, b.w * 0.4, b.h * 0.35);
      // Blinking cursor
      if (active && frame % 50 < 25) {
        ctx.fillStyle = "#4ade80";
        ctx.fillRect(bx + 6, by - b.h * 0.5, 3, 2);
      }
      break;
    }
  }
}

// ─── Agent Sprite ────────────────────────────────────────

function drawAgentSprite(
  ctx: CanvasRenderingContext2D, a: AgentSprite, frame: number,
) {
  const bob = a.state === "walking"
    ? Math.sin(frame * 0.12) * 2.5
    : Math.sin(frame * 0.03) * 0.8;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath(); ctx.ellipse(a.x, a.y + 1, 6, 3, 0, 0, Math.PI * 2); ctx.fill();

  // Legs
  if (a.state === "walking") {
    const leg = Math.sin(frame * 0.12) * 2.5;
    ctx.strokeStyle = a.color; ctx.lineWidth = 1.8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x - 2, a.y - 2 + bob); ctx.lineTo(a.x - 2 + leg, a.y + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(a.x + 2, a.y - 2 + bob); ctx.lineTo(a.x + 2 - leg, a.y + 1); ctx.stroke();
  }

  // Body
  ctx.fillStyle = a.color;
  ctx.beginPath();
  ctx.roundRect(a.x - 4, a.y - 12 + bob, 8, 10, 2);
  ctx.fill();

  // Head
  ctx.fillStyle = lighten(a.color);
  ctx.beginPath(); ctx.arc(a.x, a.y - 16 + bob, 4.5, 0, Math.PI * 2); ctx.fill();

  // Emoji badge
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(a.emoji, a.x, a.y - 28 + bob);

  // Name tag
  ctx.font = "bold 7px 'Courier New', monospace";
  const nm = a.name.length > 8 ? a.name.slice(0, 8) : a.name;
  const nw = ctx.measureText(nm).width + 6;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.roundRect(a.x - nw / 2, a.y - 23 + bob, nw, 10, 3); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(nm, a.x, a.y - 18 + bob);

  // Activity spark
  if (a.state === "working") {
    const sparkA = Math.sin(frame * 0.08) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255,220,100,${sparkA})`;
    ctx.font = "7px sans-serif";
    ctx.fillText("⚡", a.x + 9, a.y - 15 + bob);
  }
}

function lighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.min(255, r + 50)},${Math.min(255, g + 50)},${Math.min(255, b + 50)})`;
}

// ─── Particle System ─────────────────────────────────────

function emitSmoke(particles: Particle[], bx: number, by: number, b: BuildingDef) {
  if (particles.length > 120) return;
  particles.push({
    x: bx + b.w * 0.55 + (Math.random() - 0.5) * 4,
    y: by - b.d * 0.6 - b.h - 22,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.4 - Math.random() * 0.3,
    life: 60 + Math.random() * 40, maxLife: 100,
    color: "rgba(150,150,160,", size: 2 + Math.random() * 2,
  });
}

function emitSparkle(particles: Particle[], bx: number, by: number, b: BuildingDef) {
  if (particles.length > 120) return;
  particles.push({
    x: bx + (Math.random() - 0.5) * b.w * 1.2,
    y: by - b.h * 0.5 + (Math.random() - 0.5) * b.h * 0.6,
    vx: (Math.random() - 0.5) * 0.5,
    vy: -0.6 - Math.random() * 0.4,
    life: 40 + Math.random() * 30, maxLife: 70,
    color: "rgba(168,85,247,", size: 1.5 + Math.random() * 1.5,
  });
}

function updateParticles(particles: Particle[]) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    const a = (p.life / p.maxLife) * 0.5;
    ctx.fillStyle = p.color + a + ")";
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2); ctx.fill();
  }
}

// ─── Building Labels & HUD ──────────────────────────────

function drawBuildingLabel(
  ctx: CanvasRenderingContext2D, b: BuildingDef, bx: number, by: number,
  hovered: boolean,
) {
  const ly = by - b.h - b.d * 2 - (b.id === "clock" ? 30 : 12);
  ctx.font = hovered ? "bold 10px sans-serif" : "9px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = `${b.icon} ${b.name}`;
  const lw = ctx.measureText(label).width + 10;
  ctx.fillStyle = hovered ? "rgba(0,0,0,0.7)" : "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.roundRect(bx - lw / 2, ly - 7, lw, 14, 4); ctx.fill();
  if (hovered) {
    ctx.strokeStyle = b.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx - lw / 2, ly - 7, lw, 14, 4); ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  ctx.fillText(label, bx, ly);
}

function drawHUD(
  ctx: CanvasRenderingContext2D, w: number, _h: number,
  agentCount: number, activeCount: number, frame: number,
) {
  // Title
  ctx.font = "bold 14px 'Courier New', monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath(); ctx.roundRect(12, 10, 170, 28, 6); ctx.fill();
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText("⚔ Crystal City", 20, 16);

  // Stats badge
  ctx.font = "9px monospace";
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath(); ctx.roundRect(w - 175, 10, 163, 24, 6); ctx.fill();
  const dot = activeCount > 0 ? "#4ade80" : "#64748b";
  ctx.fillStyle = dot;
  ctx.beginPath(); ctx.arc(w - 162, 22, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#94a3b8";
  ctx.fillText(`${agentCount} agents · ${activeCount} active`, w - 154, 18);

  // FPS-style frame counter (subtle)
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.font = "7px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`f:${frame}`, w - 14, _h - 8);
}

// ─── Main Component ──────────────────────────────────────

export function CityView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const worldRef = useRef({
    agents: [] as AgentSprite[],
    particles: [] as Particle[],
    frame: 0,
    hoveredBuilding: null as string | null,
    mouseX: 0,
    mouseY: 0,
    activeBuildings: new Set<string>(),
    stars: Array.from({ length: 50 }, () => ({
      x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
    })) as Star[],
    canvasW: 900,
    canvasH: 600,
    lastDataPoll: 0,
  });

  const setView = useAppStore(s => s.setView);
  const getAgents = useDataStore(s => s.getAgents);
  const getTasks = useDataStore(s => s.getTasks);
  const getCronJobs = useDataStore(s => s.getCronJobs);

  // ─── Data Polling ──────────────────────────────────────

  const pollData = useCallback(async () => {
    const w = worldRef.current;
    try {
      const [agentsRaw, tasksRaw, cronRaw] = await Promise.all([
        getAgents(), getTasks(), getCronJobs(),
      ]);
      const agents = (agentsRaw ?? []) as Record<string, unknown>[];
      const tasks = (tasksRaw ?? []) as Record<string, unknown>[];
      const runningTasks = tasks.filter(t => t.status === "running" || t.status === "in_progress");

      // Active buildings
      w.activeBuildings.clear();
      if (runningTasks.length > 0) {
        w.activeBuildings.add("factory");
        w.activeBuildings.add("office");
      }
      const cronJobs = (cronRaw ?? []) as Record<string, unknown>[];
      if (cronJobs.some(c => c.enabled !== false)) w.activeBuildings.add("clock");
      w.activeBuildings.add("memory");
      w.activeBuildings.add("comms");
      w.activeBuildings.add("terminal");

      // Sync agent sprites
      const existingIds = new Set(w.agents.map(a => a.id));
      for (const raw of agents) {
        const id = String(raw.id ?? "");
        if (!id) continue;
        const name = String(raw.identityName ?? raw.id ?? "agent");
        const shortName = name.length > 12 ? name.split(/[\s(]/)[0] : name;
        const agentTasks = runningTasks.filter(t => String(t.agentId ?? "") === id);
        const homeId = AGENT_HOMES[id] ?? "office";
        const home = BUILDINGS.find(b => b.id === homeId)!;

        if (!existingIds.has(id)) {
          w.agents.push({
            id, name: shortName,
            emoji: AGENT_EMOJI[id] ?? "🤖",
            color: AGENT_COLORS[id] ?? "#64748b",
            x: home.ox + (Math.random() - 0.5) * 20,
            y: home.oy + (Math.random() - 0.5) * 10,
            tx: home.ox, ty: home.oy,
            state: "idle", timer: 1 + Math.random() * 3,
            task: "",
          });
        } else {
          const sprite = w.agents.find(a => a.id === id)!;
          sprite.name = shortName;
          if (agentTasks.length > 0) {
            const taskKind = String(agentTasks[0].kind ?? "");
            const taskMsg = String(agentTasks[0].label ?? agentTasks[0].message ?? "");
            sprite.task = taskMsg.slice(0, 40);
            let targetBldg = "office";
            if (taskKind.includes("cron")) targetBldg = "clock";
            else if (taskKind.includes("skill") || taskKind.includes("agent")) targetBldg = "factory";
            else if (taskKind.includes("memory")) targetBldg = "memory";
            const tb = BUILDINGS.find(b => b.id === targetBldg)!;
            sprite.tx = tb.ox;
            sprite.ty = tb.oy;
            if (sprite.state === "idle") { sprite.state = "walking"; sprite.timer = 0; }
          } else {
            sprite.task = "";
          }
        }
      }
    } catch { /* data fetch fail is non-fatal */ }
  }, [getAgents, getTasks, getCronJobs]);

  // ─── Agent AI ──────────────────────────────────────────

  const updateAgents = useCallback((dt: number) => {
    const w = worldRef.current;
    for (const a of w.agents) {
      a.timer -= dt;

      if (a.state === "walking") {
        const dx = a.tx - a.x, dy = a.ty - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 4) {
          a.x = a.tx; a.y = a.ty;
          a.state = "working";
          a.timer = 2.5 + Math.random() * 5;
        } else {
          const speed = 45;
          a.x += (dx / dist) * speed * dt;
          a.y += (dy / dist) * speed * dt;
        }
      } else if (a.state === "working" && a.timer <= 0) {
        const target = BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
        a.tx = target.ox + (Math.random() - 0.5) * 12;
        a.ty = target.oy + (Math.random() - 0.5) * 6;
        a.state = "walking";
      } else if (a.state === "idle" && a.timer <= 0) {
        const homeId = AGENT_HOMES[a.id] ?? "office";
        const home = BUILDINGS.find(b => b.id === homeId)!;
        const goHome = Math.random() < 0.4;
        const target = goHome ? home : BUILDINGS[Math.floor(Math.random() * BUILDINGS.length)];
        a.tx = target.ox + (Math.random() - 0.5) * 12;
        a.ty = target.oy + (Math.random() - 0.5) * 6;
        a.state = "walking";
      }
    }
  }, []);

  // ─── Animation Loop ───────────────────────────────────

  useEffect(() => {
    let lastTime = 0;
    const w = worldRef.current;

    function loop(time: number) {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;
      w.frame++;

      // Poll data every 6 seconds
      if (time - w.lastDataPoll > 6000) {
        w.lastDataPoll = time;
        pollData();
      }

      updateAgents(dt);

      // Emit particles for active buildings
      if (w.frame % 4 === 0) {
        for (const b of BUILDINGS) {
          if (!w.activeBuildings.has(b.id)) continue;
          const bx = w.canvasW / 2 + b.ox;
          const by = w.canvasH / 2 + b.oy;
          if (b.id === "factory") emitSmoke(w.particles, bx, by, b);
          if (b.id === "memory") emitSparkle(w.particles, bx, by, b);
        }
      }
      updateParticles(w.particles);

      // Render
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

      const dpr = window.devicePixelRatio || 1;
      const cw = w.canvasW, ch = w.canvasH;
      const targetW = Math.round(cw * dpr), targetH = Math.round(ch * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW; canvas.height = targetH;
        canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
      }
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cx = cw / 2, cy = ch / 2;

      // 1) Sky
      drawSky(ctx, cw, ch, w.stars, w.frame);

      // 2) Ground tiles
      drawGround(ctx, cx, cy);

      // 3) Paths
      drawPaths(ctx, cx, cy);

      // 4) Fountain
      drawFountain(ctx, cx, cy + 20, w.frame);

      // 5) Collect all drawables, sort by Y for painter's algorithm
      const drawables: { type: "tree" | "building" | "agent"; y: number; idx: number }[] = [];
      TREE_POS.forEach((_, i) => drawables.push({ type: "tree", y: TREE_POS[i][1], idx: i }));
      BUILDINGS.forEach((b, i) => drawables.push({ type: "building", y: b.oy, idx: i }));
      w.agents.forEach((a, i) => drawables.push({ type: "agent", y: a.y, idx: i }));
      drawables.sort((a, b) => a.y - b.y);

      for (const d of drawables) {
        if (d.type === "tree") {
          const [tx, ty] = TREE_POS[d.idx];
          drawTree(ctx, cx + tx, cy + ty, w.frame, d.idx);
        } else if (d.type === "building") {
          const b = BUILDINGS[d.idx];
          const bx = cx + b.ox, by = cy + b.oy;
          const hovered = w.hoveredBuilding === b.id;
          // Hover glow
          if (hovered) {
            ctx.save();
            ctx.shadowColor = b.accent; ctx.shadowBlur = 18;
            drawIsoBox(ctx, bx, by, b.w, b.d, b.h, b.top, b.left, b.right);
            ctx.restore();
          } else {
            drawIsoBox(ctx, bx, by, b.w, b.d, b.h, b.top, b.left, b.right);
          }
          drawBuildingExtras(ctx, b, bx, by, w.frame, w.activeBuildings.has(b.id));
          drawBuildingLabel(ctx, b, bx, by, hovered);
        } else {
          drawAgentSprite(ctx, w.agents[d.idx], w.frame);
        }
      }

      // 6) Particles (always on top)
      drawParticles(ctx, w.particles);

      // 7) HUD
      drawHUD(ctx, cw, ch, w.agents.length, w.activeBuildings.size, w.frame);

      // Tip
      ctx.font = "9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillText("click a building to navigate · agents move in real-time", cw / 2, ch - 8);

      ctx.restore();
      rafRef.current = requestAnimationFrame(loop);
    }

    pollData();
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [pollData, updateAgents]);

  // ─── Resize ────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        worldRef.current.canvasW = e.contentRect.width;
        worldRef.current.canvasH = e.contentRect.height;
      }
    });
    observer.observe(container);
    worldRef.current.canvasW = container.clientWidth;
    worldRef.current.canvasH = container.clientHeight;
    return () => observer.disconnect();
  }, []);

  // ─── Mouse Interaction ─────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = worldRef.current;
    const cx = w.canvasW / 2, cy = w.canvasH / 2;
    w.mouseX = mx; w.mouseY = my;

    let hovered: string | null = null;
    for (const b of BUILDINGS) {
      const bx = cx + b.ox, by = cy + b.oy;
      if (mx > bx - b.w - 8 && mx < bx + b.w + 8 && my > by - b.h - b.d * 2 - 20 && my < by + 8) {
        hovered = b.id;
        break;
      }
    }
    w.hoveredBuilding = hovered;
    canvas.style.cursor = hovered ? "pointer" : "default";
  }, []);

  const handleClick = useCallback(() => {
    const w = worldRef.current;
    if (w.hoveredBuilding) {
      const b = BUILDINGS.find(bl => bl.id === w.hoveredBuilding);
      if (b) setView(b.linkedView);
    }
  }, [setView]);

  return (
    <div ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden", background: "#050510" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        style={{ display: "block" }}
      />
    </div>
  );
}
