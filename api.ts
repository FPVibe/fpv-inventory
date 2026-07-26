import { DB, getPart, getPartHistory, listParts, type PartFilter, type PartStatus, type PartType } from "./db.ts";
import { VERSION } from "./version.ts";

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

export function handleApi(db: DB, req: Request, url: URL): Response | null {
  const path = url.pathname;
  if (path !== "/api" && !path.startsWith("/api/")) return null;

  if (path === "/api/health" && req.method === "GET") {
    return json({ status: "ok", version: VERSION, name: "fpv-inventory" });
  }

  if (path === "/api/parts" && req.method === "GET") {
    const filter: PartFilter = {};
    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const q = url.searchParams.get("q");
    const parentIdParam = url.searchParams.get("parent_id");

    if (type !== null) filter.type = type as PartType;
    if (status !== null) filter.status = status as PartStatus;
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

  return errorResponse("Not found", 404);
}
