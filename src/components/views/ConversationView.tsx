import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Mic, Loader2, Trash2, Terminal, ChevronDown, ChevronRight, Copy, Check, Bot, User, Plus, X, PanelLeftClose, PanelLeft, MessageSquare, Zap, Settings2, Shield, Puzzle, Stethoscope, Play, Search, RefreshCw, Download, Globe, Cpu, Brain, ArrowDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { agentService, AgentStep, ActionButton } from "@/lib/agent";
import { invoke } from "@tauri-apps/api/core";
import { Message, openclawClient } from "@/lib/openclaw";
import { useAppStore } from "@/stores/appStore";

/* ── Conversation types ── */

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface StoredConversation {
  id: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; timestamp: string }>;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "crystal_conversations";
const MAX_CONVERSATIONS = 50;

const WELCOME: Message = {
  id: "welcome",
  role: "assistant",
  content: `Hey! I'm **Crystal** — your personal AI assistant. Everything I do runs **100% locally** on your machine. Your data never leaves your PC.

Here's what I can do for you:

**🚀 Get started fast** — Just say *"set up everything"* and I'll enable all plugins, fix security, and get you ready to go.

**📁 Files & automation** — Create files, organize folders, run commands, schedule tasks.

**💬 Stay connected** — Connect Discord, Slack, Telegram, WhatsApp, Email and more.

**🧠 Smart tools** — 51 skills including weather, GitHub, Spotify, image generation, coding agents, and more.

**🔍 Navigate anywhere** — Type **/** in the input box to quickly jump to any feature, or press **Ctrl+K** to search.

Try one of the suggestions below, or just ask me anything in plain English!`,
  timestamp: new Date(),
};

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: StoredConversation[] = JSON.parse(raw);
    return parsed.map(c => ({
      ...c,
      messages: c.messages.map(m => ({ ...m, role: m.role as Message["role"], timestamp: new Date(m.timestamp) })),
    }));
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
  const serializable = trimmed.map(c => ({
    ...c,
    messages: c.messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() })),
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

function createNewConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New Chat",
    messages: [WELCOME],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function generateTitle(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return "New Chat";
  const text = firstUser.content.replace(/\n/g, " ").trim();
  return text.length > 30 ? text.slice(0, 30) + "…" : text;
}

const STARTER_SUGGESTIONS = [
  { emoji: "⚡", label: "Set up everything", text: "Set up everything for me — enable all plugins, fix security, and get me ready to go" },
  { emoji: "🔍", label: "What can you do?", text: "What can you do? Show me all your features" },
  { emoji: "📁", label: "Create a file", text: "Create a text file on my desktop called notes.txt with today's date" },
  { emoji: "🛡️", label: "Check security", text: "Run a security audit and fix any issues" },
  { emoji: "🧩", label: "Show my skills", text: "What skills do I have available? Which ones are ready to use?" },
  { emoji: "🤖", label: "Pull a model", text: "What Ollama models do I have? Show me what's running" },
  { emoji: "🌤️", label: "Get weather", text: "What's the weather like today?" },
  { emoji: "💻", label: "System info", text: "Show me my system specs — GPU, CPU, RAM" },
];

interface SlashCommand {
  cmd: string;
  label: string;
  description: string;
  action: () => void;
}


export function ConversationView() {
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const loaded = loadConversations();
    return loaded.length > 0 ? loaded : [createNewConversation()];
  });
  const [activeId, setActiveId] = useState<string>(() => {
    const loaded = loadConversations();
    return loaded.length > 0 ? loaded[0].id : conversations[0].id;
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [toolSteps, setToolSteps] = useState<AgentStep[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [micFlashRed, setMicFlashRed] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const [actionButtons, setActionButtons] = useState<ActionButton[]>([]);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);

  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const setView = useAppStore(s => s.setView);
  const backend = openclawClient.getBackend();
  const model = openclawClient.getModel();

  const slashCommands: SlashCommand[] = [
    { cmd: "/home", label: "Home", description: "Go to dashboard", action: () => setView("home") },
    { cmd: "/skills", label: "Skills", description: "Browse 51 OpenClaw skills", action: () => setView("marketplace") },
    { cmd: "/plugins", label: "Plugins", description: "Manage plugins", action: () => setView("marketplace") },
    { cmd: "/models", label: "Models", description: "Manage Ollama models", action: () => setView("models") },
    { cmd: "/settings", label: "Settings", description: "App & gateway settings", action: () => setView("settings") },
    { cmd: "/security", label: "Security", description: "Run security audit", action: () => setView("security") },
    { cmd: "/doctor", label: "Doctor", description: "System diagnostics", action: () => setView("doctor") },
    { cmd: "/agents", label: "Agents", description: "Manage AI agents", action: () => setView("agents") },
    { cmd: "/memory", label: "Memory", description: "Search agent memory", action: () => setView("memory") },
    { cmd: "/channels", label: "Channels", description: "Connect messaging apps", action: () => setView("channels") },
    { cmd: "/cron", label: "Cron", description: "Scheduled tasks", action: () => setView("cron") },
    { cmd: "/hooks", label: "Hooks", description: "Agent lifecycle hooks", action: () => setView("hooks") },
    { cmd: "/nodes", label: "Nodes", description: "Multi-node management", action: () => setView("nodes") },
    { cmd: "/browser", label: "Browser", description: "Browser automation", action: () => setView("browser") },
    { cmd: "/tools", label: "Tools", description: "Sandbox & tool permissions", action: () => setView("tools") },
    { cmd: "/activity", label: "Activity", description: "Gateway event log", action: () => setView("activity") },
    { cmd: "/templates", label: "Templates", description: "Workflow builder", action: () => setView("templates") },
    { cmd: "/powerup", label: "Power Up", description: "Enable everything", action: () => setView("marketplace") },
    { cmd: "/new", label: "New Chat", description: "Start a fresh conversation", action: () => handleNewChat() },
    { cmd: "/clear", label: "Clear", description: "Clear current chat", action: () => clearConversation() },
    { cmd: "/search", label: "Search", description: "Open command palette (Ctrl+K)", action: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })) },
  ];

  const filteredSlashCommands = slashCommands.filter(c =>
    c.cmd.startsWith(slashFilter.toLowerCase()) || c.label.toLowerCase().includes(slashFilter.slice(1).toLowerCase())
  );

  const activeConversation = conversations.find(c => c.id === activeId) || conversations[0];
  const messages = activeConversation?.messages || [WELCOME];

  const persist = useCallback((convs: Conversation[]) => {
    saveConversations(convs);
  }, []);

  const updateConversation = useCallback((id: string, updater: (c: Conversation) => Conversation) => {
    setConversations(prev => {
      const next = prev.map(c => c.id === id ? updater(c) : c);
      persist(next);
      return next;
    });
  }, [persist]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, toolSteps, scrollToBottom]);

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (text && !isLoading) {
        setInput(text);
        setTimeout(() => {
          const btn = document.querySelector("[data-send-btn]") as HTMLButtonElement;
          btn?.click();
        }, 100);
      }
    };
    window.addEventListener("crystal:voice-message", handler);
    return () => window.removeEventListener("crystal:voice-message", handler);
  }, [isLoading]);

  useEffect(() => {
    agentService.onStep((step) => {
      setToolSteps(prev => [...prev.slice(-8), step]);
    });
    agentService.onActions((actions) => setActionButtons(actions));
    return () => {};
  }, []);

  useEffect(() => {
    const unsub = openclawClient.on("tool_call", (msg) => {
      setToolSteps(prev => [...prev.slice(-8), {
        action: { type: "tool_call", tool: msg.payload.tool as string, args: msg.payload.args as Record<string, string> },
        timestamp: new Date(),
      }]);
    });
    const unsub2 = openclawClient.on("tool_result", (msg) => {
      setToolSteps(prev => [...prev.slice(-8), {
        action: { type: "tool_call", tool: msg.payload.tool as string },
        result: { success: msg.payload.exit_code === 0 || !msg.payload.exit_code, output: msg.payload.output as string || "", error: "" },
        timestamp: new Date(),
      }]);
    });
    return () => { unsub(); unsub2(); };
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleMicClick = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicFlashRed(true);
      setTimeout(() => setMicFlashRed(false), 800);
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setInput(prev => prev ? prev + " " + text : text);
      inputRef.current?.focus();
    };
    recognition.onend = () => setIsListening(false);
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;
    const text = input;
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date() };

    updateConversation(activeId, c => {
      const updated = { ...c, messages: [...c.messages, userMessage], updatedAt: Date.now() };
      if (c.title === "New Chat") updated.title = generateTitle([...c.messages, userMessage]);
      return updated;
    });

    setInput("");
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    setIsLoading(true);
    setToolSteps([]);
    setActionButtons([]);
    inputRef.current?.focus();

    const msgId = crypto.randomUUID();
    const assistantMessage: Message = { id: msgId, role: "assistant", content: "", timestamp: new Date() };
    updateConversation(activeId, c => ({
      ...c,
      messages: [...c.messages, assistantMessage],
      updatedAt: Date.now(),
    }));

    try {
      let accumulated = "";
      let lastFlush = 0;
      const FLUSH_INTERVAL = 40;
      for await (const token of agentService.streamChat(text)) {
        accumulated += token;
        const now = Date.now();
        if (now - lastFlush >= FLUSH_INTERVAL) {
          lastFlush = now;
          const snapshot = accumulated;
          updateConversation(activeId, c => ({
            ...c,
            messages: c.messages.map(m => m.id === msgId ? { ...m, content: snapshot } : m),
            updatedAt: now,
          }));
        }
      }
      const finalContent = accumulated;
      updateConversation(activeId, c => ({
        ...c,
        messages: c.messages.map(m => m.id === msgId ? { ...m, content: finalContent } : m),
        updatedAt: Date.now(),
      }));
    } catch (err) {
      updateConversation(activeId, c => ({
        ...c,
        messages: c.messages.map(m =>
          m.id === msgId
            ? { ...m, content: `**Error:** ${err instanceof Error ? err.message : "Unknown error"}\n\nMake sure Ollama is running.` }
            : m
        ),
        updatedAt: Date.now(),
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewChat = () => {
    const newConv = createNewConversation();
    setConversations(prev => {
      const next = [newConv, ...prev].slice(0, MAX_CONVERSATIONS);
      persist(next);
      return next;
    });
    setActiveId(newConv.id);
    agentService.clearHistory();
    setToolSteps([]);
  };

  const handleActionButton = useCallback(async (btn: ActionButton) => {
    switch (btn.action) {
      case "navigate":
        if (btn.args?.view) setView(btn.args.view as any);
        break;
      case "enable_plugin":
        if (btn.args?.id) {
          await invoke("execute_command", {
            command: `npx openclaw plugins enable ${btn.args.id}`,
            cwd: null,
          });
        }
        break;
      case "run_command":
        if (btn.args?.command) {
          await invoke("execute_command", {
            command: btn.args.command,
            cwd: null,
          });
        }
        break;
      case "power_up":
        setView("marketplace" as any);
        break;
      case "new_chat":
        handleNewChat();
        break;
      case "search":
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
        break;
      case "copy":
        if (btn.args?.text) navigator.clipboard.writeText(btn.args.text);
        break;
    }
    setActionButtons([]);
  }, [handleNewChat, setView]);

  const handleDeleteConversation = (id: string) => {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) {
        const fresh = createNewConversation();
        next.push(fresh);
        setActiveId(fresh.id);
      } else if (id === activeId) {
        setActiveId(next[0].id);
      }
      persist(next);
      return next;
    });
    if (id === activeId) {
      agentService.clearHistory();
      setToolSteps([]);
    }
  };

  const handleSelectConversation = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    agentService.clearHistory();
    setToolSteps([]);
  };

  const handleStartRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditTitle(currentTitle);
  };

  const handleFinishRename = () => {
    if (editingId && editTitle.trim()) {
      updateConversation(editingId, c => ({ ...c, title: editTitle.trim() }));
    }
    setEditingId(null);
    setEditTitle("");
  };

  const clearConversation = () => {
    updateConversation(activeId, c => ({
      ...c,
      messages: [WELCOME],
      title: "New Chat",
      updatedAt: Date.now(),
    }));
    agentService.clearHistory();
    setToolSteps([]);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const getLastPreview = (conv: Conversation) => {
    const last = [...conv.messages].reverse().find(m => m.role !== "system" && m.id !== "welcome");
    if (!last) return "No messages yet";
    const text = last.content.replace(/[*#_`\n]/g, " ").trim();
    return text.length > 40 ? text.slice(0, 40) + "…" : text;
  };

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Sidebar */}
      <div style={{
        width: sidebarOpen ? 220 : 0,
        minWidth: sidebarOpen ? 220 : 0,
        overflow: "hidden",
        transition: "width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1)",
        borderRight: sidebarOpen ? "1px solid var(--border)" : "none",
        background: "var(--bg-surface)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>
        {/* New Chat button */}
        <div style={{ padding: "10px 10px 6px", flexShrink: 0 }}>
          <button
            onClick={handleNewChat}
            style={{
              width: "100%",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)",
              background: "var(--bg-elevated)", color: "var(--text-secondary)",
              fontSize: 12, fontWeight: 500, cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "var(--accent-bg)";
              e.currentTarget.style.borderColor = "rgba(59,130,246,0.25)";
              e.currentTarget.style.color = "var(--accent-hover)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "var(--bg-elevated)";
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <Plus style={{ width: 14, height: 14 }} />
            New Chat
          </button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
          {conversations.map(conv => {
            const isActive = conv.id === activeId;
            const isHovered = conv.id === hoveredId;
            const isEditing = conv.id === editingId;
            return (
              <div
                key={conv.id}
                onClick={() => !isEditing && handleSelectConversation(conv.id)}
                onDoubleClick={() => handleStartRename(conv.id, conv.title)}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  marginBottom: 2,
                  position: "relative",
                  transition: "background 0.15s",
                  background: isActive
                    ? "var(--accent-bg)"
                    : isHovered
                      ? "var(--bg-elevated)"
                      : "transparent",
                  borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <MessageSquare style={{
                    width: 12, height: 12, flexShrink: 0,
                    color: isActive ? "var(--accent-hover)" : "var(--text-muted)",
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        value={editTitle}
                        onChange={e => setEditTitle(e.target.value)}
                        onBlur={handleFinishRename}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleFinishRename();
                          if (e.key === "Escape") { setEditingId(null); setEditTitle(""); }
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{
                          width: "100%", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(59,130,246,0.3)",
                          borderRadius: 4, padding: "1px 4px", fontSize: 11, color: "var(--text)", outline: "none",
                          fontFamily: "inherit",
                        }}
                      />
                    ) : (
                      <div style={{
                        fontSize: 11, fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--text)" : "var(--text-secondary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {conv.title}
                      </div>
                    )}
                    <div style={{
                      fontSize: 9, color: "var(--text-muted)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      marginTop: 2,
                    }}>
                      {getLastPreview(conv)}
                    </div>
                  </div>

                  {/* Timestamp + delete */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 8, color: "var(--text-muted)" }}>{formatTime(conv.updatedAt)}</span>
                    {(isHovered || isActive) && conversations.length > 1 && (
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteConversation(conv.id); }}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: 2,
                          borderRadius: 4, display: "flex", alignItems: "center",
                          transition: "background 0.1s",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.15)"}
                        onMouseLeave={e => e.currentTarget.style.background = "none"}
                      >
                        <X style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
        {/* Header */}
        <div style={{
          padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-surface)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 4,
                display: "flex", alignItems: "center",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
            >
              {sidebarOpen
                ? <PanelLeftClose style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
                : <PanelLeft style={{ width: 14, height: 14, color: "var(--text-muted)" }} />
              }
            </button>
            <h2 style={{ color: "var(--text)", fontSize: 14, fontWeight: 600, margin: 0 }}>
              {activeConversation?.title || "Chat"}
            </h2>
            <StatusPill connected={gatewayConnected} label={gatewayConnected ? "OpenClaw" : backend} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{model}</span>
            <button onClick={clearConversation} title="Clear chat" style={{
              background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 4,
              display: "flex", alignItems: "center",
            }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
              onMouseLeave={e => e.currentTarget.style.background = "none"}
            >
              <Trash2 style={{ width: 13, height: 13, color: "var(--text-muted)" }} />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={messagesContainerRef}
          onScroll={e => {
            const el = e.currentTarget;
            const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setShowScrollTop(distanceFromBottom > 200);
          }}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "20px 20px 12px", position: "relative" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} message={msg} isLatest={i === messages.length - 1 && msg.role === "assistant"} />
            ))}

            {messages.length === 1 && messages[0].id === "welcome" && !isLoading && (
              <div style={{
                display: "flex", flexDirection: "column", gap: 8, marginTop: 8, marginLeft: 38,
              }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 2 }}>
                  Try asking
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {STARTER_SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setInput(s.text); inputRef.current?.focus(); }}
                      style={{
                        padding: "6px 12px", borderRadius: 8,
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        color: "var(--text-secondary)",
                        fontSize: 11, cursor: "pointer",
                        transition: "all 0.15s",
                        display: "flex", alignItems: "center", gap: 5,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = "var(--accent-bg)";
                        e.currentTarget.style.borderColor = "rgba(59,130,246,0.2)";
                        e.currentTarget.style.color = "var(--accent-hover)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = "var(--bg-elevated)";
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      }}
                    >
                      <span>{s.emoji}</span> {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {actionButtons.length > 0 && !isLoading && (
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 8, marginLeft: 38, marginTop: 4,
                animation: "view-fade-in 0.2s ease-out",
              }}>
                {actionButtons.map((btn) => (
                  <button
                    key={btn.id}
                    onClick={() => handleActionButton(btn)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "6px 14px", borderRadius: 8,
                      background: "var(--accent-bg)",
                      border: "1px solid rgba(59,130,246,0.2)",
                      color: "var(--accent-hover)", fontSize: 12, fontWeight: 500,
                      cursor: "pointer", transition: "all 0.15s",
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = "rgba(59,130,246,0.2)";
                      e.currentTarget.style.borderColor = "rgba(59,130,246,0.4)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = "var(--accent-bg)";
                      e.currentTarget.style.borderColor = "rgba(59,130,246,0.2)";
                    }}
                  >
                    <ActionIcon name={btn.icon} />
                    {btn.label}
                  </button>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="animate-msg-in" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {toolSteps.filter(s => s.action.type === "tool_call").map((step, i) => (
                  <ToolCallBubble key={i} step={step} />
                ))}
                <ThinkingIndicator hasTools={toolSteps.length > 0} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {showScrollTop && (
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
              style={{
                position: "sticky", bottom: 12, left: "50%", transform: "translateX(-50%)",
                display: "flex", alignItems: "center", gap: 4,
                padding: "6px 14px", borderRadius: 20,
                background: "var(--accent)", color: "var(--chat-user-text)",
                border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 500,
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                transition: "all 0.2s",
                zIndex: 10,
              }}
            >
              <ArrowDown style={{ width: 12, height: 12 }} />
              Scroll to latest
            </button>
          )}
        </div>

        {/* Input */}
        <div style={{
          padding: "10px 16px 12px", flexShrink: 0,
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
        }}>
          <div style={{
            display: "flex", alignItems: "flex-end", gap: 6,
            background: "var(--bg-elevated)", border: "1px solid var(--border)",
            borderRadius: 14, padding: "4px 4px 4px 14px",
            transition: "border-color 0.2s ease, box-shadow 0.2s ease",
          }}
            onFocus={e => {
              e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.06)";
            }}
            onBlur={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.boxShadow = "none";
              }
            }}
          >
            <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => {
                  const v = e.target.value;
                  setInput(v);
                  if (v.startsWith("/") && v.length >= 1) {
                    setShowSlashMenu(true);
                    setSlashFilter(v);
                    setSlashIndex(0);
                  } else {
                    setShowSlashMenu(false);
                  }
                }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = Math.min(el.scrollHeight, 120) + "px";
                }}
                onKeyDown={e => {
                  if (showSlashMenu) {
                    if (e.key === "ArrowDown") { e.preventDefault(); setSlashIndex(i => Math.min(i + 1, filteredSlashCommands.length - 1)); return; }
                    if (e.key === "ArrowUp") { e.preventDefault(); setSlashIndex(i => Math.max(i - 1, 0)); return; }
                    if (e.key === "Enter" || e.key === "Tab") {
                      e.preventDefault();
                      const cmd = filteredSlashCommands[slashIndex];
                      if (cmd) { cmd.action(); setInput(""); setShowSlashMenu(false); }
                      return;
                    }
                    if (e.key === "Escape") { setShowSlashMenu(false); return; }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                onBlur={() => setTimeout(() => setShowSlashMenu(false), 150)}
                placeholder="Ask anything… or type / for commands"
                disabled={isLoading}
                style={{
                  width: "100%", padding: "6px 0",
                  background: "transparent", border: "none",
                  color: "var(--text)", fontSize: 13, outline: "none",
                  opacity: isLoading ? 0.5 : 1,
                  resize: "none", maxHeight: 120, overflowY: "auto",
                  fontFamily: "inherit", lineHeight: 1.5,
                }}
              />
              {showSlashMenu && filteredSlashCommands.length > 0 && (
                <div style={{
                  position: "absolute", bottom: "calc(100% + 8px)", left: 0, right: 0,
                  background: "var(--bg-surface)", border: "1px solid var(--border)",
                  borderRadius: 10, padding: 4, maxHeight: 260, overflowY: "auto",
                  boxShadow: "0 -8px 32px rgba(0,0,0,0.5)", zIndex: 100,
                  backdropFilter: "blur(12px)",
                }}>
                  <div style={{ padding: "4px 8px 6px", fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8 }}>
                    Commands
                  </div>
                  {filteredSlashCommands.map((cmd, i) => (
                    <div
                      key={cmd.cmd}
                      onMouseDown={e => { e.preventDefault(); cmd.action(); setInput(""); setShowSlashMenu(false); }}
                      onMouseEnter={() => setSlashIndex(i)}
                      style={{
                        padding: "7px 10px", borderRadius: 6, cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 10,
                        background: i === slashIndex ? "var(--accent-bg)" : "transparent",
                        transition: "background 0.1s",
                      }}
                    >
                      <span style={{
                        fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                        color: i === slashIndex ? "var(--accent-hover)" : "var(--text-secondary)",
                        fontWeight: 600, minWidth: 72,
                      }}>
                        {cmd.cmd}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{cmd.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handleMicClick}
              style={{
                padding: 6, borderRadius: 8, border: "none", cursor: "pointer", flexShrink: 0,
                display: "flex", alignItems: "center",
                background: isListening
                  ? "rgba(59,130,246,0.2)"
                  : "var(--bg-elevated)",
                boxShadow: isListening
                  ? "0 0 12px rgba(59,130,246,0.4)"
                  : "none",
                animation: isListening
                  ? "mic-pulse 1.5s ease-in-out infinite"
                  : "none",
                transition: "all 0.2s",
              }}
            >
              <Mic style={{
                width: 15, height: 15,
                color: micFlashRed
                  ? "var(--error)"
                  : isListening
                    ? "var(--accent-hover)"
                    : "var(--text-muted)",
                transition: "color 0.2s",
              }} />
            </button>
            <button
              data-send-btn
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              style={{
                padding: 8, borderRadius: 8, flexShrink: 0, border: "none", cursor: "pointer",
                background: input.trim() && !isLoading
                  ? "var(--chat-user)"
                  : "var(--bg-elevated)",
                color: input.trim() && !isLoading ? "var(--chat-user-text)" : "var(--text-muted)",
                display: "flex", alignItems: "center",
                transition: "all 0.2s",
              }}
            >
              <Send style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Status pill ── */
function StatusPill({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span style={{
      fontSize: 9, padding: "2px 8px", borderRadius: 10, fontWeight: 500, letterSpacing: 0.3,
      display: "inline-flex", alignItems: "center", gap: 4,
      background: connected ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.05)",
      color: connected ? "var(--success)" : "var(--text-muted)",
      border: `1px solid ${connected ? "rgba(74,222,128,0.15)" : "var(--border)"}`,
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: connected ? "var(--success)" : "var(--text-muted)",
        boxShadow: connected ? "0 0 4px var(--success)" : "none",
      }} />
      {label}
    </span>
  );
}

/* ── Message bubble ── */
function MessageBubble({ message, isLatest }: { message: Message; isLatest: boolean }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="animate-msg-in" style={{
      display: "flex", gap: 10,
      flexDirection: isUser ? "row-reverse" : "row",
      alignItems: "flex-start",
    }}>
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: 10, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isUser
          ? "var(--chat-user)"
          : "var(--bg-elevated)",
        border: isUser ? "none" : "1px solid var(--border)",
        boxShadow: "var(--shadow-sm)",
      }}>
        {isUser
          ? <User style={{ width: 14, height: 14, color: "var(--chat-user-text)" }} />
          : <Bot style={{ width: 14, height: 14, color: "var(--accent)" }} />
        }
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: "80%", borderRadius: 14, padding: isUser ? "10px 14px" : "12px 16px",
          position: "relative",
          background: isUser
            ? "var(--chat-user)"
            : "var(--chat-assistant)",
          border: isUser ? "none" : "1px solid var(--chat-assistant-border)",
          boxShadow: isUser ? "0 1px 4px rgba(0,0,0,0.15)" : "none",
        }}
        onMouseEnter={e => {
          const btn = e.currentTarget.querySelector("[data-copy]") as HTMLElement;
          if (btn) btn.style.opacity = "1";
        }}
        onMouseLeave={e => {
          const btn = e.currentTarget.querySelector("[data-copy]") as HTMLElement;
          if (btn) btn.style.opacity = "0";
        }}
      >
        {/* Copy button */}
        {!isUser && message.id !== "welcome" && (
          <button
            data-copy
            onClick={handleCopy}
            style={{
              position: "absolute", top: 6, right: 6, padding: 4, borderRadius: 5,
              background: "rgba(255,255,255,0.08)", border: "none", cursor: "pointer",
              opacity: 0, transition: "opacity 0.15s", display: "flex", alignItems: "center",
              zIndex: 2,
            }}
          >
            {copied
              ? <Check style={{ width: 11, height: 11, color: "var(--success)" }} />
              : <Copy style={{ width: 11, height: 11, color: "var(--text-secondary)" }} />
            }
          </button>
        )}

        {isUser ? (
          <div style={{ fontSize: 13, color: "var(--chat-user-text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {message.content}
          </div>
        ) : (
          <div className={`md-content ${isLatest ? "animate-fade-in" : ""}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                pre: ({ children }) => <pre>{children}</pre>,
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.includes("language-");
                  if (isBlock) {
                    const lang = className?.replace("language-", "") || "";
                    return (
                      <div style={{ position: "relative" }}>
                        {lang && (
                          <div style={{
                            padding: "4px 10px", fontSize: 10, fontWeight: 500,
                            color: "var(--text-muted)", background: "var(--bg-elevated)",
                            borderBottom: "1px solid var(--border)",
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                          }}>
                            <span>{lang}</span>
                            <CopyButton text={String(children).replace(/\n$/, "")} />
                          </div>
                        )}
                        <code className={className} {...props}>{children}</code>
                      </div>
                    );
                  }
                  return <code className={className} {...props}>{children}</code>;
                },
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Timestamp */}
        <div style={{
          fontSize: 9, color: isUser ? "rgba(255,255,255,0.5)" : "var(--text-muted)",
          marginTop: 4, textAlign: isUser ? "right" : "left",
        }}>
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
    </div>
  );
}

/* ── Copy button for code blocks ── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 2,
        display: "flex", alignItems: "center", gap: 3,
        color: copied ? "var(--success)" : "var(--text-muted)",
        fontSize: 9,
      }}
    >
      {copied ? <Check style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/* ── Thinking indicator ── */
function ThinkingIndicator({ hasTools }: { hasTools: boolean }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
        border: "1px solid var(--border)",
      }}>
        <Loader2 style={{ width: 14, height: 14, color: "var(--accent)" }} className="animate-spin" />
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
        borderRadius: 12, background: "var(--chat-assistant)",
        border: "1px solid var(--chat-assistant-border)",
      }}>
        <div style={{ display: "flex", gap: 4 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{
              width: 6, height: 6, borderRadius: "50%", background: "var(--accent)",
              animation: `thinking-dot 1.4s ease-in-out ${i * 0.2}s infinite`,
            }} />
          ))}
        </div>
        <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>
          {hasTools ? "Working..." : "Thinking..."}
        </span>
      </div>
    </div>
  );
}

/* ── Tool call bubble ── */
function ToolCallBubble({ step }: { step: AgentStep }) {
  const [expanded, setExpanded] = useState(false);
  const isDone = !!step.result;
  const success = step.result?.success;

  return (
    <div className="animate-msg-in" style={{ marginLeft: 38 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
          borderRadius: 8, cursor: "pointer", border: "none",
          background: "rgba(139,92,246,0.06)",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(139,92,246,0.12)"}
        onMouseLeave={e => e.currentTarget.style.background = "rgba(139,92,246,0.06)"}
      >
        {expanded
          ? <ChevronDown style={{ width: 10, height: 10, color: "var(--accent)" }} />
          : <ChevronRight style={{ width: 10, height: 10, color: "var(--accent)" }} />
        }
        <Terminal style={{ width: 11, height: 11, color: "var(--accent)" }} />
        <span style={{ fontSize: 11, color: "var(--accent-hover)", fontFamily: "'JetBrains Mono', monospace" }}>{step.action.tool}</span>
        {isDone && (
          <span style={{
            fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 4,
            background: success ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
            color: success ? "var(--success)" : "var(--error)",
          }}>
            {success ? "done" : "error"}
          </span>
        )}
      </button>
      {expanded && step.result && (
        <div style={{
          marginTop: 4, padding: "8px 12px", borderRadius: 8,
          background: "var(--bg-surface)", border: "1px solid var(--border)",
          fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "var(--text-secondary)",
          maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap",
        }}>
          {step.result.output?.slice(0, 500) || step.result.error}
        </div>
      )}
    </div>
  );
}

/* ── Action icon mapper ── */
function ActionIcon({ name }: { name: string }) {
  const size = { width: 13, height: 13 };
  switch (name) {
    case "zap": return <Zap style={size} />;
    case "settings": return <Settings2 style={size} />;
    case "shield": return <Shield style={size} />;
    case "puzzle": return <Puzzle style={size} />;
    case "stethoscope": return <Stethoscope style={size} />;
    case "play": return <Play style={size} />;
    case "search": return <Search style={size} />;
    case "plus": return <Plus style={size} />;
    case "refresh": return <RefreshCw style={size} />;
    case "download": return <Download style={size} />;
    case "terminal": return <Terminal style={size} />;
    case "globe": return <Globe style={size} />;
    case "cpu": return <Cpu style={size} />;
    case "brain": return <Brain style={size} />;
    case "mic": return <Mic style={size} />;
    default: return <Zap style={size} />;
  }
}
