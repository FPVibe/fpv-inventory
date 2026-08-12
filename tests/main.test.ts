import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { createPart, getPart, initDb, listParts } from "../db.ts";

Deno.test("GET / returns HTML with FPV Inventory title", async () => {
  const db = initDb(":memory:");
  const handler = makeHandler(db);
  const req = new Request("http://localhost/");
  const res = await handler(req);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");

  const html = await res.text();
  assertStringIncludes(html, "FPV Inventory");
});

Deno.test("GET /unknown returns 404", async () => {
  const db = initDb(":memory:");
  const handler = makeHandler(db);
  const req = new Request("http://localhost/unknown");
  const res = await handler(req);

  assertEquals(res.status, 404);
});

// ─── Gear type in UI ──────────────────────────────────────────────────────────

Deno.test("home page type selector includes gear option", async () => {
  const db = initDb(":memory:");
  const handler = makeHandler(db);
  const res = await handler(new Request("http://localhost/"));
  const html = await res.text();
  assertStringIncludes(html, 'value="gear"');
});

// ─── Gear fields via form submissions ────────────────────────────────────────

Deno.test("POST /parts/new saves serial_number, warranty_expiry, purchase_date, purchase_price", async () => {
  const db = initDb(":memory:");
  const handler = makeHandler(db);
  const form = new FormData();
  form.set("name", "Walksnail Avatar Mini");
  form.set("type", "gear");
  form.set("status", "unused");
  form.set("quantity", "1");
  form.set("serial_number", "SN-12345");
  form.set("warranty_expiry", "2027-01-01");
  form.set("purchase_date", "2025-01-15");
  form.set("purchase_price", "89.99");
  const res = await handler(
    new Request("http://localhost/parts/new", { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  const parts = listParts(db, { type: "gear" });
  assertEquals(parts.length, 1);
  assertEquals(parts[0].serial_number, "SN-12345");
  assertEquals(parts[0].warranty_expiry, "2027-01-01");
  assertEquals(parts[0].purchase_date, "2025-01-15");
  assertEquals(parts[0].purchase_price, 89.99);
});

Deno.test("POST /parts/:id/update persists serial_number; empty price/date clears to null", async () => {
  const db = initDb(":memory:");
  const handler = makeHandler(db);
  const id = createPart(db, {
    name: "GoPro 13",
    quantity: 1,
    status: "in-use",
    type: "gear",
    purchase_price: 299.99,
  });
  const form = new FormData();
  form.set("status", "in-use");
  form.set("quantity", "1");
  form.set("serial_number", "GP-XXXXXXXXXXX");
  form.set("warranty_expiry", "");
  form.set("purchase_date", "");
  form.set("purchase_price", "");
  const res = await handler(
    new Request(`http://localhost/parts/${id}/update`, { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  const part = getPart(db, id);
  assertEquals(part?.serial_number, "GP-XXXXXXXXXXX");
  assertEquals(part?.warranty_expiry, null);
  assertEquals(part?.purchase_price, null);
});

Deno.test("part detail page displays serial_number and purchase_price when set", async () => {
  const db = initDb(":memory:");
  const handler = makeHandler(db);
  const id = createPart(db, {
    name: "GoPro 13",
    quantity: 1,
    status: "in-use",
    type: "gear",
    serial_number: "GP-ABC123",
    purchase_price: 299.99,
  });
  const res = await handler(new Request(`http://localhost/parts/${id}`));
  const html = await res.text();
  assertStringIncludes(html, "GP-ABC123");
  assertStringIncludes(html, "299.99");
});
