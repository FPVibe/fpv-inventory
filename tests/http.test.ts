import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  addBuildComponent,
  createBuild,
  createPart,
  getBuild,
  getBuildHistory,
  getPartHistory,
  initDb,
  listBuildComponents,
  listParts,
} from "../db.ts";
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

// ─── New part form (GET /parts/new) ──────────────────────────────────────────

Deno.test("GET /parts/new returns a full add form", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/parts/new"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  const html = await res.text();
  assertStringIncludes(html, "Add Part");
  // Full form has notes and name fields
  assertStringIncludes(html, 'name="name"');
  assertStringIncludes(html, 'name="notes"');
  assertStringIncludes(html, 'name="type"');
});

Deno.test("GET / homepage links to full add form", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();
  assertStringIncludes(html, "/parts/new");
});

Deno.test("POST /parts/new creates part with notes and redirects to part detail", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("name", "Speedybee F405");
  form.append("quantity", "1");
  form.append("status", "unused");
  form.append("type", "fc");
  form.append("notes", "brand new, needs firmware");
  const res = await handler(
    new Request("http://localhost/parts/new", { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  // Redirects to the new part's detail page, not the homepage
  const location = res.headers.get("Location") ?? "";
  assertStringIncludes(location, "/parts/");
});

// ─── Quick-add (POST /parts) ──────────────────────────────────────────────────

Deno.test("POST /parts creates a part and redirects to homepage", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("name", "0702 Motor");
  form.append("quantity", "6");
  form.append("status", "unused");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 303);
  assertEquals(res.headers.get("Location"), "/");
});

Deno.test("POST /parts then GET / shows the new part", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("name", "Runcam Nano 4");
  form.append("quantity", "1");
  form.append("status", "unused");
  await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  const res = await handler(new Request("http://localhost/"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "Runcam Nano 4");
});

Deno.test("POST /parts with missing name returns 400", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("quantity", "1");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 400);
});

Deno.test("POST /parts with invalid parent_id treats part as top-level", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.append("name", "Quad Beta");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 303);
  assertEquals(res.headers.get("Location"), "/");
});

Deno.test("POST /parts creates a part and redirects to the inventory", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.append("name", "Motor");
  form.append("quantity", "4");
  form.append("status", "in-use");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 303);
  assertEquals(res.headers.get("Location"), "/");
  assertEquals(listParts(db).length, 1);
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

Deno.test("GET /parts/:id shows the builds a part is installed in", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "Quad Alpha", status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused" });
  addBuildComponent(db, buildId, motorId, 2);
  const res = await handler(new Request(`http://localhost/parts/${motorId}`));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "Quad Alpha");
  assertStringIncludes(html, "Allocation");
});

Deno.test("GET /parts/:id shows no build section for an uninstalled part", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Loose Motor", quantity: 4, status: "unused" });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();
  assertStringIncludes(html, "Loose Motor");
  assertStringIncludes(html, "Not installed in any build.");
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

// ─── Specs field (HTTP) ───────────────────────────────────────────────────────

Deno.test("GET /parts/:id shows specs when present", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: "Motor",
    quantity: 4,
    status: "unused",
    specs: "KV: 2400\nWeight: 31g",
  });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();
  assertStringIncludes(html, "KV: 2400");
  assertStringIncludes(html, "Specs");
});

Deno.test("POST /parts/:id/update can save specs", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Motor", quantity: 1, status: "unused" });
  const form = new FormData();
  form.append("status", "unused");
  form.append("specs", "KV: 2400\nShaft: 3mm");
  const res = await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  const part = db.query<[string | null]>("SELECT specs FROM parts WHERE id=?", [id])[0][0];
  assertEquals(part, "KV: 2400\nShaft: 3mm");
});

// ─── Update part (POST /parts/:id/update) ────────────────────────────────────

Deno.test("POST /parts/:id/update changes status and redirects", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Motor", quantity: 1, status: "unused" });
  const form = new FormData();
  form.append("status", "broken");
  form.append("notes", "burned out");
  const res = await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  assertStringIncludes(res.headers.get("Location") ?? "", `/parts/${id}`);
});

// ─── Move part (POST /parts/:id/move) ────────────────────────────────────────

Deno.test("POST /parts/:id/install installs the part in a build and redirects", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "Quad 1", status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused" });
  const form = new FormData();
  form.append("build_id", String(buildId));
  form.append("quantity", "2");
  form.append("notes", "Salvaged");
  const res = await handler(
    new Request(`http://localhost/parts/${motorId}/install`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  assertEquals(res.headers.get("Location"), `/builds/${buildId}`);
  assertEquals(listBuildComponents(db, buildId).length, 1);
});

// ─── Photo upload (POST /parts/:id/photo) ────────────────────────────────────

Deno.test("POST /parts/:id/photo requires a file", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "VTX", quantity: 1, status: "unused" });
  const form = new FormData();
  // no file attached
  const res = await handler(
    new Request(`http://localhost/parts/${id}/photo`, { method: "POST", body: form }),
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

// ─── Build edit, update and photo actions (#85 review) ───────────────────────

Deno.test("GET /builds/:id links to the edit and photo views", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const res = await handler(new Request(`http://localhost/builds/${buildId}`));
  const html = await res.text();

  assertStringIncludes(html, `/builds/${buildId}/edit`);
  assertStringIncludes(html, `/builds/${buildId}/photo`);
});

Deno.test("GET /builds/:id/edit renders a form that posts to /builds/:id/update", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, {
    name: "LionBee",
    status: "in-use",
    class: "whoop",
    notes: "mushy",
  });

  const res = await handler(new Request(`http://localhost/builds/${buildId}/edit`));
  assertEquals(res.status, 200);
  const html = await res.text();

  assertStringIncludes(html, `action="/builds/${buildId}/update"`);
  assertStringIncludes(html, 'name="status"');
  assertStringIncludes(html, 'name="class"');
  assertStringIncludes(html, 'name="notes"');
  assertStringIncludes(html, 'name="specs"');
  assertStringIncludes(html, "whoop");
});

Deno.test("POST /builds/:id/update changes status and records build history", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const form = new FormData();
  form.set("status", "broken");
  form.set("class", "whoop");
  form.set("notes", "frame arm cracked");

  const res = await handler(
    new Request(`http://localhost/builds/${buildId}/update`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);

  const build = getBuild(db, buildId);
  assertEquals(build!.status, "broken");
  assertEquals(build!.class, "whoop");
  assertEquals(build!.notes, "frame arm cracked");

  const history = getBuildHistory(db, buildId);
  const last = history[history.length - 1];
  assertEquals(last.action, "updated");
  assertEquals(last.old_status, "in-use");
  assertEquals(last.new_status, "broken");
});

Deno.test("POST /builds/:id/update 404s for a non-build id", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Motor", quantity: 1, status: "unused" });
  const form = new FormData();
  form.set("status", "broken");
  const res = await handler(
    new Request("http://localhost/builds/1/update", { method: "POST", body: form }),
  );
  assertEquals(res.status, 404);
});

Deno.test("GET /builds/:id/photo renders the upload form", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const res = await handler(new Request(`http://localhost/builds/${buildId}/photo`));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, `action="/builds/${buildId}/photo"`);
  assertStringIncludes(html, 'type="file"');
});

Deno.test("POST /parts/:id/install parses '1e1' as ten, not one", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "Quad 1", status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 12, status: "unused" });
  const form = new FormData();
  form.append("build_id", String(buildId));
  form.append("quantity", "1e1");
  const res = await handler(
    new Request(`http://localhost/parts/${motorId}/install`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  assertEquals(listBuildComponents(db, buildId)[0].quantity, 10);
});

Deno.test("POST /parts/:id/install rejects a non-integer quantity", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "Quad 1", status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused" });
  const form = new FormData();
  form.append("build_id", String(buildId));
  form.append("quantity", "2.5");
  const res = await handler(
    new Request(`http://localhost/parts/${motorId}/install`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 400);
  assertEquals(listBuildComponents(db, buildId).length, 0);
});

Deno.test("POST /parts/:id/install records exactly one 'installed' history entry", async () => {
  const { db, handler } = makeApp();
  const buildId = createBuild(db, { name: "Quad 1", status: "in-use" });
  const motorId = createPart(db, { name: "Motor", quantity: 4, status: "unused" });
  const form = new FormData();
  form.append("build_id", String(buildId));
  form.append("quantity", "2");
  const res = await handler(
    new Request(`http://localhost/parts/${motorId}/install`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  const history = getPartHistory(db, motorId);
  assertEquals(history.filter((h) => h.action === "installed").length, 1);
});
