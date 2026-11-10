import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  addBuildComponent,
  createBuild,
  createPart,
  initDb,
  type PartStatus,
  type PartType,
} from "../db.ts";
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

// ─── GET /api/parts ───────────────────────────────────────────────────────────

Deno.test("GET /api/parts returns [] for an empty DB", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/parts"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/parts returns all parts", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Frame X", quantity: 1, status: "unused", type: "frame" });
  const res = await handler(new Request("http://localhost/api/parts"));
  const body = await res.json();
  assertEquals(body.length, 2);
});

Deno.test("GET /api/parts filters by type", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Frame X", quantity: 1, status: "unused", type: "frame" });
  const res = await handler(new Request("http://localhost/api/parts?type=motor"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "Motor A");
});

Deno.test("GET /api/parts with an invalid type returns [] not an error", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused", type: "motor" });
  const res = await handler(new Request("http://localhost/api/parts?type=not-a-real-type"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/parts?type=<invalid> returns [] even if the DB contains that literal value", async () => {
  const { db, handler } = makeApp();
  // Legacy/corrupt data: main.ts's form handlers cast arbitrary strings to PartType
  // without validation, so a row like this can exist in the wild.
  createPart(db, {
    name: "Weird Part",
    quantity: 1,
    status: "unused",
    type: "not-a-real-type" as PartType,
  });
  const res = await handler(new Request("http://localhost/api/parts?type=not-a-real-type"));
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/parts?status=<invalid> returns [] even if the DB contains that literal value", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Weird Part", quantity: 1, status: "not-a-real-status" as PartStatus });
  const res = await handler(new Request("http://localhost/api/parts?status=not-a-real-status"));
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/parts filters by status", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused" });
  createPart(db, { name: "Motor B", quantity: 4, status: "broken" });
  const res = await handler(new Request("http://localhost/api/parts?status=broken"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "Motor B");
});

Deno.test("GET /api/parts has no parent_id field (builds are not containment)", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor", quantity: 4, status: "unused" });
  const res = await handler(new Request("http://localhost/api/parts"));
  const body = await res.json();
  assertEquals("parent_id" in body[0], false);
});

Deno.test("GET /api/parts?q= matches case-insensitive substring of name", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "0702 Motor", quantity: 4, status: "unused" });
  createPart(db, { name: "Frame X", quantity: 1, status: "unused" });
  const res = await handler(new Request("http://localhost/api/parts?q=MOTOR"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "0702 Motor");
});

Deno.test("GET /api/parts combines type and q filters", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "0702 Motor", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Frame Motor Mount", quantity: 1, status: "unused", type: "frame" });
  const res = await handler(new Request("http://localhost/api/parts?type=motor&q=0702"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "0702 Motor");
});

// ─── GET /api/parts/:id ───────────────────────────────────────────────────────

Deno.test("GET /api/parts/:id returns part with history", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "0702 Motor", quantity: 4, status: "unused", type: "motor" });
  const res = await handler(new Request(`http://localhost/api/parts/${id}`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.id, id);
  assertEquals(body.name, "0702 Motor");
  assertEquals(Array.isArray(body.history), true);
  assertEquals(body.history.length, 1);
  assertEquals(body.history[0].action, "created");
});

Deno.test("GET /api/parts/:id returns 404 JSON error when missing", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/parts/999999"));
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  const body = await res.json();
  assertEquals(body.error, "Part not found");
});

// ─── GET /api/builds ────────────────────────────────────────────────────────

Deno.test("GET /api/builds returns [] for an empty DB", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/builds"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/builds returns builds, not parts", async () => {
  const { db, handler } = makeApp();
  createBuild(db, { name: "LionBee", status: "in-use" });
  createPart(db, { name: "Loose Frame", quantity: 1, status: "unused", type: "frame" });
  const res = await handler(new Request("http://localhost/api/builds"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "LionBee");
  // A build is not a part — no part fields leak through
  assertEquals("type" in body[0], false);
  assertEquals("quantity" in body[0], false);
});

Deno.test("GET /api/builds returns the build's own fields", async () => {
  const { db, handler } = makeApp();
  createBuild(db, {
    name: "LionBee",
    status: "in-use",
    class: "5-inch freestyle",
    notes: "mushy on exit",
    specs: "FC: BetaFPV F4 1S",
  });
  const res = await handler(new Request("http://localhost/api/builds"));
  const body = await res.json();
  assertEquals(body[0].class, "5-inch freestyle");
  assertEquals(body[0].notes, "mushy on exit");
  assertEquals(body[0].specs, "FC: BetaFPV F4 1S");
  assertExists(body[0].created_at);
  assertExists(body[0].updated_at);
});

Deno.test("GET /api/builds filters by status", async () => {
  const { db, handler } = makeApp();
  createBuild(db, { name: "LionBee", status: "in-use" });
  createBuild(db, { name: "Old Toothpick", status: "retired" });
  const res = await handler(new Request("http://localhost/api/builds?status=retired"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "Old Toothpick");
});

Deno.test("GET /api/builds?status=<invalid> returns [] not an error", async () => {
  const { db, handler } = makeApp();
  createBuild(db, { name: "LionBee", status: "in-use" });
  const res = await handler(new Request("http://localhost/api/builds?status=not-a-real-status"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/builds?q= matches case-insensitive substring of name", async () => {
  const { db, handler } = makeApp();
  createBuild(db, { name: "LionBee", status: "in-use" });
  createBuild(db, { name: "Toothpick", status: "in-use" });
  const res = await handler(new Request("http://localhost/api/builds?q=lion"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "LionBee");
});

// ─── GET /api/builds/:id ──────────────────────────────────────────────────────

Deno.test("GET /api/builds/:id returns the build with its components", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
    notes: "stock motors",
  });
  addBuildComponent(db, buildId, motorId, 4, "motors");
  const res = await handler(new Request(`http://localhost/api/builds/${buildId}`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.id, buildId);
  assertEquals(body.name, "LionBee");
  assertExists(body.created_at);
  assertExists(body.updated_at);
  assertEquals(body.components.length, 1);
  assertExists(body.components[0].id);
  delete body.components[0].id;
  assertEquals(body.components[0], {
    part_id: motorId,
    name: "0702 Motor",
    type: "motor",
    quantity: 4,
    role: "motors",
    notes: null,
  });
});

Deno.test("GET /api/builds/:id returns components: [] for a build with none", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "Empty Frame", status: "unused" });
  const res = await handler(new Request(`http://localhost/api/builds/${buildId}`));
  const body = await res.json();
  assertEquals(body.components, []);
});

Deno.test("GET /api/builds/:id returns 404 for a part id that is not a build", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, {
    name: "Loose Motor",
    quantity: 1,
    status: "unused",
    type: "motor",
  });
  const res = await handler(new Request(`http://localhost/api/builds/${motorId}`));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "Build not found");
});

Deno.test("GET /api/builds/:id returns 404 JSON error when missing", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/builds/999999"));
  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  const body = await res.json();
  assertEquals(body.error, "Build not found");
});

// ─── GET /api/openapi.json ────────────────────────────────────────────────────

Deno.test("GET /api/openapi.json returns OpenAPI 3.1 spec", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/openapi.json"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  const body = await res.json();
  assertEquals(body.openapi, "3.1.0");
  assertEquals(body.info.title, "fpv-inventory");
  assertExists(body.paths["/api/health"]);
  assertExists(body.paths["/api/parts"]);
  assertExists(body.paths["/api/parts/{id}"]);
  assertExists(body.paths["/api/builds"]);
  assertExists(body.paths["/api/builds/{id}"]);
});
