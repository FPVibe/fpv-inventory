import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { addBuildComponent, createBuild, createPart, initDb } from "../db.ts";
import { allocationForPart } from "../allocation.ts";

function makeDb() {
  return initDb(":memory:");
}

// ─── allocationForPart ────────────────────────────────────────────────────────

Deno.test("allocationForPart: 12 owned, 4 installed → on_hand 12 / allocated 4 / free 8", () => {
  const db = makeDb();
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });
  // 12 owned total
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
  });
  // 4 installed in the build
  addBuildComponent(db, buildId, motorId, 4);

  const result = allocationForPart(db, motorId);
  assertEquals(result.on_hand, 12);
  assertEquals(result.allocated, 4);
  assertEquals(result.free, 8);
  assertEquals(result.builds.length, 1);
  assertEquals(result.builds[0].build_id, buildId);
  assertEquals(result.builds[0].build_name, "LionBee");
  assertEquals(result.builds[0].qty, 4);
  db.close();
});

Deno.test("allocationForPart: part in two builds lists both", () => {
  const db = makeDb();
  const build1 = createBuild(db, { name: "Quad A", status: "in-use" });
  const build2 = createBuild(db, { name: "Quad B", status: "in-use" });
  // 10 owned, 4 in Quad A, 4 in Quad B
  const motorId = createPart(db, {
    name: "0802 Motor",
    quantity: 10,
    status: "unused",
    type: "motor",
  });
  addBuildComponent(db, build1, motorId, 4);
  addBuildComponent(db, build2, motorId, 4);

  const result = allocationForPart(db, motorId);
  assertEquals(result.on_hand, 10);
  assertEquals(result.allocated, 8);
  assertEquals(result.free, 10 - 8);
  assertEquals(result.builds.length, 2);
  db.close();
});

Deno.test("allocationForPart: fully allocated → free 0", () => {
  const db = makeDb();
  const buildId = createBuild(db, { name: "Quad", status: "in-use" });
  // all 4 owned are installed
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "unused",
    type: "motor",
  });
  addBuildComponent(db, buildId, motorId, 4);

  const result = allocationForPart(db, motorId);
  assertEquals(result.on_hand, 4);
  assertEquals(result.allocated, 4);
  assertEquals(result.free, 0);
  db.close();
});

Deno.test("allocationForPart: no rows at all → on_hand 0 / allocated 0 / free 0", () => {
  const db = makeDb();
  const result = allocationForPart(db, 9999);
  assertEquals(result.on_hand, 0);
  assertEquals(result.allocated, 0);
  assertEquals(result.free, 0);
  assertEquals(result.builds, []);
  db.close();
});

Deno.test("allocationForPart: a part installed in another build does not affect this part's allocation", () => {
  const db = makeDb();
  const buildId = createBuild(db, { name: "Frame Kit Build", status: "in-use" });
  // The build uses screws…
  const screwId = createPart(db, { name: "Screw", quantity: 16, status: "unused", type: "other" });
  addBuildComponent(db, buildId, screwId, 4);
  // …but this part is not in any build.
  const looseId = createPart(db, {
    name: "Loose Motor",
    quantity: 6,
    status: "unused",
    type: "motor",
  });

  const result = allocationForPart(db, looseId);
  // only actual build_parts allocations count — nothing else is "allocated"
  assertEquals(result.allocated, 0);
  assertEquals(result.on_hand, 6);
  assertEquals(result.free, 6);
  db.close();
});

Deno.test("allocationForPart: join is on part id — a different part with a different name is not included", () => {
  const db = makeDb();
  const aId = createPart(db, { name: "0702 Motor", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "0802 Motor", quantity: 4, status: "unused", type: "motor" });

  const result = allocationForPart(db, aId);
  assertEquals(result.on_hand, 4);
  db.close();
});
