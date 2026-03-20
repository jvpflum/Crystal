/**
 * ConversationAgent — the top-level orchestrator for voice interactions.
 *
 * Owns:
 *   - Microphone input (AudioInputManager)
 *   - Speech-to-text (SpeechToTextProvider — NVIDIA Nemotron primary)
 *   - Intent routing (IntentRouter)
 *   - OpenClaw delegation (OpenClawAdapter)
 *   - Text-to-speech (TextToSpeechProvider — NVIDIA Magpie primary)
 *   - Audio playback (AudioOutputManager)
 *   - Voice state machine
 *   - Session state (transcript, tasks, confirmations)
 *
 * This is the thing the user talks to. It gives fast acknowledgements,
 * concise spoken responses, and delegates actions to OpenClaw when needed.
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
import { IntentRouter } from "./intent-router";
import { OpenClawAdapter } from "./openclaw-adapter";
import { AudioInputManager } from "./audio-input";
import { AudioOutputManager } from "./audio-output";
import { isOpenClawAction, requiresConfirmation, createConfirmationAction } from "./actions";

import type { SpeechToTextProvider, SttStreamHandle } from "./providers/stt-provider";
import type { TextToSpeechProvider } from "./providers/tts-provider";

import { NvidiaNemotronSpeechProvider } from "./providers/nvidia-nemotron-stt";
import { NvidiaMagpieTtsProvider } from "./providers/nvidia-magpie-tts";
import { WhisperSttProvider } from "./providers/whisper-stt";
import { KokoroTtsProvider } from "./providers/kokoro-tts";
import { BrowserSttProvider } from "./providers/browser-stt";
import { BrowserTtsProvider } from "./providers/browser-tts";

export class ConversationAgent {
  private _config: VoiceConfig;

  // Core components
  readonly stateMachine: VoiceStateMachine;
  readonly session: SessionStateStore;
  readonly intentRouter: IntentRouter;
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

  constructor(config?: Partial<VoiceConfig>) {
    this._config = { ...DEFAULT_VOICE_CONFIG, ...config };

    this.stateMachine = new VoiceStateMachine();
    this.session = new SessionStateStore();
    this.intentRouter = new IntentRouter();
    this.openClaw = new OpenClawAdapter();
    this.audioInput = new AudioInputManager(this._config.sampleRate);
    this.audioOutput = new AudioOutputManager();

    // Wire up state machine events → external listeners
    this.stateMachine.on((event) => this._broadcast(event));

    // Wire up session events → external listeners
    this.session.on((event) => this._broadcast(event));

    // Wire up audio output state → voice state machine
    this.audioOutput.onPlaybackComplete(() => {
      if (this.stateMachine.state === "speaking") {
        this.stateMachine.send("SPEECH_COMPLETE");
      }
    });

    // Register all providers (priority order: NVIDIA → fallback → browser)
    this._sttProviders = [
      new NvidiaNemotronSpeechProvider(),
      new WhisperSttProvider(),
      new BrowserSttProvider(),
    ];

    this._ttsProviders = [
      new NvidiaMagpieTtsProvider(),
      new KokoroTtsProvider(),
      new BrowserTtsProvider(),
    ];
  }

  // ── Initialization ───────────────────────────────────────────

  async initialize(): Promise<void> {
    // Initialize all providers so we can report status for each
    for (const p of this._sttProviders) await p.initialize();
    for (const p of this._ttsProviders) await p.initialize();

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

  /** Subscribe to all voice system events. Returns an unsubscribe function. */
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
      // Start audio capture
      await this.audioInput.start();

      // Start STT stream
      this._activeStreamHandle = this._sttProvider.startStream({
        sampleRate: this._config.sampleRate,
        encoding: "pcm_s16le",
      });

      // Wire audio chunks → STT provider
      this.audioInput.onAudioChunk((pcm) => {
        this._activeStreamHandle?.pushAudioChunk(pcm);
      });

      // Wire partial transcripts → session
      this._activeStreamHandle.onPartialTranscript((result) => {
        this.session.addTranscriptEntry(
          this.session.createTranscriptEntry("user", result.text, { is_partial: true })
        );
      });

      // Wire final transcript → processing pipeline
      this._activeStreamHandle.onFinalTranscript((text) => {
        this._handleFinalTranscript(text);
      });

      this._activeStreamHandle.onError((err) => {
        console.error("[ConversationAgent] STT error:", err);
        this.stateMachine.send("TRANSCRIPTION_FAILED", { errorMessage: err.message });
        this._cleanup();
      });

      // Auto-stop after maxRecordingTime
      setTimeout(() => {
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

    await this.audioInput.stop();
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
    this._activeStreamHandle?.cancelStream();
    this._activeStreamHandle = null;
    this.audioInput.stop();
    this.audioOutput.bargeIn();
    this.stateMachine.reset();
  }

  /** Confirm a pending action and execute it. */
  async confirm(confirmationId: string): Promise<void> {
    const action = this.session.resolveConfirmation(confirmationId);
    if (!action) return;

    // The original action is stored in payload.original_action for confirm_required type
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

    this.stateMachine.send("REPLY_READY");
    this.session.addTranscriptEntry(
      this.session.createTranscriptEntry("assistant", text)
    );

    try {
      const audioBlob = await this._ttsProvider.synthesize(text);
      await this.audioOutput.play(audioBlob);
    } catch (err) {
      console.error("[ConversationAgent] TTS error:", err);
      this.stateMachine.send("SPEECH_COMPLETE");
    }
  }

  /** Set the user's preferred STT provider and re-resolve. */
  async setPreferredSttProvider(id: string): Promise<void> {
    this._preferredSttId = id;
    await this._resolveProviders();
  }

  /** Set the user's preferred TTS provider and re-resolve. */
  async setPreferredTtsProvider(id: string): Promise<void> {
    this._preferredTtsId = id;
    await this._resolveProviders();
  }

  /** Re-check provider availability (e.g., after server restart). */
  async refreshProviders(): Promise<{ stt: string; tts: string }> {
    await this._resolveProviders();
    return {
      stt: this._sttProvider?.name ?? "None",
      tts: this._ttsProvider?.name ?? "None",
    };
  }

  /** Get availability and active status for every registered provider. */
  async getProviderStatuses(): Promise<ProviderStatuses> {
    const stt = await Promise.all(
      this._sttProviders.map(async (p) => ({
        id: p.id,
        name: p.name,
        available: await p.isAvailable(),
        active: this._sttProvider === p,
      }))
    );
    const tts = await Promise.all(
      this._ttsProviders.map(async (p) => ({
        id: p.id,
        name: p.name,
        available: await p.isAvailable(),
        active: this._ttsProvider === p,
      }))
    );
    return { stt, tts };
  }

  /**
   * Resolve providers: try the user-preferred provider first,
   * then fall back through the priority list.
   */
  private async _resolveProviders(): Promise<void> {
    this._sttProvider = null;
    if (this._preferredSttId) {
      const preferred = this._sttProviders.find((p) => p.id === this._preferredSttId);
      if (preferred && (await preferred.isAvailable())) {
        this._sttProvider = preferred;
      }
    }
    if (!this._sttProvider) {
      for (const p of this._sttProviders) {
        if (await p.isAvailable()) {
          this._sttProvider = p;
          break;
        }
      }
    }

    this._ttsProvider = null;
    if (this._preferredTtsId) {
      const preferred = this._ttsProviders.find((p) => p.id === this._preferredTtsId);
      if (preferred && (await preferred.isAvailable())) {
        this._ttsProvider = preferred;
      }
    }
    if (!this._ttsProvider) {
      for (const p of this._ttsProviders) {
        if (await p.isAvailable()) {
          this._ttsProvider = p;
          break;
        }
      }
    }
  }

  dispose(): void {
    this.cancel();
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

    // Add final transcript to session
    this.session.addTranscriptEntry(
      this.session.createTranscriptEntry("user", text)
    );

    // Transition to thinking
    if (this.stateMachine.canSend("TRANSCRIPT_READY")) {
      this.stateMachine.send("TRANSCRIPT_READY");
    }

    // Route intent
    const action = this.intentRouter.classify(text);

    // Handle based on action type
    if (action.type === "chat_reply") {
      await this._handleChatReply(text);
    } else if (action.type === "confirm_required") {
      this._handleConfirmationRequired(action);
    } else if (isOpenClawAction(action)) {
      await this._executeAction(action);
    } else {
      await this._handleChatReply(text);
    }
  }

  private async _handleChatReply(text: string): Promise<void> {
    try {
      const response = await this.openClaw.chat(text);
      const spoken = this._condenseForSpeech(response);

      this.session.addTranscriptEntry(
        this.session.createTranscriptEntry("assistant", response)
      );

      if (this._ttsProvider && this.stateMachine.canSend("REPLY_READY")) {
        this.stateMachine.send("REPLY_READY");
        const audioBlob = await this._ttsProvider.synthesize(spoken);
        await this.audioOutput.play(audioBlob);
      } else {
        // No TTS — just mark as complete
        if (this.stateMachine.canSend("REPLY_READY")) {
          this.stateMachine.send("REPLY_READY");
        }
        if (this.stateMachine.canSend("SPEECH_COMPLETE")) {
          this.stateMachine.send("SPEECH_COMPLETE");
        }
      }
    } catch (err) {
      console.error("[ConversationAgent] Chat reply error:", err);
      this.stateMachine.send("INTENT_FAILED", {
        errorMessage: err instanceof Error ? err.message : "Chat failed",
      });
      this.stateMachine.send("RESET");
    }
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

    // Speak the confirmation prompt
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

  /**
   * Condense a potentially long text response into something suitable
   * for spoken output — short, clear, no markdown.
   */
  private _condenseForSpeech(text: string): string {
    let cleaned = text
      .replace(/```[\s\S]*?```/g, " (code block omitted) ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_~`#]/g, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\n/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    // Limit to ~300 chars for spoken output
    if (cleaned.length > 300) {
      cleaned = cleaned.slice(0, 297) + "...";
    }

    return cleaned || "Done.";
  }

  private _cleanup(): void {
    this._activeStreamHandle?.cancelStream();
    this._activeStreamHandle = null;
    this.audioInput.stop();
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
