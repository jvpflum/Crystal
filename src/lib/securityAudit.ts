/**
 * OpenClaw `security audit --json` emits `summary` and/or `findings[]` (not top-level pass/warn/fail).
 * CLI output may include log lines; we parse the outermost `{...}` JSON object.
 */
export function parseOpenClawSecurityAuditJson(text: string): { pass: number; warn: number; fail: number } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) return null;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const n = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
    return undefined;
  };

  const pickTriple = (obj: Record<string, unknown>): { pass: number; warn: number; fail: number } | null => {
    const pass =
      n(obj.pass) ??
      n(obj.passed) ??
      n(obj.passes) ??
      n(obj.passedChecks) ??
      n(obj.ok) ??
      n(obj.info);
    const warn =
      n(obj.warn) ??
      n(obj.warnings) ??
      n(obj.warning) ??
      n(obj.warningCount);
    const fail =
      n(obj.fail) ??
      n(obj.failed) ??
      n(obj.failures) ??
      n(obj.failureCount) ??
      n(obj.errors) ??
      n(obj.error);
    if (pass !== undefined || warn !== undefined || fail !== undefined) {
      return { pass: pass ?? 0, warn: warn ?? 0, fail: fail ?? 0 };
    }
    const checks = obj.checks;
    if (checks && typeof checks === "object") {
      return pickTriple(checks as Record<string, unknown>);
    }
    return null;
  };

  const top = pickTriple(data);
  if (top) return top;

  const summary = data.summary;
  if (summary && typeof summary === "object") {
    const t = pickTriple(summary as Record<string, unknown>);
    if (t) return t;
  }

  const report = data.report;
  if (report && typeof report === "object") {
    const rep = report as Record<string, unknown>;
    const tSummary = rep.summary;
    if (tSummary && typeof tSummary === "object") {
      const t = pickTriple(tSummary as Record<string, unknown>);
      if (t) return t;
    }
    const t = pickTriple(rep);
    if (t) return t;
  }

  const findings = data.findings;
  if (Array.isArray(findings) && findings.length > 0) {
    let pass = 0;
    let warn = 0;
    let fail = 0;
    for (const item of findings) {
      if (!item || typeof item !== "object") {
        pass++;
        continue;
      }
      const f = item as Record<string, unknown>;
      const sev = String(f.severity ?? f.level ?? f.status ?? "").toLowerCase();
      if (/^(critical|high|severe|error|fail|failed|block|blocking)$/.test(sev)) {
        fail++;
      } else if (/^(warn|warning|medium|moderate|caution)$/.test(sev)) {
        warn++;
      } else {
        pass++;
      }
    }
    return { pass, warn, fail };
  }

  return null;
}
