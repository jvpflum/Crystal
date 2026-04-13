import { openclawClient } from "./openclaw";
import { useTokenUsageStore } from "@/stores/tokenUsageStore";
import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";

export interface AgentAction {
  type: "tool_call" | "response" | "thinking";
  tool?: string;
  args?: Record<string, string>;
  content?: string;
}

export interface AgentStep {
  action: AgentAction;
  result?: { success: boolean; output: string; error?: string };
  timestamp: Date;
}

export interface ActionButton {
  id: string;
  label: string;
  icon: string;
  action: string;
  args?: Record<string, string>;
}

export type CrystalActionHandler = (action: string, args?: Record<string, string>) => void;

class AgentService {
  private onStepCallback: ((step: AgentStep) => void) | null = null;
  private onActionCallback: ((actions: ActionButton[]) => void) | null = null;
  private crystalActionHandler: CrystalActionHandler | null = null;

  onStep(callback: (step: AgentStep) => void) { this.onStepCallback = callback; }
  onActions(callback: (actions: ActionButton[]) => void) { this.onActionCallback = callback; }
  onCrystalAction(handler: CrystalActionHandler) { this.crystalActionHandler = handler; }

  private emitStep(step: AgentStep) { this.onStepCallback?.(step); }

  private extractAndEmitActions(response: string): string {
    const actionMatch = response.match(/```crystal-actions\s*\n([\s\S]*?)\n```/);
    if (actionMatch) {
      try {
        const actions: ActionButton[] = JSON.parse(actionMatch[1]);
        this.onActionCallback?.(actions);
      } catch { /* invalid JSON */ }
      return response.replace(/```crystal-actions\s*\n[\s\S]*?\n```/g, "").trim();
    }
    return response;
  }

  /**
   * Send a message through OpenClaw and yield the response character-by-character
   * for a typewriter effect. All orchestration (tools, memory, skills) is handled
   * by the OpenClaw gateway.
   */
  private isImageRequest(msg: string): string | null {
    const lower = msg.toLowerCase();
    const patterns = [
      /(?:generate|create|make|draw|paint|render|design)\s+(?:an?\s+)?(?:image|picture|photo|illustration|art|artwork|icon|logo|graphic)\s+(?:of\s+)?(.+)/i,
      /(?:image|picture|photo)\s+(?:of\s+)?(.+)/i,
    ];
    for (const p of patterns) {
      const m = msg.match(p);
      if (m?.[1]) return m[1].trim().replace(/[.!?]+$/, "");
    }
    if ((lower.includes("generate") || lower.includes("create") || lower.includes("make") || lower.includes("draw")) &&
        (lower.includes("image") || lower.includes("picture") || lower.includes("photo"))) {
      return msg.replace(/^.*?(?:image|picture|photo)\s*(?:of\s*)?/i, "").trim() || msg;
    }
    return null;
  }

  private async generateImage(prompt: string): Promise<string> {
    const escaped = escapeShellArg(prompt);
    const outDir = "$env:USERPROFILE\\.openclaw\\workspace\\images";
    const skillPath = "$env:APPDATA\\npm\\node_modules\\openclaw\\skills\\openai-image-gen\\scripts\\gen.py";
    const apiKeyCmd = `$env:OPENAI_API_KEY = (Get-Content "$env:USERPROFILE\\.openclaw\\agents\\main\\agent\\auth-profiles.json" | ConvertFrom-Json).profiles.'openai:default'.key`;
    const cmd = `${apiKeyCmd}; New-Item -ItemType Directory -Force -Path "${outDir}" | Out-Null; python "${skillPath}" --prompt "${escaped}" --count 1 --out-dir "${outDir}"`;

    const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
      command: cmd, cwd: null,
    });

    if (result.code !== 0) {
      const err = result.stderr || result.stdout || "Unknown error";
      return `**Image generation failed:** ${err}`;
    }

    const listResult = await invoke<{ stdout: string; code: number }>("execute_command", {
      command: `Get-ChildItem "${outDir}" -Filter *.png | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName`,
      cwd: null,
    });
    const imagePath = listResult.stdout?.trim();

    if (imagePath) {
      try {
        const dataUrl = await invoke<string>("read_file_base64", { path: imagePath });
        return `Here's your generated image:\n\n![${prompt}](${dataUrl})\n\n*Saved to: \`${imagePath}\`*`;
      } catch {
        return `Here's your generated image:\n\n![${prompt}](${imagePath})\n\n*Saved to: \`${imagePath}\`*`;
      }
    }

    return `Image generated in the workspace images folder.`;
  }

  async *streamChat(
    userMessage: string,
    sessionId?: string,
    thinking?: string,
    overrides?: { temperature?: number; maxTokens?: number; topP?: number },
  ): AsyncGenerator<string> {
    this.emitStep({ action: { type: "thinking" }, timestamp: new Date() });

    if (overrides) {
      await openclawClient.applySessionOverrides(overrides).catch(() => {});
    }

    const imagePrompt = this.isImageRequest(userMessage);

    if (imagePrompt) {
      this.emitStep({ action: { type: "tool_call", tool: "openai-image-gen", args: { prompt: imagePrompt } }, timestamp: new Date() });
      const response = await this.generateImage(imagePrompt);
      const cleaned = this.extractAndEmitActions(response);
      this.emitStep({ action: { type: "response", content: cleaned }, timestamp: new Date() });
      useTokenUsageStore.getState().recordTokens(2800, "openai");
      yield cleaned;
      return;
    }

    let fullResponse = "";
    let gotToolEvents = false;
    for await (const chunk of openclawClient.streamingChat(
      userMessage,
      sessionId,
      thinking,
      (toolEvent) => {
        gotToolEvents = true;
        this.emitStep({
          action: {
            type: "tool_call",
            tool: toolEvent.tool,
            args: toolEvent.args as Record<string, string>,
          },
          result: toolEvent.status !== "executing"
            ? { success: toolEvent.status === "completed", output: toolEvent.output || "", error: toolEvent.status === "error" ? "Tool failed" : undefined }
            : undefined,
          timestamp: new Date(),
        });
      },
    )) {
      fullResponse += chunk;
      yield chunk;
    }

    if (!fullResponse.trim()) {
      const fallback = await openclawClient.openclawChat(userMessage, sessionId, thinking);
      if (fallback.trim()) {
        fullResponse = fallback;
        yield fallback;
      }
    }

    if (!gotToolEvents && fullResponse.length > 50) {
      this.extractToolsFromResponse(fullResponse);
    }

    const cleaned = this.extractAndEmitActions(fullResponse);
    if (cleaned !== fullResponse) {
      yield "";
    }
    this.emitStep({ action: { type: "response", content: cleaned }, timestamp: new Date() });
  }

  private extractToolsFromResponse(text: string): void {
    const lines = text.split("\n");
    const seen = new Set<string>();

    const emit = (tool: string, args: Record<string, string>) => {
      const key = `${tool}:${JSON.stringify(args)}`;
      if (seen.has(key)) return;
      seen.add(key);
      this.emitStep({
        action: { type: "tool_call", tool, args },
        result: { success: true, output: "" },
        timestamp: new Date(),
      });
    };

    for (const line of lines) {
      let m: RegExpMatchArray | null;

      m = line.match(/(?:created|wrote|updated|modified|saved)\s+(?:file\s+)?[`'"]*([^\s`'",:]+\.\w{1,10})[`'"]*\b/i);
      if (m) { emit("write_file", { path: m[1].split(/[/\\]/).pop() || m[1] }); continue; }

      m = line.match(/(?:read|reading|examined|checked|looked at|reviewed)\s+(?:the\s+)?(?:file\s+|contents?\s+of\s+)?[`'"]*([^\s`'",:]+\.\w{1,10})[`'"]*\b/i);
      if (m) { emit("read_file", { path: m[1].split(/[/\\]/).pop() || m[1] }); continue; }

      m = line.match(/(?:ran|executed|running)\s+[`'"]+([^`'"]+)[`'"]+/i);
      if (m) { emit("bash", { command: m[1].length > 60 ? m[1].slice(0, 60) + "..." : m[1] }); continue; }

      m = line.match(/(?:installed|npm\s+install|pip\s+install|yarn\s+add)\s+[`'"]*(\S+)/i);
      if (m) { emit("bash", { command: `install ${m[1]}` }); continue; }

      m = line.match(/(?:searched|grepped|found)\s+(?:for\s+)?[`'"]+([^`'"]+)[`'"]+/i);
      if (m) { emit("search", { query: m[1] }); continue; }

      m = line.match(/(?:deleted|removed)\s+(?:file\s+)?[`'"]*([^\s`'",:]+\.\w{1,10})/i);
      if (m) { emit("delete_file", { path: m[1].split(/[/\\]/).pop() || m[1] }); continue; }
    }

    const codeBlocks = text.match(/```(\w+)?\n[\s\S]*?```/g);
    if (codeBlocks && codeBlocks.length > 0 && seen.size === 0) {
      for (const block of codeBlocks.slice(0, 5)) {
        const langMatch = block.match(/^```(\w+)/);
        if (langMatch && langMatch[1] !== "crystal-actions") {
          emit("code_block", { language: langMatch[1] });
        }
      }
    }
  }

  async chat(userMessage: string, sessionId?: string, thinking?: string): Promise<string> {
    const response = await openclawClient.openclawChat(userMessage, sessionId, thinking);
    return this.extractAndEmitActions(response);
  }

  clearHistory() {
    /* OpenClaw manages its own conversation context */
  }

  getHistory() {
    return [];
  }

  dispatchCrystalAction(action: string, args?: Record<string, string>): void {
    this.crystalActionHandler?.(action, args);
  }
}

export const agentService = new AgentService();

export function executeCrystalAction(action: string, args?: Record<string, string>): void {
  agentService.dispatchCrystalAction(action, args);
}
