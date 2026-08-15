import {
  DB,
  getBuild,
  getPart,
  getPartHistory,
  listParts,
  type PartFilter,
  type PartStatus,
  type PartType,
} from "./db.ts";
import { allocationForGroup } from "./allocation.ts";
import { VERSION } from "./version.ts";
import openapiSpec from "./openapi.json" with { type: "json" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

function parseIntParam(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  return parseInt(value, 10);
}

const PART_TYPES: readonly PartType[] = [
  "motor",
  "fc",
  "esc",
  "vtx",
  "frame",
  "camera",
  "antenna",
  "battery",
  "craft",
  "gear",
  "other",
];
const PART_STATUSES: readonly PartStatus[] = ["unused", "in-use", "broken", "retired", "lost"];

function isPartType(value: string): value is PartType {
  return (PART_TYPES as readonly string[]).includes(value);
}

function isPartStatus(value: string): value is PartStatus {
  return (PART_STATUSES as readonly string[]).includes(value);
}

export function handleApi(db: DB, req: Request, url: URL): Response | null {
  const path = url.pathname;
  if (path !== "/api" && !path.startsWith("/api/")) return null;

  if (path === "/api/health" && req.method === "GET") {
    return json({ status: "ok", version: VERSION, name: "fpv-inventory" });
  }

  if (path === "/api/openapi.json" && req.method === "GET") {
    return json(openapiSpec);
  }

  if (path === "/api/parts" && req.method === "GET") {
    const filter: PartFilter = {};
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    const parentIdParam = url.searchParams.get("parent_id");

    if (type !== null) {
      if (!isPartType(type)) return json([]);
      filter.type = type;
    }
    if (status !== null) {
      if (!isPartStatus(status)) return json([]);
      filter.status = status;
    }
    if (q !== null) filter.q = q;
    const parentId = parseIntParam(parentIdParam);
    if (parentId !== undefined) filter.parent_id = parentId === 0 ? null : parentId;

    return json(listParts(db, filter));
  }

  const partDetailMatch = path.match(/^\/api\/parts\/(\d+)$/);
  if (partDetailMatch && req.method === "GET") {
    const id = parseInt(partDetailMatch[1], 10);
    const part = getPart(db, id);
    if (!part) return errorResponse("Part not found", 404);
    const history = getPartHistory(db, id);
    return json({ ...part, history });
  }

  if (path === "/api/builds" && req.method === "GET") {
    const filter: PartFilter = { type: "craft", parent_id: null };
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");

    if (status !== null) {
      if (!isPartStatus(status)) return json([]);
      filter.status = status;
    }
    if (q !== null) filter.q = q;

    return json(listParts(db, filter));
  }

  const buildDetailMatch = path.match(/^\/api\/builds\/(\d+)$/);
  if (buildDetailMatch && req.method === "GET") {
    const id = parseInt(buildDetailMatch[1], 10);
    const build = getBuild(db, id);
    if (!build) return errorResponse("Build not found", 404);
    return json(build);
  }

  // GET /api/builds/:id/bom — BOM with per-child allocation data
  const buildBomMatch = path.match(/^\/api\/builds\/(\d+)\/bom$/);
  if (buildBomMatch && req.method === "GET") {
    const id = parseInt(buildBomMatch[1], 10);
    const build = getBuild(db, id);
    if (!build) return errorResponse("Build not found", 404);
    const bom = build.children.map((child) => {
      const alloc = allocationForGroup(db, child.name, child.type);
      return {
        part_id: child.id,
        part_name: child.name,
        part_type: child.type,
        qty_in_build: child.quantity,
        role: null,
        on_hand: alloc.on_hand,
        allocated: alloc.allocated,
        free: alloc.free,
      };
    });
    return json(bom);
  }

  // GET /api/parts/:id/allocation — allocation summary for the part's name+type group
  const partAllocMatch = path.match(/^\/api\/parts\/(\d+)\/allocation$/);
  if (partAllocMatch && req.method === "GET") {
    const id = parseInt(partAllocMatch[1], 10);
    const part = getPart(db, id);
    if (!part) return errorResponse("Part not found", 404);
    const alloc = allocationForGroup(db, part.name, part.type);
    return json({
      part_id: id,
      part_name: part.name,
      on_hand: alloc.on_hand,
      allocated: alloc.allocated,
      free: alloc.free,
      builds: alloc.builds,
    });
  }

  // GET /api/gear — list gear-type parts
  if (path === "/api/gear" && req.method === "GET") {
    const filter: PartFilter = { type: "gear" };
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    if (status !== null) {
      if (!isPartStatus(status)) return json([]);
      filter.status = status;
    }
    if (q !== null) filter.q = q;
    return json(listParts(db, filter));
  }

  // GET /api/gear/:id — single gear part with history
  const gearDetailMatch = path.match(/^\/api\/gear\/(\d+)$/);
  if (gearDetailMatch && req.method === "GET") {
    const id = parseInt(gearDetailMatch[1], 10);
    const part = getPart(db, id);
    if (!part || part.type !== "gear") return errorResponse("Gear not found", 404);
    const history = getPartHistory(db, id);
    return json({ ...part, history });
  }

  // GET /api/stock — aggregate by type × status
  if (path === "/api/stock" && req.method === "GET") {
    type StockRow = [string | null, string, number, number];
    const rows = db.query<StockRow>(
      `SELECT type, status, SUM(quantity) AS total_quantity, COUNT(*) AS count
       FROM parts
       GROUP BY type, status
       ORDER BY type, status`,
    );
    return json(
      rows.map(([type, status, total_quantity, count]) => ({
        type,
        status,
        total_quantity,
        count,
      })),
    );
  }

  return errorResponse("Not found", 404);
}
