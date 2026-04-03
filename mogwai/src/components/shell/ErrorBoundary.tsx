import React from "react";
import { AlertTriangle } from "lucide-react";

function ErrorIcon() {
  return (
    <div style={{
      width: 48, height: 48, borderRadius: 12,
      background: "rgba(248,113,113,0.12)",
      display: "flex", alignItems: "center", justifyContent: "center",
      marginBottom: 8,
    }}>
      <AlertTriangle style={{ width: 24, height: 24, color: "#f87171" }} />
    </div>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          height: "100%", padding: 24,
        }}>
          <div style={{
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: 12,
            padding: 24,
            maxWidth: 420,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}>
            <ErrorIcon />

            <h3 style={{
              color: "#f87171", fontSize: 15, fontWeight: 600,
              margin: "0 0 8px",
            }}>
              Something went wrong
            </h3>

            <p style={{
              color: "rgba(255,255,255,0.55)", fontSize: 12,
              lineHeight: 1.5, margin: "0 0 20px",
              wordBreak: "break-word",
            }}>
              {this.state.error?.message || "An unexpected error occurred."}
            </p>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "none", cursor: "pointer",
                  background: "linear-gradient(135deg, #3B82F6, #2563EB)",
                  color: "white",
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
              >
                Try Again
              </button>

              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.dispatchEvent(new CustomEvent("crystal:navigate", { detail: "home" }));
                }}
                style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 500,
                  border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer",
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.7)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              >
                Go Home
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
