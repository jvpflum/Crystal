/**
 * WhisperSttProvider — fallback STT provider wrapping the existing
 * Whisper FastAPI server on port 8080 (scripts/whisper_server.py).
 *
 * This is a batch-only provider (no streaming). Audio is recorded as a blob,
 * then POST'd to /inference. Kept for migration compatibility.
 */

import type { SpeechToTextProvider, SttStreamHandle } from "./stt-provider";
import type { SttConfig, SttPartialResult } from "../types";

const WHISPER_PORT = 8080;
const WHISPER_URL = `http://127.0.0.1:${WHISPER_PORT}`;

/**
 * Simulates a streaming handle over the batch Whisper API.
 * Collects all audio chunks, then sends them as a single blob on endStream().
 */
class WhisperBatchStreamHandle implements SttStreamHandle {
  private _chunks: Int16Array[] = [];
  private _onFinal: ((text: string, confidence?: number) => void) | null = null;
  private _onError: ((error: Error) => void) | null = null;
  private _cancelled = false;

  pushAudioChunk(pcm: Float32Array | Int16Array): void {
    if (this._cancelled) return;
    const i16 = pcm instanceof Float32Array
      ? new Int16Array(pcm.length).map((_, i) => Math.max(-32768, Math.min(32767, pcm[i] * 32768)))
      : pcm;
    this._chunks.push(i16);
  }

  async endStream(): Promise<string> {
    if (this._cancelled || this._chunks.length === 0) return "";

    const totalLen = this._chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Int16Array(totalLen);
    let offset = 0;
    for (const chunk of this._chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBlob = pcmToWav(merged, 16000);
    const formData = new FormData();
    formData.append("file", wavBlob, "audio.wav");

    try {
      const resp = await fetch(`${WHISPER_URL}/inference`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) throw new Error(`Whisper API error: ${resp.statusText}`);
      const data = await resp.json();
      const text = (data.text || "").trim();
      this._onFinal?.(text);
      return text;
    } catch (err) {
      this._onError?.(err instanceof Error ? err : new Error(String(err)));
      return "";
    }
  }

  cancelStream(): void {
    this._cancelled = true;
    this._chunks = [];
  }

  onPartialTranscript(_cb: (result: SttPartialResult) => void): void {
    // Whisper batch mode does not produce partial transcripts
  }

  onFinalTranscript(cb: (text: string, confidence?: number) => void): void {
    this._onFinal = cb;
  }

  onError(cb: (error: Error) => void): void {
    this._onError = cb;
  }
}

export class WhisperSttProvider implements SpeechToTextProvider {
  readonly id = "whisper";
  readonly name = "Whisper STT (Fallback)";

  async initialize(): Promise<void> { /* no-op */ }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(`${WHISPER_URL}/health`, { signal: AbortSignal.timeout(2000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  startStream(_config?: Partial<SttConfig>): SttStreamHandle {
    return new WhisperBatchStreamHandle();
  }

  async transcribe(audio: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("file", audio, "audio.webm");

    const resp = await fetch(`${WHISPER_URL}/inference`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) throw new Error(`Whisper API error: ${resp.statusText}`);
    const data = await resp.json();
    return (data.text || "").trim();
  }

  dispose(): void { /* no-op */ }
}

/** Minimal PCM-to-WAV encoder for sending raw audio to Whisper. */
function pcmToWav(pcm: Int16Array, sampleRate: number): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const dataLen = pcm.length * 2;

  // RIFF header
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLen, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);       // chunk size
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample
  writeStr(view, 36, "data");
  view.setUint32(40, dataLen, true);

  return new Blob([header, pcm.buffer], { type: "audio/wav" });
}

function writeStr(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
