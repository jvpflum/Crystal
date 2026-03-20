import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type AppView } from "@/stores/appStore";
import {
  Home, MessageSquare, Building2, Bot, Store, Cpu, History, Radio, Brain,
  Clock, Anchor, Wrench, Shield, Stethoscope, Activity, Settings,
  Trash2, HeartPulse, ShieldCheck, Thermometer, RotateCcw, Search,
  Network, Globe,
} from "lucide-react";

interface CommandItem {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  category: "Navigation" | "Actions" | "OpenClaw";
  action: () => void;
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const setView = useAppStore(s => s.setView);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: CommandItem[] = useMemo(() => [
    { id: "home",         icon: Home,          label: "Home",      description: "Dashboard overview",          category: "Navigation", action: () => setView("home" as AppView) },
    { id: "chat",         icon: MessageSquare, label: "Chat",      description: "Open conversation",           category: "Navigation", action: () => setView("conversation" as AppView) },
    { id: "office",       icon: Building2,     label: "Office",    description: "Sub-agent workspace",         category: "Navigation", action: () => setView("office" as AppView) },
    { id: "skills",       icon: Store,         label: "Skills",    description: "Browse skill marketplace",    category: "Navigation", action: () => setView("marketplace" as AppView) },
    { id: "models",       icon: Cpu,           label: "Models",    description: "Manage LLM models",           category: "Navigation", action: () => setView("models" as AppView) },
    { id: "sessions",     icon: History,       label: "Sessions",  description: "View chat sessions",          category: "Navigation", action: () => setView("sessions" as AppView) },
    { id: "agents",       icon: Bot,           label: "Agents",    description: "Manage AI agents",            category: "Navigation", action: () => setView("agents" as AppView) },
    { id: "channels",     icon: Radio,         label: "Channels",  description: "Communication channels",      category: "Navigation", action: () => setView("channels" as AppView) },
    { id: "memory",       icon: Brain,         label: "Memory",    description: "Knowledge & memory store",    category: "Navigation", action: () => setView("memory" as AppView) },
    { id: "cron",         icon: Clock,         label: "Cron",      description: "Scheduled tasks",             category: "Navigation", action: () => setView("cron" as AppView) },

    { id: "hooks",        icon: Anchor,        label: "Hooks",     description: "Manage hooks",                category: "Navigation", action: () => setView("hooks" as AppView) },
    { id: "tools",        icon: Wrench,        label: "Tools",     description: "Available tools",             category: "Navigation", action: () => setView("tools" as AppView) },
    { id: "security",     icon: Shield,        label: "Security",  description: "Security settings",           category: "Navigation", action: () => setView("security" as AppView) },
    { id: "doctor",       icon: Stethoscope,   label: "Doctor",    description: "System diagnostics",          category: "Navigation", action: () => setView("doctor" as AppView) },
    { id: "activity",     icon: Activity,      label: "Activity",  description: "Activity & event log",        category: "Navigation", action: () => setView("activity" as AppView) },
    { id: "settings",     icon: Settings,      label: "Settings",  description: "App preferences",             category: "Navigation", action: () => setView("settings" as AppView) },
    { id: "nodes",        icon: Network,       label: "Nodes",     description: "Manage OpenClaw nodes",       category: "Navigation", action: () => setView("nodes" as AppView) },
    { id: "browser",      icon: Globe,         label: "Browser",   description: "Browser automation",          category: "Navigation", action: () => setView("browser" as AppView) },
    { id: "clear-chat",   icon: Trash2,        label: "Clear chat",      description: "Clear current conversation",  category: "Actions", action: () => { setView("conversation" as AppView); } },
    { id: "heartbeat",    icon: HeartPulse,     label: "Heartbeat",       description: "Send heartbeat ping",         category: "Actions", action: () => invoke("execute_command", { command: "openclaw system heartbeat", cwd: null }).catch(console.error) },
    { id: "sec-audit",    icon: ShieldCheck,   label: "Security audit",  description: "Run a full security audit",   category: "Actions", action: () => setView("security" as AppView) },
    { id: "health",       icon: Thermometer,   label: "Check health",    description: "Run system health check",     category: "Actions", action: () => setView("doctor" as AppView) },
    { id: "restart-gw",   icon: RotateCcw,     label: "Restart gateway", description: "Restart OpenClaw gateway",    category: "OpenClaw", action: () => invoke("execute_command", { command: "openclaw gateway --force --port 18789", cwd: null }).catch(console.error) },
  ], [setView]);

  const fuzzyMatch = useCallback((text: string, pattern: string) => {
    const lower = text.toLowerCase();
    const p = pattern.toLowerCase();
    let pi = 0;
    for (let i = 0; i < lower.length && pi < p.length; i++) {
      if (lower[i] === p[pi]) pi++;
    }
    return pi === p.length;
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands.filter((c) => fuzzyMatch(c.label, query));
  }, [query, commands, fuzzyMatch]);

  const grouped = useMemo(() => {
    const cats: ("Navigation" | "Actions" | "OpenClaw")[] = ["Navigation", "Actions", "OpenClaw"];
    const result: { category: string; items: CommandItem[] }[] = [];
    for (const cat of cats) {
      const items = filtered.filter((c) => c.category === cat);
      if (items.length) result.push({ category: cat, items });
    }
    return result;
  }, [filtered]);

  const flatItems = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector("[data-selected='true']") as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const runSelected = useCallback(() => {
    const item = flatItems[selectedIndex];
    if (item) {
      item.action();
      onClose();
    }
  }, [flatItems, selectedIndex, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runSelected();
    } else if (e.key === "Escape") {
      onClose();
    }
  }, [flatItems.length, runSelected, onClose]);

  if (!isOpen) return null;

  let itemIndex = -1;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(8px)",
        zIndex: 1000,
        animation: "cp-overlay-in 0.15s ease-out",
      }}
    >
      <style>{`
        @keyframes cp-overlay-in { from { opacity: 0; } to { opacity: 1; } }
        @keyframes cp-modal-in { from { opacity: 0; transform: scale(0.96) translateY(-8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: 480, maxHeight: 400,
          margin: "0 auto", marginTop: 100,
          background: "rgba(15,15,22,0.98)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12, overflow: "hidden",
          display: "flex", flexDirection: "column",
          animation: "cp-modal-in 0.18s ease-out",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          <Search style={{ width: 14, height: 14, color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            style={{
              flex: 1, fontSize: 14,
              padding: "14px 0",
              background: "transparent",
              border: "none", outline: "none",
              color: "rgba(255,255,255,0.9)",
            }}
          />
          <kbd style={{
            fontSize: 10, color: "rgba(255,255,255,0.25)",
            padding: "2px 6px", borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.1)",
          }}>ESC</kbd>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {grouped.length === 0 && (
            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              No results found
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.category}>
              <div style={{
                fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                color: "rgba(255,255,255,0.3)", letterSpacing: 0.8,
                padding: "8px 16px 4px",
              }}>
                {group.category}
              </div>
              {group.items.map((item) => {
                itemIndex++;
                const idx = itemIndex;
                const isSelected = idx === selectedIndex;
                const Icon = item.icon;
                return (
                  <div
                    key={item.id}
                    data-selected={isSelected}
                    onClick={() => { item.action(); onClose(); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 16px", fontSize: 12, cursor: "pointer",
                      background: isSelected ? "rgba(59,130,246,0.12)" : "transparent",
                      transition: "background 0.1s",
                    }}
                  >
                    <Icon style={{ width: 15, height: 15, color: isSelected ? "#3B82F6" : "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: isSelected ? "#fff" : "rgba(255,255,255,0.8)", fontWeight: 500 }}>{item.label}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>{item.description}</div>
                    </div>
                    {item.category === "Navigation" && (
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>Go to</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
