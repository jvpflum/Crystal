/**
 * NvidiaMagpieTtsProvider
 *
 * Concrete TTS provider targeting local GPU inference with:
 *   nvidia/magpie_tts_multilingual_357m
 *
 * Connects to a local Python HTTP worker (nvidia_tts_worker.py) on port 8091.
 *
 * Optimizations:
 *   - Cached health check results (5s TTL) to avoid redundant pings
 *   - Reduced timeouts for faster failure detection
 */

import type { TextToSpeechProvider } from "./tts-provider";
import type { TtsOptions, VoiceInfo } from "../types";
import { TtsBridge } from "../bridge/speech-bridge";

const GATEWAY_PORT = 6500;
const MAGPIE_TTS_PORT = 8091;
const GATEWAY_HTTP_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
const DIRECT_HTTP_URL = `http://127.0.0.1:${MAGPIE_TTS_PORT}`;
const HEALTH_CACHE_TTL_MS = 5000;

export class NvidiaMagpieTtsProvider implements TextToSpeechProvider {
  readonly id = "nvidia-magpie";
  readonly name = "NVIDIA Magpie TTS (Local GPU)";

  private _bridge: TtsBridge;
  private _available = false;
  private _voices: VoiceInfo[] = [];
  private _lastHealthCheck = 0;
  private _lastHealthResult = false;
  private _useGateway = false;

  constructor() {
    this._bridge = new TtsBridge({ ttsHttpUrl: DIRECT_HTTP_URL });
  }

  async initialize(): Promise<void> {
    this._available = await this.isAvailable();
    if (this._available) {
      const via = this._useGateway ? "Voice Gateway (:6500)" : `direct (:${MAGPIE_TTS_PORT})`;
      console.log(`[NvidiaMagpieTTS] Available via ${via}`);
      // Re-create bridge with correct URL
      const url = this._useGateway ? GATEWAY_HTTP_URL : DIRECT_HTTP_URL;
      this._bridge = new TtsBridge({ ttsHttpUrl: url });
      this._voices = await this.getVoices();
    } else {
      console.warn("[NvidiaMagpieTTS] Not available");
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

  async synthesize(text: string, options?: TtsOptions): Promise<Blob> {
    if (this._useGateway) {
      const resp = await fetch(`${GATEWAY_HTTP_URL}/tts/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: options?.voice ?? "sofia",
          speed: options?.speed ?? 1.0,
          sample_rate: options?.sampleRate,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`TTS gateway error: ${resp.statusText}`);
      return resp.blob();
    }
    return this._bridge.synthesize({
      text,
      voice: options?.voice,
      speed: options?.speed,
      sample_rate: options?.sampleRate,
    });
  }

  async *synthesizeStream(text: string, options?: TtsOptions): AsyncGenerator<ArrayBuffer> {
    yield* this._bridge.synthesizeStream({
      text,
      voice: options?.voice,
      speed: options?.speed,
      sample_rate: options?.sampleRate,
    });
  }

  async getVoices(): Promise<VoiceInfo[]> {
    if (this._voices.length > 0) return this._voices;

    if (this._useGateway) {
      try {
        const resp = await fetch(`${GATEWAY_HTTP_URL}/capabilities`, {
          signal: AbortSignal.timeout(3000),
        });
        if (resp.ok) {
          const data = await resp.json();
          this._voices = (data.voices ?? []).map((v: { id: string; name: string; language?: string }) => ({
            id: v.id,
            name: v.name,
            language: v.language,
          }));
          return this._voices;
        }
      } catch {
        // fall through to direct
      }
    }

    const raw = await this._bridge.getVoices();
    this._voices = raw.map((v) => ({
      id: v.id,
      name: v.name,
      language: v.language,
    }));
    return this._voices;
  }

  dispose(): void {
    this._available = false;
    this._voices = [];
  }
}
