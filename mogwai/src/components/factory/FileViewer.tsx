import { useState, useEffect, useRef, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

interface Props {
  filePath: string | null;
  isRunActive?: boolean;
}

export function FileViewer({ filePath, isRunActive }: Props) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filePath) {
      setContent("");
      setError("");
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const text = await invoke<string>("read_file", { path: filePath });
        if (!cancelled) setContent(text);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setContent("");
        }
      }
      if (!cancelled) setLoading(false);
    };

    load();

    let interval: number | undefined;
    if (isRunActive) {
      interval = window.setInterval(load, 3000);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [filePath, isRunActive]);

  if (!filePath) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 11 }}>
        Select a file to view
      </div>
    );
  }

  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const dirPath = filePath.replace(/[/\\][^/\\]+$/, "");
  const lines = content.split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* File header */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "var(--bg-elevated)" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>{fileName}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dirPath}</span>
        {isRunActive && (
          <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)", animation: "_pulse 1.5s ease-in-out infinite" }} />
            Live
          </span>
        )}
      </div>

      {/* Content */}
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "auto", background: "var(--bg-base)" }}>
        {loading && !content && (
          <div style={{ padding: 20, fontSize: 11, color: "var(--text-muted)" }}>Loading...</div>
        )}
        {error && (
          <div style={{ padding: 20, fontSize: 11, color: "var(--error)" }}>{error}</div>
        )}
        {!error && content && (
          <table style={{ borderCollapse: "collapse", width: "100%", ...MONO, fontSize: 11, lineHeight: 1.65 }}>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td style={{
                    padding: "0 12px 0 10px", textAlign: "right", color: "var(--text-muted)",
                    opacity: 0.4, userSelect: "none", whiteSpace: "nowrap", verticalAlign: "top",
                    borderRight: "1px solid var(--border)", width: 1,
                  }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: "0 14px", whiteSpace: "pre", color: "var(--text)" }}>
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
