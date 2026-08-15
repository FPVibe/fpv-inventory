import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createPart, initDb } from "../db.ts";
import { allocationForGroup } from "../allocation.ts";

function makeDb() {
  return initDb(":memory:");
}

// ─── allocationForGroup ───────────────────────────────────────────────────────

Deno.test("allocationForGroup: 8 stock + 4 installed → on_hand 12 / allocated 4 / free 8", () => {
  const db = makeDb();
  const craftId = createPart(db, { name: "LionBee", quantity: 1, status: "in-use", type: "craft" });
  // 8 in stock (top-level)
  createPart(db, { name: "0702 Motor", quantity: 8, status: "unused", type: "motor" });
  // 4 installed in the craft
  createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });

  const result = allocationForGroup(db, "0702 Motor", "motor");
  assertEquals(result.on_hand, 12);
  assertEquals(result.allocated, 4);
  assertEquals(result.free, 8);
  assertEquals(result.builds.length, 1);
  assertEquals(result.builds[0].build_id, craftId);
  assertEquals(result.builds[0].build_name, "LionBee");
  assertEquals(result.builds[0].qty, 4);
  db.close();
});

Deno.test("allocationForGroup: part in two builds lists both", () => {
  const db = makeDb();
  const craft1 = createPart(db, { name: "Quad A", quantity: 1, status: "in-use", type: "craft" });
  const craft2 = createPart(db, { name: "Quad B", quantity: 1, status: "in-use", type: "craft" });
  // 10 in stock
  createPart(db, { name: "0802 Motor", quantity: 10, status: "unused", type: "motor" });
  // 4 in Quad A, 4 in Quad B
  createPart(db, {
    name: "0802 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craft1,
  });
  createPart(db, {
    name: "0802 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craft2,
  });

  const result = allocationForGroup(db, "0802 Motor", "motor");
  assertEquals(result.on_hand, 18);
  assertEquals(result.allocated, 8);
  assertEquals(result.free, 10);
  assertEquals(result.builds.length, 2);
  db.close();
});

Deno.test("allocationForGroup: zero stock rows → on_hand 0, free 0", () => {
  const db = makeDb();
  const craftId = createPart(db, { name: "Quad", quantity: 1, status: "in-use", type: "craft" });
  // no top-level stock; 4 installed
  createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });

  const result = allocationForGroup(db, "0702 Motor", "motor");
  assertEquals(result.on_hand, 4);
  assertEquals(result.allocated, 4);
  assertEquals(result.free, 0);
  db.close();
});

Deno.test("allocationForGroup: no rows at all → on_hand 0 / allocated 0 / free 0", () => {
  const db = makeDb();
  const result = allocationForGroup(db, "Nonexistent Part", "motor");
  assertEquals(result.on_hand, 0);
  assertEquals(result.allocated, 0);
  assertEquals(result.free, 0);
  assertEquals(result.builds, []);
  db.close();
});

Deno.test("allocationForGroup: parts installed in non-craft parent are not counted as allocated", () => {
  const db = makeDb();
  // parent is a frame (not a craft) — child motors are not "allocated" to a build
  const frameId = createPart(db, {
    name: "Frame Kit",
    quantity: 1,
    status: "unused",
    type: "frame",
  });
  createPart(db, { name: "Screw", quantity: 12, status: "unused", type: "other" });
  createPart(db, {
    name: "Screw",
    quantity: 4,
    status: "unused",
    type: "other",
    parent_id: frameId,
  });

  const result = allocationForGroup(db, "Screw", "other");
  // allocated only counts children whose parent is a craft
  assertEquals(result.allocated, 0);
  assertEquals(result.on_hand, 16);
  assertEquals(result.free, 16);
  db.close();
});

Deno.test("allocationForGroup: exact name matching — different name not included", () => {
  const db = makeDb();
  createPart(db, { name: "0702 Motor", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "0802 Motor", quantity: 4, status: "unused", type: "motor" });

  const result = allocationForGroup(db, "0702 Motor", "motor");
  assertEquals(result.on_hand, 4);
  db.close();
});
