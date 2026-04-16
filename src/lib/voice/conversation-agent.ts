/**
 * ConversationAgent — the top-level orchestrator for voice interactions.
 *
 * Owns:
 *   - Microphone input (AudioInputManager)
 *   - Speech-to-text (SpeechToTextProvider — NVIDIA Nemotron primary)
 *   - OpenClaw delegation (OpenClawAdapter)
 *   - Text-to-speech (TextToSpeechProvider — NVIDIA Magpie primary)
 *   - Audio playback (AudioOutputManager)
 *   - Voice state machine
 *   - Session state (transcript, tasks, confirmations)
 *
 * Latency optimizations:
 *   - Warm-mic: mic is paused (not torn down) between listen cycles — instant resume
 *   - Parallel init: STT + TTS providers initialize concurrently
 *   - Streaming callbacks wired before startStream to prevent races
 *   - stopListening immediately sends AUDIO_COMPLETE while transcript finalizes
 */

import type {
  VoiceConfig,
  VoiceState,
  StructuredAction,
  VoiceSystemEvent,
  VoiceSystemEventHandler,
  PendingConfirmation,
  ProviderStatuses,
} from "./types";
import { DEFAULT_VOICE_CONFIG } from "./types";
import { VoiceStateMachine } from "./state-machine";
import { SessionStateStore } from "./session-store";
import { OpenClawAdapter } from "./openclaw-adapter";
import { AudioInputManager } from "./audio-input";
import { AudioOutputManager } from "./audio-output";
import { requiresConfirmation, createConfirmationAction } from "./actions";

import type { SpeechToTextProvider, SttStreamHandle } from "./providers/stt-provider";
import type { TextToSpeechProvider } from "./providers/tts-provider";

import { NvidiaNemotronSpeechProvider } from "./providers/nvidia-nemotron-stt";
import { NvidiaMagpieTtsProvider } from "./providers/nvidia-magpie-tts";
import { BrowserSttProvider } from "./providers/browser-stt";
import { BrowserTtsProvider } from "./providers/browser-tts";

export class ConversationAgent {
  private _config: VoiceConfig;

  // Core components
  readonly stateMachine: VoiceStateMachine;
  readonly session: SessionStateStore;
  readonly openClaw: OpenClawAdapter;
  readonly audioInput: AudioInputManager;
  readonly audioOutput: AudioOutputManager;

  // Providers (resolved at initialization)
  private _sttProvider: SpeechToTextProvider | null = null;
  private _ttsProvider: TextToSpeechProvider | null = null;
  private _activeStreamHandle: SttStreamHandle | null = null;

  // All providers in priority order
  private _sttProviders: SpeechToTextProvider[] = [];
  private _ttsProviders: TextToSpeechProvider[] = [];

  // User-preferred provider IDs (null = auto by priority)
  private _preferredSttId: string | null = null;
  private _preferredTtsId: string | null = null;

  // External event listeners
  private _eventListeners: VoiceSystemEventHandler[] = [];

  // Auto-stop timer for maxRecordingTime
  private _autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config?: Partial<VoiceConfig>) {
    this._config = { ...DEFAULT_VOICE_CONFIG, ...config };

    this.stateMachine = new VoiceStateMachine();
    this.session = new SessionStateStore();
    this.openClaw = new OpenClawAdapter();
    this.audioInput = new AudioInputManager(this._config.sampleRate);
    this.audioOutput = new AudioOutputManager();

    this.stateMachine.on((event) => this._broadcast(event));
    this.session.on((event) => this._broadcast(event));

    this.audioOutput.onPlaybackComplete(() => {
      if (this.stateMachine.state === "speaking") {
        this.stateMachine.send("SPEECH_COMPLETE");
      }
    });

    this._sttProviders = [
      new NvidiaNemotronSpeechProvider(),
      new BrowserSttProvider(),
    ];

    this._ttsProviders = [
      new NvidiaMagpieTtsProvider(),
      new BrowserTtsProvider(),
    ];
  }

  // ── Initialization ───────────────────────────────────────────

  async initialize(): Promise<void> {
    // Parallel initialization of all providers
    await Promise.all([
      ...this._sttProviders.map((p) => p.initialize().catch((err) => {
        console.warn(`[ConversationAgent] STT provider ${p.id} init failed:`, err);
      })),
      ...this._ttsProviders.map((p) => p.initialize().catch((err) => {
        console.warn(`[ConversationAgent] TTS provider ${p.id} init failed:`, err);
      })),
    ]);

    await this._resolveProviders();

    if (this._sttProvider) {
      console.log(`[ConversationAgent] STT provider: ${this._sttProvider.name}`);
    } else {
      console.warn("[ConversationAgent] No STT provider available");
    }
    if (this._ttsProvider) {
      console.log(`[ConversationAgent] TTS provider: ${this._ttsProvider.name}`);
    } else {
      console.warn("[ConversationAgent] No TTS provider available");
    }
  }

  // ── Public API ───────────────────────────────────────────────

  get state(): VoiceState {
    return this.stateMachine.state;
  }

  get sttProviderName(): string {
    return this._sttProvider?.name ?? "None";
  }

  get ttsProviderName(): string {
    return this._ttsProvider?.name ?? "None";
  }

  get hasStt(): boolean {
    return this._sttProvider !== null;
  }

  get hasTts(): boolean {
    return this._ttsProvider !== null;
  }

  on(handler: VoiceSystemEventHandler): () => void {
    this._eventListeners.push(handler);
    return () => {
      this._eventListeners = this._eventListeners.filter((h) => h !== handler);
    };
  }

  /** Start listening for user speech. */
  async startListening(): Promise<void> {
    if (!this._sttProvider) {
      this._broadcast({ kind: "error", message: "No STT provider available", recoverable: true });
      return;
    }

    if (!this.stateMachine.canSend("START_LISTENING")) return;
    this.stateMachine.send("START_LISTENING");

    try {
      // Start STT stream — callbacks are wired inside startStream via NemotronStreamHandle constructor
      this._activeStreamHandle = this._sttProvider.startStream({
        sampleRate: this._config.sampleRate,
        encoding: "pcm_s16le",
      });

      // Wire callbacks BEFORE audio starts flowing
      this._activeStreamHandle.onPartialTranscript((result) => {
        this.session.addTranscriptEntry(
          this.session.createTranscriptEntry("user", result.text, { is_partial: true })
        );
      });

      this._activeStreamHandle.onFinalTranscript((_text) => {
        // Final transcript is handled via endStream() in stopListening
        // to avoid duplicate processing. This callback is intentionally a no-op.
      });

      this._activeStreamHandle.onError((err) => {
        console.error("[ConversationAgent] STT error:", err);
        this.stateMachine.send("TRANSCRIPTION_FAILED", { errorMessage: err.message });
        this._cleanup();
      });

      // Wire audio chunks → STT provider
      this.audioInput.onAudioChunk((pcm) => {
        this._activeStreamHandle?.pushAudioChunk(pcm);
      });

      // Start audio capture (warm resume if possible, cold start otherwise)
      await this.audioInput.start();

      // Clear any previous auto-stop timer
      if (this._autoStopTimer) {
        clearTimeout(this._autoStopTimer);
      }

      this._autoStopTimer = setTimeout(() => {
        if (this.stateMachine.state === "listening") {
          this.stopListening();
        }
      }, this._config.maxRecordingTime);
    } catch (err) {
      console.error("[ConversationAgent] Failed to start listening:", err);
      this.stateMachine.send("TRANSCRIPTION_FAILED", {
        errorMessage: err instanceof Error ? err.message : "Failed to start",
      });
      this._cleanup();
    }
  }

  /** Stop listening and finalize transcription. */
  async stopListening(): Promise<void> {
    if (this.stateMachine.state !== "listening") return;

    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }

    // Pause mic (warm) instead of full stop for instant next-listen
    this.audioInput.pause();
    this.stateMachine.send("AUDIO_COMPLETE");

    if (this._activeStreamHandle) {
      try {
        const finalText = await this._activeStreamHandle.endStream();
        if (finalText) {
          this._handleFinalTranscript(finalText);
        } else {
          this.stateMachine.send("TRANSCRIPTION_FAILED", { errorMessage: "No speech detected" });
          this.stateMachine.send("RESET");
        }
      } catch (err) {
        this.stateMachine.send("TRANSCRIPTION_FAILED", {
          errorMessage: err instanceof Error ? err.message : "Transcription failed",
        });
      }
      this._activeStreamHandle = null;
    }
  }

  /** Cancel any in-progress voice operation and reset to idle. */
  cancel(): void {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
    this._activeStreamHandle?.cancelStream();
    this._activeStreamHandle = null;
    this.audioInput.pause();
    this.audioOutput.bargeIn();
    this.stateMachine.reset();
  }

  /** Confirm a pending action and execute it. */
  async confirm(confirmationId: string): Promise<void> {
    const action = this.session.resolveConfirmation(confirmationId);
    if (!action) return;

    const originalAction = (action.payload?.original_action as StructuredAction) ?? action;
    this.stateMachine.send("USER_CONFIRMED");
    await this._executeAction(originalAction, true);
  }

  /** Dismiss a pending confirmation without executing. */
  dismiss(confirmationId: string): void {
    this.session.dismissConfirmation(confirmationId);
    if (this.stateMachine.state === "awaiting_confirmation") {
      this.stateMachine.send("USER_CANCELLED");
    }
  }

  /** Speak text directly (programmatic TTS). */
  async speak(text: string): Promise<void> {
    if (!this._ttsProvider) {
      console.warn("[ConversationAgent] No TTS provider available for speak()");
      return;
    }

    if (this.stateMachine.canSend("REPLY_READY")) {
      this.stateMachine.send("REPLY_READY");
    }
    this.session.addTranscriptEntry(
      this.session.createTranscriptEntry("assistant", text)
    );

    try {
      const audioBlob = await this._ttsProvider.synthesize(text);
      await this.audioOutput.play(audioBlob);
    } catch (err) {
      console.error("[ConversationAgent] TTS error:", err);
      if (this.stateMachine.canSend("SPEECH_COMPLETE")) {
        this.stateMachine.send("SPEECH_COMPLETE");
      }
    }
  }

  async setPreferredSttProvider(id: string): Promise<void> {
    this._preferredSttId = id;
    await this._resolveProviders();
  }

  async setPreferredTtsProvider(id: string): Promise<void> {
    this._preferredTtsId = id;
    await this._resolveProviders();
  }

  async refreshProviders(): Promise<{ stt: string; tts: string }> {
    await this._resolveProviders();
    return {
      stt: this._sttProvider?.name ?? "None",
      tts: this._ttsProvider?.name ?? "None",
    };
  }

  async getProviderStatuses(): Promise<ProviderStatuses> {
    const [stt, tts] = await Promise.all([
      Promise.all(
        this._sttProviders.map(async (p) => ({
          id: p.id,
          name: p.name,
          available: await p.isAvailable(),
          active: this._sttProvider === p,
        }))
      ),
      Promise.all(
        this._ttsProviders.map(async (p) => ({
          id: p.id,
          name: p.name,
          available: await p.isAvailable(),
          active: this._ttsProvider === p,
        }))
      ),
    ]);
    return { stt, tts };
  }

  private async _resolveProviders(): Promise<void> {
    // Resolve STT and TTS in parallel
    const [sttResult, ttsResult] = await Promise.all([
      this._resolveSingle(this._sttProviders, this._preferredSttId),
      this._resolveSingle(this._ttsProviders, this._preferredTtsId),
    ]);
    this._sttProvider = sttResult;
    this._ttsProvider = ttsResult;
  }

  private async _resolveSingle<T extends { id: string; isAvailable(): Promise<boolean> }>(
    providers: T[],
    preferredId: string | null,
  ): Promise<T | null> {
    if (preferredId) {
      const preferred = providers.find((p) => p.id === preferredId);
      if (preferred && (await preferred.isAvailable())) return preferred;
    }
    for (const p of providers) {
      if (await p.isAvailable()) return p;
    }
    return null;
  }

  dispose(): void {
    this.cancel();
    this._eventListeners = [];
    this.audioInput.stop();
    for (const p of this._sttProviders) p.dispose();
    for (const p of this._ttsProviders) p.dispose();
    this.audioOutput.dispose();
  }

  // ── Private Pipeline ─────────────────────────────────────────

  private async _handleFinalTranscript(text: string): Promise<void> {
    if (!text.trim()) {
      if (this.stateMachine.state === "transcribing") {
        this.stateMachine.send("TRANSCRIPTION_FAILED", { errorMessage: "Empty transcript" });
        this.stateMachine.send("RESET");
      }
      return;
    }

    this.session.addTranscriptEntry(
      this.session.createTranscriptEntry("user", text)
    );

    this.stateMachine.reset();
  }

  private _handleConfirmationRequired(action: StructuredAction): void {
    const confirmation: PendingConfirmation = {
      id: `conf_${Date.now()}`,
      action,
      description: action.user_visible_message,
      risk_level: action.risk_level,
      expires_at: Date.now() + 30000,
    };

    this.session.addConfirmation(confirmation);
    this.stateMachine.send("CONFIRM_REQUIRED");

    if (this._ttsProvider) {
      this._ttsProvider
        .synthesize(`${action.user_visible_message} Should I proceed?`)
        .then((blob) => this.audioOutput.play(blob))
        .catch(() => {});
    }
  }

  private async _executeAction(action: StructuredAction, confirmed = false): Promise<void> {
    if (requiresConfirmation(action) && !confirmed) {
      this._handleConfirmationRequired(
        createConfirmationAction(action, action.user_visible_message)
      );
      return;
    }

    this.stateMachine.send("TASK_DISPATCHED");
    const task = this.session.addTask(action);
    this.session.updateTask(task.id, { status: "running" });

    const result = await this.openClaw.dispatch(action, true);
    this.session.updateTaskFromResult(result);

    const spoken = result.success
      ? this._condenseForSpeech(result.output || "Done.")
      : `Sorry, that failed: ${result.error}`;

    this.session.addTranscriptEntry(
      this.session.createTranscriptEntry("assistant", result.output || result.error || "")
    );

    if (this._ttsProvider && this.stateMachine.canSend("EXECUTION_COMPLETE")) {
      this.stateMachine.send("EXECUTION_COMPLETE");
      const audioBlob = await this._ttsProvider.synthesize(spoken);
      await this.audioOutput.play(audioBlob);
    } else {
      if (this.stateMachine.canSend("EXECUTION_COMPLETE")) {
        this.stateMachine.send("EXECUTION_COMPLETE");
      }
      if (this.stateMachine.canSend("SPEECH_COMPLETE")) {
        this.stateMachine.send("SPEECH_COMPLETE");
      }
    }
  }

  private _condenseForSpeech(text: string): string {
    let cleaned = text
      .replace(/```[\s\S]*?```/g, " (code block omitted) ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`#]/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    if (cleaned.length > 300) {
      cleaned = cleaned.slice(0, 297) + "...";
    }

    return cleaned || "Done.";
  }

  private _cleanup(): void {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
    this._activeStreamHandle?.cancelStream();
    this._activeStreamHandle = null;
    this.audioInput.pause();
  }

  private _broadcast(event: VoiceSystemEvent): void {
    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[ConversationAgent] Event listener error:", err);
      }
    }
  }
}
