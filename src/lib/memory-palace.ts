import { invoke } from "@tauri-apps/api/core";
import { escapeShellArg } from "@/lib/tools";

const PYTHON = "python";
const MP_CMD = `${PYTHON} -m mempalace`;

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

export interface LayerStatus {
  palacePath: string;
  L0_identity: { path: string; exists: boolean; tokens: number };
  total_drawers: number;
}

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

  private async exec(args: string, timeout = 30_000): Promise<{ stdout: string; stderr: string; code: number }> {
    const palace = await this.getPalacePath();
    const cmd = `$env:PYTHONIOENCODING="utf-8"; ${MP_CMD} --palace "${escapeShellArg(palace)}" ${args}`;
    const result = await Promise.race([
      invoke<{ stdout: string; stderr: string; code: number }>("execute_command", { command: cmd, cwd: null }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("mempalace timed out")), timeout)),
    ]);
    return result;
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
    try {
      const result = await this.exec(
        `init "${escapeShellArg(workspaceDir)}" --yes`,
        120_000,
      );
      return {
        success: result.code === 0,
        message: result.stdout.trim() || result.stderr.trim() || "Done",
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : "Init failed" };
    }
  }

  async mine(sourceDir: string, mode: "projects" | "convos" = "projects"): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.exec(
        `mine "${escapeShellArg(sourceDir)}" --mode ${mode}`,
        300_000,
      );
      return {
        success: result.code === 0,
        message: result.stdout.trim() || result.stderr.trim() || "Mining complete",
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : "Mine failed" };
    }
  }

  /* ─── Wake-up Context ─── */

  async getWakeUpContext(wing?: string): Promise<string> {
    try {
      const wingArg = wing ? ` --wing "${escapeShellArg(wing)}"` : "";
      const result = await this.exec(`wake-up${wingArg}`, 15_000);
      if (result.code === 0) return result.stdout.trim();
    } catch { /* fall through */ }
    return "";
  }

  /* ─── Search ─── */

  async search(query: string, wing?: string, room?: string, nResults = 5): Promise<PalaceSearchResult> {
    try {
      const palace = await this.getPalacePath();
      const wingPy = wing ? `'${escapeShellArg(wing)}'` : "None";
      const roomPy = room ? `'${escapeShellArg(room)}'` : "None";
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "import json; from mempalace.searcher import search_memories; print(json.dumps(search_memories('${escapeShellArg(query.replace(/'/g, "\\'"))}', '${escapeShellArg(palace)}', wing=${wingPy}, room=${roomPy}, n_results=${nResults})))"`;

      const result = await invoke<{ stdout: string; code: number }>("execute_command", { command: cmd, cwd: null });

      if (result.code === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout);
        return {
          query: parsed.query,
          filters: parsed.filters || {},
          totalBeforeFilter: parsed.total_before_filter || 0,
          results: (parsed.results || []).map((r: Record<string, unknown>) => ({
            text: String(r.text || ""),
            wing: String(r.wing || "unknown"),
            room: String(r.room || "unknown"),
            sourceFile: String(r.source_file || "?"),
            similarity: Number(r.similarity || 0),
            distance: Number(r.distance || 0),
            closetBoost: Number(r.closet_boost || 0),
            matchedVia: String(r.matched_via || "drawer"),
            bm25Score: Number(r.bm25_score || 0),
            drawerIndex: r.drawer_index != null ? Number(r.drawer_index) : undefined,
            totalDrawers: r.total_drawers != null ? Number(r.total_drawers) : undefined,
          })),
        };
      }
    } catch { /* fall through */ }

    return { query, filters: { wing, room }, totalBeforeFilter: 0, results: [] };
  }

  /* ─── Status ─── */

  async getStatus(): Promise<PalaceStatus | null> {
    try {
      const palace = await this.getPalacePath();
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "
import json
from mempalace.layers import MemoryStack
from mempalace.palace import get_collection
from collections import Counter, defaultdict

palace = '${escapeShellArg(palace)}'
stack = MemoryStack(palace_path=palace)
s = stack.status()

wings_data = []
try:
    col = get_collection(palace, create=False)
    total = col.count()
    _B = 500
    wing_room_halls = defaultdict(lambda: defaultdict(lambda: {'count': 0, 'halls': set()}))
    offset = 0
    while offset < total:
        batch = col.get(limit=_B, offset=offset, include=['metadatas'])
        for m in batch.get('metadatas', []):
            w = m.get('wing', 'unknown')
            r = m.get('room', 'general')
            h = m.get('hall', '')
            wing_room_halls[w][r]['count'] += 1
            if h:
                wing_room_halls[w][r]['halls'].add(h)
        if len(batch.get('ids', [])) < _B:
            break
        offset += _B
    for wname in sorted(wing_room_halls):
        rooms = wing_room_halls[wname]
        wcount = sum(rd['count'] for rd in rooms.values())
        rlist = [{'name': rn, 'drawerCount': rd['count'], 'wing': wname, 'halls': sorted(rd['halls'])} for rn, rd in sorted(rooms.items())]
        wings_data.append({'name': wname, 'rooms': rlist, 'drawerCount': wcount})
except Exception:
    pass

kg_stats = None
try:
    import os
    from mempalace.knowledge_graph import KnowledgeGraph
    kg = KnowledgeGraph(db_path=os.path.join(palace, 'knowledge_graph.sqlite3'))
    kg_stats = kg.stats()
    kg.close()
except Exception:
    pass

graph_stats = None
try:
    from mempalace.palace_graph import graph_stats as gs_fn
    graph_stats = gs_fn()
except Exception:
    pass

result = {
    'palacePath': palace,
    'totalDrawers': s.get('total_drawers', 0),
    'wings': wings_data,
    'l0Identity': {'exists': s['L0_identity']['exists'], 'tokens': s['L0_identity']['tokens']},
    'kgStats': kg_stats,
    'graphStats': graph_stats,
}
print(json.dumps(result))
"`;

      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });

      if (result.code === 0 && result.stdout.trim()) {
        return JSON.parse(result.stdout);
      }
    } catch { /* fall through */ }
    return null;
  }

  /* ─── Knowledge Graph ─── */

  async queryEntity(name: string, asOf?: string): Promise<KGTriple[]> {
    try {
      const palace = await this.getPalacePath();
      const asOfArg = asOf ? `, as_of='${escapeShellArg(asOf)}'` : "";
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "
import os, json
from mempalace.knowledge_graph import KnowledgeGraph
kg = KnowledgeGraph(db_path=os.path.join('${escapeShellArg(palace)}', 'knowledge_graph.sqlite3'))
results = kg.query_entity('${escapeShellArg(name)}', direction='both'${asOfArg})
kg.close()
print(json.dumps(results))
"`;

      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });

      if (result.code === 0 && result.stdout.trim()) {
        return JSON.parse(result.stdout);
      }
    } catch { /* fall through */ }
    return [];
  }

  async getTimeline(entity?: string): Promise<KGTriple[]> {
    try {
      const palace = await this.getPalacePath();
      const entityArg = entity ? `'${escapeShellArg(entity)}'` : "None";
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "
import os, json
from mempalace.knowledge_graph import KnowledgeGraph
kg = KnowledgeGraph(db_path=os.path.join('${escapeShellArg(palace)}', 'knowledge_graph.sqlite3'))
results = kg.timeline(entity_name=${entityArg})
kg.close()
print(json.dumps(results))
"`;

      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });

      if (result.code === 0 && result.stdout.trim()) {
        return JSON.parse(result.stdout);
      }
    } catch { /* fall through */ }
    return [];
  }

  async addTriple(
    subject: string,
    predicate: string,
    object: string,
    validFrom?: string,
  ): Promise<boolean> {
    try {
      const palace = await this.getPalacePath();
      const fromArg = validFrom ? `, valid_from='${escapeShellArg(validFrom)}'` : "";
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "
import os
from mempalace.knowledge_graph import KnowledgeGraph
kg = KnowledgeGraph(db_path=os.path.join('${escapeShellArg(palace)}', 'knowledge_graph.sqlite3'))
kg.add_triple('${escapeShellArg(subject)}', '${escapeShellArg(predicate)}', '${escapeShellArg(object)}'${fromArg})
kg.close()
print('OK')
"`;

      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });
      return result.code === 0;
    } catch {
      return false;
    }
  }

  /* ─── Tunnels (cross-wing links) ─── */

  async getTunnels(wing?: string): Promise<PalaceTunnel[]> {
    try {
      const wingPy = wing ? `'${escapeShellArg(wing)}'` : "None";
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "
import json
from mempalace.palace_graph import find_tunnels
t = find_tunnels(wing_a=${wingPy})
print(json.dumps(t))
"`;
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        return JSON.parse(result.stdout);
      }
    } catch { /* fall through */ }
    return [];
  }

  async getExplicitTunnels(wing?: string): Promise<ExplicitTunnel[]> {
    try {
      const wingPy = wing ? `'${escapeShellArg(wing)}'` : "None";
      const cmd = `$env:PYTHONIOENCODING="utf-8"; ${PYTHON} -c "
import json
from mempalace.palace_graph import list_tunnels
t = list_tunnels(wing=${wingPy})
print(json.dumps(t))
"`;
      const result = await invoke<{ stdout: string; code: number }>("execute_command", {
        command: cmd, cwd: null,
      });
      if (result.code === 0 && result.stdout.trim()) {
        return JSON.parse(result.stdout);
      }
    } catch { /* fall through */ }
    return [];
  }

  /* ─── Compression ─── */

  async compress(wing?: string, dryRun = false): Promise<{ success: boolean; message: string }> {
    try {
      const wingArg = wing ? ` --wing "${escapeShellArg(wing)}"` : "";
      const dryArg = dryRun ? " --dry-run" : "";
      const result = await this.exec(`compress${wingArg}${dryArg}`, 120_000);
      return {
        success: result.code === 0,
        message: result.stdout.trim() || result.stderr.trim() || "Done",
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : "Compress failed" };
    }
  }

  /* ─── Repair ─── */

  async repair(): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.exec("repair --yes", 120_000);
      return {
        success: result.code === 0,
        message: result.stdout.trim() || result.stderr.trim() || "Done",
      };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : "Repair failed" };
    }
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
