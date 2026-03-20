import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const OVERLAY: CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9999,
  background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const MODAL: CSSProperties = {
  background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: 12,
  width: 560, maxHeight: "70vh", display: "flex", flexDirection: "column",
  boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
};

const BTN: CSSProperties = {
  padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 500,
  border: "none", cursor: "pointer", display: "inline-flex", alignItems: "center",
  gap: 5, transition: "all .15s ease",
};

interface Props {
  isOpen: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function DirectoryBrowser({ isOpen, onSelect, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDir = useCallback(async (path: string) => {
    setLoading(true);
    setError("");
    try {
      const items = await invoke<string[]>("list_directory", { path });
      setEntries(items);
      setCurrentPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    homeDir().then((home) => {
      loadDir(home.replace(/[/\\]$/, ""));
    }).catch(() => loadDir("C:\\"));
  }, [isOpen, loadDir]);

  if (!isOpen) return null;

  const pathSegments = currentPath.split(/[/\\]/).filter(Boolean);
  const folders = entries.filter((e) => e.endsWith("/"));
  const files = entries.filter((e) => !e.endsWith("/"));

  const navigateTo = (dir: string) => {
    const sep = currentPath.includes("/") ? "/" : "\\";
    const cleaned = dir.replace(/\/$/, "");
    loadDir(currentPath + sep + cleaned);
  };

  const navigateUp = () => {
    const parts = currentPath.split(/[/\\]/);
    if (parts.length <= 1) return;
    parts.pop();
    const parent = parts.join("\\") || "C:\\";
    loadDir(parent);
  };

  const navigateToBreadcrumb = (index: number) => {
    const parts = currentPath.split(/[/\\]/).filter(Boolean);
    const target = parts.slice(0, index + 1).join("\\");
    loadDir(target);
  };

  const goQuick = async (name: string) => {
    try {
      const home = (await homeDir()).replace(/[/\\]$/, "");
      if (name === "home") loadDir(home);
      else if (name === "desktop") loadDir(home + "\\Desktop");
      else if (name === "documents") loadDir(home + "\\Documents");
      else if (name === "projects") loadDir(home + "\\Projects");
    } catch {
      loadDir("C:\\");
    }
  };

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={MODAL} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Browse Directory</div>
          {/* Quick access */}
          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
            {[
              { id: "home", label: "Home" },
              { id: "desktop", label: "Desktop" },
              { id: "documents", label: "Documents" },
              { id: "projects", label: "Projects" },
            ].map((q) => (
              <button key={q.id} onClick={() => goQuick(q.id)} style={{ ...BTN, background: "var(--bg-surface)", color: "var(--text-muted)", border: "1px solid var(--border)", fontSize: 10 }}>
                {q.label}
              </button>
            ))}
          </div>
          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", padding: "6px 10px", background: "var(--bg-surface)", borderRadius: 6, border: "1px solid var(--border)" }}>
            {pathSegments.map((seg, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
                {i > 0 && <span style={{ color: "var(--text-muted)", fontSize: 10 }}>&rsaquo;</span>}
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 4px", borderRadius: 3, fontSize: 11, color: i === pathSegments.length - 1 ? "var(--accent)" : "var(--text-secondary)", ...MONO }}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Listing */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {loading && (
            <div style={{ padding: 20, textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>Loading...</div>
          )}
          {error && (
            <div style={{ padding: "10px 16px", fontSize: 11, color: "var(--error)" }}>{error}</div>
          )}
          {!loading && !error && (
            <>
              {/* Up directory */}
              {pathSegments.length > 1 && (
                <DirEntry name=".." isDir onClick={navigateUp} />
              )}
              {/* Folders first */}
              {folders.map((f) => (
                <DirEntry key={f} name={f.replace(/\/$/, "")} isDir onClick={() => navigateTo(f)} />
              ))}
              {/* Files (non-clickable, dimmed) */}
              {files.map((f) => (
                <DirEntry key={f} name={f} isDir={false} />
              ))}
              {!loading && folders.length === 0 && files.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>Empty directory</div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-muted)", ...MONO, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {currentPath}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{ ...BTN, background: "transparent", color: "var(--text-muted)" }}>Cancel</button>
            <button onClick={() => { onSelect(currentPath); onClose(); }} style={{ ...BTN, background: "var(--accent-bg)", color: "var(--accent)" }}>
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DirEntry({ name, isDir, onClick }: { name: string; isDir: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onClick}
      disabled={!isDir && name !== ".."}
      style={{
        width: "100%", padding: "6px 16px", display: "flex", alignItems: "center", gap: 8,
        background: "none", border: "none", cursor: isDir ? "pointer" : "default",
        color: isDir ? "var(--text)" : "var(--text-muted)", fontSize: 12, textAlign: "left",
        opacity: isDir ? 1 : 0.5,
      }}
      onMouseOver={(e) => { if (isDir) (e.currentTarget.style.background = "var(--bg-surface)"); }}
      onMouseOut={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {isDir ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" stroke="none"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" opacity="0.2" /><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
      )}
      <span style={{ ...MONO, fontSize: 11 }}>{name}</span>
    </button>
  );
}
