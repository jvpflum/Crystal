import {
  DISTRICTS,
  GRID,
  PAL,
  SKY,
  TILE_H,
  TILE_W,
  lightsOn,
  mix,
  rgba,
  shade,
} from "./theme";
import type { CitySnapshot, DayPhase, District, RoofType } from "./types";
import type { Sprite } from "./simulation";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — Canvas 2D render engine
   Cohesive, toy-like isometric town with a living day/night cycle.
   ═══════════════════════════════════════════════════════════════ */

const GROUND_Y = 36; // push the grid down a touch from center

// ─── Ambient world (clouds / birds / stars / rain / particles) ──
export interface Cloud { x: number; y: number; s: number; speed: number; }
export interface Bird { x: number; y: number; speed: number; phase: number; }
export interface Star { x: number; y: number; b: number; phase: number; }
export interface Drop { x: number; y: number; v: number; len: number; }
export interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; }

export interface Ambient {
  clouds: Cloud[];
  birds: Bird[];
  stars: Star[];
  rain: Drop[];
  puffs: Puff[];
}

export function createAmbient(w: number, h: number): Ambient {
  return {
    clouds: Array.from({ length: 6 }, (_, i) => ({
      x: Math.random() * w, y: 40 + (i % 3) * 46 + Math.random() * 30,
      s: 0.7 + Math.random() * 0.9, speed: 4 + Math.random() * 8,
    })),
    birds: Array.from({ length: 4 }, () => ({
      x: Math.random() * w, y: 70 + Math.random() * 120,
      speed: 16 + Math.random() * 18, phase: Math.random() * 6,
    })),
    stars: Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random() * 0.55, b: Math.random(), phase: Math.random() * 6,
    })),
    rain: Array.from({ length: 220 }, () => ({
      x: Math.random() * (w + 60), y: Math.random() * h, v: 320 + Math.random() * 260, len: 9 + Math.random() * 12,
    })),
    puffs: [],
  };
}

// ─── Iso primitives ────────────────────────────────────────────
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x, y - h / 2); ctx.lineTo(x + w / 2, y);
  ctx.lineTo(x, y + h / 2); ctx.lineTo(x - w / 2, y);
  ctx.closePath(); ctx.fill();
}

function isoBox(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number,
  top: string, left: string, right: string,
) {
  // right face
  ctx.fillStyle = right;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y - d); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - h); ctx.closePath(); ctx.fill();
  // left face
  ctx.fillStyle = left;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - w, y - d); ctx.lineTo(x - w, y - d - h); ctx.lineTo(x, y - h); ctx.closePath(); ctx.fill();
  // top
  ctx.fillStyle = top;
  ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - d - h); ctx.lineTo(x, y - 2 * d - h); ctx.lineTo(x - w, y - d - h); ctx.closePath(); ctx.fill();
}

// ─── Sky ───────────────────────────────────────────────────────
function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, phase: DayPhase, amb: Ambient, t: number, dt: number) {
  const s = SKY[phase];
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, s.top); g.addColorStop(0.45, s.mid);
  g.addColorStop(0.72, s.horizon); g.addColorStop(1, s.ground);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // Sun / moon
  const celX = w * 0.78, celY = h * (phase === "night" ? 0.16 : 0.2);
  if (phase === "night") {
    ctx.fillStyle = "rgba(245,245,225,0.9)";
    ctx.beginPath(); ctx.arc(celX, celY, 18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.top;
    ctx.beginPath(); ctx.arc(celX + 7, celY - 5, 16, 0, Math.PI * 2); ctx.fill();
  } else {
    const sun = ctx.createRadialGradient(celX, celY, 4, celX, celY, 60);
    const sc = phase === "day" ? "#fff7d6" : "#ffd9a0";
    sun.addColorStop(0, sc); sun.addColorStop(0.4, rgba("#ffe9b0", 0.5)); sun.addColorStop(1, "rgba(255,233,176,0)");
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(celX, celY, 60, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = sc; ctx.beginPath(); ctx.arc(celX, celY, 20, 0, Math.PI * 2); ctx.fill();
  }

  // Stars at night
  if (phase === "night") {
    for (const st of amb.stars) {
      const tw = 0.4 + (Math.sin(t * 1.4 + st.phase) * 0.3 + 0.5) * st.b * 0.6;
      ctx.globalAlpha = tw;
      ctx.fillStyle = "#eef2ff";
      ctx.fillRect(st.x * w, st.y * h, st.b > 0.8 ? 2 : 1.2, st.b > 0.8 ? 2 : 1.2);
    }
    ctx.globalAlpha = 1;
  }

  // Clouds (skip in heavy rain look — still fine)
  const cloudCol = phase === "night" ? "rgba(120,130,180,0.18)" : "rgba(255,255,255,0.7)";
  for (const c of amb.clouds) {
    c.x += c.speed * dt;
    if (c.x - 60 * c.s > w) c.x = -60 * c.s;
    drawCloud(ctx, c.x, c.y, c.s, cloudCol);
  }

  // Birds in daytime
  if (phase !== "night") {
    for (const b of amb.birds) {
      b.x += b.speed * dt;
      if (b.x > w + 20) b.x = -20;
      const flap = Math.sin(t * 6 + b.phase) * 3;
      ctx.strokeStyle = "rgba(40,46,70,0.5)"; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(b.x - 5, b.y); ctx.quadraticCurveTo(b.x, b.y - 3 - flap, b.x + 5, b.y);
      ctx.stroke();
    }
  }
}

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, col: string) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x, y, 30 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 24 * s, y + 4 * s, 20 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 24 * s, y + 4 * s, 22 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ─── Ground ────────────────────────────────────────────────────
function drawGround(ctx: CanvasRenderingContext2D, cx: number, cy: number, night: number, t: number) {
  const mid = (GRID - 1) / 2;
  const oy = cy + GROUND_Y - (GRID * TILE_H) / 2;
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const sx = cx + (gx - gy) * (TILE_W / 2);
      const sy = oy + (gx + gy) * (TILE_H / 2);
      const onRoad = Math.abs(gx - mid) <= 0.5 || Math.abs(gy - mid) <= 0.5;
      const nearRoad = Math.abs(gx - mid) <= 1.5 || Math.abs(gy - mid) <= 1.5;
      const plaza = Math.abs(gx - mid) <= 1.5 && Math.abs(gy - mid) <= 1.5;

      let base: string;
      if (plaza) base = PAL.plaza;
      else if (onRoad) base = PAL.road;
      else if (nearRoad) base = PAL.roadEdge;
      else {
        const v = Math.sin(gx * 1.3 + gy * 2.1);
        base = v > 0.3 ? PAL.grassA : v > -0.3 ? PAL.grassB : PAL.grassC;
      }
      if (night > 0) base = mix(base, "#0c1130", night * 0.5);
      diamond(ctx, sx, sy, TILE_W - 1, TILE_H - 1, base);

      // crosswalk dashes on the plaza ring
      if (onRoad && (gx + gy) % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.10)";
        diamond(ctx, sx, sy, 8, 4, "rgba(255,255,255,0.10)");
      }
    }
  }

  // soft plaza vignette glow
  const glow = ctx.createRadialGradient(cx, cy + GROUND_Y, 0, cx, cy + GROUND_Y, GRID * TILE_W * 0.42);
  glow.addColorStop(0, rgba("#ffe9b0", 0.05 * (1 - night)));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 500, cy - 260, 1000, 560);

  // gentle fountain at the center plaza
  drawFountain(ctx, cx, cy + GROUND_Y, t);
}

function drawFountain(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  diamond(ctx, x, y, 40, 20, "#2c3350");
  diamond(ctx, x, y, 30, 15, rgba(PAL.water, 0.85));
  ctx.fillStyle = rgba("#bfe9ff", 0.5);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + t;
    const h = 6 + Math.sin(t * 3 + i) * 3;
    ctx.fillRect(x + Math.cos(a) * 6 - 0.7, y - h, 1.4, h);
  }
}

// ─── Roads from plaza to districts ─────────────────────────────
function drawPaths(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const px = cx, py = cy + GROUND_Y;
  for (const d of DISTRICTS) {
    ctx.strokeStyle = rgba(PAL.roadEdge, 0.5); ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx + d.ox, cy + d.oy + 14); ctx.stroke();
    ctx.strokeStyle = rgba("#e7ecff", 0.06); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(cx + d.ox, cy + d.oy + 14); ctx.stroke();
  }
}

// ─── Trees / props ─────────────────────────────────────────────
const TREES: { x: number; y: number; s: number }[] = [
  { x: -120, y: -30, s: 1 }, { x: 120, y: -30, s: 1.1 }, { x: -250, y: 150, s: 0.9 },
  { x: 250, y: 150, s: 1 }, { x: -70, y: 150, s: 0.8 }, { x: 70, y: 150, s: 0.85 },
  { x: -340, y: 0, s: 1.1 }, { x: 340, y: 0, s: 1 }, { x: 0, y: 320, s: 0.95 },
  { x: -250, y: -120, s: 0.85 }, { x: 250, y: -120, s: 0.9 },
];

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, night: number) {
  const sway = Math.sin(t * 1.2 + x) * 1.5;
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath(); ctx.ellipse(x + 2, y + 2, 12 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#6b4a2a";
  ctx.fillRect(x - 2, y - 18 * s, 4, 18 * s);
  const leaf = mix("#3f9d57", "#0c1130", night * 0.45);
  const leafL = mix("#5bbd6f", "#0c1130", night * 0.45);
  ctx.fillStyle = leaf;
  ctx.beginPath(); ctx.arc(x + sway, y - 24 * s, 14 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = leafL;
  ctx.beginPath(); ctx.arc(x + sway - 4 * s, y - 27 * s, 8 * s, 0, Math.PI * 2); ctx.fill();
}

// ─── Buildings ─────────────────────────────────────────────────
function drawWindows(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, d: number, h: number,
  accent: string, lit: boolean, frame: number,
) {
  const cols = Math.max(2, Math.floor(w / 9));
  const rows = Math.max(2, Math.floor(h / 13));
  for (let face = 0; face < 2; face++) {
    const sign = face === 0 ? 1 : -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const u = (c + 0.5) / cols * 0.72 + 0.14;
        const v = (r + 0.5) / rows * 0.78 + 0.12;
        const wx = x + sign * u * w;
        const wy = y - u * d - v * h;
        const seed = r * 7.1 + c * 3.3 + face * 13 + w;
        const on = lit && Math.sin(seed * 2.3) > -0.2;
        if (on) {
          ctx.fillStyle = (r + c) % 5 === 0 ? accent : "#ffe6a0";
          ctx.globalAlpha = 0.85;
        } else {
          ctx.fillStyle = lit ? "#10162e" : rgba("#0b1024", 0.35);
          ctx.globalAlpha = lit ? 0.7 : 0.4;
        }
        ctx.fillRect(wx - 1.6, wy - 2.3, 3.2, 3.6);
      }
    }
  }
  ctx.globalAlpha = 1;
  void frame;
}

function drawRoof(ctx: CanvasRenderingContext2D, x: number, ty: number, w: number, d: number, roof: RoofType, accent: string, t: number) {
  switch (roof) {
    case "pitched": {
      const ph = 16;
      ctx.fillStyle = shade(accent, -30);
      ctx.beginPath();
      ctx.moveTo(x - w, ty - d); ctx.lineTo(x, ty - 2 * d); ctx.lineTo(x, ty - 2 * d - ph); ctx.lineTo(x - w, ty - d - ph); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(accent, -10);
      ctx.beginPath();
      ctx.moveTo(x + w, ty - d); ctx.lineTo(x, ty - 2 * d); ctx.lineTo(x, ty - 2 * d - ph); ctx.lineTo(x + w, ty - d - ph); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(accent, 30);
      ctx.beginPath();
      ctx.moveTo(x, ty - 2 * d - ph); ctx.lineTo(x + w, ty - d - ph); ctx.lineTo(x, ty - ph); ctx.lineTo(x - w, ty - d - ph); ctx.closePath(); ctx.fill();
      break;
    }
    case "dome": {
      const r = w * 0.62;
      ctx.fillStyle = shade(accent, 20);
      ctx.beginPath(); ctx.ellipse(x, ty - d, r, r * 0.7, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(x, ty - d - r * 0.7 + 2, 3.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "spire": {
      const sh = 30;
      ctx.fillStyle = shade(accent, -10);
      ctx.beginPath(); ctx.moveTo(x, ty - d - sh); ctx.lineTo(x + w * 0.32, ty - d); ctx.lineTo(x - w * 0.32, ty - d); ctx.closePath(); ctx.fill();
      const pulse = 0.5 + Math.sin(t * 3) * 0.5;
      ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 12 * pulse;
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(x, ty - d - sh - 2, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      break;
    }
    case "antenna": {
      ctx.strokeStyle = "#8a90ad"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, ty - d); ctx.lineTo(x, ty - d - 30); ctx.stroke();
      const blink = (Math.sin(t * 4) > 0);
      ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = blink ? 12 : 2;
      ctx.fillStyle = blink ? accent : shade(accent, -60);
      ctx.beginPath(); ctx.arc(x, ty - d - 32, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      // dish
      ctx.strokeStyle = rgba(accent, 0.6); ctx.lineWidth = 1.5;
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(x, ty - d - 10, 6 * i, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke();
      }
      break;
    }
    case "stack": {
      ctx.fillStyle = shade(accent, -40);
      isoBox(ctx, x + w * 0.4, ty - d * 0.5, 6, 5, 22, shade(accent, -20), shade(accent, -50), shade(accent, -35));
      break;
    }
    default: break;
  }
}

function drawBuilding(
  ctx: CanvasRenderingContext2D, d: District, cx: number, cy: number,
  active: boolean, hovered: boolean, lit: boolean, night: number, frame: number, t: number,
) {
  const x = cx + d.ox, y = cy + d.oy;
  const top = mix(shade(d.accent, 18), "#0c1130", night * 0.4);
  const left = mix(shade(d.accent, -55), "#0c1130", night * 0.45);
  const right = mix(shade(d.accent, -25), "#0c1130", night * 0.42);

  // shadow
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + d.w, y - d.d); ctx.lineTo(x + d.w + d.h * 0.3, y - d.d + d.h * 0.16); ctx.lineTo(x + d.h * 0.3, y + d.h * 0.16);
  ctx.closePath(); ctx.fill();

  if (hovered) { ctx.save(); ctx.shadowColor = d.accent; ctx.shadowBlur = 26; }

  isoBox(ctx, x, y, d.w, d.d, d.h, top, left, right);
  drawWindows(ctx, x, y, d.w, d.d, d.h, d.accent, lit, frame);

  // accent base trim
  ctx.strokeStyle = rgba(d.accent, active ? 0.9 : 0.4);
  ctx.lineWidth = hovered ? 2.4 : 1.6;
  ctx.beginPath();
  ctx.moveTo(x - d.w, y - d.d); ctx.lineTo(x, y); ctx.lineTo(x + d.w, y - d.d); ctx.stroke();

  // entrance
  ctx.fillStyle = lit ? rgba(d.accent, 0.55) : "#1a2138";
  ctx.fillRect(x - 5, y - 13, 10, 13);

  drawRoof(ctx, x, y - d.h, d.w, d.d, d.roof, d.accent, t);

  if (hovered) ctx.restore();

  // active ground glow
  if (active) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, d.w * 2.6);
    g.addColorStop(0, rgba(d.accent, 0.12 + Math.sin(t * 2) * 0.03));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - d.w * 3, y - d.h - 40, d.w * 6, d.h + 80);
  }
}

function drawBuildingLabel(
  ctx: CanvasRenderingContext2D, d: District, cx: number, cy: number,
  label: string, active: boolean, hovered: boolean,
) {
  const x = cx + d.ox;
  const roofExtra = d.roof === "spire" ? 44 : d.roof === "antenna" ? 46 : d.roof === "dome" ? 26 : 18;
  const y = cy + d.oy - d.h - d.d * 2 - roofExtra;

  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "600 11px -apple-system, system-ui, sans-serif";
  const name = `${d.icon} ${d.name}`;
  const nameW = ctx.measureText(name).width;
  ctx.font = "500 8px -apple-system, system-ui, sans-serif";
  const labW = ctx.measureText(label).width;
  const pillW = Math.max(nameW, labW) + 22;
  const pillH = 32;

  ctx.fillStyle = hovered ? "rgba(14,18,38,0.9)" : "rgba(14,18,38,0.66)";
  roundRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, 9);
  ctx.fill();
  ctx.fillStyle = rgba(d.accent, active ? 0.9 : 0.35);
  roundRect(ctx, x - pillW / 2, y - pillH / 2, pillW, 2.5, 9);
  ctx.fill();

  ctx.fillStyle = hovered ? "#f4f7ff" : "rgba(238,242,255,0.82)";
  ctx.font = "600 11px -apple-system, system-ui, sans-serif";
  ctx.fillText(name, x, y - 6);
  ctx.fillStyle = rgba(d.accent, 0.95);
  ctx.font = "500 8px -apple-system, system-ui, sans-serif";
  ctx.fillText(label.toUpperCase(), x, y + 8);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

// ─── Citizens ──────────────────────────────────────────────────
function drawCitizen(ctx: CanvasRenderingContext2D, s: Sprite, cx: number, cy: number, t: number, hovered: boolean) {
  const x = cx + s.x, y = cy + s.y;
  const walking = s.state === "walking";
  const bob = walking ? Math.abs(Math.sin(t * 8 + s.phase)) * 2.4 : Math.sin(t * 2 + s.phase) * 0.7;

  // trail
  if (walking) {
    for (const tr of s.trail) {
      const a = (1 - tr.age / 16) * 0.18;
      if (a > 0) { ctx.fillStyle = rgba(s.citizen.color, a); ctx.beginPath(); ctx.arc(cx + tr.x, cy + tr.y, 1.3, 0, Math.PI * 2); ctx.fill(); }
    }
  }

  // shadow
  ctx.fillStyle = PAL.shadow;
  ctx.beginPath(); ctx.ellipse(x, y + 1, hovered ? 7 : 5, hovered ? 3.4 : 2.5, 0, 0, Math.PI * 2); ctx.fill();

  if (hovered) {
    ctx.strokeStyle = rgba(s.citizen.color, 0.5 + Math.sin(t * 4) * 0.2); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y + 1, 10, 5, 0, 0, Math.PI * 2); ctx.stroke();
  }

  // legs
  if (walking) {
    const leg = Math.sin(t * 8 + s.phase) * 2.4;
    ctx.strokeStyle = shade(s.citizen.color, -50); ctx.lineWidth = 1.8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x - 1.6, y - 4 + bob); ctx.lineTo(x - 1.6 + leg, y - 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 1.6, y - 4 + bob); ctx.lineTo(x + 1.6 - leg, y - 0.5); ctx.stroke();
  }

  // body
  const bg = ctx.createLinearGradient(x, y - 14 + bob, x, y - 3 + bob);
  bg.addColorStop(0, shade(s.citizen.color, 35)); bg.addColorStop(1, shade(s.citizen.color, -25));
  ctx.fillStyle = bg;
  roundRect(ctx, x - 4, y - 13 + bob, 8, 11, 3.5); ctx.fill();

  // head
  ctx.fillStyle = "#f3d9b8";
  ctx.beginPath(); ctx.arc(x, y - 16 + bob, 3.6, 0, Math.PI * 2); ctx.fill();

  // working spark
  if (s.state === "working") {
    const p = 0.5 + Math.sin(t * 5 + s.phase) * 0.5;
    ctx.save(); ctx.shadowColor = "#fbbf24"; ctx.shadowBlur = 6 * p;
    ctx.fillStyle = "#fbbf24"; ctx.globalAlpha = 0.6 + p * 0.4;
    ctx.beginPath(); ctx.arc(x + 5, y - 20 + bob, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }

  if (hovered) {
    ctx.font = "10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(s.citizen.emoji, x, y - 26 + bob);
  }
}

// ─── Active-district puffs ─────────────────────────────────────
function updatePuffs(amb: Ambient, cx: number, cy: number, snap: CitySnapshot, frame: number) {
  if (frame % 10 === 0) {
    for (const d of DISTRICTS) {
      const act = snap.districts[d.id];
      if (!act?.active || amb.puffs.length > 90) continue;
      const x = cx + d.ox, y = cy + d.oy - d.h - d.d;
      const color = d.id === "forge" || d.id === "powerplant" ? "rgba(200,200,210,0.5)" : rgba(d.accent, 0.6);
      amb.puffs.push({ x: x + (Math.random() - 0.5) * d.w, y, vx: (Math.random() - 0.5) * 6, vy: -16 - Math.random() * 12, life: 1.4, max: 1.4, color, size: 2 + Math.random() * 3 });
    }
  }
}

function drawPuffs(ctx: CanvasRenderingContext2D, amb: Ambient, dt: number) {
  for (let i = amb.puffs.length - 1; i >= 0; i--) {
    const p = amb.puffs[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.life <= 0) { amb.puffs.splice(i, 1); continue; }
    ctx.globalAlpha = (p.life / p.max) * 0.55;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.life / p.max), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRain(ctx: CanvasRenderingContext2D, amb: Ambient, w: number, h: number, dt: number) {
  ctx.strokeStyle = "rgba(150,180,235,0.28)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of amb.rain) {
    r.y += r.v * dt; r.x -= 24 * dt;
    if (r.y > h) { r.y = -r.len; r.x = Math.random() * (w + 60); }
    ctx.moveTo(r.x, r.y); ctx.lineTo(r.x - 2, r.y + r.len);
  }
  ctx.stroke();
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, night: number) {
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.8);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(4,6,18,${0.28 + night * 0.22})`);
  ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
}

// ─── Frame ─────────────────────────────────────────────────────
export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  sprites: Sprite[];
  snapshot: CitySnapshot;
  amb: Ambient;
  frame: number;
  /** seconds */
  time: number;
  dt: number;
  hoveredDistrict: string | null;
  hoveredSprite: string | null;
}

export function renderCity(p: RenderParams): void {
  const { ctx, w, h, sprites, snapshot, amb, frame, time, dt } = p;
  const phase = snapshot.dayPhase;
  const night = phase === "night" ? 1 : phase === "dusk" ? 0.5 : phase === "dawn" ? 0.25 : 0;
  const lit = lightsOn(phase);
  const cx = w / 2, cy = h / 2;

  ctx.clearRect(0, 0, w, h);
  drawSky(ctx, w, h, phase, amb, time, dt);
  drawGround(ctx, cx, cy, night, time);
  drawPaths(ctx, cx, cy);
  updatePuffs(amb, cx, cy, snapshot, frame);

  // Depth-sorted scene: trees, buildings, citizens by ground Y.
  type Item = { y: number; kind: "tree" | "building" | "citizen"; idx: number };
  const items: Item[] = [];
  TREES.forEach((tr, i) => items.push({ y: tr.y, kind: "tree", idx: i }));
  DISTRICTS.forEach((d, i) => items.push({ y: d.oy, kind: "building", idx: i }));
  sprites.forEach((s, i) => items.push({ y: s.y, kind: "citizen", idx: i }));
  items.sort((a, b) => a.y - b.y);

  for (const it of items) {
    if (it.kind === "tree") { const tr = TREES[it.idx]; drawTree(ctx, cx + tr.x, cy + tr.y, tr.s, time, night); }
    else if (it.kind === "building") {
      const d = DISTRICTS[it.idx];
      const act = snapshot.districts[d.id];
      drawBuilding(ctx, d, cx, cy, !!act?.active, p.hoveredDistrict === d.id, lit, night, frame, time);
    } else {
      const s = sprites[it.idx];
      drawCitizen(ctx, s, cx, cy, time, p.hoveredSprite === s.id);
    }
  }

  // Labels on top of geometry
  for (const d of DISTRICTS) {
    const act = snapshot.districts[d.id];
    drawBuildingLabel(ctx, d, cx, cy, act?.label || "quiet", !!act?.active, p.hoveredDistrict === d.id);
  }

  drawPuffs(ctx, amb, dt);
  if (snapshot.weather === "rain") drawRain(ctx, amb, w, h, dt);
  drawVignette(ctx, w, h, night);
}
