/**
 * Bridge layer between the TypeScript app and local Python GPU speech workers.
 *
 * STT: WebSocket — bidirectional streaming (audio in, transcripts out)
 * TTS: HTTP — request/response (text in, audio out)
 *
 * Optimizations:
 *   - Pre-connection audio buffering: chunks queued before WS opens are flushed on connect
 *   - 2s localhost connection timeout (down from 5s)
 *   - Correct ArrayBuffer slicing for typed array views
 *   - Connection-ready promise for callers to await
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

// Voice Gateway on port 6500 is the primary entry point.
// Falls back to direct NVIDIA ports if gateway is not available.
export const DEFAULT_BRIDGE_CONFIG: SpeechBridgeConfig = {
  sttWsUrl: "ws://127.0.0.1:6500/stt/realtime",
  ttsHttpUrl: "http://127.0.0.1:6500",
  reconnectIntervalMs: 3000,
  healthCheckIntervalMs: 15000,
  connectionTimeoutMs: 2000,
};

export const DIRECT_NVIDIA_CONFIG: SpeechBridgeConfig = {
  sttWsUrl: "ws://127.0.0.1:8090/ws",
  ttsHttpUrl: "http://127.0.0.1:8091",
  reconnectIntervalMs: 3000,
  healthCheckIntervalMs: 15000,
  connectionTimeoutMs: 2000,
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

  // Pre-connection audio buffer: chunks queued before WS is ready
  private _pendingChunks: ArrayBuffer[] = [];
  private _streamReady = false;

  // Resolves when the WS connection is established and streaming
  private _readyPromise: Promise<boolean>;
  private _readyResolve: ((ok: boolean) => void) | null = null;

  constructor(config?: Partial<SpeechBridgeConfig>) {
    this._config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
    this._readyPromise = new Promise((r) => { this._readyResolve = r; });
  }

  get state(): SttBridgeState {
    return this._state;
  }

  /** Returns a promise that resolves true when WS is streaming, false on failure. */
  get ready(): Promise<boolean> {
    return this._readyPromise;
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

    this._pendingChunks = [];
    this._streamReady = false;
    this._readyPromise = new Promise((r) => { this._readyResolve = r; });
    this._setState("connecting");

    const timeout = setTimeout(() => {
      this._ws?.close();
      this._setState("error");
      this._onError?.("STT connection timeout");
      this._readyResolve?.(false);
      this._readyResolve = null;
    }, this._config.connectionTimeoutMs);

    try {
      this._ws = new WebSocket(this._config.sttWsUrl);
      this._ws.binaryType = "arraybuffer";

      this._ws.onopen = () => {
        clearTimeout(timeout);
        this._setState("connected");

        this._ws!.send(JSON.stringify({
          type: "start",
          config: {
            sample_rate: sttConfig?.sampleRate ?? 16000,
            encoding: sttConfig?.encoding ?? "pcm_s16le",
            language: sttConfig?.language ?? "en",
            vad_enabled: sttConfig?.vadEnabled ?? true,
          },
        }));

        this._setState("streaming");
        this._streamReady = true;

        // Flush any audio chunks that arrived before the WS was ready
        for (const buf of this._pendingChunks) {
          this._ws!.send(buf);
        }
        this._pendingChunks = [];

        this._readyResolve?.(true);
        this._readyResolve = null;
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
        this._readyResolve?.(false);
        this._readyResolve = null;
      };

      this._ws.onclose = () => {
        if (this._state === "streaming") {
          this._setState("disconnected");
        }
        this._streamReady = false;
      };

      // Return immediately — callers can await .ready if they need to
      return true;
    } catch (err) {
      clearTimeout(timeout);
      this._setState("error");
      this._onError?.(`Failed to create WebSocket: ${err}`);
      this._readyResolve?.(false);
      this._readyResolve = null;
      return false;
    }
  }

  /**
   * Push a chunk of PCM audio to the STT worker.
   * If the WS isn't ready yet, buffers the chunk for flushing on connect.
   */
  pushAudioChunk(pcm: Int16Array | Float32Array): void {
    // Correct buffer slicing: extract only the typed array's view, not the entire backing buffer
    const buf = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);

    if (this._streamReady && this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(buf);
    } else if (this._state === "connecting") {
      // Buffer for flush after connection
      this._pendingChunks.push(buf);
    }
  }

  /** Signal end of audio stream and wait for final transcript. */
  async endStream(): Promise<void> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const msg: SttBridgeMessage = { type: "end" };
    this._ws.send(JSON.stringify(msg));
  }

  /** Cancel the current stream without waiting for results. */
  cancelStream(): void {
    this._pendingChunks = [];
    this._streamReady = false;
    if (!this._ws) return;
    try {
      if (this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: "cancel" } as SttBridgeMessage));
      }
      this._ws.close();
    } catch { /* ignore close errors */ }
    this._ws = null;
    this._setState("disconnected");
  }

  /** Health-check via HTTP /health endpoint. */
  async checkHealth(): Promise<boolean> {
    try {
      // Derive HTTP base from WS URL: strip protocol and path to get host:port
      const base = this._config.sttWsUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://")
        .replace(/\/stt\/realtime\/?$/, "")
        .replace(/\/ws\/?$/, "");
      const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
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
    // Use /tts/speak if talking to voice gateway, /synthesize if direct NVIDIA
    const isGateway = this._config.ttsHttpUrl.includes("6500");
    const endpoint = isGateway ? "/tts/speak" : "/synthesize";
    const url = `${this._config.ttsHttpUrl}${endpoint}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      throw new Error(`TTS synthesis failed (${resp.status}): ${errText}`);
    }

    return resp.blob();
  }

  /** Streaming synthesis — returns an async iterator of audio chunks. */
  async *synthesizeStream(request: TtsSynthesizeRequest): AsyncGenerator<ArrayBuffer> {
    const isGateway = this._config.ttsHttpUrl.includes("6500");
    const endpoint = isGateway ? "/tts/speak" : "/synthesize/stream";
    const url = `${this._config.ttsHttpUrl}${endpoint}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, stream: true }),
      signal: AbortSignal.timeout(15000),
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
        signal: AbortSignal.timeout(3000),
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
        signal: AbortSignal.timeout(1500),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}
