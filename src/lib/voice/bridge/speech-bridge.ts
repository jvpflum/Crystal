/**
 * Bridge layer between the TypeScript app and local Python GPU speech workers.
 *
 * Design choice: WebSocket for STT, HTTP for TTS.
 *
 * STT uses WebSocket because streaming ASR requires pushing audio chunks
 * continuously and receiving partial transcripts back in real-time.
 * HTTP request/response cannot support this bidirectional flow.
 *
 * TTS uses HTTP because synthesis is request/response shaped (text in, audio out).
 * HTTP streaming response handles progressive playback, and it's simpler to debug
 * than a second persistent WebSocket.
 */

import type {
  SttConfig,
  SttBridgeMessage,
  SttBridgeResponse,
  TtsSynthesizeRequest,
} from "../types";

// ── Configuration ──────────────────────────────────────────────

export interface SpeechBridgeConfig {
  sttWsUrl: string;
  ttsHttpUrl: string;
  reconnectIntervalMs: number;
  healthCheckIntervalMs: number;
  connectionTimeoutMs: number;
}

export const DEFAULT_BRIDGE_CONFIG: SpeechBridgeConfig = {
  sttWsUrl: "ws://127.0.0.1:8090",
  ttsHttpUrl: "http://127.0.0.1:8091",
  reconnectIntervalMs: 3000,
  healthCheckIntervalMs: 15000,
  connectionTimeoutMs: 5000,
};

// ── STT Bridge (WebSocket) ─────────────────────────────────────

export type SttBridgeState = "disconnected" | "connecting" | "connected" | "streaming" | "error";

export class SttBridge {
  private _ws: WebSocket | null = null;
  private _state: SttBridgeState = "disconnected";
  private _config: SpeechBridgeConfig;

  private _onPartial: ((text: string, confidence?: number) => void) | null = null;
  private _onFinal: ((text: string, confidence?: number, duration?: number) => void) | null = null;
  private _onError: ((error: string) => void) | null = null;
  private _onStateChange: ((state: SttBridgeState) => void) | null = null;

  constructor(config?: Partial<SpeechBridgeConfig>) {
    this._config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
  }

  get state(): SttBridgeState {
    return this._state;
  }

  onPartialTranscript(cb: (text: string, confidence?: number) => void): void {
    this._onPartial = cb;
  }

  onFinalTranscript(cb: (text: string, confidence?: number, duration?: number) => void): void {
    this._onFinal = cb;
  }

  onError(cb: (error: string) => void): void {
    this._onError = cb;
  }

  onStateChange(cb: (state: SttBridgeState) => void): void {
    this._onStateChange = cb;
  }

  /** Open a new streaming session to the STT worker. */
  async startStream(sttConfig?: Partial<SttConfig>): Promise<boolean> {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.close();
    }

    return new Promise((resolve) => {
      this._setState("connecting");

      const timeout = setTimeout(() => {
        this._ws?.close();
        this._setState("error");
        this._onError?.("STT connection timeout");
        resolve(false);
      }, this._config.connectionTimeoutMs);

      try {
        this._ws = new WebSocket(this._config.sttWsUrl);
        this._ws.binaryType = "arraybuffer";

        this._ws.onopen = () => {
          clearTimeout(timeout);
          this._setState("connected");

          const startMsg = {
            type: "start",
            config: {
              sample_rate: sttConfig?.sampleRate ?? 16000,
              encoding: sttConfig?.encoding ?? "pcm_s16le",
              language: sttConfig?.language ?? "en",
              vad_enabled: sttConfig?.vadEnabled ?? true,
            },
          };
          this._ws!.send(JSON.stringify(startMsg));
          this._setState("streaming");
          resolve(true);
        };

        this._ws.onmessage = (event) => {
          try {
            const msg: SttBridgeResponse = JSON.parse(event.data as string);
            switch (msg.type) {
              case "partial":
                this._onPartial?.(msg.text, msg.confidence);
                break;
              case "final":
                this._onFinal?.(msg.text, msg.confidence, msg.duration);
                break;
              case "error":
                this._onError?.(msg.message);
                break;
              case "ready":
                break;
            }
          } catch {
            console.warn("[SttBridge] Failed to parse server message");
          }
        };

        this._ws.onerror = () => {
          clearTimeout(timeout);
          this._setState("error");
          this._onError?.("WebSocket connection error");
          resolve(false);
        };

        this._ws.onclose = () => {
          if (this._state === "streaming") {
            this._setState("disconnected");
          }
        };
      } catch (err) {
        clearTimeout(timeout);
        this._setState("error");
        this._onError?.(`Failed to create WebSocket: ${err}`);
        resolve(false);
      }
    });
  }

  /** Push a chunk of PCM audio to the STT worker. */
  pushAudioChunk(pcm: Int16Array | Float32Array): void {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN || this._state !== "streaming") {
      return;
    }
    this._ws.send(pcm.buffer);
  }

  /** Signal end of audio stream and wait for final transcript. */
  async endStream(): Promise<void> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const msg: SttBridgeMessage = { type: "end" };
    this._ws.send(JSON.stringify(msg));
  }

  /** Cancel the current stream without waiting for results. */
  cancelStream(): void {
    if (!this._ws) return;
    try {
      if (this._ws.readyState === WebSocket.OPEN) {
        const msg: SttBridgeMessage = { type: "cancel" };
        this._ws.send(JSON.stringify(msg));
      }
      this._ws.close();
    } catch { /* ignore close errors */ }
    this._ws = null;
    this._setState("disconnected");
  }

  /** Health-check: try connecting and immediately disconnect. */
  async checkHealth(): Promise<boolean> {
    try {
      const healthUrl = this._config.sttWsUrl.replace("ws://", "http://").replace("wss://", "https://") + "/health";
      const resp = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.cancelStream();
  }

  private _setState(state: SttBridgeState): void {
    this._state = state;
    this._onStateChange?.(state);
  }
}

// ── TTS Bridge (HTTP) ──────────────────────────────────────────

export class TtsBridge {
  private _config: SpeechBridgeConfig;

  constructor(config?: Partial<SpeechBridgeConfig>) {
    this._config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
  }

  /** Synthesize text to audio. Returns a WAV/PCM blob. */
  async synthesize(request: TtsSynthesizeRequest): Promise<Blob> {
    const url = `${this._config.ttsHttpUrl}/synthesize`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`TTS synthesis failed (${resp.status}): ${errText}`);
    }

    return resp.blob();
  }

  /** Streaming synthesis — returns an async iterator of audio chunks. */
  async *synthesizeStream(request: TtsSynthesizeRequest): AsyncGenerator<ArrayBuffer> {
    const url = `${this._config.ttsHttpUrl}/synthesize/stream`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, stream: true }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`TTS streaming synthesis failed (${resp.status}): ${errText}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body for streaming TTS");

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value.buffer;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Get available voices from the TTS worker. */
  async getVoices(): Promise<Array<{ id: string; name: string; language?: string }>> {
    try {
      const resp = await fetch(`${this._config.ttsHttpUrl}/voices`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];
      const data = await resp.json();
      return data.voices ?? [];
    } catch {
      return [];
    }
  }

  /** Health check. */
  async checkHealth(): Promise<boolean> {
    try {
      const resp = await fetch(`${this._config.ttsHttpUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
