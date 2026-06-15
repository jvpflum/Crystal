import { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  LayoutDashboard,
  Bot,
  Factory,
  Radio,
  Brain,
  Cpu,
  Wrench,
  Stethoscope,
  Settings,
  Command,
  Map as MapIcon,
  ChevronDown,
  Anchor,
  BarChart3,
  KanbanSquare,
  FolderKanban,
  GraduationCap,
  GitBranch,
  Server,
  FlaskConical,
  Activity,
  Shield,
  Menu as MenuIcon,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/appStore";

interface NavItem {
  id: AppView;
  icon: React.ElementType;
  label: string;
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
  /** Secondary group — tucked behind a collapsible "More" disclosure. */
  secondary?: boolean;
}

/**
 * Curated navigation model.
 *
 * Home is intentionally absent — it lives on the Crystal logo (see TitleBar).
 * The entire menu is hidden until the top-right menu button is hovered/clicked;
 * everything also stays reachable via Ctrl+K (CommandPalette).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "conversation",   icon: MessageSquare,   label: "Chat" },
      { id: "command-center", icon: LayoutDashboard, label: "Command Center" },
      { id: "city",           icon: MapIcon,         label: "City" },
      { id: "activity",       icon: Activity,        label: "Activity" },
    ],
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    items: [
      { id: "agents",   icon: Bot,     label: "Agents" },
      { id: "factory",  icon: Factory, label: "Forge" },
      { id: "memory",   icon: Brain,   label: "Memory" },
      { id: "models",   icon: Cpu,     label: "Models" },
      { id: "channels", icon: Radio,   label: "Channels" },
      { id: "hooks",    icon: Anchor,  label: "Hooks" },
      { id: "tools",    icon: Wrench,  label: "Tools & Skills" },
    ],
  },
  {
    id: "crystal-os",
    label: "Crystal Data Science Workbench",
    items: [
      { id: "board",     icon: KanbanSquare,  label: "Board" },
      { id: "projects",  icon: FolderKanban,  label: "Projects" },
      { id: "lessons",   icon: GraduationCap, label: "Lessons" },
      { id: "decisions", icon: GitBranch,     label: "Decisions" },
      { id: "targets",   icon: Server,        label: "Targets" },
      { id: "studio",    icon: FlaskConical,  label: "Studio" },
    ],
  },
  {
    id: "system",
    label: "System",
    secondary: true,
    items: [
      { id: "usage",    icon: BarChart3,   label: "Usage" },
      { id: "doctor",   icon: Stethoscope, label: "Doctor" },
      { id: "security", icon: Shield,      label: "Security" },
      { id: "settings", icon: Settings,    label: "Settings" },
    ],
  },
];

const PANEL_W = 264;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Warm the lazy route chunk on hover/focus so the click doesn't wait on the
 * chunk download. These imports mirror the `React.lazy` calls in App.tsx — the
 * browser dedupes the module fetch, so this just pulls the chunk early.
 * Highest value for `conversation` (it pulls the ~335 kB vendor-markdown chunk).
 */
const PREFETCH: Partial<Record<AppView, () => Promise<unknown>>> = {
  conversation: () => import("@/components/views/ConversationView"),
  "command-center": () => import("@/components/views/CommandCenterView"),
  city: () => import("@/components/views/CityView"),
  activity: () => import("@/components/views/ActivityView"),
  agents: () => import("@/components/views/AgentsView"),
  factory: () => import("@/components/views/FactoryView"),
  memory: () => import("@/components/views/MemoryView"),
  models: () => import("@/components/views/ModelsView"),
  channels: () => import("@/components/views/ChannelsView"),
  hooks: () => import("@/components/views/HooksView"),
  tools: () => import("@/components/views/ToolsView"),
  board: () => import("@/components/views/BoardView"),
  projects: () => import("@/components/views/ProjectsView"),
  lessons: () => import("@/components/views/LessonsView"),
  decisions: () => import("@/components/views/DecisionsView"),
  targets: () => import("@/components/views/TargetsView"),
  studio: () => import("@/components/views/StudioView"),
  usage: () => import("@/components/views/UsageView"),
  doctor: () => import("@/components/views/DoctorView"),
  security: () => import("@/components/views/SecurityView"),
  settings: () => import("@/components/views/SettingsView"),
};

const prefetched = new Set<AppView>();
function prefetchView(id: AppView) {
  if (prefetched.has(id)) return;
  prefetched.add(id);
  PREFETCH[id]?.().catch(() => prefetched.delete(id));
}

/**
 * The single navigation surface: a top-right menu button that reveals an
 * anchored overlay drawer. Hover to peek, click to pin; click-away or Esc
 * collapses it. Designed to sit in the title bar's right cluster.
 */
export function NavMenu() {
  const currentView = useAppStore(s => s.currentView);
  const setView = useAppStore(s => s.setView);

  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const open = pinned || hovered;

  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), 140);
  };
  const collapse = () => { cancelClose(); setHovered(false); setPinned(false); };

  const go = (id: AppView) => { setView(id); collapse(); };
  const openPalette = () => {
    collapse();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  };

  // Click-away (only matters while pinned) + Esc to collapse.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) collapse();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") collapse(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", display: "flex", alignItems: "center" }}
      onMouseEnter={() => { cancelClose(); setHovered(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => setPinned(p => { const next = !p; if (!next) setHovered(false); return next; })}
        title="Menu"
        aria-label="Navigation menu"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          width: 32, height: 28, borderRadius: 6, border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: open ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
          color: open ? "var(--accent)" : "var(--text-muted)",
          transition: `all 0.15s ${EASE}`,
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.color = "var(--text-muted)"; }}
      >
        <MenuIcon style={{ width: 16, height: 16 }} />
      </button>

      {open && (
        <>
          <style>{`@keyframes navmenu-in { from { opacity: 0; transform: translateY(-6px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }`}</style>
          <div
            role="menu"
            aria-label="Navigation"
            className="surface-glass"
            style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0,
              width: PANEL_W, maxHeight: "calc(100vh - 64px)",
              display: "flex", flexDirection: "column",
              borderRadius: 12, overflow: "hidden", zIndex: 1000,
              // Near-solid surface for legibility (overrides .surface-glass's ~55% alpha).
              background: "color-mix(in srgb, var(--bg-elevated) 97%, transparent)",
              backdropFilter: "blur(28px) saturate(1.4)",
              WebkitBackdropFilter: "blur(28px) saturate(1.4)",
              border: "1px solid var(--glass-border, rgba(255,255,255,0.12))",
              boxShadow: "0 20px 56px rgba(0,0,0,0.55), var(--glass-inner-light)",
              animation: `navmenu-in 0.16s ${EASE}`,
            }}
          >
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 8px 4px" }}>
              {NAV_SECTIONS.filter(s => !s.secondary).map(section => (
                <div key={section.id} style={{ marginBottom: 6 }}>
                  <SectionLabel label={section.label} />
                  {section.items.map(item => (
                    <NavRow key={item.id} item={item} active={currentView === item.id} onClick={() => go(item.id)} />
                  ))}
                </div>
              ))}

              {/* Secondary groups behind a single "More" disclosure */}
              {NAV_SECTIONS.filter(s => s.secondary).map(section => (
                <div key={section.id}>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(o => !o)}
                    aria-expanded={moreOpen}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 8px", border: "none", cursor: "pointer", background: "transparent",
                      color: "var(--text-muted)", fontSize: 9.5, fontWeight: 700,
                      letterSpacing: 0.7, textTransform: "uppercase", borderRadius: 6,
                    }}
                  >
                    <ChevronDown style={{
                      width: 11, height: 11, transition: `transform 0.2s ${EASE}`,
                      transform: moreOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    }} />
                    {section.label}
                  </button>
                  {moreOpen && section.items.map(item => (
                    <NavRow key={item.id} item={item} active={currentView === item.id} onClick={() => go(item.id)} />
                  ))}
                </div>
              ))}
            </div>

            {/* Footer: command palette + quick settings */}
            <div style={{
              flexShrink: 0, padding: "8px", display: "flex", alignItems: "center", gap: 6,
              borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
            }}>
              <button
                type="button"
                className="glass-cmd-chip"
                onClick={openPalette}
                title="Command Palette (Ctrl+K)"
                aria-label="Open Command Palette"
                style={{
                  flex: 1, display: "flex", alignItems: "center", gap: 8,
                  height: 32, borderRadius: 8, padding: "0 10px", cursor: "pointer",
                  border: "1px solid var(--border-subtle)", background: "transparent",
                  transition: `all 0.15s ${EASE}`,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
              >
                <Command style={{ width: 13, height: 13, color: "var(--text-muted)", flexShrink: 0 }} aria-hidden="true" />
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Search</span>
                <kbd style={{
                  marginLeft: "auto", fontSize: 9, color: "var(--text-muted)",
                  padding: "1px 5px", borderRadius: 4, border: "1px solid var(--border-subtle)",
                }}>⌘K</kbd>
              </button>

              <button
                type="button"
                onClick={() => go("settings")}
                title="Settings"
                aria-label="Settings"
                aria-current={currentView === "settings" ? "page" : undefined}
                style={{
                  width: 38, height: 32, borderRadius: 8, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: currentView === "settings" ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
                  color: currentView === "settings" ? "var(--accent)" : "var(--text-muted)",
                  transition: `all 0.15s ${EASE}`, flexShrink: 0,
                }}
                onMouseEnter={e => { if (currentView !== "settings") e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={e => { if (currentView !== "settings") e.currentTarget.style.background = "transparent"; }}
              >
                <Settings style={{ width: 15, height: 15 }} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{
      fontSize: 9.5, fontWeight: 700, color: "var(--text-muted)",
      letterSpacing: 0.7, textTransform: "uppercase",
      padding: "5px 8px 3px",
    }}>
      {label}
    </div>
  );
}

function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      role="menuitem"
      title={item.label}
      aria-current={active ? "page" : undefined}
      className={active ? "nav-btn-active" : undefined}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 11,
        padding: "0 10px", height: 34, borderRadius: 8, border: "none", cursor: "pointer",
        position: "relative", textAlign: "left",
        background: active ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        transition: `all 0.15s ${EASE}`,
      }}
      onFocus={() => prefetchView(item.id)}
      onMouseEnter={e => { prefetchView(item.id); if (!active) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
    >
      {active && (
        <div style={{
          position: "absolute", left: -8, top: "50%", transform: "translateY(-50%)",
          width: 3, height: 18, borderRadius: "0 4px 4px 0", background: "var(--accent)",
        }} />
      )}
      <Icon style={{ width: 16, height: 16, flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontWeight: active ? 600 : 500, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
        {item.label}
      </span>
    </button>
  );
}
