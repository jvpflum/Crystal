import { useState, useCallback, useEffect } from "react";
import { openclawClient, Message, InferenceBackend } from "@/lib/openclaw";

export function useOpenClaw() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [backend, setBackendState] = useState<InferenceBackend>(openclawClient.getBackend());

  useEffect(() => {
    openclawClient.checkConnection().then(setIsConnected);
  }, [backend]);

  const sendMessage = useCallback(
    async (messages: Message[]): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await openclawClient.chat(messages);
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

  const streamMessage = useCallback(
    async function* (messages: Message[]): AsyncGenerator<string> {
      setIsLoading(true);
      setError(null);

      try {
        for await (const chunk of openclawClient.streamChat(messages)) {
          yield chunk;
        }
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

  const setBackend = useCallback((newBackend: InferenceBackend) => {
    openclawClient.setBackend(newBackend);
    setBackendState(newBackend);
  }, []);

  const checkConnection = useCallback(async () => {
    const connected = await openclawClient.checkConnection();
    setIsConnected(connected);
    return connected;
  }, []);

  return {
    sendMessage,
    streamMessage,
    getModels,
    isLoading,
    error,
    isConnected,
    backend,
    setBackend,
    checkConnection,
    setModel: openclawClient.setModel.bind(openclawClient),
    getModel: openclawClient.getModel.bind(openclawClient),
  };
}
