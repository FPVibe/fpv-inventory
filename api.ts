import {
  DB,
  getBuild,
  getPart,
  getPartHistory,
  listParts,
  type PartFilter,
  type PartStatus,
  type PartType,
  queryStockRows,
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

interface RouteContext {
  db: DB;
  req: Request;
  url: URL;
  /** Capture groups from the route's matcher, in order. */
  params: string[];
}

interface Route {
  method: string;
  /** The path as it appears in openapi.json, e.g. "/api/parts/{id}". */
  specPath: string;
  /** Matcher for the concrete request path. */
  match: RegExp;
  handler: (ctx: RouteContext) => Response;
}

/**
 * The API's route table.
 *
 * Each entry carries both its matcher and the path it is documented under in
 * openapi.json, so the served API and the published spec cannot drift apart.
 * `tests/openapi.test.ts` asserts the two sets are equal.
 */
export const API_ROUTES: readonly Route[] = [
  {
    method: "GET",
    specPath: "/api/health",
    match: /^\/api\/health$/,
    handler: () => json({ status: "ok", version: VERSION, name: "fpv-inventory" }),
  },
  {
    method: "GET",
    specPath: "/api/openapi.json",
    match: /^\/api\/openapi\.json$/,
    handler: () => json(openapiSpec),
  },
  {
    method: "GET",
    specPath: "/api/parts",
    match: /^\/api\/parts$/,
    handler: ({ db, url }) => {
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
    },
  },
  {
    method: "GET",
    specPath: "/api/parts/{id}",
    match: /^\/api\/parts\/(\d+)$/,
    handler: ({ db, params }) => {
      const part = getPart(db, parseInt(params[0], 10));
      if (!part) return errorResponse("Part not found", 404);
      const history = getPartHistory(db, part.id);
      return json({ ...part, history });
    },
  },
  {
    method: "GET",
    specPath: "/api/parts/{id}/allocation",
    match: /^\/api\/parts\/(\d+)\/allocation$/,
    handler: ({ db, params }) => {
      const id = parseInt(params[0], 10);
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
    },
  },
  {
    method: "GET",
    specPath: "/api/builds",
    match: /^\/api\/builds$/,
    handler: ({ db, url }) => {
      const filter: PartFilter = { type: "craft", parent_id: null };
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");

      if (status !== null) {
        if (!isPartStatus(status)) return json([]);
        filter.status = status;
      }
      if (q !== null) filter.q = q;

      return json(listParts(db, filter));
    },
  },
  {
    method: "GET",
    specPath: "/api/builds/{id}",
    match: /^\/api\/builds\/(\d+)$/,
    handler: ({ db, params }) => {
      const build = getBuild(db, parseInt(params[0], 10));
      if (!build) return errorResponse("Build not found", 404);
      return json(build);
    },
  },
  {
    method: "GET",
    specPath: "/api/builds/{id}/bom",
    match: /^\/api\/builds\/(\d+)\/bom$/,
    handler: ({ db, params }) => {
      const build = getBuild(db, parseInt(params[0], 10));
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
    },
  },
  {
    method: "GET",
    specPath: "/api/gear",
    match: /^\/api\/gear$/,
    handler: ({ db, url }) => {
      const filter: PartFilter = { type: "gear" };
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      if (status !== null) {
        if (!isPartStatus(status)) return json([]);
        filter.status = status;
      }
      if (q !== null) filter.q = q;
      return json(listParts(db, filter));
    },
  },
  {
    method: "GET",
    specPath: "/api/gear/{id}",
    match: /^\/api\/gear\/(\d+)$/,
    handler: ({ db, params }) => {
      const part = getPart(db, parseInt(params[0], 10));
      if (!part || part.type !== "gear") return errorResponse("Gear not found", 404);
      const history = getPartHistory(db, part.id);
      return json({ ...part, history });
    },
  },
  {
    method: "GET",
    specPath: "/api/stock",
    match: /^\/api\/stock$/,
    handler: ({ db }) => json(queryStockRows(db)),
  },
];

export function handleApi(db: DB, req: Request, url: URL): Response | null {
  const path = url.pathname;
  if (path !== "/api" && !path.startsWith("/api/")) return null;

  for (const route of API_ROUTES) {
    if (route.method !== req.method) continue;
    const m = route.match.exec(path);
    if (!m) continue;
    return route.handler({ db, req, url, params: m.slice(1) });
  }

  return errorResponse("Not found", 404);
}
