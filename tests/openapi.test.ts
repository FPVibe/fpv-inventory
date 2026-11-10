import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { API_ROUTES } from "../api.ts";
import openapiSpec from "../openapi.json" with { type: "json" };

// The spec must document exactly the routes the server serves — no more, no
// less. This is the guard that stops the drift the issue was filed about.

Deno.test("every registered route is documented in openapi.json", () => {
  const specPaths = Object.keys(openapiSpec.paths).sort();
  const routePaths = API_ROUTES.map((r) => r.specPath).sort();
  assertEquals(routePaths, specPaths);
});

Deno.test("every documented path is served by a registered route", () => {
  const specPaths = new Set(Object.keys(openapiSpec.paths));
  for (const route of API_ROUTES) {
    assertEquals(
      specPaths.has(route.specPath),
      true,
      `route ${route.specPath} is served but not documented`,
    );
  }
});

Deno.test("no duplicate route paths", () => {
  const paths = API_ROUTES.map((r) => r.specPath);
  assertEquals(paths.length, new Set(paths).size);
});

Deno.test("no duplicate operationIds in the spec", () => {
  const ids: string[] = [];
  for (const path of Object.values(openapiSpec.paths) as Record<string, unknown>[]) {
    for (const op of Object.values(path)) {
      const id = (op as { operationId?: string }).operationId;
      if (id) ids.push(id);
    }
  }
  assertEquals(ids.length, new Set(ids).size);
});

Deno.test("every $ref in the spec resolves to a declared schema or response", () => {
  const refs: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (k === "$ref" && typeof v === "string") refs.push(v);
      else walk(v);
    }
  };
  walk(openapiSpec);

  const components = openapiSpec.components as {
    schemas: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
  for (const ref of refs) {
    const m = ref.match(/^#\/components\/(schemas|responses)\/(.+)$/);
    assertEquals(m !== null, true, `unexpected $ref form: ${ref}`);
    const group = m![1] as "schemas" | "responses";
    const name = m![2];
    assertEquals(
      name in components[group],
      true,
      `dangling $ref: ${ref}`,
    );
  }
});

Deno.test("every path in the spec has a get operation", () => {
  for (const [path, ops] of Object.entries(openapiSpec.paths)) {
    assertEquals(
      "get" in (ops as Record<string, unknown>),
      true,
      `path ${path} has no get operation`,
    );
  }
});

Deno.test("the /api/parts spec does not advertise the removed parent_id filter", () => {
  const params = (
    openapiSpec.paths["/api/parts"].get.parameters as { name: string }[]
  ).map((p) => p.name);
  assertEquals(params.includes("parent_id"), false);
});

Deno.test("the HistoryEntry schema describes the v2 history payload", () => {
  const schemas = openapiSpec.components.schemas as Record<string, unknown>;
  const entry = schemas.HistoryEntry as { properties: Record<string, { enum?: string[] }> };
  assertEquals("from_build_id" in entry.properties, true);
  assertEquals("to_build_id" in entry.properties, true);
  assertEquals("from_parent_id" in entry.properties, false);
  assertEquals("to_parent_id" in entry.properties, false);
  for (const action of ["created", "updated", "moved", "installed", "removed"]) {
    assertEquals(entry.properties.action.enum!.includes(action), true);
  }
});
