import { Loader2, AlertTriangle } from "lucide-react";
import { btnSecondary, emptyState, EASE } from "../../styles/viewStyles";

interface ViewLoaderProps {
  message?: string;
  fullHeight?: boolean;
}

export function ViewLoader({ message, fullHeight = true }: ViewLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "48px 24px",
        minHeight: fullHeight ? "60vh" : undefined,
        color: "var(--text-muted)",
      }}
    >
      <Loader2 size={20} className="animate-spin" aria-hidden="true" />
      {message && <span style={{ fontSize: 12, letterSpacing: "0.02em" }}>{message}</span>}
    </div>
  );
}

interface ViewErrorProps {
  message: string;
  onRetry?: () => void;
  hint?: string;
}

export function ViewError({ message, onRetry, hint }: ViewErrorProps) {
  return (
    <div role="alert" style={{ ...emptyState, gap: 14 }}>
      <AlertTriangle size={22} color="var(--warn, #f59e0b)" aria-hidden="true" />
      <div style={{ fontSize: 13, color: "var(--text)", maxWidth: 420 }}>{message}</div>
      {hint && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 420 }}>{hint}</div>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{ ...btnSecondary, transition: `all 0.2s ${EASE}` }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

interface ViewEmptyProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function ViewEmpty({ icon, title, description, action }: ViewEmptyProps) {
  return (
    <div style={emptyState}>
      {icon && <div style={{ opacity: 0.7 }}>{icon}</div>}
      <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600 }}>{title}</div>
      {description && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 420 }}>{description}</div>
      )}
      {action && (
        <button type="button" onClick={action.onClick} style={btnSecondary}>
          {action.label}
        </button>
      )}
    </div>
  );
}
