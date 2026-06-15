import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useCityStore } from "@/stores/cityStore";
import { DISTRICTS, DISTRICT_BY_ID } from "@/components/city/theme";
import {
  createAmbient,
  renderCity,
  type Ambient,
} from "@/components/city/render";
import {
  reconcileSprites,
  spriteAt,
  stepSprites,
  type Sprite,
} from "@/components/city/simulation";
import { CityHUD, type HoverInfo } from "@/components/city/CityHUD";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — gamified living mini-city (SimCity meets The Sims)

   Rendering: Canvas 2D for the isometric world (cheap for dozens of
   animated sprites + ambient FX) with a React DOM HUD overlay for
   crisp, themeable stats & tooltips.

   PERFORMANCE: the rAF loop is fully STOPPED whenever the City view
   isn't the active view, the tab/window is hidden, or the canvas is
   off-screen (IntersectionObserver). While running it's capped to
   ~30fps. This avoids the keep-alive CPU burn flagged in
   PERFORMANCE_NOTES.md without touching App.tsx.
   ═══════════════════════════════════════════════════════════════ */

const FPS_CAP = 30;
const FRAME_MS = 1000 / FPS_CAP;
const POLL_MS = 6000;
const MAX_DPR = 2;

interface World {
  sprites: Sprite[];
  amb: Ambient;
  frame: number;
  time: number;
  w: number;
  h: number;
  lastSync: number;
  hoveredDistrict: string | null;
  hoveredSprite: string | null;
}

export function CityView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<World>({
    sprites: [], amb: createAmbient(960, 600), frame: 0, time: 0,
    w: 960, h: 600, lastSync: -1, hoveredDistrict: null, hoveredSprite: null,
  });

  const rafRef = useRef(0);
  const lastFrameRef = useRef(0);
  const lastSimRef = useRef(0);
  // Visibility gates — loop only runs when all are true.
  const activeRef = useRef(useAppStore.getState().currentView === "city");
  const visibleRef = useRef(!document.hidden);
  const onScreenRef = useRef(true);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setView = useAppStore(s => s.setView);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const hoverKeyRef = useRef<string>("");

  // ── Core frame: advance sim + draw ──
  const stepAndRender = useCallback((dt: number) => {
    const w = worldRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    w.frame++;
    w.time += dt;

    // Sync sprites from the store snapshot only when it actually changes.
    const snap = useCityStore.getState().snapshot;
    if (snap.lastUpdated !== w.lastSync) {
      w.lastSync = snap.lastUpdated;
      w.sprites = reconcileSprites(w.sprites, snap.citizens);
    }

    stepSprites(w.sprites, dt, w.frame);

    // Resize backing store to match CSS box * DPR (capped).
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const tw = Math.round(w.w * dpr), th = Math.round(w.h * dpr);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw; canvas.height = th;
      canvas.style.width = `${w.w}px`; canvas.style.height = `${w.h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    renderCity({
      ctx, w: w.w, h: w.h, sprites: w.sprites, snapshot: snap, amb: w.amb,
      frame: w.frame, time: w.time, dt,
      hoveredDistrict: w.hoveredDistrict, hoveredSprite: w.hoveredSprite,
    });
  }, []);

  // ── Loop control ──
  const shouldRun = useCallback(
    () => activeRef.current && visibleRef.current && onScreenRef.current,
    [],
  );

  const stopLoop = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  }, []);

  const startLoop = useCallback(() => {
    if (rafRef.current || !shouldRun()) return;
    lastFrameRef.current = performance.now();
    lastSimRef.current = performance.now();
    const loop = (now: number) => {
      if (!shouldRun()) { rafRef.current = 0; return; }
      const elapsed = now - lastFrameRef.current;
      if (elapsed >= FRAME_MS) {
        lastFrameRef.current = now - (elapsed % FRAME_MS);
        const dt = Math.min((now - lastSimRef.current) / 1000, 0.1);
        lastSimRef.current = now;
        stepAndRender(dt);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [shouldRun, stepAndRender]);

  // ── Polling control (only while active) ──
  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    void useCityStore.getState().poll();
    pollTimerRef.current = setInterval(() => {
      if (activeRef.current && visibleRef.current) void useCityStore.getState().poll();
    }, POLL_MS);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
  }, []);

  // ── Active-view subscription (appStore, read-only) ──
  useEffect(() => {
    const sync = (isCity: boolean) => {
      activeRef.current = isCity;
      if (isCity) { startPolling(); startLoop(); }
      else { stopLoop(); stopPolling(); }
    };
    sync(useAppStore.getState().currentView === "city");
    const unsub = useAppStore.subscribe((s) => sync(s.currentView === "city"));
    return () => { unsub(); stopLoop(); stopPolling(); };
  }, [startLoop, stopLoop, startPolling, stopPolling]);

  // ── Document visibility (tab/window hidden) ──
  useEffect(() => {
    const onVis = () => {
      visibleRef.current = !document.hidden;
      if (shouldRun()) startLoop(); else stopLoop();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [shouldRun, startLoop, stopLoop]);

  // ── Container size + on-screen detection ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const w = worldRef.current;
    w.w = el.clientWidth || 960; w.h = el.clientHeight || 600;

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const r = e.contentRect;
        if (r.width > 0 && r.height > 0) { w.w = r.width; w.h = r.height; }
      }
    });
    ro.observe(el);

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        onScreenRef.current = e.isIntersecting && e.intersectionRatio > 0;
      }
      if (shouldRun()) startLoop(); else stopLoop();
    }, { threshold: 0 });
    io.observe(el);

    return () => { ro.disconnect(); io.disconnect(); };
  }, [shouldRun, startLoop, stopLoop]);

  // ── Pointer interaction ──
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const w = worldRef.current;
    const cx = w.w / 2, cy = w.h / 2;

    // Districts first (larger targets), then citizens.
    let hoveredDistrict: string | null = null;
    for (const d of DISTRICTS) {
      const x = cx + d.ox, y = cy + d.oy;
      if (mx > x - d.w - 12 && mx < x + d.w + 12 && my > y - d.h - d.d * 2 - 34 && my < y + 14) {
        hoveredDistrict = d.id; break;
      }
    }
    const sprite = spriteAt(w.sprites, cx, cy, mx, my, 16);
    w.hoveredDistrict = hoveredDistrict;
    w.hoveredSprite = sprite?.id ?? null;
    canvas.style.cursor = hoveredDistrict || sprite ? "pointer" : "default";

    // Build tooltip (citizen takes priority since it's the finer target).
    let info: HoverInfo | null = null;
    let key = "";
    if (sprite) {
      const c = sprite.citizen;
      key = `c:${c.id}:${Math.round(mx / 3)}:${Math.round(my / 3)}`;
      info = {
        title: `${c.emoji} ${c.name}`,
        subtitle: c.busy ? "Working" : sprite.state === "walking" ? "On the move" : "Idle",
        lines: [
          c.role + (c.kind !== "agent" ? ` · ${c.kind}` : ""),
          c.task ? `“${c.task}”` : "",
          c.model ? c.model.split("/").pop()! : "",
        ].filter(Boolean),
        color: c.color,
        x: mx, y: my,
      };
    } else if (hoveredDistrict) {
      const d = DISTRICT_BY_ID[hoveredDistrict];
      const act = useCityStore.getState().snapshot.districts[d.id];
      key = `d:${d.id}:${Math.round(mx / 3)}:${Math.round(my / 3)}`;
      info = {
        title: `${d.icon} ${d.name}`,
        subtitle: d.subtitle,
        lines: [act?.active ? `Active · ${act.label}` : act?.label || "Quiet", "Click to open"],
        color: d.accent,
        x: mx, y: my,
      };
    }
    if (key !== hoverKeyRef.current) { hoverKeyRef.current = key; setHover(info); }
  }, []);

  const handleMouseLeave = useCallback(() => {
    const w = worldRef.current;
    w.hoveredDistrict = null; w.hoveredSprite = null;
    hoverKeyRef.current = "";
    setHover(null);
  }, []);

  const handleClick = useCallback(() => {
    const id = worldRef.current.hoveredDistrict;
    if (!id) return;
    const d = DISTRICT_BY_ID[id];
    if (!d) return;
    if (d.linkedCenterTab) setView(d.linkedView, { centerTab: d.linkedCenterTab });
    else setView(d.linkedView);
  }, [setView]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", background: "#0a0e22" }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ display: "block", position: "absolute", inset: 0 }}
      />
      <CityHUD hover={hover} />
    </div>
  );
}
