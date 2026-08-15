/**
 * Tests for new API endpoints:
 *   INV-5: GET /api/builds/:id/bom, GET /api/parts/:id/allocation
 *   INV-6: GET /api/gear, GET /api/gear/:id
 *   INV-7: GET /api/stock
 */
import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createPart, initDb } from "../db.ts";
import { makeHandler } from "../main.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// ─── GET /api/builds/:id/bom (INV-5) ──────────────────────────────────────────

Deno.test("GET /api/builds/:id/bom returns [] for a build with no children", async () => {
  const { db, handler } = makeApp();
  const craftId = createPart(db, {
    name: "Empty Quad",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  const res = await handler(new Request(`http://localhost/api/builds/${craftId}/bom`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/builds/:id/bom returns BOM rows with allocation fields", async () => {
  const { db, handler } = makeApp();
  const craftId = createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  // 8 in stock
  createPart(db, { name: "0702 Motor", quantity: 8, status: "unused", type: "motor" });
  // 4 installed
  const childId = createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });

  const res = await handler(new Request(`http://localhost/api/builds/${craftId}/bom`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.length, 1);
  const row = body[0];
  assertEquals(row.part_id, childId);
  assertEquals(row.part_name, "0702 Motor");
  assertEquals(row.part_type, "motor");
  assertEquals(row.qty_in_build, 4);
  assertEquals(row.role, null);
  assertEquals(row.on_hand, 12);
  assertEquals(row.allocated, 4);
  assertEquals(row.free, 8);
});

Deno.test("GET /api/builds/:id/bom returns 404 for a non-build id", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, {
    name: "Motor",
    quantity: 4,
    status: "unused",
    type: "motor",
  });
  const res = await handler(new Request(`http://localhost/api/builds/${motorId}/bom`));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "Build not found");
});

Deno.test("GET /api/builds/:id/bom returns 404 for unknown id", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/builds/999999/bom"));
  assertEquals(res.status, 404);
});

// ─── GET /api/parts/:id/allocation (INV-5) ────────────────────────────────────

Deno.test("GET /api/parts/:id/allocation returns allocation for a part", async () => {
  const { db, handler } = makeApp();
  const craftId = createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  const stockId = createPart(db, {
    name: "0702 Motor",
    quantity: 8,
    status: "unused",
    type: "motor",
  });
  createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });

  const res = await handler(new Request(`http://localhost/api/parts/${stockId}/allocation`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.part_id, stockId);
  assertEquals(body.part_name, "0702 Motor");
  assertEquals(body.on_hand, 12);
  assertEquals(body.allocated, 4);
  assertEquals(body.free, 8);
  assertEquals(Array.isArray(body.builds), true);
  assertEquals(body.builds.length, 1);
  assertEquals(body.builds[0].build_id, craftId);
  assertEquals(body.builds[0].build_name, "LionBee");
  assertEquals(body.builds[0].qty, 4);
});

Deno.test("GET /api/parts/:id/allocation returns 404 for unknown part", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/parts/999999/allocation"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "Part not found");
});

// ─── GET /api/gear (INV-6) ───────────────────────────────────────────────────

Deno.test("GET /api/gear returns [] for empty DB", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/gear"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/gear returns only gear-type parts", async () => {
  const { db, handler } = makeApp();
  createPart(db, {
    name: "DJI Goggles 3",
    quantity: 1,
    status: "in-use",
    type: "gear",
    serial_number: "DJI-001",
  });
  createPart(db, { name: "0702 Motor", quantity: 4, status: "unused", type: "motor" });
  const res = await handler(new Request("http://localhost/api/gear"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "DJI Goggles 3");
  assertEquals(body[0].type, "gear");
  assertEquals(body[0].serial_number, "DJI-001");
});

Deno.test("GET /api/gear filters by status", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Radio", quantity: 1, status: "in-use", type: "gear" });
  createPart(db, { name: "Old Goggles", quantity: 1, status: "retired", type: "gear" });
  const res = await handler(new Request("http://localhost/api/gear?status=retired"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "Old Goggles");
});

Deno.test("GET /api/gear filters by q (name substring)", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "DJI Goggles 3", quantity: 1, status: "in-use", type: "gear" });
  createPart(db, { name: "RadioMaster TX16S", quantity: 1, status: "in-use", type: "gear" });
  const res = await handler(new Request("http://localhost/api/gear?q=goggles"));
  const body = await res.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "DJI Goggles 3");
});

Deno.test("GET /api/gear?status=invalid returns []", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Goggles", quantity: 1, status: "in-use", type: "gear" });
  const res = await handler(new Request("http://localhost/api/gear?status=not-real"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), []);
});

// ─── GET /api/gear/:id (INV-6) ────────────────────────────────────────────────

Deno.test("GET /api/gear/:id returns gear part with history", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: "DJI Goggles 3",
    quantity: 1,
    status: "in-use",
    type: "gear",
    serial_number: "DJI-001",
    purchase_date: "2026-01-15",
    purchase_price: 629.99,
  });
  const res = await handler(new Request(`http://localhost/api/gear/${id}`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.id, id);
  assertEquals(body.name, "DJI Goggles 3");
  assertEquals(body.type, "gear");
  assertEquals(body.serial_number, "DJI-001");
  assertEquals(body.purchase_price, 629.99);
  assertExists(body.history);
  assertEquals(Array.isArray(body.history), true);
});

Deno.test("GET /api/gear/:id returns 404 for a non-gear part", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, {
    name: "Motor",
    quantity: 4,
    status: "unused",
    type: "motor",
  });
  const res = await handler(new Request(`http://localhost/api/gear/${motorId}`));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "Gear not found");
});

Deno.test("GET /api/gear/:id returns 404 for unknown id", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/gear/999999"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "Gear not found");
});

// ─── GET /api/stock (INV-7) ───────────────────────────────────────────────────

Deno.test("GET /api/stock returns [] for empty DB", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/api/stock"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/json; charset=utf-8");
  assertEquals(await res.json(), []);
});

Deno.test("GET /api/stock returns aggregated type×status rows", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Motor B", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Motor C", quantity: 2, status: "in-use", type: "motor" });
  createPart(db, { name: "Frame X", quantity: 1, status: "unused", type: "frame" });

  const res = await handler(new Request("http://localhost/api/stock"));
  const body: Array<{ type: string; status: string; total_quantity: number; count: number }> =
    await res.json();

  // motors unused: 4+4=8, count 2
  const motorUnused = body.find((r) => r.type === "motor" && r.status === "unused");
  assertExists(motorUnused);
  assertEquals(motorUnused!.total_quantity, 8);
  assertEquals(motorUnused!.count, 2);

  // motors in-use: 2, count 1
  const motorInUse = body.find((r) => r.type === "motor" && r.status === "in-use");
  assertExists(motorInUse);
  assertEquals(motorInUse!.total_quantity, 2);
  assertEquals(motorInUse!.count, 1);

  // frame unused: 1, count 1
  const frameUnused = body.find((r) => r.type === "frame" && r.status === "unused");
  assertExists(frameUnused);
  assertEquals(frameUnused!.total_quantity, 1);
  assertEquals(frameUnused!.count, 1);
});

Deno.test("GET /api/stock includes craft and gear rows", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "My Quad", quantity: 1, status: "in-use", type: "craft" });
  createPart(db, { name: "Goggles", quantity: 1, status: "unused", type: "gear" });

  const res = await handler(new Request("http://localhost/api/stock"));
  const body: Array<{ type: string; status: string }> = await res.json();

  const craftRow = body.find((r) => r.type === "craft");
  assertExists(craftRow);
  const gearRow = body.find((r) => r.type === "gear");
  assertExists(gearRow);
});

Deno.test("GET /api/stock rows with null type return type: null", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Unknown Part", quantity: 3, status: "unused" }); // type is null

  const res = await handler(new Request("http://localhost/api/stock"));
  const body: Array<{ type: string | null; status: string; total_quantity: number }> =
    await res.json();
  const nullTypeRow = body.find((r) => r.type === null);
  assertExists(nullTypeRow);
  assertEquals(nullTypeRow!.total_quantity, 3);
});

Deno.test("GET /api/stock rows are ordered by type, status", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Frame", quantity: 1, status: "unused", type: "frame" });
  createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Camera", quantity: 1, status: "in-use", type: "camera" });

  const res = await handler(new Request("http://localhost/api/stock"));
  const body: Array<{ type: string }> = await res.json();
  const types = body.map((r) => r.type);
  // camera < frame < motor alphabetically
  assertEquals(types[0], "camera");
  assertEquals(types[1], "frame");
  assertEquals(types[2], "motor");
});
