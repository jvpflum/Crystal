"""
mempalace_query.py — single entry point for all Memory Palace queries.

Crystal's Memory view used to embed Python heredocs inside PowerShell
inside Tauri's exec, which broke on every other quote. This script
takes the same operations and exposes them as `python mempalace_query.py
<subcommand> [...]` so the GUI can call them with no shell escaping.

Every subcommand prints a JSON object on stdout and exits 0 on success.
Errors print a JSON `{"error": "..."}` and exit non-zero. The frontend
parses stdout as JSON for everything.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import traceback
from collections import defaultdict
from typing import Any


def _emit(payload: Any) -> None:
    sys.stdout.write(json.dumps(payload, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _fail(msg: str, code: int = 1) -> None:
    _emit({"error": msg})
    sys.exit(code)


def _has_palace_data(path: str) -> bool:
    """True if *path* holds a NON-EMPTY chroma store (has vectors). An empty
    ``chroma.sqlite3`` (a stale/placeholder palace, e.g. the old
    ``memory-palace`` left behind by the GPU re-index) is treated as no-data so
    the resolver prefers the dir that actually holds drawers. Kept consistent
    with ``memory-tools/palace_common.py``."""
    db = os.path.join(path, "chroma.sqlite3")
    if not os.path.isfile(db):
        return False
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            n = con.execute("SELECT COUNT(*) FROM embeddings").fetchone()[0]
            return int(n) > 0
        finally:
            con.close()
    except Exception:
        # Can't introspect -> assume it counts as data (don't be over-clever).
        return True


def _resolve_palace(explicit: str | None) -> str:
    """Resolve the palace path, *preferring a directory that actually holds a
    palace* (a non-empty chroma store). Priority: explicit ``--palace`` ->
    MEMPALACE/MEMPAL env vars -> mempalace config (only if it has data) ->
    first data-bearing candidate -> config path -> sensible default.

    This is the fix for the "memory shows EMPTY" symptom: the GPU re-index moved
    the live vectors into ``~/.openclaw/memory-palace-active`` but the mempalace
    config still points at the now-empty ``~/.openclaw/memory-palace``. The old
    resolver returned the config path unconditionally, so every read hit the
    empty store. We now skip a configured-but-empty palace in favour of the dir
    that holds the drawers, matching ``memory-tools/palace_common.py`` and the
    installed ``~/.openclaw/scripts`` copy."""
    if explicit:
        return explicit
    env_val = os.environ.get("MEMPALACE_PALACE_PATH") or os.environ.get("MEMPAL_PALACE_PATH")
    if env_val:
        return env_val

    config_path = None
    try:
        from mempalace.config import MempalaceConfig  # type: ignore

        config_path = MempalaceConfig().palace_path
    except Exception:
        config_path = None
    if config_path and _has_palace_data(config_path):
        return config_path

    for cand in (
        os.path.expanduser("~/.openclaw/memory-palace-active"),
        os.path.expanduser("~/.openclaw/memory-palace"),
        os.path.expanduser("~/.mempalace/palace"),
    ):
        if _has_palace_data(cand):
            return cand

    return config_path or os.path.expanduser("~/.openclaw/memory-palace")


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

def cmd_status(args: argparse.Namespace) -> None:
    palace = args.palace
    try:
        from mempalace.layers import MemoryStack
        from mempalace.palace import get_collection
    except Exception as e:
        _fail(f"mempalace import failed: {e}")

    out: dict[str, Any] = {
        "palacePath": palace,
        "totalDrawers": 0,
        "wings": [],
        "l0Identity": {"exists": False, "tokens": 0},
        "kgStats": None,
        "graphStats": None,
    }

    try:
        s = MemoryStack(palace_path=palace).status()
        out["totalDrawers"] = int(s.get("total_drawers", 0))
        l0 = s.get("L0_identity", {}) or {}
        out["l0Identity"] = {
            "exists": bool(l0.get("exists", False)),
            "tokens": int(l0.get("tokens", 0)),
        }
    except Exception:
        pass

    try:
        col = get_collection(palace, create=False)
        total = col.count()
        batch_size = 500
        wing_room = defaultdict(lambda: defaultdict(lambda: {"count": 0, "halls": set()}))
        offset = 0
        while offset < total:
            batch = col.get(limit=batch_size, offset=offset, include=["metadatas"])
            metas = batch.get("metadatas", []) or []
            for m in metas:
                w = (m or {}).get("wing", "unknown") or "unknown"
                r = (m or {}).get("room", "general") or "general"
                h = (m or {}).get("hall", "")
                wing_room[w][r]["count"] += 1
                if h:
                    wing_room[w][r]["halls"].add(h)
            if not metas or len(metas) < batch_size:
                break
            offset += batch_size
        wings = []
        for wname in sorted(wing_room):
            rooms_d = wing_room[wname]
            rooms = [
                {
                    "name": rn,
                    "drawerCount": int(rd["count"]),
                    "wing": wname,
                    "halls": sorted(rd["halls"]),
                }
                for rn, rd in sorted(rooms_d.items())
            ]
            wings.append({
                "name": wname,
                "rooms": rooms,
                "drawerCount": int(sum(rd["count"] for rd in rooms_d.values())),
            })
        out["wings"] = wings
    except Exception:
        pass

    try:
        from mempalace.knowledge_graph import KnowledgeGraph
        kg_path = os.path.join(palace, "knowledge_graph.sqlite3")
        if os.path.exists(kg_path):
            kg = KnowledgeGraph(db_path=kg_path)
            stats = kg.stats() or {}
            kg.close()
            out["kgStats"] = {
                "entities": int(stats.get("entities", 0)),
                "triples": int(stats.get("triples", 0)),
                "currentFacts": int(stats.get("current_facts", 0)),
                "expiredFacts": int(stats.get("expired_facts", 0)),
                "relationshipTypes": list(stats.get("relationship_types", []) or []),
            }
    except Exception:
        pass

    try:
        from mempalace.palace_graph import graph_stats as gs_fn
        gs = gs_fn() or {}
        out["graphStats"] = {
            "totalRooms": int(gs.get("total_rooms", 0)),
            "tunnelRooms": int(gs.get("tunnel_rooms", 0)),
            "totalEdges": int(gs.get("total_edges", 0)),
            "roomsPerWing": gs.get("rooms_per_wing", {}) or {},
            "topTunnels": gs.get("top_tunnels", []) or [],
        }
    except Exception:
        pass

    # Flat snake_case aliases so this rich-status script also satisfies the
    # installed-copy consumers (dataStore.ts reads drawers/rooms/kg_nodes/...).
    # `wings` intentionally stays the rich array for the Crystal frontend; the
    # flat consumer reads a numeric `wingCount` instead. (Deliverable 1)
    try:
        kg = out.get("kgStats") or {}
        rooms_total = sum(len(w.get("rooms", [])) for w in out.get("wings", []) or [])
        out["palace"] = palace
        out["drawers"] = int(out.get("totalDrawers", 0) or 0)
        out["wingCount"] = len(out.get("wings", []) or [])
        out["rooms"] = rooms_total
        out["closets"] = 0
        out["kg_nodes"] = int((kg or {}).get("entities", 0) or 0)
        out["kg_edges"] = int((kg or {}).get("triples", 0) or 0)
        out["last_mine_at"] = None
    except Exception:
        pass

    _emit(out)


# ---------------------------------------------------------------------------
# Knowledge graph
# ---------------------------------------------------------------------------

def _kg_path(palace: str) -> str:
    return os.path.join(palace, "knowledge_graph.sqlite3")


def cmd_entities(args: argparse.Namespace) -> None:
    db = _kg_path(args.palace)
    if not os.path.exists(db):
        _emit([])
        return
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """
        SELECT e.id, e.name, e.type, e.created_at,
               (SELECT COUNT(*) FROM triples t
                WHERE t.subject = e.id OR t.object = e.id) AS cnt
        FROM entities e
        ORDER BY cnt DESC, e.name ASC
        LIMIT ?
        """,
        (args.limit,),
    ).fetchall()
    con.close()
    _emit([
        {
            "name": r["name"],
            "type": r["type"],
            "tripleCount": int(r["cnt"]),
            "createdAt": r["created_at"],
        }
        for r in rows
    ])


def cmd_triples(args: argparse.Namespace) -> None:
    db = _kg_path(args.palace)
    if not os.path.exists(db):
        _emit([])
        return
    where = "WHERE t.valid_to IS NULL" if args.current else ""
    con = sqlite3.connect(db)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        f"""
        SELECT t.subject, t.predicate, t.object, t.valid_from, t.valid_to,
               t.confidence,
               COALESCE(es.name, t.subject) AS subject_name,
               COALESCE(eo.name, t.object)  AS object_name
        FROM triples t
        LEFT JOIN entities es ON es.id = t.subject
        LEFT JOIN entities eo ON eo.id = t.object
        {where}
        ORDER BY datetime(COALESCE(t.extracted_at, t.valid_from, '1970-01-01')) DESC
        LIMIT ?
        """,
        (args.limit,),
    ).fetchall()
    con.close()
    _emit([
        {
            "subject": r["subject_name"],
            "predicate": r["predicate"],
            "object": r["object_name"],
            "validFrom": r["valid_from"],
            "validTo": r["valid_to"],
            "current": r["valid_to"] is None,
            "confidence": r["confidence"],
        }
        for r in rows
    ])


def _normalize_triple(r: dict) -> dict:
    """Convert mempalace's snake_case triples into the camelCase shape the
    Crystal frontend (KGTriple interface) expects."""
    valid_from = r.get("valid_from")
    valid_to = r.get("valid_to")
    return {
        "subject": r.get("subject"),
        "predicate": r.get("predicate"),
        "object": r.get("object"),
        "validFrom": valid_from,
        "validTo": valid_to,
        "current": r.get("current") if r.get("current") is not None else (valid_to is None),
        "direction": r.get("direction"),
        "confidence": r.get("confidence"),
    }


def cmd_query_entity(args: argparse.Namespace) -> None:
    try:
        from mempalace.knowledge_graph import KnowledgeGraph
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    db = _kg_path(args.palace)
    if not os.path.exists(db):
        _emit([])
        return
    kg = KnowledgeGraph(db_path=db)
    try:
        kwargs: dict[str, Any] = {"direction": "both"}
        if args.as_of:
            kwargs["as_of"] = args.as_of
        results = kg.query_entity(args.name, **kwargs) or []
    finally:
        kg.close()
    _emit([_normalize_triple(r) for r in results])


def cmd_timeline(args: argparse.Namespace) -> None:
    try:
        from mempalace.knowledge_graph import KnowledgeGraph
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    db = _kg_path(args.palace)
    if not os.path.exists(db):
        _emit([])
        return
    kg = KnowledgeGraph(db_path=db)
    try:
        results = kg.timeline(entity_name=args.entity) or []
    finally:
        kg.close()
    _emit([_normalize_triple(r) for r in results])


def cmd_add_triple(args: argparse.Namespace) -> None:
    try:
        from mempalace.knowledge_graph import KnowledgeGraph
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    kg = KnowledgeGraph(db_path=_kg_path(args.palace))
    try:
        kwargs: dict[str, Any] = {}
        if args.valid_from:
            kwargs["valid_from"] = args.valid_from
        kg.add_triple(args.subject, args.predicate, args.object, **kwargs)
    finally:
        kg.close()
    _emit({"ok": True})


# ---------------------------------------------------------------------------
# Palace graph (tunnels)
# ---------------------------------------------------------------------------

def cmd_tunnels(args: argparse.Namespace) -> None:
    try:
        from mempalace.palace_graph import find_tunnels
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    _emit(find_tunnels(wing_a=args.wing) or [])


def cmd_explicit_tunnels(args: argparse.Namespace) -> None:
    try:
        from mempalace.palace_graph import list_tunnels
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    raw = list_tunnels(wing=args.wing) or []
    out = []
    for t in raw:
        out.append({
            "id": t.get("id", ""),
            "source": {
                "wing": (t.get("source") or {}).get("wing", ""),
                "room": (t.get("source") or {}).get("room", ""),
            },
            "target": {
                "wing": (t.get("target") or {}).get("wing", ""),
                "room": (t.get("target") or {}).get("room", ""),
            },
            "label": t.get("label", ""),
            "createdAt": t.get("created_at"),
        })
    _emit(out)


# ---------------------------------------------------------------------------
# Search & wake-up
# ---------------------------------------------------------------------------

def _resolve_query(args: argparse.Namespace) -> str | None:
    """Accept the query from either the positional arg (palace-recall /
    installed-script style: ``search <query> --results N``) or the ``--query``
    flag (Crystal frontend style: ``search --query <query> --n N``)."""
    return getattr(args, "query_opt", None) or getattr(args, "query", None)


def cmd_search(args: argparse.Namespace) -> None:
    try:
        from mempalace.searcher import search_memories
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    query = _resolve_query(args)
    if not query:
        _fail("search requires a query (positional or --query)")
    kwargs: dict[str, Any] = {
        "wing": args.wing,
        "room": args.room,
        "n_results": args.n,
    }
    # max_distance is supported by newer mempalace; pass only if requested so we
    # stay compatible with older installs.
    if getattr(args, "max_distance", None):
        kwargs["max_distance"] = args.max_distance
    try:
        parsed = search_memories(query, args.palace, **kwargs) or {}
    except TypeError:
        # Older signature without max_distance: retry without it.
        kwargs.pop("max_distance", None)
        parsed = search_memories(query, args.palace, **kwargs) or {}
    results = []
    for r in parsed.get("results", []) or []:
        source_file = str(r.get("source_file", "?") or "?")
        matched_via = str(r.get("matched_via", "drawer") or "drawer")
        similarity = float(r.get("similarity", 0) or 0)
        # Emit BOTH camelCase (Crystal frontend) and snake_case (palace-recall /
        # installed-script consumers) so a single drawer entry satisfies every
        # caller regardless of which copy of this script is invoked.
        results.append({
            "text": str(r.get("text", "") or ""),
            "wing": str(r.get("wing", "unknown") or "unknown"),
            "room": str(r.get("room", "unknown") or "unknown"),
            "sourceFile": source_file,
            "source_file": source_file,
            "similarity": similarity,
            "distance": float(r.get("distance", 0) or 0),
            "closetBoost": float(r.get("closet_boost", 0) or 0),
            "matchedVia": matched_via,
            "matched_via": matched_via,
            "bm25Score": float(r.get("bm25_score", 0) or 0),
            "drawerIndex": r.get("drawer_index"),
            "totalDrawers": r.get("total_drawers"),
        })
    _emit({
        "query": parsed.get("query", query),
        "palace": args.palace,
        "count": len(results),
        "filters": parsed.get("filters", {}) or {},
        "totalBeforeFilter": int(parsed.get("total_before_filter", 0) or 0),
        "results": results,
    })


def cmd_save(args: argparse.Namespace) -> None:
    """File a single drawer with an explicit wing/room. Mirrors the installed
    ``~/.openclaw/scripts`` copy so channel integrations work with either."""
    text = args.text
    if not text and not sys.stdin.isatty():
        text = sys.stdin.read()
    text = (text or "").strip()
    if not text:
        _fail("empty text")
    try:
        from mempalace.palace import get_collection
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    import hashlib
    from datetime import datetime, timezone

    wing = (args.wing or "captures").strip() or "captures"
    room = (args.room or "general").strip() or "general"
    try:
        col = get_collection(args.palace, create=True)
    except Exception as e:
        _fail(f"collection: {e}")
    drawer_id = args.id or "drawer_" + hashlib.sha256(
        f"{wing}|{room}|{text}|{datetime.now(timezone.utc).isoformat()}".encode("utf-8")
    ).hexdigest()[:24]
    metadata: dict[str, Any] = {
        "wing": wing,
        "room": room,
        "agent": args.agent or "channel",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if args.source:
        metadata["source_file"] = args.source
    if args.channel:
        metadata["channel"] = args.channel
    if args.channel_id:
        metadata["channel_id"] = args.channel_id
    try:
        col.upsert(ids=[drawer_id], documents=[text], metadatas=[metadata])
    except Exception as e:
        _fail(f"upsert: {e}")
    _emit({"id": drawer_id, "wing": wing, "room": room, "palace": args.palace, "bytes": len(text)})


def cmd_wake_up(args: argparse.Namespace) -> None:
    """wake-up returns a plain string, not JSON. We wrap it in a JSON object
    so the frontend can parse uniformly."""
    try:
        from mempalace.layers import MemoryStack
    except Exception as e:
        _fail(f"mempalace import failed: {e}")
    try:
        stack = MemoryStack(palace_path=args.palace)
        text = stack.wake_up_context(wing=args.wing) if hasattr(stack, "wake_up_context") else ""
    except Exception:
        text = ""
    if not text:
        # Fall back to the CLI which is what the GUI used to call. We do this
        # in-process to avoid a second subprocess hop.
        try:
            from mempalace import __main__ as mp_main  # noqa: F401
            from mempalace.layers import MemoryStack as _MS
            text = _MS(palace_path=args.palace).essential_context() if hasattr(_MS, "essential_context") else ""
        except Exception:
            text = ""
    _emit({"text": text or ""})


# ---------------------------------------------------------------------------
# Lifecycle (init / mine / compress / repair) — call into the CLI for parity
# with what the user already runs from a terminal.
# ---------------------------------------------------------------------------

def _run_cli(args_list: list[str]) -> dict[str, Any]:
    import subprocess
    proc = subprocess.run(
        [sys.executable, "-m", "mempalace", *args_list],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "ok": proc.returncode == 0,
        "stdout": proc.stdout or "",
        "stderr": proc.stderr or "",
        "code": proc.returncode,
    }


def cmd_init(args: argparse.Namespace) -> None:
    _emit(_run_cli(["--palace", args.palace, "init", args.workspace, "--yes"]))


def cmd_mine(args: argparse.Namespace) -> None:
    _emit(_run_cli(["--palace", args.palace, "mine", args.source, "--mode", args.mode]))


def cmd_compress(args: argparse.Namespace) -> None:
    cli = ["--palace", args.palace, "compress"]
    if args.wing:
        cli += ["--wing", args.wing]
    if args.dry_run:
        cli += ["--dry-run"]
    _emit(_run_cli(cli))


def cmd_repair(args: argparse.Namespace) -> None:
    _emit(_run_cli(["--palace", args.palace, "repair", "--yes"]))


# ---------------------------------------------------------------------------
# resolve — expose the resolved (data-bearing) palace path to the frontend so
# the TS client never has to hard-code which directory the live store lives in.
# ---------------------------------------------------------------------------

def cmd_resolve(args: argparse.Namespace) -> None:
    palace = args.palace
    _emit({
        "palace": palace,
        "hasData": _has_palace_data(palace),
        "chromaPath": os.path.join(palace, "chroma.sqlite3"),
        "kgPath": _kg_path(palace),
    })


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mempalace_query")
    # --palace is global so callers can pass it before *or* after the
    # subcommand. The Crystal frontend always passes it first. It is optional:
    # when omitted we resolve via env / mempalace config / sensible defaults so
    # this stays interchangeable with the installed ~/.openclaw/scripts copy.
    p.add_argument("--palace", default=None)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("status")
    s.set_defaults(func=cmd_status)

    s = sub.add_parser("entities")
    s.add_argument("--limit", type=int, default=500)
    s.set_defaults(func=cmd_entities)

    s = sub.add_parser("triples")
    s.add_argument("--limit", type=int, default=100)
    s.add_argument("--current", action="store_true")
    s.set_defaults(func=cmd_triples)

    s = sub.add_parser("query-entity")
    s.add_argument("--name", required=True)
    s.add_argument("--as-of", default=None)
    s.set_defaults(func=cmd_query_entity)

    s = sub.add_parser("timeline")
    s.add_argument("--entity", default=None)
    s.set_defaults(func=cmd_timeline)

    s = sub.add_parser("add-triple")
    s.add_argument("--subject", required=True)
    s.add_argument("--predicate", required=True)
    s.add_argument("--object", required=True)
    s.add_argument("--valid-from", default=None)
    s.set_defaults(func=cmd_add_triple)

    s = sub.add_parser("tunnels")
    s.add_argument("--wing", default=None)
    s.set_defaults(func=cmd_tunnels)

    s = sub.add_parser("explicit-tunnels")
    s.add_argument("--wing", default=None)
    s.set_defaults(func=cmd_explicit_tunnels)

    s = sub.add_parser("search")
    # Dual calling conventions (Deliverable 1, backward-compatible aliases):
    #   palace-recall / installed style:  search "<query>" --results N
    #   Crystal frontend style:           search --query "<query>" --n N
    s.add_argument("query", nargs="?", default=None, help="Query (positional)")
    s.add_argument("--query", dest="query_opt", default=None, help="Query (flag alias)")
    s.add_argument("--wing", default=None)
    s.add_argument("--room", default=None)
    s.add_argument("--n", "--results", dest="n", type=int, default=5)
    s.add_argument("--max-distance", dest="max_distance", type=float, default=None)
    s.set_defaults(func=cmd_search)

    s = sub.add_parser("save")
    s.add_argument("text", nargs="?", default=None, help="Body text (or read stdin)")
    s.add_argument("--wing", default=None)
    s.add_argument("--room", default=None)
    s.add_argument("--agent", default="channel")
    s.add_argument("--source", default=None)
    s.add_argument("--channel", default=None)
    s.add_argument("--channel-id", dest="channel_id", default=None)
    s.add_argument("--id", default=None)
    s.set_defaults(func=cmd_save)

    s = sub.add_parser("wake-up")
    s.add_argument("--wing", default=None)
    s.set_defaults(func=cmd_wake_up)

    s = sub.add_parser("init")
    s.add_argument("--workspace", required=True)
    s.set_defaults(func=cmd_init)

    s = sub.add_parser("mine")
    s.add_argument("--source", required=True)
    s.add_argument("--mode", default="projects", choices=["projects", "convos"])
    s.set_defaults(func=cmd_mine)

    s = sub.add_parser("compress")
    s.add_argument("--wing", default=None)
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(func=cmd_compress)

    s = sub.add_parser("repair")
    s.set_defaults(func=cmd_repair)

    s = sub.add_parser("resolve")
    s.set_defaults(func=cmd_resolve)

    return p


def main() -> None:
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    parser = build_parser()
    args = parser.parse_args()
    args.palace = _resolve_palace(getattr(args, "palace", None))
    try:
        args.func(args)
    except SystemExit:
        raise
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        _fail(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
