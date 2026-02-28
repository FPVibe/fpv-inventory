import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { initDb, createPart } from "../db.ts";
import { makeHandler } from "../main.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// ─── Home page ────────────────────────────────────────────────────────────────

Deno.test("GET / returns HTML inventory page", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  const html = await res.text();
  assertStringIncludes(html, "FPV Inventory");
});

Deno.test("GET / lists top-level parts", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Quad Alpha", quantity: 1, status: "in-use" });
  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();
  assertStringIncludes(html, "Quad Alpha");
});

// ─── Quick-add (POST /parts) ──────────────────────────────────────────────────

Deno.test("POST /parts creates a part and redirects", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("name", "0702 Motor");
  form.append("quantity", "6");
  form.append("status", "unused");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 303);
  assertStringIncludes(res.headers.get("Location") ?? "", "/");
});

Deno.test("POST /parts with missing name returns 400", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("quantity", "1");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 400);
});

Deno.test("POST /parts supports optional parent_id", async () => {
  const { db, handler } = makeApp();
  const quadId = createPart(db, { name: "Quad", quantity: 1, status: "in-use" });
  const form = new FormData();
  form.append("name", "Motor");
  form.append("quantity", "4");
  form.append("status", "in-use");
  form.append("parent_id", String(quadId));
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 303);
  // Redirect to the parent's detail page
  assertStringIncludes(res.headers.get("Location") ?? "", `/parts/${quadId}`);
});

// ─── Part detail ──────────────────────────────────────────────────────────────

Deno.test("GET /parts/:id returns part detail HTML", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Frame", quantity: 1, status: "in-use", notes: "3.5 inch" });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "Frame");
  assertStringIncludes(html, "3.5 inch");
});

Deno.test("GET /parts/:id shows child parts", async () => {
  const { db, handler } = makeApp();
  const quadId = createPart(db, { name: "Quad", quantity: 1, status: "in-use" });
  createPart(db, { name: "Camera", quantity: 1, status: "in-use", parent_id: quadId });
  const res = await handler(new Request(`http://localhost/parts/${quadId}`));
  const html = await res.text();
  assertStringIncludes(html, "Camera");
});

Deno.test("GET /parts/:id shows part history", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused" });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();
  assertStringIncludes(html, "created");
});

Deno.test("GET /parts/999 returns 404", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/parts/999"));
  assertEquals(res.status, 404);
});

// ─── Update part (POST /parts/:id/update) ────────────────────────────────────

Deno.test("POST /parts/:id/update changes status and redirects", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Motor", quantity: 1, status: "unused" });
  const form = new FormData();
  form.append("status", "broken");
  form.append("notes", "burned out");
  const res = await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form })
  );
  assertEquals(res.status, 303);
  assertStringIncludes(res.headers.get("Location") ?? "", `/parts/${id}`);
});

// ─── Move part (POST /parts/:id/move) ────────────────────────────────────────

Deno.test("POST /parts/:id/move reassigns parent and redirects", async () => {
  const { db, handler } = makeApp();
  const quad1Id = createPart(db, { name: "Quad 1", quantity: 1, status: "in-use" });
  const quad2Id = createPart(db, { name: "Quad 2", quantity: 1, status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "in-use", parent_id: quad1Id });
  const form = new FormData();
  form.append("new_parent_id", String(quad2Id));
  form.append("notes", "Salvaged");
  const res = await handler(
    new Request(`http://localhost/parts/${motorId}/move`, { method: "POST", body: form })
  );
  assertEquals(res.status, 303);
});

// ─── Photo upload (POST /parts/:id/photo) ────────────────────────────────────

Deno.test("POST /parts/:id/photo requires a file", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "VTX", quantity: 1, status: "unused" });
  const form = new FormData();
  // no file attached
  const res = await handler(
    new Request(`http://localhost/parts/${id}/photo`, { method: "POST", body: form })
  );
  assertEquals(res.status, 400);
});

// ─── Static photos ────────────────────────────────────────────────────────────

Deno.test("GET /photos/:filename returns 404 for missing file", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/photos/nonexistent.jpg"));
  assertEquals(res.status, 404);
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────

Deno.test("GET /unknown returns 404", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
});
