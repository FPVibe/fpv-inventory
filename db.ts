import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";

export type PartStatus = "unused" | "in-use" | "broken" | "retired" | "lost";

export interface Part {
  id: number;
  name: string;
  status: PartStatus;
  notes: string | null;
  quantity: number;
  parent_id: number | null;
  photo_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface HistoryEntry {
  id: number;
  part_id: number;
  action: string;
  from_parent_id: number | null;
  to_parent_id: number | null;
  old_status: string | null;
  new_status: string | null;
  quantity_delta: number | null;
  notes: string | null;
  created_at: string;
}

export interface CreatePartInput {
  name: string;
  quantity: number;
  status: PartStatus;
  notes?: string;
  parent_id?: number | null;
}

export interface UpdatePartInput {
  name?: string;
  status?: PartStatus;
  notes?: string;
  quantity?: number;
  photo_path?: string;
}

export function initDb(path: string): DB {
  const db = new DB(path);
  db.execute(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unused',
      notes TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      parent_id INTEGER REFERENCES parts(id),
      photo_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS part_history (
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

export function createPart(db: DB, input: CreatePartInput): number {
  db.query(
    `INSERT INTO parts (name, quantity, status, notes, parent_id)
     VALUES (?, ?, ?, ?, ?)`,
    [input.name, input.quantity, input.status, input.notes ?? null, input.parent_id ?? null]
  );
  const id = db.lastInsertRowId;
  db.query(
    `INSERT INTO part_history (part_id, action, to_parent_id)
     VALUES (?, 'created', ?)`,
    [id, input.parent_id ?? null]
  );
  return id;
}

export function getPart(db: DB, id: number): Part | null {
  const rows = db.query<
    [number, string, string, string | null, number, number | null, string | null, string, string]
  >(
    `SELECT id, name, status, notes, quantity, parent_id, photo_path, created_at, updated_at
     FROM parts WHERE id = ?`,
    [id]
  );
  if (rows.length === 0) return null;
  const [pid, name, status, notes, quantity, parent_id, photo_path, created_at, updated_at] =
    rows[0];
  return { id: pid, name, status: status as PartStatus, notes, quantity, parent_id, photo_path, created_at, updated_at };
}

export function listParts(db: DB, parent_id?: number | null): Part[] {
  let rows: [number, string, string, string | null, number, number | null, string | null, string, string][];
  if (parent_id === undefined) {
    rows = db.query(
      `SELECT id, name, status, notes, quantity, parent_id, photo_path, created_at, updated_at
       FROM parts ORDER BY name`
    );
  } else if (parent_id === null) {
    rows = db.query(
      `SELECT id, name, status, notes, quantity, parent_id, photo_path, created_at, updated_at
       FROM parts WHERE parent_id IS NULL ORDER BY name`
    );
  } else {
    rows = db.query(
      `SELECT id, name, status, notes, quantity, parent_id, photo_path, created_at, updated_at
       FROM parts WHERE parent_id = ? ORDER BY name`,
      [parent_id]
    );
  }
  return rows.map(([id, name, status, notes, quantity, parent_id, photo_path, created_at, updated_at]) => ({
    id,
    name,
    status: status as PartStatus,
    notes,
    quantity,
    parent_id,
    photo_path,
    created_at,
    updated_at,
  }));
}

export function updatePart(db: DB, id: number, input: UpdatePartInput): void {
  const current = getPart(db, id);
  if (!current) throw new Error(`Part ${id} not found`);

  const name = input.name ?? current.name;
  const status = input.status ?? current.status;
  const notes = "notes" in input ? (input.notes ?? null) : current.notes;
  const quantity = input.quantity ?? current.quantity;
  const photo_path = "photo_path" in input ? (input.photo_path ?? null) : current.photo_path;

  db.query(
    `UPDATE parts SET name=?, status=?, notes=?, quantity=?, photo_path=?, updated_at=datetime('now')
     WHERE id=?`,
    [name, status, notes, quantity, photo_path, id]
  );
  db.query(
    `INSERT INTO part_history (part_id, action, old_status, new_status, quantity_delta)
     VALUES (?, 'updated', ?, ?, ?)`,
    [id, current.status, status, quantity - current.quantity]
  );
}

export function movePart(db: DB, id: number, newParentId: number | null, notes?: string): void {
  const current = getPart(db, id);
  if (!current) throw new Error(`Part ${id} not found`);

  db.query(
    `UPDATE parts SET parent_id=?, updated_at=datetime('now') WHERE id=?`,
    [newParentId, id]
  );
  db.query(
    `INSERT INTO part_history (part_id, action, from_parent_id, to_parent_id, notes)
     VALUES (?, 'moved', ?, ?, ?)`,
    [id, current.parent_id, newParentId, notes ?? null]
  );
}

export function getPartHistory(db: DB, partId: number): HistoryEntry[] {
  const rows = db.query<
    [number, number, string, number | null, number | null, string | null, string | null, number | null, string | null, string]
  >(
    `SELECT id, part_id, action, from_parent_id, to_parent_id,
            old_status, new_status, quantity_delta, notes, created_at
     FROM part_history WHERE part_id = ? ORDER BY id ASC`,
    [partId]
  );
  return rows.map(([id, part_id, action, from_parent_id, to_parent_id, old_status, new_status, quantity_delta, notes, created_at]) => ({
    id, part_id, action, from_parent_id, to_parent_id, old_status, new_status, quantity_delta, notes, created_at,
  }));
}

export { DB };
