import { DB } from "./db.ts";

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
 * Compute stock allocation for a part.
 *
 * A part's `quantity` is the total owned. The `build_parts` join records how
 * many of it each build uses, so:
 *
 * - on_hand: the part's quantity (total owned)
 * - allocated: sum of the BOM quantities across all builds using this part
 * - free: on_hand − allocated
 * - builds: the builds that use this part, with the quantity in each
 *
 * The join is on `part_id`, so renaming a part cannot break its allocation,
 * and two different parts that happen to share a name are never merged.
 */
export function allocationForPart(db: DB, partId: number): AllocationResult {
  const onHandRows = db.query<[number]>(
    "SELECT COALESCE(quantity, 0) FROM parts WHERE id = ?",
    [partId],
  );
  const on_hand = onHandRows[0]?.[0] ?? 0;

  const allocRows = db.query<[number]>(
    "SELECT COALESCE(SUM(quantity), 0) FROM build_parts WHERE part_id = ?",
    [partId],
  );
  const allocated = allocRows[0]?.[0] ?? 0;

  const buildRows = db.query<[number, string, number]>(
    `SELECT b.id, b.name, SUM(bp.quantity) AS qty
     FROM build_parts bp JOIN builds b ON b.id = bp.build_id
     WHERE bp.part_id = ?
     GROUP BY b.id, b.name
     ORDER BY b.name`,
    [partId],
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
