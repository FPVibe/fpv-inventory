import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { createPart, getPart, initDb } from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

const ALPHA = "Cinder Motor";

// ─── Read view is a read view (#80) ───────────────────────────────────────────

Deno.test("GET /parts/:id shows the part's values", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: ALPHA,
    quantity: 4,
    status: "unused",
    type: "motor",
    notes: "spare set",
  });

  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, ALPHA);
  assertStringIncludes(html, "spare set");
  assertStringIncludes(html, "Unused");
  assertStringIncludes(html, "Motor");
});

Deno.test("GET /parts/:id does not render the edit form inline", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();

  // The read view keeps the quick-add form, which has its own status select —
  // discriminate on the edit form's target rather than the field names.
  assertEquals(html.includes(`action="/parts/${id}/update"`), false);
  assertEquals(html.includes('name="serial_number"'), false);
  assertEquals(html.includes('name="purchase_price"'), false);
});

Deno.test("GET /parts/:id does not render the move form inline", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();

  assertEquals(html.includes('name="new_parent_id"'), false);
});

Deno.test("GET /parts/:id does not render the photo upload form inline", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();

  assertEquals(html.includes('type="file"'), false);
});

Deno.test("GET /parts/:id links to the edit, move and photo views", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();

  assertStringIncludes(html, `/parts/${id}/edit`);
  assertStringIncludes(html, `/parts/${id}/move`);
  assertStringIncludes(html, `/parts/${id}/photo`);
});

Deno.test("GET /parts/:id still shows history and components", async () => {
  const { db, handler } = makeApp();
  const buildId = createPart(db, {
    name: "LionBee",
    quantity: 1,
    status: "in-use",
    type: "craft",
  });
  const id = createPart(db, {
    name: ALPHA,
    quantity: 4,
    status: "unused",
    type: "motor",
    parent_id: buildId,
  });

  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();

  assertStringIncludes(html, "History");
  assertStringIncludes(html, "Components of");
});

Deno.test("GET /parts/:id 404s for an unknown id", async () => {
  const { handler } = makeApp();

  const res = await handler(new Request("http://localhost/parts/9999"));

  assertEquals(res.status, 404);
});

// ─── Edit view (#80) ──────────────────────────────────────────────────────────

Deno.test("GET /parts/:id/edit renders the edit form only", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: ALPHA,
    quantity: 4,
    status: "unused",
    type: "motor",
  });

  const res = await handler(new Request(`http://localhost/parts/${id}/edit`));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, 'name="status"');
  assertStringIncludes(html, 'name="type"');
  assertStringIncludes(html, 'name="quantity"');
  assertStringIncludes(html, 'name="notes"');
  assertStringIncludes(html, 'name="specs"');
  assertStringIncludes(html, 'name="serial_number"');
  assertStringIncludes(html, 'name="purchase_price"');
});

Deno.test("GET /parts/:id/edit renders exactly one submit button", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}/edit`));
  const html = await res.text();

  const submits = html.match(/<button[^>]*type="submit"/g) ?? [];
  assertEquals(submits.length, 1);
});

Deno.test("GET /parts/:id/edit does not render the move or photo forms", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}/edit`));
  const html = await res.text();

  assertEquals(html.includes(`action="/parts/${id}/move"`), false);
  assertEquals(html.includes(`action="/parts/${id}/photo"`), false);
});

Deno.test("GET /parts/:id/edit pre-fills the current values", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: ALPHA,
    quantity: 7,
    status: "in-use",
    type: "motor",
    notes: "keep me",
  });

  const res = await handler(new Request(`http://localhost/parts/${id}/edit`));
  const html = await res.text();

  assertStringIncludes(html, 'value="7"');
  assertStringIncludes(html, "keep me");
});

Deno.test("GET /parts/:id/edit 404s for an unknown id", async () => {
  const { handler } = makeApp();

  const res = await handler(new Request("http://localhost/parts/9999/edit"));

  assertEquals(res.status, 404);
});

// ─── Move view (#80) ──────────────────────────────────────────────────────────

Deno.test("GET /parts/:id/move renders the move form only", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}/move`));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, 'name="new_parent_id"');
  assertEquals(html.includes(`action="/parts/${id}/update"`), false);
  assertEquals(html.includes(`action="/parts/${id}/photo"`), false);
});

Deno.test("GET /parts/:id/move 404s for an unknown id", async () => {
  const { handler } = makeApp();

  const res = await handler(new Request("http://localhost/parts/9999/move"));

  assertEquals(res.status, 404);
});

// ─── Photo view (#80) ─────────────────────────────────────────────────────────

Deno.test("GET /parts/:id/photo renders the upload form only", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const res = await handler(new Request(`http://localhost/parts/${id}/photo`));
  const html = await res.text();

  assertEquals(res.status, 200);
  assertStringIncludes(html, 'type="file"');
  assertEquals(html.includes(`action="/parts/${id}/update"`), false);
  assertEquals(html.includes(`action="/parts/${id}/move"`), false);
});

Deno.test("GET /parts/:id/photo 404s for an unknown id", async () => {
  const { handler } = makeApp();

  const res = await handler(new Request("http://localhost/parts/9999/photo"));

  assertEquals(res.status, 404);
});

// ─── The write routes still work (#80) ────────────────────────────────────────

Deno.test("POST /parts/:id/update still saves edits", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: ALPHA, quantity: 4, status: "unused", type: "motor" });

  const form = new FormData();
  form.set("status", "broken");
  form.set("type", "fc");
  form.set("quantity", "3");
  form.set("notes", "smoke damage");

  const res = await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form }),
  );

  assertEquals(res.status, 303);
  const part = getPart(db, id);
  assertEquals(part?.status, "broken");
  assertEquals(part?.type, "fc");
  assertEquals(part?.quantity, 3);
  assertEquals(part?.notes, "smoke damage");
});
