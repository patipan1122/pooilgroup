// Playland · สต๊อก·คลังสินค้า — ศูนย์รวมที่เดียว (hub + tabs)
//   ภาพรวม · สินค้าในคลัง · ใบรับสินค้า · นับสต๊อก(รอบ) · ซ่อม·อะไหล่ · ความเคลื่อนไหว
// ทุกการเข้า-ออกบันทึกใน stock_movements · ใบรับ=purchases · รอบนับ=stock_counts (ดูย้อนหลังได้)
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { thb } from "@/lib/playland/format";
import { SeedSampleButton } from "@/components/playland/seed-sample-button";
import {
  Boxes, PackagePlus, Wrench, AlertTriangle, ArrowLeft, Cookie,
  LayoutGrid, ClipboardList, ReceiptText, History, ChevronRight, Settings2, Plus,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "สต๊อก · คลังสินค้า · Play a lot" };

const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";

const MOVE_LABEL: Record<string, { t: string; up: boolean }> = {
  PURCHASE_IN: { t: "รับเข้า", up: true },
  SALE_OUT: { t: "ขายออก", up: false },
  COUNT_ADJUST: { t: "ปรับนับ", up: true },
  PART_USED: { t: "เบิกซ่อม", up: false },
  RETURN_IN: { t: "คืนเข้า", up: true },
  MANUAL_ADJUST: { t: "ปรับมือ", up: true },
};

type TabKey = "overview" | "items" | "receipts" | "counts" | "repairs" | "movements";
const TABS: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: "overview", label: "ภาพรวม", icon: LayoutGrid },
  { key: "items", label: "สินค้าในคลัง", icon: Boxes },
  { key: "receipts", label: "ใบรับสินค้า", icon: ReceiptText },
  { key: "counts", label: "นับสต๊อก", icon: ClipboardList },
  { key: "repairs", label: "ซ่อม · อะไหล่", icon: Wrench },
  { key: "movements", label: "ความเคลื่อนไหว", icon: History },
];

function dt(d: Date) {
  return new Date(d).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function dShort(d: Date) {
  return new Date(d).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export default async function StockPage({ searchParams }: { searchParams: Promise<{ branch?: string; tab?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  requirePlaylandManager(session.user.role);
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland/settings/branches");
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview");
  const q = (t: TabKey) => `/playland/stock?branch=${branchId}&tab=${t}`;

  // นับสินค้าไว้โชว์ปุ่มตัวอย่าง (ถ้าว่าง)
  const productCount = await prisma.playlandProduct.count({ where: { orgId, branchId, active: true } });

  return (
    <div style={{ height: "calc(100vh - 64px)", overflowY: "auto", background: "#F7F2EA", fontFamily: MITR, color: "#3A3026" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: "1px solid #ece5d8", flexWrap: "wrap" }}>
        <Link href="/playland/office" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#6b6052", textDecoration: "none", fontSize: 15 }}><ArrowLeft size={18} /> หลังบ้าน</Link>
        <div style={{ width: 1, height: 24, background: "#ece5d8" }} />
        <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.3rem", display: "flex", alignItems: "center", gap: 8 }}><Boxes size={22} /> สต๊อก · คลังสินค้า</div>
        {branches.length > 1 && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {branches.map((b) => (
              <Link key={b.id} href={`/playland/stock?branch=${b.id}&tab=${tab}`} style={{ padding: "6px 13px", borderRadius: 999, fontSize: 13, textDecoration: "none", background: b.id === branchId ? "#2D6CB1" : "#f4ede0", color: b.id === branchId ? "#fff" : "#6b6052" }}>{b.name}</Link>
            ))}
          </div>
        )}
      </header>

      {/* แถบแท็บ — เลื่อนแนวนอนได้บนมือถือ */}
      <div style={{ background: "#fff", borderBottom: "1px solid #ece5d8", padding: "0 16px", display: "flex", gap: 4, overflowX: "auto" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <Link key={t.key} href={q(t.key)} style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "13px 14px", fontSize: 14.5, fontWeight: on ? 600 : 400,
              color: on ? "#2D6CB1" : "#8a7f70", textDecoration: "none", borderBottom: on ? "2.5px solid #2D6CB1" : "2.5px solid transparent", whiteSpace: "nowrap",
            }}><Icon size={16} /> {t.label}</Link>
          );
        })}
      </div>

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "24px 28px 56px" }}>
        {tab === "overview" && await OverviewTab({ orgId, branchId, productCount })}
        {tab === "items" && await ItemsTab({ orgId, branchId, branchIdForActions: branchId })}
        {tab === "receipts" && await ReceiptsTab({ orgId, branchId })}
        {tab === "counts" && await CountsTab({ orgId, branchId })}
        {tab === "repairs" && await RepairsTab({ orgId, branchId })}
        {tab === "movements" && await MovementsTab({ orgId, branchId })}
      </div>
    </div>
  );
}

// ════════ ภาพรวม ════════
async function OverviewTab({ orgId, branchId, productCount }: { orgId: string; branchId: string; productCount: number }) {
  const [items, movements] = await Promise.all([
    prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.playlandStockMovement.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 8, include: { product: { select: { name: true } } } }),
  ]);
  const low = items.filter((p) => p.reorderLevel > 0 && p.stock <= p.reorderLevel);
  const saleCount = items.filter((p) => p.kind === "SALE_ITEM").length;
  const partCount = items.filter((p) => p.kind === "SPARE_PART").length;
  const stockValue = items.reduce((a, p) => a + (p.costCents ?? 0) * p.stock, 0);

  const kpis = [
    { label: "ของใกล้หมด", value: String(low.length), tint: low.length > 0 ? { bg: "#fdeceb", fg: "#E74C3C" } : { bg: "#eaf3eb", fg: "#1F8A5B" }, icon: AlertTriangle },
    { label: "สินค้าขาย / อะไหล่", value: `${saleCount} / ${partCount}`, tint: { bg: "#eaf3f6", fg: "#2D6CB1" }, icon: Boxes },
    { label: "มูลค่าสต๊อก (ทุน)", value: thb(stockValue), tint: { bg: "#fdf3df", fg: "#a9791a" }, icon: Cookie },
  ];

  return (
    <div>
      {productCount === 0 && (
        <div style={{ background: "#fff", border: "1px dashed #cdbfa6", borderRadius: 18, padding: "26px 24px", textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.1rem", marginBottom: 6 }}>ยังไม่มีสินค้าในคลัง</div>
          <div style={{ fontSize: 14, color: "#8a7f70", marginBottom: 16 }}>กดเพิ่มชุดตัวอย่าง (ขนม·น้ำ + อะไหล่) เพื่อเห็นภาพการทำงาน · ลบออกเองได้</div>
          <SeedSampleButton branchId={branchId} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 28 }}>
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 18, padding: "20px 22px", display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: k.tint.bg, color: k.tint.fg, display: "grid", placeItems: "center", flexShrink: 0 }}><Icon size={24} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: "0.82rem", color: "#8a7f70", marginBottom: 3 }}>{k.label}</div>
                <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: "1.6rem", lineHeight: 1, color: "#3A3026", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ปุ่มลัด */}
      <div style={{ display: "flex", gap: 10, marginBottom: 28, flexWrap: "wrap" }}>
        <Link href={`/playland/stock/receive?branch=${branchId}`} style={btnPrimary}><PackagePlus size={16} /> รับของเข้า</Link>
        <Link href={`/playland/stock/count?branch=${branchId}`} style={btnGhost}><ClipboardList size={16} /> นับสต๊อกรอบใหม่</Link>
        <Link href={`/playland/repairs?branch=${branchId}`} style={btnGhost}><Wrench size={16} /> บันทึกซ่อม</Link>
      </div>

      <section style={{ marginBottom: 28 }}>
        <h2 style={sectionH}>⚠️ ของใกล้หมด (ถึงจุดสั่งซื้อ)</h2>
        {low.length === 0 ? (
          <div style={emptyCard}>สต๊อกเพียงพอทุกรายการ ✓</div>
        ) : (
          <div style={listCard}>
            {low.map((p) => (
              <div key={p.id} style={rowBase}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 16 }}>{p.name} {p.kind === "SPARE_PART" && <span style={chipPart}>อะไหล่</span>}</div>
                  <div style={{ fontSize: 13, color: "#8a7f70" }}>จุดสั่งซื้อ {p.reorderLevel}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                </div>
                <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 20, color: p.stock === 0 ? "#E74C3C" : "#a9791a" }}>{p.stock}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ ...sectionH, margin: 0 }}>ความเคลื่อนไหวล่าสุด</h2>
          <Link href={`/playland/stock?branch=${branchId}&tab=movements`} style={{ marginLeft: "auto", fontSize: 13, color: "#2D6CB1", textDecoration: "none" }}>ดูทั้งหมด →</Link>
        </div>
        {movements.length === 0 ? (
          <div style={emptyCard}>ยังไม่มีการเคลื่อนไหว</div>
        ) : (
          <div style={listCard}>
            {movements.map((m) => <MovementRow key={m.id} m={m} />)}
          </div>
        )}
      </section>
    </div>
  );
}

// ════════ สินค้าในคลัง ════════
async function ItemsTab({ orgId, branchId }: { orgId: string; branchId: string; branchIdForActions: string }) {
  const items = await prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <Link href="/playland/settings/products" style={btnPrimary}><Settings2 size={16} /> จัดการสินค้า (เพิ่ม/แก้)</Link>
        <SeedSampleButton branchId={branchId} compact />
      </div>
      {items.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีสินค้า · กด “เพิ่มสินค้าตัวอย่าง” หรือ “จัดการสินค้า” เพื่อเริ่ม</div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ ...itemGrid, padding: "11px 18px", background: "#f9f4ea", fontSize: 12.5, color: "#8a7f70", fontWeight: 500 }}>
            <div>สินค้า</div><div style={{ textAlign: "right" }}>คงเหลือ</div><div style={{ textAlign: "right" }}>จุดสั่งซื้อ</div><div style={{ textAlign: "right" }}>ทุน</div><div style={{ textAlign: "right" }}>ราคาขาย</div>
          </div>
          {items.map((p) => {
            const lowOn = p.reorderLevel > 0 && p.stock <= p.reorderLevel;
            return (
              <div key={p.id} style={{ ...itemGrid, padding: "12px 18px", borderTop: "1px solid #f2ebdd", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{p.name} {p.kind === "SPARE_PART" && <span style={chipPart}>อะไหล่</span>}</div>
                  <div style={{ fontSize: 12, color: "#a89c8b" }}>{p.category ?? "—"}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                </div>
                <div style={{ textAlign: "right", fontFamily: FREDOKA, fontWeight: 700, fontSize: 17, color: lowOn ? (p.stock === 0 ? "#E74C3C" : "#a9791a") : "#3A3026" }}>{p.stock}</div>
                <div style={{ textAlign: "right", fontSize: 14, color: "#8a7f70" }}>{p.reorderLevel || "—"}</div>
                <div style={{ textAlign: "right", fontSize: 14, color: "#8a7f70" }}>{p.costCents != null ? thb(p.costCents) : "—"}</div>
                <div style={{ textAlign: "right", fontSize: 14, fontWeight: 500 }}>{p.kind === "SPARE_PART" ? "—" : thb(p.priceCents)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════ ใบรับสินค้า ════════
async function ReceiptsTab({ orgId, branchId }: { orgId: string; branchId: string }) {
  const receipts = await prisma.playlandPurchase.findMany({
    where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 50,
    include: { _count: { select: { lines: true } } },
  });
  return (
    <div>
      <div style={{ display: "flex", marginBottom: 18 }}>
        <Link href={`/playland/stock/receive?branch=${branchId}`} style={btnPrimary}><Plus size={16} /> สร้างใบรับสินค้า</Link>
      </div>
      {receipts.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีใบรับสินค้า · กด “สร้างใบรับสินค้า” เมื่อซื้อของเข้า</div>
      ) : (
        <div style={listCard}>
          {receipts.map((r) => (
            <Link key={r.id} href={`/playland/stock/receipts/${r.id}`} style={{ ...rowBase, textDecoration: "none", color: "inherit" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{r.purchaseCode} {r.supplierName && <span style={{ color: "#8a7f70", fontWeight: 400 }}>· {r.supplierName}</span>}</div>
                <div style={{ fontSize: 12.5, color: "#a89c8b" }}>{dt(r.createdAt)} · {r._count.lines} รายการ{r.note ? ` · ${r.note}` : ""}</div>
              </div>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, color: "#2D6CB1", fontSize: 16 }}>{thb(r.totalCostCents)}</div>
              <ChevronRight size={16} color="#c9bfae" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════ นับสต๊อก (รอบ) ════════
async function CountsTab({ orgId, branchId }: { orgId: string; branchId: string }) {
  const counts = await prisma.playlandStockCount.findMany({
    where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 50,
  });
  return (
    <div>
      <div style={{ display: "flex", marginBottom: 18 }}>
        <Link href={`/playland/stock/count?branch=${branchId}`} style={btnPrimary}><Plus size={16} /> นับสต๊อกรอบใหม่</Link>
      </div>
      {counts.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีรอบการนับ · กด “นับสต๊อกรอบใหม่” เพื่อเริ่มรอบแรก</div>
      ) : (
        <div style={listCard}>
          {counts.map((c) => (
            <Link key={c.id} href={`/playland/stock/counts/${c.id}`} style={{ ...rowBase, textDecoration: "none", color: "inherit" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{c.countCode} <span style={{ color: "#8a7f70", fontWeight: 400 }}>· {c.countedByName ?? "—"}</span></div>
                <div style={{ fontSize: 12.5, color: "#a89c8b" }}>{dt(c.createdAt)} · ปรับ {c.itemsCounted} รายการ{c.note ? ` · ${c.note}` : ""}</div>
              </div>
              <div style={{ fontFamily: FREDOKA, fontWeight: 700, fontSize: 16, color: c.totalDiff === 0 ? "#8a7f70" : c.totalDiff > 0 ? "#1F8A5B" : "#E74C3C" }}>{c.totalDiff >= 0 ? "+" : ""}{c.totalDiff}</div>
              <ChevronRight size={16} color="#c9bfae" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════ ซ่อม · อะไหล่ ════════
async function RepairsTab({ orgId, branchId }: { orgId: string; branchId: string }) {
  const repairs = await prisma.playlandRepairLog.findMany({
    where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 50, include: { parts: true },
  });
  return (
    <div>
      <div style={{ display: "flex", marginBottom: 18 }}>
        <Link href={`/playland/repairs?branch=${branchId}`} style={btnPrimary}><Plus size={16} /> บันทึกซ่อม · เบิกอะไหล่</Link>
      </div>
      {repairs.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีประวัติซ่อม · กด “บันทึกซ่อม” เมื่อซ่อมเครื่อง</div>
      ) : (
        <div style={listCard}>
          {repairs.map((r) => (
            <div key={r.id} style={{ padding: "14px 18px", borderBottom: "1px solid #f2ebdd" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{r.machineLabel} <span style={{ fontSize: 12, color: "#a89c8b", fontWeight: 400 }}>· {r.repairCode}</span></div>
                <div style={{ fontFamily: FREDOKA, fontWeight: 600, color: "#a9791a" }}>{thb(r.partsCostCents)}</div>
                <div style={{ fontSize: 12, color: "#a89c8b" }}>{dShort(r.createdAt)}</div>
              </div>
              {r.description && <div style={{ fontSize: 13, color: "#8a7f70", marginTop: 2 }}>{r.description}</div>}
              {r.parts.length > 0 && <div style={{ fontSize: 13, color: "#6b6052", marginTop: 4 }}>อะไหล่: {r.parts.map((p) => `${p.productName}×${p.quantity}`).join(" · ")}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════ ความเคลื่อนไหว ════════
async function MovementsTab({ orgId, branchId }: { orgId: string; branchId: string }) {
  const movements = await prisma.playlandStockMovement.findMany({
    where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { name: true } } },
  });
  return movements.length === 0 ? (
    <div style={emptyCard}>ยังไม่มีการเคลื่อนไหว</div>
  ) : (
    <div style={listCard}>
      {movements.map((m) => <MovementRow key={m.id} m={m} showBalance />)}
    </div>
  );
}

// ── แถวความเคลื่อนไหว (ใช้ทั้งภาพรวม + ความเคลื่อนไหว) ──
function MovementRow({ m, showBalance }: { m: { id: string; kind: string; quantity: number; balanceAfter: number | null; createdAt: Date; note: string | null; product: { name: string } | null }; showBalance?: boolean }) {
  const lbl = MOVE_LABEL[m.kind] ?? { t: m.kind, up: true };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid #f2ebdd" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: lbl.up ? "#1F8A5B" : "#E74C3C", background: lbl.up ? "#eaf3eb" : "#fdeceb", padding: "2px 9px", borderRadius: 999, flexShrink: 0, width: 62, textAlign: "center" }}>{lbl.t}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{m.product?.name ?? "—"}{m.note ? <span style={{ color: "#a89c8b", fontSize: 12.5 }}> · {m.note}</span> : ""}</div>
      {showBalance && m.balanceAfter != null && <div style={{ fontSize: 12, color: "#a89c8b", width: 64, textAlign: "right" }}>เหลือ {m.balanceAfter}</div>}
      <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: 16, color: m.quantity >= 0 ? "#1F8A5B" : "#E74C3C", width: 48, textAlign: "right" }}>{m.quantity >= 0 ? "+" : ""}{m.quantity}</div>
      <div style={{ fontSize: 12, color: "#a89c8b", width: 100, textAlign: "right", flexShrink: 0 }}>{dt(m.createdAt)}</div>
    </div>
  );
}

// ── styles ──
const btnPrimary: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, background: "#2D6CB1", color: "#fff", textDecoration: "none", padding: "10px 16px", borderRadius: 999, fontWeight: 600, fontSize: 14 };
const btnGhost: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, background: "#fff", color: "#6b6052", textDecoration: "none", padding: "10px 16px", borderRadius: 999, fontWeight: 600, fontSize: 14, border: "1px solid #ece5d8" };
const sectionH: React.CSSProperties = { fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 12px 2px" };
const emptyCard: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, padding: "22px", color: "#8a7f70", fontSize: 15 };
const listCard: React.CSSProperties = { background: "#fff", border: "1px solid #ece5d8", borderRadius: 16, overflow: "hidden" };
const rowBase: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid #f2ebdd" };
const itemGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 76px 88px 90px 96px", gap: 10 };
const chipPart: React.CSSProperties = { fontSize: 12, color: "#a9791a", background: "#fdf3df", padding: "1px 8px", borderRadius: 999, marginLeft: 4 };
