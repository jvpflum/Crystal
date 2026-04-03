import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore, type AppView } from "@/stores/appStore";
import { askCrystalAI, type AiSearchResult } from "@/lib/search-ai";
import {
  Home, MessageSquare, Building2, Bot, Store, Cpu, Radio, Brain,
  Clock, Anchor, Wrench, Shield, Stethoscope, Activity, Settings,
  Trash2, HeartPulse, ShieldCheck, Thermometer, RotateCcw, Search,
  Network, Globe, FolderOpen, Mail, Users, GitBranch,
  Smartphone, Webhook, Phone, Sparkles, Loader2, ArrowRight, ExternalLink,
} from "lucide-react";

interface CommandItem {
  id: string;
  icon: React.ElementType;
  label: string;
  description: string;
  category: "Navigation" | "Actions" | "OpenClaw" | "AI";
  action: () => void;
}

function looksLikeQuestion(q: string): boolean {
  const trimmed = q.trim().toLowerCase();
  if (trimmed.length < 5) return false;
  if (trimmed.endsWith("?")) return true;
  const starters = ["how", "what", "where", "why", "when", "which", "who", "can", "could", "should", "is", "are", "do", "does", "will", "help", "tell", "show", "explain", "find"];
  return starters.some(s => trimmed.startsWith(s + " "));
}

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const setView = useAppStore(s => s.setView);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiSearchResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isQuestion = looksLikeQuestion(query);

  const commands: CommandItem[] = useMemo(() => [
    { id: "home",         icon: Home,          label: "Home",      description: "Dashboard overview",          category: "Navigation", action: () => setView("home" as AppView) },
    { id: "chat",         icon: MessageSquare, label: "Chat",      description: "Open conversation",           category: "Navigation", action: () => setView("conversation" as AppView) },
    { id: "command-center", icon: Building2,   label: "Command Center", description: "Calendar, workflows & scheduling", category: "Navigation", action: () => setView("command-center" as AppView) },
    // Sidebar views
    { id: "agents",       icon: Bot,           label: "Agents",       description: "Agents, sessions & task dispatch",  category: "Navigation", action: () => setView("agents" as AppView) },
    { id: "models",       icon: Cpu,           label: "Models",       description: "Manage LLM models",                 category: "Navigation", action: () => setView("models" as AppView) },
    { id: "channels",     icon: Radio,         label: "Channels",     description: "Communication channels",            category: "Navigation", action: () => setView("channels" as AppView) },
    { id: "memory",       icon: Brain,         label: "Memory",       description: "Knowledge & memory store",          category: "Navigation", action: () => setView("memory" as AppView) },
    { id: "cron",         icon: Clock,         label: "Cron Jobs",    description: "Scheduled jobs & cron",             category: "Navigation", action: () => setView("cron" as AppView) },
    { id: "hooks",        icon: Anchor,        label: "Hooks",        description: "Event hooks & triggers",            category: "Navigation", action: () => setView("hooks" as AppView) },
    { id: "tools",        icon: Wrench,        label: "Tools",        description: "Available tools & sandboxes",       category: "Navigation", action: () => setView("tools" as AppView) },
    { id: "doctor",       icon: Stethoscope,   label: "Doctor",       description: "System diagnostics & health",       category: "Navigation", action: () => setView("doctor" as AppView) },
    { id: "settings",     icon: Settings,      label: "Settings",     description: "App preferences & security",        category: "Navigation", action: () => setView("settings" as AppView) },
    // Hidden views – accessible only via Ctrl+K
    { id: "skills",       icon: Store,         label: "Skills",       description: "Browse skill marketplace",          category: "Navigation", action: () => setView("marketplace" as AppView) },
    { id: "security",     icon: Shield,        label: "Security",     description: "Security settings & audit",         category: "Navigation", action: () => setView("security" as AppView) },
    { id: "activity",     icon: Activity,      label: "Activity Log", description: "Activity & event log",              category: "Navigation", action: () => setView("activity" as AppView) },
    { id: "nodes",        icon: Network,       label: "Nodes",        description: "Manage OpenClaw nodes",             category: "Navigation", action: () => setView("nodes" as AppView) },
    { id: "browser",      icon: Globe,         label: "Browser",      description: "Browser automation",                category: "Navigation", action: () => setView("browser" as AppView) },
    { id: "workspace",    icon: FolderOpen,    label: "Workspace",    description: "File workspace explorer",           category: "Navigation", action: () => setView("workspace" as AppView) },
    { id: "messaging",    icon: Mail,          label: "Messaging",    description: "Messaging & notifications",         category: "Navigation", action: () => setView("messaging" as AppView) },
    { id: "directory",    icon: Users,         label: "Directory",    description: "Contact directory",                  category: "Navigation", action: () => setView("directory" as AppView) },
    { id: "subagents",    icon: GitBranch,     label: "Sub-Agents",   description: "Sub-agents & ACP sessions",         category: "Navigation", action: () => setView("subagents" as AppView) },
    { id: "sessions",     icon: Clock,         label: "Sessions",     description: "Agent sessions history",            category: "Navigation", action: () => setView("sessions" as AppView) },
    { id: "tasks",        icon: Wrench,        label: "Tasks",        description: "Task queue & dispatch",             category: "Navigation", action: () => setView("tasks" as AppView) },
    { id: "approvals",    icon: ShieldCheck,   label: "Approvals",    description: "Pending exec approvals",            category: "Navigation", action: () => setView("approvals" as AppView) },
    { id: "devices",      icon: Smartphone,    label: "Devices",      description: "Connected devices",                 category: "Navigation", action: () => setView("devices" as AppView) },
    { id: "webhooks",     icon: Webhook,       label: "Webhooks",     description: "Webhook endpoints",                 category: "Navigation", action: () => setView("webhooks" as AppView) },
    { id: "voicecall",    icon: Phone,         label: "Voice Calls",  description: "Voice call interface",              category: "Navigation", action: () => setView("voicecall" as AppView) },
    { id: "templates",    icon: Activity,      label: "Workflows",    description: "Workflow templates",                category: "Navigation", action: () => setView("templates" as AppView) },
    { id: "clear-chat",   icon: Trash2,        label: "Clear chat",      description: "Clear current conversation",  category: "Actions", action: () => { setView("conversation" as AppView); } },
    { id: "heartbeat",    icon: HeartPulse,     label: "Heartbeat",       description: "Send heartbeat ping",         category: "Actions", action: () => invoke("execute_command", { command: "openclaw system heartbeat", cwd: null }).catch(console.error) },
    { id: "sec-audit",    icon: ShieldCheck,   label: "Security audit",  description: "Run a full security audit",   category: "Actions", action: () => setView("security" as AppView) },
    { id: "health",       icon: Thermometer,   label: "Check health",    description: "Run system health check",     category: "Actions", action: () => setView("doctor" as AppView) },
    { id: "restart-gw",   icon: RotateCcw,     label: "Restart gateway", description: "Restart OpenClaw gateway",    category: "OpenClaw", action: () => invoke("execute_command", { command: "openclaw gateway restart", cwd: null }).catch(console.error) },
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
    if (isQuestion) return [];
    return commands.filter((c) => fuzzyMatch(c.label, query) || fuzzyMatch(c.description, query));
  }, [query, commands, fuzzyMatch, isQuestion]);

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
      setAiResult(null);
      setAiError(null);
      setAiLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // AI question detection with debounce
  useEffect(() => {
    if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
    setAiResult(null);
    setAiError(null);

    if (!isQuestion || query.trim().length < 8) {
      setAiLoading(false);
      return;
    }

    setAiLoading(true);
    aiDebounceRef.current = setTimeout(async () => {
      try {
        const result = await askCrystalAI(query.trim());
        setAiResult(result);
      } catch (e) {
        setAiError(e instanceof Error ? e.message : "AI search failed");
      }
      setAiLoading(false);
    }, 800);

    return () => { if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current); };
  }, [query, isQuestion]);

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

  const navigateToView = useCallback((view: string) => {
    setView(view as AppView);
    onClose();
  }, [setView, onClose]);

  const deepDive = useCallback(() => {
    setView("conversation" as AppView);
    onClose();
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("crystal:send-to-chat", {
        detail: { context: query, surface: "command-palette" },
      }));
    }, 300);
  }, [query, setView, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isQuestion && aiResult?.suggestedView) {
        navigateToView(aiResult.suggestedView);
      } else if (!isQuestion) {
        runSelected();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  }, [flatItems.length, runSelected, onClose, isQuestion, aiResult, navigateToView]);

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
        @keyframes cp-spin { to { transform: rotate(360deg); } }
        @keyframes cp-fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={{
          width: 520, maxHeight: 500,
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
          {isQuestion ? (
            <Sparkles style={{ width: 14, height: 14, color: "#a855f7", flexShrink: 0 }} />
          ) : (
            <Search style={{ width: 14, height: 14, color: "rgba(255,255,255,0.3)", flexShrink: 0 }} />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands or ask a question..."
            style={{
              flex: 1, fontSize: 14,
              padding: "14px 0",
              background: "transparent",
              border: "none", outline: "none",
              color: "rgba(255,255,255,0.9)",
            }}
          />
          {aiLoading && (
            <Loader2 style={{ width: 14, height: 14, color: "#a855f7", animation: "cp-spin 1s linear infinite", flexShrink: 0 }} />
          )}
          <kbd style={{
            fontSize: 10, color: "rgba(255,255,255,0.25)",
            padding: "2px 6px", borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.1)",
          }}>ESC</kbd>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {/* AI Response Area */}
          {isQuestion && (aiLoading || aiResult || aiError) && (
            <div style={{ padding: "12px 16px", animation: "cp-fade-in 0.2s ease-out" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
                fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                color: "#a855f7", letterSpacing: 0.8,
              }}>
                <Sparkles style={{ width: 10, height: 10 }} />
                Crystal AI
              </div>

              {aiLoading && !aiResult && (
                <div style={{
                  padding: "12px 14px", borderRadius: 10,
                  background: "rgba(168,85,247,0.06)",
                  border: "1px solid rgba(168,85,247,0.15)",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Loader2 style={{ width: 14, height: 14, color: "#a855f7", animation: "cp-spin 1s linear infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Thinking...</span>
                </div>
              )}

              {aiError && (
                <div style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: "rgba(248,113,113,0.06)",
                  border: "1px solid rgba(248,113,113,0.15)",
                  fontSize: 11, color: "#f87171",
                }}>
                  {aiError}
                </div>
              )}

              {aiResult && (
                <div>
                  <div style={{
                    padding: "12px 14px", borderRadius: 10,
                    background: "rgba(168,85,247,0.06)",
                    border: "1px solid rgba(168,85,247,0.15)",
                    fontSize: 12, color: "rgba(255,255,255,0.8)",
                    lineHeight: 1.6, marginBottom: 8,
                  }}>
                    {aiResult.answer}
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    {aiResult.suggestedView && (
                      <button
                        onClick={() => navigateToView(aiResult.suggestedView!)}
                        style={{
                          display: "flex", alignItems: "center", gap: 6,
                          padding: "6px 14px", borderRadius: 8, border: "none",
                          background: "rgba(59,130,246,0.15)", color: "#60a5fa",
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(59,130,246,0.25)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(59,130,246,0.15)"; }}
                      >
                        <ArrowRight style={{ width: 11, height: 11 }} />
                        Go to {aiResult.suggestedView}
                      </button>
                    )}
                    <button
                      onClick={deepDive}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 14px", borderRadius: 8, border: "none",
                        background: "rgba(168,85,247,0.12)", color: "#a855f7",
                        fontSize: 11, fontWeight: 600, cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(168,85,247,0.22)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(168,85,247,0.12)"; }}
                    >
                      <ExternalLink style={{ width: 11, height: 11 }} />
                      Deep Dive in Chat
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Question mode hint */}
          {isQuestion && !aiLoading && !aiResult && !aiError && query.trim().length < 8 && (
            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              Keep typing your question...
            </div>
          )}

          {/* Regular command results */}
          {!isQuestion && grouped.length === 0 && query.trim() && (
            <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              No results found
            </div>
          )}
          {!isQuestion && grouped.map((group) => (
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

          {/* Hint when empty */}
          {!query.trim() && (
            <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", gap: 6 }}>
                <Sparkles style={{ width: 10, height: 10 }} />
                Tip: Ask a question to get AI-powered help
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
