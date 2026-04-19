import { invoke } from "@tauri-apps/api/core";

/* ─── Types ─── */

export interface PalaceWing {
  name: string;
  rooms: PalaceRoom[];
  drawerCount: number;
}

export interface PalaceRoom {
  name: string;
  drawerCount: number;
  wing: string;
  halls?: string[];
}

export interface PalaceDrawer {
  text: string;
  wing: string;
  room: string;
  sourceFile: string;
  similarity?: number;
  distance?: number;
  closetBoost?: number;
  matchedVia?: string;
  bm25Score?: number;
  drawerIndex?: number;
  totalDrawers?: number;
}

export interface PalaceSearchResult {
  query: string;
  filters: { wing?: string; room?: string };
  totalBeforeFilter: number;
  results: PalaceDrawer[];
}

export interface PalaceTunnel {
  room: string;
  wings: string[];
  halls: string[];
  count: number;
  recent?: string;
}

export interface ExplicitTunnel {
  id: string;
  source: { wing: string; room: string };
  target: { wing: string; room: string };
  label: string;
  createdAt?: string;
}

export interface GraphStats {
  totalRooms: number;
  tunnelRooms: number;
  totalEdges: number;
  roomsPerWing: Record<string, number>;
  topTunnels: { room: string; wings: string[]; count: number }[];
}

export interface PalaceStatus {
  palacePath: string;
  totalDrawers: number;
  wings: PalaceWing[];
  l0Identity: { exists: boolean; tokens: number };
  kgStats?: KnowledgeGraphStats;
  graphStats?: GraphStats;
}

export interface KnowledgeGraphStats {
  entities: number;
  triples: number;
  currentFacts: number;
  expiredFacts: number;
  relationshipTypes: string[];
}

export interface KGTriple {
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string;
  validTo?: string;
  current: boolean;
  direction?: "outgoing" | "incoming";
  confidence?: number;
}

export interface KGEntity {
  name: string;
  type?: string;
  tripleCount: number;
  createdAt?: string;
}

export interface LayerStatus {
  palacePath: string;
  L0_identity: { path: string; exists: boolean; tokens: number };
  total_drawers: number;
}

interface ScriptResult { stdout: string; stderr: string; code: number }

/* ─── Client ─── */

export class MemoryPalaceClient {
  private palacePath: string | null = null;
  private _palacePathPromise: Promise<string> | null = null;

  async getPalacePath(): Promise<string> {
    if (this.palacePath) return this.palacePath;
    if (this._palacePathPromise) return this._palacePathPromise;

    this._palacePathPromise = (async () => {
      try {
        const result = await invoke<{ stdout: string }>("execute_command", {
          command: `echo $env:USERPROFILE\\.openclaw\\memory-palace`,
          cwd: null,
        });
        const path = result.stdout.trim().replace(/\r?\n/g, "");
        if (!path) throw new Error("Empty palace path");
        this.palacePath = path;
        return path;
      } catch (e) {
        this._palacePathPromise = null;
        throw e;
      }
    })();

    return this._palacePathPromise;
  }

  /**
   * Run mempalace_query.py via the Tauri side-channel. No shell, no quoting:
   * each arg becomes a real argv entry. Returns parsed JSON, or null on
   * non-zero exit / parse failure.
   */
  private async runScript<T = unknown>(args: string[], timeoutMs = 30_000): Promise<T | null> {
    try {
      const result = await Promise.race([
        invoke<ScriptResult>("run_python_script", { script: "mempalace_query.py", args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`mempalace_query timed out after ${timeoutMs}ms`)), timeoutMs)),
      ]);
      if (result.code !== 0) {
        if (import.meta.env.DEV) {
          console.warn("[Palace] mempalace_query failed", { args, code: result.code, stderr: result.stderr });
        }
        return null;
      }
      const out = result.stdout.trim();
      if (!out) return null;
      try {
        return JSON.parse(out) as T;
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn("[Palace] mempalace_query stdout not JSON:", out.slice(0, 200), e);
        }
        return null;
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[Palace] runScript threw:", e);
      return null;
    }
  }

  private async withPalace<T = unknown>(rest: string[], timeoutMs?: number): Promise<T | null> {
    const palace = await this.getPalacePath();
    return this.runScript<T>(["--palace", palace, ...rest], timeoutMs);
  }

  /* ─── Palace Operations ─── */

  async isInitialized(): Promise<boolean> {
    try {
      const palace = await this.getPalacePath();
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: `powershell -Command "if(Test-Path '${palace}\\chroma.sqlite3'){Write-Output 'YES'}else{Write-Output 'NO'}"`,
        cwd: null,
      });
      return result.stdout.trim() === "YES";
    } catch {
      return false;
    }
  }

  async initialize(workspaceDir: string): Promise<{ success: boolean; message: string }> {
    const r = await this.withPalace<{ ok: boolean; stdout: string; stderr: string; code: number }>(
      ["init", "--workspace", workspaceDir],
      120_000,
    );
    if (!r) return { success: false, message: "Init failed" };
    return {
      success: r.ok,
      message: (r.stdout || r.stderr || "Done").trim(),
    };
  }

  async mine(sourceDir: string, mode: "projects" | "convos" = "projects"): Promise<{ success: boolean; message: string }> {
    const r = await this.withPalace<{ ok: boolean; stdout: string; stderr: string; code: number }>(
      ["mine", "--source", sourceDir, "--mode", mode],
      300_000,
    );
    if (!r) return { success: false, message: "Mine failed" };
    return { success: r.ok, message: (r.stdout || r.stderr || "Mining complete").trim() };
  }

  /* ─── Wake-up Context ─── */

  async getWakeUpContext(wing?: string): Promise<string> {
    const args = ["wake-up"];
    if (wing) args.push("--wing", wing);
    const r = await this.withPalace<{ text: string }>(args, 15_000);
    return r?.text ?? "";
  }

  /* ─── Search ─── */

  async search(query: string, wing?: string, room?: string, nResults = 5): Promise<PalaceSearchResult> {
    const args = ["search", "--query", query, "--n", String(nResults)];
    if (wing) args.push("--wing", wing);
    if (room) args.push("--room", room);
    const r = await this.withPalace<PalaceSearchResult>(args, 60_000);
    return r ?? { query, filters: { wing, room }, totalBeforeFilter: 0, results: [] };
  }

  /* ─── Status ─── */

  async getStatus(): Promise<PalaceStatus | null> {
    return await this.withPalace<PalaceStatus>(["status"], 30_000);
  }

  /* ─── Knowledge Graph ─── */

  async queryEntity(name: string, asOf?: string): Promise<KGTriple[]> {
    const args = ["query-entity", "--name", name];
    if (asOf) args.push("--as-of", asOf);
    return (await this.withPalace<KGTriple[]>(args)) ?? [];
  }

  async getTimeline(entity?: string): Promise<KGTriple[]> {
    const args = ["timeline"];
    if (entity) args.push("--entity", entity);
    return (await this.withPalace<KGTriple[]>(args)) ?? [];
  }

  /**
   * List every entity in the knowledge graph with its triple count, sorted by
   * most-connected first.
   */
  async listEntities(limit = 500): Promise<KGEntity[]> {
    return (await this.withPalace<KGEntity[]>(["entities", "--limit", String(limit)])) ?? [];
  }

  /**
   * Recent or all triples, newest first. Used by the KG "recent facts" panel
   * so users can see the graph is populated without typing a query.
   */
  async listAllTriples(limit = 100, currentOnly = true): Promise<KGTriple[]> {
    const args = ["triples", "--limit", String(limit)];
    if (currentOnly) args.push("--current");
    return (await this.withPalace<KGTriple[]>(args)) ?? [];
  }

  async addTriple(
    subject: string,
    predicate: string,
    object: string,
    validFrom?: string,
  ): Promise<boolean> {
    const args = ["add-triple", "--subject", subject, "--predicate", predicate, "--object", object];
    if (validFrom) args.push("--valid-from", validFrom);
    const r = await this.withPalace<{ ok: boolean }>(args);
    return r?.ok === true;
  }

  /* ─── Tunnels (cross-wing links) ─── */

  async getTunnels(wing?: string): Promise<PalaceTunnel[]> {
    const args = ["tunnels"];
    if (wing) args.push("--wing", wing);
    return (await this.withPalace<PalaceTunnel[]>(args)) ?? [];
  }

  async getExplicitTunnels(wing?: string): Promise<ExplicitTunnel[]> {
    const args = ["explicit-tunnels"];
    if (wing) args.push("--wing", wing);
    return (await this.withPalace<ExplicitTunnel[]>(args)) ?? [];
  }

  /* ─── Compression ─── */

  async compress(wing?: string, dryRun = false): Promise<{ success: boolean; message: string }> {
    const args = ["compress"];
    if (wing) args.push("--wing", wing);
    if (dryRun) args.push("--dry-run");
    const r = await this.withPalace<{ ok: boolean; stdout: string; stderr: string }>(args, 120_000);
    if (!r) return { success: false, message: "Compress failed" };
    return { success: r.ok, message: (r.stdout || r.stderr || "Done").trim() };
  }

  /* ─── Repair ─── */

  async repair(): Promise<{ success: boolean; message: string }> {
    const r = await this.withPalace<{ ok: boolean; stdout: string; stderr: string }>(["repair"], 120_000);
    if (!r) return { success: false, message: "Repair failed" };
    return { success: r.ok, message: (r.stdout || r.stderr || "Done").trim() };
  }

  /* ─── Identity ─── */

  async getIdentity(): Promise<string> {
    try {
      const result = await invoke<string>("read_file", {
        path: `${await this.getHomePath()}\\identity.txt`,
      });
      return result;
    } catch {
      return "";
    }
  }

  async setIdentity(text: string): Promise<boolean> {
    try {
      const home = await this.getHomePath();
      await invoke("execute_command", {
        command: `New-Item -ItemType Directory -Force -Path "${home}"`,
        cwd: null,
      });
      await invoke("write_file", {
        path: `${home}\\identity.txt`,
        content: text,
      });
      return true;
    } catch {
      return false;
    }
  }

  private async getHomePath(): Promise<string> {
    const result = await invoke<{ stdout: string }>("execute_command", {
      command: `echo $env:USERPROFILE\\.mempalace`,
      cwd: null,
    });
    return result.stdout.trim().replace(/\r?\n/g, "");
  }
}

export const memoryPalaceClient = new MemoryPalaceClient();
