/**
 * Voice service — local GPU voice pipeline using NVIDIA Parakeet STT + Magpie TTS.
 *
 * Pipeline:
 *   STT: NVIDIA Parakeet (8090) → Browser API
 *   TTS: NVIDIA Magpie (8091) → Browser API
 *
 * Optimizations:
 *   - Event-based init wait (no polling)
 *   - Single refreshProviders call deduplicates concurrent check requests
 *   - Lazy initialization — doesn't block constructor
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
  ttsVoice: "nvidia-magpie",
  silenceThreshold: 1500,
  maxRecordingTime: 30000,
};

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
  private _initPromise: Promise<void>;
  private _sttAvailable = false;
  private _ttsAvailable = false;

  // Dedup concurrent refreshProvider calls
  private _refreshInFlight: Promise<{ stt: string; tts: string }> | null = null;

  constructor() {
    this._agent = new ConversationAgent({
      wakeWord: this.config.wakeWord,
      ttsVoice: this.config.ttsVoice,
      silenceThreshold: this.config.silenceThreshold,
      maxRecordingTime: this.config.maxRecordingTime,
    });

    this._agent.on((event) => {
      if (event.kind === "state_change") {
        this.onStateChange?.(toLegacyState(event.to));
      }

      if (event.kind === "transcript" && event.entry.role === "user" && !event.entry.is_partial) {
        this.onTranscript?.(event.entry.text);
      }
    });

    this._initPromise = this._initAsync();
  }

  private async _initAsync(): Promise<void> {
    try {
      await this._agent.initialize();
      this._sttAvailable = this._agent.hasStt;
      this._ttsAvailable = this._agent.hasTts;
    } catch (err) {
      console.error("[VoiceService] Initialization error:", err);
    }
  }

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
    await this._waitForInit();
    await this._agent.startListening();
  }

  async stopListening(): Promise<void> {
    await this._agent.stopListening();
  }

  async speak(text: string): Promise<void> {
    await this._waitForInit();
    await this._agent.speak(text);
  }

  async checkSttConnection(): Promise<boolean> {
    await this._waitForInit();
    const result = await this._refreshProvidersDedup();
    this._sttAvailable = result.stt !== "None";
    return this._sttAvailable;
  }

  /** @deprecated Use checkSttConnection */
  async checkWhisperConnection(): Promise<boolean> {
    return this.checkSttConnection();
  }

  async checkTTSConnection(): Promise<boolean> {
    await this._waitForInit();
    const result = await this._refreshProvidersDedup();
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
    await this._waitForInit();
    return this._agent.getProviderStatuses();
  }

  async setPreferredSttProvider(id: string): Promise<void> {
    await this._waitForInit();
    await this._agent.setPreferredSttProvider(id);
  }

  async setPreferredTtsProvider(id: string): Promise<void> {
    await this._waitForInit();
    await this._agent.setPreferredTtsProvider(id);
  }

  /**
   * Dedup concurrent refreshProviders calls — multiple callers
   * (e.g. checkWhisperConnection + checkTTSConnection in parallel)
   * share a single network round-trip.
   */
  private async _refreshProvidersDedup(): Promise<{ stt: string; tts: string }> {
    if (this._refreshInFlight) return this._refreshInFlight;
    this._refreshInFlight = this._agent.refreshProviders().finally(() => {
      this._refreshInFlight = null;
    });
    return this._refreshInFlight;
  }

  private _waitForInit(): Promise<void> {
    return this._initPromise;
  }
}

export const voiceService = new VoiceService();
