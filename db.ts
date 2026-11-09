import { DB, type QueryParameter } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

export type PartStatus = "unused" | "in-use" | "broken" | "retired" | "lost";
export type PartType =
  | "motor"
  | "fc"
  | "esc"
  | "vtx"
  | "frame"
  | "camera"
  | "antenna"
  | "battery"
  | "gear"
  | "other";

export interface Part {
  id: number;
  name: string;
  status: PartStatus;
  type: PartType | null;
  notes: string | null;
  specs: string | null;
  quantity: number;
  photo_path: string | null;
  serial_number: string | null;
  warranty_expiry: string | null;
  purchase_date: string | null;
  purchase_price: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * A flyable aircraft. A build is its own entity with its own row — it is not
 * a part with a special type. Its components are held in the `build_parts`
 * join table, which references parts by id.
 */
export interface Build {
  id: number;
  name: string;
  status: PartStatus;
  /** Free-text build class, e.g. "5-inch freestyle". Not a closed enum. */
  class: string | null;
  notes: string | null;
  specs: string | null;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

/** One component of a build — a row in the BOM join. */
export interface BuildComponent {
  part_id: number;
  name: string;
  type: PartType | null;
  quantity: number;
  role: string | null;
  notes: string | null;
}

export interface HistoryEntry {
  id: number;
  part_id: number;
  action: string;
  from_build_id: number | null;
  to_build_id: number | null;
  old_status: string | null;
  new_status: string | null;
  quantity_delta: number | null;
  notes: string | null;
  created_at: string;
}

export interface BuildHistoryEntry {
  id: number;
  build_id: number;
  action: string;
  old_status: string | null;
  new_status: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreatePartInput {
  name: string;
  quantity: number;
  status: PartStatus;
  type?: PartType | null;
  notes?: string;
  specs?: string;
  parent_id?: number | null;
  serial_number?: string | null;
  warranty_expiry?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
}

export interface UpdatePartInput {
  name?: string;
  status?: PartStatus;
  type?: PartType | null;
  notes?: string;
  specs?: string;
  quantity?: number;
  photo_path?: string;
  serial_number?: string | null;
  warranty_expiry?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
}

export function runMigrations(db: DB): void {
  const columns = db.query<[number, string, string, number, string | null, number]>(
    "PRAGMA table_info(parts)",
  ).map((row) => row[1]);

  if (!columns.includes("type")) {
    db.execute("ALTER TABLE parts ADD COLUMN type TEXT");
  }
  if (!columns.includes("specs")) {
    db.execute("ALTER TABLE parts ADD COLUMN specs TEXT");
  }
  if (!columns.includes("serial_number")) {
    db.execute("ALTER TABLE parts ADD COLUMN serial_number TEXT");
  }
  if (!columns.includes("warranty_expiry")) {
    db.execute("ALTER TABLE parts ADD COLUMN warranty_expiry TEXT");
  }
  if (!columns.includes("purchase_date")) {
    db.execute("ALTER TABLE parts ADD COLUMN purchase_date TEXT");
  }
  if (!columns.includes("purchase_price")) {
    db.execute("ALTER TABLE parts ADD COLUMN purchase_price REAL");
  }

  migrateToBuildsModel(db);
}

/**
 * Migrate from the v1 model (builds are parts with type='craft', components
 * are child parts via parent_id) to the v2 model (builds are their own
 * entities, components live in the `build_parts` join).
 *
 * The migration is idempotent — a database already in the v2 shape has no
 * `parent_id` column and is left alone.
 *
 * For each craft part, a build row is created with the same id, so existing
 * references to that id (e.g. flowchart's `craft_inventory_id`) keep
 * pointing at the same thing.
 *
 * For each installed child, the child's quantity is folded back into the
 * stock row for that part — the v1 model decremented the stock row and
 * created a separate child row, so the part's total owned is the sum of both.
 * The child's part row is then removed and replaced by a `build_parts` row.
 */
export function migrateToBuildsModel(db: DB): void {
  const partColumns = db.query<[number, string, string, number, string | null, number]>(
    "PRAGMA table_info(parts)",
  ).map((row) => row[1]);
  if (!partColumns.includes("parent_id")) return; // already v2

  const historyColumns = db.query<[number, string, string, number, string | null, number]>(
    "PRAGMA table_info(part_history)",
  ).map((row) => row[1]);

  // The v2 tables may not exist yet — this function runs standalone on an
  // existing v1 database, before initDb's schema is applied.
  db.execute(`
    CREATE TABLE IF NOT EXISTS builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in-use',
      class TEXT,
      notes TEXT,
      specs TEXT,
      photo_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS build_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id INTEGER NOT NULL REFERENCES builds(id),
      part_id INTEGER NOT NULL REFERENCES parts(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      role TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS build_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id INTEGER NOT NULL REFERENCES builds(id),
      action TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.transaction(() => {
    // 1. Craft parts become builds, keeping their id.
    const crafts = db.query<
      [number, string, string, string | null, string | null, string | null, string, string]
    >(
      `SELECT id, name, status, notes, specs, photo_path, created_at, updated_at
       FROM parts WHERE type = 'craft'`,
    );
    for (const [id, name, status, notes, specs, photo_path, created, updated] of crafts) {
      db.query(
        `INSERT INTO builds (id, name, status, notes, specs, photo_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, status, notes, specs, photo_path, created, updated],
      );
    }

    // 2. Installed children become build_parts rows; their quantity is folded
    //    back into the stock row so the part's quantity is the total owned.
    const children = db.query<
      [number, string, string | null, number, number, string | null, string | null]
    >(
      `SELECT id, name, type, quantity, parent_id, notes, specs
       FROM parts WHERE parent_id IS NOT NULL AND type <> 'craft'`,
    );

    // Stock rows keyed by name+type, so an installed copy can find the row it
    // was drawn from. This mirrors how the v1 allocation engine grouped them.
    const stockByNameType = new Map<string, { id: number; quantity: number }>();
    for (
      const row of db.query<[number, string, string | null, number]>(
        `SELECT id, name, type, quantity FROM parts
       WHERE parent_id IS NULL AND type <> 'craft'`,
      )
    ) {
      const key = `${row[2] ?? ""}\u0000${row[1]}`;
      const existing = stockByNameType.get(key);
      if (!existing) {
        stockByNameType.set(key, { id: row[0], quantity: row[3] });
      } else {
        // Two stock rows for the same name+type: merge them so the part has
        // one row and one quantity, matching the v2 one-row-per-part model.
        db.query("UPDATE parts SET quantity = ? WHERE id = ?", [
          existing.quantity + row[3],
          existing.id,
        ]);
        existing.quantity += row[3];
        db.query("DELETE FROM parts WHERE id = ?", [row[0]]);
      }
    }

    for (const [childId, name, type, quantity, buildId, notes, specs] of children) {
      const key = `${type ?? ""}\u0000${name}`;
      const stock = stockByNameType.get(key);
      if (stock) {
        // Fold the installed quantity back into the stock row.
        db.query("UPDATE parts SET quantity = quantity + ? WHERE id = ?", [quantity, stock.id]);
        stock.quantity += quantity;
        db.query(
          `INSERT INTO build_parts (build_id, part_id, quantity, notes)
           VALUES (?, ?, ?, ?)`,
          [buildId, stock.id, quantity, notes],
        );
      } else {
        // No stock row — this part existed only as an installed copy. Promote
        // the child row to a top-level part and reference it. The row stays:
        // build_parts now points at it.
        db.query("UPDATE parts SET parent_id = NULL WHERE id = ?", [childId]);
        db.query(
          `INSERT INTO build_parts (build_id, part_id, quantity, notes)
           VALUES (?, ?, ?, ?)`,
          [buildId, childId, quantity, notes],
        );
        continue; // keep the promoted row
      }
      // The child row is superseded by the build_parts join.
      db.query("DELETE FROM parts WHERE id = ?", [childId]);
      db.query("DELETE FROM part_history WHERE part_id = ?", [childId]);
    }

    // 3. Craft history becomes build history. This must run before the craft
    //    rows are deleted, since it joins history to them.
    //
    //    The history table is rebuilt rather than renamed: a renamed column
    //    keeps its REFERENCES clause, and from_build_id / to_build_id must
    //    point at builds, not parts.
    if (historyColumns.includes("from_parent_id")) {
      db.execute(`
        CREATE TABLE part_history_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          part_id INTEGER NOT NULL REFERENCES parts(id),
          action TEXT NOT NULL,
          from_build_id INTEGER,
          to_build_id INTEGER,
          old_status TEXT,
          new_status TEXT,
          quantity_delta INTEGER,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.execute(`
        INSERT INTO part_history_v2
          (id, part_id, action, from_build_id, to_build_id,
           old_status, new_status, quantity_delta, notes, created_at)
        SELECT id, part_id, action, from_parent_id, to_parent_id,
           old_status, new_status, quantity_delta, notes, created_at
        FROM part_history
      `);
      db.execute("DROP TABLE part_history");
      db.execute("ALTER TABLE part_history_v2 RENAME TO part_history");
      db.execute(
        `INSERT INTO build_history (build_id, action, old_status, new_status, notes, created_at)
         SELECT p.id, h.action, h.old_status, h.new_status, h.notes, h.created_at
         FROM part_history h JOIN parts p ON p.id = h.part_id
         WHERE p.type = 'craft'`,
      );
      db.execute(
        `DELETE FROM part_history WHERE part_id IN (SELECT id FROM parts WHERE type = 'craft')`,
      );
    }

    // 4. Craft rows are now builds — remove them from parts.
    for (const [id] of crafts) {
      db.query("DELETE FROM parts WHERE id = ?", [id]);
    }

    // 5. Drop the containment column — parts relate to builds through the join.
    db.execute("ALTER TABLE parts DROP COLUMN parent_id");
  });
}

export function initDb(path: string): DB {
  const db = new DB(path);
  db.execute(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unused',
      type TEXT,
      notes TEXT,
      specs TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      photo_path TEXT,
      serial_number TEXT,
      warranty_expiry TEXT,
      purchase_date TEXT,
      purchase_price REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS part_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL REFERENCES parts(id),
      action TEXT NOT NULL,
      from_build_id INTEGER,
      to_build_id INTEGER,
      old_status TEXT,
      new_status TEXT,
      quantity_delta INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS builds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in-use',
      class TEXT,
      notes TEXT,
      specs TEXT,
      photo_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS build_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id INTEGER NOT NULL REFERENCES builds(id),
      part_id INTEGER NOT NULL REFERENCES parts(id),
      quantity INTEGER NOT NULL DEFAULT 1,
      role TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS build_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id INTEGER NOT NULL REFERENCES builds(id),
      action TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  runMigrations(db);
  return db;
}

export function createPart(db: DB, input: CreatePartInput): number {
  db.query(
    `INSERT INTO parts (name, quantity, status, type, notes, specs, serial_number, warranty_expiry, purchase_date, purchase_price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.quantity,
      input.status,
      input.type ?? null,
      input.notes ?? null,
      input.specs ?? null,
      input.serial_number ?? null,
      input.warranty_expiry ?? null,
      input.purchase_date ?? null,
      input.purchase_price ?? null,
    ],
  );
  const id = db.lastInsertRowId;
  db.query(
    `INSERT INTO part_history (part_id, action) VALUES (?, 'created')`,
    [id],
  );
  return id;
}

export function getPart(db: DB, id: number): Part | null {
  const rows = db.query<
    [
      number,
      string,
      string,
      string | null,
      string | null,
      string | null,
      number,
      string | null,
      string | null,
      string | null,
      string | null,
      number | null,
      string,
      string,
    ]
  >(
    `SELECT id, name, status, type, notes, specs, quantity, photo_path, serial_number, warranty_expiry, purchase_date, purchase_price, created_at, updated_at
     FROM parts WHERE id = ?`,
    [id],
  );
  if (rows.length === 0) return null;
  const [
    pid,
    name,
    status,
    type,
    notes,
    specs,
    quantity,
    photo_path,
    serial_number,
    warranty_expiry,
    purchase_date,
    purchase_price,
    created_at,
    updated_at,
  ] = rows[0];
  return {
    id: pid,
    name,
    status: status as PartStatus,
    type: type as PartType | null,
    notes,
    specs,
    quantity,
    photo_path,
    serial_number,
    warranty_expiry,
    purchase_date,
    purchase_price,
    created_at,
    updated_at,
  };
}

export interface PartFilter {
  type?: PartType;
  status?: PartStatus;
  q?: string;
}

export function listParts(db: DB, filter: PartFilter = {}): Part[] {
  type Row = [
    number,
    string,
    string,
    string | null,
    string | null,
    string | null,
    number,
    string | null,
    string | null,
    string | null,
    string | null,
    number | null,
    string,
    string,
  ];
  const select =
    `SELECT id, name, status, type, notes, specs, quantity, photo_path, serial_number, warranty_expiry, purchase_date, purchase_price, created_at, updated_at FROM parts`;

  const conditions: string[] = [];
  const params: QueryParameter[] = [];

  if (filter.type !== undefined) {
    conditions.push("type = ?");
    params.push(filter.type);
  }
  if (filter.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.q !== undefined) {
    conditions.push("instr(lower(name), lower(?)) > 0");
    params.push(filter.q);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows: Row[] = db.query(`${select}${where} ORDER BY name`, params);

  return rows.map((
    [
      id,
      name,
      status,
      partType,
      notes,
      specs,
      quantity,
      photo_path,
      serial_number,
      warranty_expiry,
      purchase_date,
      purchase_price,
      created_at,
      updated_at,
    ],
  ) => ({
    id,
    name,
    status: status as PartStatus,
    type: partType as PartType | null,
    notes,
    specs,
    quantity,
    photo_path,
    serial_number,
    warranty_expiry,
    purchase_date,
    purchase_price,
    created_at,
    updated_at,
  }));
}

export function updatePart(db: DB, id: number, input: UpdatePartInput): void {
  const current = getPart(db, id);
  if (!current) throw new Error(`Part ${id} not found`);

  const name = input.name ?? current.name;
  const status = input.status ?? current.status;
  const type = "type" in input ? (input.type ?? null) : current.type;
  const notes = "notes" in input ? (input.notes ?? null) : current.notes;
  const specs = "specs" in input
    ? (input.specs?.replace(/\r\n/g, "\n").trim() || null)
    : current.specs;
  const quantity = input.quantity ?? current.quantity;
  const photo_path = "photo_path" in input ? (input.photo_path ?? null) : current.photo_path;
  const serial_number = "serial_number" in input
    ? (input.serial_number ?? null)
    : current.serial_number;
  const warranty_expiry = "warranty_expiry" in input
    ? (input.warranty_expiry ?? null)
    : current.warranty_expiry;
  const purchase_date = "purchase_date" in input
    ? (input.purchase_date ?? null)
    : current.purchase_date;
  const purchase_price = "purchase_price" in input
    ? (input.purchase_price ?? null)
    : current.purchase_price;

  db.query(
    `UPDATE parts SET name=?, status=?, type=?, notes=?, specs=?, quantity=?, photo_path=?,
       serial_number=?, warranty_expiry=?, purchase_date=?, purchase_price=?, updated_at=datetime('now')
     WHERE id=?`,
    [
      name,
      status,
      type,
      notes,
      specs,
      quantity,
      photo_path,
      serial_number,
      warranty_expiry,
      purchase_date,
      purchase_price,
      id,
    ],
  );
  db.query(
    `INSERT INTO part_history (part_id, action, old_status, new_status, quantity_delta)
     VALUES (?, 'updated', ?, ?, ?)`,
    [id, current.status, status, quantity - current.quantity],
  );
}

// ─── Builds ──────────────────────────────────────────────────────────────────

export interface CreateBuildInput {
  name: string;
  status?: PartStatus;
  class?: string | null;
  notes?: string | null;
  specs?: string | null;
}

export function createBuild(db: DB, input: CreateBuildInput): number {
  if (!input.name.trim()) throw new Error("Name is required");
  db.query(
    `INSERT INTO builds (name, status, class, notes, specs) VALUES (?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      input.status ?? "in-use",
      input.class ?? null,
      input.notes ?? null,
      input.specs ?? null,
    ],
  );
  const id = db.lastInsertRowId;
  db.query(
    `INSERT INTO build_history (build_id, action, new_status) VALUES (?, 'created', ?)`,
    [id, input.status ?? "in-use"],
  );
  return id;
}

export interface BuildFilter {
  status?: PartStatus;
  q?: string;
}

export function listBuilds(db: DB, filter: BuildFilter = {}): Build[] {
  type Row = [
    number,
    string,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    string,
  ];
  const conditions: string[] = [];
  const params: QueryParameter[] = [];

  if (filter.status !== undefined) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.q !== undefined) {
    conditions.push("instr(lower(name), lower(?)) > 0");
    params.push(filter.q);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.query<Row>(
    `SELECT id, name, status, class, notes, specs, photo_path, created_at, updated_at
     FROM builds${where} ORDER BY name`,
    params,
  );
  return rows.map(
    ([id, name, status, buildClass, notes, specs, photo_path, created_at, updated_at]) => ({
      id,
      name,
      status: status as PartStatus,
      class: buildClass,
      notes,
      specs,
      photo_path,
      created_at,
      updated_at,
    }),
  );
}

export function getBuild(db: DB, id: number): Build | null {
  const rows = db.query<
    [
      number,
      string,
      string,
      string | null,
      string | null,
      string | null,
      string | null,
      string,
      string,
    ]
  >(
    `SELECT id, name, status, class, notes, specs, photo_path, created_at, updated_at
     FROM builds WHERE id = ?`,
    [id],
  );
  if (rows.length === 0) return null;
  const [bid, name, status, buildClass, notes, specs, photo_path, created, updated] = rows[0];
  return {
    id: bid,
    name,
    status: status as PartStatus,
    class: buildClass,
    notes,
    specs,
    photo_path,
    created_at: created,
    updated_at: updated,
  };
}

/** The build's BOM — one row per component, in join order. */
export function listBuildComponents(db: DB, buildId: number): BuildComponent[] {
  type Row = [number, string, string | null, number, string | null, string | null];
  const rows = db.query<Row>(
    `SELECT p.id, p.name, p.type, bp.quantity, bp.role, bp.notes
     FROM build_parts bp JOIN parts p ON p.id = bp.part_id
     WHERE bp.build_id = ? ORDER BY p.name`,
    [buildId],
  );
  return rows.map(([part_id, name, type, quantity, role, notes]) => ({
    part_id,
    name,
    type: type as PartType | null,
    quantity,
    role,
    notes,
  }));
}

export function getBuildHistory(db: DB, buildId: number): BuildHistoryEntry[] {
  type Row = [number, number, string, string | null, string | null, string | null, string];
  const rows = db.query<Row>(
    `SELECT id, build_id, action, old_status, new_status, notes, created_at
     FROM build_history WHERE build_id = ? ORDER BY id ASC`,
    [buildId],
  );
  return rows.map(([id, build_id, action, old_status, new_status, notes, created_at]) => ({
    id,
    build_id,
    action,
    old_status,
    new_status,
    notes,
    created_at,
  }));
}

/**
 * Install a part into a build.
 *
 * The part's own quantity is the total owned and is NOT changed — the BOM
 * join records how many of it this build uses. Free stock is therefore
 * `quantity - (sum of quantities allocated across all builds)`.
 *
 * Throws if the part does not exist or the build does not exist.
 */
export function addBuildComponent(
  db: DB,
  buildId: number,
  partId: number,
  quantity: number,
  role?: string | null,
  notes?: string | null,
): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`quantity must be ≥ 1, got ${quantity}`);
  }
  if (!getBuild(db, buildId)) throw new Error(`Build ${buildId} not found`);
  if (!getPart(db, partId)) throw new Error(`Part ${partId} not found`);

  db.query(
    `INSERT INTO build_parts (build_id, part_id, quantity, role, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [buildId, partId, quantity, role ?? null, notes ?? null],
  );
}

/** Remove a component from a build. */
export function removeBuildComponent(db: DB, buildId: number, partId: number): void {
  db.query("DELETE FROM build_parts WHERE build_id = ? AND part_id = ?", [buildId, partId]);
}

// ─── Part history ────────────────────────────────────────────────────────────

export function getPartHistory(db: DB, partId: number): HistoryEntry[] {
  const rows = db.query<
    [
      number,
      number,
      string,
      number | null,
      number | null,
      string | null,
      string | null,
      number | null,
      string | null,
      string,
    ]
  >(
    `SELECT id, part_id, action, from_build_id, to_build_id,
            old_status, new_status, quantity_delta, notes, created_at
     FROM part_history WHERE part_id = ? ORDER BY id ASC`,
    [partId],
  );
  return rows.map(
    (
      [
        id,
        part_id,
        action,
        from_build_id,
        to_build_id,
        old_status,
        new_status,
        quantity_delta,
        notes,
        created_at,
      ],
    ) => ({
      id,
      part_id,
      action,
      from_build_id,
      to_build_id,
      old_status,
      new_status,
      quantity_delta,
      notes,
      created_at,
    }),
  );
}

export interface AssembleSelection {
  part_id: number;
  qty: number;
}

export interface AssembleBuildInput {
  name: string;
  status?: PartStatus;
  class?: string | null;
  specs?: string;
  notes?: string;
  selections: AssembleSelection[];
}

/**
 * Pick components from stock and create a new build from them.
 *
 * A part's quantity is the total owned and is conserved — installing a part
 * into a build records the allocation in the BOM join, it does not decrement
 * the part or create a copy of it.
 *
 * Throws on any validation failure; the entire operation is rolled back.
 * Returns the new build's id.
 */
export function assembleBuild(db: DB, input: AssembleBuildInput): number {
  if (!input.name.trim()) throw new Error("Name is required");
  if (input.selections.length === 0) throw new Error("At least one part must be selected");

  // Validate individual qty values first.
  for (const sel of input.selections) {
    if (!Number.isInteger(sel.qty) || sel.qty < 1) {
      throw new Error(`qty must be ≥ 1, got ${sel.qty}`);
    }
  }

  // Accumulate totals per part_id so duplicate entries can't individually pass
  // validation while collectively overdrawing stock.
  const totals = new Map<number, number>();
  for (const sel of input.selections) {
    totals.set(sel.part_id, (totals.get(sel.part_id) ?? 0) + sel.qty);
  }

  for (const [partId, totalQty] of totals) {
    const part = getPart(db, partId);
    if (!part) throw new Error(`Part ${partId} not found`);
    const free = freeQuantity(db, partId);
    if (free < totalQty) {
      throw new Error(
        `Not enough free stock for "${part.name}": have ${free}, need ${totalQty}`,
      );
    }
  }

  let buildId!: number;

  db.transaction(() => {
    db.query(
      `INSERT INTO builds (name, status, class, specs, notes) VALUES (?, ?, ?, ?, ?)`,
      [
        input.name.trim(),
        input.status ?? "in-use",
        input.class ?? null,
        input.specs ?? null,
        input.notes ?? null,
      ],
    );
    buildId = db.lastInsertRowId;

    db.query(
      `INSERT INTO build_history (build_id, action, new_status) VALUES (?, 'created', ?)`,
      [buildId, input.status ?? "in-use"],
    );

    for (const sel of input.selections) {
      db.query(
        `INSERT INTO build_parts (build_id, part_id, quantity) VALUES (?, ?, ?)`,
        [buildId, sel.part_id, sel.qty],
      );
    }
  });

  return buildId;
}

/**
 * How many of a part are not allocated to any build.
 *
 * A part's `quantity` is the total owned; the BOM join holds what each build
 * uses. This is a real join on part_id — no name matching — so renaming a
 * part cannot break it.
 */
export function freeQuantity(db: DB, partId: number): number {
  const part = getPart(db, partId);
  if (!part) return 0;
  const allocated = db.query<[number]>(
    "SELECT COALESCE(SUM(quantity), 0) FROM build_parts WHERE part_id = ?",
    [partId],
  )[0]?.[0] ?? 0;
  return part.quantity - allocated;
}

export interface InventorySummary {
  total_parts: number;
  total_quantity: number;
  inventory_value: number;
  low_stock: number;
  installed_in_builds: number;
}

/**
 * Headline figures for the inventory summary card.
 *
 * Builds are not parts, so they are not counted here at all — they live in
 * their own table.
 *
 * `low_stock` counts distinct name+type groups whose summed quantity across
 * all their rows is at or below the threshold — a part split over several
 * rows is still one part, and same-name parts of different types are
 * separate groups (matching `allocationForPart`).
 *
 * `installed_in_builds` counts BOM rows — how many components are installed
 * across all builds.
 */
export function queryInventorySummary(db: DB, lowStockThreshold = 3): InventorySummary {
  type TotalsRow = [number, number, number];
  const totals = db.query<TotalsRow>(
    `SELECT COUNT(*), COALESCE(SUM(quantity), 0), COALESCE(SUM(purchase_price * quantity), 0)
     FROM parts`,
  )[0] ?? [0, 0, 0];

  type LowStockRow = [number];
  const lowStock = db.query<LowStockRow>(
    `SELECT COUNT(*) FROM (
       SELECT name FROM parts GROUP BY name, type HAVING SUM(quantity) <= ?
     )`,
    [lowStockThreshold],
  )[0]?.[0] ?? 0;

  type InstalledRow = [number];
  const installed = db.query<InstalledRow>(
    "SELECT COUNT(*) FROM build_parts",
  )[0]?.[0] ?? 0;

  return {
    total_parts: totals[0],
    total_quantity: totals[1],
    inventory_value: totals[2],
    low_stock: lowStock,
    installed_in_builds: installed,
  };
}

export interface StockAggregationRow {
  type: string | null;
  status: string;
  total_quantity: number;
  count: number;
}

/**
 * Aggregate parts by type × status — all types included (craft, gear, etc.).
 * Consumers filter as needed (e.g. exclude craft for the stock UI view).
 * Single source of truth shared by GET /api/stock and the /stock HTML page.
 */
export function queryStockRows(db: DB): StockAggregationRow[] {
  type Row = [string | null, string, number, number];
  const rows = db.query<Row>(
    `SELECT type, status, SUM(quantity) AS total_quantity, COUNT(*) AS count
     FROM parts
     GROUP BY type, status
     ORDER BY type, status`,
  );
  return rows.map(([type, status, total_quantity, count]) => ({
    type,
    status,
    total_quantity,
    count,
  }));
}

export { DB };
