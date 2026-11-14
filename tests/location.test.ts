import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { createPart, getPart, initDb, listParts, updatePart } from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// ─── DB layer (#72) ──────────────────────────────────────────────────────────

Deno.test("createPart and getPart round-trip location", () => {
  const db = initDb(":memory:");
  const id = createPart(db, {
    name: "0702 Motor",
    quantity: 4,
    status: "unused",
    location: "Drawer 2 — small parts",
  });
  const part = getPart(db, id);
  assertEquals(part?.location, "Drawer 2 — small parts");
  db.close();
});

Deno.test("parts without location have null location", () => {
  const db = initDb(":memory:");
  const id = createPart(db, { name: "Frame", quantity: 1, status: "unused" });
  const part = getPart(db, id);
  assertEquals(part?.location, null);
  db.close();
});

Deno.test("listParts location filter is a case-insensitive substring match", () => {
  const db = initDb(":memory:");
  createPart(db, { name: "Motor A", quantity: 1, status: "unused", location: "Drawer Two" });
  createPart(db, { name: "Motor B", quantity: 1, status: "unused", location: "bin on shelf" });
  const parts = listParts(db, { location: "drawer" });
  assertEquals(parts.length, 1);
  assertEquals(parts[0].name, "Motor A");
  db.close();
});

Deno.test("listParts without location filter returns every part", () => {
  const db = initDb(":memory:");
  createPart(db, { name: "A", quantity: 1, status: "unused", location: "Bin 3" });
  createPart(db, { name: "B", quantity: 1, status: "unused" });
  assertEquals(listParts(db).length, 2);
  db.close();
});

Deno.test("updatePart sets and clears location", () => {
  const db = initDb(":memory:");
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused" });
  updatePart(db, id, { location: "Box A" });
  assertEquals(getPart(db, id)?.location, "Box A");
  updatePart(db, id, { location: "" });
  assertEquals(getPart(db, id)?.location, null);
  db.close();
});

Deno.test("updatePart keeps existing location untouched when not in input", () => {
  const db = initDb(":memory:");
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused", location: "Box A" });
  updatePart(db, id, { status: "in-use" });
  assertEquals(getPart(db, id)?.location, "Box A");
  db.close();
});

// ─── HTML flows (#72) ────────────────────────────────────────────────────────

Deno.test("quick-add form includes a location input", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();
  assertStringIncludes(html, 'name="location"');
});

Deno.test("POST /parts (quick add) persists location", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Props");
  form.set("quantity", "1");
  form.set("status", "unused");
  form.set("location", "Bin 5");
  const res = await handler(new Request("http://localhost/parts", { method: "POST", body: form }));
  assertEquals(res.status, 303);
  const parts = listParts(db);
  assertEquals(parts.length, 1);
  assertEquals(parts[0].location, "Bin 5");
});

Deno.test("POST /parts/new (full form) persists location", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Walksnail Avatar Mini");
  form.set("status", "unused");
  form.set("location", "Gear drawer, top");
  const res = await handler(
    new Request("http://localhost/parts/new", { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  const parts = listParts(db);
  assertEquals(parts[0].location, "Gear drawer, top");
});

Deno.test("POST /parts/:id/update persists location; empty clears it", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: "GoPro 13",
    quantity: 1,
    status: "in-use",
    location: "Bin 2",
  });
  const form = new FormData();
  form.set("status", "in-use");
  form.set("quantity", "1");
  form.set("location", "Soft case");
  const res = await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  assertEquals(getPart(db, id)?.location, "Soft case");

  const form2 = new FormData();
  form2.set("status", "in-use");
  form2.set("quantity", "1");
  form2.set("location", "");
  await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form2 }),
  );
  assertEquals(getPart(db, id)?.location, null);
});

Deno.test("part detail page displays the location when set", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: "GoPro 13",
    quantity: 1,
    status: "in-use",
    location: "Bin 2, second shelf",
  });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();
  assertStringIncludes(html, "Bin 2, second shelf");
});

Deno.test("part edit form includes a location input holding the current value", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, {
    name: "GoPro 13",
    quantity: 1,
    status: "in-use",
    location: "Bin 2",
  });
  const res = await handler(new Request(`http://localhost/parts/${id}/edit`));
  const html = await res.text();
  assertStringIncludes(html, 'name="location"');
  assertStringIncludes(html, 'value="Bin 2"');
});

Deno.test("GET /?location= filters the list to matching parts", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Cinder Motor", quantity: 2, status: "unused", location: "Drawer Two" });
  createPart(db, { name: "Halcyon Frame", quantity: 1, status: "unused", location: "Big bin" });

  const res = await handler(new Request("http://localhost/?location=drawer"));
  const html = await res.text();
  assertEquals(res.status, 200);
  assertStringIncludes(html, "Cinder Motor");
  assertEquals(html.includes("Halcyon Frame"), false);
});

Deno.test("GET /?location= holds the current filter value in its input", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Cinder Motor", quantity: 2, status: "unused", location: "Drawer Two" });
  const res = await handler(new Request("http://localhost/?location=Drawer"));
  const html = await res.text();
  assertStringIncludes(html, 'name="location"');
  assertStringIncludes(html, 'value="Drawer"');
});

// ─── JSON API (#72) ──────────────────────────────────────────────────────────

Deno.test("GET /api/parts?location= filters and returns the location", async () => {
  const { db, handler } = makeApp();
  createPart(db, { name: "Cinder Motor", quantity: 2, status: "unused", location: "Drawer Two" });
  createPart(db, { name: "Halcyon Frame", quantity: 1, status: "unused", location: "Big bin" });

  const res = await handler(new Request("http://localhost/api/parts?location=drawer"));
  assertEquals(res.status, 200);
  const body = JSON.parse(await res.text());
  assertEquals(body.length, 1);
  assertEquals(body[0].name, "Cinder Motor");
  assertEquals(body[0].location, "Drawer Two");
});

Deno.test("GET /api/parts/:id returns the location", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "ESC", quantity: 1, status: "unused", location: "Bin 9" });
  const res = await handler(new Request(`http://localhost/api/parts/${id}`));
  assertEquals(res.status, 200);
  const body = JSON.parse(await res.text());
  assertEquals(body.location, "Bin 9");
});
