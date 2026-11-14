import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import {
  addBuildComponent,
  createBuild,
  createPart,
  deletePart,
  getPart,
  getPartHistory,
  initDb,
  listParts,
} from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

// ─── DB layer (#86) ──────────────────────────────────────────────────────────

Deno.test("deletePart removes the part and its history", () => {
  const db = initDb(":memory:");
  const id = createPart(db, { name: "Typo Partt", quantity: 1, status: "unused" });
  getPartHistory(db, id); // sanity: history exists
  deletePart(db, id);
  assertEquals(getPart(db, id), null);
  assertEquals(getPartHistory(db, id), []);
  db.close();
});

Deno.test("deletePart refuses a part allocated to a build", () => {
  const db = initDb(":memory:");
  const partId = createPart(db, { name: "Motor", quantity: 2, status: "unused" });
  const buildId = createBuild(db, { name: "LionBee" });
  addBuildComponent(db, buildId, partId, 1);
  assertThrows(() => deletePart(db, partId), Error, "allocated");
  // The part survives.
  assertFalse(getPart(db, partId) === null);
  db.close();
});

Deno.test("deletePart throws for an unknown part", () => {
  const db = initDb(":memory:");
  assertThrows(() => deletePart(db, 999), Error, "not found");
  db.close();
});

// ─── HTML flow (#86) ─────────────────────────────────────────────────────────

Deno.test("part detail page has a delete form", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Typo Partt", quantity: 1, status: "unused" });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();
  assertStringIncludes(html, `action="/parts/${id}/delete"`);
});

Deno.test("POST /parts/:id/delete removes the part and redirects home", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Typo Partt", quantity: 1, status: "unused" });
  const res = await handler(
    new Request(`http://localhost/parts/${id}/delete`, { method: "POST" }),
  );
  assertEquals(res.status, 303);
  assertEquals((await listParts(db)).map((p) => p.id), []);
  assertEquals(getPart(db, id), null);
});

Deno.test("POST /parts/:id/delete returns 400 for a part allocated to a build", async () => {
  const { db, handler } = makeApp();
  const partId = createPart(db, { name: "Motor", quantity: 2, status: "unused" });
  const buildId = createBuild(db, { name: "LionBee" });
  addBuildComponent(db, buildId, partId, 1);
  const res = await handler(
    new Request(`http://localhost/parts/${partId}/delete`, { method: "POST" }),
  );
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), "allocated");
  assertFalse(getPart(db, partId) === null);
});

Deno.test("POST /parts/:id/delete returns 404 for an unknown part", async () => {
  const { handler } = makeApp();
  const res = await handler(
    new Request("http://localhost/parts/999/delete", { method: "POST" }),
  );
  assertEquals(res.status, 404);
});

// ─── JSON API (#86) ──────────────────────────────────────────────────────────

Deno.test("DELETE /api/parts/:id removes the part", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Typo Partt", quantity: 1, status: "unused" });
  const res = await handler(
    new Request(`http://localhost/api/parts/${id}`, { method: "DELETE" }),
  );
  assertEquals(res.status, 200);
  assertEquals(getPart(db, id), null);
});

Deno.test("DELETE /api/parts/:id returns 409 for a part allocated to a build", async () => {
  const { db, handler } = makeApp();
  const partId = createPart(db, { name: "Motor", quantity: 2, status: "unused" });
  const buildId = createBuild(db, { name: "LionBee" });
  addBuildComponent(db, buildId, partId, 1);
  const res = await handler(
    new Request(`http://localhost/api/parts/${partId}`, { method: "DELETE" }),
  );
  assertEquals(res.status, 409);
  assertStringIncludes(await res.text(), "allocated");
});

Deno.test("DELETE /api/parts/:id returns 404 for an unknown part", async () => {
  const { handler } = makeApp();
  const res = await handler(
    new Request("http://localhost/api/parts/999", { method: "DELETE" }),
  );
  assertEquals(res.status, 404);
});
