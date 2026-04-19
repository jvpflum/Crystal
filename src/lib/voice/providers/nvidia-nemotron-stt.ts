/**
 * NvidiaNemotronSpeechProvider
 *
 * Concrete STT provider targeting local GPU inference with:
 *   nvidia/parakeet-ctc-0.6b (NeMo ASR streaming model)
 *
 * Connects to a local Python WebSocket worker (nvidia_stt_worker.py) on port 8090,
 * or via the unified Voice Gateway on port 6500.
 *
 * Brand note: Crystal surfaces this as "NVIDIA Parakeet" in the UI because that is the
 * deployed model identifier. The class name remains NvidiaNemotronSpeechProvider to keep
 * the NeMo-framework association clear for engineers (NeMo = NVIDIA's framework; Parakeet
 * is a specific NeMo ASR model family).
 */

import type { SpeechToTextProvider, SttStreamHandle } from "./stt-provider";
import type { SttConfig, SttPartialResult } from "../types";
import { DEFAULT_STT_CONFIG } from "../types";
import { SttBridge } from "../bridge/speech-bridge";

const GATEWAY_PORT = 6500;
const NEMOTRON_STT_PORT = 8090;
const GATEWAY_WS_URL = `ws://127.0.0.1:${GATEWAY_PORT}/stt/realtime`;
const GATEWAY_HTTP_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const DIRECT_WS_URL = `ws://127.0.0.1:${NEMOTRON_STT_PORT}/ws`;
const DIRECT_HTTP_URL = `http://127.0.0.1:${NEMOTRON_STT_PORT}`;

const END_STREAM_TIMEOUT_MS = 4000;
const HEALTH_CACHE_TTL_MS = 5000;

class NemotronStreamHandle implements SttStreamHandle {
  private _bridge: SttBridge;
  private _finalText = "";
  private _ended = false;

  // Separate callback lists — endStream doesn't clobber user-set callbacks
  private _userFinalCb: ((text: string, confidence?: number) => void) | null = null;
  private _endResolve: ((text: string) => void) | null = null;

  constructor(bridge: SttBridge) {
    this._bridge = bridge;

    // Wire final transcript from bridge to BOTH user callback and endStream promise
    this._bridge.onFinalTranscript((text, confidence) => {
      this._finalText = text;
      this._userFinalCb?.(text, confidence);
      this._endResolve?.(text);
      this._endResolve = null;
    });
  }

  pushAudioChunk(pcm: Float32Array | Int16Array): void {
    if (this._ended) return;
    this._bridge.pushAudioChunk(pcm);
  }

  async endStream(): Promise<string> {
    if (this._ended) return this._finalText;
    this._ended = true;

    return new Promise<string>((resolve) => {
      this._endResolve = resolve;
      this._bridge.endStream();

      setTimeout(() => {
        if (this._endResolve) {
          this._endResolve(this._finalText);
          this._endResolve = null;
        }
      }, END_STREAM_TIMEOUT_MS);
    });
  }

  cancelStream(): void {
    this._ended = true;
    this._bridge.cancelStream();
    if (this._endResolve) {
      this._endResolve("");
      this._endResolve = null;
    }
  }

  onPartialTranscript(cb: (result: SttPartialResult) => void): void {
    this._bridge.onPartialTranscript((text, confidence) => {
      cb({
        text,
        is_final: false,
        confidence,
        timestamp: Date.now(),
      });
    });
  }

  onFinalTranscript(cb: (text: string, confidence?: number) => void): void {
    this._userFinalCb = cb;
  }

  onError(cb: (error: Error) => void): void {
    this._bridge.onError((msg) => cb(new Error(msg)));
  }
}

export class NvidiaNemotronSpeechProvider implements SpeechToTextProvider {
  readonly id = "nvidia-nemotron";
  readonly name = "NVIDIA Parakeet (NeMo ASR)";

  private _available = false;
  private _lastHealthCheck = 0;
  private _lastHealthResult = false;
  private _useGateway = false;

  async initialize(): Promise<void> {
    this._available = await this.isAvailable();
    if (this._available) {
      const via = this._useGateway ? "Voice Gateway (:6500)" : `direct (:${NEMOTRON_STT_PORT})`;
      if (import.meta.env.DEV) console.log(`[NvidiaNemotronSTT] Available via ${via}`);
    } else {
      if (import.meta.env.DEV) console.warn("[NvidiaNemotronSTT] Not available");
    }
  }

  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - this._lastHealthCheck < HEALTH_CACHE_TTL_MS) {
      return this._lastHealthResult;
    }

    // Try Voice Gateway first, fall back to direct NVIDIA port
    for (const [url, isGateway] of [
      [GATEWAY_HTTP_URL, true],
      [DIRECT_HTTP_URL, false],
    ] as const) {
      try {
        const resp = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.status === "ok") {
            this._useGateway = isGateway;
            this._lastHealthResult = true;
            this._lastHealthCheck = now;
            return true;
          }
        }
      } catch {
        // try next
      }
    }

    this._lastHealthResult = false;
    this._lastHealthCheck = now;
    return false;
  }

  startStream(config?: Partial<SttConfig>): SttStreamHandle {
    const wsUrl = this._useGateway ? GATEWAY_WS_URL : DIRECT_WS_URL;
    const bridge = new SttBridge({ sttWsUrl: wsUrl });

    // Wire callbacks BEFORE starting the stream to prevent race conditions
    const handle = new NemotronStreamHandle(bridge);

    const mergedConfig: SttConfig = { ...DEFAULT_STT_CONFIG, ...config };
    bridge.startStream(mergedConfig);

    return handle;
  }

  async transcribe(audio: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("file", audio, "audio.wav");

    const baseUrl = this._useGateway ? GATEWAY_HTTP_URL : DIRECT_HTTP_URL;
    const endpoint = this._useGateway ? "/stt/transcribe" : "/transcribe";
    const resp = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      throw new Error(`Nemotron batch transcription failed: ${resp.statusText}`);
    }

    const data = await resp.json();
    return data.text || "";
  }

  dispose(): void {
    this._available = false;
  }
}
