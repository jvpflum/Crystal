import { describe, it, expect } from "vitest";
import { parseOpenClawSecurityAuditJson } from "@/lib/securityAudit";

describe("parseOpenClawSecurityAuditJson", () => {
  it("reads top-level pass/warn/fail (legacy)", () => {
    expect(parseOpenClawSecurityAuditJson(JSON.stringify({ pass: 2, warn: 1, fail: 0 }))).toEqual({
      pass: 2,
      warn: 1,
      fail: 0,
    });
  });

  it("reads summary.passed / summary.warnings / summary.failures", () => {
    const raw = JSON.stringify({
      summary: { passed: 10, warnings: 3, failures: 1 },
    });
    expect(parseOpenClawSecurityAuditJson(raw)).toEqual({ pass: 10, warn: 3, fail: 1 });
  });

  it("aggregates findings by severity", () => {
    const raw = JSON.stringify({
      findings: [
        { checkId: "a", severity: "info" },
        { checkId: "b", severity: "warning" },
        { checkId: "c", severity: "critical" },
        { checkId: "d", severity: "high" },
      ],
    });
    expect(parseOpenClawSecurityAuditJson(raw)).toEqual({ pass: 1, warn: 1, fail: 2 });
  });

  it("strips log prefix before JSON object", () => {
    const raw = `[openclaw] starting audit\n${JSON.stringify({ summary: { pass: 4, warn: 0, fail: 0 } })}\n`;
    expect(parseOpenClawSecurityAuditJson(raw)).toEqual({ pass: 4, warn: 0, fail: 0 });
  });

  it("returns null for empty or non-json", () => {
    expect(parseOpenClawSecurityAuditJson("")).toBeNull();
    expect(parseOpenClawSecurityAuditJson("not json")).toBeNull();
  });
});
