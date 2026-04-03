/**
 * Voice service compatibility shim.
 *
 * This module preserves the original VoiceService API so that existing consumers
 * (useVoice hook, VoiceOrb, ConversationView, SettingsView) continue to work
 * without changes during migration.
 *
 * Under the hood, it delegates to the new ConversationAgent which uses
 * provider-pluggable STT/TTS with NVIDIA Nemotron/Magpie as primary targets.
 *
 * Provider selection (automatic, runtime):
 *   STT: NVIDIA Nemotron (8090) → Whisper (8080) → Browser Speech API
 *   TTS: NVIDIA Magpie (8091)   → Kokoro (8081)  → Browser speechSynthesis
 */

import { ConversationAgent } from "./voice/conversation-agent";
import type { VoiceState as NewVoiceState, ProviderStatuses } from "./voice/types";

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceConfig {
  wakeWord: string;
  sttModel: string;
  ttsVoice: string;
  silenceThreshold: number;
  maxRecordingTime: number;
}

const defaultConfig: VoiceConfig = {
  wakeWord: "hey crystal",
  sttModel: "nvidia-nemotron",
  ttsVoice: "default",
  silenceThreshold: 1500,
  maxRecordingTime: 30000,
};

/**
 * Map expanded 8-state VoiceState to the legacy 4-state type
 * so existing UI components don't break.
 */
function toLegacyState(state: NewVoiceState): VoiceState {
  switch (state) {
    case "idle":
      return "idle";
    case "listening":
      return "listening";
    case "transcribing":
    case "thinking":
    case "awaiting_confirmation":
    case "executing":
    case "error":
      return "processing";
    case "speaking":
      return "speaking";
    default:
      return "idle";
  }
}

class VoiceService {
  private config: VoiceConfig = defaultConfig;
  private onStateChange: ((state: VoiceState) => void) | null = null;
  private onTranscript: ((text: string) => void) | null = null;

  private _agent: ConversationAgent;
  private _initialized = false;
  private _whisperAvailable = false;
  private _ttsAvailable = false;

  constructor() {
    this._agent = new ConversationAgent({
      wakeWord: this.config.wakeWord,
      ttsVoice: this.config.ttsVoice,
      silenceThreshold: this.config.silenceThreshold,
      maxRecordingTime: this.config.maxRecordingTime,
    });

    // Wire agent events to legacy callbacks
    this._agent.on((event) => {
      if (event.kind === "state_change") {
        const legacy = toLegacyState(event.to);
        this.onStateChange?.(legacy);
      }

      if (event.kind === "transcript" && event.entry.role === "user" && !event.entry.is_partial) {
        this.onTranscript?.(event.entry.text);
      }
    });

    this._initAsync();
  }

  private async _initAsync(): Promise<void> {
    try {
      await this._agent.initialize();
      this._initialized = true;

      // Check which providers are available for legacy compatibility booleans
      this._whisperAvailable = this._agent.hasStt;
      this._ttsAvailable = this._agent.hasTts;
    } catch (err) {
      console.error("[VoiceService] Initialization error:", err);
    }
  }

  /** Access the underlying ConversationAgent for new-style consumers. */
  get agent(): ConversationAgent {
    return this._agent;
  }

  setConfig(config: Partial<VoiceConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): VoiceConfig {
    return this.config;
  }

  onStateChangeCallback(callback: (state: VoiceState) => void) {
    this.onStateChange = callback;
  }

  onTranscriptCallback(callback: (text: string) => void) {
    this.onTranscript = callback;
  }

  async startListening(): Promise<void> {
    await this._agent.startListening();
  }

  async stopListening(): Promise<void> {
    await this._agent.stopListening();
  }

  async speak(text: string): Promise<void> {
    await this._agent.speak(text);
  }

  setWhisperEndpoint(_endpoint: string) {
    // No-op in new architecture — providers manage their own endpoints
  }

  setTTSEndpoint(_endpoint: string) {
    // No-op in new architecture — providers manage their own endpoints
  }

  async checkWhisperConnection(): Promise<boolean> {
    if (!this._initialized) {
      await this._waitForInit();
    }
    const result = await this._agent.refreshProviders();
    this._whisperAvailable = result.stt !== "None";
    return this._whisperAvailable;
  }

  async checkTTSConnection(): Promise<boolean> {
    if (!this._initialized) {
      await this._waitForInit();
    }
    const result = await this._agent.refreshProviders();
    this._ttsAvailable = result.tts !== "None";
    return this._ttsAvailable;
  }

  hasSpeechRecognition(): boolean {
    return this._agent.hasStt;
  }

  hasTTS(): boolean {
    return this._agent.hasTts;
  }

  async getProviderStatuses(): Promise<ProviderStatuses> {
    if (!this._initialized) await this._waitForInit();
    return this._agent.getProviderStatuses();
  }

  async setPreferredSttProvider(id: string): Promise<void> {
    if (!this._initialized) await this._waitForInit();
    await this._agent.setPreferredSttProvider(id);
  }

  async setPreferredTtsProvider(id: string): Promise<void> {
    if (!this._initialized) await this._waitForInit();
    await this._agent.setPreferredTtsProvider(id);
  }

  private _waitForInit(): Promise<void> {
    if (this._initialized) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this._initialized) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      };
      check();
      setTimeout(resolve, 10000);
    });
  }
}

export const voiceService = new VoiceService();
