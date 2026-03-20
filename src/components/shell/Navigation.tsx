import {
  Home,
  MessageSquare,
  LayoutDashboard,
  Bot,
  Building2,
  Factory,
  Store,
  Cpu,
  Radio,
  Brain,
  Wrench,
  Activity,
  Settings,
  Anchor,
  Shield,
  Stethoscope,
  Command,
  FolderOpen,
  Mail,
  Users,
  GitBranch,
  Terminal,
  Smartphone,
  Webhook,
  Phone,
} from "lucide-react";
import { useAppStore, AppView } from "@/stores/appStore";

const navItems: { id: AppView; icon: React.ElementType; label: string; group: "main" | "openclaw" | "system" }[] = [
  { id: "home",           icon: Home,            label: "Home",     group: "main" },
  { id: "conversation",   icon: MessageSquare,   label: "Chat",     group: "main" },
  { id: "command-center", icon: LayoutDashboard,  label: "Center",   group: "main" },
  { id: "agents",         icon: Bot,             label: "Agents",   group: "openclaw" },
  { id: "factory",        icon: Factory,         label: "Factory",  group: "openclaw" },
  { id: "office",         icon: Building2,       label: "Office",   group: "openclaw" },
  { id: "marketplace",    icon: Store,           label: "Skills",   group: "openclaw" },
  { id: "models",         icon: Cpu,             label: "Models",   group: "openclaw" },
  { id: "channels",       icon: Radio,           label: "Channels", group: "openclaw" },
  { id: "memory",         icon: Brain,           label: "Memory",   group: "openclaw" },
  { id: "hooks",          icon: Anchor,          label: "Hooks",    group: "openclaw" },
  { id: "workspace",      icon: FolderOpen,      label: "Workspace", group: "openclaw" },
  { id: "messaging",      icon: Mail,            label: "Messaging", group: "openclaw" },
  { id: "directory",      icon: Users,           label: "Directory", group: "openclaw" },
  { id: "subagents",      icon: GitBranch,       label: "Sub-Agents", group: "openclaw" },
  { id: "acp",            icon: Terminal,        label: "ACP",       group: "openclaw" },
  { id: "tools",        icon: Wrench,        label: "Tools",     group: "system" },
  { id: "security",     icon: Shield,        label: "Security",  group: "system" },
  { id: "doctor",       icon: Stethoscope,   label: "Doctor",    group: "system" },
  { id: "activity",     icon: Activity,      label: "Activity",  group: "system" },
  { id: "settings",     icon: Settings,      label: "Settings",  group: "system" },
  { id: "devices",       icon: Smartphone,    label: "Devices",   group: "system" },
  { id: "webhooks",      icon: Webhook,       label: "Webhooks",  group: "system" },
  { id: "voicecall",     icon: Phone,         label: "Voice",     group: "system" },
];

export function Navigation() {
  const currentView = useAppStore(s => s.currentView);
  const setView = useAppStore(s => s.setView);
  const gatewayConnected = useAppStore(s => s.gatewayConnected);

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

      {navItems.filter(n => n.group === "main").map(item => (
        <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
      ))}

      <Divider />

      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        overflowY: "auto", overflowX: "hidden", width: "100%",
        scrollbarWidth: "none",
      }}>
        <style>{`.nav-scroll::-webkit-scrollbar { display: none; }`}</style>
        <div className="nav-scroll" style={{
          display: "flex", flexDirection: "column", alignItems: "center", width: "100%",
        }}>
          {navItems.filter(n => n.group === "openclaw").map(item => (
            <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
          ))}
        </div>
      </div>

      <Divider />

      {navItems.filter(n => n.group === "system").map(item => (
        <NavButton key={item.id} item={item} active={currentView === item.id} onClick={() => setView(item.id)} />
      ))}

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
  item: typeof navItems[number]; active: boolean; onClick: () => void;
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
