import { useEffect } from "react";
import { useToast } from "@/components/shell/Toast";
import { useTokenUsageStore } from "@/stores/tokenUsageStore";

/** Drains milestone queue into success toasts (must render inside ToastProvider). */
export function TokenMilestoneListener() {
  const { toast } = useToast();
  const queueLen = useTokenUsageStore(s => s.toastQueue.length);

  useEffect(() => {
    if (queueLen === 0) return;
    const m = useTokenUsageStore.getState().toastQueue[0];
    if (!m) return;
    toast(`${m.emoji} ${m.title} — ${m.flavor}`, "success");
    useTokenUsageStore.getState().shiftToastQueue();
  }, [queueLen, toast]);

  return null;
}
