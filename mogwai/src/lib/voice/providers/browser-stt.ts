/**
 * BrowserSttProvider — last-resort STT fallback using the Web Speech API.
 *
 * Uses the browser's built-in SpeechRecognition (Chrome, Edge, etc.).
 * No GPU required, no local server needed, but lower quality than NVIDIA or Whisper.
 */

import type { SpeechToTextProvider, SttStreamHandle } from "./stt-provider";
import type { SttConfig, SttPartialResult } from "../types";

interface NativeSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: any) => void) | null;
}

function getSpeechRecognitionCtor(): (new () => NativeSpeechRecognition) | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

class BrowserStreamHandle implements SttStreamHandle {
  private _recognition: NativeSpeechRecognition | null = null;
  private _onPartial: ((result: SttPartialResult) => void) | null = null;
  private _onFinal: ((text: string, confidence?: number) => void) | null = null;
  private _onError: ((error: Error) => void) | null = null;
  private _finalText = "";
  private _resolve: ((text: string) => void) | null = null;

  constructor(lang: string) {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    this._recognition = new Ctor();
    this._recognition.continuous = false;
    this._recognition.interimResults = true;
    this._recognition.lang = lang;
    this._recognition.maxAlternatives = 1;

    this._recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript?.trim() || "";
        if (result.isFinal) {
          this._finalText = text;
          this._onFinal?.(text, result[0].confidence);
          this._resolve?.(text);
          this._resolve = null;
        } else {
          this._onPartial?.({
            text,
            is_final: false,
            confidence: result[0].confidence,
            timestamp: Date.now(),
          });
        }
      }
    };

    this._recognition.onend = () => {
      if (this._resolve) {
        this._resolve(this._finalText);
        this._resolve = null;
      }
    };

    this._recognition.onerror = (event: any) => {
      this._onError?.(new Error(`SpeechRecognition error: ${event.error}`));
      if (this._resolve) {
        this._resolve(this._finalText);
        this._resolve = null;
      }
    };

    try {
      this._recognition.start();
    } catch { /* ignore start errors */ }
  }

  pushAudioChunk(_pcm: Float32Array | Int16Array): void {
    // Web Speech API captures its own audio — push is a no-op
  }

  async endStream(): Promise<string> {
    return new Promise<string>((resolve) => {
      this._resolve = resolve;
      try {
        this._recognition?.stop();
      } catch {
        resolve(this._finalText);
      }
    });
  }

  cancelStream(): void {
    try {
      this._recognition?.abort();
    } catch { /* ignore */ }
    this._resolve?.("");
    this._resolve = null;
  }

  onPartialTranscript(cb: (result: SttPartialResult) => void): void {
    this._onPartial = cb;
  }

  onFinalTranscript(cb: (text: string, confidence?: number) => void): void {
    this._onFinal = cb;
  }

  onError(cb: (error: Error) => void): void {
    this._onError = cb;
  }
}

export class BrowserSttProvider implements SpeechToTextProvider {
  readonly id = "browser";
  readonly name = "Browser Speech Recognition (Fallback)";

  async initialize(): Promise<void> { /* no-op */ }

  async isAvailable(): Promise<boolean> {
    return !!getSpeechRecognitionCtor();
  }

  startStream(config?: Partial<SttConfig>): SttStreamHandle {
    return new BrowserStreamHandle(config?.language ?? "en-US");
  }

  async transcribe(_audio: Blob): Promise<string> {
    throw new Error("Browser SpeechRecognition does not support batch transcription of audio blobs");
  }

  dispose(): void { /* no-op */ }
}
