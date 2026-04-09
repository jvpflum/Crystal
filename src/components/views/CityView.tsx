import { useEffect, useRef, useCallback } from "react";
import { useAppStore, type AppView, type CommandCenterTabId } from "@/stores/appStore";
import { useDataStore } from "@/stores/dataStore";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — Technoir arcade / 90s fighter lobby isometric hub
   (neon street, chunky outlines, floating nametags, CRT polish)
   ═══════════════════════════════════════════════════════════════ */

// ─── Types ─────────────────────────────────────────────────────

interface BuildingTier { w: number; d: number; h: number; inset?: number; }

interface BuildingDef {
  id: string; name: string; ox: number; oy: number;
  w: number; d: number; h: number;
  top: string; left: string; right: string; accent: string;
  linkedView: AppView; icon: string;
  linkedCenterTab?: CommandCenterTabId;
  sign?: readonly [string, string];
  tiers?: BuildingTier[];
  roofType?: "flat" | "antenna" | "dome" | "spire" | "dish";
  facadeStrips?: number;
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
  { id: "clock",    name: "CHRONO SPIRE",    ox:    0, oy: -170, w: 32, d: 22, h: 130, top: "#2a2a48", left: "#181830", right: "#20203c", accent: N.amber,   linkedView: "command-center", linkedCenterTab: "scheduled", icon: "⏱", sign: ["CHRONO", "SPIRE"],
    tiers: [{ w: 32, d: 22, h: 55 }, { w: 24, d: 17, h: 40 }, { w: 16, d: 12, h: 35 }], roofType: "spire", facadeStrips: 3 },
  { id: "barracks", name: "AGENT BARRACKS",  ox: -140, oy:  -80, w: 40, d: 26, h: 72,  top: "#2a3e2a", left: "#162a16", right: "#1e361e", accent: N.lime,    linkedView: "agents",       icon: "⬡", sign: ["AGENT", "CORPS"],
    tiers: [{ w: 40, d: 26, h: 42 }, { w: 34, d: 22, h: 30 }], roofType: "antenna", facadeStrips: 2 },
  { id: "memory",   name: "MEMORY CORE",     ox: -260, oy:   30, w: 38, d: 28, h: 80,  top: "#2a1a42", left: "#181028", right: "#201636", accent: N.purple,  linkedView: "memory",       icon: "◈", sign: ["DATA", "CORE"],
    tiers: [{ w: 38, d: 28, h: 50 }, { w: 30, d: 22, h: 30 }], roofType: "dome", facadeStrips: 3 },
  { id: "office",   name: "COMMAND HQ",      ox:  260, oy:   30, w: 44, d: 30, h: 100, top: "#1a2a48", left: "#101a30", right: "#16223c", accent: N.blue,    linkedView: "agents",       icon: "◉", sign: ["CMD", "HQ"],
    tiers: [{ w: 44, d: 30, h: 55 }, { w: 36, d: 24, h: 30 }, { w: 26, d: 18, h: 15 }], roofType: "antenna", facadeStrips: 4 },
  { id: "factory",  name: "THE FORGE",       ox: -260, oy:  175, w: 50, d: 34, h: 65,  top: "#3e2a18", left: "#281a10", right: "#342216", accent: N.orange,  linkedView: "factory",      icon: "⚙", sign: ["THE", "FORGE"],
    tiers: [{ w: 50, d: 34, h: 40 }, { w: 38, d: 26, h: 25 }], roofType: "flat", facadeStrips: 2 },
  { id: "comms",    name: "COMM ARRAY",      ox:  260, oy:  175, w: 30, d: 20, h: 125, top: "#1a3e3e", left: "#102828", right: "#163434", accent: N.cyan,    linkedView: "channels",     icon: "◇", sign: ["COMM", "NET"],
    tiers: [{ w: 30, d: 20, h: 50 }, { w: 22, d: 15, h: 40 }, { w: 14, d: 10, h: 35 }], roofType: "dish", facadeStrips: 2 },
  { id: "vault",    name: "TOOL VAULT",      ox:  140, oy:  -80, w: 36, d: 24, h: 58,  top: "#3e3a22", left: "#28261a", right: "#343020", accent: N.pink,    linkedView: "tools",        icon: "⚒", sign: ["TOOL", "VAULT"],
    tiers: [{ w: 36, d: 24, h: 38 }, { w: 28, d: 18, h: 20 }], roofType: "dome", facadeStrips: 2 },
  { id: "terminal", name: "THE TERMINAL",    ox:    0, oy:  270, w: 46, d: 28, h: 52,  top: "#1a3e1a", left: "#102810", right: "#163416", accent: N.green,   linkedView: "conversation", icon: "▣", sign: ["TERM", "INAL"],
    tiers: [{ w: 46, d: 28, h: 32 }, { w: 36, d: 22, h: 20 }], roofType: "flat", facadeStrips: 3 },
];

const AGENT_HOMES: Record<string, string> = { main: "barracks", research: "memory", home: "terminal", finance: "factory", default: "barracks" };
const AGENT_COLORS: Record<string, string> = { main: N.blue, research: N.purple, home: N.green, finance: N.amber };
const AGENT_EMOJI: Record<string, string> = { main: "🦉", research: "🔬", home: "🏡", finance: "💰" };

const PYLON_POS: [number, number][] = [
  [-70, -140], [70, -140], [-360, 90], [360, 90],
  [-170, 90], [170, 90], [-120, 240], [120, 240],
  [0, -60], [-70, 220], [70, 220], [-360, 200], [360, 200],
  [-200, -40], [200, -40], [0, 100],
];

const STEAM_VENTS: SteamVent[] = [
  { x: -80, y: -30, timer: 0, interval: 120 },
  { x: 100, y: 100, timer: 40, interval: 150 },
  { x: -180, y: 210, timer: 80, interval: 100 },
  { x: 190, y: -50, timer: 20, interval: 180 },
  { x: 0, y: 130, timer: 60, interval: 130 },
  { x: -300, y: 100, timer: 30, interval: 140 },
  { x: 300, y: 100, timer: 70, interval: 160 },
  { x: -100, y: 290, timer: 50, interval: 110 },
  { x: 100, y: 290, timer: 90, interval: 135 },
];

const GROUND_N = 18;
const TW = 52;
const TH = 26;
const RAIN_COUNT = 300;

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
  const px = bx + w * 0.5;
  const py = by - h * 0.45 - d * 0.4;
  const pulse = 0.78 + Math.sin(lightPhase(frame) * 2.2) * 0.22;

  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  // Frosted glass sign plate
  const signW = Math.max(w * 1.3, 48);
  const signH = 26;
  ctx.fillStyle = "rgba(10,11,15,0.6)";
  ctx.beginPath(); ctx.roundRect(px - signW / 2, py - signH / 2, signW, signH, 8); ctx.fill();
  ctx.strokeStyle = `${accent}25`; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.roundRect(px - signW / 2, py - signH / 2, signW, signH, 8); ctx.stroke();
  // Accent top edge
  const edgeGrd = ctx.createLinearGradient(px - signW / 2, py - signH / 2, px + signW / 2, py - signH / 2);
  edgeGrd.addColorStop(0, "rgba(0,0,0,0)"); edgeGrd.addColorStop(0.3, `${accent}30`);
  edgeGrd.addColorStop(0.7, `${accent}30`); edgeGrd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = edgeGrd;
  ctx.beginPath(); ctx.roundRect(px - signW / 2, py - signH / 2, signW, 1.5, [8, 8, 0, 0]); ctx.fill();

  for (let i = 0; i < lines.length; i++) {
    const ly = py + (i - 0.5) * 12;
    ctx.font = i === 0 ? "600 10px -apple-system, sans-serif" : "500 8px -apple-system, sans-serif";
    ctx.shadowColor = accent;
    ctx.shadowBlur = 10 * pulse;
    ctx.fillStyle = i === 0 ? "rgba(232,236,244,0.9)" : accent;
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

// ─── SimCity-Quality Enhancements ───────────────────────────────

function drawBuildingShadow(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, d: number, h: number,
) {
  const shx = h * 0.38;
  const shy = h * 0.19;
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y - d);
  ctx.lineTo(x + w + shx, y - d + shy);
  ctx.lineTo(x + shx, y + shy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - w, y - d);
  ctx.lineTo(x - w + shx * 0.4, y - d + shy * 0.4);
  ctx.lineTo(x + shx * 0.4, y + shy * 0.4);
  ctx.closePath();
  ctx.fill();
}

function drawGradientFace(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  topColor: string, bottomColor: string,
) {
  if (pts.length < 3) return;
  const minY = Math.min(...pts.map(p => p[1]));
  const maxY = Math.max(...pts.map(p => p[1]));
  const grd = ctx.createLinearGradient(0, minY, 0, maxY);
  grd.addColorStop(0, topColor);
  grd.addColorStop(1, bottomColor);
  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

function drawIsoBoxGradient(
  ctx: CanvasRenderingContext2D, x: number, y: number,
  w: number, d: number, h: number,
  topC: string, leftC: string, rightC: string,
) {
  drawGradientFace(ctx,
    [[x, y], [x + w, y - d], [x + w, y - d - h], [x, y - h]],
    lighten(rightC), rightC,
  );
  drawGradientFace(ctx,
    [[x, y], [x - w, y - d], [x - w, y - d - h], [x, y - h]],
    lighten(leftC), leftC,
  );
  ctx.fillStyle = topC;
  ctx.beginPath();
  ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h);
  ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h);
  ctx.closePath(); ctx.fill();
}

function drawMultiTierBuilding(
  ctx: CanvasRenderingContext2D, b: BuildingDef, bx: number, by: number,
  frame: number, active: boolean, hovered: boolean,
) {
  const tiers = b.tiers ?? [{ w: b.w, d: b.d, h: b.h }];
  const ph = lightPhase(frame);
  let curY = by;

  if (hovered) { ctx.save(); ctx.shadowColor = b.accent; ctx.shadowBlur = 30; }

  for (let ti = 0; ti < tiers.length; ti++) {
    const t = tiers[ti];
    const tw = t.w, td = t.d, th = t.h;
    const isBase = ti === 0;

    drawIsoBoxGradient(ctx, bx, curY, tw, td, th, b.top, b.left, b.right);

    // Facade neon strips
    const strips = b.facadeStrips ?? 0;
    for (let s = 0; s < strips; s++) {
      const sy = curY - th * ((s + 1) / (strips + 1));
      const pulse = 0.3 + Math.sin(ph * 1.5 + s * 0.8 + ti * 2) * 0.15;
      ctx.strokeStyle = b.accent; ctx.globalAlpha = pulse; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(bx + tw * 0.08, sy - td * 0.08);
      ctx.lineTo(bx + tw * 0.92, sy - td * 0.92);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx - tw * 0.08, sy - td * 0.08);
      ctx.lineTo(bx - tw * 0.92, sy - td * 0.92);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Windows for this tier
    const cols = Math.max(2, Math.floor(tw / 5));
    const rows = Math.max(2, Math.floor(th / 8));
    for (let face = 0; face < 2; face++) {
      const sign = face === 0 ? 1 : -1;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const u = (col + 0.5) / cols * 0.78 + 0.11;
          const v = (row + 0.5) / rows * 0.82 + 0.09;
          const wx = bx + sign * u * tw;
          const wy = curY - u * td - v * th;
          const seed = row * 7.3 + col * 3.1 + face * 11 + tw + ti * 17;
          const lit = Math.sin(seed + ph * 0.25) > (active ? -0.4 : 0.2);
          if (lit) {
            const wSize = isBase ? 3 : 2.2;
            const warmC = (row + ti) % 4 === 0 ? b.accent : row % 3 === 0 ? "#ffe8a0" : "#ffd680";
            ctx.fillStyle = warmC;
            ctx.globalAlpha = 0.42 + Math.sin(ph * 0.5 + seed) * 0.08;
            ctx.fillRect(wx - wSize / 2, wy - wSize * 0.6, wSize, wSize * 1.1);
            ctx.globalAlpha = 0.06;
            ctx.fillRect(wx - wSize, wy - wSize, wSize * 2, wSize * 2);
          } else {
            ctx.fillStyle = face === 0 ? "#06060e" : "#080812";
            ctx.globalAlpha = 0.6;
            ctx.fillRect(wx - 1.5, wy - 2, 2.5, 2.8);
          }
        }
      }
    }
    ctx.globalAlpha = 1;

    // Setback ledge between tiers (decorative horizontal strip)
    if (ti < tiers.length - 1) {
      const nextT = tiers[ti + 1];
      const ledgeY = curY - th;
      ctx.fillStyle = lighten(b.top);
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(bx, ledgeY); ctx.lineTo(bx + tw, ledgeY - td);
      ctx.lineTo(bx + nextT.w, ledgeY - nextT.d); ctx.lineTo(bx, ledgeY);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx, ledgeY); ctx.lineTo(bx - tw, ledgeY - td);
      ctx.lineTo(bx - nextT.w, ledgeY - nextT.d); ctx.lineTo(bx, ledgeY);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Black outlines
    strokeIsoBlack(ctx, bx, curY, tw, td, th, hovered ? 2.5 : 2);

    // Neon edge glow
    const edgePulse = active ? 0.55 + Math.sin(ph * 2 + ti) * 0.15 : 0.25 + Math.sin(ph * 0.8 + ti) * 0.05;
    drawNeonEdges(ctx, bx, curY, tw, td, th, b.accent, edgePulse);

    curY -= th;
  }

  if (hovered) ctx.restore();

  // Rooftop features
  const roofY = curY;
  const topTier = tiers[tiers.length - 1];
  switch (b.roofType) {
    case "spire": {
      const spireH = 28 + Math.sin(ph) * 2;
      ctx.fillStyle = "#0a0a18";
      ctx.beginPath();
      ctx.moveTo(bx, roofY - topTier.d * 2 - spireH);
      ctx.lineTo(bx + topTier.w * 0.3, roofY - topTier.d);
      ctx.lineTo(bx - topTier.w * 0.3, roofY - topTier.d);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = b.accent; ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(bx, roofY - topTier.d * 2 - spireH);
      ctx.lineTo(bx + topTier.w * 0.3, roofY - topTier.d);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, roofY - topTier.d * 2 - spireH);
      ctx.lineTo(bx - topTier.w * 0.3, roofY - topTier.d);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Beacon at top
      const beaconPulse = 0.5 + Math.sin(ph * 3) * 0.5;
      ctx.save(); ctx.shadowColor = b.accent; ctx.shadowBlur = 14 * beaconPulse;
      ctx.fillStyle = b.accent; ctx.globalAlpha = beaconPulse;
      ctx.beginPath(); ctx.arc(bx, roofY - topTier.d * 2 - spireH - 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
    case "dome": {
      const domeR = topTier.w * 0.6;
      const domeY = roofY - topTier.d;
      ctx.fillStyle = lighten(b.top);
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(bx, domeY, domeR, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = b.accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.arc(bx, domeY, domeR, Math.PI, 0); ctx.stroke();
      // Cross ribs
      ctx.lineWidth = 0.5; ctx.globalAlpha = 0.3;
      for (let i = 0; i < 4; i++) {
        const a = Math.PI + (i / 3) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(bx + Math.cos(a) * domeR, domeY + Math.sin(a) * domeR);
        ctx.lineTo(bx, domeY - domeR);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Glow at apex
      ctx.save(); ctx.shadowColor = b.accent; ctx.shadowBlur = 10;
      ctx.fillStyle = b.accent; ctx.globalAlpha = 0.4 + Math.sin(ph * 2) * 0.2;
      ctx.beginPath(); ctx.arc(bx, domeY - domeR + 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      break;
    }
    case "antenna": {
      const antH = 30;
      ctx.strokeStyle = "#888"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx + topTier.w * 0.3, roofY - topTier.d);
      ctx.lineTo(bx + topTier.w * 0.3, roofY - topTier.d - antH);
      ctx.stroke();
      // Blink light
      const blink = frame % 80 < 40;
      ctx.save(); ctx.shadowColor = N.red; ctx.shadowBlur = blink ? 12 : 0;
      ctx.fillStyle = blink ? N.red : "#330010";
      ctx.beginPath(); ctx.arc(bx + topTier.w * 0.3, roofY - topTier.d - antH - 2, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Second shorter antenna
      ctx.strokeStyle = "#666"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx - topTier.w * 0.2, roofY - topTier.d);
      ctx.lineTo(bx - topTier.w * 0.2, roofY - topTier.d - antH * 0.6);
      ctx.stroke();
      break;
    }
    case "dish": {
      const dishY = roofY - topTier.d - 5;
      const dishR = topTier.w * 0.5;
      ctx.fillStyle = "#1a2a2a"; ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(bx, dishY, dishR, dishR * 0.35, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = b.accent; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.ellipse(bx, dishY, dishR, dishR * 0.35, 0, 0, Math.PI * 2); ctx.stroke();
      // Feed horn
      ctx.strokeStyle = "#aaa"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(bx, dishY); ctx.lineTo(bx, dishY - 12); ctx.stroke();
      // Rotating sweep
      const sweepA = ph * 2;
      ctx.strokeStyle = b.accent; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(bx, dishY);
      ctx.lineTo(bx + Math.cos(sweepA) * dishR * 0.8, dishY + Math.sin(sweepA) * dishR * 0.28);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    default: break;
  }

  // Active building ambient glow on ground
  if (active) {
    ctx.save();
    ctx.globalAlpha = 0.08 + Math.sin(ph * 1.8) * 0.03;
    const grd = ctx.createRadialGradient(bx, by, 0, bx, by, b.w * 3);
    grd.addColorStop(0, b.accent); grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(bx - b.w * 4, by - b.h - b.d * 2, b.w * 8, b.h + b.d * 4);
    ctx.restore();
  }
}

interface TreeDef { x: number; y: number; size: number; type: "round" | "pine" | "bush" }

const TREE_POSITIONS: TreeDef[] = [
  { x: -330, y: -60, size: 20, type: "round" },
  { x: -350, y: 10, size: 17, type: "pine" },
  { x: -310, y: -100, size: 14, type: "bush" },
  { x: 330, y: -60, size: 19, type: "round" },
  { x: 350, y: 10, size: 16, type: "pine" },
  { x: 310, y: -100, size: 13, type: "bush" },
  { x: -210, y: -140, size: 18, type: "round" },
  { x: 210, y: -140, size: 17, type: "pine" },
  { x: -370, y: 130, size: 19, type: "round" },
  { x: 370, y: 130, size: 18, type: "pine" },
  { x: -340, y: 230, size: 16, type: "round" },
  { x: 340, y: 230, size: 17, type: "bush" },
  { x: -70, y: 330, size: 15, type: "pine" },
  { x: 70, y: 330, size: 16, type: "round" },
  { x: -190, y: 250, size: 14, type: "bush" },
  { x: 190, y: 250, size: 15, type: "bush" },
  { x: -55, y: -220, size: 13, type: "bush" },
  { x: 55, y: -220, size: 14, type: "bush" },
  { x: -395, y: -30, size: 19, type: "pine" },
  { x: 395, y: -30, size: 18, type: "pine" },
  { x: -160, y: 310, size: 17, type: "round" },
  { x: 160, y: 310, size: 16, type: "round" },
  { x: -80, y: -30, size: 12, type: "bush" },
  { x: 80, y: -30, size: 12, type: "bush" },
  { x: -80, y: 120, size: 14, type: "pine" },
  { x: 80, y: 120, size: 13, type: "pine" },
  { x: 0, y: -250, size: 15, type: "round" },
  { x: -400, y: 280, size: 16, type: "pine" },
  { x: 400, y: 280, size: 15, type: "pine" },
];

function drawIsometricTree(ctx: CanvasRenderingContext2D, cx: number, cy: number, tree: TreeDef, frame: number) {
  const x = cx + tree.x, y = cy + tree.y;
  const sway = Math.sin(frame * 0.005 + tree.x * 0.06) * 1.2;
  const sz = tree.size * 1.2;

  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(x + 3, y + 3, sz * 0.35, sz * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (tree.type === "bush") {
    ctx.fillStyle = "#0d3520";
    ctx.beginPath();
    ctx.ellipse(x + sway * 0.5, y - sz * 0.2, sz * 0.4, sz * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#185a30";
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(x + sway * 0.5 - 1, y - sz * 0.28, sz * 0.3, sz * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Subtle neon rim
    ctx.strokeStyle = N.green; ctx.globalAlpha = 0.08; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(x + sway * 0.5, y - sz * 0.2, sz * 0.4, sz * 0.25, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }

  // Trunk
  ctx.fillStyle = "#3a2518";
  ctx.fillRect(x - 2, y - sz * 0.4, 4, sz * 0.4);

  if (tree.type === "pine") {
    for (let i = 0; i < 4; i++) {
      const ly = y - sz * (0.3 + i * 0.18);
      const lw = sz * (0.4 - i * 0.06);
      ctx.fillStyle = ["#0e4420", "#155828", "#1c6830", "#227838"][i];
      ctx.beginPath();
      ctx.moveTo(x + sway * (i + 1) * 0.2, ly - sz * 0.2);
      ctx.lineTo(x - lw + sway * i * 0.12, ly);
      ctx.lineTo(x + lw + sway * i * 0.12, ly);
      ctx.closePath();
      ctx.fill();
    }
    // Neon highlight
    ctx.fillStyle = N.green; ctx.globalAlpha = 0.04;
    ctx.beginPath();
    ctx.moveTo(x + sway * 4 * 0.2, y - sz * (0.3 + 3 * 0.18) - sz * 0.2);
    ctx.lineTo(x - sz * 0.4, y - sz * 0.3);
    ctx.lineTo(x + sz * 0.4, y - sz * 0.3);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    const canopyY = y - sz * 0.55;
    const r = sz * 0.38;
    ctx.fillStyle = "#0e4428";
    ctx.beginPath(); ctx.arc(x + sway, canopyY, r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#1a6840";
    ctx.beginPath(); ctx.arc(x + sway, canopyY - 1, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#228a50";
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(x + sway - r * 0.25, canopyY - r * 0.35, r * 0.5, 0, Math.PI * 2); ctx.fill();
    // Neon rim glow
    ctx.strokeStyle = N.green; ctx.globalAlpha = 0.06; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x + sway, canopyY, r + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// ─── Sky + Atmosphere ──────────────────────────────────────────

function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, stars: Star[], frame: number, shootingStars: ShootingStar[]) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#020008"); g.addColorStop(0.15, "#0a0020"); g.addColorStop(0.35, N.deepViolet);
  g.addColorStop(0.55, "#1a0638"); g.addColorStop(0.72, "#200848"); g.addColorStop(0.88, "#180440");
  g.addColorStop(1, "#10022a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // Animated nebula clouds
  for (let i = 0; i < 6; i++) {
    const nx = (w * 0.1 + i * w * 0.2 + Math.sin(frame * 0.0007 + i * 1.5) * 60);
    const ny = h * (0.08 + (i % 3) * 0.08);
    const nr = 120 + i * 35 + Math.sin(frame * 0.001 + i) * 20;
    const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
    const cols = [N.hotPink, N.magenta, N.cyan, N.purple, N.blue, N.green];
    ng.addColorStop(0, `${cols[i]}18`); ng.addColorStop(0.3, `${cols[i]}0a`);
    ng.addColorStop(0.6, `${cols[i]}04`); ng.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ng; ctx.fillRect(0, 0, w, h);
  }

  // Street-level neon haze
  const horizonY = h * 0.75;
  const hg = ctx.createRadialGradient(w / 2, horizonY, 0, w / 2, horizonY, w * 0.9);
  hg.addColorStop(0, "rgba(255,62,184,0.18)"); hg.addColorStop(0.18, "rgba(183,68,255,0.12)");
  hg.addColorStop(0.4, "rgba(0,255,242,0.07)"); hg.addColorStop(0.65, "rgba(57,255,20,0.03)"); hg.addColorStop(1, "rgba(0,0,0,0)");
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

  // Distant city silhouette — multiple layers for depth
  for (let layer = 0; layer < 3; layer++) {
    const silY = h * (0.42 + layer * 0.06);
    const count = 55 + layer * 10;
    const baseAlpha = 0.6 - layer * 0.15;
    for (let i = 0; i < count; i++) {
      const bx = (i / count) * w;
      const bh = (8 + Math.sin(i * 1.7 + layer) * 18 + Math.sin(i * 3.2) * 12 + Math.cos(i * 0.8 + layer * 2) * 7) * (1 - layer * 0.2);
      ctx.fillStyle = `rgba(${4 + layer * 2},0,${14 + layer * 4},${baseAlpha + Math.sin(i * 0.5) * 0.08})`;
      ctx.fillRect(bx, silY - bh, w / count - 0.5, bh);
      if (layer === 0) {
        for (let wy = 0; wy < bh - 3; wy += 3) {
          if (Math.sin(i * 3.7 + wy * 0.9 + lightPhase(frame) * 0.65) > 0.15) {
            const wCol = [N.cyan, N.magenta, N.amber, N.blue, N.pink, N.green][i % 6];
            ctx.fillStyle = wCol; ctx.globalAlpha = 0.1 + Math.sin(lightPhase(frame) * 1.2 + i + wy) * 0.04;
            ctx.fillRect(bx + 1, silY - bh + wy, 1.8, 1.8);
          }
        }
      }
    }
  }
  ctx.globalAlpha = 1;

  // Flying vehicles at various altitudes
  for (let i = 0; i < 5; i++) {
    const vx = ((frame * (0.25 + i * 0.12) + i * 180) % (w + 80)) - 40;
    const vy = h * 0.35 - i * 14 + Math.sin(frame * 0.008 + i * 2) * 6;
    ctx.fillStyle = [N.red, N.cyan, N.amber, N.green, N.magenta][i]; ctx.globalAlpha = 0.35;
    ctx.fillRect(vx, vy, 5, 1.8);
    ctx.globalAlpha = 0.1;
    ctx.beginPath(); ctx.arc(vx + 2.5, vy, 7, 0, Math.PI * 2); ctx.fill();
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
      const isRoad = Math.abs(gx - mid) <= 1 || Math.abs(gy - mid) <= 1;
      const isSidewalk = !isRoad && (Math.abs(gx - mid) === 2 || Math.abs(gy - mid) === 2) && dist < 8;
      const isIntersection = Math.abs(gx - mid) <= 1 && Math.abs(gy - mid) <= 1;

      let base: string;
      if (isIntersection) {
        base = "#181822";
      } else if (isRoad) {
        base = (gx + gy) % 2 === 0 ? "#141420" : "#12121c";
      } else if (isSidewalk) {
        base = "#1a1a28";
      } else {
        const grassVar = Math.sin(gx * 2.1 + gy * 1.7) * 0.5 + 0.5;
        base = grassVar > 0.6 ? "#0e1e12" : grassVar > 0.3 ? "#0c1a10" : "#0a160e";
      }
      drawDiamond(ctx, sx, sy, TW, TH, base);

      if (isRoad) {
        const centerLine = (gx === mid || gy === mid) && dist > 0;
        if (centerLine && (gx + gy) % 2 === 0) {
          ctx.fillStyle = "rgba(255,200,50,0.12)";
          ctx.beginPath();
          if (gx === mid) {
            ctx.moveTo(sx, sy - 2); ctx.lineTo(sx + 3, sy); ctx.lineTo(sx, sy + 2); ctx.lineTo(sx - 3, sy);
          } else {
            ctx.moveTo(sx, sy - 2); ctx.lineTo(sx + 3, sy); ctx.lineTo(sx, sy + 2); ctx.lineTo(sx - 3, sy);
          }
          ctx.closePath(); ctx.fill();
        }
      }

      if (isIntersection && (gx + gy) % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.moveTo(sx, sy - TH / 2 + 3); ctx.lineTo(sx + TW / 2 - 6, sy);
        ctx.lineTo(sx, sy + TH / 2 - 3); ctx.lineTo(sx - TW / 2 + 6, sy);
        ctx.closePath(); ctx.fill();
      }

      if (!isRoad && !isSidewalk) {
        const edgeAlpha = 0.05 + Math.sin(frame * 0.004 + gx * 0.4 + gy * 0.3) * 0.02;
        ctx.strokeStyle = `rgba(40,80,50,${edgeAlpha})`;
        ctx.lineWidth = 0.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy - TH / 2); ctx.lineTo(sx + TW / 2, sy);
        ctx.lineTo(sx, sy + TH / 2); ctx.lineTo(sx - TW / 2, sy);
        ctx.closePath(); ctx.stroke();
      } else {
        const edgeAlpha = isRoad ? 0.04 : 0.06;
        ctx.strokeStyle = `rgba(60,60,80,${edgeAlpha})`;
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.moveTo(sx, sy - TH / 2); ctx.lineTo(sx + TW / 2, sy);
        ctx.lineTo(sx, sy + TH / 2); ctx.lineTo(sx - TW / 2, sy);
        ctx.closePath(); ctx.stroke();
      }
    }
  }

  // Neon-tinted ground fog
  const fog = ctx.createRadialGradient(cx, oy, 0, cx, oy, GROUND_N * TW * 0.52);
  fog.addColorStop(0, "rgba(100,60,160,0.06)"); fog.addColorStop(0.25, "rgba(60,100,80,0.04)");
  fog.addColorStop(0.5, "rgba(80,60,120,0.03)"); fog.addColorStop(0.75, "rgba(40,80,120,0.02)");
  fog.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fog; ctx.fillRect(cx - 550, oy - 320, 1100, 640);

  // Wet road reflection strips at intersections
  if (frame % 2 === 0) {
    const reflPulse = 0.03 + Math.sin(lightPhase(frame) * 0.7) * 0.01;
    ctx.fillStyle = `rgba(100,150,255,${reflPulse})`;
    ctx.fillRect(cx - GROUND_N * TW * 0.15, oy - GROUND_N * TH * 0.15, GROUND_N * TW * 0.3, GROUND_N * TH * 0.3);
  }
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
      const fx = cx + from.ox, fy = cy + from.oy - getBuildingTotalH(from);
      const tx = cx + to.ox, ty = cy + to.oy - getBuildingTotalH(to);
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
      d.tx = target.ox + (Math.random() - 0.5) * 40;
      d.ty = target.oy - getBuildingTotalH(target) - 30 + (Math.random() - 0.5) * 25;
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
        x: src.ox, y: src.oy - getBuildingTotalH(src) - 35,
        tx: src.ox + 50, ty: src.oy - getBuildingTotalH(src) - 60,
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
    { x: -400, y: -130, w: 110, h: 52, lines: ["CRYSTAL", "NETWORK"], accent: N.cyan, phase: 0 },
    { x: 400, y: -110, w: 106, h: 52, lines: ["AGENTS", "ONLINE"], accent: N.hotPink, phase: 2 },
    { x: 0, y: -300, w: 128, h: 46, lines: ["MISSION", "CONTROL"], accent: N.signGreen, phase: 4 },
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
    const hover = Math.sin(lightPhase(frame) * 1.2 + bb.phase) * 2.5;

    // Support struts — thin, subtle
    ctx.strokeStyle = "rgba(255,255,255,0.03)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(bx - bb.w / 2 + 8, by + bb.h + hover); ctx.lineTo(bx - bb.w / 2 + 8, by + bb.h + hover + 12); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + bb.w / 2 - 8, by + bb.h + hover); ctx.lineTo(bx + bb.w / 2 - 8, by + bb.h + hover + 12); ctx.stroke();

    // Glass panel background
    drawGlassPanel(ctx, bx - bb.w / 2, by + hover, bb.w, bb.h, bb.accent);

    // Content
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const lineGap = bb.h > 40 ? 18 : 14;
    const y0 = by + hover + (bb.lines.length === 1 ? bb.h / 2 : 17);
    for (let i = 0; i < bb.lines.length; i++) {
      if (i === 0) {
        ctx.font = "600 13px -apple-system, sans-serif";
        ctx.fillStyle = "#e8ecf4";
      } else {
        ctx.font = "500 10px -apple-system, sans-serif";
        ctx.fillStyle = bb.accent; ctx.globalAlpha = 0.7;
      }
      ctx.fillText(bb.lines[i], bx, y0 + i * lineGap);
      ctx.globalAlpha = 1;
    }

    // Subtle scan line
    const scanT = ((frame * 0.18 + bb.phase * 14) % (bb.h + 6)) - 3;
    ctx.fillStyle = bb.accent; ctx.globalAlpha = 0.04;
    ctx.fillRect(bx - bb.w / 2 + 2, by + hover + scanT, bb.w - 4, 1.5);
    ctx.globalAlpha = 1;
  }
}

// ─── Buildings ─────────────────────────────────────────────────

function countWorkingAt(agents: AgentSprite[], buildingId: string): number {
  return agents.filter(a => a.state === "working" && a.targetBldg === buildingId).length;
}

function getBuildingTotalH(b: BuildingDef): number {
  return (b.tiers ?? [{ h: b.h }]).reduce((a, t) => a + t.h, 0);
}

function drawBuildingExtras(
  ctx: CanvasRenderingContext2D, b: BuildingDef, bx: number, by: number, frame: number, active: boolean,
  agents: AgentSprite[], stats: Record<string, { count: number; label: string }>,
) {
  const totalH = getBuildingTotalH(b);
  if (b.sign) drawBuildingNeonSign(ctx, bx, by, b.w, b.d, totalH, b.sign, b.accent, frame);
  const ph = lightPhase(frame);
  switch (b.id) {
    case "clock": {
      const clockY = by - totalH * 0.5;
      ctx.save(); ctx.shadowColor = N.amber; ctx.shadowBlur = 14;
      ctx.fillStyle = "#0a0a14"; ctx.beginPath(); ctx.arc(bx - b.w * 0.1, clockY, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = N.amber; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
      const now = new Date();
      const ha = (now.getHours() % 12 / 12) * Math.PI * 2 - Math.PI / 2;
      const ma = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
      ctx.strokeStyle = N.amber; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - b.w * 0.1, clockY); ctx.lineTo(bx - b.w * 0.1 + Math.cos(ha) * 6, clockY + Math.sin(ha) * 6); ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(bx - b.w * 0.1, clockY); ctx.lineTo(bx - b.w * 0.1 + Math.cos(ma) * 9, clockY + Math.sin(ma) * 9); ctx.stroke();
      ctx.restore();
      if (active && (stats.clock?.count ?? 0) + countWorkingAt(agents, "clock") > 0) {
        for (let i = 0; i < 4; i++) {
          const r = ((frame * 0.09 + i * 20) % 70) + 12;
          const a = Math.max(0, 1 - r / 82) * 0.2;
          ctx.strokeStyle = N.amber; ctx.globalAlpha = a; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(bx - b.w * 0.1, clockY, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "factory": {
      // Smokestack
      drawIsoBox(ctx, bx + b.w * 0.55, by - b.d * 0.6, 8, 6, totalH + 30, "#1a1008", "#0d0804", "#14100a");
      drawNeonEdges(ctx, bx + b.w * 0.55, by - b.d * 0.6, 8, 6, totalH + 30, N.orange, 0.35);
      // Second shorter smokestack
      drawIsoBox(ctx, bx + b.w * 0.3, by - b.d * 0.4, 6, 4, totalH + 18, "#181008", "#0c0804", "#12100a");
      drawNeonEdges(ctx, bx + b.w * 0.3, by - b.d * 0.4, 6, 4, totalH + 18, N.orange, 0.2);
      if (active && (countWorkingAt(agents, "factory") > 0 || (stats.factory?.count ?? 0) > 0)) {
        ctx.save(); ctx.translate(bx + 14, by - totalH * 0.35); ctx.rotate(frame * 0.007);
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; ctx.fillStyle = N.orange; ctx.globalAlpha = 0.5; ctx.fillRect(-1.5 + Math.cos(a) * 10, -1.5 + Math.sin(a) * 10, 3, 3); }
        ctx.fillStyle = N.orange; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
      }
      // Loading dock
      ctx.fillStyle = "#0a0804"; ctx.fillRect(bx - 6, by - 14, 12, 14);
      ctx.strokeStyle = N.orange; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.strokeRect(bx - 6, by - 14, 12, 14); ctx.globalAlpha = 1;
      break;
    }
    case "memory": {
      if (active && (countWorkingAt(agents, "memory") > 0 || (stats.memory?.count ?? 0) > 0)) {
        for (let i = 0; i < 8; i++) {
          const sy = ((frame * 0.14 + i * 12) % 75);
          const sa = Math.max(0, 1 - sy / 75) * 0.5;
          ctx.fillStyle = N.purple; ctx.globalAlpha = sa;
          ctx.fillRect(bx - 12 + Math.sin(ph + i * 2) * 12, by - totalH * 0.25 - sy, 2, 4);
        }
        ctx.globalAlpha = 1;
      }
      // Hex readout on facade
      ctx.fillStyle = N.purple; ctx.globalAlpha = active ? 0.7 : 0.2; ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
      ctx.fillText((Math.floor(frame * 0.35) % 0xFFFF).toString(16).toUpperCase().padStart(4, "0"), bx + b.w * 0.3, by - totalH * 0.3); ctx.globalAlpha = 1;
      break;
    }
    case "comms": {
      if (active && (countWorkingAt(agents, "comms") > 0 || (stats.comms?.count ?? 0) > 0)) {
        const topY = by - totalH - b.d * 2;
        for (let i = 0; i < 6; i++) {
          const r = ((frame * 0.12 + i * 12) % 80) + 8;
          const a = Math.max(0, 1 - r / 88) * 0.35;
          ctx.strokeStyle = N.cyan; ctx.globalAlpha = a; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(bx, topY - 10, r, -Math.PI * 0.85, -Math.PI * 0.15); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      break;
    }
    case "office": {
      // Grand entrance
      ctx.fillStyle = "#020210"; ctx.fillRect(bx - 5, by - 12, 10, 12);
      ctx.strokeStyle = N.blue; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.strokeRect(bx - 5, by - 12, 10, 12); ctx.globalAlpha = 1;
      // Entrance glow
      ctx.save(); ctx.shadowColor = N.blue; ctx.shadowBlur = 8;
      ctx.fillStyle = N.blue; ctx.globalAlpha = 0.15;
      ctx.fillRect(bx - 4, by - 10, 8, 10); ctx.restore();
      break;
    }
    case "barracks": {
      if (active && agents.length > 0) {
        for (let i = 0; i < 4; i++) {
          const pulseR = ((frame * 0.11 + i * 18) % 55) + 8;
          ctx.strokeStyle = N.lime; ctx.globalAlpha = Math.max(0, 0.3 - pulseR / 160); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(bx, by - totalH * 0.5, pulseR, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Entrance
      ctx.fillStyle = "#0a140a"; ctx.fillRect(bx - 4, by - 8, 8, 8);
      ctx.strokeStyle = N.lime; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.8; ctx.strokeRect(bx - 4, by - 8, 8, 8); ctx.globalAlpha = 1;
      break;
    }
    case "vault": {
      if (active && (countWorkingAt(agents, "vault") > 0 || (stats.vault?.count ?? 0) > 0)) {
        ctx.save(); ctx.translate(bx, by - totalH * 0.45);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + ph * 1.4;
          ctx.fillStyle = N.pink; ctx.globalAlpha = 0.4 + Math.sin(ph * 1.8 + i) * 0.12;
          ctx.beginPath(); ctx.arc(Math.cos(a) * 9, Math.sin(a) * 9, 2, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore(); ctx.globalAlpha = 1;
      }
      // Vault door
      ctx.fillStyle = "#0a0a04"; ctx.fillRect(bx - 5, by - 12, 10, 12);
      ctx.strokeStyle = N.pink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.strokeRect(bx - 5, by - 12, 10, 12);
      // Lock symbol
      ctx.fillStyle = N.pink; ctx.globalAlpha = active ? 0.6 : 0.2;
      ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
      ctx.fillText("⚒", bx, by - totalH * 0.3); ctx.globalAlpha = 1;
      break;
    }
    case "terminal": {
      // Screen glow on facade
      const scA = active ? 0.5 : 0.15;
      ctx.fillStyle = N.green; ctx.globalAlpha = scA;
      ctx.fillRect(bx + b.w * 0.15, by - totalH * 0.7, b.w * 0.35, totalH * 0.35);
      ctx.fillStyle = N.green; ctx.globalAlpha = scA * 0.6;
      ctx.fillRect(bx - b.w * 0.45, by - totalH * 0.65, b.w * 0.3, totalH * 0.3);
      ctx.globalAlpha = 1;
      if (active && (countWorkingAt(agents, "terminal") > 0 || (stats.terminal?.count ?? 0) > 0)) {
        ctx.font = "6px monospace"; ctx.fillStyle = N.green;
        for (let i = 0; i < 5; i++) {
          ctx.globalAlpha = 0.3 + Math.sin(ph * 1.5 + i) * 0.08;
          ctx.fillText(String.fromCharCode(...Array.from({ length: 6 }, (_, j) => 0x30 + (Math.floor(frame * 0.12) + i * 7 + j * 3) % 42)),
            bx + b.w * 0.18, by - totalH * 0.63 + i * 6);
        }
        ctx.globalAlpha = 1;
      }
      // Blinking cursor
      if (active && (stats.terminal?.count ?? 0) > 0 && frame % 110 < 55) {
        ctx.fillStyle = N.green; ctx.globalAlpha = 0.8;
        ctx.fillRect(bx + b.w * 0.2, by - totalH * 0.38, 4, 2);
        ctx.globalAlpha = 1;
      }
      break;
    }
  }
}


function drawBuildingLabel(ctx: CanvasRenderingContext2D, b: BuildingDef, bx: number, by: number, hovered: boolean, stat?: { count: number; label: string }) {
  const bTotalH = (b.tiers ?? [{ h: b.h }]).reduce((a, t) => a + t.h, 0);
  const topD = b.tiers ? b.tiers[b.tiers.length - 1].d : b.d;
  const roofExtra = b.roofType === "spire" ? 42 : b.roofType === "antenna" ? 38 : b.roofType === "dome" ? 22 : b.roofType === "dish" ? 24 : 12;
  const ly = by - bTotalH - topD * 2 - roofExtra;

  ctx.textAlign = "center"; ctx.textBaseline = "middle";

  // Name
  const nameFont = hovered ? "600 12px -apple-system, sans-serif" : "500 10px -apple-system, sans-serif";
  ctx.font = nameFont;
  const label = `${b.icon} ${b.name}`;
  const nameW = ctx.measureText(label).width;

  // Stat
  let statW = 0;
  if (stat) {
    ctx.font = "500 8px -apple-system, sans-serif";
    statW = ctx.measureText(stat.label).width;
  }

  const pillW = Math.max(nameW, statW) + 28;
  const pillH = stat ? 36 : 22;
  const pillY = ly - pillH / 2;

  // Glass pill background
  ctx.fillStyle = hovered ? "rgba(10,11,15,0.78)" : "rgba(10,11,15,0.55)";
  ctx.beginPath(); ctx.roundRect(bx - pillW / 2, pillY, pillW, pillH, 11); ctx.fill();

  // Accent top edge
  const accentGrd = ctx.createLinearGradient(bx - pillW / 2, pillY, bx + pillW / 2, pillY);
  accentGrd.addColorStop(0, "rgba(0,0,0,0)");
  accentGrd.addColorStop(0.3, `${b.accent}${hovered ? "40" : "18"}`);
  accentGrd.addColorStop(0.7, `${b.accent}${hovered ? "40" : "18"}`);
  accentGrd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = accentGrd;
  ctx.beginPath(); ctx.roundRect(bx - pillW / 2, pillY, pillW, 2, [11, 11, 0, 0]); ctx.fill();

  // Border
  ctx.strokeStyle = hovered ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)";
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.roundRect(bx - pillW / 2, pillY, pillW, pillH, 11); ctx.stroke();

  // Name text
  ctx.font = nameFont;
  ctx.fillStyle = hovered ? "#e8ecf4" : "rgba(232,236,244,0.7)";
  ctx.fillText(label, bx, ly - (stat ? 6 : 0));

  // Stat text
  if (stat) {
    ctx.font = "500 8px -apple-system, sans-serif";
    ctx.fillStyle = b.accent; ctx.globalAlpha = 0.8;
    ctx.fillText(stat.label, bx, ly + 10);
    ctx.globalAlpha = 1;
  }
}

// ─── Agent Sprites ─────────────────────────────────────────────

function drawAgentSprite(ctx: CanvasRenderingContext2D, a: AgentSprite, frame: number, cx: number, cy: number, isHovered: boolean) {
  const sx = cx + a.x, sy = cy + a.y;
  const bob = a.state === "walking" ? Math.sin(frame * 0.12) * 2.2 : Math.sin(frame * 0.025) * 0.6;

  // Trail
  if (a.state === "walking" && a.trail.length > 0) {
    for (const t of a.trail) {
      const ta = (1 - t.age / 20) * 0.25;
      if (ta > 0) { ctx.fillStyle = a.color; ctx.globalAlpha = ta; ctx.beginPath(); ctx.arc(cx + t.x, cy + t.y, 1.2 * (1 - t.age / 20), 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  // Ground glow — soft radial
  ctx.save(); ctx.shadowColor = a.color; ctx.shadowBlur = isHovered ? 16 : 8;
  ctx.fillStyle = a.color; ctx.globalAlpha = isHovered ? 0.2 : 0.1;
  ctx.beginPath(); ctx.ellipse(sx, sy + 2, isHovered ? 12 : 8, isHovered ? 6 : 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  // Hover selection ring
  if (isHovered) {
    ctx.strokeStyle = a.color; ctx.globalAlpha = 0.35 + Math.sin(frame * 0.05) * 0.15; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(sx, sy + 2, 16, 8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }

  // Legs
  if (a.state === "walking") {
    const leg = Math.sin(frame * 0.12) * 2.5;
    ctx.strokeStyle = a.color; ctx.lineWidth = 1.8; ctx.lineCap = "round"; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(sx - 2, sy - 2 + bob); ctx.lineTo(sx - 2 + leg, sy + 1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 2, sy - 2 + bob); ctx.lineTo(sx + 2 - leg, sy + 1); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Body — rounded pill shape
  const bodyGrd = ctx.createLinearGradient(sx, sy - 14 + bob, sx, sy - 2 + bob);
  bodyGrd.addColorStop(0, lighten(a.color)); bodyGrd.addColorStop(1, darken(a.color));
  ctx.fillStyle = bodyGrd;
  ctx.beginPath(); ctx.roundRect(sx - 4.5, sy - 14 + bob, 9, 12, 4); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 0.5; ctx.stroke();

  // Head — with subtle gradient
  const headGrd = ctx.createRadialGradient(sx - 1, sy - 18 + bob, 0, sx, sy - 17 + bob, 5);
  headGrd.addColorStop(0, lighten(a.color)); headGrd.addColorStop(1, a.color);
  ctx.fillStyle = headGrd;
  ctx.beginPath(); ctx.arc(sx, sy - 17 + bob, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 0.4; ctx.stroke();

  // Emoji above head
  ctx.font = "11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(a.emoji, sx, sy - 30 + bob);

  // Status indicator — subtle colored ring
  const stateCol = a.state === "working" ? "#fbbf24" : a.state === "walking" ? "#34d399" : "rgba(255,255,255,0.2)";
  ctx.save(); ctx.shadowColor = stateCol; ctx.shadowBlur = 3;
  ctx.strokeStyle = stateCol; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(sx, sy - 17 + bob, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.restore(); ctx.globalAlpha = 1;

  // Floating nametag — glass pill style
  const nm = a.name.length > 10 ? a.name.slice(0, 10) : a.name;
  ctx.font = "500 8px -apple-system, sans-serif";
  const nameW = ctx.measureText(nm).width;
  const tagW = nameW + 14;
  const tagY = sy - 26 + bob;

  ctx.fillStyle = "rgba(10,11,15,0.65)";
  ctx.beginPath(); ctx.roundRect(sx - tagW / 2, tagY, tagW, 14, 7); ctx.fill();
  ctx.strokeStyle = `${a.color}40`; ctx.lineWidth = 0.7;
  ctx.beginPath(); ctx.roundRect(sx - tagW / 2, tagY, tagW, 14, 7); ctx.stroke();

  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(232,236,244,0.8)";
  ctx.fillText(nm, sx, tagY + 7);

  // Working indicator — subtle pulse dot instead of spark emoji
  if (a.state === "working") {
    const pulseA = 0.5 + Math.sin(frame * 0.06) * 0.3;
    ctx.save(); ctx.shadowColor = "#fbbf24"; ctx.shadowBlur = 6;
    ctx.fillStyle = "#fbbf24"; ctx.globalAlpha = pulseA;
    ctx.beginPath(); ctx.arc(sx + tagW / 2 + 2, tagY + 7, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Task bubble — clean glass style
  if (a.task && a.task.length > 0) {
    const taskText = a.task.length > 30 ? a.task.slice(0, 28) + "…" : a.task;
    ctx.font = "400 7px -apple-system, sans-serif";
    const tw = ctx.measureText(taskText).width + 16;
    const bby = sy - 44 + bob;

    ctx.fillStyle = "rgba(10,11,15,0.7)";
    ctx.beginPath(); ctx.roundRect(sx - tw / 2, bby - 6, tw, 14, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.roundRect(sx - tw / 2, bby - 6, tw, 14, 7); ctx.stroke();
    // Pointer
    ctx.fillStyle = "rgba(10,11,15,0.7)";
    ctx.beginPath(); ctx.moveTo(sx - 2, bby + 8); ctx.lineTo(sx, bby + 11); ctx.lineTo(sx + 2, bby + 8); ctx.fill();
    ctx.fillStyle = "rgba(232,236,244,0.5)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(taskText, sx, bby + 1);
  }

  // Hover tooltip — glass card with clean typography
  if (isHovered) {
    const tooltipY = sy + 14;
    const lines = [
      a.name,
      a.state === "working" ? "Working" : a.state === "walking" ? "Moving" : "Idle",
      a.model ? a.model.split("/").pop()! : "",
      a.task ? a.task.slice(0, 32) : "",
    ].filter(l => l);

    ctx.font = "400 8px -apple-system, sans-serif";
    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + 20;
    const ttH = lines.length * 14 + 12;

    drawGlassPanel(ctx, sx - maxW / 2, tooltipY, maxW, ttH, a.color);

    ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      if (i === 0) {
        ctx.font = "600 9px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(232,236,244,0.9)";
      } else if (i === 1) {
        ctx.font = "500 8px -apple-system, sans-serif";
        ctx.fillStyle = a.state === "working" ? "#fbbf24" : a.state === "walking" ? "#34d399" : "rgba(232,236,244,0.4)";
      } else {
        ctx.font = "400 8px -apple-system, sans-serif";
        ctx.fillStyle = "rgba(232,236,244,0.35)";
      }
      ctx.fillText(lines[i], sx - maxW / 2 + 10, tooltipY + 7 + i * 14);
    }
    ctx.globalAlpha = 1;
  }
}

// ─── Particles ─────────────────────────────────────────────────

function emitNeonSmoke(p: Particle[], bx: number, by: number, b: BuildingDef) {
  if (p.length > 200) return;
  const tH = getBuildingTotalH(b);
  for (let i = 0; i < 2; i++) {
    p.push({ x: bx + b.w * 0.55 + (Math.random() - 0.5) * 6, y: by - b.d * 0.6 - tH - 28, vx: (Math.random() - 0.5) * 0.4, vy: -0.6 - Math.random() * 0.4, life: 70 + Math.random() * 50, maxLife: 120, color: N.orange, size: 3 + Math.random() * 3 });
  }
}
function emitDataSparkle(p: Particle[], bx: number, by: number, b: BuildingDef) {
  if (p.length > 200) return;
  const tH = getBuildingTotalH(b);
  p.push({ x: bx + (Math.random() - 0.5) * b.w * 1.4, y: by - tH * 0.4 + (Math.random() - 0.5) * tH * 0.5, vx: (Math.random() - 0.5) * 0.6, vy: -0.8 - Math.random() * 0.6, life: 40 + Math.random() * 30, maxLife: 70, color: N.purple, size: 1.5 + Math.random() * 2 });
}
function emitCyanSpark(p: Particle[], bx: number, by: number, b: BuildingDef) {
  if (p.length > 200) return;
  const tH = getBuildingTotalH(b);
  p.push({ x: bx + (Math.random() - 0.5) * b.w * 1.2, y: by - tH - b.d * 2 - 18, vx: (Math.random() - 0.5) * 1, vy: -0.4 - Math.random() * 0.5, life: 30 + Math.random() * 25, maxLife: 55, color: N.cyan, size: 1.5 + Math.random() * 1.5 });
}

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

function drawGlassPanel(ctx: CanvasRenderingContext2D, x: number, y: number, pw: number, ph: number, accent?: string) {
  ctx.fillStyle = "rgba(10,11,15,0.62)";
  ctx.beginPath(); ctx.roundRect(x, y, pw, ph, 14); ctx.fill();
  // Inner highlight
  ctx.strokeStyle = "rgba(255,255,255,0.055)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, pw, ph, 14); ctx.stroke();
  // Subtle accent glow at top edge
  if (accent) {
    const grd = ctx.createLinearGradient(x, y, x, y + 3);
    grd.addColorStop(0, `${accent}18`); grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.roundRect(x, y, pw, 3, [14, 14, 0, 0]); ctx.fill();
  }
}

function drawHUD(ctx: CanvasRenderingContext2D, w: number, h: number, agents: AgentSprite[], activeCount: number, _frame: number, activityLog: ActivityEntry[], cronCount: number, skillCount: number, channelCount: number) {
  // Title — frosted glass panel
  drawGlassPanel(ctx, 12, 10, 230, 54, N.cyan);
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.font = "600 16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"; ctx.fillStyle = "#e8ecf4";
  ctx.fillText("Crystal City", 24, 18);
  ctx.font = "500 9px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.35)";
  ctx.letterSpacing = "0.1em";
  ctx.fillText("MISSION CONTROL", 24, 38);
  ctx.letterSpacing = "0";
  ctx.font = "400 8px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.25)";
  ctx.fillText("Click any building to navigate", 24, 50);

  // Stats panel (top right) — glass card
  const statsW = 240, statsH = 68;
  drawGlassPanel(ctx, w - statsW - 12, 10, statsW, statsH, N.blue);

  const dotCol = activeCount > 0 ? "#34d399" : "#f87171";
  ctx.save(); ctx.shadowColor = dotCol; ctx.shadowBlur = 6;
  ctx.fillStyle = dotCol; ctx.beginPath(); ctx.arc(w - statsW + 4, 32, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();

  ctx.font = "600 11px -apple-system, sans-serif"; ctx.fillStyle = "#e8ecf4"; ctx.globalAlpha = 0.9;
  ctx.fillText(`${agents.length} Agents  ·  ${activeCount} Active`, w - statsW + 14, 27);
  ctx.font = "500 9px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.4)"; ctx.globalAlpha = 1;
  ctx.fillText(`Cron ${cronCount}  ·  Skills ${skillCount}  ·  Channels ${channelCount}`, w - statsW + 14, 44);
  ctx.font = "500 9px 'SF Mono', 'JetBrains Mono', monospace"; ctx.fillStyle = "rgba(232,236,244,0.3)";
  ctx.fillText(new Date().toLocaleTimeString("en-US", { hour12: false }), w - statsW + 14, 59);

  // Agent roster (right side) — glass panel
  if (agents.length > 0) {
    const rosterW = 190;
    const rosterX = w - rosterW - 12, rosterY = 86;
    const rowH = 28;
    const rosterH = agents.length * rowH + 32;
    drawGlassPanel(ctx, rosterX, rosterY, rosterW, rosterH, N.purple);

    ctx.font = "600 8px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.3)";
    ctx.letterSpacing = "0.1em";
    ctx.fillText("AGENTS", rosterX + 14, rosterY + 12);
    ctx.letterSpacing = "0";

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]; const ay = rosterY + 26 + i * rowH;

      // Row hover-like background
      ctx.fillStyle = "rgba(255,255,255,0.015)";
      ctx.beginPath(); ctx.roundRect(rosterX + 6, ay - 2, rosterW - 12, rowH - 4, 8); ctx.fill();

      // Status dot with glow
      const stColor = a.state === "working" ? "#fbbf24" : a.state === "walking" ? "#34d399" : "rgba(255,255,255,0.2)";
      ctx.save(); ctx.shadowColor = stColor; ctx.shadowBlur = 4;
      ctx.fillStyle = stColor; ctx.beginPath(); ctx.arc(rosterX + 18, ay + 10, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();

      // Agent name
      ctx.font = "500 10px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.8)"; ctx.textAlign = "left";
      ctx.fillText(`${a.emoji} ${a.name}`, rosterX + 28, ay + 6);

      // Status / task
      ctx.font = "400 8px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.3)";
      const stateLabel = a.state === "working" ? (a.task ? a.task.slice(0, 24) : "Working") : a.state === "walking" ? "Moving" : "Idle";
      ctx.fillText(stateLabel, rosterX + 28, ay + 18);
    }
    ctx.textAlign = "left";
  }

  // Activity feed (bottom left) — glass panel
  if (activityLog.length > 0) {
    const feedX = 12;
    const shown = activityLog.slice(-5);
    const lineH = 18;
    const feedH = shown.length * lineH + 30;
    const feedY = h - feedH - 12;
    drawGlassPanel(ctx, feedX, feedY, 280, feedH, "#34d399");

    ctx.font = "600 8px -apple-system, sans-serif"; ctx.fillStyle = "rgba(232,236,244,0.3)";
    ctx.letterSpacing = "0.1em";
    ctx.fillText("ACTIVITY", feedX + 14, feedY + 12);
    ctx.letterSpacing = "0";

    for (let i = 0; i < shown.length; i++) {
      const entry = shown[i];
      const age = (Date.now() - entry.time) / 1000;
      const ey = feedY + 26 + i * lineH;
      ctx.font = "400 9px -apple-system, sans-serif"; ctx.fillStyle = entry.color;
      ctx.globalAlpha = Math.max(0.3, 1 - age / 60);
      ctx.textAlign = "left";
      ctx.fillText(entry.text, feedX + 14, ey);
    }
    ctx.globalAlpha = 1;
  }

  // Bottom hint — clean, subtle
  ctx.font = "400 9px -apple-system, sans-serif"; ctx.textAlign = "center";
  ctx.fillStyle = "rgba(232,236,244,0.15)";
  ctx.fillText("Click a building to navigate  ·  Hover an agent for details", w / 2, h - 14);
}

function drawScanlines(ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) {
  ctx.fillStyle = "rgba(0,0,0,0.022)";
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
  const scanY = (frame * 0.8) % (h + 80) - 40;
  const scanG = ctx.createLinearGradient(0, scanY - 24, 0, scanY + 24);
  scanG.addColorStop(0, "rgba(180,140,255,0)"); scanG.addColorStop(0.45, "rgba(120,180,255,0.012)"); scanG.addColorStop(1, "rgba(180,140,255,0)");
  ctx.fillStyle = scanG; ctx.fillRect(0, scanY - 24, w, 48);
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.82);
  vg.addColorStop(0, "rgba(15,5,30,0)");
  vg.addColorStop(0.5, "rgba(8,2,18,0.06)");
  vg.addColorStop(0.8, "rgba(4,0,12,0.2)");
  vg.addColorStop(1, "rgba(0,0,0,0.52)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  // Subtle corner bloom
  const corners = [
    { x: 0, y: 0, c: "rgba(200,120,255,0.04)" },
    { x: w, y: h, c: "rgba(0,255,242,0.03)" },
  ];
  for (const cn of corners) {
    const cg = ctx.createRadialGradient(cn.x, cn.y, 0, cn.x, cn.y, Math.min(w, h) * 0.5);
    cg.addColorStop(0, cn.c); cg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = cg; ctx.fillRect(0, 0, w, h);
  }
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

      // Shadow pass — draw all building shadows before any buildings
      for (const b of BUILDINGS) {
        const tH = getBuildingTotalH(b);
        drawBuildingShadow(ctx, cx + b.ox, cy + b.oy, b.w, b.d, tH);
      }

      const drawables: { type: "pylon" | "building" | "agent" | "drone" | "tree"; y: number; idx: number }[] = [];
      PYLON_POS.forEach((_, i) => drawables.push({ type: "pylon", y: PYLON_POS[i][1], idx: i }));
      BUILDINGS.forEach((b, i) => drawables.push({ type: "building", y: b.oy, idx: i }));
      TREE_POSITIONS.forEach((t, i) => drawables.push({ type: "tree", y: t.y, idx: i }));
      w.agents.forEach((a, i) => drawables.push({ type: "agent", y: a.y, idx: i }));
      w.drones.forEach((d, i) => drawables.push({ type: "drone", y: d.y, idx: i }));
      drawables.sort((a, b) => a.y - b.y);

      for (const d of drawables) {
        if (d.type === "pylon") { const [tx, ty] = PYLON_POS[d.idx]; drawHoloPylon(ctx, cx + tx, cy + ty, w.frame, d.idx); }
        else if (d.type === "tree") {
          drawIsometricTree(ctx, cx, cy, TREE_POSITIONS[d.idx], w.frame);
        }
        else if (d.type === "building") {
          const b = BUILDINGS[d.idx]; const bx = cx + b.ox, by = cy + b.oy; const hovered = w.hoveredBuilding === b.id;
          drawMultiTierBuilding(ctx, b, bx, by, w.frame, w.activeBuildings.has(b.id), hovered);
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
      const tH = getBuildingTotalH(b);
      if (mx > bx - b.w - 12 && mx < bx + b.w + 12 && my > by - tH - b.d * 2 - 30 && my < by + 12) { hovered = b.id; break; }
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
        filter: "contrast(1.04) saturate(1.12) brightness(1.02)",
      }}
    >
      <canvas ref={canvasRef} onMouseMove={handleMouseMove} onClick={handleClick} style={{ display: "block" }} />
    </div>
  );
}
