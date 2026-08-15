/**
 * Tests for INV-10: Stock check view (GET /stock)
 * Tests for INV-11: Allocation surfacing in part/build UI
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createPart, initDb } from "../db.ts";
import { makeHandler } from "../main.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// ─── INV-10: GET /stock ───────────────────────────────────────────────────────

Deno.test("GET /stock returns 200 HTML", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/stock"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
});

Deno.test("GET /stock page contains 'stock' in body (case-insensitive)", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/stock"));
  const body = await res.text();
  // A page that just returns 200 with the word "stock" somewhere
  assertStringIncludes(body.toLowerCase(), "stock");
});

Deno.test("GET /stock shows aggregated quantities per type/status (fixture data)", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor A", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Motor B", quantity: 4, status: "unused", type: "motor" });
  createPart(db, { name: "Motor C", quantity: 2, status: "in-use", type: "motor" });
  createPart(db, { name: "Frame X", quantity: 1, status: "unused", type: "frame" });

  const res = await handler(new Request("http://localhost/stock"));
  const body = await res.text();

  // total unused motors = 8
  assertStringIncludes(body, "8");
  // motor label
  assertStringIncludes(body.toLowerCase(), "motor");
  // frame label
  assertStringIncludes(body.toLowerCase(), "frame");
});

Deno.test("GET /stock excludes craft-type rows", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "My Quad", quantity: 1, status: "in-use", type: "craft" });
  createPart(db, { name: "0802 Motor", quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/stock"));
  const body = await res.text();

  // Motor should appear in stock view
  assertStringIncludes(body.toLowerCase(), "motor");
  // Craft ("My Quad") must NOT appear — the whole point of the filter
  assertEquals(body.includes("My Quad"), false);
});

Deno.test("GET /stock shows friendly empty state for empty DB", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/stock"));
  const body = await res.text();
  assertEquals(res.status, 200);
  // Should mention something about empty or no stock
  assertStringIncludes(body.toLowerCase(), "stock");
});

Deno.test("GET /stock has a nav link back to home", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/stock"));
  const body = await res.text();
  assertStringIncludes(body, 'href="/"');
});

// ─── INV-11: Allocation surfacing in part detail page ─────────────────────────

Deno.test("part detail shows allocation summary for non-craft stock parts", async () => {
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

  const res = await handler(new Request(`http://localhost/parts/${stockId}`));
  const body = await res.text();

  // On hand 12, allocated 4, free 8
  assertStringIncludes(body, "12");
  assertStringIncludes(body, "4");
  assertStringIncludes(body, "8");
  // Shows build name
  assertStringIncludes(body, "LionBee");
});

Deno.test("part detail links to build from allocation section", async () => {
  const { db, handler } = makeApp();
  const craftId = createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  const stockId = createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });

  const res = await handler(new Request(`http://localhost/parts/${stockId}`));
  const body = await res.text();
  // Should have a link to the craft build page
  assertStringIncludes(body, `/parts/${craftId}`);
});

Deno.test("part detail shows allocation for a part with no builds (free = on_hand)", async () => {
  const { db, handler } = makeApp();
  const partId = createPart(db, {
    name: "Loose Motor",
    quantity: 6,
    status: "unused",
    type: "motor",
  });

  const res = await handler(new Request(`http://localhost/parts/${partId}`));
  const body = await res.text();

  // on_hand 6, allocated 0, free 6
  assertStringIncludes(body, "6");
});

// ─── INV-11: Allocation surfacing in build detail page ────────────────────────

Deno.test("build detail (craft part page) shows BOM table with allocation columns", async () => {
  const { db, handler } = makeApp();
  const craftId = createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  // 8 loose motors in stock
  createPart(db, { name: "0702 Motor", quantity: 8, status: "unused", type: "motor" });
  // 4 installed in this build
  createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "in-use",
    type: "motor",
    parent_id: craftId,
  });

  const res = await handler(new Request(`http://localhost/parts/${craftId}`));
  const body = await res.text();

  // BOM should show on-hand / allocated / free
  // on_hand=12, allocated=4, free=8
  assertStringIncludes(body, "12");
  assertStringIncludes(body, "4");
  assertStringIncludes(body, "8");
});
