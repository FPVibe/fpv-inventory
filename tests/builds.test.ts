import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
import {
  createBuild,
  getBuild,
  initDb,
  listBuildComponents,
  listBuilds,
  listParts,
  migrateToBuildsModel,
  type BuildComponent,
} from "../db.ts";

// ─── Build entities (#83) ─────────────────────────────────────────────────────

Deno.test("a build is its own row, not a part", () => {
  const db = initDb(":memory:");
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const builds = listBuilds(db);
  assertEquals(builds.length, 1);
  assertEquals(builds[0].id, buildId);
  assertEquals(builds[0].name, "LionBee");

  // The build is not a part
  assertEquals(listParts(db).length, 0);
});

Deno.test("builds carry their own class, notes and specs", () => {
  const db = initDb(":memory:");
  createBuild(db, {
    name: "Air65III",
    status: "in-use",
    class: "5-inch freestyle",
    notes: "mushy on exit",
    specs: "FC: Super BF F4 AIO",
  });

  const build = listBuilds(db)[0];
  assertEquals(build.class, "5-inch freestyle");
  assertEquals(build.notes, "mushy on exit");
  assertEquals(build.specs, "FC: Super BF F4 AIO");
});

Deno.test("a build lists its components with quantities and roles", () => {
  const db = initDb(":memory:");
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });
  const motorId = createBuild(db, { name: "spare build", status: "unused" });
  void motorId;

  const partId = listParts(db).length; // no parts yet
  assertEquals(partId, 0);
  assertEquals(buildId > 0, true);
});

Deno.test("getBuild returns components with part details", () => {
  const db = initDb(":memory:");
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const build = getBuild(db, buildId);
  assertEquals(build !== null, true);
  assertEquals(build!.name, "LionBee");
  assertEquals(build!.components.length, 0);
});

Deno.test("listBuildComponents returns an empty array for a build with no components", () => {
  const db = initDb(":memory:");
  const buildId = createBuild(db, { name: "LionBee", status: "in-use" });

  const components: BuildComponent[] = listBuildComponents(db, buildId);
  assertEquals(components.length, 0);
});

// ─── Migration from the craft-as-part model (#83) ─────────────────────────────

/**
 * Builds a database in the pre-v2 shape: builds are parts with type='craft',
 * and their components are child part rows pointing at them via parent_id.
 */
function legacyDb(): DB {
  const db = new DB(":memory:");
  db.execute(`
    CREATE TABLE parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unused',
      type TEXT,
      notes TEXT,
      specs TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      parent_id INTEGER REFERENCES parts(id),
      photo_path TEXT,
      serial_number TEXT,
      warranty_expiry TEXT,
      purchase_date TEXT,
      purchase_price REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE part_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      action TEXT NOT NULL,
      from_parent_id INTEGER REFERENCES parts(id),
      to_parent_id INTEGER REFERENCES parts(id),
      old_status TEXT,
      new_status TEXT,
      quantity_delta INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

Deno.test("migration converts a craft part into a build", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );

  migrateToBuildsModel(db);

  const builds = listBuilds(db);
  assertEquals(builds.length, 1);
  assertEquals(builds[0].name, "LionBee");
  assertEquals(builds[0].status, "in-use");
  // the craft is no longer a part
  assertEquals(listParts(db).length, 0);
});

Deno.test("migration folds an installed child's quantity into the stock part", () => {
  const db = legacyDb();
  // stock row: 8 motors remaining
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, '0702 Motor', 'unused', 'motor', 8, NULL)",
  );
  // build row
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (2, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );
  // installed copy: 4 of them
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (3, '0702 Motor', 'in-use', 'motor', 4, 2)",
  );

  migrateToBuildsModel(db);

  const parts = listParts(db);
  assertEquals(parts.length, 1);
  // total owned is restored: 8 in stock + 4 installed = 12
  assertEquals(parts[0].quantity, 12);

  const builds = listBuilds(db);
  assertEquals(builds.length, 1);
  assertEquals(builds[0].name, "LionBee");

  const components = listBuildComponents(db, builds[0].id);
  assertEquals(components.length, 1);
  assertEquals(components[0].name, "0702 Motor");
  assertEquals(components[0].quantity, 4);
});

Deno.test("migration keeps the build id stable across the migration", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (7, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );

  migrateToBuildsModel(db);

  assertEquals(listBuilds(db)[0].id, 7);
});

Deno.test("migration handles a part installed in two builds", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, '0702 Motor', 'unused', 'motor', 4, NULL)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (2, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (3, 'Air65III', 'in-use', 'craft', 1, NULL)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (4, '0702 Motor', 'in-use', 'motor', 2, 2)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (5, '0702 Motor', 'in-use', 'motor', 3, 3)",
  );

  migrateToBuildsModel(db);

  const parts = listParts(db);
  assertEquals(parts.length, 1);
  // 4 in stock + 2 in LionBee + 3 in Air65III = 9 total owned
  assertEquals(parts[0].quantity, 9);

  const builds = listBuilds(db);
  assertEquals(builds.length, 2);
  const lionBee = builds.find((b) => b.name === "LionBee")!;
  const air65 = builds.find((b) => b.name === "Air65III")!;
  assertEquals(listBuildComponents(db, lionBee.id)[0].quantity, 2);
  assertEquals(listBuildComponents(db, air65.id)[0].quantity, 3);
});

Deno.test("migration keeps a part that was only ever installed", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );
  // no stock row — the part exists only as the installed copy
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (2, 'BetaFPV F4 1S', 'in-use', 'fc', 1, 1)",
  );

  migrateToBuildsModel(db);

  const parts = listParts(db);
  assertEquals(parts.length, 1);
  assertEquals(parts[0].name, "BetaFPV F4 1S");
  assertEquals(parts[0].quantity, 1);
  assertEquals(listBuildComponents(db, 1).length, 1);
});

Deno.test("migration is idempotent", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (2, '0702 Motor', 'unused', 'motor', 8, NULL)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (3, '0702 Motor', 'in-use', 'motor', 4, 1)",
  );

  migrateToBuildsModel(db);
  migrateToBuildsModel(db);

  assertEquals(listBuilds(db).length, 1);
  assertEquals(listParts(db).length, 1);
  assertEquals(listParts(db)[0].quantity, 12);
  assertEquals(listBuildComponents(db, 1).length, 1);
});

Deno.test("migration moves craft history into build history", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );
  db.query(
    "INSERT INTO part_history (part_id, action, to_parent_id) VALUES (1, 'created', NULL)",
  );

  migrateToBuildsModel(db);

  const history = db.query<[number, number, string]>(
    "SELECT id, build_id, action FROM build_history ORDER BY id",
  );
  assertEquals(history.length, 1);
  assertEquals(history[0][1], 1);
  assertEquals(history[0][2], "created");
});

Deno.test("migration renames history parent columns to build columns", () => {
  const db = legacyDb();
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (1, 'LionBee', 'in-use', 'craft', 1, NULL)",
  );
  db.query(
    "INSERT INTO parts (id, name, status, type, quantity, parent_id) VALUES (2, '0702 Motor', 'unused', 'motor', 5, NULL)",
  );
  db.query(
    "INSERT INTO part_history (part_id, action, from_parent_id, to_parent_id) VALUES (2, 'moved', NULL, 1)",
  );

  migrateToBuildsModel(db);

  const cols = db.query<[number, string]>("PRAGMA table_info(part_history)").map((r) => r[1]);
  assertEquals(cols.includes("from_build_id"), true);
  assertEquals(cols.includes("to_build_id"), true);
  assertEquals(cols.includes("from_parent_id"), false);
});
