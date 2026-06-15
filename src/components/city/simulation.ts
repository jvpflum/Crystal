import { DISTRICT_BY_ID } from "./theme";
import type { Citizen, CitizenState, DistrictId } from "./types";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — citizen simulation
   Lightweight steering for the little people. Operates on plain
   sprite objects (kept in a ref, never React state) so it can run
   every frame without re-rendering.
   ═══════════════════════════════════════════════════════════════ */

export interface Sprite {
  id: string;
  citizen: Citizen;
  x: number;
  y: number;
  tx: number;
  ty: number;
  state: CitizenState;
  facing: 1 | -1;
  timer: number;
  trail: { x: number; y: number; age: number }[];
  /** Per-sprite phase so bobbing/animation isn't synchronized. */
  phase: number;
}

const WALK_SPEED = 38; // world px / second

function rand(a: number, b: number): number { return a + Math.random() * (b - a); }

/** A loitering spot in front of a district's entrance. */
export function spotAt(id: DistrictId, spread = 26): { x: number; y: number } {
  const d = DISTRICT_BY_ID[id];
  if (!d) return { x: rand(-40, 40), y: rand(-20, 20) };
  return {
    x: d.ox + rand(-spread, spread),
    y: d.oy + 18 + rand(-6, 10),
  };
}

function makeSprite(c: Citizen): Sprite {
  const home = spotAt(c.homeId);
  return {
    id: c.id,
    citizen: c,
    x: home.x,
    y: home.y,
    tx: home.x,
    ty: home.y,
    state: "idle",
    facing: 1,
    timer: rand(0.5, 3),
    trail: [],
    phase: Math.random() * Math.PI * 2,
  };
}

/** Add/remove sprites so the world matches the current citizen list. */
export function reconcileSprites(sprites: Sprite[], citizens: Citizen[]): Sprite[] {
  const byId = new Map(sprites.map(s => [s.id, s]));
  const next: Sprite[] = [];

  for (const c of citizens) {
    const existing = byId.get(c.id);
    if (existing) {
      const wasBusy = existing.citizen.busy;
      const wasWork = existing.citizen.workId;
      existing.citizen = c;
      // If the assignment changed, nudge them toward the new destination.
      if (c.busy !== wasBusy || c.workId !== wasWork) {
        existing.timer = 0;
        if (existing.state === "working") existing.state = "idle";
      }
      next.push(existing);
    } else {
      next.push(makeSprite(c));
    }
  }
  // Sprites whose citizen left are simply not carried into `next`.
  return next;
}

function pickDestination(s: Sprite): void {
  const c = s.citizen;
  if (c.busy) {
    const p = spotAt(c.workId, 22);
    s.tx = p.x; s.ty = p.y;
  } else {
    // Wander between home and the central plaza for ambient life.
    const toPlaza = Math.random() < 0.4;
    const p = toPlaza ? { x: rand(-60, 60), y: rand(20, 90) } : spotAt(c.homeId, 34);
    s.tx = p.x; s.ty = p.y;
  }
}

export function stepSprites(sprites: Sprite[], dt: number, frame: number): void {
  for (const s of sprites) {
    s.timer -= dt;

    if (s.state === "walking") {
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        s.x = s.tx; s.y = s.ty;
        s.state = s.citizen.busy ? "working" : "idle";
        s.timer = s.citizen.busy ? rand(4, 9) : rand(2.5, 6);
      } else {
        s.facing = dx >= 0 ? 1 : -1;
        s.x += (dx / dist) * WALK_SPEED * dt;
        s.y += (dy / dist) * WALK_SPEED * dt;
        if (frame % 4 === 0) {
          s.trail.push({ x: s.x, y: s.y, age: 0 });
          if (s.trail.length > 10) s.trail.shift();
        }
      }
    } else if (s.timer <= 0) {
      // idle or working timer elapsed → choose a new destination.
      pickDestination(s);
      const moved = Math.hypot(s.tx - s.x, s.ty - s.y) > 4;
      s.state = moved ? "walking" : (s.citizen.busy ? "working" : "idle");
      if (!moved) s.timer = rand(2, 5);
    }

    for (const t of s.trail) t.age += dt * 60;
    while (s.trail.length && s.trail[0].age > 16) s.trail.shift();
  }
}

/** Pick the sprite nearest to a screen point (for hover), within radius. */
export function spriteAt(sprites: Sprite[], cx: number, cy: number, mx: number, my: number, r = 16): Sprite | null {
  let best: Sprite | null = null;
  let bestD = r * r;
  for (const s of sprites) {
    const sx = cx + s.x, sy = cy + s.y - 14;
    const d = (sx - mx) * (sx - mx) + (sy - my) * (sy - my);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}
