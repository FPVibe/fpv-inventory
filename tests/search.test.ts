import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { createPart, initDb } from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// Part names chosen so they cannot collide with the quick-add placeholder text
// ("e.g. 0702 Motor, Quad Alpha…"), which appears in every page's HTML.
const ALPHA = "Cinder Motor";
const BETA = "Halcyon Frame";

// ─── Search on the list page (#76) ────────────────────────────────────────────

Deno.test("GET /?q= filters the list to matching part names", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });
  createPart(db, { name: BETA, quantity: 4, status: "unused", type: "other" });

  const res = await handler(new Request("http://localhost/?q=Cinder"));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, ALPHA);
  assertEquals(html.includes(BETA), false);
});

Deno.test("GET /?q= is case-insensitive", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/?q=cinder"));
  const html = await res.text();

  assertStringIncludes(html, ALPHA);
});

Deno.test("GET /?q= with no matches renders a no-results message", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/?q=zzzz"));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, "No parts match");
});

Deno.test("GET /?q= renders a search input holding the current term", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/?q=Cinder"));
  const html = await res.text();

  assertStringIncludes(html, 'name="q"');
  assertStringIncludes(html, 'value="Cinder"');
});

Deno.test("GET /?q= combines with the type filter", async () => {
  const { db, handler } = makeApp();
  // Passes both filters — must be shown.
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });
  // Matches the name but not the type — catches an ignored type filter.
  createPart(db, { name: "Cinder Camera", quantity: 1, status: "unused", type: "camera" });
  // Matches the type but not the name — catches an ignored name filter.
  createPart(db, { name: "Halcyon Motor", quantity: 1, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/?q=Cinder&type=motor"));
  const html = await res.text();

  assertStringIncludes(html, ALPHA);
  assertEquals(html.includes("Cinder Camera"), false);
  assertEquals(html.includes("Halcyon Motor"), false);
});

Deno.test("GET /?q= does not match child components (top-level list only)", async () => {
  const { db, handler } = makeApp();
  const buildId = createPart(db, { name: "LionBee", quantity: 1, status: "in-use", type: "craft" });
  createPart(db, {
    name: ALPHA,
    quantity: 4,
    status: "unused",
    type: "motor",
    parent_id: buildId,
  });

  const res = await handler(new Request("http://localhost/?q=Cinder"));
  const html = await res.text();

  assertEquals(html.includes(ALPHA), false);
});

// ─── Empty query params must not filter (#82) ─────────────────────────────────

Deno.test("GET /?type= (empty) renders the full list", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/?type="));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, ALPHA);
});

Deno.test("GET /?q= (empty) renders the full list", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });

  const res = await handler(new Request("http://localhost/?q="));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, ALPHA);
});

Deno.test("GET /?type=motor still filters", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: ALPHA, quantity: 2, status: "unused", type: "motor" });
  createPart(db, { name: BETA, quantity: 4, status: "unused", type: "other" });

  const res = await handler(new Request("http://localhost/?type=motor"));
  const html = await res.text();

  assertStringIncludes(html, ALPHA);
  assertEquals(html.includes(BETA), false);
});
