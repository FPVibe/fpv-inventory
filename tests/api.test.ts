import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { initDb } from "../db.ts";
import { makeHandler } from "../main.ts";
import { VERSION } from "../version.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

Deno.test("GET /api/health returns status, version, name", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/health"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  const body = await res.json();
  assertEquals(body.status, "ok");
  assertEquals(body.name, "fpv-inventory");
  assertEquals(body.version, VERSION);
});

Deno.test("GET /api/nope returns 404 JSON error, not HTML", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/nope"));
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  const body = await res.json();
  assertEquals(typeof body.error, "string");
});

Deno.test("GET /api (no trailing slash) returns 404 JSON error, not HTML", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api"));
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  const body = await res.json();
  assertEquals(typeof body.error, "string");
});

Deno.test("GET / still serves HTML (unaffected by API layer)", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
});
