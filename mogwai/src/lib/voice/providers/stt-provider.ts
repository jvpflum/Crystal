import type { SttConfig, SttPartialResult } from "../types";

export interface SttStreamHandle {
  pushAudioChunk(pcm: Float32Array | Int16Array): void;
  endStream(): Promise<string>;
  cancelStream(): void;
  onPartialTranscript(cb: (result: SttPartialResult) => void): void;
  onFinalTranscript(cb: (text: string, confidence?: number) => void): void;
  onError(cb: (error: Error) => void): void;
}

export interface SpeechToTextProvider {
  readonly id: string;
  readonly name: string;

  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;

  startStream(config?: Partial<SttConfig>): SttStreamHandle;

  /** Batch transcription for non-streaming fallbacks */
  transcribe(audio: Blob): Promise<string>;

  dispose(): void;
}
