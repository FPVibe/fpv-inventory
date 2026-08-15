/**
 * Tests for INV-13: From-the-bin guided build flow
 *
 * Covers:
 *  - assembleBuild() db function
 *  - GET /builds/new UI
 *  - POST /builds/from-bin handler
 */
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createPart, getPart, getPartHistory, initDb, listParts } from "../db.ts";
import { assembleBuild } from "../db.ts";
import { allocationForGroup } from "../allocation.ts";
import { makeHandler } from "../main.ts";

function makeDb() {
  return initDb(":memory:");
}

function makeApp() {
  const db = makeDb();
  return { db, handler: makeHandler(db) };
}

// ─── assembleBuild — happy path ───────────────────────────────────────────────

Deno.test("assembleBuild creates a craft with correct child rows", () => {
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

  const craftId = assembleBuild(db, {
    name: "LionBee Build",
    notes: "First build",
    selections: [
      { part_id: motorId, qty: 4 },
      { part_id: fcId, qty: 1 },
    ],
  });

  // Craft was created
  const craft = getPart(db, craftId);
  assertExists(craft);
  assertEquals(craft!.name, "LionBee Build");
  assertEquals(craft!.type, "craft");
  assertEquals(craft!.status, "in-use");
  assertEquals(craft!.quantity, 1);
  assertEquals(craft!.parent_id, null);
  assertEquals(craft!.notes, "First build");

  // Craft has 2 children (motor + FC)
  const children = listParts(db, { parent_id: craftId });
  assertEquals(children.length, 2);

  const motorChild = children.find((c) => c.type === "motor");
  assertExists(motorChild);
  assertEquals(motorChild!.name, "0702 Motor");
  assertEquals(motorChild!.quantity, 4);
  assertEquals(motorChild!.status, "in-use");
  assertEquals(motorChild!.parent_id, craftId);
  assertEquals(motorChild!.specs, "KV: 27000"); // specs copied

  const fcChild = children.find((c) => c.type === "fc");
  assertExists(fcChild);
  assertEquals(fcChild!.name, "FC-F4");
  assertEquals(fcChild!.quantity, 1);
  db.close();
});

Deno.test("assembleBuild decrements stock rows by the selected quantity", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
  });
  const fcId = createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });

  assembleBuild(db, {
    name: "LionBee",
    selections: [
      { part_id: motorId, qty: 4 },
      { part_id: fcId, qty: 1 },
    ],
  });

  const motor = getPart(db, motorId);
  assertEquals(motor!.quantity, 8); // 12 - 4

  const fc = getPart(db, fcId);
  assertEquals(fc!.quantity, 1); // 2 - 1
  db.close();
});

Deno.test("assembleBuild stock rows kept even at quantity 0", () => {
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
  assertEquals(motor!.quantity, 0);
  db.close();
});

Deno.test("assembleBuild conservation: allocationForGroup shows on_hand 12 / allocated 4 / free 8", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 12,
    status: "unused",
    type: "motor",
  });
  const fcId = createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });

  assembleBuild(db, {
    name: "LionBee",
    selections: [
      { part_id: motorId, qty: 4 },
      { part_id: fcId, qty: 1 },
    ],
  });

  const alloc = allocationForGroup(db, "0702 Motor", "motor");
  // on_hand = 8 (stock) + 4 (installed) = 12 ✓ quantity is conserved
  assertEquals(alloc.on_hand, 12);
  assertEquals(alloc.allocated, 4);
  assertEquals(alloc.free, 8);
  db.close();
});

Deno.test("assembleBuild records correct history entries", () => {
  const db = makeDb();
  const motorId = createPart(db, {
    name: "0702 Motor",
    quantity: 8,
    status: "unused",
    type: "motor",
  });

  const craftId = assembleBuild(db, {
    name: "Quad",
    selections: [{ part_id: motorId, qty: 4 }],
  });

  // Stock row history: 'created' + 'updated' (quantity_delta = -4)
  const motorHistory = getPartHistory(db, motorId);
  const updateEvent = motorHistory.find((h) => h.action === "updated");
  assertExists(updateEvent);
  assertEquals(updateEvent!.quantity_delta, -4);

  // Child row history: 'created' with to_parent_id = craftId
  const children = listParts(db, { parent_id: craftId });
  const childHistory = getPartHistory(db, children[0].id);
  const createdEvent = childHistory.find((h) => h.action === "created");
  assertExists(createdEvent);
  assertEquals(createdEvent!.to_parent_id, craftId);
  db.close();
});

// ─── assembleBuild — validation failures ─────────────────────────────────────

Deno.test("assembleBuild rejects when qty exceeds available stock", () => {
  const db = makeDb();
  const motorId = createPart(db, { name: "Motor", quantity: 12, status: "unused", type: "motor" });

  assertThrows(
    () => assembleBuild(db, { name: "Quad", selections: [{ part_id: motorId, qty: 13 }] }),
    Error,
    "Not enough quantity",
  );

  // Nothing was changed — stock is still 12
  const motor = getPart(db, motorId);
  assertEquals(motor!.quantity, 12);
  // No craft was created
  assertEquals(listParts(db, { type: "craft" }).length, 0);
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

Deno.test("assembleBuild rejects craft-type parts as selections", () => {
  const db = makeDb();
  const existingCraftId = createPart(db, {
    name: "Old Quad",
    quantity: 1,
    status: "retired",
    type: "craft",
  });
  assertThrows(
    () =>
      assembleBuild(db, { name: "New Quad", selections: [{ part_id: existingCraftId, qty: 1 }] }),
    Error,
  );
  db.close();
});

Deno.test("assembleBuild rejects non-top-level parts (child of another)", () => {
  const db = makeDb();
  const craftId = createPart(db, {
    name: "Old Quad",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  const installedId = createPart(db, {
    name: "Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });
  assertThrows(
    () => assembleBuild(db, { name: "New Quad", selections: [{ part_id: installedId, qty: 1 }] }),
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
  assertEquals(listParts(db, { type: "craft" }).length, 0);
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
    "Not enough quantity",
  );

  // Stock unchanged — nothing was committed
  assertEquals(getPart(db, motorId)!.quantity, 4);
  assertEquals(listParts(db, { type: "craft" }).length, 0);
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

Deno.test("GET /builds/new shows available top-level non-craft parts with qty > 0", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "0702 Motor", quantity: 12, status: "unused", type: "motor" });
  createPart(db, { name: "FC-F4", quantity: 2, status: "unused", type: "fc" });
  // craft should not appear in picker
  createPart(db, { name: "Old Quad", quantity: 1, status: "retired", type: "craft" });
  // zero quantity should not appear
  createPart(db, { name: "Sold Out Part", quantity: 0, status: "unused", type: "esc" });

  const res = await handler(new Request("http://localhost/builds/new"));
  const body = await res.text();

  assertStringIncludes(body, "0702 Motor");
  assertStringIncludes(body, "FC-F4");
  // craft should not be in picker
  assertEquals(body.includes("Old Quad"), false);
});

// ─── POST /builds/from-bin ────────────────────────────────────────────────────

Deno.test("POST /builds/from-bin creates build and redirects to new craft detail", async () => {
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
  assertStringIncludes(location, "/parts/");

  // Verify build was created
  const crafts = listParts(db, { type: "craft" });
  assertEquals(crafts.length, 1);
  assertEquals(crafts[0].name, "My Build");
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
