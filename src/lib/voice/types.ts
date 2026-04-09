// ── Voice States ────────────────────────────────────────────────

export type VoiceState =
  | "idle"
  | "listening"
  | "processing"
  | "transcribing"
  | "thinking"
  | "awaiting_confirmation"
  | "executing"
  | "speaking"
  | "error";

// ── State Machine Events ───────────────────────────────────────

export type VoiceEvent =
  | "START_LISTENING"
  | "AUDIO_COMPLETE"
  | "CANCEL"
  | "TRANSCRIPT_READY"
  | "TRANSCRIPTION_FAILED"
  | "REPLY_READY"
  | "CONFIRM_REQUIRED"
  | "TASK_DISPATCHED"
  | "INTENT_FAILED"
  | "USER_CONFIRMED"
  | "USER_CANCELLED"
  | "EXECUTION_COMPLETE"
  | "EXECUTION_FAILED"
  | "SPEECH_COMPLETE"
  | "BARGE_IN"
  | "RESET";

// ── Structured Actions ─────────────────────────────────────────

export type ActionType =
  | "chat_reply"
  | "openclaw_task"
  | "openclaw_command"
  | "confirm_required"
  | "cancel_task";

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";

export type ActionSource = "intent_router" | "openclaw" | "conversation_agent";

export interface StructuredAction {
  id: string;
  type: ActionType;
  confidence: number;
  risk_level: RiskLevel;
  user_visible_message: string;
  task_id?: string;
  source: ActionSource;
  created_at: number;
  completed_at?: number;
  payload?: Record<string, unknown>;
}

export interface ActionResult {
  id: string;
  action_id: string;
  success: boolean;
  output?: string;
  error?: string;
  timestamps: {
    queued: number;
    started?: number;
    completed?: number;
  };
}

// ── Transcript ─────────────────────────────────────────────────

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  timestamp: number;
  is_partial: boolean;
  action?: StructuredAction;
}

// ── Task Tracking ──────────────────────────────────────────────

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ActiveTask {
  id: string;
  action: StructuredAction;
  status: TaskStatus;
  progress?: number;
  output?: string;
  error?: string;
  started_at: number;
  completed_at?: number;
}

// ── Pending Confirmation ───────────────────────────────────────

export interface PendingConfirmation {
  id: string;
  action: StructuredAction;
  description: string;
  risk_level: RiskLevel;
  expires_at?: number;
}

// ── Voice Configuration ────────────────────────────────────────

export interface VoiceConfig {
  wakeWord: string;
  sttProvider: string;
  ttsProvider: string;
  ttsVoice: string;
  silenceThreshold: number;
  maxRecordingTime: number;
  sampleRate: number;
  enableBargeIn: boolean;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  wakeWord: "hey crystal",
  sttProvider: "nvidia-nemotron",
  ttsProvider: "nvidia-magpie",
  ttsVoice: "default",
  silenceThreshold: 1500,
  maxRecordingTime: 30000,
  sampleRate: 16000,
  enableBargeIn: true,
};

// ── STT Types ──────────────────────────────────────────────────

export interface SttConfig {
  sampleRate: number;
  encoding: "pcm_s16le" | "pcm_f32le";
  language?: string;
  vadEnabled?: boolean;
}

export const DEFAULT_STT_CONFIG: SttConfig = {
  sampleRate: 16000,
  encoding: "pcm_s16le",
  language: "en",
  vadEnabled: true,
};

export interface SttPartialResult {
  text: string;
  is_final: boolean;
  confidence?: number;
  timestamp: number;
}

// ── TTS Types ──────────────────────────────────────────────────

export interface TtsOptions {
  voice?: string;
  speed?: number;
  sampleRate?: number;
}

export interface VoiceInfo {
  id: string;
  name: string;
  language?: string;
  gender?: string;
}

// ── Bridge Protocol Messages ───────────────────────────────────

export type SttBridgeMessage =
  | { type: "start"; config: SttConfig }
  | { type: "end" }
  | { type: "cancel" };

export type SttBridgeResponse =
  | { type: "partial"; text: string; confidence?: number }
  | { type: "final"; text: string; confidence?: number; duration?: number }
  | { type: "error"; message: string }
  | { type: "ready" };

export type TtsSynthesizeRequest = {
  text: string;
  voice?: string;
  speed?: number;
  sample_rate?: number;
  stream?: boolean;
};

// ── Event Emitter ──────────────────────────────────────────────

export type VoiceSystemEvent =
  | { kind: "state_change"; from: VoiceState; to: VoiceState; event: VoiceEvent }
  | { kind: "transcript"; entry: TranscriptEntry }
  | { kind: "action"; action: StructuredAction }
  | { kind: "action_result"; result: ActionResult }
  | { kind: "task_update"; task: ActiveTask }
  | { kind: "confirmation_request"; confirmation: PendingConfirmation }
  | { kind: "error"; message: string; recoverable: boolean };

export type VoiceSystemEventHandler = (event: VoiceSystemEvent) => void;

// ── Provider Status ────────────────────────────────────────────

export interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  active: boolean;
}

export interface ProviderStatuses {
  stt: ProviderStatus[];
  tts: ProviderStatus[];
}
