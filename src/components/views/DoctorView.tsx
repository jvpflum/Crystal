import { useState, useCallback, useRef, useEffect } from "react";
import {
  Stethoscope,
  RefreshCw,
  Loader2,
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Wrench,
  Heart,
  Archive,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { glowCard, hoverLift, hoverReset, pressDown, pressUp, badge, emptyState, btnPrimary, btnSecondary, MONO } from "@/styles/viewStyles";

type CommandId = "doctor" | "deep" | "fix" | "full-fix" | "status" | "health" | "validate" | "memory-reindex" | "backup-create" | "backup-verify";

interface OutputBlock {
  id: string;
  label: string;
  lines: string[];
  exitCode: number;
  timestamp: number;
}

function classifyLine(line: string): "pass" | "fail" | "warn" | "neutral" {
  const l = line.toLowerCase();
  if (/[✓✔]/.test(line) || l.includes("pass") || l.includes("ok") || l.includes("success")) return "pass";
  if (/[✗✘]/.test(line) || l.includes("fail") || l.includes("error")) return "fail";
  if (/⚠/.test(line) || l.includes("warn") || l.includes("warning")) return "warn";
  return "neutral";
}

const LINE_COLORS: Record<ReturnType<typeof classifyLine>, string> = {
  pass: "var(--success)",
  fail: "var(--error)",
  warn: "var(--warning)",
  neutral: "var(--text-muted)",
};

const COMMANDS: Record<CommandId, { cmd: string; label: string }> = {
  doctor:           { cmd: "openclaw doctor",                              label: "Doctor" },
  deep:             { cmd: "openclaw doctor --deep --yes",                 label: "Deep Scan" },
  fix:              { cmd: "openclaw doctor --fix --non-interactive",      label: "Auto Fix" },
  "full-fix":       { cmd: "openclaw doctor --deep --yes --fix",           label: "Deep Fix (Auto)" },
  status:           { cmd: "openclaw status",                              label: "Status" },
  health:           { cmd: "openclaw health",                              label: "Gateway Health" },
  validate:         { cmd: "openclaw config validate --json",              label: "Config Validate" },
  "memory-reindex": { cmd: "openclaw memory index --all",                  label: "Reindex Memory" },
  "backup-create":  { cmd: "openclaw backup create --json",               label: "Create Backup" },
  "backup-verify":  { cmd: "openclaw backup verify --json",               label: "Verify Backup" },
};

export function DoctorView() {
  const [outputs, setOutputs] = useState<OutputBlock[]>([]);
  const [running, setRunning] = useState<CommandId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [outputs]);

  const run = useCallback(async (id: CommandId) => {
    setRunning(id);
    setError(null);
    try {
      const { cmd, label } = COMMANDS[id];
      const result = await invoke<{ stdout: string; stderr: string; code: number }>("execute_command", {
        command: cmd,
        cwd: null,
      });
      const raw = (result.stdout || "") + (result.stderr || "");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      setOutputs((prev) => [
        ...prev,
        { id: `${id}-${Date.now()}`, label, lines, exitCode: result.code, timestamp: Date.now() },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to run ${id}`);
    }
    setRunning(null);
  }, []);

  const clearOutput = () => setOutputs([]);

  const summary = outputs.reduce(
    (acc, block) => {
      for (const line of block.lines) {
        const c = classifyLine(line);
        if (c === "pass") acc.pass++;
        else if (c === "fail") acc.fail++;
        else if (c === "warn") acc.warn++;
      }
      return acc;
    },
    { pass: 0, fail: 0, warn: 0 },
  );

  const hasSummary = summary.pass + summary.fail + summary.warn > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Stethoscope style={{ width: 16, height: 16, color: "var(--accent)" }} />
          <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Doctor</h2>
          {hasSummary && (
            <div style={{ display: "flex", gap: 8 }}>
              <Badge color="#4ade80" count={summary.pass} label="pass" />
              {summary.warn > 0 && <Badge color="#fbbf24" count={summary.warn} label="warn" />}
              {summary.fail > 0 && <Badge color="#f87171" count={summary.fail} label="fail" />}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => run("doctor")} disabled={running !== null} onMouseDown={pressDown} onMouseUp={pressUp} style={actionBtnStyle("#3B82F6")}>
            {running === "doctor" ? <Loader2 style={iconSm} className="animate-spin" /> : <Heart style={iconSm} />}
            Run Doctor
          </button>
          <button onClick={() => run("deep")} disabled={running !== null} onMouseDown={pressDown} onMouseUp={pressUp} style={actionBtnStyle("#3B82F6")}>
            {running === "deep" ? <Loader2 style={iconSm} className="animate-spin" /> : <Shield style={iconSm} />}
            Deep Scan
          </button>
          <button onClick={() => run("fix")} disabled={running !== null} onMouseDown={pressDown} onMouseUp={pressUp} style={actionBtnStyle("#4ade80")}>
            {running === "fix" ? <Loader2 style={iconSm} className="animate-spin" /> : <Wrench style={iconSm} />}
            Auto Fix
          </button>
          <button onClick={() => run("full-fix")} disabled={running !== null} onMouseDown={pressDown} onMouseUp={pressUp} style={actionBtnStyle("#10b981")}>
            {running === "full-fix" ? <Loader2 style={iconSm} className="animate-spin" /> : <Wrench style={iconSm} />}
            Deep Fix (Auto)
          </button>
          <button onClick={() => run("validate")} disabled={running !== null} onMouseDown={pressDown} onMouseUp={pressUp} style={ghostBtnStyle}>
            {running === "validate" ? <Loader2 style={iconSm} className="animate-spin" /> : <CheckCircle style={iconSm} />}
            Validate Config
          </button>
          <button
            onClick={() => { clearOutput(); run("doctor"); }}
            disabled={running !== null}
            onMouseDown={pressDown} onMouseUp={pressUp}
            style={{ ...ghostBtnStyle, padding: "4px 8px" }}
          >
            <RefreshCw style={{ ...iconSm }} className={running ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ padding: "0 20px 10px", display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
        <QuickAction label="Status" running={running === "status"} onClick={() => run("status")} disabled={running !== null} />
        <QuickAction label="Gateway Health" running={running === "health"} onClick={() => run("health")} disabled={running !== null} />
        <QuickAction label="Reindex Memory" running={running === "memory-reindex"} onClick={() => run("memory-reindex")} disabled={running !== null} />
        <QuickAction label="Create Backup" running={running === "backup-create"} onClick={() => run("backup-create")} disabled={running !== null} icon={Archive} />
        <QuickAction label="Verify Backup" running={running === "backup-verify"} onClick={() => run("backup-verify")} disabled={running !== null} icon={Archive} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 20px 20px" }}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", marginBottom: 12 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "var(--error)", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--error)", flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 14, cursor: "pointer" }}>×</button>
          </div>
        )}

        {/* Summary cards */}
        {hasSummary && (
          <div style={{ marginBottom: 16 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, display: "block", marginBottom: 6 }}>Overview</span>
            <div style={{ display: "flex", gap: 8 }}>
              <SummaryCard icon={CheckCircle} label="Passed" count={summary.pass} color="#4ade80" />
              <SummaryCard icon={AlertTriangle} label="Warnings" count={summary.warn} color="#fbbf24" />
              <SummaryCard icon={XCircle} label="Failed" count={summary.fail} color="var(--error)" />
            </div>
          </div>
        )}

        {/* Terminal output */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Output</span>
            {outputs.length > 0 && (
              <button onClick={clearOutput} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: 10, cursor: "pointer" }}>
                Clear
              </button>
            )}
          </div>

          <div
            ref={termRef}
            style={{
              background: "rgba(0,0,0,0.35)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 0,
              minHeight: 200,
              maxHeight: "calc(100vh - 320px)",
              overflowY: "auto",
              fontFamily: MONO,
              fontSize: 11,
              lineHeight: 1.7,
            }}
          >
            {outputs.length === 0 && !running ? (
              <div style={emptyState}>
                <Stethoscope style={{ width: 28, height: 28, color: "rgba(255,255,255,0.12)" }} />
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", margin: 0 }}>No diagnostics yet</p>
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", margin: 0 }}>Run a doctor check to see results</p>
              </div>
            ) : (
              outputs.map((block) => (
                <div key={block.id}>
                  <div style={{
                    padding: "6px 14px",
                    background: "rgba(255,255,255,0.04)",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: "var(--accent)" }}>
                      {block.label}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>
                        {new Date(block.timestamp).toLocaleTimeString()}
                      </span>
                      <span style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 8,
                        background: block.exitCode === 0 ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)",
                        color: block.exitCode === 0 ? "#4ade80" : "var(--error)",
                        border: `1px solid ${block.exitCode === 0 ? "rgba(74,222,128,0.2)" : "rgba(248,113,113,0.2)"}`,
                      }}>
                        exit {block.exitCode}
                      </span>
                    </div>
                  </div>
                  <div style={{ padding: "8px 14px" }}>
                    {block.lines.map((line, i) => {
                      const cls = classifyLine(line);
                      return (
                        <div key={i} style={{ color: LINE_COLORS[cls], padding: "1px 0" }}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}

            {running && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", color: "var(--text-muted)" }}>
                <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
                <span style={{ fontSize: 11 }}>Running {COMMANDS[running].label}...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ── */

const iconSm: React.CSSProperties = { width: 12, height: 12 };

function actionBtnStyle(color: string): React.CSSProperties {
  return {
    ...btnPrimary,
    display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
    fontSize: 11, background: `${color}26`, color,
  };
}

const ghostBtnStyle: React.CSSProperties = {
  ...btnSecondary,
  display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
  fontSize: 11,
};

function SummaryCard({ icon: Icon, label, count, color }: { icon: React.ElementType; label: string; count: number; color: string }) {
  return (
    <div data-glow={color} onMouseEnter={hoverLift} onMouseLeave={hoverReset}
      style={glowCard(color, { flex: 1, padding: "12px 14px", textAlign: "center" })}>
      <Icon style={{ width: 18, height: 18, color, margin: "0 auto 6px", display: "block" }} />
      <span style={{ fontSize: 20, fontWeight: 700, color, display: "block" }}>{count}</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}

function Badge({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <span style={badge(color)}>
      {count} {label}
    </span>
  );
}

function QuickAction({ label, running, onClick, disabled, icon: Icon = Heart }: { label: string; running: boolean; onClick: () => void; disabled: boolean; icon?: React.ElementType }) {
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseDown={pressDown} onMouseUp={pressUp}
      style={{
        ...btnSecondary, display: "flex", alignItems: "center", gap: 4,
        padding: "3px 10px", fontSize: 10,
      }}>
      {running ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Icon style={{ width: 10, height: 10 }} />}
      {label}
    </button>
  );
}
