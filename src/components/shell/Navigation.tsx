import { useState } from "react";
import {
  Home,
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
  Map,
  ChevronDown,
  Anchor,
  BarChart3,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/appStore";

interface NavItem {
  id: AppView;
  icon: React.ElementType;
  label: string;
}

const MISSION_CONTROL: NavItem[] = [
  { id: "home",           icon: Home,            label: "Home" },
  { id: "city",           icon: Map,             label: "City" },
  { id: "conversation",   icon: MessageSquare,   label: "Chat" },
  { id: "command-center", icon: LayoutDashboard, label: "Center" },
];

const OPENCLAW: NavItem[] = [
  { id: "agents",      icon: Bot,     label: "Agents" },
  { id: "factory",     icon: Factory, label: "Forge" },
  { id: "memory",      icon: Brain,   label: "Memory" },
  { id: "models",      icon: Cpu,     label: "Models" },
  { id: "channels",    icon: Radio,   label: "Channels" },
  { id: "hooks",       icon: Anchor,  label: "Hooks" },
  { id: "tools",       icon: Wrench,  label: "Tools" },
];

const SYSTEM: NavItem[] = [
  { id: "usage",    icon: BarChart3,   label: "Usage" },
  { id: "doctor",   icon: Stethoscope, label: "Doctor" },
  { id: "settings", icon: Settings,    label: "Settings" },
];

export function Navigation() {
  const currentView = useAppStore(s => s.currentView);
  const setView = useAppStore(s => s.setView);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const serviceStatus = useAppStore(s => s.serviceStatus);
  const [mcCollapsed, setMcCollapsed] = useState(false);
  const [ocCollapsed, setOcCollapsed] = useState(false);
  const [sysCollapsed, setSysCollapsed] = useState(false);

  const svcDotColor = (s: "off" | "starting" | "ready") =>
    s === "ready" ? "var(--success)" : s === "starting" ? "var(--warning, #f59e0b)" : "rgba(255,255,255,0.12)";
  const svcDotGlow = (s: "off" | "starting" | "ready") =>
    s === "ready" ? "0 0 5px rgba(52,211,153,0.5)" : "none";

  return (
    <nav className="glass-nav" style={{
      width: 58, flexShrink: 0, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "8px 0 6px",
    }}>
      {/* Service status indicators */}
      <div title={`Gateway: ${serviceStatus.gateway}\nvLLM: ${serviceStatus.vllm}\nVoice: ${serviceStatus.voice}`}
        style={{
        marginBottom: 8, display: "flex", flexDirection: "column",
        alignItems: "center", gap: 3, padding: "2px 0",
      }}>
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {(["gateway", "vllm", "voice"] as const).map(svc => (
            <div key={svc} style={{
              width: 5, height: 5, borderRadius: "50%",
              background: svcDotColor(serviceStatus[svc]),
              boxShadow: svcDotGlow(serviceStatus[svc]),
              transition: "all 0.4s ease",
              animation: serviceStatus[svc] === "starting" ? "pulse-dot 1.5s infinite" : undefined,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 7, color: "var(--text-muted)", letterSpacing: 0.8, fontWeight: 600 }}>
          {gatewayConnected ? "LIVE" : "BOOT"}
        </span>
      </div>

      {/* Mission Control – collapsible */}
      <SectionToggle label="MISSION" collapsed={mcCollapsed} onToggle={() => setMcCollapsed(!mcCollapsed)} />
      {!mcCollapsed && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          {MISSION_CONTROL.map(item => (
            <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
          ))}
        </div>
      )}

      <Divider />

      {/* OpenClaw section – collapsible */}
      <SectionToggle label="CLAW" collapsed={ocCollapsed} onToggle={() => setOcCollapsed(!ocCollapsed)} />
      {!ocCollapsed && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          {OPENCLAW.map(item => (
            <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <Divider />

      {/* System – collapsible, pinned to bottom */}
      <SectionToggle label="SYSTEM" collapsed={sysCollapsed} onToggle={() => setSysCollapsed(!sysCollapsed)} />
      {!sysCollapsed && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          {SYSTEM.map(item => (
            <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
          ))}
        </div>
      )}

      {/* Ctrl+K launcher */}
      <button
        type="button"
        className="glass-cmd-chip"
        style={{
          marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center",
          width: 34, height: 22, borderRadius: 6,
          cursor: "pointer", transition: "all 0.15s",
          background: "transparent", border: "1px solid var(--border-subtle)",
          padding: 0,
        }}
        title="Command Palette (Ctrl+K)"
        aria-label="Open Command Palette"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
      >
        <Command style={{ width: 9, height: 9, color: "var(--text-muted)" }} aria-hidden="true" />
      </button>
    </nav>
  );
}

function SectionToggle({ label, collapsed, onToggle }: { label: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      style={{
        width: 42, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
        gap: 2, border: "none", cursor: "pointer", background: "transparent",
        color: "var(--text-muted)", fontSize: 7, fontWeight: 600,
        letterSpacing: 0.6, marginBottom: 2,
      }}
    >
      <ChevronDown style={{
        width: 8, height: 8, transition: "transform 0.2s",
        transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
      }} />
      {label}
    </button>
  );
}

function Divider() {
  return <div className="glass-nav-divider" style={{ width: 20, height: 1, margin: "5px 0", flexShrink: 0 }} />;
}

function NavButton({ item, active, onClick }: {
  item: NavItem; active: boolean; onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={item.label}
      className={active ? "nav-btn-active" : undefined}
      style={{
        width: 42, height: 38, borderRadius: 10, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 2, border: "none", cursor: "pointer",
        position: "relative", flexShrink: 0, margin: "1px 0",
        background: active ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-muted)",
        boxShadow: active ? "inset 0 1px 0 color-mix(in srgb, #fff 10%, transparent)" : "none",
        transition: "all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={e => {
        if (!active) {
          e.currentTarget.style.background = "var(--bg-hover)";
          e.currentTarget.style.color = "var(--text-secondary)";
        }
      }}
      onMouseLeave={e => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }
      }}
    >
      {active && (
        <div style={{
          position: "absolute", left: -1, top: "50%", transform: "translateY(-50%)",
          width: 3, height: 18, borderRadius: "0 4px 4px 0",
          background: "var(--accent)",
          transition: "all 0.2s ease",
        }} />
      )}
      <Icon style={{ width: 15, height: 15 }} />
      <span style={{ fontSize: 7.5, fontWeight: active ? 600 : 500, lineHeight: 1, letterSpacing: "-0.01em" }}>{item.label}</span>
    </button>
  );
}
