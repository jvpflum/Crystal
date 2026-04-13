import { useState, useEffect, useCallback, useRef } from "react";
import { voiceService, VoiceState, VoiceConfig } from "@/lib/voice";
import type { ProviderStatuses } from "@/lib/voice/types";

export function useVoice() {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [isSttConnected, setIsSttConnected] = useState(false);
  const [isTTSConnected, setIsTTSConnected] = useState(false);
  const [hasStt, setHasStt] = useState(false);
  const [hasTts, setHasTts] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatuses | null>(null);
  const [preferredStt, setPreferredSttState] = useState<string>(
    () => localStorage.getItem("crystal_stt_provider") || "nvidia-nemotron"
  );
  const [preferredTts, setPreferredTtsState] = useState<string>(
    () => localStorage.getItem("crystal_tts_provider") || "nvidia-magpie"
  );
  const pollIntervalRef = useRef<number | null>(null);
  const fastPollRef = useRef<number | null>(null);

  useEffect(() => {
    voiceService.onStateChangeCallback(setVoiceState);
    voiceService.onTranscriptCallback(setTranscript);

    const applyPrefsAndCheck = async () => {
      const sttPref = localStorage.getItem("crystal_stt_provider");
      const ttsPref = localStorage.getItem("crystal_tts_provider");
      try {
        if (sttPref) await voiceService.setPreferredSttProvider(sttPref);
        if (ttsPref) await voiceService.setPreferredTtsProvider(ttsPref);
      } catch (e) { console.warn("[useVoice] Provider pref init failed:", e); }
      await checkServersInternal();
    };

    /**
     * Single combined check — checkSttConnection and checkTTSConnection
     * share the same underlying refreshProviders() call via dedup in VoiceService.
     */
    const checkServersInternal = async () => {
      const [stt, tts] = await Promise.all([
        voiceService.checkSttConnection(),
        voiceService.checkTTSConnection(),
      ]);
      setIsSttConnected(stt);
      setIsTTSConnected(tts);
      setHasStt(voiceService.hasSpeechRecognition());
      setHasTts(voiceService.hasTTS());
      try {
        const statuses = await voiceService.getProviderStatuses();
        setProviderStatuses(statuses);
      } catch (e) { console.warn("[useVoice] Provider status check failed:", e); }
    };

    applyPrefsAndCheck();

    // Fast polling for the first 20s while GPU models are loading
    let fastPollCount = 0;
    fastPollRef.current = window.setInterval(() => {
      fastPollCount++;
      checkServersInternal();
      if (fastPollCount >= 10) {
        if (fastPollRef.current) clearInterval(fastPollRef.current);
      }
    }, 2000);

    // Slow polling after that — 30s is sufficient with cached health checks
    pollIntervalRef.current = window.setInterval(checkServersInternal, 30000);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (fastPollRef.current) clearInterval(fastPollRef.current);
    };
  }, []);

  const startListening = useCallback(async () => {
    try {
      await voiceService.startListening();
    } catch (error) {
      console.error("Failed to start voice:", error);
    }
  }, []);

  const stopListening = useCallback(async () => {
    await voiceService.stopListening();
  }, []);

  const speak = useCallback(async (text: string) => {
    await voiceService.speak(text);
  }, []);

  const setConfig = useCallback((config: Partial<VoiceConfig>) => {
    voiceService.setConfig(config);
  }, []);

  const checkConnections = useCallback(async () => {
    const [stt, tts] = await Promise.all([
      voiceService.checkSttConnection(),
      voiceService.checkTTSConnection(),
    ]);
    setIsSttConnected(stt);
    setIsTTSConnected(tts);
    setHasStt(voiceService.hasSpeechRecognition());
    setHasTts(voiceService.hasTTS());
    try {
      const statuses = await voiceService.getProviderStatuses();
      setProviderStatuses(statuses);
    } catch (e) { console.warn("[useVoice] Provider status check failed:", e); }
    return { stt, tts };
  }, []);

  const setSttProvider = useCallback(async (id: string) => {
    localStorage.setItem("crystal_stt_provider", id);
    setPreferredSttState(id);
    await voiceService.setPreferredSttProvider(id);
    try {
      const statuses = await voiceService.getProviderStatuses();
      setProviderStatuses(statuses);
    } catch (e) { console.warn("[useVoice] STT provider status update failed:", e); }
  }, []);

  const setTtsProvider = useCallback(async (id: string) => {
    localStorage.setItem("crystal_tts_provider", id);
    setPreferredTtsState(id);
    await voiceService.setPreferredTtsProvider(id);
    try {
      const statuses = await voiceService.getProviderStatuses();
      setProviderStatuses(statuses);
    } catch (e) { console.warn("[useVoice] TTS provider status update failed:", e); }
  }, []);

  return {
    voiceState,
    transcript,
    isSttConnected,
    isTTSConnected,
    hasSpeechRecognition: hasStt,
    hasTTS: hasTts,
    providerStatuses,
    preferredStt,
    preferredTts,
    setSttProvider,
    setTtsProvider,
    startListening,
    stopListening,
    speak,
    setConfig,
    checkConnections,
    getConfig: () => voiceService.getConfig(),
  };
}
