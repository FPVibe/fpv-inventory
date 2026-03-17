import { assertEquals, assertExists, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { initDb, createPart, getPart, listParts, updatePart, movePart, getPartHistory } from "../db.ts";
import type { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

function makeTempDb(): DB {
  return initDb(":memory:");
}

Deno.test("initDb creates parts and part_history tables", () => {
  const db = makeTempDb();
  const tables = db.query<[string]>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).map(([name]) => name);
  assertEquals(tables.includes("parts"), true);
  assertEquals(tables.includes("part_history"), true);
  db.close();
});

Deno.test("createPart inserts a part and returns its id", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "0702 Motor", quantity: 6, status: "unused" });
  assertExists(id);
  const part = getPart(db, id);
  assertExists(part);
  assertEquals(part!.name, "0702 Motor");
  assertEquals(part!.quantity, 6);
  assertEquals(part!.status, "unused");
  assertEquals(part!.parent_id, null);
  db.close();
});

Deno.test("createPart records a 'created' history entry", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "Frame", quantity: 1, status: "in-use" });
  const history = getPartHistory(db, id);
  assertEquals(history.length, 1);
  assertEquals(history[0].action, "created");
  db.close();
});

Deno.test("createPart supports optional fields: notes, parent_id", () => {
  const db = makeTempDb();
  const parentId = createPart(db, { name: "Quad Alpha", quantity: 1, status: "in-use" });
  const childId = createPart(db, {
    name: "VTX",
    quantity: 1,
    status: "in-use",
    notes: "1.6W, pit mode set",
    parent_id: parentId,
  });
  const child = getPart(db, childId);
  assertExists(child);
  assertEquals(child!.notes, "1.6W, pit mode set");
  assertEquals(child!.parent_id, parentId);
  db.close();
});

Deno.test("listParts returns all parts when no filter", () => {
  const db = makeTempDb();
  createPart(db, { name: "Part A", quantity: 1, status: "unused" });
  createPart(db, { name: "Part B", quantity: 2, status: "unused" });
  const parts = listParts(db);
  assertEquals(parts.length, 2);
  db.close();
});

Deno.test("listParts filters by parent_id", () => {
  const db = makeTempDb();
  const quadId = createPart(db, { name: "Quad", quantity: 1, status: "in-use" });
  createPart(db, { name: "Motor", quantity: 4, status: "in-use", parent_id: quadId });
  createPart(db, { name: "Loose prop", quantity: 10, status: "unused" });
  const children = listParts(db, quadId);
  assertEquals(children.length, 1);
  assertEquals(children[0].name, "Motor");
  db.close();
});

Deno.test("listParts with null parent_id returns top-level parts", () => {
  const db = makeTempDb();
  const quadId = createPart(db, { name: "Quad", quantity: 1, status: "in-use" });
  createPart(db, { name: "Motor", quantity: 4, status: "in-use", parent_id: quadId });
  createPart(db, { name: "Loose prop", quantity: 10, status: "unused" });
  const topLevel = listParts(db, null);
  assertEquals(topLevel.length, 2);
  db.close();
});

Deno.test("updatePart changes fields and records history", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused" });
  updatePart(db, id, { status: "in-use", notes: "burned in" });
  const part = getPart(db, id);
  assertEquals(part!.status, "in-use");
  assertEquals(part!.notes, "burned in");
  const history = getPartHistory(db, id);
  assertEquals(history.length, 2);
  assertEquals(history[1].action, "updated");
  db.close();
});

Deno.test("movePart changes parent_id and records history", () => {
  const db = makeTempDb();
  const quad1Id = createPart(db, { name: "Quad 1", quantity: 1, status: "in-use" });
  const quad2Id = createPart(db, { name: "Quad 2", quantity: 1, status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "in-use", parent_id: quad1Id });
  movePart(db, motorId, quad2Id, "Salvaged from Quad 1");
  const motor = getPart(db, motorId);
  assertEquals(motor!.parent_id, quad2Id);
  const history = getPartHistory(db, motorId);
  const moveEvent = history.find((h) => h.action === "moved");
  assertExists(moveEvent);
  assertEquals(moveEvent!.from_parent_id, quad1Id);
  assertEquals(moveEvent!.to_parent_id, quad2Id);
  assertEquals(moveEvent!.notes, "Salvaged from Quad 1");
  db.close();
});

Deno.test("movePart to null removes from assembly (to spare parts)", () => {
  const db = makeTempDb();
  const quadId = createPart(db, { name: "Quad", quantity: 1, status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "in-use", parent_id: quadId });
  movePart(db, motorId, null, "Removed from quad");
  const motor = getPart(db, motorId);
  assertEquals(motor!.parent_id, null);
  db.close();
});

Deno.test("getPartHistory returns events in chronological order", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "Camera", quantity: 1, status: "unused" });
  updatePart(db, id, { status: "in-use" });
  updatePart(db, id, { notes: "needs reflow" });
  const history = getPartHistory(db, id);
  assertEquals(history.length, 3);
  assertEquals(history[0].action, "created");
  assertEquals(history[1].action, "updated");
  assertEquals(history[2].action, "updated");
  db.close();
});

Deno.test("createPart supports type field", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "2306 Motor", quantity: 4, status: "unused", type: "motor" });
  const part = getPart(db, id);
  assertExists(part);
  assertEquals(part!.type, "motor");
  db.close();
});

Deno.test("createPart defaults type to null", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "Mystery Part", quantity: 1, status: "unused" });
  const part = getPart(db, id);
  assertExists(part);
  assertEquals(part!.type, null);
  db.close();
});

Deno.test("updatePart can set type", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "Speedybee F405", quantity: 1, status: "unused" });
  updatePart(db, id, { type: "fc" });
  const part = getPart(db, id);
  assertEquals(part!.type, "fc");
  db.close();
});

// ─── Specs field ──────────────────────────────────────────────────────────────

Deno.test("createPart supports specs field", () => {
  const db = makeTempDb();
  const id = createPart(db, {
    name: "2306 Motor",
    quantity: 4,
    status: "unused",
    specs: "Motor Size: 2306\nKV: 2400KV\nWeight: 31.5g\nMax Power: 1100W",
  });
  const part = getPart(db, id);
  assertExists(part);
  assertEquals(part!.specs, "Motor Size: 2306\nKV: 2400KV\nWeight: 31.5g\nMax Power: 1100W");
  db.close();
});

Deno.test("createPart defaults specs to null", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "Mystery Part", quantity: 1, status: "unused" });
  const part = getPart(db, id);
  assertExists(part);
  assertEquals(part!.specs, null);
  db.close();
});

Deno.test("updatePart can set specs", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused" });
  updatePart(db, id, { specs: "Cont. Current: 45A\nBurst: 55A" });
  const part = getPart(db, id);
  assertEquals(part!.specs, "Cont. Current: 45A\nBurst: 55A");
  db.close();
});

Deno.test("updatePart can clear specs", () => {
  const db = makeTempDb();
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused", specs: "old specs" });
  updatePart(db, id, { specs: "" });
  const part = getPart(db, id);
  assertEquals(part!.specs, null);
  db.close();
});

Deno.test("listParts can filter by type", () => {
  const db = makeTempDb();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Motor B", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Frame X", quantity: 1, status: "unused", type: "frame" });
  createPart(db, { name: "Unknown Part", quantity: 1, status: "unused" });
  const motors = listParts(db, undefined, "motor");
  assertEquals(motors.length, 2);
  assertEquals(motors.every((p) => p.type === "motor"), true);
  db.close();
});
