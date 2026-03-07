import { invoke } from "@tauri-apps/api/core";

export type VoiceState = "idle" | "listening" | "processing" | "speaking";

export interface VoiceConfig {
  wakeWord: string;
  sttModel: string;
  ttsVoice: string;
  silenceThreshold: number;
  maxRecordingTime: number;
}

const defaultConfig: VoiceConfig = {
  wakeWord: "hey crystal",
  sttModel: "whisper-large-v3",
  ttsVoice: "nova",
  silenceThreshold: 1500,
  maxRecordingTime: 30000,
};

class VoiceService {
  private config: VoiceConfig = defaultConfig;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private isListening: boolean = false;
  private onStateChange: ((state: VoiceState) => void) | null = null;
  private onTranscript: ((text: string) => void) | null = null;
  private whisperEndpoint: string = "http://127.0.0.1:8080/inference";
  private ttsEndpoint: string = "http://127.0.0.1:8081/tts";

  setConfig(config: Partial<VoiceConfig>) {
    this.config = { ...this.config, ...config };
  }

  getConfig(): VoiceConfig {
    return this.config;
  }

  onStateChangeCallback(callback: (state: VoiceState) => void) {
    this.onStateChange = callback;
  }

  onTranscriptCallback(callback: (text: string) => void) {
    this.onTranscript = callback;
  }

  private setState(state: VoiceState) {
    if (this.onStateChange) {
      this.onStateChange(state);
    }
  }

  async startListening(): Promise<void> {
    if (this.isListening) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        }
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      this.audioChunks = [];
      this.isListening = true;
      this.setState("listening");

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioChunks = [];
        
        if (audioBlob.size > 0) {
          this.setState("processing");
          await this.transcribe(audioBlob);
        }
        
        this.setState("idle");
      };

      this.mediaRecorder.start(100);

      setTimeout(() => {
        if (this.isListening) {
          this.stopListening();
        }
      }, this.config.maxRecordingTime);

    } catch (error) {
      console.error("Failed to start listening:", error);
      this.setState("idle");
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isListening || !this.mediaRecorder) return;

    this.isListening = false;
    this.mediaRecorder.stop();
    this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    this.mediaRecorder = null;
  }

  private async transcribe(audioBlob: Blob): Promise<string> {
    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('response_format', 'json');

      const response = await fetch(this.whisperEndpoint, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Whisper API error: ${response.statusText}`);
      }

      const data = await response.json();
      const transcript = data.text || '';

      if (transcript && this.onTranscript) {
        this.onTranscript(transcript);
      }

      return transcript;
    } catch (error) {
      console.error("Transcription failed:", error);
      return '';
    }
  }

  async speak(text: string): Promise<void> {
    this.setState("speaking");

    try {
      const response = await fetch(this.ttsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          voice: this.config.ttsVoice,
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.statusText}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);

      return new Promise((resolve, reject) => {
        audio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.setState("idle");
          resolve();
        };
        audio.onerror = (e) => {
          URL.revokeObjectURL(audioUrl);
          this.setState("idle");
          reject(e);
        };
        audio.play();
      });
    } catch (error) {
      console.error("TTS failed:", error);
      this.setState("idle");
      
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        speechSynthesis.speak(utterance);
        
        return new Promise((resolve) => {
          utterance.onend = () => {
            this.setState("idle");
            resolve();
          };
        });
      }
    }
  }

  setWhisperEndpoint(endpoint: string) {
    this.whisperEndpoint = endpoint;
  }

  setTTSEndpoint(endpoint: string) {
    this.ttsEndpoint = endpoint;
  }

  async checkWhisperConnection(): Promise<boolean> {
    try {
      const raw = await invoke<string>("http_proxy", {
        method: "GET",
        url: this.whisperEndpoint.replace("/inference", "/health"),
        body: null, headers: null,
      });
      const r = JSON.parse(raw);
      return r.status >= 200 && r.status < 300;
    } catch { return false; }
  }

  async checkTTSConnection(): Promise<boolean> {
    try {
      const raw = await invoke<string>("http_proxy", {
        method: "GET",
        url: this.ttsEndpoint.replace("/tts", "/health"),
        body: null, headers: null,
      });
      const r = JSON.parse(raw);
      return r.status >= 200 && r.status < 300;
    } catch { return false; }
  }

  async waitForServers(maxWaitMs: number = 30000): Promise<{ whisper: boolean; tts: boolean }> {
    const startTime = Date.now();
    let whisperReady = false;
    let ttsReady = false;

    while (Date.now() - startTime < maxWaitMs) {
      if (!whisperReady) {
        whisperReady = await this.checkWhisperConnection();
      }
      if (!ttsReady) {
        ttsReady = await this.checkTTSConnection();
      }

      if (whisperReady && ttsReady) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return { whisper: whisperReady, tts: ttsReady };
  }
}

export const voiceService = new VoiceService();
