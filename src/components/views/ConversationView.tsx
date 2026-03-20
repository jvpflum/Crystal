import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Mic, Loader2, Trash2, Terminal, ChevronDown, ChevronRight, Copy, Check, Bot, User, Plus, X, PanelLeftClose, PanelLeft, MessageSquare, Zap, Settings2, Shield, Puzzle, Stethoscope, Play, Search, RefreshCw, Download, Globe, Cpu, Brain, ArrowDown, Volume2, Paperclip, FileText, ImageIcon, Music, Video, FileArchive, Upload, Square } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { agentService, AgentStep, ActionButton } from "@/lib/agent";
import { invoke } from "@tauri-apps/api/core";
import { Message, ChatAttachment, Surface, openclawClient } from "@/lib/openclaw";
import { useAppStore, type AppView } from "@/stores/appStore";
import { voiceService } from "@/lib/voice";

/* ── Conversation types ── */

interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface StoredConversation {
  id: string;
  sessionId?: string;
  title: string;
  messages: Array<{ id: string; role: string; content: string; timestamp: string; surface?: Surface; attachments?: Array<{ id: string; name: string; size: number; type: string }> }>;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "crystal_conversations";
const MAX_CONVERSATIONS = 50;

function getFileIcon(name: string, mimeType?: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const mime = mimeType || "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext))
    return ImageIcon;
  if (mime.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext))
    return Music;
  if (mime.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext))
    return Video;
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext))
    return FileArchive;
  return FileText;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageAttachment(att: ChatAttachment): boolean {
  const ext = att.name.split(".").pop()?.toLowerCase() || "";
  return att.type.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext);
}

function isAudioAttachment(att: ChatAttachment): boolean {
  const ext = att.name.split(".").pop()?.toLowerCase() || "";
  return att.type.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext);
}

function isVideoAttachment(att: ChatAttachment): boolean {
  const ext = att.name.split(".").pop()?.toLowerCase() || "";
  return att.type.startsWith("video/") || ["mp4", "webm", "mov"].includes(ext);
}

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
      sessionId: c.sessionId || crypto.randomUUID(),
      messages: c.messages.map(m => ({
        ...m,
        role: m.role as Message["role"],
        timestamp: new Date(m.timestamp),
        surface: m.surface as Surface | undefined,
        attachments: m.attachments?.map(a => ({ ...a, content: "" })),
      })),
    }));
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
  const serializable = trimmed.map(c => ({
    ...c,
    messages: c.messages.map(m => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
      surface: m.surface,
      attachments: m.attachments?.map(a => ({ id: a.id, name: a.name, size: a.size, type: a.type })),
    })),
  }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

function createNewConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    sessionId: crypto.randomUUID(),
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
  { emoji: "🤖", label: "Check models", text: "What models do I have configured? Show me what's available" },
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
  const abortRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [micFlashRed, setMicFlashRed] = useState(false);
  const [responseMeta, setResponseMeta] = useState<Record<string, { tokens: number; durationMs: number }>>({});

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
  const voiceTriggeredRef = useRef(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [lightboxSrc, setLightboxSrc] = useState<{ src: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const gatewayConnected = useAppStore(s => s.gatewayConnected);
  const setView = useAppStore(s => s.setView);
  const thinkingLevel = useAppStore(s => s.thinkingLevel);
  const cycleThinkingLevel = useAppStore(s => s.cycleThinkingLevel);
  const modelKey = openclawClient.getModel();
  const model = openclawClient.getModelDisplayName(modelKey);
  const [liveTps, setLiveTps] = useState(0);

  useEffect(() => {
    return openclawClient.onTps(tps => setLiveTps(Math.round(tps)));
  }, []);

  const slashCommands: SlashCommand[] = [
    { cmd: "/home", label: "Home", description: "Go to dashboard", action: () => setView("home") },
    { cmd: "/skills", label: "Skills", description: "Browse 51 OpenClaw skills", action: () => setView("marketplace") },
    { cmd: "/plugins", label: "Plugins", description: "Manage plugins", action: () => setView("marketplace") },
    { cmd: "/models", label: "Models", description: "Manage OpenClaw models", action: () => setView("models") },
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
    { cmd: "/workflows", label: "Workflows", description: "Run multi-step workflows", action: () => setView("templates") },
    { cmd: "/office", label: "Office", description: "Watch agents work visually", action: () => setView("office") },
    { cmd: "/powerup", label: "Power Up", description: "Enable everything", action: () => setView("marketplace") },
    { cmd: "/agents", label: "Agents", description: "Agent hub & task dispatch", action: () => setView("agents") },
    { cmd: "/new", label: "New Chat", description: "Start a fresh conversation", action: () => handleNewChat() },
    { cmd: "/clear", label: "Clear", description: "Clear current chat", action: () => clearConversation() },
    { cmd: "/search", label: "Search", description: "Open command palette (Ctrl+K)", action: () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true })) },
    // OpenClaw agent commands — sent as chat messages
    ...(["/status", "/compact", "/new", "/stop", "/context list", "/reasoning on", "/reasoning off"] as const).map(cmdText => ({
      cmd: cmdText,
      label: ({
        "/status": "OC Status", "/compact": "OC Compact", "/new": "OC New Session",
        "/stop": "OC Stop", "/context list": "OC Context", "/reasoning on": "OC Reasoning On", "/reasoning off": "OC Reasoning Off",
      } as Record<string, string>)[cmdText]!,
      description: ({
        "/status": "Quick diagnostics (session, model, context)",
        "/compact": "Summarize old context to free window space",
        "/new": "Reset session and start fresh",
        "/stop": "Abort current agent run",
        "/context list": "Show what's in the system prompt",
        "/reasoning on": "Show model reasoning in responses",
        "/reasoning off": "Hide model reasoning",
      } as Record<string, string>)[cmdText]!,
      action: () => {
        setTimeout(() => {
          setInput(cmdText);
          setTimeout(() => {
            const btn = document.querySelector("[data-send-btn]") as HTMLButtonElement;
            btn?.click();
          }, 50);
        }, 10);
      },
    })),
    // Commands that auto-send
    ...([
      { cmd: "/think high", label: "Think High", description: "Set thinking level to high" },
      { cmd: "/think medium", label: "Think Medium", description: "Set thinking level to medium" },
      { cmd: "/think low", label: "Think Low", description: "Set thinking level to low" },
      { cmd: "/fast on", label: "Fast On", description: "Enable fast mode (skip reasoning)" },
      { cmd: "/fast off", label: "Fast Off", description: "Disable fast mode" },
      { cmd: "/model", label: "Model Picker", description: "Show model picker / switch model" },
      { cmd: "/model list", label: "Model List", description: "List available models" },
      { cmd: "/model status", label: "Model Status", description: "Show model auth and endpoint status" },
      { cmd: "/queue", label: "Queue", description: "Show current queue settings" },
      { cmd: "/elevated on", label: "Elevated On", description: "Enable elevated execution mode" },
      { cmd: "/elevated off", label: "Elevated Off", description: "Disable elevated mode" },
      { cmd: "/export-session", label: "Export Session", description: "Export session to HTML file" },
      { cmd: "/usage tokens", label: "Usage Tokens", description: "Show per-response token counts" },
      { cmd: "/usage cost", label: "Usage Cost", description: "Show local cost summary" },
      { cmd: "/usage off", label: "Usage Off", description: "Hide usage info" },
      { cmd: "/tts on", label: "TTS On", description: "Enable text-to-speech for responses" },
      { cmd: "/tts off", label: "TTS Off", description: "Disable text-to-speech" },
      { cmd: "/verbose on", label: "Verbose On", description: "Enable verbose output (debugging)" },
      { cmd: "/verbose off", label: "Verbose Off", description: "Disable verbose output" },
      { cmd: "/config show", label: "Config Show", description: "Show current config" },
      { cmd: "/mcp show", label: "MCP Show", description: "Show MCP server config" },
      { cmd: "/plugins list", label: "Plugins List", description: "List discovered plugins" },
      { cmd: "/debug show", label: "Debug Show", description: "Show debug overrides" },
      { cmd: "/debug reset", label: "Debug Reset", description: "Reset all debug overrides" },
      { cmd: "/subagents list", label: "Subagents List", description: "List active sub-agents" },
      { cmd: "/subagents kill all", label: "Subagents Kill All", description: "Kill all sub-agents" },
      { cmd: "/acp status", label: "ACP Status", description: "Show ACP session status (also in Sub-Agents view)" },
      { cmd: "/approve allow-once", label: "Approve Once", description: "Approve exec once" },
      { cmd: "/approve allow-always", label: "Approve Always", description: "Approve exec always" },
      { cmd: "/approve deny", label: "Approve Deny", description: "Deny exec approval" },
      { cmd: "/allowlist", label: "Allowlist", description: "Show allowlist entries" },
      { cmd: "/whoami", label: "Who Am I", description: "Show sender identity" },
      { cmd: "/kill all", label: "Kill All", description: "Kill all running sub-agents" },
    ] as { cmd: string; label: string; description: string }[]).map(item => ({
      cmd: item.cmd,
      label: item.label,
      description: item.description,
      action: () => {
        setTimeout(() => {
          setInput(item.cmd);
          setTimeout(() => {
            const btn = document.querySelector("[data-send-btn]") as HTMLButtonElement;
            btn?.click();
          }, 50);
        }, 10);
      },
    })),
    // Commands that need user input appended (set prefix, do NOT auto-send)
    ...([
      { cmd: "/btw", label: "BTW", description: "Ask a side question without changing context" },
      { cmd: "/bash", label: "Bash", description: "Run a host shell command" },
    ] as { cmd: string; label: string; description: string }[]).map(item => ({
      cmd: item.cmd,
      label: item.label,
      description: item.description,
      action: () => {
        setInput(item.cmd + " ");
        inputRef.current?.focus();
      },
    })),
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

  const pendingSendRef = useRef<{ surface?: Surface; sessionId?: string } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent).detail;
      if (text && !isLoading) {
        voiceTriggeredRef.current = true;
        pendingSendRef.current = { surface: "voice" };
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
    const handler = (e: Event) => {
      const { context, followUp, surface, sessionId } = (e as CustomEvent).detail ?? {};
      if (!context) return;
      const text = followUp
        ? `${context}\n\n${followUp}`
        : context;
      pendingSendRef.current = { surface, sessionId };
      setInput(text);
      setTimeout(() => {
        const btn = document.querySelector("[data-send-btn]") as HTMLButtonElement;
        btn?.click();
      }, 150);
    };
    window.addEventListener("crystal:send-to-chat", handler);
    return () => window.removeEventListener("crystal:send-to-chat", handler);
  }, []);

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

  const handleAttachFiles = useCallback(async (files: FileList | File[]) => {
    const TEXT_EXTENSIONS = new Set([
      "txt", "md", "json", "csv", "xml", "yaml", "yml", "toml", "ini", "cfg", "conf", "log",
      "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "cs",
      "html", "css", "scss", "sass", "less", "sql", "sh", "bash", "ps1", "bat", "cmd",
      "env", "gitignore", "dockerfile", "makefile", "cmake",
      "pdf", "doc", "docx", "rtf",
    ]);
    const MEDIA_EXTENSIONS = new Set([
      "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
      "mp3", "wav", "ogg", "m4a", "flac", "aac",
      "mp4", "webm", "mov",
      "zip", "tar", "gz",
    ]);
    const MAX_FILE_SIZE = 25 * 1024 * 1024;

    const isBinary = (f: File) =>
      f.type.startsWith("image/") || f.type.startsWith("audio/") || f.type.startsWith("video/") ||
      MEDIA_EXTENSIONS.has(f.name.split(".").pop()?.toLowerCase() || "");

    const readAsDataURL = (f: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });

    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const allowed = TEXT_EXTENSIONS.has(ext) || MEDIA_EXTENSIONS.has(ext) ||
        file.type.startsWith("text/") || file.type.startsWith("image/") ||
        file.type.startsWith("audio/") || file.type.startsWith("video/");
      if (!allowed) {
        console.warn(`[Attach] Skipped unsupported file type: ${file.name}`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`[Attach] Skipped file too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }
      try {
        const content = isBinary(file) ? await readAsDataURL(file) : await file.text();
        setAttachments(prev => [...prev, {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type || ext,
          content,
        }]);
      } catch {
        console.error(`[Attach] Failed to read: ${file.name}`);
      }
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const buildMessageWithAttachments = useCallback((text: string, files: ChatAttachment[]): string => {
    if (files.length === 0) return text;
    const parts = files.map(f => {
      if (isImageAttachment(f)) {
        return `<attachment name="${f.name}" type="image" size="${formatFileSize(f.size)}">${f.content}</attachment>`;
      }
      if (isAudioAttachment(f)) {
        return `<attachment name="${f.name}" type="audio" size="${formatFileSize(f.size)}">(audio file, ${formatFileSize(f.size)})</attachment>`;
      }
      if (isVideoAttachment(f)) {
        return `<attachment name="${f.name}" type="video" size="${formatFileSize(f.size)}">(video file, ${formatFileSize(f.size)})</attachment>`;
      }
      const ext = f.name.split(".").pop() || "txt";
      return `<attachment name="${f.name}" size="${f.size}">\n\`\`\`${ext}\n${f.content}\n\`\`\`\n</attachment>`;
    });
    return `${parts.join("\n\n")}\n\n${text}`;
  }, []);

  const cancelRequest = useCallback(() => {
    abortRef.current = true;
    setIsLoading(false);
    setToolSteps([]);
  }, []);

  const sendMessage = async (overrideSurface?: Surface, overrideSessionId?: string) => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    abortRef.current = false;
    const text = input;
    const currentAttachments = [...attachments];
    const surface: Surface = overrideSurface || "gui-chat";
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
      surface,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };

    if (overrideSessionId) {
      updateConversation(activeId, c => ({
        ...c,
        sessionId: overrideSessionId,
        messages: [...c.messages, userMessage],
        updatedAt: Date.now(),
        title: c.title === "New Chat" ? generateTitle([...c.messages, userMessage]) : c.title,
      }));
    } else {
      updateConversation(activeId, c => {
        const updated = { ...c, messages: [...c.messages, userMessage], updatedAt: Date.now() };
        if (c.title === "New Chat") updated.title = generateTitle([...c.messages, userMessage]);
        return updated;
      });
    }

    setInput("");
    setAttachments([]);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setIsLoading(true);
    setToolSteps([]);
    setActionButtons([]);
    inputRef.current?.focus();

    const sessionId = overrideSessionId || activeConversation?.sessionId;

    const msgId = crypto.randomUUID();
    const assistantMessage: Message = { id: msgId, role: "assistant", content: "", timestamp: new Date(), surface };
    updateConversation(activeId, c => ({
      ...c,
      messages: [...c.messages, assistantMessage],
      updatedAt: Date.now(),
    }));

    const messageToSend = buildMessageWithAttachments(text, currentAttachments);

    const safetyTimer = setTimeout(() => {
      if (!abortRef.current) {
        abortRef.current = true;
        setIsLoading(false);
      }
    }, 180_000);

    try {
      let accumulated = "";
      let lastFlush = 0;
      let tokenCount = 0;
      const streamStart = Date.now();
      const FLUSH_INTERVAL = 40;
      for await (const token of agentService.streamChat(messageToSend, sessionId, thinkingLevel)) {
        if (abortRef.current) {
          accumulated += "\n\n*[Cancelled by user]*";
          break;
        }
        accumulated += token;
        tokenCount++;
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
      const streamDuration = Date.now() - streamStart;
      setResponseMeta(prev => ({ ...prev, [msgId]: { tokens: tokenCount, durationMs: streamDuration } }));
      const finalContent = accumulated;
      updateConversation(activeId, c => ({
        ...c,
        messages: c.messages.map(m => m.id === msgId ? { ...m, content: finalContent } : m),
        updatedAt: Date.now(),
      }));

      if (voiceTriggeredRef.current && finalContent) {
        voiceTriggeredRef.current = false;
        const plainText = finalContent
          .replace(/```[\s\S]*?```/g, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1")
          .replace(/\*([^*]+)\*/g, "$1")
          .replace(/_([^_]+)_/g, "$1")
          .replace(/#+\s/g, "")
          .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/<[^>]+>/g, "")
          .trim();
        if (plainText.length > 0 && plainText.length < 500) {
          voiceService.speak(plainText).catch(() => {});
        }
      }
    } catch (err) {
      voiceTriggeredRef.current = false;
      updateConversation(activeId, c => ({
        ...c,
        messages: c.messages.map(m =>
          m.id === msgId
            ? { ...m, content: `**Error:** ${err instanceof Error ? err.message : "Unknown error"}\n\nMake sure the OpenClaw gateway is running.` }
            : m
        ),
        updatedAt: Date.now(),
      }));
    } finally {
      clearTimeout(safetyTimer);
      setIsLoading(false);
      abortRef.current = false;
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
        if (btn.args?.view) setView(btn.args.view as AppView);
        break;
      case "enable_plugin":
        if (btn.args?.id) {
          await invoke("execute_command", {
            command: `openclaw plugins enable ${btn.args.id}`,
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
        setView("marketplace");
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
            <StatusPill connected={gatewayConnected} label="OpenClaw" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {activeConversation?.sessionId && (
              <span
                title={`Session: ${activeConversation.sessionId}`}
                style={{
                  fontSize: 9, padding: "2px 7px", borderRadius: 6,
                  background: "rgba(139,92,246,0.08)", color: "rgba(139,92,246,0.6)",
                  fontFamily: "'JetBrains Mono', monospace", cursor: "default",
                  letterSpacing: 0.3,
                }}
              >
                {activeConversation.sessionId.slice(0, 8)}
              </span>
            )}
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{model}</span>
            {liveTps > 0 && (
              <span style={{
                fontSize: 9, padding: "2px 7px", borderRadius: 6,
                background: liveTps > 40 ? "rgba(74,222,128,0.1)" : liveTps > 15 ? "rgba(59,130,246,0.1)" : "rgba(251,191,36,0.1)",
                color: liveTps > 40 ? "var(--success)" : liveTps > 15 ? "var(--accent)" : "var(--warning)",
                fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}>
                {liveTps} tok/s
              </span>
            )}
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
          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current++; setDragOver(true); }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={e => { e.preventDefault(); e.stopPropagation(); dragCounterRef.current--; if (dragCounterRef.current <= 0) { dragCounterRef.current = 0; setDragOver(false); } }}
          onDrop={e => {
            e.preventDefault();
            e.stopPropagation();
            dragCounterRef.current = 0;
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) handleAttachFiles(e.dataTransfer.files);
          }}
          style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "20px 20px 12px", position: "relative" }}
        >
          {dragOver && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 50,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(59,130,246,0.08)", backdropFilter: "blur(4px)",
              border: "2px dashed rgba(59,130,246,0.5)", borderRadius: 12,
              pointerEvents: "none",
            }}>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
              }}>
                <Upload style={{ width: 36, height: 36, color: "var(--accent)", opacity: 0.8 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>Drop files here</span>
                <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>Images, audio, video, documents — up to 25 MB</span>
              </div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {messages.map((msg, i) => (
              <MessageBubble key={msg.id} message={msg} isLatest={i === messages.length - 1 && msg.role === "assistant"} meta={responseMeta[msg.id]} onImageClick={(src, name) => setLightboxSrc({ src, name })} />
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
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".txt,.md,.json,.csv,.xml,.yaml,.yml,.toml,.ini,.log,.js,.ts,.jsx,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.cs,.html,.css,.scss,.sql,.sh,.ps1,.bat,.pdf,.doc,.docx,.rtf,.env,.dockerfile,.makefile,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp,.ico,.mp3,.wav,.ogg,.m4a,.flac,.aac,.mp4,.webm,.mov,.zip,.tar,.gz,image/*,audio/*,video/*"
            style={{ display: "none" }}
            onChange={e => {
              if (e.target.files) handleAttachFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* Attachment chips */}
          {attachments.length > 0 && (
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6,
              padding: "6px 14px 4px",
            }}>
              {attachments.map(att => {
                const Icon = getFileIcon(att.name, att.type);
                const showThumb = isImageAttachment(att) && att.content?.startsWith("data:");
                return (
                  <div key={att.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 8px 3px 6px", borderRadius: 8,
                    background: "rgba(59,130,246,0.08)",
                    border: "1px solid rgba(59,130,246,0.15)",
                    fontSize: 11, color: "var(--text-secondary)",
                    maxWidth: 240,
                  }}>
                    {showThumb ? (
                      <img src={att.content} alt={att.name} style={{
                        width: 28, height: 28, borderRadius: 4, objectFit: "cover", flexShrink: 0,
                      }} />
                    ) : (
                      <Icon style={{ width: 12, height: 12, color: "var(--accent)", flexShrink: 0 }} />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {att.name}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>
                      {formatFileSize(att.size)}
                    </span>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 1,
                        display: "flex", alignItems: "center", flexShrink: 0,
                        borderRadius: 4,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(248,113,113,0.15)"}
                      onMouseLeave={e => e.currentTarget.style.background = "none"}
                    >
                      <X style={{ width: 10, height: 10, color: "var(--text-muted)" }} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

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
                  if (e.key === "Escape" && isLoading) {
                    e.preventDefault();
                    cancelRequest();
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!isLoading) sendMessage();
                  }
                }}
                onPaste={e => {
                  const items = e.clipboardData?.items;
                  if (!items) return;
                  const pastedFiles: File[] = [];
                  for (const item of Array.from(items)) {
                    if (item.kind === "file") {
                      const f = item.getAsFile();
                      if (f) pastedFiles.push(f);
                    }
                  }
                  if (pastedFiles.length > 0) {
                    e.preventDefault();
                    handleAttachFiles(pastedFiles);
                  }
                }}
                onBlur={() => setTimeout(() => setShowSlashMenu(false), 150)}
                placeholder={isLoading ? "Thinking… click Stop to cancel" : "Ask anything… or type / for commands"}
                disabled={false}
                style={{
                  width: "100%", padding: "6px 0",
                  background: "transparent", border: "none",
                  color: "var(--text)", fontSize: 13, outline: "none",
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
              onClick={() => fileInputRef.current?.click()}
              title="Attach document"
              style={{
                padding: 6, borderRadius: 8, border: "none", cursor: "pointer", flexShrink: 0,
                display: "flex", alignItems: "center",
                background: attachments.length > 0 ? "rgba(59,130,246,0.1)" : "transparent",
                transition: "all 0.2s",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = attachments.length > 0 ? "rgba(59,130,246,0.1)" : "transparent"; }}
            >
              <Paperclip style={{
                width: 15, height: 15,
                color: attachments.length > 0 ? "var(--accent)" : "var(--text-muted)",
                transition: "color 0.2s",
              }} />
            </button>
            <button
              onClick={handleMicClick}
              style={{
                padding: 6, borderRadius: 8, border: "none", cursor: "pointer", flexShrink: 0,
                display: "flex", alignItems: "center",
                background: isListening
                  ? "rgba(59,130,246,0.2)"
                  : "transparent",
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
              onClick={cycleThinkingLevel}
              title={`Thinking level: ${thinkingLevel || "default"} (click to cycle)`}
              style={{
                padding: "3px 7px", borderRadius: 6, flexShrink: 0,
                border: thinkingLevel ? "1px solid rgba(139,92,246,0.3)" : "1px solid transparent",
                cursor: "pointer",
                background: thinkingLevel ? "rgba(139,92,246,0.1)" : "transparent",
                color: thinkingLevel ? "rgba(139,92,246,0.9)" : "var(--text-muted)",
                display: "flex", alignItems: "center", gap: 3,
                transition: "all 0.2s",
                fontSize: 9, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace",
                letterSpacing: 0.3,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = "rgba(139,92,246,0.15)";
                e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = thinkingLevel ? "rgba(139,92,246,0.1)" : "transparent";
                e.currentTarget.style.borderColor = thinkingLevel ? "rgba(139,92,246,0.3)" : "transparent";
              }}
            >
              <Brain style={{ width: 11, height: 11 }} />
              {thinkingLevel ? thinkingLevel.slice(0, 3).toUpperCase() : "DEF"}
            </button>
            {isLoading ? (
              <button
                onClick={cancelRequest}
                title="Stop generating"
                style={{
                  padding: 8, borderRadius: 8, flexShrink: 0, border: "1px solid rgba(248,113,113,0.3)",
                  cursor: "pointer",
                  background: "rgba(248,113,113,0.12)",
                  color: "#f87171",
                  display: "flex", alignItems: "center",
                  transition: "all 0.2s",
                }}
              >
                <Square style={{ width: 13, height: 13, fill: "currentColor" }} />
              </button>
            ) : (
              <button
                data-send-btn
                onClick={() => {
                  const pending = pendingSendRef.current;
                  pendingSendRef.current = null;
                  sendMessage(pending?.surface, pending?.sessionId);
                }}
                disabled={!input.trim() && attachments.length === 0}
                style={{
                  padding: 8, borderRadius: 8, flexShrink: 0, border: "none", cursor: "pointer",
                  background: (input.trim() || attachments.length > 0)
                    ? "var(--chat-user)"
                    : "var(--bg-elevated)",
                  color: (input.trim() || attachments.length > 0) ? "var(--chat-user-text)" : "var(--text-muted)",
                  display: "flex", alignItems: "center",
                  transition: "all 0.2s",
                }}
              >
                <Send style={{ width: 15, height: 15 }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {lightboxSrc && (
        <ImageLightbox src={lightboxSrc.src} name={lightboxSrc.name} onClose={() => setLightboxSrc(null)} />
      )}
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
function MessageBubble({ message, isLatest, meta, onImageClick }: { message: Message; isLatest: boolean; meta?: { tokens: number; durationMs: number }; onImageClick?: (src: string, name: string) => void }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSpeak = async () => {
    if (speaking) return;
    setSpeaking(true);
    const plainText = message.content
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/#+\s/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim();
    try {
      await voiceService.speak(plainText);
    } catch {}
    setSpeaking(false);
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
        {/* Action buttons */}
        {!isUser && message.id !== "welcome" && (
          <div
            data-copy
            style={{
              position: "absolute", top: 6, right: 6, display: "flex", gap: 2,
              opacity: 0, transition: "opacity 0.15s", zIndex: 2,
            }}
          >
            <button
              onClick={handleSpeak}
              title="Read aloud"
              style={{
                padding: 4, borderRadius: 5,
                background: speaking ? "var(--accent-bg)" : "rgba(255,255,255,0.08)",
                border: "none", cursor: "pointer", display: "flex", alignItems: "center",
              }}
            >
              <Volume2 style={{ width: 11, height: 11, color: speaking ? "var(--accent)" : "var(--text-secondary)" }} />
            </button>
            <button
              onClick={handleCopy}
              title="Copy"
              style={{
                padding: 4, borderRadius: 5,
                background: "rgba(255,255,255,0.08)", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center",
              }}
            >
              {copied
                ? <Check style={{ width: 11, height: 11, color: "var(--success)" }} />
                : <Copy style={{ width: 11, height: 11, color: "var(--text-secondary)" }} />
              }
            </button>
          </div>
        )}

        {isUser ? (
          <div>
            {message.attachments && message.attachments.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
                {/* Image previews */}
                {message.attachments.filter(a => isImageAttachment(a) && a.content?.startsWith("data:")).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {message.attachments.filter(a => isImageAttachment(a) && a.content?.startsWith("data:")).map(att => (
                      <img
                        key={att.id}
                        src={att.content}
                        alt={att.name}
                        onClick={() => onImageClick?.(att.content!, att.name)}
                        style={{
                          maxWidth: 260, maxHeight: 200, borderRadius: 8,
                          objectFit: "cover", cursor: "pointer",
                          border: "1px solid rgba(255,255,255,0.15)",
                          transition: "opacity 0.15s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                      />
                    ))}
                  </div>
                )}
                {/* Audio players */}
                {message.attachments.filter(a => isAudioAttachment(a) && a.content?.startsWith("data:")).map(att => (
                  <div key={att.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Music style={{ width: 12, height: 12, color: "rgba(255,255,255,0.7)", flexShrink: 0 }} />
                    <audio controls src={att.content} style={{ height: 32, maxWidth: 240 }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{att.name}</span>
                  </div>
                ))}
                {/* Video players */}
                {message.attachments.filter(a => isVideoAttachment(a) && a.content?.startsWith("data:")).map(att => (
                  <video key={att.id} controls src={att.content} style={{
                    maxWidth: 300, maxHeight: 200, borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.15)",
                  }} />
                ))}
                {/* Non-media file badges */}
                {message.attachments.filter(a => !isImageAttachment(a) && !isAudioAttachment(a) && !isVideoAttachment(a)).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {message.attachments.filter(a => !isImageAttachment(a) && !isAudioAttachment(a) && !isVideoAttachment(a)).map(att => {
                      const Icon = getFileIcon(att.name, att.type);
                      return (
                        <span key={att.id} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 8px", borderRadius: 6,
                          background: "rgba(255,255,255,0.12)",
                          fontSize: 10, color: "rgba(255,255,255,0.8)",
                        }}>
                          <Icon style={{ width: 10, height: 10 }} />
                          {att.name}
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>{formatFileSize(att.size)}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                {/* Image-only badges (no content loaded, e.g. from prior session) */}
                {message.attachments.filter(a => isImageAttachment(a) && !a.content?.startsWith("data:")).map(att => (
                  <span key={att.id} style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 6,
                    background: "rgba(255,255,255,0.12)",
                    fontSize: 10, color: "rgba(255,255,255,0.8)",
                  }}>
                    <ImageIcon style={{ width: 10, height: 10 }} />
                    {att.name}
                  </span>
                ))}
              </div>
            )}
            <div style={{ fontSize: 13, color: "var(--chat-user-text)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {message.content}
            </div>
          </div>
        ) : (
          <div className={`md-content ${isLatest ? "animate-fade-in" : ""}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                img: ({ src, alt }) => (
                  <LocalImage src={src} alt={alt} onImageClick={onImageClick} />
                ),
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

        {/* Timestamp + surface + performance meta */}
        <div style={{
          fontSize: 9, color: isUser ? "rgba(255,255,255,0.5)" : "var(--text-muted)",
          marginTop: 4, textAlign: isUser ? "right" : "left",
          display: "flex", gap: 6, alignItems: "center", justifyContent: isUser ? "flex-end" : "flex-start",
        }}>
          <span>{message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          {message.surface && message.surface !== "gui-chat" && (
            <span style={{
              padding: "1px 5px", borderRadius: 4,
              background: isUser ? "rgba(255,255,255,0.12)" : "rgba(139,92,246,0.08)",
              color: isUser ? "rgba(255,255,255,0.7)" : "rgba(139,92,246,0.7)",
              fontWeight: 500, letterSpacing: 0.3,
            }}>
              {message.surface}
            </span>
          )}
          {meta && meta.durationMs > 0 && (
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {(meta.durationMs / 1000).toFixed(1)}s
              {meta.tokens > 0 && ` · ${Math.round(meta.tokens / (meta.durationMs / 1000))} tok/s`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Local image resolver — converts file paths to data URLs via Tauri ── */
function isLocalPath(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://") || src.startsWith("blob:")) return false;
  if (/^[A-Za-z]:[\\/]/.test(src)) return true;
  if (src.startsWith("/") || src.startsWith("~") || src.startsWith("\\\\")) return true;
  if (src.startsWith("file://")) return true;
  return false;
}

function LocalImage({ src, alt, onImageClick }: { src?: string; alt?: string; onImageClick?: (src: string, name: string) => void }) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) return;
    if (isLocalPath(src)) {
      const filePath = src.startsWith("file://") ? src.replace(/^file:\/\/\/?/, "") : src;
      invoke<string>("read_file_base64", { path: filePath })
        .then(dataUrl => setResolvedSrc(dataUrl))
        .catch(() => setError(true));
    } else {
      setResolvedSrc(src);
    }
  }, [src]);

  if (error) {
    return (
      <div style={{
        margin: "12px 0", padding: "12px 16px", borderRadius: 12,
        background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <ImageIcon style={{ width: 16, height: 16, color: "#f87171", flexShrink: 0 }} />
        <div>
          <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "block" }}>
            Could not load image
          </span>
          {src && (
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace", wordBreak: "break-all" }}>
              {src}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (!resolvedSrc) {
    return (
      <div style={{
        margin: "12px 0", padding: 20, borderRadius: 12,
        background: "var(--bg-elevated)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        minHeight: 120,
      }}>
        <Loader2 style={{ width: 16, height: 16, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Loading image...</span>
      </div>
    );
  }

  return (
    <div style={{ margin: "12px 0" }}>
      <img
        src={resolvedSrc}
        alt={alt || "Generated image"}
        onClick={() => onImageClick?.(resolvedSrc, alt || "image")}
        style={{
          maxWidth: "100%",
          maxHeight: 512,
          borderRadius: 12,
          border: "1px solid var(--border)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          display: "block",
          cursor: "pointer",
        }}
      />
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
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

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
        {elapsed > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
            {elapsed}s
          </span>
        )}
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

/* ── Lightbox modal ── */
function ImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)",
        cursor: "zoom-out",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        width: "100%", maxWidth: 800, padding: "0 16px 8px",
      }}>
        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontWeight: 500 }}>{name}</span>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 6,
            padding: "4px 8px", cursor: "pointer", display: "flex", alignItems: "center",
          }}
        >
          <X style={{ width: 14, height: 14, color: "rgba(255,255,255,0.8)" }} />
        </button>
      </div>
      <img
        src={src}
        alt={name}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: "90vw", maxHeight: "85vh", borderRadius: 8,
          objectFit: "contain", cursor: "default",
          boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
        }}
      />
    </div>
  );
}
