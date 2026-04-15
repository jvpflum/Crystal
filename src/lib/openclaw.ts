import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";
import { cachedCommand } from "@/lib/cache";
import { memoryPalaceClient } from "@/lib/memory-palace";

/* ─── Types ─── */

export type Surface = "gui-chat" | "voice" | "workflow" | "office" | "discord" | "cron";

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  surface?: Surface;
  artifacts?: Artifact[];
  toolCalls?: ToolCallEvent[];
  attachments?: ChatAttachment[];
  feedback?: "up" | "down";
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
  type: "chat" | "tool_call" | "tool_result" | "skill_invoke" | "error" | "heartbeat" | "response";
  timestamp: Date;
  channel?: string;
  content: string;
  details?: Record<string, unknown>;
}

export interface OpenClawConfig {
  model?: string;
  tools?: string[];
  channels?: Record<string, unknown>;
  gateway?: Record<string, unknown>;
  memory?: Record<string, unknown>;
  acp?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Reads extra system prompt text OpenClaw merges into the agent prompt (`agents.defaults.systemPrompt`, else `main` agent). */
export function getSystemPromptFromOpenClawConfig(cfg: Record<string, unknown>): string {
  const agents = cfg.agents as Record<string, unknown> | undefined;
  if (!agents || typeof agents !== "object") return "";
  const defaults = agents.defaults as Record<string, unknown> | undefined;
  const d = defaults?.systemPrompt;
  if (typeof d === "string" && d.trim()) return d;
  const list = agents.list as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return "";
  const main = list.find(a => a.id === "main") || list.find(a => a.default === true) || list[0];
  if (!main || typeof main !== "object") return "";
  const m = main.systemPrompt;
  return typeof m === "string" && m.trim() ? m : "";
}

const OPENCLAW_CMD = "openclaw";

/**
 * Agent replies often wrap JSON in prose or mix logs; Sub-Agents view may show raw text while Forge needs a parseable payload.
 */
export function extractJsonFromAgentOutput(text: string): unknown | null {
  const combined = text.trim();
  if (!combined) return null;
  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  };
  let v = tryParse(combined);
  if (v !== null) return v;
  const firstObj = combined.indexOf("{");
  const lastObj = combined.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    v = tryParse(combined.slice(firstObj, lastObj + 1));
    if (v !== null) return v;
  }
  const firstArr = combined.indexOf("[");
  const lastArr = combined.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    v = tryParse(combined.slice(firstArr, lastArr + 1));
    if (v !== null) return v;
  }
  return null;
}

export function pickSubagentListJson(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const keys = ["subagents", "agents", "items", "result", "data", "list", "runs", "rows"] as const;
  for (const k of keys) {
    const c = o[k];
    if (Array.isArray(c)) return c;
    if (c && typeof c === "object" && Array.isArray((c as Record<string, unknown>).items)) {
      return (c as Record<string, unknown>).items as unknown[];
    }
  }
  return [];
}

export function pickAcpSessionsJson(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const keys = ["sessions", "agents", "active", "data", "results", "session"] as const;
  for (const k of keys) {
    const c = o[k];
    if (Array.isArray(c)) return c;
    if (c && typeof c === "object" && !Array.isArray(c)) {
      return [c];
    }
  }
  return [];
}

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
  /* Gateway */
  private gwStatus: GatewayStatus = "disconnected";
  private statusCallbacks: ((s: GatewayStatus) => void)[] = [];
  private listeners = new Map<string, Set<GatewayListener>>();
  private messageLog: ActivityEntry[] = [];

  /* Internal caches */
  private _dirCache: string | null = null;
  private _configCache: { data: OpenClawConfig; ts: number } | null = null;
  private _modelsCache: { data: string[]; ts: number } | null = null;
  private _currentModel: string | null = null;
  private _didInitialSync = false;
  private static CONFIG_TTL = 30_000;
  private static MODELS_TTL = 30_000;

  /* TPS tracking */
  private _lastTps = 0;
  private _tpsCallbacks: ((tps: number) => void)[] = [];

  /* Session memory tracking */
  private _sessionMessages: { role: "user" | "assistant"; text: string; ts: number }[] = [];
  private _lastMemoryCapture = 0;
  private _messagesSinceLastPalaceSave = 0;
  private static PALACE_SAVE_INTERVAL = 15;

  constructor() {
    this._currentModel = localStorage.getItem("crystal_openclaw_model") || null;
  }

  private normalizeThinkingLevel(thinking?: string): string | undefined {
    // gpt-5.4-mini rejects "minimal"; map to closest supported level.
    if (thinking === "minimal") return "low";
    return thinking;
  }

  /* ── Direct Chat (bypasses CLI for speed) ── */

  private _openaiKeyCache: string | null = null;

  private async getDirectChatConfig(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
    const model = this._currentModel || "";
    const lower = model.toLowerCase();
    if (lower.includes("vllm") || lower.includes("qwen") || lower.includes("nvfp4")) {
      return { baseUrl: "http://127.0.0.1:8000/v1", apiKey: "vllm-local", model: model.replace(/^vllm\//, "") };
    }
    if (lower.includes("gpt") || lower.includes("openai")) {
      if (!this._openaiKeyCache) {
        try {
          const { resolveOpenAiApiKeyForCrystal } = await import("@/lib/openclawSecrets");
          this._openaiKeyCache = await resolveOpenAiApiKeyForCrystal();
        } catch { /* key resolution failed */ }
      }
      if (this._openaiKeyCache) {
        return { baseUrl: "https://api.openai.com/v1", apiKey: this._openaiKeyCache, model: model.replace(/^openai\//, "") };
      }
    }
    return null;
  }

  private stripThinkTags(text: string): string {
    return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").replace(/<think>[\s\S]*$/g, "").trim();
  }

  async *directStreamingChat(text: string): AsyncGenerator<string> {
    const config = await this.getDirectChatConfig();
    if (!config) return;

    let systemPrompt = "You are Crystal, a helpful AI desktop assistant. Be concise and helpful.";
    try {
      const wakeUp = await memoryPalaceClient.getWakeUpContext();
      if (wakeUp) systemPrompt += `\n\n--- MEMORY CONTEXT ---\n${wakeUp}`;
    } catch { /* palace unavailable */ }

    const messages = [
      { role: "system", content: systemPrompt },
      ...this._sessionMessages.slice(-10).map(m => ({ role: m.role, content: m.text })),
      { role: "user", content: text },
    ];

    const streamId = await invoke<string>("start_direct_chat", {
      messages,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: 4096,
    });

    const startTime = Date.now();
    const TIMEOUT = 120_000;
    const POLL_INTERVAL = 100;
    let rawOutput = "";
    let yieldedLen = 0;

    try {
      while (true) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const poll = await invoke<{ new_output: string; new_stderr: string; done: boolean; exit_code: number | null }>(
          "poll_streaming_command", { id: streamId }
        );
        if (poll.new_output) {
          rawOutput += poll.new_output;
          const cleaned = this.stripThinkTags(rawOutput);
          const newPart = cleaned.slice(yieldedLen);
          if (newPart) {
            yield newPart;
            yieldedLen = cleaned.length;
          }
        }
        if (poll.done) {
          const finalCleaned = this.stripThinkTags(rawOutput);
          const remaining = finalCleaned.slice(yieldedLen);
          if (remaining) yield remaining;
          if (!finalCleaned.trim() && poll.new_stderr?.trim()) {
            yield poll.new_stderr.trim();
            rawOutput += poll.new_stderr;
          }
          break;
        }
        if (Date.now() - startTime > TIMEOUT) {
          await invoke("kill_streaming_command", { id: streamId }).catch(() => {});
          yield "\n\n*[Timed out]*";
          break;
        }
      }
    } finally {
      await invoke("cleanup_streaming_command", { id: streamId }).catch(() => {});
    }

    const fullOutput = this.stripThinkTags(rawOutput);
    const elapsed = (Date.now() - startTime) / 1000;
    const wordCount = fullOutput.trim().split(/\s+/).length;
    if (elapsed > 0) this.emitTps(Math.round(wordCount / elapsed * 4));

    this._sessionMessages.push({ role: "user", text, ts: Date.now() });
    this._sessionMessages.push({ role: "assistant", text: fullOutput.trim().slice(0, 500), ts: Date.now() });
    if (this._sessionMessages.length > 40) this._sessionMessages = this._sessionMessages.slice(-30);
  }

  /* ── TPS tracking ── */

  onTps(cb: (tps: number) => void) { this._tpsCallbacks.push(cb); return () => { this._tpsCallbacks = this._tpsCallbacks.filter(c => c !== cb); }; }
  getLastTps(): number { return this._lastTps; }
  private emitTps(tps: number) { this._lastTps = tps; this._tpsCallbacks.forEach(cb => cb(tps)); }

  /* ── Gateway connection (via Rust port check + CLI) ── */

  onStatusChange(cb: (s: GatewayStatus) => void): () => void {
    this.statusCallbacks.push(cb);
    return () => { this.statusCallbacks = this.statusCallbacks.filter(c => c !== cb); };
  }

  private setGwStatus(s: GatewayStatus) {
    if (this.gwStatus === s) return;
    this.gwStatus = s;
    this.statusCallbacks.forEach(cb => cb(s));
  }

  getGatewayStatus(): GatewayStatus { return this.gwStatus; }

  private _connectLock = false;

  async connectGateway(): Promise<boolean> {
    if (this._connectLock) return this.gwStatus === "connected";
    this._connectLock = true;
    this.setGwStatus("connecting");
    try {
      const status = await invoke<{ openclaw_running: boolean }>("get_server_status");
      if (!status.openclaw_running) {
        this.setGwStatus("disconnected");
        return false;
      }
      try {
        await invoke<{ stdout: string; code: number }>("execute_command", {
          command: `${OPENCLAW_CMD} health`,
          cwd: null,
        });
      } catch { /* health check is best-effort */ }
      this.setGwStatus("connected");
      if (!this._didInitialSync) {
        this._didInitialSync = true;
        this.syncModelFromOpenClaw().catch(() => {});
        this.ensureDailyMemoryCron().catch(() => {});
      }
      return true;
    } catch {
      this.setGwStatus("error");
      return false;
    } finally {
      this._connectLock = false;
    }
  }

  private async syncModelFromOpenClaw(): Promise<void> {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} models status`,
        cwd: null,
      });
      const defaultMatch = result.stdout.match(/Default\s*:\s*(\S+)/);
      if (defaultMatch?.[1] && defaultMatch[1] !== "-") {
        this._currentModel = defaultMatch[1];
        localStorage.setItem("crystal_openclaw_model", defaultMatch[1]);
      }
    } catch { /* keep cached value */ }
  }

  private async ensureDailyMemoryCron(): Promise<void> {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} cron list --json`, cwd: null,
      });
      if (result.code !== 0) return;
      const parsed = JSON.parse(result.stdout);
      const jobs = Array.isArray(parsed) ? parsed : parsed.jobs ?? [];
      const hasMemoryCron = jobs.some((j: Record<string, unknown>) =>
        String(j.name || "").toLowerCase().includes("daily memory")
      );
      if (hasMemoryCron) return;

      const memoryPrompt = escapeShellArg(
        "Review today's conversation history and extract the most important facts, decisions, preferences, and context. " +
        "Write a concise summary as bullet points. Determine today's date and save it to " +
        "~/.openclaw/workspace/memory/YYYY-MM-DD.md (replacing YYYY-MM-DD with the actual current date) using the write_file tool. " +
        "Focus on: user preferences, project decisions, technical discoveries, action items, and anything the user would want remembered long-term. " +
        "Keep entries factual and concise."
      );
      await invoke("execute_command", {
        command: `${OPENCLAW_CMD} cron add --cron "0 23 * * *" --message "${memoryPrompt}" --agent main --name "Daily Memory Capture"`,
        cwd: null,
      });
    } catch { /* non-critical */ }
  }

  /**
   * Actively capture a conversation summary into daily memory.
   * Call this after significant conversations to ensure memory is logged
   * even if the cron job doesn't fire.
   */
  async captureDailyMemory(conversationSummary: string): Promise<void> {
    if (!conversationSummary.trim()) return;
    try {
      const dir = await this.getDailyMemoryDir();
      const date = new Date().toISOString().split("T")[0];
      const dailyPath = `${dir}\\${date}.md`;
      const timestamp = new Date().toLocaleString();

      let existing = "";
      try { existing = await invoke<string>("read_file", { path: dailyPath }); } catch { /* new file */ }

      const entry = `## Session — ${timestamp}\n${conversationSummary}`;
      const updated = existing
        ? existing.trimEnd() + "\n\n" + entry
        : `# Daily Log: ${date}\n\n${entry}`;

      await invoke("write_file", { path: dailyPath, content: updated });

      // Re-mine memory directory into Palace (background, best-effort)
      memoryPalaceClient.mine(dir).catch(() => {});
    } catch { /* best effort */ }
  }

  isGatewayConnected(): boolean {
    return this.gwStatus === "connected";
  }

  on(type: string, fn: GatewayListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => { this.listeners.get(type)?.delete(fn); };
  }

  /* ── Chat via OpenClaw agent CLI ── */

  async openclawChat(text: string, sessionId?: string, thinking?: string): Promise<string> {
    this.logActivity({ type: "chat", payload: { text } });

    const escaped = escapeShellArg(text);
    const timeoutMs = 120_000;
    const startTime = Date.now();

    let cmd = `${OPENCLAW_CMD} agent --agent main`;
    const normalizedThinking = this.normalizeThinkingLevel(thinking);
    if (sessionId) cmd += ` --session-id "${escapeShellArg(sessionId)}"`;
    if (normalizedThinking) cmd += ` --thinking ${normalizedThinking}`;
    cmd += ` --message "${escaped}"`;

    const streamId = await invoke<string>("start_streaming_command", { command: cmd, cwd: null });
    const cmdPromise = (async () => {
      const POLL_INTERVAL = 300;
      let fullOutput = "";
      let fullStderr = "";
      while (true) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        const poll = await invoke<{ new_output: string; new_stderr: string; done: boolean; exit_code: number | null }>(
          "poll_streaming_command", { id: streamId }
        );
        if (poll.new_output) fullOutput += poll.new_output;
        if (poll.new_stderr) fullStderr += poll.new_stderr;
        if (poll.done) {
          return { stdout: fullOutput, stderr: fullStderr, code: poll.exit_code ?? 1 };
        }
      }
    })();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => {
        invoke("kill_streaming_command", { id: streamId }).catch(() => {});
        reject(new Error("OpenClaw timed out after 120s"));
      }, timeoutMs)
    );

    let result;
    try {
      result = await Promise.race([cmdPromise, timeoutPromise]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      this.logActivity({ type: "error", payload: { text: errMsg } });
      invoke("cleanup_streaming_command", { id: streamId }).catch(() => {});
      throw e;
    } finally {
      invoke("cleanup_streaming_command", { id: streamId }).catch(() => {});
    }

    let output = (result.stdout || "")
      .split("\n")
      .filter(l => !l.startsWith("[plugins]") && !l.includes("could not be reached at http://127.0.0.1:11434"))
      .join("\n")
      .trim();
    const stderr = result.stderr || "";
    if (!output && stderr.trim()) {
      const errorLines = stderr.split("\n").filter(l =>
        !l.includes("[plugins]") && !l.includes("Require stack") && !l.includes("npm warn")
        && !l.includes("could not be reached at http://127.0.0.1:11434")
      ).join("\n").trim();
      output = errorLines || "No response from OpenClaw";
    }
    if (!output.trim()) output = "No response from OpenClaw";

    const elapsed = (Date.now() - startTime) / 1000;
    const wordCount = output.trim().split(/\s+/).length;
    if (elapsed > 0) this.emitTps(Math.round(wordCount / elapsed * 4));

    this.logActivity({ type: "response", payload: { text: output } });

    this._sessionMessages.push({ role: "user", text, ts: Date.now() });
    this._sessionMessages.push({ role: "assistant", text: output.trim().slice(0, 500), ts: Date.now() });
    if (this._sessionMessages.length > 40) this._sessionMessages = this._sessionMessages.slice(-30);
    this._maybeFlushMemory();

    return output.trim();
  }

  /**
   * Streaming chat via background process. Yields incremental output chunks
   * and emits tool_call / tool_result events as the agent works.
   *
   * Tries the direct HTTP path first (sub-second latency) and falls back
   * to the OpenClaw CLI if no direct config is available.
   */
  async *streamingChat(
    text: string,
    sessionId?: string,
    thinking?: string,
    onToolEvent?: (event: ToolCallEvent) => void,
  ): AsyncGenerator<string> {
    const directConfig = await this.getDirectChatConfig();
    if (directConfig) {
      let gotOutput = false;
      for await (const chunk of this.directStreamingChat(text)) {
        gotOutput = true;
        yield chunk;
      }
      if (gotOutput) return;
    }

    this.logActivity({ type: "chat", payload: { text } });
    this._seenToolKeys.clear();

    const escaped = escapeShellArg(text);
    let cmd = `${OPENCLAW_CMD} agent --agent main`;
    const normalizedThinking = this.normalizeThinkingLevel(thinking);
    if (sessionId) cmd += ` --session-id "${escapeShellArg(sessionId)}"`;
    if (normalizedThinking) cmd += ` --thinking ${normalizedThinking}`;
    cmd += ` --message "${escaped}"`;

    const streamId = await invoke<string>("start_streaming_command", { command: cmd, cwd: null });
    const startTime = Date.now();
    const TIMEOUT = 180_000;
    const POLL_INTERVAL = 300;
    let fullOutput = "";
    let fullStderr = "";

    try {
      while (true) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        const poll = await invoke<{ new_output: string; new_stderr: string; done: boolean; exit_code: number | null }>(
          "poll_streaming_command", { id: streamId }
        );

        if (poll.new_output) {
          const cleaned = poll.new_output
            .split("\n")
            .filter(line => !line.startsWith("[plugins]") && !line.includes("could not be reached at http://127.0.0.1:11434"))
            .join("\n");
          fullOutput += cleaned;
          if (cleaned.trim()) yield cleaned;
        }
        if (poll.new_stderr) {
          fullStderr += poll.new_stderr;
        }

        if (onToolEvent) {
          const combined = (poll.new_output || "") + (poll.new_stderr || "");
          if (combined) {
            const events = this.parseToolEvents(combined);
            for (const ev of events) {
              onToolEvent(ev);
              this.logActivity({ type: ev.status === "executing" ? "tool_call" : "tool_result", payload: { tool: ev.tool, args: ev.args } });
            }
          }
        }

        if (poll.done) {
          const errorLines = fullStderr.split("\n").filter(l =>
            !l.includes("[plugins]") &&
            !l.includes("Require stack") &&
            !l.includes("npm warn") &&
            !l.toLowerCase().includes("could not be reached at http://127.0.0.1:11434") &&
            l.trim()
          ).join("\n").trim();
          if (!fullOutput.trim() && errorLines) {
            yield errorLines;
            fullOutput += errorLines;
          }
          break;
        }

        if (Date.now() - startTime > TIMEOUT) {
          console.log("[streamingChat] TIMEOUT after 3 min");
          await invoke("kill_streaming_command", { id: streamId });
          yield "\n\n*[Timed out after 3 minutes]*";
          break;
        }
      }
    } finally {
      await invoke("cleanup_streaming_command", { id: streamId }).catch(() => {});
    }

    if (!fullOutput.trim()) {
      yield "No response from OpenClaw";
      fullOutput = "No response from OpenClaw";
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const wordCount = fullOutput.trim().split(/\s+/).length;
    if (elapsed > 0) this.emitTps(Math.round(wordCount / elapsed * 4));

    this.logActivity({ type: "response", payload: { text: fullOutput.trim().slice(0, 500) } });
    this._sessionMessages.push({ role: "user", text, ts: Date.now() });
    this._sessionMessages.push({ role: "assistant", text: fullOutput.trim().slice(0, 500), ts: Date.now() });
    if (this._sessionMessages.length > 40) this._sessionMessages = this._sessionMessages.slice(-30);
    this._maybeFlushMemory();
  }

  /** Kill the currently running streaming command */
  async killStreamingCommand(streamId: string): Promise<void> {
    await invoke("kill_streaming_command", { id: streamId }).catch(() => {});
  }

  private _seenToolKeys = new Set<string>();

  private parseToolEvents(chunk: string): ToolCallEvent[] {
    const events: ToolCallEvent[] = [];
    const lines = chunk.split("\n");

    const emit = (ev: ToolCallEvent) => {
      const key = `${ev.tool}:${ev.status}:${JSON.stringify(ev.args)}`;
      if (this._seenToolKeys.has(key)) return;
      this._seenToolKeys.add(key);
      if (this._seenToolKeys.size > 200) {
        const arr = [...this._seenToolKeys];
        this._seenToolKeys = new Set(arr.slice(-100));
      }
      events.push(ev);
    };

    for (const line of lines) {
      const trimmed = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (!trimmed) continue;

      let m: RegExpMatchArray | null;

      // XML tool_use blocks: <tool_use><name>read_file</name>
      m = trimmed.match(/<(?:tool_use|function_call|tool)\b[^>]*>.*?<name>(\w+)<\/name>/i);
      if (m) { emit({ tool: m[1], args: {}, status: "executing" }); continue; }

      // XML tool_result blocks
      m = trimmed.match(/<(?:tool_result|function_result)\b/i);
      if (m) continue;

      // JSON tool calls: {"type":"tool_use","name":"read_file",...} or {"tool":"read_file",...}
      if (trimmed.startsWith("{") && trimmed.includes('"')) {
        try {
          const j = JSON.parse(trimmed);
          const toolName = j.name || j.tool || j.function?.name;
          if (toolName) {
            const args: Record<string, unknown> = j.input || j.arguments || j.args || j.parameters || {};
            emit({ tool: toolName, args, status: "executing" });
            continue;
          }
        } catch { /* not valid JSON */ }
      }

      // Emoji + tool name patterns (OpenClaw CLI)
      m = trimmed.match(/(?:⚙️?|🔧|🛠️?)\s*(?:Using\s+tool:?\s*|Tool:?\s*)?(\w[\w_.-]+)/i);
      if (m) { emit({ tool: m[1], args: {}, status: "executing" }); continue; }

      // [tool_call] or [tool_use] prefix
      m = trimmed.match(/\[(?:tool_call|tool_use|function_call|tool)\]\s*(\w[\w_.-]+)/i);
      if (m) { emit({ tool: m[1], args: {}, status: "executing" }); continue; }

      // "Using tool `name`" or "Calling tool: name" or "Tool call: name"
      m = trimmed.match(/(?:Using|Calling|Invoking)\s+(?:tool\s*)?[:`'"]*\s*(\w[\w_.-]+)/i);
      if (m && !m[1].match(/^(?:the|a|an|this|that|it|to)$/i)) {
        emit({ tool: m[1], args: {}, status: "executing" });
        continue;
      }

      // "Tool call: name" or "tool: name(args)"
      m = trimmed.match(/(?:Tool\s*call:?\s*|tool:\s*)(\w[\w_.-]+)\s*(?:\(|$)/i);
      if (m) { emit({ tool: m[1], args: {}, status: "executing" }); continue; }

      // Success markers: ✓ ✔ ✅ or [tool_result] or "completed" / "succeeded"
      m = trimmed.match(/(?:✓|✔|✅)\s*(\w[\w_.-]*)/);
      if (m) { emit({ tool: m[1], args: {}, status: "completed" }); continue; }
      m = trimmed.match(/\[tool_result\]\s*(\w[\w_.-]+)\s*(?:completed|succeeded|done|ok)/i);
      if (m) { emit({ tool: m[1], args: {}, status: "completed" }); continue; }

      // Error markers: ✗ ✘ ❌ or "failed" / "error"
      m = trimmed.match(/(?:✗|✘|❌)\s*(\w[\w_.-]*)/);
      if (m) { emit({ tool: m[1], args: {}, status: "error" }); continue; }
      m = trimmed.match(/\[(?:tool_result|error)\]\s*(\w[\w_.-]+)\s*(?:failed|error)/i);
      if (m) { emit({ tool: m[1], args: {}, status: "error" }); continue; }

      // Running commands: Running `cmd`, $ cmd, > cmd, executing: cmd
      m = trimmed.match(/(?:Running|Executing|Exec)\s+[`'"]+([^`'"]+)[`'"]+/i);
      if (m) { emit({ tool: "bash", args: { command: m[1] }, status: "executing" }); continue; }
      m = trimmed.match(/^(?:\$|>)\s+(.{3,})$/);
      if (m) { emit({ tool: "bash", args: { command: m[1] }, status: "executing" }); continue; }

      // File operations: Writing/Wrote/Creating/Created + path with extension
      m = trimmed.match(/(?:Writing\s+(?:to\s+)?|Wrote\s+|Creating\s+|Created\s+|Saving\s+(?:to\s+)?|Updating\s+)[`'"]*([^\s`'",:]+\.\w{1,10})/i);
      if (m) {
        const p = m[1];
        emit({ tool: "write_file", args: { path: p, language: p.split(".").pop() || "" }, status: "executing" });
        continue;
      }

      // Reading files: Reading/Read + path with extension
      m = trimmed.match(/(?:Reading|Read(?:ing)?)\s+(?:file\s+)?[`'"]*([^\s`'",:]+\.\w{1,10})/i);
      if (m) {
        emit({ tool: "read_file", args: { path: m[1] }, status: "executing" });
        continue;
      }

      // Searching/Grepping: Searching for X in Y
      m = trimmed.match(/(?:Searching|Grep(?:ping)?|Finding)\s+(?:for\s+)?['"`]?(.+?)['"`]?\s+(?:in|across)/i);
      if (m) { emit({ tool: "search", args: { query: m[1] }, status: "executing" }); continue; }

      // Installing: npm install, pip install, etc.
      m = trimmed.match(/(?:Installing|npm\s+install|pip\s+install|yarn\s+add)\s+(.+)/i);
      if (m) { emit({ tool: "bash", args: { command: trimmed }, status: "executing" }); continue; }

      // File path patterns in brackets: [read_file path.ts] or [write_file path.ts]
      m = trimmed.match(/\[(\w+_file)\s+([^\]]+)\]/i);
      if (m) { emit({ tool: m[1], args: { path: m[2].trim() }, status: "executing" }); continue; }
    }

    return events;
  }

  private async _maybeFlushMemory(): Promise<void> {
    this._messagesSinceLastPalaceSave++;

    const MIN_INTERVAL = 10 * 60 * 1000;
    const MIN_MESSAGES = 6;
    if (this._sessionMessages.length < MIN_MESSAGES) return;
    if (Date.now() - this._lastMemoryCapture < MIN_INTERVAL) return;
    this._lastMemoryCapture = Date.now();

    const summary = this._sessionMessages
      .map(m => `- [${m.role}] ${m.text.slice(0, 200)}`)
      .join("\n");
    this.captureDailyMemory(summary);

    // Auto-extraction: re-mine into Palace every N messages
    if (this._messagesSinceLastPalaceSave >= OpenClawClient.PALACE_SAVE_INTERVAL) {
      this._messagesSinceLastPalaceSave = 0;
      this.getWorkspaceDir().then(ws => {
        const memDir = `${ws}\\memory`;
        memoryPalaceClient.mine(memDir).catch(() => {});
      }).catch(() => {});
    }
  }

  /* ── Gateway: Status ── */

  async gatewayStatus(): Promise<GatewayMessage> {
    const result = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `${OPENCLAW_CMD} health`,
      cwd: null,
    });
    return { type: "status", payload: { text: result.stdout, healthy: result.code === 0 } };
  }

  /* ── Gateway: Skill invoke ── */

  async invokeSkill(skill: string, args: string): Promise<GatewayMessage> {
    const escaped = escapeShellArg(`Use the ${skill} skill: ${args}`);
    const result = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `${OPENCLAW_CMD} agent --agent main --message "${escaped}"`,
      cwd: null,
    });
    return { type: "response", payload: { text: result.stdout.trim() } };
  }

  /* ── Gateway: Heartbeat ── */

  async triggerHeartbeat(dryRun = false): Promise<GatewayMessage> {
    const cmd = dryRun ? `${OPENCLAW_CMD} system heartbeat --dry-run` : `${OPENCLAW_CMD} system heartbeat`;
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

    this.listeners.get(msg.type)?.forEach(fn => fn(msg));
    this.listeners.get("*")?.forEach(fn => fn(msg));
  }

  getActivityLog(): ActivityEntry[] { return [...this.messageLog]; }
  clearActivityLog() { this.messageLog.length = 0; }

  /* ── Memory (file-based via Tauri) ── */
  /* OpenClaw layout:
   *   ~/.openclaw/workspace/MEMORY.md          — curated long-term memory
   *   ~/.openclaw/workspace/memory/YYYY-MM-DD.md — daily session logs
   */

  async getWorkspaceDir(): Promise<string> {
    const home = await this.getOpenClawDir();
    return `${home}\\workspace`;
  }

  private async getDailyMemoryDir(): Promise<string> {
    const ws = await this.getWorkspaceDir();
    const dir = `${ws}\\memory`;
    try {
      await invoke("execute_command", { command: `New-Item -ItemType Directory -Force -Path "${dir}"`, cwd: null });
    } catch { /* exists */ }
    return dir;
  }

  async getMemory(): Promise<MemoryEntry[]> {
    try {
      const ws = await this.getWorkspaceDir();
      const content = await invoke<string>("read_file", { path: `${ws}\\MEMORY.md` });
      return this.parseMemoryMd(content, "curated");
    } catch { return []; }
  }

  async getDailyMemory(date?: string): Promise<MemoryEntry[]> {
    const d = date || new Date().toISOString().split("T")[0];
    try {
      const dir = await this.getDailyMemoryDir();
      const content = await invoke<string>("read_file", { path: `${dir}\\${d}.md` });
      return this.parseMemoryMd(content, "daily");
    } catch { return []; }
  }

  async addMemory(content: string): Promise<void> {
    const ws = await this.getWorkspaceDir();
    const curatedPath = `${ws}\\MEMORY.md`;
    let curatedExisting = "";
    try { curatedExisting = await invoke<string>("read_file", { path: curatedPath }); } catch { /* new file */ }
    const timestamp = new Date().toLocaleString();
    const entry = `## Memory — ${timestamp}\n${content}`;
    const curatedUpdated = curatedExisting
      ? curatedExisting.trimEnd() + "\n\n" + entry
      : `# Crystal User Memory\n\n${entry}`;
    await invoke("write_file", { path: curatedPath, content: curatedUpdated });

    const date = new Date().toISOString().split("T")[0];
    const dir = await this.getDailyMemoryDir();
    const dailyPath = `${dir}\\${date}.md`;
    let dailyExisting = "";
    try { dailyExisting = await invoke<string>("read_file", { path: dailyPath }); } catch { /* new file */ }
    const dailyUpdated = dailyExisting
      ? dailyExisting.trimEnd() + "\n\n" + entry
      : `# Daily Log: ${date}\n\n${entry}`;
    await invoke("write_file", { path: dailyPath, content: dailyUpdated });

    this.reindexMemory();
  }

  async deleteMemory(entryId: string): Promise<void> {
    const ws = await this.getWorkspaceDir();
    const curatedPath = `${ws}\\MEMORY.md`;
    try {
      const content = await invoke<string>("read_file", { path: curatedPath });
      const sections = content.split(/^(?=## )/m);
      const filtered = sections.filter((_, i) => `mem-${i}` !== entryId);
      await invoke("write_file", { path: curatedPath, content: filtered.join("").trim() });
      this.reindexMemory();
    } catch { /* ignore */ }
  }

  async reindexMemory(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} memory index --force`, cwd: null,
      });

      // Also re-mine into MemPalace in the background
      const ws = await this.getWorkspaceDir();
      memoryPalaceClient.mine(ws).catch(() => {});

      return { success: result.code === 0, message: result.stdout?.trim() || result.stderr?.trim() || "Done" };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : "Reindex failed" };
    }
  }

  async getMemoryStatus(): Promise<Record<string, unknown> | null> {
    try {
      const ws = await this.getWorkspaceDir();
      const home = ws.replace(/\\workspace$/, "");

      const countFilesCmd = `powershell -Command "$ws='${ws}'; $mem='${ws}\\memory'; $wf=0; $mf=0; if(Test-Path $ws){$wf=(Get-ChildItem $ws -Filter '*.md' -File -ErrorAction SilentlyContinue).Count} if(Test-Path $mem){$mf=(Get-ChildItem $mem -Filter '*.md' -File -ErrorAction SilentlyContinue).Count} Write-Output ($wf+$mf)"`;
      const lanceExistsCmd = `powershell -Command "if(Test-Path '${home}\\memory\\lancedb\\memories.lance'){Write-Output 'YES'}else{Write-Output 'NO'}"`;

      const [filesResult, lanceResult] = await Promise.all([
        invoke<{ stdout: string; code: number }>("execute_command", { command: countFilesCmd, cwd: null }).catch(() => ({ stdout: "0", code: 1 })),
        invoke<{ stdout: string; code: number }>("execute_command", { command: lanceExistsCmd, cwd: null }).catch(() => ({ stdout: "NO", code: 1 })),
      ]);

      const files = parseInt(filesResult.stdout.trim(), 10) || 0;
      const vectorReady = lanceResult.stdout.trim() === "YES";
      const provider = vectorReady ? "lancedb" : "none";

      // Read openclaw.json to check memory plugin config
      let pluginEnabled = false;
      try {
        const cfg = await invoke<string>("read_file", { path: `${home}\\openclaw.json` });
        const parsed = JSON.parse(cfg);
        pluginEnabled = parsed?.plugins?.entries?.["memory-lancedb"]?.enabled === true;
      } catch { /* ignore */ }

      const palaceInit = await memoryPalaceClient.isInitialized().catch(() => false);

      return {
        status: {
          files, chunks: files, dirty: false, provider,
          vector: { available: vectorReady && pluginEnabled },
          fts: { available: false },
          custom: { searchMode: vectorReady ? "hybrid" : "fts-only" },
          palace: { initialized: palaceInit },
        },
      };
    } catch { /* ignore */ }
    return null;
  }

  async searchMemory(query: string): Promise<MemoryEntry[]> {
    // Try MemPalace semantic search first (hybrid BM25 + vector)
    try {
      const palaceResult = await memoryPalaceClient.search(query, undefined, undefined, 20);
      if (palaceResult.results.length > 0) {
        return palaceResult.results.map((r, i) => ({
          id: `palace-${i}`,
          content: r.text,
          source: `${r.wing}/${r.room} — ${r.sourceFile}`,
          date: `score: ${(r.similarity ?? 0).toFixed(3)}`,
          type: "curated" as const,
          relevance: r.similarity ?? 0,
        }));
      }
    } catch { /* palace unavailable — fall through to OpenClaw */ }

    // Fallback: OpenClaw CLI memory search
    try {
      const escaped = escapeShellArg(query);
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} memory search "${escaped}" --min-score 0.05 --max-results 20 --json`,
        cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        const results = parsed.results || [];
        return results.map((r: { path?: string; snippet?: string; score?: number; startLine?: number; endLine?: number }, i: number) => ({
          id: `search-${i}`,
          content: r.snippet || "",
          source: r.path || "memory",
          date: `score: ${(r.score ?? 0).toFixed(3)}`,
          type: "curated" as const,
        }));
      }
    } catch { /* fall through */ }
    const all = await this.getMemory();
    const q = query.toLowerCase();
    return all.filter(e => e.content.toLowerCase().includes(q));
  }

  async getPalaceWakeUpContext(wing?: string): Promise<string> {
    return memoryPalaceClient.getWakeUpContext(wing);
  }

  private parseMemoryMd(md: string, type: "curated" | "daily"): MemoryEntry[] {
    if (!md.trim()) return [];
    const sections = md.split(/^(?=## )/m).filter(s => s.trim());
    return sections.map((s, i) => {
      const lines = s.trim().split("\n");
      const heading = lines[0]?.replace(/^##\s*/, "") || "";
      const body = lines.slice(1).join("\n").trim();
      if (heading.startsWith("#") && !body) return null;
      return { id: `mem-${i}`, content: body || heading, source: heading, date: heading, type };
    }).filter(Boolean) as MemoryEntry[];
  }

  private async getOpenClawDir(): Promise<string> {
    if (this._dirCache) return this._dirCache;
    const result = await invoke<{ stdout: string }>("execute_command", { command: "echo $env:USERPROFILE\\.openclaw", cwd: null });
    this._dirCache = result.stdout.trim().replace(/\r?\n/g, "");
    return this._dirCache;
  }

  /** Resolves `%USERPROFILE%\\.openclaw` (Windows). */
  async getOpenClawHomeDir(): Promise<string> {
    return this.getOpenClawDir();
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

  /**
   * Persists the operator system prompt override OpenClaw merges into each run (same as `agents.defaults.systemPrompt` in openclaw.json).
   * Deep-preserves other `agents` keys (list, per-agent settings, etc.).
   */
  async setAgentsDefaultSystemPrompt(systemPrompt: string): Promise<void> {
    const existing = await this.getConfig(true);
    const agents = { ...((existing.agents as Record<string, unknown>) || {}) };
    const defaults = { ...((agents.defaults as Record<string, unknown>) || {}) };
    const t = systemPrompt.trim();
    if (t) {
      defaults.systemPrompt = systemPrompt;
    } else {
      delete defaults.systemPrompt;
    }
    agents.defaults = defaults;
    await this.updateConfig({ agents } as Partial<OpenClawConfig>);
  }

  /**
   * @deprecated OpenClaw does not support temperature/maxTokens/topP in
   * agents.defaults. Writing them there corrupts the config and triggers
   * "Unrecognized keys" validation errors. This method is now a no-op.
   */
  async applySessionOverrides(_overrides: { temperature?: number; maxTokens?: number; topP?: number }): Promise<void> {
    // no-op: OpenClaw schema rejects these keys in agents.defaults
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

  /* ── Models (via OpenClaw CLI) ── */

  private _modelDisplayNames = new Map<string, string>();

  async getModels(): Promise<string[]> {
    if (this._modelsCache && Date.now() - this._modelsCache.ts < OpenClawClient.MODELS_TTL) {
      return this._modelsCache.data;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await invoke<{ stdout: string; code: number }>("execute_command", {
          command: `${OPENCLAW_CMD} models list --json`,
          cwd: null,
        });
        const stdout = result.stdout || "";
        const jsonStart = stdout.indexOf("{");
        const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
        if (jsonStr.trim()) {
          const parsed = JSON.parse(jsonStr);
          const arr = parsed.models || parsed || [];
          const keys: string[] = [];
          this._modelDisplayNames.clear();
          for (const m of arr) {
            const key = m.key || m.id || m.name || "";
            if (!key) continue;
            keys.push(key);
            if (m.name) this._modelDisplayNames.set(key, m.name);
          }
          this._modelsCache = { data: keys, ts: Date.now() };
          return keys;
        }
      } catch {
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }
    return [];
  }

  getModelDisplayName(key: string): string {
    return this._modelDisplayNames.get(key) || key.split("/").pop() || key;
  }

  async setModel(m: string): Promise<void> {
    this._currentModel = m;
    localStorage.setItem("crystal_openclaw_model", m);
    this._modelsCache = null;
    // Fire-and-forget: don't block the UI waiting for the gateway CLI
    invoke("execute_command", {
      command: `${OPENCLAW_CMD} models set "${m}"`,
      cwd: null,
    }).catch(err => {
      console.warn("[OpenClaw] models set failed (model still active locally):", err);
    });
  }

  getModel(): string { return this._currentModel || "default"; }

  /**
   * Read the local/cloud model pair directly from openclaw.json config,
   * bypassing the gateway CLI entirely (which may be down or slow).
   */
  async getModelPairFromConfig(): Promise<{ local: string | null; cloud: string | null }> {
    try {
      const home = await this.getOpenClawDir();
      const raw = await invoke<string>("read_file", { path: `${home}\\openclaw.json` });
      const cfg = JSON.parse(raw);
      const agentModels = cfg?.agents?.defaults?.models as Record<string, unknown> | undefined;
      const primary = cfg?.agents?.defaults?.model?.primary as string | undefined;
      const fallbacks = cfg?.agents?.defaults?.model?.fallbacks as string[] | undefined;

      let local: string | null = null;
      let cloud: string | null = null;

      const allKeys = new Set<string>();
      if (primary) allKeys.add(primary);
      if (fallbacks) fallbacks.forEach(f => allKeys.add(f));
      if (agentModels) Object.keys(agentModels).forEach(k => allKeys.add(k));

      for (const key of allKeys) {
        if (!local && key.startsWith("vllm/")) local = key;
        if (!cloud && (key.startsWith("openai/") || key.startsWith("anthropic/"))) cloud = key;
      }
      return { local, cloud };
    } catch {
      return { local: null, cloud: null };
    }
  }

  /* ── Agents ── */

  async listAgents(): Promise<{ id: string; workspace: string; agentDir: string; model: string; bindings: number; isDefault: boolean; routes: string[] }[]> {
    // Primary: read directly from config file (no gateway dependency)
    try {
      const cfg = await this.getConfig(true);
      const defaults = cfg?.agents?.defaults;
      const list = cfg?.agents?.list as { id: string; name?: string; workspace?: string; agentDir?: string; model?: string }[] | undefined;
      if (list && list.length > 0) {
        const primaryModel = defaults?.model?.primary || "";
        return list.map((a, i) => ({
          id: a.id,
          workspace: a.workspace || defaults?.workspace || "",
          agentDir: a.agentDir || "",
          model: a.model || primaryModel,
          bindings: 0,
          isDefault: i === 0 || a.id === "main",
          routes: [],
        }));
      }
    } catch { /* fall through */ }
    // Fallback: try CLI (may hang if gateway is down)
    try {
      const result = await cachedCommand(`${OPENCLAW_CMD} agents list --json`, { ttl: 60_000 });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        return Array.isArray(data) ? data : (data.agents ?? data.items ?? []);
      }
    } catch { /* ignore */ }
    return [];
  }

  async dispatchToAgent(
    agentId: string,
    message: string,
    opts?: { thinking?: string; sessionId?: string; cwd?: string },
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const escaped = escapeShellArg(message);
    let cmd = `${OPENCLAW_CMD} agent --agent "${escapeShellArg(agentId)}"`;
    if (opts?.thinking) cmd += ` --thinking ${escapeShellArg(opts.thinking)}`;
    if (opts?.sessionId) cmd += ` --session-id "${escapeShellArg(opts.sessionId)}"`;
    cmd += ` --message "${escaped}"`;
    return invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: cmd,
      cwd: opts?.cwd ?? null,
    });
  }

  /** Forge / background builds: durable task registry (subagent, acp, etc.). */
  async listBackgroundTasks(): Promise<{ count: number; tasks: unknown[] } | null> {
    try {
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} tasks list --json`,
        cwd: null,
      });
      const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
      if (!combined) return null;
      const first = combined.indexOf("{");
      const last = combined.lastIndexOf("}");
      const text = first >= 0 && last > first ? combined.slice(first, last + 1) : combined;
      let data: { count?: number; tasks?: unknown; runs?: unknown[] };
      try {
        data = JSON.parse(text) as { count?: number; tasks?: unknown; runs?: unknown[] };
      } catch {
        return null;
      }
      const tasks = Array.isArray(data.tasks)
        ? data.tasks
        : Array.isArray(data.runs)
          ? data.runs
          : null;
      if (!tasks) return null;
      return {
        count: typeof data.count === "number" ? data.count : tasks.length,
        tasks,
      };
    } catch {
      return null;
    }
  }

  /**
   * Forge UI: same sources as Sub-Agents view — `/subagents list` + `/acp status` on main agent.
   * (Plain `tasks list` is a different queue and often does not include live builders.)
   */
  async fetchForgeAgentLists(): Promise<{ subagents: unknown[]; acpSessions: unknown[] }> {
    const subagents: unknown[] = [];
    const acpSessions: unknown[] = [];
    const combine = (stdout: string, stderr: string) => `${stdout || ""}\n${stderr || ""}`.trim();

    try {
      const sub = await this.dispatchToAgent("main", "/subagents list");
      const subText = combine(sub.stdout, sub.stderr);
      if (sub.code === 0 && subText) {
        const data = extractJsonFromAgentOutput(subText);
        if (data !== null) subagents.push(...pickSubagentListJson(data));
      }
    } catch { /* ignore */ }

    try {
      const acp = await this.dispatchToAgent("main", "/acp status");
      const acpText = combine(acp.stdout, acp.stderr);
      if (acp.code === 0 && acpText) {
        const data = extractJsonFromAgentOutput(acpText);
        if (data !== null) acpSessions.push(...pickAcpSessionsJson(data));
      }
    } catch { /* ignore */ }

    return { subagents, acpSessions };
  }

  async getAgentSessions(agentId?: string): Promise<{ key: string; sessionId: string; model: string; modelProvider: string; inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number; agentId: string; updatedAt: number; ageMs: number; kind: string }[]> {
    try {
      const result = await cachedCommand(`${OPENCLAW_CMD} sessions --json`, { ttl: 30_000 });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        const sessions = data.sessions || [];
        if (agentId) return sessions.filter((s: { agentId: string }) => s.agentId === agentId);
        return sessions;
      }
    } catch { /* ignore */ }
    return [];
  }

  async listNodes(): Promise<{ id: string; name?: string; label?: string; status?: string; type?: string }[]> {
    try {
      const result = await cachedCommand(`${OPENCLAW_CMD} nodes list --json`, { ttl: 60_000 });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        return Array.isArray(data) ? data : data.nodes ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  async nodeAction(nodeId: string, action: "run" | "invoke", input: string): Promise<{ stdout: string; code: number }> {
    const escaped = escapeShellArg(input);
    return invoke<{ stdout: string; code: number }>("execute_command", {
      command: action === "run"
        ? `${OPENCLAW_CMD} nodes run --node ${escapeShellArg(nodeId)} -- ${escaped}`
        : `${OPENCLAW_CMD} nodes invoke --node ${escapeShellArg(nodeId)} --command "${escaped}"`,
      cwd: null,
    });
  }

  async notifyAllNodes(message: string): Promise<{ stdout: string; code: number }> {
    return invoke<{ stdout: string; code: number }>("execute_command", {
      command: `${OPENCLAW_CMD} nodes notify --body "${escapeShellArg(message.trim())}"`, cwd: null,
    });
  }

  async getChannelStatus(): Promise<{ channels: Record<string, { configured: boolean; running: boolean; lastError: string | null }>; channelMeta: { id: string; label: string }[]; channelAccounts: Record<string, { accountId: string; connected: boolean; bot?: { username: string }; lastInboundAt: number | null }[]> }> {
    try {
      const result = await cachedCommand(`${OPENCLAW_CMD} channels status --json`, { ttl: 60_000 });
      if (result.code === 0 && result.stdout.trim()) {
        return JSON.parse(result.stdout);
      }
    } catch { /* ignore */ }
    return { channels: {}, channelMeta: [], channelAccounts: {} };
  }

  /* ── Skills ── */

  async listSkills(): Promise<{ name: string; description?: string; eligible: boolean; version?: string; author?: string; enabled?: boolean }[]> {
    try {
      const result = await cachedCommand(`${OPENCLAW_CMD} skills list --json`, { ttl: 120_000 });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        return Array.isArray(data) ? data : data.skills ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  async enableSkill(name: string): Promise<boolean> {
    try {
      const r = await invoke<{ code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} skills enable "${escapeShellArg(name)}"`, cwd: null,
      });
      return r.code === 0;
    } catch { return false; }
  }

  async disableSkill(name: string): Promise<boolean> {
    try {
      const r = await invoke<{ code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} skills disable "${escapeShellArg(name)}"`, cwd: null,
      });
      return r.code === 0;
    } catch { return false; }
  }

  /* ── Cron ── */

  async listCronJobs(): Promise<{ id?: string; name: string; schedule: unknown; command?: string; enabled?: boolean }[]> {
    try {
      const result = await cachedCommand(`${OPENCLAW_CMD} cron list --json`, { ttl: 60_000 });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        return Array.isArray(data) ? data : data.jobs ?? data.cron ?? [];
      }
    } catch { /* ignore */ }
    return [];
  }

  async addCronJob(name: string, schedule: string, message: string): Promise<boolean> {
    try {
      const r = await invoke<{ code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} cron add --cron "${escapeShellArg(schedule)}" --message "${escapeShellArg(message)}" --agent main --name "${escapeShellArg(name)}"`,
        cwd: null,
      });
      return r.code === 0;
    } catch { return false; }
  }

  async removeCronJob(name: string): Promise<boolean> {
    try {
      const r = await invoke<{ code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} cron remove --name "${escapeShellArg(name)}"`, cwd: null,
      });
      return r.code === 0;
    } catch { return false; }
  }

  /* ── Sessions ── */

  async listSessions(): Promise<{ key: string; sessionId: string; model: string; modelProvider: string; inputTokens: number; outputTokens: number; totalTokens: number; contextTokens: number; agentId: string; updatedAt: number; ageMs: number; kind: string }[]> {
    try {
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `${OPENCLAW_CMD} sessions --json`, cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        const data = JSON.parse(result.stdout);
        return data.sessions || [];
      }
    } catch { /* ignore */ }
    return [];
  }

  /* ── Gateway lifecycle ── */

  async startDaemon(): Promise<boolean> {
    try {
      await invoke("start_openclaw_daemon");
      await new Promise(r => setTimeout(r, 4000));
      return this.connectGateway();
    } catch { return false; }
  }
}

export const openclawClient = new OpenClawClient();
