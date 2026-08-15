import { DB, type PartType } from "./db.ts";

export interface AllocationBuild {
  build_id: number;
  build_name: string;
  qty: number;
}

export interface AllocationResult {
  on_hand: number;
  allocated: number;
  free: number;
  builds: AllocationBuild[];
}

/**
 * Compute stock allocation for a logical part group (exact name + type match).
 *
 * - on_hand: total quantity across ALL rows matching name+type (stock + installed)
 * - allocated: quantity of rows whose parent_id points at a type='craft' part
 * - free: on_hand − allocated
 * - builds: list of crafts that have this part installed, with qty per build
 */
export function allocationForGroup(
  db: DB,
  name: string,
  type: PartType | null,
): AllocationResult {
  // Total quantity across all rows matching name + type
  type TotalRow = [number];
  const typeClause = type === null ? "type IS NULL" : "type = ?";
  const totalParams: (string | null)[] = type === null ? [name] : [name, type];

  const totalRows = db.query<TotalRow>(
    `SELECT COALESCE(SUM(quantity), 0) FROM parts WHERE name = ? AND ${typeClause}`,
    totalParams,
  );
  const on_hand = (totalRows[0]?.[0] as number) ?? 0;

  // Quantity installed in craft builds (parent_id → a part with type='craft')
  const allocParams: (string | null)[] = type === null ? [name] : [name, type];
  const allocRows = db.query<[number]>(
    `SELECT COALESCE(SUM(p.quantity), 0)
     FROM parts p
     JOIN parts parent ON parent.id = p.parent_id AND parent.type = 'craft'
     WHERE p.name = ? AND p.${typeClause}`,
    allocParams,
  );
  const allocated = (allocRows[0]?.[0] as number) ?? 0;

  // Per-build breakdown
  const buildParams: (string | null)[] = type === null ? [name] : [name, type];
  const buildRows = db.query<[number, string, number]>(
    `SELECT parent.id, parent.name, SUM(p.quantity) AS qty
     FROM parts p
     JOIN parts parent ON parent.id = p.parent_id AND parent.type = 'craft'
     WHERE p.name = ? AND p.${typeClause}
     GROUP BY parent.id
     ORDER BY parent.name`,
    buildParams,
  );

  const builds: AllocationBuild[] = buildRows.map(([build_id, build_name, qty]) => ({
    build_id,
    build_name,
    qty,
  }));

  return {
    on_hand,
    allocated,
    free: on_hand - allocated,
    builds,
  };
}
