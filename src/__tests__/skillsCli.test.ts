import { describe, it, expect } from "vitest";
import { parseSkillsCliOutput } from "@/stores/dataStore";

describe("parseSkillsCliOutput", () => {
  it("parses top-level array", () => {
    const rows = parseSkillsCliOutput('[{"name":"a","bundled":true}]', "");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("a");
  });

  it("reads skills from wrapper object", () => {
    const rows = parseSkillsCliOutput('{"skills":[{"id":"x"}]}', "");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("x");
  });

  it("uses stderr when stdout has logs", () => {
    const json = '{"list":[{"name":"from-stderr"}]}';
    const rows = parseSkillsCliOutput("Building skill index…\n", json);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("from-stderr");
  });

  it("extracts array after log prefix", () => {
    const rows = parseSkillsCliOutput('notice: ready\n[{"name":"late"}]\n', "");
    expect(rows).toHaveLength(1);
  });
});
