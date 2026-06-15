import { useState, useCallback } from "react";
import { openclawClient } from "@/lib/openclaw";
import { useAppStore } from "@/stores/appStore";

export function useOpenClaw() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Single source of truth: read the live gateway state from the app store —
  // the SAME field the title-bar status dots use (App.tsx keeps it in sync via
  // openclawClient.onStatusChange). This avoids a second, orphaned connection
  // boolean that could drift out of sync (e.g. show "offline" while the title
  // bar shows "live") when this hook mounts after the connection event fired.
  const isConnected = useAppStore((s) => s.gatewayConnected);
  const gatewayStatus = useAppStore((s) => s.serviceStatus.gateway);

  const sendMessage = useCallback(
    async (text: string): Promise<string> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await openclawClient.openclawChat(text);
        return response;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        setError(errorMessage);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const getModels = useCallback(async () => {
    return openclawClient.getModels();
  }, []);

  // Re-run the live probe. The result propagates through
  // openclawClient.onStatusChange → appStore.gatewayConnected (wired in App.tsx),
  // so every consumer (title bar + this hook) updates from one source.
  const checkConnection = useCallback(async () => {
    return openclawClient.connectGateway();
  }, []);

  return {
    sendMessage,
    getModels,
    isLoading,
    error,
    isConnected,
    gatewayStatus,
    checkConnection,
    setModel: openclawClient.setModel.bind(openclawClient),
    getModel: openclawClient.getModel.bind(openclawClient),
  };
}
