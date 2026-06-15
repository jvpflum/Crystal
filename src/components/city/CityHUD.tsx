import { useCityStore } from "@/stores/cityStore";
import type { CSSProperties } from "react";

/* ═══════════════════════════════════════════════════════════════
   Crystal City — HUD overlay (React DOM, layered over the canvas)
   Crisp gamified stats, level/XP progression, live activity feed,
   day/night + service health, and a floating hover tooltip.
   ═══════════════════════════════════════════════════════════════ */

const glass: CSSProperties = {
  background: "rgba(14,18,38,0.62)",
  border: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  borderRadius: 14,
  boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
  color: "#eef2ff",
  pointerEvents: "none",
};

const label: CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "rgba(238,242,255,0.4)",
  fontWeight: 600,
};

const PHASE_LABEL: Record<string, string> = { dawn: "Dawn", day: "Daytime", dusk: "Dusk", night: "Night" };
const PHASE_ICON: Record<string, string> = { dawn: "🌅", day: "☀️", dusk: "🌆", night: "🌙" };

function Stat({ value, name, color }: { value: string | number; name: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 52 }}>
      <span style={{ fontSize: 17, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={label}>{name}</span>
    </div>
  );
}

export interface HoverInfo {
  title: string;
  subtitle?: string;
  lines: string[];
  color: string;
  x: number;
  y: number;
}

export function CityHUD({ hover }: { hover: HoverInfo | null }) {
  const stats = useCityStore(s => s.snapshot.stats);
  const events = useCityStore(s => s.snapshot.events);
  const dayPhase = useCityStore(s => s.snapshot.dayPhase);
  const weather = useCityStore(s => s.snapshot.weather);
  const services = useCityStore(s => s.snapshot.services);
  const usingFallback = useCityStore(s => s.snapshot.usingFallback);

  const recent = events.slice(-5).reverse();

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "-apple-system, system-ui, sans-serif" }}>
      {/* Top-left — identity + level */}
      <div style={{ ...glass, position: "absolute", top: 14, left: 14, padding: "12px 16px", minWidth: 232 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg,#6c8cff,#a78bfa)", fontWeight: 800, fontSize: 15, color: "#0b1024",
            boxShadow: "0 4px 14px rgba(108,140,255,0.5)",
          }}>{stats.level}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>Crystal City</div>
            <div style={{ fontSize: 10, color: "rgba(238,242,255,0.5)" }}>Level {stats.level} · {stats.title}</div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
            <div style={{
              width: `${Math.round(stats.levelProgress * 100)}%`, height: "100%",
              background: "linear-gradient(90deg,#6c8cff,#a78bfa,#fbbf24)", borderRadius: 4,
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 9, color: "rgba(238,242,255,0.45)" }}>{stats.xpIntoLevel} / {stats.xpForLevel} XP</span>
            <span style={{ fontSize: 9, color: "rgba(238,242,255,0.45)" }}>{stats.xp.toLocaleString()} total</span>
          </div>
        </div>
      </div>

      {/* Top-right — core stats */}
      <div style={{ ...glass, position: "absolute", top: 14, right: 14, padding: "12px 18px", display: "flex", gap: 18 }}>
        <Stat value={stats.population} name="Citizens" color="#6c8cff" />
        <Stat value={stats.working} name="Working" color="#4ade80" />
        <Stat value={`${stats.productivity}%`} name="Productivity" color="#fbbf24" />
        <Stat value={`${stats.happiness}%`} name="Happiness" color="#f472b6" />
        <Stat value={stats.tasksCompleted} name="Tasks" color="#22d3ee" />
      </div>

      {/* Bottom-left — activity feed */}
      <div style={{ ...glass, position: "absolute", bottom: 14, left: 14, padding: "10px 14px", width: 268 }}>
        <div style={{ ...label, marginBottom: 6 }}>Activity</div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 11, color: "rgba(238,242,255,0.4)" }}>The city is settling in…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {recent.map(e => (
              <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: e.color, flexShrink: 0, boxShadow: `0 0 6px ${e.color}` }} />
                <span style={{ color: "rgba(238,242,255,0.82)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom-right — environment + services */}
      <div style={{ ...glass, position: "absolute", bottom: 14, right: 14, padding: "10px 14px", minWidth: 150 }}>
        <div style={{ ...label, marginBottom: 6 }}>City Status</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11 }}>
          <Row k={`${PHASE_ICON[dayPhase]} ${PHASE_LABEL[dayPhase]}`} v={weather === "rain" ? "🌧️ Rain" : "Clear"} />
          <Row k="Gateway" v={services.gateway} dot={services.gateway === "ready" ? "#4ade80" : services.gateway === "starting" ? "#fbbf24" : "#f87171"} />
          <Row k="vLLM" v={services.vllm} dot={services.vllm === "ready" ? "#4ade80" : services.vllm === "starting" ? "#fbbf24" : "#f87171"} />
        </div>
        {usingFallback && (
          <div style={{ marginTop: 8, fontSize: 9, color: "rgba(251,191,36,0.85)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: 3, background: "#fbbf24" }} /> Demo population
          </div>
        )}
      </div>

      {/* Center-bottom hint */}
      <div style={{ position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "rgba(238,242,255,0.3)" }}>
        Click a district to open it · Hover a citizen for details
      </div>

      {/* Floating hover tooltip */}
      {hover && (
        <div style={{
          ...glass,
          position: "absolute",
          left: Math.max(8, hover.x + 14),
          top: Math.max(8, hover.y + 14),
          padding: "8px 11px",
          maxWidth: 220,
          borderTop: `2px solid ${hover.color}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#f4f7ff" }}>{hover.title}</div>
          {hover.subtitle && <div style={{ fontSize: 10, color: hover.color, marginTop: 1 }}>{hover.subtitle}</div>}
          {hover.lines.map((l, i) => (
            <div key={i} style={{ fontSize: 10, color: "rgba(238,242,255,0.6)", marginTop: 3 }}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, dot }: { k: string; v: string; dot?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "rgba(238,242,255,0.55)" }}>{k}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 5, color: "rgba(238,242,255,0.85)", textTransform: "capitalize" }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: 3, background: dot, boxShadow: `0 0 6px ${dot}` }} />}
        {v}
      </span>
    </div>
  );
}
