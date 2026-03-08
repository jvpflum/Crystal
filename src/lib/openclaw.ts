import { invoke } from "@tauri-apps/api/core";

/* ─── Types ─── */

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  artifacts?: Artifact[];
  toolCalls?: ToolCallEvent[];
}

export interface Artifact {
  type: "code" | "file" | "command" | "image";
  content: string;
  language?: string;
  path?: string;
}

export interface ToolCallEvent {
  tool: string;
  args: Record<string, unknown>;
  status: "executing" | "completed" | "error";
  output?: string;
  exitCode?: number;
}

export type InferenceBackend = "ollama" | "lmstudio";

export type GatewayStatus = "disconnected" | "connecting" | "connected" | "error";

export interface GatewayMessage {
  type: string;
  id?: string;
  payload: Record<string, unknown>;
  timestamp?: string;
}

export interface ChannelConfig {
  id: string;
  name: string;
  type: "whatsapp" | "telegram" | "discord" | "slack" | "signal" | "imessage" | "googlechat" | "email" | "matrix" | "irc" | "linear" | "nostr";
  enabled: boolean;
  icon: string;
  description: string;
  dmPolicy?: string;
  groupPolicy?: string;
  connected?: boolean;
  config?: Record<string, unknown>;
}

export interface MemoryEntry {
  id: string;
  content: string;
  source: string;
  date: string;
  type: "curated" | "daily";
  relevance?: number;
}

export interface SkillInfo {
  name: string;
  description: string;
  version: string;
  installed: boolean;
  enabled: boolean;
  author?: string;
  repository?: string;
}

export interface ActivityEntry {
  id: string;
  type: "chat" | "tool_call" | "tool_result" | "skill_invoke" | "error" | "heartbeat";
  timestamp: Date;
  channel?: string;
  content: string;
  details?: Record<string, unknown>;
}

export interface OpenClawConfig {
  model?: string;
  contextLength?: number;
  tools?: string[];
  systemPrompt?: string;
  channels?: Record<string, unknown>;
  gateway?: Record<string, unknown>;
  memory?: Record<string, unknown>;
}

/* ─── Backend configs ─── */

interface BackendDef { baseUrl: string; defaultModel: string; }

const BACKENDS: Record<InferenceBackend, BackendDef> = {
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "auto" },
  lmstudio: { baseUrl: "http://127.0.0.1:1234/v1", defaultModel: "default" },
};

/* ─── Supported channels ─── */

export const SUPPORTED_CHANNELS: Omit<ChannelConfig, "enabled" | "connected" | "config">[] = [
  { id: "whatsapp",   name: "WhatsApp",    type: "whatsapp",   icon: "💬", description: "Send and receive messages via WhatsApp Web" },
  { id: "telegram",   name: "Telegram",    type: "telegram",   icon: "✈️",  description: "Connect as a Telegram bot" },
  { id: "discord",    name: "Discord",     type: "discord",    icon: "🎮", description: "Discord bot with voice, threads, reactions" },
  { id: "slack",      name: "Slack",       type: "slack",      icon: "💼", description: "Slack workspace bot with channel access" },
  { id: "signal",     name: "Signal",      type: "signal",     icon: "🔒", description: "End-to-end encrypted Signal messaging" },
  { id: "googlechat", name: "Google Chat", type: "googlechat", icon: "🟢", description: "Google Workspace Chat integration" },
  { id: "email",      name: "Email",       type: "email",      icon: "📧", description: "IMAP/SMTP email monitoring and responses" },
  { id: "matrix",     name: "Matrix",      type: "matrix",     icon: "🔷", description: "Matrix/Element federated messaging" },
  { id: "irc",        name: "IRC",         type: "irc",        icon: "📡", description: "Internet Relay Chat connection" },
  { id: "linear",     name: "Linear",      type: "linear",     icon: "📐", description: "Linear issue tracker integration" },
  { id: "nostr",      name: "Nostr",       type: "nostr",      icon: "🟣", description: "Nostr decentralized protocol" },
];

/* ─── Client ─── */

type GatewayListener = (msg: GatewayMessage) => void;

class OpenClawClient {
  /* LLM backend */
  private backend: InferenceBackend = "ollama";
  private baseUrl: string;
  private model: string;
  private llmConnected = false;

  /* Gateway (checked via Rust port probe) */
  private gwStatus: GatewayStatus = "disconnected";
  private statusCallbacks: ((s: GatewayStatus) => void)[] = [];
  private listeners = new Map<string, Set<GatewayListener>>();
  private messageLog: ActivityEntry[] = [];

  /* Internal caches */
  private _dirCache: string | null = null;
  private _configCache: { data: OpenClawConfig; ts: number } | null = null;
  private _modelsCache: { data: string[]; ts: number } | null = null;
  private static CONFIG_TTL = 30_000;
  private static MODELS_TTL = 30_000;

  constructor() {
    const cfg = BACKENDS[this.backend];
    this.baseUrl = cfg.baseUrl;
    this.model = cfg.defaultModel;
  }

  /* ── Rust HTTP proxy ── */

  private async proxyFetch(url: string, method = "GET", body?: string): Promise<{ status: number; body: string }> {
    const raw = await invoke<string>("http_proxy", { method, url, body, headers: null });
    return JSON.parse(raw);
  }

  /* ── Gateway connection (via Rust port check + CLI) ── */

  onStatusChange(cb: (s: GatewayStatus) => void) { this.statusCallbacks.push(cb); }

  private setGwStatus(s: GatewayStatus) {
    this.gwStatus = s;
    this.statusCallbacks.forEach(cb => cb(s));
  }

  getGatewayStatus(): GatewayStatus { return this.gwStatus; }

  async connectGateway(): Promise<boolean> {
    this.setGwStatus("connecting");
    try {
      // Check if port 18789 is alive via Rust
      const status = await invoke<{ openclaw_running: boolean }>("get_server_status");
      if (!status.openclaw_running) {
        this.setGwStatus("disconnected");
        return false;
      }

      // Verify gateway responds via CLI health check
      try {
        const result = await invoke<{ stdout: string; code: number }>("execute_command", {
          command: "npx openclaw health",
          cwd: null,
        });
        if (result.code === 0) {
          this.setGwStatus("connected");
          return true;
        }
      } catch { /* fall through */ }

      // Port is open, assume connected even if health check failed
      this.setGwStatus("connected");
      return true;
    } catch {
      this.setGwStatus("error");
      return false;
    }
  }

  isGatewayConnected(): boolean {
    return this.gwStatus === "connected";
  }

  on(type: string, fn: GatewayListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => { this.listeners.get(type)?.delete(fn); };
  }

  /* ── Gateway: Chat (via openclaw agent CLI) ── */

  async gatewayChat(text: string, _options?: { model?: string; noMemory?: boolean }): Promise<GatewayMessage> {
    const escaped = text.replace(/"/g, '\\"').replace(/\n/g, ' ');
    const timeoutMs = 120_000;
    const cmdPromise = invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: `npx openclaw agent --agent main --message "${escaped}"`,
      cwd: null,
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Gateway chat timed out after 120s")), timeoutMs)
    );
    const result = await Promise.race([cmdPromise, timeoutPromise]);
    const output = result.stdout || result.stderr || "No response";
    this.logActivity({ type: "response", payload: { text: output } });
    return { type: "response", payload: { text: output.trim() } };
  }

  /* ── Gateway: Status ── */

  async gatewayStatus(): Promise<GatewayMessage> {
    const result = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: "npx openclaw health",
      cwd: null,
    });
    return { type: "status", payload: { text: result.stdout, healthy: result.code === 0 } };
  }

  /* ── Gateway: Skill invoke ── */

  async invokeSkill(skill: string, args: string): Promise<GatewayMessage> {
    const result = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `npx openclaw agent --agent main --message "Use the ${skill} skill: ${args.replace(/"/g, '\\"')}"`,
      cwd: null,
    });
    return { type: "response", payload: { text: result.stdout.trim() } };
  }

  /* ── Gateway: Heartbeat ── */

  async triggerHeartbeat(dryRun = false): Promise<GatewayMessage> {
    const cmd = dryRun ? "npx openclaw system heartbeat --dry-run" : "npx openclaw system heartbeat";
    const result = await invoke<{ stdout: string; code: number }>("execute_command", { command: cmd, cwd: null });
    return { type: "heartbeat_status", payload: { text: result.stdout.trim(), result: result.code === 0 ? "HEARTBEAT_OK" : "HEARTBEAT_FAIL" } };
  }

  /* ── Activity log ── */

  private logActivity(msg: GatewayMessage) {
    const entry: ActivityEntry = {
      id: msg.id || crypto.randomUUID(),
      type: msg.type as ActivityEntry["type"],
      timestamp: new Date(msg.timestamp || Date.now()),
      content: typeof msg.payload.text === "string" ? msg.payload.text : JSON.stringify(msg.payload),
      details: msg.payload,
    };
    this.messageLog.unshift(entry);
    if (this.messageLog.length > 500) this.messageLog.length = 500;
  }

  getActivityLog(): ActivityEntry[] { return [...this.messageLog]; }
  clearActivityLog() { this.messageLog.length = 0; }

  /* ── Memory (file-based via Tauri) ── */

  async getMemory(): Promise<MemoryEntry[]> {
    try {
      const home = await this.getOpenClawDir();
      const content = await invoke<string>("read_file", { path: `${home}\\MEMORY.md` });
      return this.parseMemoryMd(content, "curated");
    } catch { return []; }
  }

  async getDailyMemory(date?: string): Promise<MemoryEntry[]> {
    const d = date || new Date().toISOString().split("T")[0];
    try {
      const home = await this.getOpenClawDir();
      const content = await invoke<string>("read_file", { path: `${home}\\memory\\${d}.md` });
      return this.parseMemoryMd(content, "daily");
    } catch { return []; }
  }

  async addMemory(content: string): Promise<void> {
    const home = await this.getOpenClawDir();

    const curatedPath = `${home}\\MEMORY.md`;
    let curatedExisting = "";
    try { curatedExisting = await invoke<string>("read_file", { path: curatedPath }); } catch { /* new file */ }
    const curatedUpdated = curatedExisting + (curatedExisting ? "\n\n" : "") + content;
    await invoke("write_file", { path: curatedPath, content: curatedUpdated });

    const date = new Date().toISOString().split("T")[0];
    const dailyDir = `${home}\\memory`;
    const dailyPath = `${dailyDir}\\${date}.md`;
    try {
      await invoke("execute_command", { command: `New-Item -ItemType Directory -Force -Path "${dailyDir}"`, cwd: null });
    } catch { /* dir may exist */ }
    let dailyExisting = "";
    try { dailyExisting = await invoke<string>("read_file", { path: dailyPath }); } catch { /* new file */ }
    const dailyUpdated = dailyExisting + (dailyExisting ? "\n\n" : "") + content;
    await invoke("write_file", { path: dailyPath, content: dailyUpdated });
  }

  async searchMemory(query: string): Promise<MemoryEntry[]> {
    if (this.isGatewayConnected()) {
      try {
        const result = await invoke<{ stdout: string; code: number }>("execute_command", {
          command: `npx openclaw memory search "${query.replace(/"/g, '\\"')}"`,
          cwd: null,
        });
        if (result.code === 0 && result.stdout.trim()) {
          return [{ id: crypto.randomUUID(), content: result.stdout.trim(), source: "search", date: new Date().toISOString(), type: "curated" }];
        }
      } catch { /* fall through */ }
    }
    const all = await this.getMemory();
    const q = query.toLowerCase();
    return all.filter(e => e.content.toLowerCase().includes(q));
  }

  private parseMemoryMd(md: string, type: "curated" | "daily"): MemoryEntry[] {
    if (!md.trim()) return [];
    const sections = md.split(/^## /m).filter(Boolean);
    return sections.map((s, i) => {
      const lines = s.trim().split("\n");
      const title = lines[0] || "";
      const body = lines.slice(1).join("\n").trim();
      return { id: `mem-${i}`, content: body || title, source: title, date: title, type };
    });
  }

  private async getOpenClawDir(): Promise<string> {
    if (this._dirCache) return this._dirCache;
    const result = await invoke<{ stdout: string }>("execute_command", { command: "echo $env:USERPROFILE\\.openclaw", cwd: null });
    this._dirCache = result.stdout.trim().replace(/\r?\n/g, "");
    return this._dirCache;
  }

  /* ── Config (file-based) ── */

  async getConfig(fresh = false): Promise<OpenClawConfig> {
    if (!fresh && this._configCache && Date.now() - this._configCache.ts < OpenClawClient.CONFIG_TTL) {
      return this._configCache.data;
    }
    try {
      const home = await this.getOpenClawDir();
      const raw = await invoke<string>("read_file", { path: `${home}\\openclaw.json` });
      const data = JSON.parse(raw);
      this._configCache = { data, ts: Date.now() };
      return data;
    } catch { return {}; }
  }

  async updateConfig(updates: Partial<OpenClawConfig>): Promise<void> {
    const home = await this.getOpenClawDir();
    const path = `${home}\\openclaw.json`;
    let existing: OpenClawConfig = {};
    try { existing = JSON.parse(await invoke<string>("read_file", { path })); } catch { /* new */ }
    const merged = { ...existing, ...updates };
    await invoke("write_file", { path, content: JSON.stringify(merged, null, 2) });
    this._configCache = { data: merged, ts: Date.now() };
  }

  /* ── Channels ── */

  async getChannels(): Promise<ChannelConfig[]> {
    const config = await this.getConfig();
    const channels = (config.channels || {}) as Record<string, Record<string, unknown>>;
    return SUPPORTED_CHANNELS.map(ch => ({
      ...ch,
      enabled: channels[ch.id] ? (channels[ch.id].enabled !== false) : false,
      connected: false,
      config: channels[ch.id] || {},
    }));
  }

  async enableChannel(channelId: string, channelConfig: Record<string, unknown>): Promise<void> {
    const config = await this.getConfig();
    const channels = (config.channels || {}) as Record<string, Record<string, unknown>>;
    channels[channelId] = { ...channels[channelId], ...channelConfig, enabled: true };
    await this.updateConfig({ channels });
  }

  async disableChannel(channelId: string): Promise<void> {
    const config = await this.getConfig();
    const channels = (config.channels || {}) as Record<string, Record<string, unknown>>;
    if (channels[channelId]) channels[channelId].enabled = false;
    await this.updateConfig({ channels });
  }

  /* ── Direct LLM ── */

  setBackend(b: InferenceBackend) {
    this.backend = b;
    const cfg = BACKENDS[b];
    this.baseUrl = cfg.baseUrl;
    this.model = cfg.defaultModel;
    this.llmConnected = false;
  }
  getBackend(): InferenceBackend { return this.backend; }

  async checkConnection(): Promise<boolean> {
    try {
      const r = await this.proxyFetch(`${this.baseUrl}/models`);
      this.llmConnected = r.status >= 200 && r.status < 300;
      return this.llmConnected;
    } catch { this.llmConnected = false; return false; }
  }
  isConnected(): boolean { return this.llmConnected; }

  async chat(messages: Message[]): Promise<string> {
    let full = "";
    for await (const chunk of this.streamChat(messages)) {
      full += chunk;
    }
    return full || "No response";
  }

  async *streamChat(messages: Message[]): AsyncGenerator<string> {
    if (this.model === "auto") {
      await this.autoDetectModel();
    }

    const url = `${this.baseUrl}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(`LLM error: ${resp.status} - ${errBody.slice(0, 200)}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response stream available");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const token = json.choices?.[0]?.delta?.content;
          if (token) yield token;
        } catch { /* skip malformed SSE chunks */ }
      }
    }
  }

  async getModels(): Promise<string[]> {
    if (this._modelsCache && Date.now() - this._modelsCache.ts < OpenClawClient.MODELS_TTL) {
      return this._modelsCache.data;
    }
    try {
      const r = await this.proxyFetch(`${this.baseUrl}/models`);
      if (r.status < 200 || r.status >= 300) return [];
      const d = JSON.parse(r.body);
      const models = d.data?.map((m: { id: string }) => m.id) || [];
      this._modelsCache = { data: models, ts: Date.now() };
      return models;
    } catch { return []; }
  }

  private async autoDetectModel(): Promise<void> {
    try {
      const models = await this.getModels();
      if (models.length > 0) {
        this.model = models[0];
        console.log(`[Crystal] Auto-detected model: ${this.model}`);
      }
    } catch { /* keep "auto" and let LLM call fail with clear error */ }
  }

  setModel(m: string) { this.model = m; }
  getModel(): string { return this.model; }
  getBaseUrl(): string { return this.baseUrl; }
  setBaseUrl(u: string) { this.baseUrl = u; }

  async startDaemon(): Promise<boolean> {
    try {
      await invoke("start_openclaw_daemon");
      await new Promise(r => setTimeout(r, 4000));
      return this.connectGateway();
    } catch { return false; }
  }
}

export const openclawClient = new OpenClawClient();
