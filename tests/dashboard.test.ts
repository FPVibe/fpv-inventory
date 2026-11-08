import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { assembleBuild, createPart, initDb } from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// Names chosen so they cannot collide with placeholder text present in every
// page's HTML ("e.g. 0702 Motor, Quad Alpha…").
const ALPHA = "Cinder Motor";
const BETA = "Halcyon Frame";
const GAMMA = "Vesper Stack";

// The summary renders each figure with a stable id so assertions cannot be
// satisfied by an unrelated number appearing elsewhere in the page.
function stat(html: string, id: string): string | null {
  const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
}

// ─── Summary (#77) ────────────────────────────────────────────────────────────

Deno.test("summary counts parts, quantity and inventory value", async () => {
  const { db, handler } = makeApp();
  createPart(db, {
    name: ALPHA,
    quantity: 8,
    status: "unused",
    type: "motor",
    purchase_price: 24.99,
  });
  createPart(db, {
    name: BETA,
    quantity: 3,
    status: "unused",
    type: "frame",
    purchase_price: 39.99,
  });
  createPart(db, {
    name: GAMMA,
    quantity: 4,
    status: "unused",
    type: "fc",
    purchase_price: 42.99,
  });

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertEquals(stat(html, "stat-total-parts"), "3");
  // total quantity 8 + 3 + 4
  assertEquals(stat(html, "stat-total-quantity"), "15");
  // value 8*24.99 + 3*39.99 + 4*42.99 = 199.92 + 119.97 + 171.96 = 491.85
  assertEquals(stat(html, "stat-inventory-value"), "$491.85");
});

Deno.test("summary excludes craft rows from parts, quantity and value", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor", purchase_price: 10 });
  createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
    purchase_price: 180,
  });

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  assertEquals(stat(html, "stat-total-parts"), "1");
  assertEquals(stat(html, "stat-total-quantity"), "2");
  assertEquals(stat(html, "stat-inventory-value"), "$20.00");
});

Deno.test("summary counts parts with no price toward count and quantity but not value", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  assertEquals(stat(html, "stat-total-parts"), "1");
  assertEquals(stat(html, "stat-total-quantity"), "2");
  assertEquals(stat(html, "stat-inventory-value"), "$0.00");
});

Deno.test("summary counts rows installed in a build", async () => {
  const { db, handler } = makeApp();
  const buildId = createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  createPart(db, {
    name: ALPHA,
    quantity: 4,
    status: "unused",
    type: "motor",
    parent_id: buildId,
  });

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  assertEquals(stat(html, "stat-installed-in-builds"), "1");
});

Deno.test("summary reports low stock by summed quantity per name", async () => {
  const { db, handler } = makeApp();
  // two rows of the same name, 2 + 1 = 3 total -> at/below the threshold of 3
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });
  createPart(db, { name: ALPHA, quantity: 1, status: "unused", type: "motor" });
  createPart(db, { name: BETA, quantity: 9, status: "unused", type: "frame" });

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  // one distinct name at or below the threshold
  assertEquals(stat(html, "stat-low-stock"), "1");
});

Deno.test("summary keeps inventory value when priced stock is installed via New Build", async () => {
  const { db, handler } = makeApp();
  const motorId = createPart(db, {
    name: ALPHA,
    quantity: 8,
    status: "unused",
    type: "motor",
    purchase_price: 24.99,
  });
  assembleBuild(db, { name: "LionBee", selections: [{ part_id: motorId, qty: 4 }] });

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  // 8 units at $24.99 remain in inventory — installing 4 into a build must
  // not drop the value from $199.92 to $99.96.
  assertEquals(stat(html, "stat-inventory-value"), "$199.92");
});

Deno.test("summary renders on an empty database", async () => {
  const { handler } = makeApp();

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertEquals(stat(html, "stat-total-parts"), "0");
  assertEquals(stat(html, "stat-total-quantity"), "0");
  assertEquals(stat(html, "stat-inventory-value"), "$0.00");
  assertEquals(stat(html, "stat-low-stock"), "0");
  assertEquals(stat(html, "stat-installed-in-builds"), "0");
});

Deno.test("summary appears on the home page above the parts list", async () => {
  const { handler } = makeApp();

  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();

  const summaryAt = html.indexOf('id="stat-total-parts"');
  const listAt = html.indexOf("Parts &amp; Assemblies");
  assertEquals(summaryAt > 0, true);
  assertEquals(listAt > 0, true);
  assertEquals(summaryAt < listAt, true);
});
