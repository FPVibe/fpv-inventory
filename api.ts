import { DB } from "./db.ts";
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

export function handleApi(_db: DB, req: Request, url: URL): Response | null {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;

  if (path === "/api/health" && req.method === "GET") {
    return json({ status: "ok", version: VERSION, name: "fpv-inventory" });
  }

  return errorResponse("Not found", 404);
}
