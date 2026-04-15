import { useState, useCallback, useEffect } from "react";
import { openclawClient } from "@/lib/openclaw";

export function useOpenClaw() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openclawClient.connectGateway().then((ok) => { if (!cancelled) setIsConnected(ok); });
    const unsub = openclawClient.onStatusChange((s) => { if (!cancelled) setIsConnected(s === "connected"); });
    return () => { cancelled = true; unsub(); };
  }, []);

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

  const checkConnection = useCallback(async () => {
    const connected = await openclawClient.connectGateway();
    setIsConnected(connected);
    return connected;
  }, []);

  return {
    sendMessage,
    getModels,
    isLoading,
    error,
    isConnected,
    checkConnection,
    setModel: openclawClient.setModel.bind(openclawClient),
    getModel: openclawClient.getModel.bind(openclawClient),
  };
}
