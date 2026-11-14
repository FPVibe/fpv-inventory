import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { createPart, initDb, listParts } from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

function importPost(text: string): Request {
  const form = new FormData();
  form.set("paste", text);
  return new Request("http://localhost/parts/import", {
    method: "POST",
    body: form,
    headers: { "Origin": "http://localhost" },
  });
}

// ─── Page (#87) ──────────────────────────────────────────────────────────────

Deno.test("GET /parts/import renders a paste textarea and form", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/parts/import"));
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, 'name="paste"');
  assertStringIncludes(html, 'action="/parts/import"');
});

Deno.test("home page links to the bulk import page", async () => {
  const { handler } = makeApp();
  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();
  assertStringIncludes(html, 'href="/parts/import"');
});

// ─── Import behavior (#87) ───────────────────────────────────────────────────

Deno.test("POST /parts/import creates one part per valid line", async () => {
  const { db, handler } = makeApp();
  const text = [
    "0702 Motor | 4 | motor | Drawer 2",
    "Walksnail Avatar Mini | 1 | gear",
    "M4 prop set",
  ].join("\n");
  const res = await handler(importPost(text));
  assertEquals(res.status, 303);
  const parts = listParts(db);
  assertEquals(parts.length, 3);
  const motor = parts.find((p) => p.name === "0702 Motor")!;
  const avatar = parts.find((p) => p.name === "Walksnail Avatar Mini")!;
  const props = parts.find((p) => p.name === "M4 prop set")!;
  assertEquals(motor.quantity, 4);
  assertEquals(motor.type, "motor");
  assertEquals(motor.location, "Drawer 2");
  assertEquals(avatar.quantity, 1);
  assertEquals(avatar.type, "gear");
  assertEquals(avatar.location, null);
  assertEquals(props.quantity, 1);
  assertEquals(props.type, null);
});

Deno.test("POST /parts/import skips blank lines", async () => {
  const { db, handler } = makeApp();
  const text = [
    "",
    "Part A | 1",
    "   ",
    "Part B",
    "",
  ].join("\n");
  const res = await handler(importPost(text));
  assertEquals(res.status, 303);
  const parts = listParts(db);
  assertEquals(parts.length, 2);
});

Deno.test("POST /parts/import errors naming the line on an unknown type and creates nothing", async () => {
  const { db, handler } = makeApp();
  const text = [
    "Good Part | 1",
    "Bad Part | 1 | propeller",
  ].join("\n");
  const res = await handler(importPost(text));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), "Line 2");
  assertEquals(listParts(db).length, 0);
});

Deno.test("POST /parts/import errors naming the line on a bad quantity and creates nothing", async () => {
  const { db, handler } = makeApp();
  const text = [
    "Good Part | 1",
    "Bad Qty | 1.5",
  ].join("\n");
  const res = await handler(importPost(text));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), "Line 2");
  assertEquals(listParts(db).length, 0);
});

Deno.test("POST /parts/import errors naming the line on a missing name and creates nothing", async () => {
  const { db, handler } = makeApp();
  const text = [
    "Good Part | 1",
    " | 1",
  ].join("\n");
  const res = await handler(importPost(text));
  assertEquals(res.status, 400);
  assertStringIncludes(await res.text(), "Line 2");
  assertEquals(listParts(db).length, 0);
});

Deno.test("POST /parts/import with an empty paste creates nothing", async () => {
  const { db, handler } = makeApp();
  const res = await handler(importPost("\n\n  \n"));
  assertEquals(res.status, 303);
  assertEquals(listParts(db).length, 0);
});
