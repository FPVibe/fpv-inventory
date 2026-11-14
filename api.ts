import {
  type BuildFilter,
  DB,
  deletePart,
  getBuild,
  getBuildHistory,
  getPart,
  getPartHistory,
  listBuildComponents,
  listBuilds,
  listParts,
  type PartFilter,
  type PartStatus,
  type PartType,
  queryStockRows,
} from "./db.ts";
import { allocationForPart } from "./allocation.ts";
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
      const location = url.searchParams.get("location");

      if (type !== null) {
        if (!isPartType(type)) return json([]);
        filter.type = type;
      }
      if (status !== null) {
        if (!isPartStatus(status)) return json([]);
        filter.status = status;
      }
      if (q !== null) filter.q = q;
      if (location) filter.location = location;

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
    method: "DELETE",
    specPath: "/api/parts/{id}",
    match: /^\/api\/parts\/(\d+)$/,
    handler: ({ db, params }) => {
      const id = parseInt(params[0], 10);
      if (!getPart(db, id)) return errorResponse("Part not found", 404);
      try {
        deletePart(db, id);
      } catch (err) {
        return errorResponse((err as Error).message, 409);
      }
      return json({ deleted: id });
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
      const alloc = allocationForPart(db, id);
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
      const filter: BuildFilter = {};
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");

      if (status !== null) {
        if (!isPartStatus(status)) return json([]);
        filter.status = status;
      }
      if (q !== null) filter.q = q;

      return json(listBuilds(db, filter));
    },
  },
  {
    method: "GET",
    specPath: "/api/builds/{id}",
    match: /^\/api\/builds\/(\d+)$/,
    handler: ({ db, params }) => {
      const id = parseInt(params[0], 10);
      const build = getBuild(db, id);
      if (!build) return errorResponse("Build not found", 404);
      return json({ ...build, components: listBuildComponents(db, id) });
    },
  },
  {
    method: "GET",
    specPath: "/api/builds/{id}/bom",
    match: /^\/api\/builds\/(\d+)\/bom$/,
    handler: ({ db, params }) => {
      const id = parseInt(params[0], 10);
      const build = getBuild(db, id);
      if (!build) return errorResponse("Build not found", 404);
      const bom = listBuildComponents(db, id).map((component) => {
        const alloc = allocationForPart(db, component.part_id);
        return {
          part_id: component.part_id,
          part_name: component.name,
          part_type: component.type,
          qty_in_build: component.quantity,
          role: component.role,
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
