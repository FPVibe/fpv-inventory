/**
 * Tests for INV-13: From-the-bin guided build flow (v2 builds model)
 *
 * Covers:
 *  - assembleBuild() db function
 *  - GET /builds/new UI
 *  - POST /builds/from-bin handler
 *
 * v2 semantics: a part's quantity is the total owned and is conserved —
 * assembling a build records the allocation in the build_parts join instead
 * of decrementing stock rows and creating child part rows.
 */
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  addBuildComponent,
  assembleBuild,
  createBuild,
  createPart,
  freeQuantity,
  getBuild,
  getBuildHistory,
  getPart,
  getPartHistory,
  initDb,
  listBuildComponents,
  listBuilds,
} from "../db.ts";
import { allocationForPart } from "../allocation.ts";
import { makeHandler } from "../main.ts";

function makeDb() {
  return initDb(":memory:");
}

function makeApp() {
  const db = makeDb();
  return { db, handler: makeHandler(db) };
}

// ─── assembleBuild — happy path ───────────────────────────────────────────────

Deno.test("assembleBuild creates a build with the selected components", () => {
  const db = makeDb();
  // 12 motors, 2 FCs
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
    specs: "KV: 27000",
  });
  const fcId = createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });

  const buildId = assembleBuild(db, {
    name: "LionBee Build",
    notes: "First build",
    selections: [
      { part_id: motorId, qty: 4 },
      { part_id: fcId, qty: 1 },
    ],
  });

  // Build was created — it is a build, not a part
  const build = getBuild(db, buildId);
  assertExists(build);
  assertEquals(build!.name, "LionBee Build");
  assertEquals(build!.status, "in-use");
  assertEquals(build!.notes, "First build");

  // Build has 2 components (motor + FC)
  const components = listBuildComponents(db, buildId);
  assertEquals(components.length, 2);

  const motorComponent = components.find((c) => c.type === "motor");
  assertExists(motorComponent);
  assertEquals(motorComponent!.name, "0702 Motor");
  assertEquals(motorComponent!.quantity, 4);

  const fcComponent = components.find((c) => c.type === "fc");
  assertExists(fcComponent);
  assertEquals(fcComponent!.name, "FC-F4");
  assertEquals(fcComponent!.quantity, 1);
  db.close();
});

Deno.test("assembleBuild does not decrement stock — quantity is conserved, allocation is recorded", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
  });
  const fcId = createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });

  const buildId = assembleBuild(db, {
    name: "LionBee",
    selections: [
      { part_id: motorId, qty: 4 },
      { part_id: fcId, qty: 1 },
    ],
  });

  // The part's quantity is the total owned — unchanged by assembly
  const motor = getPart(db, motorId);
  assertEquals(motor!.quantity, 12);
  const fc = getPart(db, fcId);
  assertEquals(fc!.quantity, 2);

  // The allocation lives in the BOM join
  const motorComponents = listBuildComponents(db, buildId).filter((c) => c.part_id === motorId);
  assertEquals(motorComponents.length, 1);
  assertEquals(motorComponents[0].quantity, 4);
  assertEquals(freeQuantity(db, motorId), 8); // 12 owned - 4 installed
  db.close();
});

Deno.test("assembleBuild: a fully allocated part keeps its row with free quantity 0", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "unused",
    type: "motor",
  });

  assembleBuild(db, {
    name: "Whoop",
    selections: [{ part_id: motorId, qty: 4 }],
  });

  const motor = getPart(db, motorId);
  assertExists(motor); // row still exists
  assertEquals(motor!.quantity, 4); // still owns 4 — all 4 are in the build
  assertEquals(freeQuantity(db, motorId), 0);
  db.close();
});

Deno.test("assembleBuild conservation: allocationForPart shows on_hand 12 / allocated 4 / free 8", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
  });
  const fcId = createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });

  const buildId = assembleBuild(db, {
    name: "LionBee",
    selections: [
      { part_id: motorId, qty: 4 },
      { part_id: fcId, qty: 1 },
    ],
  });
  void buildId;

  const alloc = allocationForPart(db, motorId);
  // on_hand = 12 (total owned, conserved) ✓
  assertEquals(alloc.on_hand, 12);
  assertEquals(alloc.allocated, 4);
  assertEquals(alloc.free, 8);
  db.close();
});

Deno.test("assembleBuild records a 'created' build history entry", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 8,
    status: "unused",
    type: "motor",
  });

  const buildId = assembleBuild(db, {
    name: "Quad",
    selections: [{ part_id: motorId, qty: 4 }],
  });

  // Build history: 'created' with the default status
  const buildHistory = getBuildHistory(db, buildId);
  assertEquals(buildHistory.length, 1);
  assertEquals(buildHistory[0].action, "created");
  assertEquals(buildHistory[0].new_status, "in-use");

  // Quantity is conserved, so the part has no quantity-change history — but
  // the allocation itself is recorded as an 'installed' entry pointing at the
  // build, after the initial 'created'.
  const motorHistory = getPartHistory(db, motorId);
  assertEquals(motorHistory.length, 2);
  assertEquals(motorHistory[0].action, "created");
  assertEquals(motorHistory[1].action, "installed");
  assertEquals(motorHistory[1].to_build_id, buildId);
  db.close();
});

// ─── assembleBuild — validation failures ─────────────────────────────────────

Deno.test("assembleBuild rejects when qty exceeds free stock", () => {
  const db = makeDb();
  const motorId = createPart(db, { name: "Motor", quantity: 12, status: "unused", type: "motor" });

  assertThrows(
    () => assembleBuild(db, { name: "Quad", selections: [{ part_id: motorId, qty: 13 }] }),
    Error,
    "Not enough free stock",
  );

  // Nothing was changed — stock is still 12
  const motor = getPart(db, motorId);
  assertEquals(motor!.quantity, 12);
  // No build was created
  assertEquals(listBuilds(db).length, 0);
  db.close();
});

Deno.test("assembleBuild rejects qty < 1", () => {
  const db = makeDb();
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });
  assertThrows(
    () => assembleBuild(db, { name: "Quad", selections: [{ part_id: motorId, qty: 0 }] }),
    Error,
  );
  db.close();
});

Deno.test("assembleBuild rejects a build id used as a selection part_id (builds are not parts)", () => {
  const db = makeDb();
  const existingBuildId = createBuild(db, { name: "Old Quad", status: "retired" });
  assertThrows(
    () =>
      assembleBuild(db, {
        name: "New Quad",
        selections: [{ part_id: existingBuildId, qty: 1 }],
      }),
    Error,
  );
  db.close();
});

Deno.test("assembleBuild rejects parts with no free stock (already fully allocated)", () => {
  const db = makeDb();
  const buildId = createBuild(db, { name: "Old Quad", status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "in-use", type: "motor" });
  // All 4 motors are already installed in another build — free stock is 0
  addBuildComponent(db, buildId, motorId, 4);

  assertThrows(
    () => assembleBuild(db, { name: "New Quad", selections: [{ part_id: motorId, qty: 1 }] }),
    Error,
  );
  db.close();
});

Deno.test("assembleBuild rejects unknown part_id", () => {
  const db = makeDb();
  assertThrows(
    () => assembleBuild(db, { name: "Quad", selections: [{ part_id: 9999, qty: 1 }] }),
    Error,
  );
  db.close();
});

Deno.test("assembleBuild rolls back everything on validation failure mid-transaction", () => {
  const db = makeDb();
  const goodId = createPart(db, { name: "Motor", quantity: 8, status: "unused", type: "motor" });
  const badId = createPart(db, { name: "Frame", quantity: 1, status: "unused", type: "frame" });

  // Second selection exceeds available (1 available, asking for 2)
  let threw = false;
  try {
    assembleBuild(db, {
      name: "Quad",
      selections: [
        { part_id: goodId, qty: 4 },
        { part_id: badId, qty: 2 }, // only 1 available
      ],
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);

  // Both stock rows unchanged — nothing committed
  assertEquals(getPart(db, goodId)!.quantity, 8);
  assertEquals(getPart(db, badId)!.quantity, 1);
  assertEquals(listBuilds(db).length, 0);
  db.close();
});

Deno.test("assembleBuild rejects duplicate part_id entries that would overdraw stock", () => {
  const db = makeDb();
  // Only 4 available; two selections of qty=3 each total 6 > 4
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });

  assertThrows(
    () =>
      assembleBuild(db, {
        name: "Quad",
        selections: [
          { part_id: motorId, qty: 3 },
          { part_id: motorId, qty: 3 },
        ],
      }),
    Error,
    "Not enough free stock",
  );

  // Stock unchanged — nothing was committed
  assertEquals(getPart(db, motorId)!.quantity, 4);
  assertEquals(listBuilds(db).length, 0);
  db.close();
});

// ─── GET /builds/new (UI) ─────────────────────────────────────────────────────

Deno.test("GET /builds/new returns 200 HTML with a form", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/builds/new"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  const body = await res.text();
  assertStringIncludes(body, "<form");
  assertStringIncludes(body, "builds/from-bin");
});

Deno.test("GET /builds/new shows parts with qty > 0, but no builds and no zero-stock parts", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "0702 Motor", quantity: 12, status: "unused", type: "motor" });
  createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });
  // builds are not parts — should not appear in the picker
  createBuild(db, { name: "Old Quad", status: "retired" });
  // zero quantity should not appear
  createPart(db, { name: "Sold Out Part", quantity: 0, status: "unused", type: "esc" });

  const res = await handler(new Request("http://localhost/builds/new"));
  const body = await res.text();

  assertStringIncludes(body, "0702 Motor");
  assertStringIncludes(body, "FC-F4");
  // builds are not parts — a build must not be in the picker
  assertEquals(body.includes("Old Quad"), false);
  // zero-stock parts must not be in the picker
  assertEquals(body.includes("Sold Out Part"), false);
});

// ─── POST /builds/from-bin ────────────────────────────────────────────────────

Deno.test("POST /builds/from-bin creates build and redirects to the new build detail", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
  });
  const fcId = createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });

  const form = new FormData();
  form.set("name", "My Build");
  form.set(`qty_${motorId}`, "4");
  form.set(`qty_${fcId}`, "1");

  const res = await handler(
    new Request("http://localhost/builds/from-bin", { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  const location = res.headers.get("Location");
  assertExists(location);
  assertStringIncludes(location, "/builds/");

  // Verify build was created
  const builds = listBuilds(db);
  assertEquals(builds.length, 1);
  assertEquals(builds[0].name, "My Build");
  // And it got the selected components
  assertEquals(listBuildComponents(db, builds[0].id).length, 2);
  db.close();
});

Deno.test("POST /builds/from-bin with no name returns 400", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });

  const form = new FormData();
  form.set("name", "");

  const res = await handler(
    new Request("http://localhost/builds/from-bin", { method: "POST", body: form }),
  );
  assertEquals(res.status, 400);
});

Deno.test("POST /builds/from-bin with no parts selected returns 400", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.set("name", "Empty Build");
  const res = await handler(
    new Request("http://localhost/builds/from-bin", { method: "POST", body: form }),
  );
  assertEquals(res.status, 400);
});

Deno.test("POST /builds/from-bin over-request returns 400 and re-renders form", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });

  const form = new FormData();
  form.set("name", "Over Build");
  form.set(`qty_${motorId}`, "10"); // only 4 available

  const res = await handler(
    new Request("http://localhost/builds/from-bin", { method: "POST", body: form }),
  );
  assertEquals(res.status, 400);
  const body = await res.text();
  assertStringIncludes(body.toLowerCase(), "not enough");
});

Deno.test("POST /builds/:id/components/add is atomic — one bad selection leaves the BOM unchanged", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });
  const fcId = createPart(db, { name: "FC", quantity: 1, status: "unused", type: "fc" });
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const form = new FormData();
  form.set(`qty_${motorId}`, "2"); // valid
  form.set(`qty_${fcId}`, "5"); // over free stock

  const res = await handler(
    new Request(`http://localhost/builds/${buildId}/components/add`, {
      method: "POST",
      body: form,
    }),
  );
  assertEquals(res.status, 500);
  // nothing was installed — the earlier valid selection rolled back too
  assertEquals(listBuildComponents(db, buildId).length, 0);
  assertEquals(freeQuantity(db, motorId), 4);
});

Deno.test("POST /builds/:id/components/add rejects non-integer quantities instead of truncating", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const form = new FormData();
  form.set(`qty_${motorId}`, "2.5");

  const res = await handler(
    new Request(`http://localhost/builds/${buildId}/components/add`, {
      method: "POST",
      body: form,
    }),
  );
  assertEquals(res.status, 400);
  assertEquals(listBuildComponents(db, buildId).length, 0);
});

Deno.test("POST /builds/:id/components/add parses '1e1' as ten and skips zeroed picker rows", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, { name: "Motor", quantity: 12, status: "unused", type: "motor" });
  const fcId = createPart(db, { name: "FC", quantity: 1, status: "unused", type: "fc" });
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const form = new FormData();
  form.set(`qty_${motorId}`, "1e1");
  form.set(`qty_${fcId}`, "0"); // unselected picker row

  const res = await handler(
    new Request(`http://localhost/builds/${buildId}/components/add`, {
      method: "POST",
      body: form,
    }),
  );
  assertEquals(res.status, 303);
  const components = listBuildComponents(db, buildId);
  assertEquals(components.length, 1);
  assertEquals(components[0].quantity, 10);
});

Deno.test("POST /builds/:id/components/add records an 'installed' history entry with to_build_id", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused", type: "motor" });
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const form = new FormData();
  form.set(`qty_${motorId}`, "2");

  const res = await handler(
    new Request(`http://localhost/builds/${buildId}/components/add`, {
      method: "POST",
      body: form,
    }),
  );
  assertEquals(res.status, 303);

  const history = getPartHistory(db, motorId);
  const installed = history.filter((h) => h.action === "installed");
  assertEquals(installed.length, 1);
  assertEquals(installed[0].to_build_id, buildId);
});
