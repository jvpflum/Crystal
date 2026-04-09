import { useState, useEffect, useRef, useCallback } from "react";
import { openclawClient } from "@/lib/openclaw";
import { BUILTIN_WORKFLOWS, CATEGORY_COLORS, loadCustomWorkflows, saveCustomWorkflows, type WorkflowDefinition } from "@/lib/workflows";
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Save,
  Code2,
  Activity,
  Layers,
  ChevronDown,
  ChevronRight,
  Clock,
  Zap,
  Edit3,
  Copy,
  MessageSquare,
  ArrowRight,
  Bot,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { EASE, innerPanel, emptyState, sectionLabel, pressDown, pressUp, glowCard, hoverLift, hoverReset } from "@/styles/viewStyles";

type Workflow = WorkflowDefinition;

interface StepResult {
  stepId: string;
  output: string;
  success: boolean;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Finance: <Zap style={{ width: 14, height: 14 }} />,
  Home: <Layers style={{ width: 14, height: 14 }} />,
  Development: <Code2 style={{ width: 14, height: 14 }} />,
  System: <Activity style={{ width: 14, height: 14 }} />,
  Research: <Bot style={{ width: 14, height: 14 }} />,
  Productivity: <Zap style={{ width: 14, height: 14 }} />,
};

export function TemplatesView() {
  const [customWorkflows, setCustomWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [userInput, setUserInput] = useState("");
  const resultsRef = useRef<HTMLDivElement>(null);
  const setView = useAppStore(s => s.setView);
  const [availableAgents, setAvailableAgents] = useState<string[]>(["main"]);

  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState<Workflow["category"]>("Productivity");
  const [newSteps, setNewSteps] = useState<{ message: string; agentId?: string }[]>([{ message: "" }]);
  const [newNeedsInput, setNewNeedsInput] = useState(false);
  const [newInputLabel, setNewInputLabel] = useState("");
  const [createError, setCreateError] = useState("");

  const loadAgents = useCallback(async () => {
    try {
      const list = await openclawClient.listAgents();
      const ids = list.map((a: { id: string }) => a.id);
      setAvailableAgents(ids.length > 0 ? ids : ["main"]);
    } catch {
      setAvailableAgents(["main"]);
    }
  }, []);

  useEffect(() => {
    setCustomWorkflows(loadCustomWorkflows());
    loadAgents();
  }, [loadAgents]);

  const allWorkflows = [...BUILTIN_WORKFLOWS, ...customWorkflows];
  const selected = allWorkflows.find((w) => w.id === selectedId) ?? null;

  const [workflowSessionId, setWorkflowSessionId] = useState<string | null>(null);

  const runWorkflow = async (workflow: Workflow) => {
    if (workflow.needsInput && !userInput.trim()) return;

    const sessionId = crypto.randomUUID();
    setWorkflowSessionId(sessionId);
    setRunningId(workflow.id);
    setSelectedId(workflow.id);
    setCurrentStep(0);
    setStepResults([]);
    const allExpanded = new Set(workflow.steps.map((s) => s.id));
    setExpandedResults(allExpanded);

    const collectedResults: StepResult[] = [];

    for (let i = 0; i < workflow.steps.length; i++) {
      setCurrentStep(i);
      const step = workflow.steps[i];
      let msg = step.message.replace(/\{\{INPUT\}\}/g, userInput.trim());

      if (i > 0 && collectedResults.length > 0) {
        const prevContext = collectedResults
          .map((r, idx) => `[Step ${idx + 1} result]: ${r.output}`)
          .join("\n\n");
        msg = `Context from previous steps:\n${prevContext}\n\nNow do: ${msg}`;
      }

      try {
        const agent = step.agentId || "main";
        const result = await openclawClient.dispatchToAgent(agent, msg, { sessionId });
        const output = result.stdout?.trim() || result.stderr?.trim() || "(no output)";
        const stepResult: StepResult = { stepId: step.id, output, success: result.code === 0 };
        collectedResults.push(stepResult);
        setStepResults((prev) => [...prev, stepResult]);
      } catch (e) {
        const stepResult: StepResult = { stepId: step.id, output: String(e), success: false };
        collectedResults.push(stepResult);
        setStepResults((prev) => [...prev, stepResult]);
      }

      setTimeout(() => {
        resultsRef.current?.scrollTo({ top: resultsRef.current.scrollHeight, behavior: "smooth" });
      }, 100);
    }

    setCurrentStep(workflow.steps.length);
    setRunningId(null);
  };

  const handleCreateWorkflow = () => {
    if (!newName.trim()) { setCreateError("Name is required"); return; }
    const validSteps = newSteps.filter((s) => s.message.trim());
    if (validSteps.length === 0) { setCreateError("At least one step is required"); return; }
    setCreateError("");
    const wf: Workflow = {
      id: `custom-${Date.now()}`,
      name: newName.trim(),
      description: newDesc.trim() || "Custom workflow",
      icon: "⚡",
      category: newCategory,
      estimatedTime: `~${validSteps.length} min`,
      isBuiltIn: false,
      needsInput: newNeedsInput,
      inputLabel: newInputLabel.trim() || "Input",
      steps: validSteps.map((s, i) => ({ id: `step-${i}`, message: s.message.trim(), agentId: s.agentId })),
    };
    const updated = [...customWorkflows, wf];
    setCustomWorkflows(updated);
    saveCustomWorkflows(updated);
    setNewName(""); setNewDesc(""); setNewSteps([{ message: "" }]);
    setNewNeedsInput(false); setNewInputLabel("");
    setShowCreateForm(false);
    setSelectedId(wf.id);
  };

  const deleteWorkflow = (id: string) => {
    const updated = customWorkflows.filter((w) => w.id !== id);
    setCustomWorkflows(updated);
    saveCustomWorkflows(updated);
    if (selectedId === id) setSelectedId(null);
  };

  const copyResults = () => {
    if (!selected) return;
    const text = stepResults.map((r, i) => {
      const step = selected.steps[i];
      return `--- ${step?.message ?? `Step ${i + 1}`} ---\n${r.output}`;
    }).join("\n\n");
    navigator.clipboard.writeText(text);
  };

  const toggleResult = (stepId: string) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId); else next.add(stepId);
      return next;
    });
  };

  const categories = ["Finance", "Home", "Development", "System", "Research", "Productivity"] as const;
  const grouped = Object.fromEntries(
    categories.map(cat => [cat, allWorkflows.filter(w => w.category === cat)])
  ) as Record<string, Workflow[]>;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: workflow list */}
      <div style={{ width: 280, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: 0 }}>Workflows</h2>
            <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
              {BUILTIN_WORKFLOWS.length} built-in &middot; {customWorkflows.length} custom
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            style={{
              background: "var(--accent-bg)", border: "1px solid var(--border)",
              borderRadius: 6, padding: "5px 6px", cursor: "pointer",
              display: "flex", alignItems: "center", color: "var(--accent)",
            }}
          >
            <Plus style={{ width: 12, height: 12 }} />
          </button>
        </div>

        {showCreateForm && (
          <div style={{
            ...innerPanel, margin: "0 8px 8px", padding: 12,
          }}>
            <p style={{ ...sectionLabel, margin: "0 0 8px" }}>
              Create Workflow
            </p>
            <input type="text" placeholder="Workflow name" value={newName} onChange={(e) => setNewName(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, marginBottom: 6, outline: "none", boxSizing: "border-box" }}
            />
            <input type="text" placeholder="Description (optional)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, marginBottom: 6, outline: "none", boxSizing: "border-box" }}
            />
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Workflow["category"])}
              style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, marginBottom: 8, outline: "none" }}
            >
              <option value="Finance" style={{ background: "var(--bg-base)" }}>Finance</option>
              <option value="Home" style={{ background: "var(--bg-base)" }}>Home</option>
              <option value="Development" style={{ background: "var(--bg-base)" }}>Development</option>
              <option value="System" style={{ background: "var(--bg-base)" }}>System</option>
              <option value="Research" style={{ background: "var(--bg-base)" }}>Research</option>
              <option value="Productivity" style={{ background: "var(--bg-base)" }}>Productivity</option>
            </select>

            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={newNeedsInput} onChange={(e) => setNewNeedsInput(e.target.checked)} />
              Requires user input (use {"{{INPUT}}"} in steps)
            </label>
            {newNeedsInput && (
              <input type="text" placeholder="Input label (e.g. 'Topic', 'URL')" value={newInputLabel} onChange={(e) => setNewInputLabel(e.target.value)}
                style={{ width: "100%", padding: "6px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, marginBottom: 8, outline: "none", boxSizing: "border-box" }}
              />
            )}

            <p style={{ ...sectionLabel, margin: "0 0 6px" }}>Steps</p>
            {newSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 6 }}>
                <div style={{ display: "flex", gap: 4 }}>
                  <span style={{ width: 18, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <input type="text" placeholder={`Step ${i + 1} message...`} value={step.message}
                    onChange={(e) => { const updated = [...newSteps]; updated[i] = { ...updated[i], message: e.target.value }; setNewSteps(updated); }}
                    style={{ flex: 1, padding: "4px 8px", borderRadius: 6, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, outline: "none" }}
                  />
                  {newSteps.length > 1 && (
                    <button onClick={() => setNewSteps(newSteps.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex", alignItems: "center" }}>
                      <Trash2 style={{ width: 10, height: 10 }} />
                    </button>
                  )}
                </div>
                {availableAgents.length > 1 && (
                  <div style={{ marginLeft: 22, display: "flex", alignItems: "center", gap: 4 }}>
                    <Bot style={{ width: 9, height: 9, color: "var(--text-muted)" }} />
                    <select value={step.agentId || "main"} onChange={(e) => {
                      const updated = [...newSteps];
                      updated[i] = { ...updated[i], agentId: e.target.value === "main" ? undefined : e.target.value };
                      setNewSteps(updated);
                    }}
                      style={{ padding: "2px 4px", borderRadius: 4, background: "var(--bg-input)", border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 9, outline: "none" }}>
                      {availableAgents.map(a => (
                        <option key={a} value={a} style={{ background: "var(--bg-base)" }}>{a}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ))}
            <button onClick={() => setNewSteps([...newSteps, { message: "" }])}
              style={{ width: "100%", padding: "4px 0", borderRadius: 6, border: "1px dashed var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", marginBottom: 8 }}>
              + Add Step
            </button>
            {createError && <p style={{ fontSize: 10, color: "var(--error)", margin: "0 0 6px" }}>{createError}</p>}
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={handleCreateWorkflow}
                style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", background: "rgba(74,222,128,0.15)", color: "#4ade80", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                <Save style={{ width: 11, height: 11 }} /> Save
              </button>
              <button onClick={() => { setShowCreateForm(false); setCreateError(""); }}
                style={{ padding: "5px 10px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", background: "var(--bg-hover)", color: "var(--text-muted)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px" }}>
          {(Object.entries(grouped) as [string, Workflow[]][]).map(
            ([cat, workflows]) =>
              workflows.length > 0 && (
                <div key={cat}>
                  <p style={{ ...sectionLabel, padding: "10px 12px 4px", margin: 0, display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: CATEGORY_COLORS[cat] }}>{CATEGORY_ICONS[cat]}</span>
                    {cat}
                  </p>
                  {workflows.map((wf) => (
                    <WorkflowRow key={wf.id} workflow={wf} selected={selectedId === wf.id} running={runningId === wf.id}
                      onClick={() => { setSelectedId(wf.id); setStepResults([]); setUserInput(""); }}
                    />
                  ))}
                </div>
              )
          )}
        </div>
      </div>

      {/* Right: detail / results */}
      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px 20px" }} ref={resultsRef}>
        {selected ? (
          <div>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{
                ...glowCard(CATEGORY_COLORS[selected.category], { width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }),
              }}
                data-glow={CATEGORY_COLORS[selected.category]}
                onMouseEnter={hoverLift}
                onMouseLeave={hoverReset}
              >
                {selected.icon}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, color: "var(--text)", fontSize: 16, fontWeight: 600 }}>{selected.name}</h3>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: `${CATEGORY_COLORS[selected.category]}18`, color: CATEGORY_COLORS[selected.category], fontWeight: 500 }}>
                    {selected.category}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                    <Clock style={{ width: 10, height: 10 }} />{selected.estimatedTime}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                    <Layers style={{ width: 10, height: 10 }} />{selected.steps.length} steps
                  </span>
                  {selected.needsInput && (
                    <span style={{ fontSize: 10, color: "var(--accent)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Edit3 style={{ width: 10, height: 10 }} />Needs input
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!selected.isBuiltIn && (
                  <button onClick={() => deleteWorkflow(selected.id)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: "none", fontSize: 11, fontWeight: 500, cursor: "pointer", background: "rgba(248,113,113,0.15)", color: "#f87171" }}>
                    <Trash2 style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            </div>

            <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 16px" }}>
              {selected.description}
            </p>

            {/* Input field for workflows that need it */}
            {selected.needsInput && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 500, display: "block", marginBottom: 6 }}>
                  {selected.inputLabel || "Input"}
                </label>
                <textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder={selected.inputPlaceholder || "Enter your input..."}
                  rows={3}
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 8,
                    background: "var(--bg-input)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 12, resize: "vertical",
                    outline: "none", boxSizing: "border-box", fontFamily: "inherit",
                    minHeight: 60, maxHeight: 200,
                  }}
                />
              </div>
            )}

            {/* Run button */}
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={() => runWorkflow(selected)}
                disabled={runningId !== null || (selected.needsInput && !userInput.trim())}
                onMouseDown={pressDown}
                onMouseUp={pressUp}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 20px", borderRadius: 8, border: "none",
                  fontSize: 12, fontWeight: 600,
                  cursor: runningId || (selected.needsInput && !userInput.trim()) ? "not-allowed" : "pointer",
                  background: runningId ? "var(--bg-hover)" : "var(--accent)",
                  color: "white",
                  opacity: runningId || (selected.needsInput && !userInput.trim()) ? 0.5 : 1,
                  transition: `all 0.15s ${EASE}`,
                }}
              >
                {runningId === selected.id ? (
                  <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
                ) : (
                  <Play style={{ width: 14, height: 14 }} />
                )}
                {runningId === selected.id ? "Running..." : "Run Workflow"}
              </button>
            </div>

            {/* Progress bar */}
            {runningId === selected.id && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    Step {Math.min(currentStep + 1, selected.steps.length)} of {selected.steps.length}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--accent)" }}>
                    {Math.round((currentStep / selected.steps.length) * 100)}%
                  </span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "var(--bg-hover)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", width: `${(currentStep / selected.steps.length) * 100}%`,
                    background: "var(--accent)", borderRadius: 2, transition: `width 0.3s ${EASE}`,
                  }} />
                </div>
              </div>
            )}

            {/* Steps + Results */}
            <div style={{ marginBottom: 16 }}>
              <p style={{ ...sectionLabel, marginBottom: 8 }}>
                Steps & Results
              </p>
              {selected.steps.map((step, i) => {
                const result = stepResults.find((r) => r.stepId === step.id);
                const isRunning = runningId === selected.id && currentStep === i;
                const isDone = result !== undefined;
                const isExpanded = expandedResults.has(step.id);
                const displayMsg = step.message.replace(/\{\{INPUT\}\}/g, userInput.trim() || "(input)");

                return (
                  <div key={step.id} style={{ marginBottom: 6 }}>
                    <div
                      onClick={() => isDone && toggleResult(step.id)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 12px", borderRadius: 10,
                        background: isRunning ? "var(--accent-bg)" : isDone ? "var(--bg-elevated)" : "var(--bg-surface)",
                        border: isRunning ? "1px solid var(--accent)" : "1px solid var(--border)",
                        cursor: isDone ? "pointer" : "default",
                        transition: `all 0.15s ${EASE}`,
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: "50%",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        background: isRunning ? "var(--accent-bg)"
                          : isDone ? (result.success ? "rgba(74,222,128,0.15)" : "rgba(248,113,113,0.15)")
                          : "var(--bg-hover)",
                      }}>
                        {isRunning ? (
                          <Loader2 style={{ width: 11, height: 11, color: "var(--accent)", animation: "spin 1s linear infinite" }} />
                        ) : isDone ? (
                          result.success ? <CheckCircle2 style={{ width: 11, height: 11, color: "#4ade80" }} />
                            : <XCircle style={{ width: 11, height: 11, color: "#f87171" }} />
                        ) : (
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>{i + 1}</span>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          fontSize: 12,
                          color: isRunning ? "var(--accent)" : isDone ? "var(--text-secondary)" : "var(--text-muted)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {displayMsg}
                        </span>
                        {step.agentId && step.agentId !== "main" && (
                          <span style={{
                            fontSize: 8, padding: "1px 5px", borderRadius: 4, flexShrink: 0,
                            background: "rgba(139,92,246,0.1)", color: "rgba(139,92,246,0.8)",
                            fontWeight: 500, display: "flex", alignItems: "center", gap: 3,
                          }}>
                            <Bot style={{ width: 8, height: 8 }} />{step.agentId}
                          </span>
                        )}
                      </div>
                      {isDone && (
                        isExpanded
                          ? <ChevronDown style={{ width: 12, height: 12, color: "var(--text-muted)" }} />
                          : <ChevronRight style={{ width: 12, height: 12, color: "var(--text-muted)" }} />
                      )}
                    </div>
                    {isDone && isExpanded && (
                      <div style={{
                        margin: "4px 0 0 30px", padding: 12, borderRadius: 8,
                        background: "var(--bg-base)",
                        border: result.success ? "1px solid rgba(74,222,128,0.1)" : "1px solid rgba(248,113,113,0.1)",
                      }}>
                        <pre style={{
                          margin: 0, fontSize: 11, fontFamily: "'Segoe UI', sans-serif",
                          color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
                          maxHeight: 300, overflowY: "auto", lineHeight: 1.5,
                        }}>
                          {result.output || "(no output)"}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Completion summary */}
            {stepResults.length === selected.steps.length && runningId !== selected.id && stepResults.length > 0 && (
              <div style={{
                padding: 14, borderRadius: 10,
                background: stepResults.every((r) => r.success) ? "rgba(74,222,128,0.08)" : "rgba(248,113,113,0.08)",
                border: stepResults.every((r) => r.success) ? "1px solid rgba(74,222,128,0.15)" : "1px solid rgba(248,113,113,0.15)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  {stepResults.every((r) => r.success) ? (
                    <CheckCircle2 style={{ width: 16, height: 16, color: "#4ade80" }} />
                  ) : (
                    <XCircle style={{ width: 16, height: 16, color: "#f87171" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--text)", fontWeight: 500 }}>
                      {stepResults.every((r) => r.success)
                        ? "Workflow completed successfully"
                        : `Workflow completed with ${stepResults.filter((r) => !r.success).length} error(s)`}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--text-muted)" }}>
                      {stepResults.filter((r) => r.success).length}/{stepResults.length} steps succeeded
                    </p>
                  </div>
                  <button onClick={copyResults}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 10, cursor: "pointer" }}>
                    <Copy style={{ width: 10, height: 10 }} /> Copy All
                  </button>
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => {
                      const summary = stepResults.map((r, i) => {
                        const step = selected.steps[i];
                        return `**Step ${i + 1}** (${step?.message?.slice(0, 60) || ""}...):\n${r.output}`;
                      }).join("\n\n---\n\n");
                      const context = `The workflow "${selected.name}" just completed. Here are the results:\n\n${summary}\n\nPlease review these results and execute any actionable items (send emails, create files, schedule tasks, etc). Ask me to confirm before taking any irreversible actions.`;
                      setView("conversation");
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent("crystal:send-to-chat", {
                          detail: { context, surface: "workflow", sessionId: workflowSessionId },
                        }));
                      }, 300);
                    }}
                    onMouseDown={pressDown}
                    onMouseUp={pressUp}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "7px 14px", borderRadius: 8, border: "none",
                      background: "var(--accent)", color: "#fff",
                      fontSize: 11, fontWeight: 600, cursor: "pointer",
                      transition: `all 0.15s ${EASE}`,
                    }}
                  >
                    <ArrowRight style={{ width: 12, height: 12 }} />
                    Execute in Chat
                  </button>
                  <button
                    onClick={() => {
                      const summary = stepResults.map((r, i) => {
                        const step = selected.steps[i];
                        return `[Step ${i + 1}: ${step?.message?.slice(0, 50)}]\n${r.output}`;
                      }).join("\n\n");
                      const context = `Here are the results from the "${selected.name}" workflow:\n\n${summary}`;
                      setView("conversation");
                      setTimeout(() => {
                        window.dispatchEvent(new CustomEvent("crystal:send-to-chat", {
                          detail: { context, followUp: "Summarize these results and suggest next steps.", surface: "workflow", sessionId: workflowSessionId },
                        }));
                      }, 300);
                    }}
                    onMouseDown={pressDown}
                    onMouseUp={pressUp}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "7px 14px", borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-elevated)", color: "var(--text-secondary)",
                      fontSize: 11, fontWeight: 500, cursor: "pointer",
                      transition: `all 0.15s ${EASE}`,
                    }}
                  >
                    <MessageSquare style={{ width: 12, height: 12 }} />
                    Discuss in Chat
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ ...emptyState, height: "100%", justifyContent: "center" }}>
            <Layers style={{ width: 40, height: 40, color: "var(--text-muted)" }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Select a workflow to run</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 260, textAlign: "center", margin: 0, lineHeight: 1.5 }}>
              Chain agent commands into automated workflows. Pick a built-in template or create your own.
            </p>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function WorkflowRow({ workflow, selected, running, onClick }: {
  workflow: Workflow; selected: boolean; running: boolean; onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 8,
        border: "none", cursor: "pointer", marginBottom: 2,
        display: "flex", alignItems: "center", gap: 8,
        background: selected ? "var(--accent-bg)" : hovered ? "var(--bg-hover)" : "transparent",
        transition: `background 0.15s ${EASE}`,
      }}
    >
      <span style={{ fontSize: 15 }}>{workflow.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: "var(--text)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {workflow.name}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {workflow.steps.length} steps{workflow.needsInput ? " · needs input" : ""}
        </span>
      </div>
      {running && (
        <Loader2 style={{ width: 12, height: 12, color: "var(--accent)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
      )}
    </button>
  );
}
