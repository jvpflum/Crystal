import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";

const MONO: CSSProperties = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".next", ".turbo"]);

interface Props {
  rootPath: string;
  changedFiles?: { added: string[]; modified: string[]; deleted: string[] };
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children?: TreeNode[];
  loaded?: boolean;
  expanded?: boolean;
}

export function FileTree({ rootPath, changedFiles, selectedFile, onSelectFile }: Props) {
  const [root, setRoot] = useState<TreeNode | null>(null);
  const [, setTick] = useState(0);

  const forceRender = useCallback(() => setTick((t) => t + 1), []);

  const loadChildren = useCallback(async (node: TreeNode) => {
    try {
      const items = await invoke<string[]>("list_directory", { path: node.fullPath });
      node.children = items
        .filter((item) => {
          const name = item.replace(/\/$/, "");
          return !SKIP_DIRS.has(name);
        })
        .map((item) => {
          const isDir = item.endsWith("/");
          const name = item.replace(/\/$/, "");
          const sep = node.fullPath.includes("/") ? "/" : "\\";
          return {
            name,
            fullPath: node.fullPath + sep + name,
            isDir,
          };
        })
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      node.loaded = true;
    } catch {
      node.children = [];
      node.loaded = true;
    }
  }, []);

  useEffect(() => {
    const rootNode: TreeNode = { name: rootPath.split(/[/\\]/).pop() || rootPath, fullPath: rootPath, isDir: true, expanded: true };
    loadChildren(rootNode).then(() => {
      setRoot(rootNode);
    });
  }, [rootPath, loadChildren]);

  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (!node.isDir) return;
    if (!node.loaded) {
      await loadChildren(node);
    }
    node.expanded = !node.expanded;
    forceRender();
  }, [loadChildren, forceRender]);

  const getChangeStatus = useCallback((fullPath: string): "added" | "modified" | null => {
    if (!changedFiles) return null;
    const normalize = (p: string) => p.replace(/\\/g, "/");
    const rel = normalize(fullPath).replace(normalize(rootPath) + "/", "");
    if (changedFiles.added.some((f) => normalize(f) === rel)) return "added";
    if (changedFiles.modified.some((f) => normalize(f) === rel)) return "modified";
    return null;
  }, [changedFiles, rootPath]);

  const hasDirChanges = useCallback((dirPath: string): boolean => {
    if (!changedFiles) return false;
    const normalize = (p: string) => p.replace(/\\/g, "/");
    const rel = normalize(dirPath).replace(normalize(rootPath) + "/", "") + "/";
    const allChanged = [...changedFiles.added, ...changedFiles.modified];
    return allChanged.some((f) => normalize(f).startsWith(rel));
  }, [changedFiles, rootPath]);

  if (!root) return <div style={{ padding: 12, fontSize: 11, color: "var(--text-muted)" }}>Loading tree...</div>;

  return (
    <div style={{ overflowY: "auto", overflowX: "hidden", height: "100%", fontSize: 11, ...MONO }}>
      {root.children?.map((child) => (
        <TreeNodeRow
          key={child.fullPath}
          node={child}
          depth={0}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          onToggle={toggleExpand}
          getChangeStatus={getChangeStatus}
          hasDirChanges={hasDirChanges}
        />
      ))}
    </div>
  );
}

function TreeNodeRow({
  node, depth, selectedFile, onSelectFile, onToggle, getChangeStatus, hasDirChanges,
}: {
  node: TreeNode;
  depth: number;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onToggle: (node: TreeNode) => void;
  getChangeStatus: (path: string) => "added" | "modified" | null;
  hasDirChanges: (path: string) => boolean;
}) {
  const isSelected = selectedFile === node.fullPath;
  const changeStatus = node.isDir ? null : getChangeStatus(node.fullPath);
  const dirHasChanges = node.isDir && hasDirChanges(node.fullPath);

  return (
    <>
      <button
        onClick={() => node.isDir ? onToggle(node) : onSelectFile(node.fullPath)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 4,
          padding: "3px 8px 3px " + (8 + depth * 14) + "px",
          background: isSelected ? "var(--accent-bg)" : "transparent",
          border: "none", cursor: "pointer", color: isSelected ? "var(--accent)" : "var(--text)",
          fontSize: 11, textAlign: "left", whiteSpace: "nowrap",
        }}
        onMouseOver={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-surface)"; }}
        onMouseOut={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
      >
        {node.isDir ? (
          <span style={{ width: 12, textAlign: "center", fontSize: 8, color: "var(--text-muted)" }}>
            {node.expanded ? "▼" : "▶"}
          </span>
        ) : (
          <span style={{ width: 12 }} />
        )}

        {node.isDir ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={dirHasChanges ? "var(--accent)" : "var(--text-muted)"} strokeWidth="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        )}

        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>

        {changeStatus === "added" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0, marginLeft: "auto" }} />}
        {changeStatus === "modified" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b", flexShrink: 0, marginLeft: "auto" }} />}
        {dirHasChanges && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", flexShrink: 0, marginLeft: "auto", opacity: 0.6 }} />}
      </button>

      {node.isDir && node.expanded && node.children?.map((child) => (
        <TreeNodeRow
          key={child.fullPath}
          node={child}
          depth={depth + 1}
          selectedFile={selectedFile}
          onSelectFile={onSelectFile}
          onToggle={onToggle}
          getChangeStatus={getChangeStatus}
          hasDirChanges={hasDirChanges}
        />
      ))}
    </>
  );
}
