import { openclawClient } from "./openclaw";
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

  async *streamChat(userMessage: string, sessionId?: string, thinking?: string): AsyncGenerator<string> {
    this.emitStep({ action: { type: "thinking" }, timestamp: new Date() });

    const imagePrompt = this.isImageRequest(userMessage);
    let response: string;

    if (imagePrompt) {
      this.emitStep({ action: { type: "tool_call", tool: "openai-image-gen", args: { prompt: imagePrompt } }, timestamp: new Date() });
      response = await this.generateImage(imagePrompt);
    } else {
      response = await openclawClient.openclawChat(userMessage, sessionId, thinking);
    }

    const cleaned = this.extractAndEmitActions(response);
    this.emitStep({ action: { type: "response", content: cleaned }, timestamp: new Date() });

    const CHARS_PER_TICK = 3;
    const TICK_MS = 8;
    for (let i = 0; i < cleaned.length; i += CHARS_PER_TICK) {
      yield cleaned.slice(i, i + CHARS_PER_TICK);
      if (i + CHARS_PER_TICK < cleaned.length) {
        await new Promise(r => setTimeout(r, TICK_MS));
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
