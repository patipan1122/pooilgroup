"use client";

/**
 * ClawFleet v2 — Stock hub client island (back-office WMS).
 *
 * Tabbed: ภาพรวม · สินค้าในคลัง · ใบรับสินค้า · นับสต๊อก · ของหาย · ประวัติ.
 * Real forms wired to lib/clawfleet/stock-actions (receive / count / loss).
 * Photo attach via /api/r2/upload (server-side R2 — no CORS dependency).
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ic } from "@/components/clawfleet/v2/chrome";
import type { Branch } from "@/lib/clawfleet/v2-data";
import {
  receiveStock,
  submitStockCount,
  recordLoss,
  seedCfSampleProducts,
} from "@/lib/clawfleet/stock-actions";
import type {
  CfStockProductRow,
  CfReceiptRow,
  CfCountRow,
  CfLossRow,
  CfMovementRow,
} from "@/lib/clawfleet/stock-queries";

type FormProduct = { id: string; sku: string; barcode: string | null; name: string; unitCostCents: number };

type StockData = {
  overview: {
    lowCount: number;
    skuCount: number;
    inventoryValueCents: number;
    recentMovements: CfMovementRow[];
    lowProducts: CfStockProductRow[];
  };
  products: CfStockProductRow[];
  receipts: CfReceiptRow[];
  counts: CfCountRow[];
  losses: CfLossRow[];
  movements: CfMovementRow[];
  formProducts: FormProduct[];
};

type TabKey = "overview" | "items" | "receipts" | "counts" | "losses" | "movements";
const TABS: Array<{ key: TabKey; label: string; icon: Parameters<typeof Ic>[0]["name"] }> = [
  { key: "overview", label: "ภาพรวม", icon: "home" },
  { key: "items", label: "สินค้าในคลัง", icon: "package" },
  { key: "receipts", label: "ใบรับสินค้า", icon: "download" },
  { key: "counts", label: "นับสต๊อก", icon: "check" },
  { key: "losses", label: "ของหาย", icon: "alert" },
  { key: "movements", label: "ประวัติ", icon: "history" },
];

const baht = (cents: number) => `฿${Math.round(cents / 100).toLocaleString("th-TH")}`;
const dt = (d: Date | string) =>
  new Date(d).toLocaleString("th-TH", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const MOVE_LABEL: Record<string, { t: string; up: boolean }> = {
  RECEIPT_IN: { t: "รับเข้า", up: true },
  RECEIVE: { t: "รับเข้า", up: true },
  COUNT_ADJUST: { t: "ปรับนับ", up: true },
  LOAD_TO_MACHINE: { t: "เติมเข้าตู้", up: false },
  TRANSFER_IN: { t: "โอนเข้า", up: true },
  TRANSFER_OUT: { t: "โอนออก", up: false },
  WITHDRAW: { t: "เบิก", up: false },
  LOSS_ADJUST: { t: "ของหาย", up: false },
  ADJUST: { t: "ปรับมือ", up: true },
  COUNT_SNAPSHOT: { t: "นับ", up: true },
};

const LOSS_REASON_LABEL: Record<string, string> = {
  DAMAGE: "เสียหาย",
  THEFT: "หาย/ถูกขโมย",
  OBSOLETE: "หมดอายุ/เลิกใช้",
  OTHER: "อื่น ๆ",
};

export function StockHubClient({
  branches,
  activeBranchId,
  initialTab,
  data,
}: {
  branches: Branch[];
  activeBranchId: string;
  initialTab: string;
  data: StockData;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>(
    (TABS.find((t) => t.key === initialTab)?.key ?? "overview") as TabKey,
  );
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const branchInfo = branches.find((b) => b.id === activeBranchId);

  function flash(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  function switchBranch(id: string) {
    router.push(`/clawfleet/v2/stock?branch=${id}&tab=${tab}`);
  }

  return (
    <div className="cf-page">
      <div className="cf-page-head">
        <div>
          <div className="cf-eyebrow">Stock · คลังสินค้า</div>
          <h1 className="cf-h1">คลังสินค้า · {branchInfo?.name ?? "—"}</h1>
          <div className="cf-page-sub">
            รับเข้า · นับสต๊อก · ของหาย · โอน · ประวัติทุกการเคลื่อนไหว
          </div>
        </div>
        <div className="cf-page-actions">
          {data.formProducts.length === 0 && (
            <button
              type="button"
              className="cf-btn cf-btn-ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await seedCfSampleProducts();
                  if (r.ok) {
                    flash("ok", `เพิ่มสินค้าตัวอย่าง ${r.data.created} รายการ`);
                    router.refresh();
                  } else flash("err", r.error);
                })
              }
            >
              <Ic name="plus" size={14} /> เพิ่มสินค้าตัวอย่าง
            </button>
          )}
        </div>
      </div>

      {/* Branch picker chips */}
      <div className="cf-branch-chips">
        {branches.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`cf-branch-chip ${activeBranchId === b.id ? "is-active" : ""}`}
            onClick={() => switchBranch(b.id)}
          >
            <span className={`cf-branch-chip-flag cf-branch-flag-${b.tone}`}>{b.avatar}</span>
            <span>{b.name}</span>
            <span className="cf-dim">{b.machines}</span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="cf-tabs" style={{ marginTop: 4 }}>
        {TABS.map((t) => {
          const n =
            t.key === "items" ? data.products.length
            : t.key === "receipts" ? data.receipts.length
            : t.key === "counts" ? data.counts.length
            : t.key === "losses" ? data.losses.length
            : t.key === "movements" ? data.movements.length
            : 0;
          return (
            <button
              key={t.key}
              type="button"
              className={`cf-tab ${tab === t.key ? "is-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              <Ic name={t.icon} size={14} />
              {t.label}
              {n > 0 && <span className="cf-tab-n">{n}</span>}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 18 }}>
        {tab === "overview" && (
          <OverviewTab data={data} onGoTab={setTab} lowCount={data.overview.lowCount} />
        )}
        {tab === "items" && <ItemsTab products={data.products} />}
        {tab === "receipts" && (
          <ReceiptsTab
            branchId={activeBranchId}
            receipts={data.receipts}
            products={data.formProducts}
            pending={pending}
            startTransition={startTransition}
            flash={flash}
            refresh={() => router.refresh()}
          />
        )}
        {tab === "counts" && (
          <CountsTab
            branchId={activeBranchId}
            counts={data.counts}
            products={data.products}
            pending={pending}
            startTransition={startTransition}
            flash={flash}
            refresh={() => router.refresh()}
          />
        )}
        {tab === "losses" && (
          <LossesTab
            branchId={activeBranchId}
            losses={data.losses}
            products={data.formProducts}
            pending={pending}
            startTransition={startTransition}
            flash={flash}
            refresh={() => router.refresh()}
          />
        )}
        {tab === "movements" && <MovementsTab movements={data.movements} />}
      </div>

      {toast && (
        <div className={`cf-toast ${toast.kind === "ok" ? "cf-toast-approve" : "cf-toast-escalate"}`}>
          <span className="cf-toast-icon">{toast.kind === "ok" ? "✓" : "!"}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── TAB: ภาพรวม ─────────────────────────────── */
function OverviewTab({
  data,
  onGoTab,
  lowCount,
}: {
  data: StockData;
  onGoTab: (t: TabKey) => void;
  lowCount: number;
}) {
  const { overview } = data;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <div className={`cf-stat ${lowCount > 0 ? "cf-stat-amber" : ""}`}>
          <div className="cf-stat-head">
            <span className="cf-stat-label">ของใกล้หมด</span>
            <Ic name="alert" size={15} />
          </div>
          <div className="cf-stat-value">{lowCount}</div>
          <div className="cf-stat-foot"><span className="cf-stat-sub">SKU ต่ำกว่าเกณฑ์เติม</span></div>
        </div>
        <div className="cf-stat cf-stat-primary">
          <div className="cf-stat-head">
            <span className="cf-stat-label">มูลค่าคงคลัง</span>
            <Ic name="coins" size={15} />
          </div>
          <div className="cf-stat-value">{baht(overview.inventoryValueCents)}</div>
          <div className="cf-stat-foot"><span className="cf-stat-sub">รวมในคลัง + ในตู้</span></div>
        </div>
        <div className="cf-stat">
          <div className="cf-stat-head">
            <span className="cf-stat-label">รายการสินค้า</span>
            <Ic name="package" size={15} />
          </div>
          <div className="cf-stat-value">{overview.skuCount}</div>
          <div className="cf-stat-foot"><span className="cf-stat-sub">SKU ที่มีของในสาขานี้</span></div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="cf-btn cf-btn-primary" onClick={() => onGoTab("receipts")}>
          <Ic name="download" size={14} /> รับของเข้า
        </button>
        <button type="button" className="cf-btn cf-btn-ghost" onClick={() => onGoTab("counts")}>
          <Ic name="check" size={14} /> นับสต๊อก
        </button>
        <button type="button" className="cf-btn cf-btn-ghost" onClick={() => onGoTab("losses")}>
          <Ic name="alert" size={14} /> บันทึกของหาย
        </button>
      </div>

      {/* Low stock */}
      <div>
        <div className="cf-section-head">
          <h2 className="cf-section-title">ของใกล้หมด</h2>
        </div>
        {overview.lowProducts.length === 0 ? (
          <div className="cf-table" style={{ padding: 18, color: "var(--cf-text-3)", fontSize: 13 }}>
            ไม่มีของใกล้หมด · สต๊อกเพียงพอทุกรายการ
          </div>
        ) : (
          <div className="cf-table">
            <div className="cf-table-head" style={{ gridTemplateColumns: "1fr 90px 90px 100px" }}>
              <div>สินค้า</div>
              <div className="cf-table-r">คลังสาขา</div>
              <div className="cf-table-r">ในตู้</div>
              <div className="cf-table-r">ต้นทุน</div>
            </div>
            {overview.lowProducts.map((p) => (
              <div key={p.id} className="cf-table-row" style={{ gridTemplateColumns: "1fr 90px 90px 100px" }}>
                <div>{p.name}<span className="cf-dim" style={{ marginLeft: 6 }}>{p.sku}</span></div>
                <div className={`cf-table-r ${p.warehouse <= 0 ? "cf-text-red" : "cf-text-amber"}`}>{p.warehouse}</div>
                <div className="cf-table-r cf-dim">{p.inMachines}</div>
                <div className="cf-table-r">{baht(p.unitCostCents)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent movements */}
      <div>
        <div className="cf-section-head">
          <h2 className="cf-section-title">ความเคลื่อนไหวล่าสุด</h2>
          <button type="button" className="cf-btn cf-btn-sm cf-btn-ghost" onClick={() => onGoTab("movements")}>
            ดูทั้งหมด
          </button>
        </div>
        <MovementList movements={overview.recentMovements} />
      </div>
    </div>
  );
}

/* ─────────────────────────────── TAB: สินค้าในคลัง ─────────────────────────────── */
function ItemsTab({ products }: { products: CfStockProductRow[] }) {
  const [q, setQ] = useState("");
  const filtered = products.filter(
    (p) => !q || p.name.includes(q) || p.sku.toLowerCase().includes(q.toLowerCase()) || (p.barcode ?? "").includes(q),
  );
  const cols = "1fr 130px 80px 80px 90px 100px";
  return (
    <div>
      <input
        className="cf-input"
        placeholder="ค้นหาชื่อ / SKU / บาร์โค้ด…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 12, maxWidth: 360 }}
      />
      {filtered.length === 0 ? (
        <div className="cf-table" style={{ padding: 18, color: "var(--cf-text-3)", fontSize: 13 }}>
          ยังไม่มีสินค้าในคลังสาขานี้ · รับของเข้าก่อน
        </div>
      ) : (
        <div className="cf-table">
          <div className="cf-table-head" style={{ gridTemplateColumns: cols }}>
            <div>สินค้า</div>
            <div>บาร์โค้ด</div>
            <div className="cf-table-r">คลังสาขา</div>
            <div className="cf-table-r">ในตู้</div>
            <div className="cf-table-r">รวม</div>
            <div className="cf-table-r">ต้นทุน</div>
          </div>
          {filtered.map((p) => {
            const total = p.warehouse + p.inMachines;
            const low = p.warehouse <= p.reorderLevel;
            return (
              <div key={p.id} className="cf-table-row" style={{ gridTemplateColumns: cols }}>
                <div>{p.name}<span className="cf-dim" style={{ marginLeft: 6 }}>{p.sku}</span></div>
                <div className="cf-table-id">{p.barcode ?? "—"}</div>
                <div className={`cf-table-r ${low ? (p.warehouse <= 0 ? "cf-text-red" : "cf-text-amber") : ""}`}>{p.warehouse}</div>
                <div className="cf-table-r cf-dim">{p.inMachines}</div>
                <div className="cf-table-r">{total}</div>
                <div className="cf-table-r">{baht(p.unitCostCents)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── shared: photo attach ─────────────────────────────── */
function PhotoAttach({
  urls,
  setUrls,
}: {
  urls: string[];
  setUrls: (u: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/r2/upload", { method: "POST", body: fd });
      const j = await res.json();
      if (res.ok && j.publicUrl) setUrls([...urls, j.publicUrl]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <label className="cf-btn cf-btn-sm cf-btn-ghost" style={{ cursor: "pointer" }}>
        <Ic name="camera" size={14} /> {busy ? "กำลังอัป…" : "แนบรูป"}
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </label>
      {urls.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {urls.map((u, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={u} alt="แนบ" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 8, border: "1px solid var(--cf-border)" }} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── TAB: ใบรับสินค้า ─────────────────────────────── */
type RxLine = { productId: string; name: string; quantity: number; unitCostBaht: number };

function ReceiptsTab({
  branchId,
  receipts,
  products,
  pending,
  startTransition,
  flash,
  refresh,
}: {
  branchId: string;
  receipts: CfReceiptRow[];
  products: FormProduct[];
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  flash: (k: "ok" | "err", t: string) => void;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<RxLine[]>([]);
  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function addProduct(id: string) {
    const p = pmap.get(id);
    if (!p) return;
    setLines((ls) => {
      const ex = ls.find((l) => l.productId === id);
      if (ex) return ls.map((l) => (l.productId === id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...ls, { productId: id, name: p.name, quantity: 1, unitCostBaht: Math.round(p.unitCostCents / 100) }];
    });
  }
  const total = lines.reduce((s, l) => s + l.quantity * l.unitCostBaht, 0);

  function submit() {
    const valid = lines.filter((l) => l.quantity > 0);
    if (valid.length === 0) { flash("err", "ยังไม่ได้ใส่รายการ"); return; }
    startTransition(async () => {
      const r = await receiveStock({
        branchId,
        supplierName: supplier || undefined,
        note: note || undefined,
        photoUrls: photos.length ? photos : undefined,
        lines: valid.map((l) => ({ productId: l.productId, quantity: l.quantity, unitCostCents: Math.round(l.unitCostBaht * 100) })),
      });
      if (r.ok) {
        flash("ok", `รับของเข้าแล้ว · ${r.data.receiptCode}`);
        setOpen(false); setLines([]); setSupplier(""); setNote(""); setPhotos([]);
        refresh();
      } else flash("err", r.error);
    });
  }

  return (
    <div>
      <div className="cf-section-head">
        <h2 className="cf-section-title">ใบรับสินค้า</h2>
        <button type="button" className="cf-btn cf-btn-primary cf-btn-sm" onClick={() => setOpen((o) => !o)}>
          <Ic name="plus" size={14} /> {open ? "ปิดฟอร์ม" : "รับของเข้าใหม่"}
        </button>
      </div>

      {open && (
        <div className="cf-table" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <select className="cf-input" value={pick} onChange={(e) => { setPick(""); if (e.target.value) addProduct(e.target.value); }} style={{ maxWidth: 360 }}>
              <option value="">+ เลือกสินค้าเพิ่มในใบรับ…</option>
              {products.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.sku})</option>))}
            </select>
          </div>

          {lines.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div className="cf-table-head" style={{ gridTemplateColumns: "1fr 90px 110px 100px 40px", border: "none", background: "transparent", padding: "4px 0" }}>
                <div>สินค้า</div><div className="cf-table-r">จำนวน</div><div className="cf-table-r">ทุน/ชิ้น</div><div className="cf-table-r">รวม</div><div />
              </div>
              {lines.map((l) => (
                <div key={l.productId} style={{ display: "grid", gridTemplateColumns: "1fr 90px 110px 100px 40px", gap: 14, alignItems: "center", padding: "6px 0" }}>
                  <div style={{ fontSize: 13 }}>{l.name}</div>
                  <input className="cf-input" type="number" min={1} value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => x.productId === l.productId ? { ...x, quantity: Math.max(0, parseInt(e.target.value || "0", 10)) } : x))} style={{ textAlign: "right" }} />
                  <input className="cf-input" type="number" min={0} value={l.unitCostBaht} onChange={(e) => setLines((ls) => ls.map((x) => x.productId === l.productId ? { ...x, unitCostBaht: Math.max(0, parseInt(e.target.value || "0", 10)) } : x))} style={{ textAlign: "right" }} />
                  <div className="cf-table-r" style={{ fontSize: 13 }}>฿{(l.quantity * l.unitCostBaht).toLocaleString("th-TH")}</div>
                  <button type="button" className="cf-btn cf-btn-sm cf-btn-ghost" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}>✕</button>
                </div>
              ))}
              <div style={{ textAlign: "right", marginTop: 8, fontWeight: 600 }}>รวมต้นทุนรับเข้า: ฿{total.toLocaleString("th-TH")}</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <label className="cf-field"><span className="cf-field-label">ผู้ขาย / ที่มา (ไม่บังคับ)</span>
              <input className="cf-input" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="เช่น คลังกลางบางนา" />
            </label>
            <label className="cf-field"><span className="cf-field-label">หมายเหตุ (ไม่บังคับ)</span>
              <input className="cf-input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <div style={{ marginBottom: 12 }}>
            <span className="cf-field-label">แนบรูปใบเสร็จ / ของที่รับเข้า</span>
            <PhotoAttach urls={photos} setUrls={setPhotos} />
          </div>

          <button type="button" className="cf-btn cf-btn-primary" disabled={pending || lines.length === 0} onClick={submit}>
            {pending ? "กำลังบันทึก…" : "บันทึกรับของเข้า"}
          </button>
        </div>
      )}

      {receipts.length === 0 ? (
        <div className="cf-table" style={{ padding: 18, color: "var(--cf-text-3)", fontSize: 13 }}>ยังไม่มีใบรับสินค้า</div>
      ) : (
        <div className="cf-table">
          <div className="cf-table-head" style={{ gridTemplateColumns: "150px 1fr 90px 120px" }}>
            <div>เลขที่ใบ</div><div>ผู้ขาย / หมายเหตุ</div><div className="cf-table-r">รายการ</div><div className="cf-table-r">ต้นทุนรวม</div>
          </div>
          {receipts.map((r) => (
            <div key={r.id} className="cf-table-row" style={{ gridTemplateColumns: "150px 1fr 90px 120px" }}>
              <div><span className="cf-table-id">{r.receiptCode}</span><div className="cf-dim cf-table-time">{dt(r.createdAt)}</div></div>
              <div>{r.supplierName ?? "—"}{r.note ? <span className="cf-dim"> · {r.note}</span> : null}{r.photoCount > 0 ? <span className="cf-dim"> · 📎{r.photoCount}</span> : null}</div>
              <div className="cf-table-r">{r.itemsCount}</div>
              <div className="cf-table-r">{baht(r.totalCostCents)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── TAB: นับสต๊อก ─────────────────────────────── */
function CountsTab({
  branchId,
  counts,
  products,
  pending,
  startTransition,
  flash,
  refresh,
}: {
  branchId: string;
  counts: CfCountRow[];
  products: CfStockProductRow[];
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  flash: (k: "ok" | "err", t: string) => void;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");

  const dirty = useMemo(() => {
    const out: Array<{ id: string; before: number; after: number; diff: number }> = [];
    for (const p of products) {
      const v = counted[p.id];
      if (v === undefined || v === "") continue;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0 || n === p.warehouse) continue;
      out.push({ id: p.id, before: p.warehouse, after: n, diff: n - p.warehouse });
    }
    return out;
  }, [counted, products]);
  const totalDiff = dirty.reduce((s, d) => s + d.diff, 0);

  function submit() {
    if (dirty.length === 0) { flash("err", "ยังไม่มีรายการที่นับต่างจากระบบ"); return; }
    startTransition(async () => {
      const r = await submitStockCount({
        branchId,
        note: note || undefined,
        lines: dirty.map((d) => ({ productId: d.id, countedQty: d.after })),
      });
      if (r.ok) {
        flash("ok", r.data.anomaly ? `บันทึกแล้ว · นับต่างมาก → เด้งเข้า Anomaly` : `บันทึกการนับ ${r.data.adjusted} รายการ`);
        setOpen(false); setCounted({}); setNote("");
        refresh();
      } else flash("err", r.error);
    });
  }

  const filtered = products.filter((p) => !q || p.name.includes(q) || p.sku.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <div className="cf-section-head">
        <h2 className="cf-section-title">นับสต๊อก</h2>
        <button type="button" className="cf-btn cf-btn-primary cf-btn-sm" onClick={() => setOpen((o) => !o)}>
          <Ic name="plus" size={14} /> {open ? "ปิดฟอร์ม" : "นับสต๊อกรอบใหม่"}
        </button>
      </div>

      {open && (
        <div className="cf-table" style={{ padding: 16, marginBottom: 16 }}>
          <input className="cf-input" placeholder="พิมพ์เพื่อกรองสินค้า…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 12, maxWidth: 320 }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="cf-dim" style={{ fontSize: 13 }}>
              {dirty.length} รายการต่างจากระบบ {dirty.length > 0 && <strong className={totalDiff < 0 ? "cf-text-red" : "cf-text-emerald"}>({totalDiff >= 0 ? "+" : ""}{totalDiff})</strong>}
            </span>
            <button type="button" className="cf-btn cf-btn-primary cf-btn-sm" disabled={pending || dirty.length === 0} onClick={submit}>
              {pending ? "กำลังบันทึก…" : "บันทึกการนับ"}
            </button>
          </div>
          <label className="cf-field" style={{ marginBottom: 12 }}><span className="cf-field-label">หมายเหตุ (ไม่บังคับ)</span>
            <input className="cf-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น นับประจำเดือน · ของแตก" />
          </label>
          <div className="cf-table-head" style={{ gridTemplateColumns: "1fr 90px 110px 80px", border: "none", background: "transparent", padding: "4px 0" }}>
            <div>สินค้า</div><div className="cf-table-r">ระบบ</div><div className="cf-table-r">นับได้</div><div className="cf-table-r">ต่าง</div>
          </div>
          {filtered.map((p) => {
            const v = counted[p.id] ?? "";
            const n = v === "" ? null : parseInt(v, 10);
            const diff = n === null || !Number.isFinite(n) ? null : n - p.warehouse;
            return (
              <div key={p.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 110px 80px", gap: 14, alignItems: "center", padding: "6px 0" }}>
                <div style={{ fontSize: 13 }}>{p.name}<span className="cf-dim" style={{ marginLeft: 6 }}>{p.sku}</span></div>
                <div className="cf-table-r cf-dim">{p.warehouse}</div>
                <input className="cf-input" type="number" min={0} inputMode="numeric" value={v} onChange={(e) => setCounted((c) => ({ ...c, [p.id]: e.target.value }))} style={{ textAlign: "right" }} />
                <div className={`cf-table-r ${diff === null || diff === 0 ? "cf-dim" : diff < 0 ? "cf-text-red" : "cf-text-emerald"}`}>{diff === null ? "—" : diff > 0 ? `+${diff}` : diff}</div>
              </div>
            );
          })}
        </div>
      )}

      {counts.length === 0 ? (
        <div className="cf-table" style={{ padding: 18, color: "var(--cf-text-3)", fontSize: 13 }}>ยังไม่มีรอบการนับสต๊อก</div>
      ) : (
        <div className="cf-table">
          <div className="cf-table-head" style={{ gridTemplateColumns: "150px 1fr 90px 90px" }}>
            <div>เลขที่ใบ</div><div>ผู้นับ / หมายเหตุ</div><div className="cf-table-r">รายการ</div><div className="cf-table-r">ต่างรวม</div>
          </div>
          {counts.map((c) => (
            <div key={c.id} className="cf-table-row" style={{ gridTemplateColumns: "150px 1fr 90px 90px" }}>
              <div><span className="cf-table-id">{c.countCode}</span><div className="cf-dim cf-table-time">{dt(c.countedAt)}</div></div>
              <div>{c.countedByName ?? "—"}{c.note ? <span className="cf-dim"> · {c.note}</span> : null}</div>
              <div className="cf-table-r">{c.itemsCounted}</div>
              <div className={`cf-table-r ${c.totalDiff < 0 ? "cf-text-red" : c.totalDiff > 0 ? "cf-text-emerald" : ""}`}>{c.totalDiff > 0 ? `+${c.totalDiff}` : c.totalDiff}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── TAB: ของหาย ─────────────────────────────── */
type LossLine = { productId: string; name: string; qty: number };

function LossesTab({
  branchId,
  losses,
  products,
  pending,
  startTransition,
  flash,
  refresh,
}: {
  branchId: string;
  losses: CfLossRow[];
  products: FormProduct[];
  pending: boolean;
  startTransition: React.TransitionStartFunction;
  flash: (k: "ok" | "err", t: string) => void;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<LossLine[]>([]);
  const [reason, setReason] = useState<"DAMAGE" | "THEFT" | "OBSOLETE" | "OTHER">("DAMAGE");
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const pmap = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function addProduct(id: string) {
    const p = pmap.get(id);
    if (!p) return;
    setLines((ls) => ls.find((l) => l.productId === id) ? ls : [...ls, { productId: id, name: p.name, qty: 1 }]);
  }

  function submit() {
    const valid = lines.filter((l) => l.qty > 0);
    if (valid.length === 0) { flash("err", "ยังไม่ได้ใส่รายการของหาย"); return; }
    startTransition(async () => {
      const r = await recordLoss({
        branchId, reason, note: note || undefined,
        photoUrls: photos.length ? photos : undefined,
        lines: valid.map((l) => ({ productId: l.productId, qty: l.qty })),
      });
      if (r.ok) {
        flash("ok", `บันทึกของหายแล้ว · ${r.data.lossCode}`);
        setOpen(false); setLines([]); setNote(""); setPhotos([]);
        refresh();
      } else flash("err", r.error);
    });
  }

  return (
    <div>
      <div className="cf-section-head">
        <h2 className="cf-section-title">ของหาย / เสียหาย</h2>
        <button type="button" className="cf-btn cf-btn-primary cf-btn-sm" onClick={() => setOpen((o) => !o)}>
          <Ic name="plus" size={14} /> {open ? "ปิดฟอร์ม" : "บันทึกของหายใหม่"}
        </button>
      </div>

      {open && (
        <div className="cf-table" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 12, marginBottom: 12 }}>
            <label className="cf-field"><span className="cf-field-label">สาเหตุ</span>
              <select className="cf-input" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                {Object.entries(LOSS_REASON_LABEL).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
              </select>
            </label>
            <label className="cf-field"><span className="cf-field-label">หมายเหตุ (ไม่บังคับ)</span>
              <input className="cf-input" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <select className="cf-input" value={pick} onChange={(e) => { setPick(""); if (e.target.value) addProduct(e.target.value); }} style={{ maxWidth: 360, marginBottom: 12 }}>
            <option value="">+ เลือกสินค้าที่หาย/เสียหาย…</option>
            {products.map((p) => (<option key={p.id} value={p.id}>{p.name} ({p.sku})</option>))}
          </select>

          {lines.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {lines.map((l) => (
                <div key={l.productId} style={{ display: "grid", gridTemplateColumns: "1fr 100px 40px", gap: 14, alignItems: "center", padding: "6px 0" }}>
                  <div style={{ fontSize: 13 }}>{l.name}</div>
                  <input className="cf-input" type="number" min={1} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x) => x.productId === l.productId ? { ...x, qty: Math.max(0, parseInt(e.target.value || "0", 10)) } : x))} style={{ textAlign: "right" }} />
                  <button type="button" className="cf-btn cf-btn-sm cf-btn-ghost" onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}>✕</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <span className="cf-field-label">แนบรูปหลักฐาน / ของที่เสียหาย</span>
            <PhotoAttach urls={photos} setUrls={setPhotos} />
          </div>

          <button type="button" className="cf-btn cf-btn-primary" disabled={pending || lines.length === 0} onClick={submit}>
            {pending ? "กำลังบันทึก…" : "บันทึกของหาย"}
          </button>
        </div>
      )}

      {losses.length === 0 ? (
        <div className="cf-table" style={{ padding: 18, color: "var(--cf-text-3)", fontSize: 13 }}>ยังไม่มีรายการของหาย</div>
      ) : (
        <div className="cf-table">
          <div className="cf-table-head" style={{ gridTemplateColumns: "150px 130px 1fr 90px 110px" }}>
            <div>เลขที่ใบ</div><div>สาเหตุ</div><div>หมายเหตุ</div><div className="cf-table-r">รายการ</div><div className="cf-table-r">มูลค่า</div>
          </div>
          {losses.map((l) => (
            <div key={l.id} className="cf-table-row" style={{ gridTemplateColumns: "150px 130px 1fr 90px 110px" }}>
              <div><span className="cf-table-id">{l.lossCode}</span><div className="cf-dim cf-table-time">{dt(l.reportedAt)}</div></div>
              <div><span className="cf-pill cf-pill-red cf-pill-sm">{LOSS_REASON_LABEL[l.reason] ?? l.reason}</span></div>
              <div>{l.note ?? "—"}{l.photoCount > 0 ? <span className="cf-dim"> · 📎{l.photoCount}</span> : null}</div>
              <div className="cf-table-r">{l.itemsCount}</div>
              <div className="cf-table-r cf-text-red">−{baht(l.totalCostCents)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────── TAB: ประวัติ (ledger) ─────────────────────────────── */
function MovementsTab({ movements }: { movements: CfMovementRow[] }) {
  return (
    <div>
      <div className="cf-section-head">
        <h2 className="cf-section-title">ประวัติทุกการเคลื่อนไหว</h2>
      </div>
      <MovementList movements={movements} />
    </div>
  );
}

function MovementList({ movements }: { movements: CfMovementRow[] }) {
  if (movements.length === 0) {
    return <div className="cf-table" style={{ padding: 18, color: "var(--cf-text-3)", fontSize: 13 }}>ยังไม่มีความเคลื่อนไหว</div>;
  }
  const cols = "120px 1fr 90px 130px";
  return (
    <div className="cf-table">
      <div className="cf-table-head" style={{ gridTemplateColumns: cols }}>
        <div>ประเภท</div><div>สินค้า</div><div className="cf-table-r">จำนวน</div><div className="cf-table-r">เวลา</div>
      </div>
      {movements.map((m) => {
        const lab = MOVE_LABEL[m.type] ?? { t: m.type, up: m.qty >= 0 };
        return (
          <div key={m.id} className="cf-table-row" style={{ gridTemplateColumns: cols }}>
            <div><span className={`cf-pill ${lab.up ? "cf-pill-emerald" : "cf-pill-red"} cf-pill-sm`}>{lab.t}</span></div>
            <div>{m.productName}{m.reason ? <span className="cf-dim"> · {m.reason}</span> : null}</div>
            <div className={`cf-table-r ${m.qty >= 0 ? "cf-text-emerald" : "cf-text-red"}`} style={{ fontWeight: 600 }}>{m.qty > 0 ? `+${m.qty}` : m.qty}</div>
            <div className="cf-table-r cf-table-time">{dt(m.occurredAt)}</div>
          </div>
        );
      })}
    </div>
  );
}
