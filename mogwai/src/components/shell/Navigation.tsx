import { useState } from "react";
import {
  Home,
  MessageSquare,
  LayoutDashboard,
  Bot,
  Factory,
  Building2,
  Radio,
  Brain,
  Cpu,
  Clock,
  Wrench,
  Stethoscope,
  Settings,
  Command,
  Map,
  ChevronDown,
  Anchor,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/appStore";

interface NavItem {
  id: AppView;
  icon: React.ElementType;
  label: string;
}

const PRIMARY: NavItem[] = [
  { id: "home",           icon: Home,            label: "Home" },
  { id: "city",           icon: Map,             label: "City" },
  { id: "conversation",   icon: MessageSquare,   label: "Chat" },
  { id: "command-center", icon: LayoutDashboard,  label: "Center" },
];

const OPENCLAW: NavItem[] = [
  { id: "agents",   icon: Bot,       label: "Agents" },
  { id: "factory",  icon: Factory,   label: "Forge" },
  { id: "office",   icon: Building2, label: "Office" },
  { id: "channels", icon: Radio,     label: "Channels" },
  { id: "memory",   icon: Brain,     label: "Memory" },
  { id: "models",   icon: Cpu,       label: "Models" },
  { id: "cron",     icon: Clock,     label: "Cron" },
  { id: "hooks",    icon: Anchor,    label: "Hooks" },
];

const SYSTEM: NavItem[] = [
  { id: "tools",    icon: Wrench,      label: "Tools" },
  { id: "doctor",   icon: Stethoscope, label: "Doctor" },
  { id: "settings", icon: Settings,    label: "Settings" },
];

export function Navigation() {
  const currentView = useAppStore(s => s.currentView);
  const setView = useAppStore(s => s.setView);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const [ocCollapsed, setOcCollapsed] = useState(false);

  return (
    <nav style={{
      width: 58, flexShrink: 0, display: "flex", flexDirection: "column",
      alignItems: "center", padding: "8px 0 6px",
      borderRight: "1px solid var(--border-subtle)",
      background: "var(--bg-surface)",
    }}>
      {/* Gateway indicator */}
      <div style={{
        marginBottom: 8, display: "flex", flexDirection: "column",
        alignItems: "center", gap: 3, padding: "2px 0",
      }}>
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: gatewayConnected ? "var(--success)" : "rgba(255,255,255,0.12)",
          boxShadow: gatewayConnected ? "0 0 6px rgba(52,211,153,0.5)" : "none",
          transition: "all 0.4s ease",
        }} />
        <span style={{ fontSize: 7, color: "var(--text-muted)", letterSpacing: 0.8, fontWeight: 600 }}>OC</span>
      </div>

      {/* Primary nav – always visible */}
      {PRIMARY.map(item => (
        <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
      ))}

      <Divider />

      {/* OpenClaw section – collapsible */}
      <button
        onClick={() => setOcCollapsed(!ocCollapsed)}
        title={ocCollapsed ? "Expand OpenClaw" : "Collapse OpenClaw"}
        style={{
          width: 42, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
          gap: 2, border: "none", cursor: "pointer", background: "transparent",
          color: "var(--text-muted)", fontSize: 7, fontWeight: 600,
          letterSpacing: 0.6, marginBottom: 2,
        }}
      >
        <ChevronDown style={{
          width: 8, height: 8, transition: "transform 0.2s",
          transform: ocCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
        }} />
        CLAW
      </button>

      {!ocCollapsed && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
          {OPENCLAW.map(item => (
            <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
          ))}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <Divider />

      {/* System – pinned to bottom */}
      {SYSTEM.map(item => (
        <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
      ))}

      {/* Ctrl+K launcher */}
      <div style={{
        marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center",
        width: 34, height: 22, borderRadius: 6,
        background: "var(--bg-input)", border: "1px solid var(--border-subtle)",
        cursor: "pointer", transition: "all 0.15s",
      }}
        title="Command Palette (Ctrl+K)"
        onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
      >
        <Command style={{ width: 9, height: 9, color: "var(--text-muted)" }} />
      </div>
    </nav>
  );
}

function Divider() {
  return <div style={{ width: 20, height: 1, background: "var(--border-subtle)", margin: "5px 0", flexShrink: 0 }} />;
}

function NavButton({ item, active, onClick }: {
  item: NavItem; active: boolean; onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      title={item.label}
      style={{
        width: 42, height: 38, borderRadius: 10, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 2, border: "none", cursor: "pointer",
        position: "relative", flexShrink: 0, margin: "1px 0",
        background: active ? "var(--accent-bg)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-muted)",
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
