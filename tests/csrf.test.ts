import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { makeHandler } from "../main.ts";
import { createPart, getPart, initDb, listParts } from "../db.ts";

function makeApp() {
  const db = initDb(":memory:");
  return { db, handler: makeHandler(db) };
}

Deno.test("same-origin form POST is accepted", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Motor");
  form.set("quantity", "1");
  form.set("status", "unused");
  const res = await handler(
    new Request("http://localhost/parts", {
      method: "POST",
      body: form,
      headers: { "Origin": "http://localhost" },
    }),
  );
  assertEquals(res.status, 303);
  assertEquals(listParts(db).length, 1);
});

Deno.test("form POST without an Origin header is accepted (curl, same-origin tools)", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Motor");
  form.set("quantity", "1");
  form.set("status", "unused");
  const res = await handler(
    new Request("http://localhost/parts", { method: "POST", body: form }),
  );
  assertEquals(res.status, 303);
  assertEquals(listParts(db).length, 1);
});

Deno.test("cross-origin form POST is rejected with 403", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Evil Insert");
  const res = await handler(
    new Request("http://localhost/parts", {
      method: "POST",
      body: form,
      headers: { "Origin": "http://evil.example" },
    }),
  );
  assertEquals(res.status, 403);
  assertEquals(listParts(db).length, 0);
});

Deno.test("opaque (null) origin form POST is rejected with 403", async () => {
  const { handler } = makeApp();
  const form = new FormData();
  form.set("name", "Evil Insert");
  const res = await handler(
    new Request("http://localhost/parts", {
      method: "POST",
      body: form,
      headers: { "Origin": "null" },
    }),
  );
  assertEquals(res.status, 403);
});

Deno.test("cross-origin POST on the delete route cannot delete the part", async () => {
  const { db, handler } = makeApp();
  const id = createPart(db, { name: "Valuable Part", quantity: 1, status: "unused" });
  const res = await handler(
    new Request(`http://localhost/parts/${id}/delete`, {
      method: "POST",
      headers: { "Origin": "http://evil.example" },
    }),
  );
  assertEquals(res.status, 403);
  assertEquals(getPart(db, id)?.name, "Valuable Part");
});

Deno.test("proxy scenario: origin matching the request host is accepted", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Motor");
  form.set("quantity", "1");
  form.set("status", "unused");
  const res = await handler(
    new Request("http://inventory.407.lol/parts", {
      method: "POST",
      body: form,
      headers: { "Origin": "http://inventory.407.lol" },
    }),
  );
  assertEquals(res.status, 303);
  assertEquals(listParts(db).length, 1);
});

Deno.test("same-host origin with a different scheme is rejected", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Evil Insert");
  const res = await handler(
    new Request("http://localhost/parts", {
      method: "POST",
      body: form,
      headers: { "Origin": "https://localhost" },
    }),
  );
  assertEquals(res.status, 403);
  assertEquals(listParts(db).length, 0);
});

Deno.test("proxied HTTPS request behind X-Forwarded-Proto: https with matching origin accepted", async () => {
  const { db, handler } = makeApp();
  const form = new FormData();
  form.set("name", "Motor");
  form.set("quantity", "1");
  form.set("status", "unused");
  const res = await handler(
    new Request("http://inventory.407.lol/parts", {
      method: "POST",
      body: form,
      headers: {
        "Origin": "https://inventory.407.lol",
        "X-Forwarded-Proto": "https",
      },
    }),
  );
  assertEquals(res.status, 303);
  assertEquals(listParts(db).length, 1);
});
