import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  createdAt: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const TOAST_DURATION = 4000;
let nextId = 0;

const iconMap: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const borderColorMap: Record<ToastType, string> = {
  success: "#4ade80",
  error: "#f87171",
  warning: "#fbbf24",
  info: "#3B82F6",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = "info") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, type, createdAt: Date.now() }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <div style={{
        position: "fixed", top: 16, right: 16, zIndex: 2000,
        display: "flex", flexDirection: "column", gap: 8,
        pointerEvents: "none",
      }}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => setExiting(true), TOAST_DURATION - 300);
    const removeTimer = setTimeout(onDismiss, TOAST_DURATION);
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(removeTimer);
    };
  }, [onDismiss]);

  const Icon = iconMap[toast.type];
  const borderColor = borderColorMap[toast.type];

  return (
    <div className="glass-toast" style={{
      minWidth: 280, padding: "12px 16px", borderRadius: 12,
      borderLeft: `3px solid ${borderColor}`,
      pointerEvents: "auto",
      animation: exiting ? "toast-out 0.3s ease-in forwards" : "toast-in 0.3s ease-out",
      position: "relative", overflow: "hidden",
    }}>
      <style>{`
        @keyframes toast-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(40px); } }
        @keyframes toast-progress { from { transform: scaleX(1); } to { transform: scaleX(0); } }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon style={{ width: 16, height: 16, color: borderColor, flexShrink: 0 }} />
        <span className="glass-toast-text" style={{ flex: 1, fontSize: 12, lineHeight: 1.4 }}>
          {toast.message}
        </span>
        <button
          onClick={onDismiss}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 2,
            color: "var(--text-muted)", display: "flex", flexShrink: 0,
          }}
        >
          <X style={{ width: 12, height: 12 }} />
        </button>
      </div>

      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
        background: borderColor, opacity: 0.4,
        transformOrigin: "left",
        animation: `toast-progress ${TOAST_DURATION}ms linear forwards`,
      }} />
    </div>
  );
}
