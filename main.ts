import { DB } from "https://deno.land/x/sqlite@v3.9.1/mod.ts";
import {
  addBuildComponent,
  assembleBuild,
  createBuild,
  createPart,
  deletePart,
  freeQuantity,
  getBuild,
  getBuildHistory,
  getPart,
  getPartHistory,
  initDb,
  listBuildComponents,
  listBuilds,
  listParts,
  type Part,
  type PartStatus,
  type PartType,
  queryInventorySummary,
  queryStockRows,
  removeBuildComponent,
  updateBuild,
  updatePart,
} from "./db.ts";
import { allocationForPart } from "./allocation.ts";
import { handleApi } from "./api.ts";

const PHOTOS_DIR = Deno.env.get("PHOTOS_DIR") ?? "./photos";
const DB_PATH = Deno.env.get("DB_PATH") ?? "./fpv-inventory.db";

const STATUS_LABELS: Record<PartStatus, string> = {
  "unused": "Unused",
  "in-use": "In Use",
  "broken": "Broken",
  "retired": "Retired",
  "lost": "Lost",
};

const STATUS_COLORS: Record<PartStatus, string> = {
  "unused": "#6c757d",
  "in-use": "#198754",
  "broken": "#dc3545",
  "retired": "#6f42c1",
  "lost": "#fd7e14",
};

const TYPE_LABELS: Record<PartType, string> = {
  "motor": "Motor",
  "fc": "FC",
  "esc": "ESC",
  "vtx": "VTX",
  "frame": "Frame",
  "camera": "Camera",
  "antenna": "Antenna",
  "battery": "Battery",
  "gear": "Gear",
  "other": "Other",
};

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce(
    (acc, str, i) => acc + str + (i < values.length ? String(values[i]) : ""),
    "",
  );
}

function escape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusBadge(status: PartStatus): string {
  const color = STATUS_COLORS[status] ?? "#6c757d";
  const label = STATUS_LABELS[status] ?? status;
  return `<span class="badge" style="background:${color}">${escape(label)}</span>`;
}

function typeBadge(type: PartType | null): string {
  if (!type) return "";
  const label = TYPE_LABELS[type] ?? type;
  return `<span class="type-badge">${escape(label)}</span>`;
}

const ALL_TYPES = [
  "motor",
  "fc",
  "esc",
  "vtx",
  "frame",
  "camera",
  "antenna",
  "battery",
  "gear",
  "other",
] as PartType[];

function typeOptions(selected: PartType | null): string {
  return `<option value="">— any type —</option>` +
    ALL_TYPES.map((t) =>
      `<option value="${t}"${t === selected ? " selected" : ""}>${TYPE_LABELS[t]}</option>`
    ).join("");
}

function layout(title: string, body: string): string {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escape(title)} — FPV Inventory</title>
        <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: system-ui, -apple-system, sans-serif;
          background: #0d1117;
          color: #e6edf3;
          min-height: 100vh;
          padding: 0 0 80px;
        }
        a { color: #58a6ff; text-decoration: none; }
        a:hover { text-decoration: underline; }
        header {
          background: #161b22;
          border-bottom: 1px solid #30363d;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        header h1 { font-size: 1.1rem; font-weight: 600; }
        header h1 a { color: #e6edf3; }
        .container { max-width: 860px; margin: 0 auto; padding: 20px 16px; }
        .card {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }
        .card h2 { font-size: 1rem; margin-bottom: 12px; color: #8b949e; text-transform: uppercase; font-size: .75rem; letter-spacing: .04em; }
        .btn {
          display: inline-block;
          padding: 6px 14px;
          border-radius: 6px;
          border: 1px solid #30363d;
          background: #21262d;
          color: #e6edf3;
          font-size: .875rem;
          cursor: pointer;
          text-decoration: none;
        }
        .btn:hover { background: #30363d; text-decoration: none; }
        .btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
        .btn-primary:hover { background: #2ea043; }
        .btn-danger { background: #b91c1c; border-color: #ef4444; color: #fff; }
        .btn-sm { padding: 3px 10px; font-size: .8rem; }
        input, select, textarea {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          color: #e6edf3;
          padding: 6px 10px;
          font-size: .9rem;
          width: 100%;
        }
        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: #58a6ff;
        }
        label { font-size: .875rem; color: #8b949e; display: block; margin-bottom: 4px; }
        .field { margin-bottom: 12px; }
        .badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: .75rem;
          color: #fff;
          font-weight: 600;
        }
        .part-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 0;
          border-bottom: 1px solid #21262d;
        }
        .part-row:last-child { border-bottom: none; }
        .part-name { flex: 1; font-weight: 500; }
        .part-meta { font-size: .8rem; color: #8b949e; }
        .history-item {
          padding: 8px 0;
          border-bottom: 1px solid #21262d;
          font-size: .85rem;
          color: #8b949e;
        }
        .history-item:last-child { border-bottom: none; }
        .history-action { color: #e6edf3; font-weight: 500; }
        .breadcrumb { font-size: .85rem; margin-bottom: 16px; color: #8b949e; }
        .breadcrumb a { color: #58a6ff; }
        .quick-add { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end; }
        .quick-add .field { margin-bottom: 0; flex: 1; min-width: 120px; }
        .photo-preview { max-width: 100%; max-height: 240px; border-radius: 6px; margin-top: 8px; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        @media (max-width: 600px) {
          .grid-2 { grid-template-columns: 1fr; }
          .quick-add { flex-direction: column; }
        }
        .empty { color: #8b949e; font-size: .9rem; padding: 12px 0; }
        .detail-field { margin-bottom: 8px; font-size: .9rem; }
        .detail-field .label { color: #8b949e; font-size: .8rem; display: block; margin-bottom: 2px; }
        .part-qty { background: #21262d; border-radius: 4px; padding: 1px 6px; font-size: .8rem; min-width: 28px; text-align: center; }
        .type-badge { background: #1f3a5f; color: #79c0ff; border-radius: 4px; padding: 1px 7px; font-size: .75rem; font-weight: 500; }
        .stat-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
        .stat { display: flex; flex-direction: column; gap: 2px; }
        .stat-label { font-size: .7rem; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; }
        .stat-value { font-size: 1.5rem; font-weight: 600; color: #e6edf3; line-height: 1.2; }
        .stat-hint { font-size: .7rem; color: #8b949e; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
      </style>
      </head>
      <body>
        <header>
          <h1><a href="/">🚁 FPV Inventory</a></h1>
          <nav style="display:flex;gap:12px;margin-left:auto;font-size:.875rem">
            <a href="/" style="color:#8b949e">Inventory</a>
            <a href="/builds" style="color:#8b949e">Builds</a>
            <a href="/stock" style="color:#8b949e">Stock</a>
            <a href="/builds/new" style="color:#8b949e">New Build</a>
          </nav>
        </header>
        <div class="container">
        ${body}
      </div>
      </body>
    </html>
  `;
}

function fullAddForm(): string {
  const title = `Add Part`;
  return layout(
    title,
    `
    <div class="breadcrumb"><a href="/">← Back</a></div>
    <div class="card">
      <h2>${escape(title)}</h2>
      <form method="POST" action="/parts/new">
        <div class="field">
          <label>Name *</label>
          <input name="name" required placeholder="e.g. 0702 Motor, Quad Alpha…" autofocus>
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Type</label>
            <select name="type">
              <option value="">—</option>
              ${ALL_TYPES.map((t) => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select name="status">
              <option value="unused">Unused</option>
              <option value="in-use">In Use</option>
              <option value="broken">Broken</option>
              <option value="retired">Retired</option>
              <option value="lost">Lost</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Quantity</label>
          <input name="quantity" type="number" value="1" min="1" style="max-width:120px">
        </div>
        <div class="field">
          <label for="new-location">Location</label>
          <input id="new-location" name="location" placeholder="e.g. Drawer 2, small parts bin">
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" rows="3" placeholder="e.g. burned in, running on 4S only"></textarea>
        </div>
        <div class="field">
          <label>Specs <span style="color:#8b949e;font-weight:400">(raw spec block from product listing)</span></label>
          <textarea name="specs" rows="4" style="font-family:monospace;font-size:.82rem" placeholder="e.g. KV: 2400&#10;Weight: 31.5g&#10;Max Power: 1100W"></textarea>
        </div>
        <hr style="border-color:#30363d;margin:12px 0">
        <p style="font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Procurement (optional)</p>
        <div class="field">
          <label>Serial Number</label>
          <input name="serial_number" placeholder="e.g. SN-1234567">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Purchase Date</label>
            <input type="date" name="purchase_date">
          </div>
          <div class="field">
            <label>Warranty Expiry</label>
            <input type="date" name="warranty_expiry">
          </div>
        </div>
        <div class="field">
          <label>Purchase Price</label>
          <input type="number" step="0.01" min="0" name="purchase_price" placeholder="0.00" style="max-width:160px">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Save Part</button>
          <a href="/" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

function quickAddForm(): string {
  return `
<div class="card">
  <h2>Quick Add</h2>
  <form method="POST" action="/parts">
    <div class="quick-add">
      <div class="field" style="flex:2;min-width:180px">
        <label>Name *</label>
        <input name="name" required placeholder="e.g. 0702 Motor, Quad Alpha…">
      </div>
      <div class="field">
        <label>Qty</label>
        <input name="quantity" type="number" value="1" min="1" style="max-width:80px">
      </div>
      <div class="field">
        <label for="qa-location">Location</label>
        <input id="qa-location" name="location" placeholder="e.g. Drawer 2">
      </div>
      <div class="field">
        <label for="qa-type">Type</label>
        <select id="qa-type" name="type">
          <option value="">—</option>
          ${ALL_TYPES.map((t) => `<option value="${t}">${TYPE_LABELS[t]}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Status</label>
        <select name="status">
          <option value="unused">Unused</option>
          <option value="in-use">In Use</option>
          <option value="broken">Broken</option>
          <option value="retired">Retired</option>
          <option value="lost">Lost</option>
        </select>
      </div>
      <div class="field" style="flex:none">
        <label>&nbsp;</label>
        <button type="submit" class="btn btn-primary">Add</button>
      </div>
      <div class="field" style="flex:none">
        <label>&nbsp;</label>
        <a href="/parts/new" class="btn btn-sm" style="white-space:nowrap">Full details…</a>
      </div>
    </div>
  </form>
</div>`;
}

function partRow(part: Part): string {
  const qty = part.quantity > 1 ? `<span class="part-qty">${part.quantity}</span>` : "";
  const notes = part.notes
    ? `<span class="part-meta" style="margin-left:4px">— ${escape(part.notes)}</span>`
    : "";
  return `
<div class="part-row">
  <span class="part-name">
    <a href="/parts/${part.id}">${escape(part.name)}</a>
    ${qty}
    ${typeBadge(part.type)}
    ${notes}
  </span>
  ${statusBadge(part.status)}
</div>`;
}

function stockPage(db: DB): string {
  // Reuse the shared aggregation function (INV-7).
  const rows = queryStockRows(db);

  if (rows.length === 0) {
    return layout(
      "Stock",
      `<div class="breadcrumb"><a href="/">← Home</a></div>
       <div class="card">
         <h2>Stock Check</h2>
         <p class="empty">No stock yet — add parts from the <a href="/">inventory</a>.</p>
       </div>`,
    );
  }

  // Group rows by type
  const byType = new Map<
    string,
    Array<{ status: string; total_quantity: number; count: number }>
  >();
  for (const { type, status, total_quantity, count } of rows) {
    const key = type ?? "(untyped)";
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push({ status, total_quantity, count });
  }

  const sections = [...byType.entries()].map(([typeName, statuses]) => {
    const typeLabel = typeName === "(untyped)"
      ? "(untyped)"
      : (TYPE_LABELS[typeName as PartType] ?? typeName);
    const statusRows = statuses.map(({ status, total_quantity, count }) => `
      <div class="part-row">
        <span class="part-name" style="flex:none;min-width:100px">${
      statusBadge(status as PartStatus)
    }</span>
        <span class="part-meta">${total_quantity} units (${count} row${
      count !== 1 ? "s" : ""
    })</span>
      </div>`).join("");
    return `
      <div class="card">
        <h2>${escape(typeLabel)}</h2>
        ${statusRows}
      </div>`;
  }).join("");

  return layout(
    "Stock",
    `<div class="breadcrumb"><a href="/">← Home</a></div>
     <h2 style="font-size:1rem;margin-bottom:16px">Stock Check</h2>
     ${sections}`,
  );
}

function summaryCard(db: DB): string {
  const s = queryInventorySummary(db);
  const value = `$${s.inventory_value.toFixed(2)}`;
  const stat = (id: string, label: string, figure: string, hint: string) => `
  <div class="stat">
    <span class="stat-label">${escape(label)}</span>
    <span class="stat-value" id="${id}">${escape(figure)}</span>
    <span class="stat-hint">${escape(hint)}</span>
  </div>`;

  return `
<div class="card">
  <h2>Inventory</h2>
  <div class="stat-row">
    ${stat("stat-total-parts", "Total parts", String(s.total_parts), "rows in the bin")}
    ${stat("stat-total-quantity", "Total quantity", String(s.total_quantity), "units on hand")}
    ${stat("stat-inventory-value", "Inventory value", value, "at purchase price")}
    ${stat("stat-low-stock", "Low stock", String(s.low_stock), "3 units or fewer")}
    ${
    stat(
      "stat-installed-in-builds",
      "Installed in builds",
      String(s.installed_in_builds),
      "rows in a build",
    )
  }
  </div>
</div>`;
}

function homePage(
  db: DB,
  typeFilter?: PartType,
  query?: string,
  locationFilter?: string,
): string {
  const parts = listParts(db, { type: typeFilter, location: locationFilter, q: query });
  const searching = query != null && query.length > 0;
  const locationFiltering = locationFilter != null && locationFilter.length > 0;
  const rows = parts.length > 0
    ? parts.map(partRow).join("")
    : searching
    ? `<p class="empty">No parts match &ldquo;${escape(query)}&rdquo;.</p>`
    : locationFiltering
    ? `<p class="empty">No parts in that location.</p>`
    : `<p class="empty">No parts yet — add something above.</p>`;

  const filterBar = `
<form method="GET" action="/" style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
  <input type="search" name="q" value="${
    escape(query ?? "")
  }" placeholder="Search parts…" aria-label="Search parts" style="width:auto;min-width:180px">
  <input type="search" name="location" value="${
    escape(locationFilter ?? "")
  }" placeholder="Location…" aria-label="Filter by location" style="width:auto;min-width:140px">
  <select name="type" onchange="this.form.submit()" style="width:auto">
    ${typeOptions(typeFilter ?? null)}
  </select>
  <button type="submit" class="btn btn-sm">Search</button>
  ${typeFilter || searching || locationFiltering ? `<a href="/" class="btn btn-sm">Clear</a>` : ""}
</form>`;

  return layout(
    "Inventory",
    `
    ${summaryCard(db)}
    ${quickAddForm()}
    <div class="card">
      <h2>Parts</h2>
      ${filterBar}
      ${rows}
    </div>
  `,
  );
}

async function buildBreadcrumb(db: DB, partId: number): Promise<string> {
  const part = getPart(db, partId);
  if (!part) return `<div class="breadcrumb"><a href="/">Home</a></div>`;
  return `<div class="breadcrumb"><a href="/">Home</a> › ${escape(part.name)}</div>`;
}

function historyDescription(entry: ReturnType<typeof getPartHistory>[0]): string {
  switch (entry.action) {
    case "created":
      // Migrated v1 entries may carry the original install destination —
      // assembleBuild recorded an installed child's first event this way.
      return entry.to_build_id != null
        ? `Added to inventory and installed in build #${entry.to_build_id}${
          entry.notes ? ` — ${escape(entry.notes)}` : ""
        }`
        : "Added to inventory";
    case "updated":
      return entry.old_status !== entry.new_status
        ? `Status changed: ${entry.old_status} → ${entry.new_status}`
        : entry.quantity_delta && entry.quantity_delta !== 0
        ? `Quantity changed by ${entry.quantity_delta > 0 ? "+" : ""}${entry.quantity_delta}`
        : "Details updated";
    case "installed":
      return `Installed in build #${entry.to_build_id}${
        entry.notes ? ` — ${escape(entry.notes)}` : ""
      }`;
    case "removed":
      return `Removed from build #${entry.from_build_id}${
        entry.notes ? ` — ${escape(entry.notes)}` : ""
      }`;
    case "moved":
      // Legacy (pre-builds-model) entries: v1 moved stock between assemblies.
      return entry.to_build_id != null
        ? `Moved from ${
          entry.from_build_id != null ? `build #${entry.from_build_id}` : "spare parts"
        } to build #${entry.to_build_id}${entry.notes ? ` — ${escape(entry.notes)}` : ""}`
        : `Removed from build #${entry.from_build_id}${
          entry.notes ? ` — ${escape(entry.notes)}` : ""
        }`;
    default:
      return escape(entry.action);
  }
}

async function partDetailPage(db: DB, id: number): Promise<string | null> {
  const part = getPart(db, id);
  if (!part) return null;

  const history = getPartHistory(db, id);
  const breadcrumb = await buildBreadcrumb(db, id);
  const alloc = allocationForPart(db, id);

  const photoSection = part.photo_path
    ? `<img src="/photos/${escape(part.photo_path)}" alt="photo" class="photo-preview">`
    : "";

  // Which builds this part is installed in.
  const buildsHtml = alloc.builds.length > 0
    ? alloc.builds.map((b) =>
      `<div class="part-row">
        <span class="part-name"><a href="/builds/${b.build_id}">${escape(b.build_name)}</a></span>
        <span class="part-meta">${b.qty} installed</span>
       </div>`
    )
    : `<p class="empty">Not installed in any build.</p>`;

  const allocationCard = `
      <div class="card">
        <h2>Allocation</h2>
        <div style="display:flex;gap:24px;margin-bottom:12px;font-size:.9rem">
          <span><strong>${alloc.on_hand}</strong> <span style="color:#8b949e">on hand</span></span>
          <span><strong>${alloc.allocated}</strong> <span style="color:#8b949e">allocated</span></span>
          <span><strong>${alloc.free}</strong> <span style="color:#8b949e">free</span></span>
        </div>
        ${buildsHtml}
      </div>`;

  const historyHtml = history.map((h) => `
    <div class="history-item">
      <span class="history-action">${escape(h.action)}</span>
      — ${historyDescription(h)}
      <span style="float:right;font-size:.75rem">${
    h.created_at.replace("T", " ").slice(0, 16)
  }</span>
    </div>
  `).join("");

  return layout(
    part.name,
    `
    ${breadcrumb}

    <div class="grid-2">
      <div class="card">
        <h2>Part Details</h2>
        ${photoSection}
        <div class="detail-field">
          <span class="label">Name</span>
          <strong>${escape(part.name)}</strong>
        </div>
        <div class="detail-field">
          <span class="label">Status</span>
          ${statusBadge(part.status)}
        </div>
        <div class="detail-field">
          <span class="label">Type</span>
          ${part.type ? typeBadge(part.type) : '<span style="color:#8b949e">—</span>'}
        </div>
        <div class="detail-field">
          <span class="label">Quantity</span>
          ${escape(part.quantity)}
          <span style="color:#8b949e">total owned</span>
        </div>
        ${
      part.location
        ? `<div class="detail-field"><span class="label">Location</span>${
          escape(part.location)
        }</div>`
        : ""
    }
        ${
      part.notes
        ? `<div class="detail-field"><span class="label">Notes</span>${escape(part.notes)}</div>`
        : ""
    }
        ${
      part.specs
        ? `<div class="detail-field"><span class="label">Specs</span><pre style="font-size:.8rem;background:#0d1117;padding:8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;color:#79c0ff">${
          escape(part.specs)
        }</pre></div>`
        : ""
    }
        ${
      part.serial_number || part.purchase_date || part.warranty_expiry ||
        part.purchase_price != null
        ? `<hr style="border-color:#30363d;margin:12px 0">
           ${
          part.serial_number
            ? `<div class="detail-field"><span class="label">Serial</span>${
              escape(part.serial_number)
            }</div>`
            : ""
        }
           ${
          part.purchase_date
            ? `<div class="detail-field"><span class="label">Purchased</span>${
              escape(part.purchase_date)
            }</div>`
            : ""
        }
           ${
          part.purchase_price != null
            ? `<div class="detail-field"><span class="label">Price</span>${
              escape(Number(part.purchase_price).toFixed(2))
            }</div>`
            : ""
        }
           ${
          part.warranty_expiry
            ? `<div class="detail-field"><span class="label">Warranty</span>${
              escape(part.warranty_expiry)
            }</div>`
            : ""
        }`
        : ""
    }

        <div class="actions">
          <a href="/parts/${id}/edit" class="btn btn-primary btn-sm">Edit</a>
          <a href="/parts/${id}/install" class="btn btn-sm">Install in a build</a>
          <a href="/parts/${id}/photo" class="btn btn-sm">Change photo</a>
          <form method="POST" action="/parts/${id}/delete" style="margin-left:8px"
            onsubmit="return confirm('Delete this part? This cannot be undone.')">
            <button type="submit" class="btn btn-sm" style="color:#f85149">Delete</button>
          </form>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>History</h2>
          ${historyHtml || '<p class="empty">No history.</p>'}
        </div>
      </div>
    </div>

    ${allocationCard}
  `,
  );
}

// ─── Builds ──────────────────────────────────────────────────────────────────

function buildsPage(db: DB): string {
  const builds = listBuilds(db);
  const rows = builds.length > 0
    ? builds.map((b) => {
      const components = listBuildComponents(db, b.id);
      const qty = components.reduce((sum, c) => sum + c.quantity, 0);
      return `
<div class="part-row">
  <span class="part-name"><a href="/builds/${b.id}">${escape(b.name)}</a>
    ${b.class ? `<span class="type-badge">${escape(b.class)}</span>` : ""}
  </span>
  <span class="part-meta">${components.length} components · ${qty} parts</span>
  ${statusBadge(b.status)}
</div>`;
    }).join("")
    : `<p class="empty">No builds yet — create one from the bin.</p>`;

  return layout(
    "Builds",
    `
    <div class="card">
      <h2>Builds</h2>
      ${rows}
    </div>
    <div class="card">
      <a href="/builds/new" class="btn btn-primary">New Build from Bin</a>
    </div>
  `,
  );
}

async function buildDetailPage(db: DB, id: number): Promise<string | null> {
  const build = getBuild(db, id);
  if (!build) return null;

  const components = listBuildComponents(db, id);
  const history = getBuildHistory(db, id);

  const bomRows = components.length > 0
    ? components.map((c) => {
      const alloc = allocationForPart(db, c.part_id);
      return `
        <tr>
          <td style="padding:8px 0"><a href="/parts/${c.part_id}">${escape(c.name)}</a>
            ${c.type ? typeBadge(c.type) : ""}
            ${c.role ? `<span class="type-badge">${escape(c.role)}</span>` : ""}</td>
          <td style="padding:8px 0;text-align:right">${c.quantity}</td>
          <td style="padding:8px 0;text-align:right">${alloc.on_hand}</td>
          <td style="padding:8px 0;text-align:right">${alloc.allocated}</td>
          <td style="padding:8px 0;text-align:right">${alloc.free}</td>
          <td style="padding:8px 0;text-align:right">
            <form method="POST" action="/builds/${id}/components/remove">
              <input type="hidden" name="component_id" value="${c.id}">
              <button type="submit" class="btn btn-sm btn-danger">Remove</button>
            </form>
          </td>
        </tr>`;
    }).join("")
    : `<tr><td colspan="6" style="padding:12px;color:#8b949e">No components yet.</td></tr>`;

  const historyHtml = history.map((h) => `
    <div class="history-item">
      <span class="history-action">${escape(h.action)}</span>
      ${h.new_status ? `— status ${escape(h.new_status)}` : ""}
      <span style="float:right;font-size:.75rem">${
    h.created_at.replace("T", " ").slice(0, 16)
  }</span>
    </div>
  `).join("");

  return layout(
    build.name,
    `
    <div class="breadcrumb"><a href="/">Home</a> › <a href="/builds">Builds</a> › ${
      escape(build.name)
    }</div>

    <div class="grid-2">
      <div class="card">
        <h2>Build Details</h2>
        ${
      build.photo_path
        ? `<img src="/photos/${escape(build.photo_path)}" alt="photo" class="photo-preview">`
        : ""
    }
        <div class="detail-field">
          <span class="label">Name</span>
          <strong>${escape(build.name)}</strong>
        </div>
        <div class="detail-field">
          <span class="label">Status</span>
          ${statusBadge(build.status)}
        </div>
        ${
      build.class
        ? `<div class="detail-field"><span class="label">Class</span>${escape(build.class)}</div>`
        : ""
    }
        ${
      build.notes
        ? `<div class="detail-field"><span class="label">Notes</span>${escape(build.notes)}</div>`
        : ""
    }
        ${
      build.specs
        ? `<div class="detail-field"><span class="label">Specs</span><pre style="font-size:.8rem;background:#0d1117;padding:8px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;color:#79c0ff">${
          escape(build.specs)
        }</pre></div>`
        : ""
    }
        <div class="actions">
          <a href="/builds/${id}/edit" class="btn btn-primary btn-sm">Edit</a>
          <a href="/builds/${id}/photo" class="btn btn-sm">Change photo</a>
        </div>
      </div>

      <div>
        <div class="card">
          <h2>History</h2>
          ${historyHtml || '<p class="empty">No history.</p>'}
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Bill of Materials</h2>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.875rem">
          <thead>
            <tr style="color:#8b949e;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">
              <th style="text-align:left;padding:4px 0">Component</th>
              <th style="text-align:right;padding:4px 0">In Build</th>
              <th style="text-align:right;padding:4px 0">On Hand</th>
              <th style="text-align:right;padding:4px 0">Allocated</th>
              <th style="text-align:right;padding:4px 0">Free</th>
              <th style="text-align:right;padding:4px 0"></th>
            </tr>
          </thead>
          <tbody style="border-top:1px solid #30363d">
            ${bomRows}
          </tbody>
        </table>
      </div>
      <div class="actions">
        <a href="/builds/${id}/components/add" class="btn btn-primary btn-sm">Add component</a>
      </div>
    </div>
  `,
  );
}

async function buildAddComponentPage(db: DB, id: number): Promise<string | null> {
  const build = getBuild(db, id);
  if (!build) return null;
  const candidates = listParts(db)
    .map((p) => ({ part: p, free: freeQuantity(db, p.id) }))
    .filter(({ free }) => free > 0);
  const rows = candidates.length > 0
    ? candidates.map(({ part: p, free }) => `
        <tr>
          <td style="padding:8px 6px">
            <a href="/parts/${p.id}">${escape(p.name)}</a>
            ${p.type ? typeBadge(p.type) : ""}
          </td>
          <td style="padding:8px 6px;text-align:center;color:#8b949e">${free}</td>
          <td style="padding:8px 6px;text-align:center">
            <input type="number" name="qty_${p.id}" min="0" max="${free}" value="0"
              style="width:70px;text-align:center"
              aria-label="Quantity of ${escape(p.name)} to install">
          </td>
        </tr>`).join("")
    : `<tr><td colspan="3" style="padding:12px;color:#8b949e">No stock available.</td></tr>`;

  return layout(
    `Add component — ${build.name}`,
    `
    <div class="breadcrumb"><a href="/">Home</a> › <a href="/builds">Builds</a> ›
      <a href="/builds/${id}">${escape(build.name)}</a></div>
    <div class="card">
      <h2>Add component to ${escape(build.name)}</h2>
      <form method="POST" action="/builds/${id}/components/add">
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.875rem">
            <thead>
              <tr style="color:#8b949e;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">
                <th style="text-align:left;padding:4px 0">Part</th>
                <th style="text-align:right;padding:4px 0">On Hand</th>
                <th style="text-align:right;padding:4px 0">Use Qty</th>
              </tr>
            </thead>
            <tbody style="border-top:1px solid #30363d">
              ${rows}
            </tbody>
          </table>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
          <button type="submit" class="btn btn-primary">Add components</button>
          <a href="/builds/${id}" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

async function partEditPage(db: DB, id: number): Promise<string | null> {
  const part = getPart(db, id);
  if (!part) return null;
  const breadcrumb = await buildBreadcrumb(db, id);

  return layout(
    `Edit ${part.name}`,
    `
    ${breadcrumb}
    <div class="card">
      <h2>Edit ${escape(part.name)}</h2>
      <form method="POST" action="/parts/${id}/update">
        <div class="field">
          <label>Status</label>
          <select name="status">
            ${
      (["unused", "in-use", "broken", "retired", "lost"] as PartStatus[])
        .map((s) =>
          `<option value="${s}"${s === part.status ? " selected" : ""}>${STATUS_LABELS[s]}</option>`
        )
        .join("")
    }
          </select>
        </div>
        <div class="field">
          <label>Type</label>
          <select name="type">
            ${typeOptions(part.type)}
          </select>
        </div>
        <div class="field">
          <label>Quantity</label>
          <input name="quantity" type="number" min="0" value="${escape(part.quantity)}">
        </div>
        <div class="field">
          <label for="edit-location">Location</label>
          <input id="edit-location" name="location" value="${
      escape(part.location ?? "")
    }" placeholder="e.g. Drawer 2, small parts bin">
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" rows="2">${escape(part.notes ?? "")}</textarea>
        </div>
        <div class="field">
          <label>Specs <span style="color:#8b949e;font-weight:400">(raw spec block from product listing)</span></label>
          <textarea name="specs" rows="4" style="font-family:monospace;font-size:.82rem" placeholder="e.g. KV: 2400&#10;Weight: 31.5g&#10;Max Power: 1100W">${
      escape(part.specs ?? "")
    }</textarea>
        </div>
        <hr style="border-color:#30363d;margin:12px 0">
        <p style="font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Procurement</p>
        <div class="field">
          <label>Serial Number</label>
          <input name="serial_number" value="${escape(part.serial_number ?? "")}">
        </div>
        <div class="grid-2">
          <div class="field">
            <label>Purchase Date</label>
            <input type="date" name="purchase_date" value="${escape(part.purchase_date ?? "")}">
          </div>
          <div class="field">
            <label>Warranty Expiry</label>
            <input type="date" name="warranty_expiry" value="${escape(part.warranty_expiry ?? "")}">
          </div>
        </div>
        <div class="field">
          <label>Purchase Price</label>
          <input type="number" step="0.01" min="0" name="purchase_price"
            value="${escape(part.purchase_price != null ? String(part.purchase_price) : "")}"
            style="max-width:160px">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Save changes</button>
          <a href="/parts/${id}" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

async function partInstallPage(db: DB, id: number): Promise<string | null> {
  const part = getPart(db, id);
  if (!part) return null;
  const breadcrumb = await buildBreadcrumb(db, id);
  const parentOptions = listParts(db).filter((p) => p.id !== id)
    .map((p) => `<option value="${p.id}">${escape(p.name)}</option>`)
    .join("");

  const buildOptions = listBuilds(db)
    .map((b) => `<option value="${b.id}">${escape(b.name)}</option>`)
    .join("");

  return layout(
    `Install ${part.name}`,
    `
    ${breadcrumb}
    <div class="card">
      <h2>Install ${escape(part.name)} in a build</h2>
      <form method="POST" action="/parts/${id}/install">
        <div class="field">
          <label>Build</label>
          <select name="build_id">${buildOptions}</select>
        </div>
        <div class="field">
          <label>Quantity</label>
          <input name="quantity" type="number" min="1" max="${freeQuantity(db, part.id)}" value="1"
            style="max-width:120px">
        </div>
        <div class="field">
          <label>Role (optional)</label>
          <input name="role" placeholder="e.g. motors, fc-aio">
        </div>
        <div class="field">
          <label>Reason (optional)</label>
          <input name="notes" placeholder="e.g. Salvaged from crash">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Install</button>
          <a href="/parts/${id}" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

async function partPhotoPage(db: DB, id: number): Promise<string | null> {
  const part = getPart(db, id);
  if (!part) return null;
  const breadcrumb = await buildBreadcrumb(db, id);

  const currentPhoto = part.photo_path
    ? `<img src="/photos/${escape(part.photo_path)}" alt="photo" class="photo-preview">`
    : `<p class="empty">No photo yet.</p>`;

  return layout(
    `Photo — ${part.name}`,
    `
    ${breadcrumb}
    <div class="card">
      <h2>Photo for ${escape(part.name)}</h2>
      ${currentPhoto}
      <form method="POST" action="/parts/${id}/photo" enctype="multipart/form-data">
        <div class="field">
          <label>Upload photo</label>
          <input type="file" name="photo" accept="image/*">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Upload</button>
          <a href="/parts/${id}" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

function buildsNewPage(db: DB, error?: string): string {
  // Offer only parts with unallocated stock, capped at their free quantity.
  const parts = listParts(db)
    .map((p) => ({ part: p, free: freeQuantity(db, p.id) }))
    .filter(({ free }) => free > 0);

  const errorHtml = error
    ? `<div style="background:#3d1515;border:1px solid #b91c1c;border-radius:6px;padding:10px 14px;margin-bottom:12px;color:#fca5a5;font-size:.875rem">${
      escape(error)
    }</div>`
    : "";

  const partRows = parts.length > 0
    ? parts.map(({ part: p, free }) => `
        <tr>
          <td style="padding:8px 6px">
            <a href="/parts/${p.id}">${escape(p.name)}</a>
            ${p.type ? typeBadge(p.type) : ""}
          </td>
          <td style="padding:8px 6px;text-align:center;color:#8b949e">${free}</td>
          <td style="padding:8px 6px;text-align:center">
            <input
              type="number"
              name="qty_${p.id}"
              min="0"
              max="${free}"
              value="0"
              style="width:70px;text-align:center"
              aria-label="Quantity of ${escape(p.name)} to install"
            >
          </td>
        </tr>`).join("")
    : `<tr><td colspan="3" style="padding:12px;color:#8b949e">No stock available. Add parts from the <a href="/">inventory</a>.</td></tr>`;

  return layout(
    "New Build from Bin",
    `
    <div class="breadcrumb"><a href="/">← Home</a></div>
    <div class="card">
      <h2>New Build from Bin</h2>
      ${errorHtml}
      <form method="POST" action="/builds/from-bin">
        <div class="field">
          <label>Build Name *</label>
          <input name="name" required placeholder="e.g. LionBee, Whoop Alpha…" autofocus>
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" rows="2" placeholder="First impressions, purpose, configuration…"></textarea>
        </div>
        <hr style="border-color:#30363d;margin:12px 0">
        <p style="font-size:.75rem;color:#8b949e;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Pick components</p>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.875rem">
            <thead>
              <tr style="color:#8b949e;font-size:.75rem;text-transform:uppercase;letter-spacing:.04em">
                <th style="text-align:left;padding:4px 6px">Part</th>
                <th style="text-align:center;padding:4px 6px">Available</th>
                <th style="text-align:center;padding:4px 6px">Use qty</th>
              </tr>
            </thead>
            <tbody style="border-top:1px solid #30363d">
              ${partRows}
            </tbody>
          </table>
        </div>
        <hr style="border-color:#30363d;margin:12px 0">
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary">Assemble Build</button>
          <a href="/" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

async function buildEditPage(db: DB, id: number): Promise<string | null> {
  const build = getBuild(db, id);
  if (!build) return null;

  return layout(
    `Edit ${build.name}`,
    `
    <div class="breadcrumb"><a href="/">Home</a> › <a href="/builds">Builds</a> › <a href="/builds/${id}">${
      escape(build.name)
    }</a> › Edit</div>
    <div class="card">
      <h2>Edit ${escape(build.name)}</h2>
      <form method="POST" action="/builds/${id}/update">
        <div class="field">
          <label>Status</label>
          <select name="status">
            ${
      (["unused", "in-use", "broken", "retired", "lost"] as PartStatus[])
        .map((s) =>
          `<option value="${s}"${s === build.status ? " selected" : ""}>${
            STATUS_LABELS[s]
          }</option>`
        )
        .join("")
    }
          </select>
        </div>
        <div class="field">
          <label>Class</label>
          <input name="class" value="${
      escape(build.class ?? "")
    }" placeholder="e.g. whoop, 5-inch freestyle">
        </div>
        <div class="field">
          <label>Notes</label>
          <textarea name="notes" rows="2">${escape(build.notes ?? "")}</textarea>
        </div>
        <div class="field">
          <label>Specs</label>
          <textarea name="specs" rows="4" style="font-family:monospace;font-size:.82rem">${
      escape(build.specs ?? "")
    }</textarea>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Save changes</button>
          <a href="/builds/${id}" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

async function buildPhotoPage(db: DB, id: number): Promise<string | null> {
  const build = getBuild(db, id);
  if (!build) return null;

  const currentPhoto = build.photo_path
    ? `<img src="/photos/${escape(build.photo_path)}" alt="photo" class="photo-preview">`
    : `<p class="empty">No photo yet.</p>`;

  return layout(
    `Photo — ${build.name}`,
    `
    <div class="breadcrumb"><a href="/">Home</a> › <a href="/builds">Builds</a> › <a href="/builds/${id}">${
      escape(build.name)
    }</a> › Photo</div>
    <div class="card">
      <h2>Photo for ${escape(build.name)}</h2>
      ${currentPhoto}
      <form method="POST" action="/builds/${id}/photo" enctype="multipart/form-data">
        <div class="field">
          <label>Upload photo</label>
          <input type="file" name="photo" accept="image/*">
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button type="submit" class="btn btn-primary">Upload</button>
          <a href="/builds/${id}" class="btn">Cancel</a>
        </div>
      </form>
    </div>
  `,
  );
}

export function makeHandler(db: DB) {
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // JSON API — owns everything under /api/, returns null for other paths
    const apiRes = handleApi(db, req, url);
    if (apiRes) return apiRes;

    // GET /
    if (path === "/" && req.method === "GET") {
      // Empty params mean "no filter" — URLSearchParams.get returns "" for ?type=
      // and ?q=, which nullish coalescing does not catch.
      const typeParam = url.searchParams.get("type");
      const type = typeParam ? (typeParam as PartType) : undefined;
      const qParam = url.searchParams.get("q");
      const q = qParam ? qParam : undefined;
      const locationParam = url.searchParams.get("location");
      const location = locationParam ? locationParam : undefined;
      return new Response(homePage(db, type, q, location), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // POST /parts — create
    if (path === "/parts" && req.method === "POST") {
      const form = await req.formData();
      const name = form.get("name")?.toString().trim();
      if (!name) {
        return new Response("Name is required", { status: 400 });
      }
      const quantity = parseInt(form.get("quantity")?.toString() ?? "1", 10) || 1;
      const status = (form.get("status")?.toString() ?? "unused") as PartStatus;
      const typeStr = form.get("type")?.toString() || undefined;
      const type = typeStr ? typeStr as PartType : undefined;
      const notes = form.get("notes")?.toString().trim() || undefined;
      const location = form.get("location")?.toString().trim() || undefined;
      try {
        createPart(db, { name, quantity, status, type, notes, location });
      } catch (err) {
        console.error("Failed to create part:", err);
        return new Response("Failed to create part", { status: 500 });
      }

      return new Response(null, { status: 303, headers: { Location: "/" } });
    }

    // GET /parts/new — full add form
    if (path === "/parts/new" && req.method === "GET") {
      return new Response(fullAddForm(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // POST /parts/new — create from full form (redirects to new part detail)
    if (path === "/parts/new" && req.method === "POST") {
      const form = await req.formData();
      const name = form.get("name")?.toString().trim();
      if (!name) {
        return new Response("Name is required", { status: 400 });
      }
      const quantity = parseInt(form.get("quantity")?.toString() ?? "1", 10) || 1;
      const status = (form.get("status")?.toString() ?? "unused") as PartStatus;
      const typeStr = form.get("type")?.toString() || undefined;
      const type = typeStr ? typeStr as PartType : undefined;
      const notes = form.get("notes")?.toString().trim() || undefined;
      const specs = form.get("specs")?.toString().trim() || undefined;
      const location = form.get("location")?.toString().trim() || undefined;
      const serial_number = form.get("serial_number")?.toString().trim() || null;
      const warranty_expiry = form.get("warranty_expiry")?.toString() || null;
      const purchase_date = form.get("purchase_date")?.toString() || null;
      const ppStr = form.get("purchase_price")?.toString().trim();
      const purchase_price = ppStr && !isNaN(parseFloat(ppStr)) ? parseFloat(ppStr) : null;

      let newId: number;
      try {
        newId = createPart(db, {
          name,
          quantity,
          status,
          type,
          notes,
          specs,
          location,
          serial_number,
          warranty_expiry,
          purchase_date,
          purchase_price,
        });
      } catch (err) {
        console.error("Failed to create part:", err);
        return new Response("Failed to create part", { status: 500 });
      }
      return new Response(null, { status: 303, headers: { Location: `/parts/${newId}` } });
    }

    // GET /parts/:id
    const detailMatch = path.match(/^\/parts\/(\d+)$/);
    if (detailMatch && req.method === "GET") {
      const id = parseInt(detailMatch[1], 10);
      const page = await partDetailPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // POST /parts/:id/delete
    const deleteMatch = path.match(/^\/parts\/(\d+)\/delete$/);
    if (deleteMatch && req.method === "POST") {
      const id = parseInt(deleteMatch[1], 10);
      if (!getPart(db, id)) return new Response("Not Found", { status: 404 });
      try {
        deletePart(db, id);
      } catch (err) {
        return new Response((err as Error).message, { status: 400 });
      }
      return new Response(null, { status: 303, headers: { Location: "/" } });
    }

    // GET /parts/:id/edit
    const editMatch = path.match(/^\/parts\/(\d+)\/edit$/);
    if (editMatch && req.method === "GET") {
      const id = parseInt(editMatch[1], 10);
      const page = await partEditPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // GET /parts/:id/install
    const installPageMatch = path.match(/^\/parts\/(\d+)\/install$/);
    if (installPageMatch && req.method === "GET") {
      const id = parseInt(installPageMatch[1], 10);
      const page = await partInstallPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // GET /builds
    if (path === "/builds" && req.method === "GET") {
      return new Response(buildsPage(db), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /builds/:id
    const buildDetailMatch = path.match(/^\/builds\/(\d+)$/);
    if (buildDetailMatch && req.method === "GET") {
      const id = parseInt(buildDetailMatch[1], 10);
      const page = await buildDetailPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // GET /builds/:id/components/add
    const buildAddComponentMatch = path.match(/^\/builds\/(\d+)\/components\/add$/);
    if (buildAddComponentMatch && req.method === "GET") {
      const id = parseInt(buildAddComponentMatch[1], 10);
      const page = await buildAddComponentPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // GET /builds/:id/edit
    const buildEditMatch = path.match(/^\/builds\/(\d+)\/edit$/);
    if (buildEditMatch && req.method === "GET") {
      const id = parseInt(buildEditMatch[1], 10);
      const page = await buildEditPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // GET /builds/:id/photo
    const buildPhotoPageMatch = path.match(/^\/builds\/(\d+)\/photo$/);
    if (buildPhotoPageMatch && req.method === "GET") {
      const id = parseInt(buildPhotoPageMatch[1], 10);
      const page = await buildPhotoPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // POST /builds/:id/components/add
    const buildAddComponentPost = path.match(/^\/builds\/(\d+)\/components\/add$/);
    if (buildAddComponentPost && req.method === "POST") {
      const id = parseInt(buildAddComponentPost[1], 10);
      const form = await req.formData();
      const selections: { partId: number; qty: number }[] = [];
      for (const [key, value] of form.entries()) {
        const m = key.match(/^qty_(\d+)$/);
        if (!m) continue;
        const qty = Number(value.toString());
        if (qty === 0) continue; // zero marks an unselected picker row
        if (!Number.isInteger(qty) || qty < 1) {
          return new Response("Quantities must be whole numbers ≥ 1", { status: 400 });
        }
        selections.push({ partId: parseInt(m[1], 10), qty });
      }
      if (selections.length === 0) {
        return new Response("No quantities given", { status: 400 });
      }
      try {
        // One transaction — a bad selection must not leave a partial BOM.
        db.transaction(() => {
          for (const sel of selections) {
            addBuildComponent(db, id, sel.partId, sel.qty);
          }
        });
      } catch (err) {
        console.error("Failed to add component:", err);
        return new Response("Failed to add component", { status: 500 });
      }
      return new Response(null, { status: 303, headers: { Location: `/builds/${id}` } });
    }

    // POST /builds/:id/update
    const buildUpdateMatch = path.match(/^\/builds\/(\d+)\/update$/);
    if (buildUpdateMatch && req.method === "POST") {
      const id = parseInt(buildUpdateMatch[1], 10);
      const build = getBuild(db, id);
      if (!build) return new Response("Not Found", { status: 404 });
      const form = await req.formData();
      const status = form.get("status")?.toString() as PartStatus | undefined;
      const formFields: { class?: string | null; notes?: string; specs?: string } = {};
      if (form.has("class")) formFields.class = form.get("class")!.toString().trim() || null;
      if (form.has("notes")) formFields.notes = form.get("notes")!.toString();
      if (form.has("specs")) formFields.specs = form.get("specs")!.toString();
      try {
        updateBuild(db, id, { status, ...formFields });
      } catch (err) {
        console.error("Failed to update build:", err);
        return new Response("Failed to update build", { status: 500 });
      }
      return new Response(null, { status: 303, headers: { Location: `/builds/${id}` } });
    }

    // POST /builds/:id/photo
    const buildPhotoUploadMatch = path.match(/^\/builds\/(\d+)\/photo$/);
    if (buildPhotoUploadMatch && req.method === "POST") {
      const id = parseInt(buildPhotoUploadMatch[1], 10);
      const build = getBuild(db, id);
      if (!build) return new Response("Not Found", { status: 404 });
      const form = await req.formData();
      const file = form.get("photo");
      if (!file || !(file instanceof File) || file.size === 0) {
        return new Response("No file provided", { status: 400 });
      }
      const ext = file.name.split(".").pop() ?? "jpg";
      const filename = `build-${id}-${Date.now()}.${ext}`;
      await Deno.mkdir(PHOTOS_DIR, { recursive: true });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await Deno.writeFile(`${PHOTOS_DIR}/${filename}`, bytes);
      updateBuild(db, id, { photo_path: filename });
      return new Response(null, { status: 303, headers: { Location: `/builds/${id}` } });
    }

    // POST /builds/:id/components/remove
    const buildRemoveComponent = path.match(/^\/builds\/(\d+)\/components\/remove$/);
    if (buildRemoveComponent && req.method === "POST") {
      const id = parseInt(buildRemoveComponent[1], 10);
      const form = await req.formData();
      const componentId = parseInt(form.get("component_id")?.toString() ?? "", 10);
      if (!isNaN(componentId)) removeBuildComponent(db, id, componentId);
      return new Response(null, { status: 303, headers: { Location: `/builds/${id}` } });
    }

    // GET /parts/:id/photo
    const photoPageMatch = path.match(/^\/parts\/(\d+)\/photo$/);
    if (photoPageMatch && req.method === "GET") {
      const id = parseInt(photoPageMatch[1], 10);
      const page = await partPhotoPage(db, id);
      if (!page) return new Response("Not Found", { status: 404 });
      return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // POST /parts/:id/update
    const updateMatch = path.match(/^\/parts\/(\d+)\/update$/);
    if (updateMatch && req.method === "POST") {
      const id = parseInt(updateMatch[1], 10);
      const part = getPart(db, id);
      if (!part) return new Response("Not Found", { status: 404 });
      const form = await req.formData();
      const status = form.get("status")?.toString() as PartStatus | undefined;
      const quantityStr = form.get("quantity")?.toString();
      const quantityInt = quantityStr != null ? parseInt(quantityStr, 10) : NaN;
      const quantity = !isNaN(quantityInt) ? quantityInt : undefined;
      // Only include fields that use key-presence guards in updatePart when they
      // are actually present in the form, to avoid clearing existing values on
      // submissions from older form layouts that omit these fields.
      const formFields: {
        type?: PartType | null;
        notes?: string;
        specs?: string;
        location?: string;
      } = {};
      if (form.has("type")) {
        formFields.type = (form.get("type")!.toString() || null) as PartType | null;
      }
      if (form.has("notes")) formFields.notes = form.get("notes")!.toString();
      if (form.has("specs")) formFields.specs = form.get("specs")!.toString();
      if (form.has("location")) formFields.location = form.get("location")!.toString();
      // Gear / procurement fields — only include in update when present in the form
      // to avoid clearing values on old form submissions that lack these fields.
      const gearFields: {
        serial_number?: string | null;
        warranty_expiry?: string | null;
        purchase_date?: string | null;
        purchase_price?: number | null;
      } = {};
      if (form.has("serial_number")) {
        gearFields.serial_number = form.get("serial_number")!.toString().trim() || null;
      }
      if (form.has("warranty_expiry")) {
        gearFields.warranty_expiry = form.get("warranty_expiry")!.toString() || null;
      }
      if (form.has("purchase_date")) {
        gearFields.purchase_date = form.get("purchase_date")!.toString() || null;
      }
      if (form.has("purchase_price")) {
        const ppStr = form.get("purchase_price")!.toString().trim();
        gearFields.purchase_price = ppStr && !isNaN(parseFloat(ppStr)) ? parseFloat(ppStr) : null;
      }
      try {
        updatePart(db, id, { status, quantity, ...formFields, ...gearFields });
      } catch (err) {
        console.error("Failed to update part:", err);
        return new Response("Failed to update part", { status: 500 });
      }
      return new Response(null, { status: 303, headers: { Location: `/parts/${id}` } });
    }

    // POST /parts/:id/install
    const installMatch = path.match(/^\/parts\/(\d+)\/install$/);
    if (installMatch && req.method === "POST") {
      const id = parseInt(installMatch[1], 10);
      const part = getPart(db, id);
      if (!part) return new Response("Not Found", { status: 404 });
      const form = await req.formData();
      const buildId = parseInt(form.get("build_id")?.toString() ?? "", 10);
      const quantity = Number(form.get("quantity")?.toString() ?? "1");
      const role = form.get("role")?.toString().trim() || null;
      const notes = form.get("notes")?.toString() || undefined;
      if (isNaN(buildId)) return new Response("Build is required", { status: 400 });
      if (!Number.isInteger(quantity) || quantity < 1) {
        return new Response("Quantity must be a whole number ≥ 1", { status: 400 });
      }
      try {
        addBuildComponent(db, buildId, id, quantity, role, notes);
      } catch (err) {
        console.error("Failed to install part:", err);
        return new Response("Failed to install part", { status: 500 });
      }
      return new Response(null, { status: 303, headers: { Location: `/builds/${buildId}` } });
    }

    // POST /parts/:id/photo
    const photoUploadMatch = path.match(/^\/parts\/(\d+)\/photo$/);
    if (photoUploadMatch && req.method === "POST") {
      const id = parseInt(photoUploadMatch[1], 10);
      const part = getPart(db, id);
      if (!part) return new Response("Not Found", { status: 404 });
      const form = await req.formData();
      const file = form.get("photo");
      if (!file || !(file instanceof File) || file.size === 0) {
        return new Response("No file provided", { status: 400 });
      }
      const ext = file.name.split(".").pop() ?? "jpg";
      const filename = `${id}-${Date.now()}.${ext}`;
      await Deno.mkdir(PHOTOS_DIR, { recursive: true });
      const bytes = new Uint8Array(await file.arrayBuffer());
      await Deno.writeFile(`${PHOTOS_DIR}/${filename}`, bytes);
      updatePart(db, id, { photo_path: filename });
      return new Response(null, { status: 303, headers: { Location: `/parts/${id}` } });
    }

    // GET /photos/:filename
    const photoMatch = path.match(/^\/photos\/([a-zA-Z0-9_\-\.]+)$/);
    if (photoMatch && req.method === "GET") {
      const filename = photoMatch[1];
      try {
        const bytes = await Deno.readFile(`${PHOTOS_DIR}/${filename}`);
        const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
        const contentType = ext === "png"
          ? "image/png"
          : ext === "gif"
          ? "image/gif"
          : "image/jpeg";
        return new Response(bytes, { headers: { "Content-Type": contentType } });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }

    // GET /stock — stock check view (INV-10)
    if (path === "/stock" && req.method === "GET") {
      return new Response(stockPage(db), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // GET /builds/new — from-the-bin guided build form (INV-13)
    if (path === "/builds/new" && req.method === "GET") {
      return new Response(buildsNewPage(db), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // POST /builds/from-bin — assemble a build from stock (INV-13)
    if (path === "/builds/from-bin" && req.method === "POST") {
      const form = await req.formData();
      const name = form.get("name")?.toString().trim() ?? "";
      const notes = form.get("notes")?.toString().trim() || undefined;

      if (!name) {
        return new Response(buildsNewPage(db, "Build name is required"), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Collect non-zero qty_ entries as selections.
      // Require strictly digit-only suffixes and values to avoid silent coercion
      // of partial numbers (e.g. qty_12abc → 12, value "4.9" → 4).
      const selections: { part_id: number; qty: number }[] = [];
      for (const [key, value] of form.entries()) {
        if (!/^qty_\d+$/.test(key)) continue;
        const rawVal = value.toString();
        if (!/^\d+$/.test(rawVal)) continue;
        const partId = parseInt(key.slice(4), 10);
        const qty = parseInt(rawVal, 10);
        if (qty <= 0) continue;
        selections.push({ part_id: partId, qty });
      }

      if (selections.length === 0) {
        return new Response(buildsNewPage(db, "Select at least one part to include in the build"), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      let craftId: number;
      try {
        craftId = assembleBuild(db, { name, notes, selections });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to assemble build";
        return new Response(buildsNewPage(db, msg), {
          status: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response(null, { status: 303, headers: { Location: `/builds/${craftId}` } });
    }

    return new Response("Not Found", { status: 404 });
  };
}

function withLogging(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const start = Date.now();
    const { method } = req;
    const path = new URL(req.url).pathname;
    try {
      const res = await handler(req);
      console.log(`${method} ${path} → ${res.status} (${Date.now() - start}ms)`);
      return res;
    } catch (err) {
      console.error(`${method} ${path} → ERROR`, err);
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}

// When run directly (not imported), start the server
if (import.meta.main) {
  const db = initDb(DB_PATH);
  const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);

  const server = Deno.serve(
    {
      port,
      onListen: ({ port, hostname }) => {
        console.log(`FPV Inventory running on http://${hostname}:${port}`);
      },
    },
    withLogging(makeHandler(db)),
  );

  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    await server.shutdown();
    db.close();
    console.log("Shutdown complete.");
  };

  Deno.addSignalListener("SIGTERM", shutdown);
  Deno.addSignalListener("SIGINT", shutdown);
}
