// Playland · สต๊อก·คลังสินค้า — ศูนย์รวมที่เดียว (hub + tabs)
//   ภาพรวม · สินค้าในคลัง · ใบรับสินค้า · นับสต๊อก(รอบ) · ซ่อม·อะไหล่ · ความเคลื่อนไหว
// ทุกการเข้า-ออกบันทึกใน stock_movements · ใบรับ=purchases · รอบนับ=stock_counts (ดูย้อนหลังได้)
// สไตล์ Play a lot หลังบ้าน (พื้นขาว · maxWidth 1480 · อยู่ใน AdminShell เดิม) — CEO 2026-06-24
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { listBranches } from "@/lib/playland/queries";
import { thb } from "@/lib/playland/format";
import { SeedSampleButton } from "@/components/playland/seed-sample-button";
import {
  Boxes, PackagePlus, Wrench, AlertTriangle, Cookie,
  LayoutGrid, ClipboardList, ReceiptText, History, ChevronRight, Settings2, Plus,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "สต๊อก · คลังสินค้า · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", AMBER = "#a9791a", GREEN = "#1F8A5B", RED = "#E74C3C", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };

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
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) redirect("/playland/settings/branches");
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "overview");
  const q = (t: TabKey) => `/playland/stock?branch=${branchId}&tab=${t}`;

  // นับสินค้าไว้โชว์ปุ่มตัวอย่าง (ถ้าว่าง)
  const productCount = await prisma.playlandProduct.count({ where: { orgId, branchId, active: true } });

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK }}>
      {/* header strip — title + ตัวสลับสาขา + action buttons */}
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, display: "flex", alignItems: "center", gap: 8 }}><Boxes size={20} /> สต๊อก · คลังสินค้า</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>รับของเข้า · นับสต๊อก · ติดตามคงเหลือ ครบจบที่เดียว</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <BranchPills branches={branches} branchId={branchId} tab={tab} />
          {productCount > 0 && <SeedSampleButton branchId={branchId} compact />}
          <Link href={`/playland/stock/count?branch=${branchId}`} style={btn(false)}><ClipboardList size={15} /> นับสต๊อก</Link>
          <Link href={`/playland/stock/receive?branch=${branchId}`} style={btn(true)}><PackagePlus size={15} /> รับของเข้า</Link>
        </div>
      </header>

      {/* แถบแท็บ — เลื่อนแนวนอนได้บนมือถือ */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${LINE}`, padding: "0 16px", display: "flex", gap: 4, overflowX: "auto" }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <Link key={t.key} href={q(t.key)} style={{
              display: "inline-flex", alignItems: "center", gap: 7, padding: "13px 14px", fontSize: 14.5, fontWeight: on ? 600 : 400,
              color: on ? BLUE : MUTED, textDecoration: "none", borderBottom: on ? `2.5px solid ${BLUE}` : "2.5px solid transparent", whiteSpace: "nowrap",
            }}><Icon size={16} /> {t.label}</Link>
          );
        })}
      </div>

      <div style={{ maxWidth: 1480, margin: "0 auto", padding: "22px 32px 40px" }}>
        {tab === "overview" && await OverviewTab({ orgId, branchId, productCount })}
        {tab === "items" && await ItemsTab({ orgId, branchId })}
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
  const [items, movements, lastReceipt, lastCount] = await Promise.all([
    prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    prisma.playlandStockMovement.findMany({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, take: 8, include: { product: { select: { name: true } } } }),
    prisma.playlandPurchase.findFirst({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.playlandStockCount.findFirst({ where: { orgId, branchId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const low = items.filter((p) => p.reorderLevel > 0 && p.stock <= p.reorderLevel);
  const saleCount = items.filter((p) => p.kind === "SALE_ITEM").length;
  const partCount = items.filter((p) => p.kind === "SPARE_PART").length;
  const stockValue = items.reduce((a, p) => a + (p.costCents ?? 0) * p.stock, 0);
  const lastActivity = [lastReceipt?.createdAt, lastCount?.createdAt].filter(Boolean).sort((a, b) => +new Date(b!) - +new Date(a!))[0];

  const kpis = [
    { label: "ของใกล้หมด", value: String(low.length), tint: low.length > 0 ? { bg: "#fdeceb", fg: RED } : { bg: "#eaf3eb", fg: GREEN }, icon: AlertTriangle, mono: false },
    { label: "สินค้าขาย / อะไหล่", value: `${saleCount} / ${partCount}`, tint: { bg: "#eaf3f6", fg: BLUE }, icon: Boxes, mono: false },
    { label: "มูลค่าสต๊อก (ทุน)", value: thb(stockValue), tint: { bg: "#fdf3df", fg: AMBER }, icon: Cookie, mono: true },
    { label: "ใบรับ/รอบนับล่าสุด", value: lastActivity ? dShort(lastActivity) : "—", tint: { bg: "#f1edf6", fg: "#7a5ea8" }, icon: History, mono: false },
  ];

  return (
    <div>
      {productCount === 0 && (
        <div style={{ ...card, border: `1px dashed #cdbfa6`, padding: "26px 24px", textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.1rem", marginBottom: 6 }}>ยังไม่มีสินค้าในคลัง</div>
          <div style={{ fontSize: 14, color: MUTED, marginBottom: 16 }}>กดเพิ่มชุดตัวอย่าง (ขนม·น้ำ + อะไหล่) เพื่อเห็นภาพการทำงาน · ลบออกเองได้</div>
          <SeedSampleButton branchId={branchId} />
        </div>
      )}

      <div className="pl-kpi-row" style={{ marginBottom: 18 }}>
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} style={{ ...card, padding: "18px 20px", display: "flex", alignItems: "center", gap: 15 }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: k.tint.bg, color: k.tint.fg, display: "grid", placeItems: "center", flexShrink: 0 }}><Icon size={22} /></div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontFamily: k.mono ? MONO : FREDOKA, fontWeight: 700, fontSize: k.mono ? 22 : "1.55rem", lineHeight: 1, color: INK }}>{k.value}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pl-grid-2" style={{ alignItems: "start" }}>
        <section style={{ ...card, padding: 22 }}>
          <h2 style={sectionH}>⚠️ ของใกล้หมด (ถึงจุดสั่งซื้อ)</h2>
          {low.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 14, padding: "8px 2px" }}>สต๊อกเพียงพอทุกรายการ ✓</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {low.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 2px", borderTop: `1px solid #f2ebdd` }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, fontSize: 15 }}>{p.name} {p.kind === "SPARE_PART" && <span style={chipPart}>อะไหล่</span>}</div>
                    <div style={{ fontSize: 12.5, color: MUTED }}>จุดสั่งซื้อ {p.reorderLevel}{p.barcode ? ` · ${p.barcode}` : ""}</div>
                  </div>
                  <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 18, color: p.stock === 0 ? RED : AMBER }}>{p.stock}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ ...card, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ ...sectionH, margin: 0 }}>ความเคลื่อนไหวล่าสุด</h2>
            <Link href={`/playland/stock?branch=${branchId}&tab=movements`} style={{ marginLeft: "auto", fontSize: 13, color: BLUE, textDecoration: "none" }}>ดูทั้งหมด →</Link>
          </div>
          {movements.length === 0 ? (
            <div style={{ color: MUTED, fontSize: 14, padding: "8px 2px" }}>ยังไม่มีการเคลื่อนไหว</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {movements.map((m) => <MovementRow key={m.id} m={m} flush />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ════════ สินค้าในคลัง ════════
async function ItemsTab({ orgId, branchId }: { orgId: string; branchId: string }) {
  const items = await prisma.playlandProduct.findMany({ where: { orgId, branchId, active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }] });
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <Link href="/playland/settings/products" style={btn(true)}><Settings2 size={15} /> จัดการสินค้า (เพิ่ม/แก้)</Link>
        <SeedSampleButton branchId={branchId} compact />
      </div>
      {items.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีสินค้า · กด “เพิ่มสินค้าตัวอย่าง” หรือ “จัดการสินค้า” เพื่อเริ่ม</div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
         <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 720 }}>
          <div style={{ ...itemGrid, padding: "12px 18px", background: "#f9f7f2", fontSize: 12.5, color: MUTED, fontWeight: 500 }}>
            <div>สินค้า</div><div>หมวด</div><div style={{ textAlign: "right" }}>คงเหลือ</div><div style={{ textAlign: "right" }}>จุดสั่งซื้อ</div><div style={{ textAlign: "right" }}>ทุน/ชิ้น</div><div style={{ textAlign: "right" }}>ราคาขาย</div><div style={{ textAlign: "center" }}>สถานะ</div>
          </div>
          {items.map((p) => {
            const lowOn = p.reorderLevel > 0 && p.stock <= p.reorderLevel;
            return (
              <div key={p.id} style={{ ...itemGrid, padding: "12px 18px", borderTop: `1px solid #f2ebdd`, alignItems: "center", background: lowOn ? "#fdf6ec" : "transparent" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{p.name} {p.kind === "SPARE_PART" && <span style={chipPart}>อะไหล่</span>}</div>
                  <div style={{ fontSize: 12, color: "#a89c8b", fontFamily: MONO }}>{p.sku ?? p.barcode ?? "—"}</div>
                </div>
                <div style={{ fontSize: 13.5, color: MUTED }}>{p.category ?? "—"}</div>
                <div style={{ textAlign: "right", fontFamily: MONO, fontWeight: 700, fontSize: 16, color: lowOn ? (p.stock === 0 ? RED : AMBER) : INK }}>{p.stock}</div>
                <div style={{ textAlign: "right", fontSize: 14, color: MUTED, fontFamily: MONO }}>{p.reorderLevel || "—"}</div>
                <div style={{ textAlign: "right", fontSize: 14, color: MUTED, fontFamily: MONO }}>{p.costCents != null ? thb(p.costCents) : "—"}</div>
                <div style={{ textAlign: "right", fontSize: 14, fontFamily: MONO, fontWeight: 600, color: INK }}>{p.priceCents != null ? thb(p.priceCents) : "—"}</div>
                <div style={{ textAlign: "center" }}>
                  {lowOn
                    ? <span style={badge(p.stock === 0 ? RED : AMBER, p.stock === 0 ? "#fdeceb" : "#fdf3df")}>{p.stock === 0 ? "หมด" : "ใกล้หมด"}</span>
                    : <span style={badge(GREEN, "#eaf3eb")}>พอ</span>}
                </div>
              </div>
            );
          })}
          </div>
         </div>
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
        <Link href={`/playland/stock/receive?branch=${branchId}`} style={btn(true)}><Plus size={15} /> สร้างใบรับสินค้า</Link>
      </div>
      {receipts.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีใบรับสินค้า · กด “สร้างใบรับสินค้า” เมื่อซื้อของเข้า</div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          {receipts.map((r) => (
            <Link key={r.id} href={`/playland/stock/receipts/${r.id}`} style={{ ...rowBase, textDecoration: "none", color: "inherit" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{r.purchaseCode} {r.supplierName && <span style={{ color: MUTED, fontWeight: 400 }}>· {r.supplierName}</span>}</div>
                <div style={{ fontSize: 12.5, color: "#a89c8b" }}>{dt(r.createdAt)} · {r._count.lines} รายการ{r.note ? ` · ${r.note}` : ""}</div>
              </div>
              <div style={{ fontFamily: MONO, fontWeight: 700, color: BLUE, fontSize: 15 }}>{thb(r.totalCostCents)}</div>
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
        <Link href={`/playland/stock/count?branch=${branchId}`} style={btn(true)}><Plus size={15} /> นับสต๊อกรอบใหม่</Link>
      </div>
      {counts.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีรอบการนับ · กด “นับสต๊อกรอบใหม่” เพื่อเริ่มรอบแรก</div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          {counts.map((c) => (
            <Link key={c.id} href={`/playland/stock/counts/${c.id}`} style={{ ...rowBase, textDecoration: "none", color: "inherit" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 15 }}>{c.countCode} <span style={{ color: MUTED, fontWeight: 400 }}>· {c.countedByName ?? "—"}</span></div>
                <div style={{ fontSize: 12.5, color: "#a89c8b" }}>{dt(c.createdAt)} · ปรับ {c.itemsCounted} รายการ{c.note ? ` · ${c.note}` : ""}</div>
              </div>
              <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 15, color: c.totalDiff === 0 ? MUTED : c.totalDiff > 0 ? GREEN : RED }}>{c.totalDiff >= 0 ? "+" : ""}{c.totalDiff}</div>
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
        <Link href={`/playland/repairs?branch=${branchId}`} style={btn(true)}><Plus size={15} /> บันทึกซ่อม · เบิกอะไหล่</Link>
      </div>
      {repairs.length === 0 ? (
        <div style={emptyCard}>ยังไม่มีประวัติซ่อม · กด “บันทึกซ่อม” เมื่อซ่อมเครื่อง</div>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          {repairs.map((r) => (
            <div key={r.id} style={{ padding: "14px 18px", borderBottom: `1px solid #f2ebdd` }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <div style={{ flex: 1, fontWeight: 500, fontSize: 15 }}>{r.machineLabel} <span style={{ fontSize: 12, color: "#a89c8b", fontWeight: 400 }}>· {r.repairCode}</span></div>
                <div style={{ fontFamily: MONO, fontWeight: 600, color: AMBER }}>{thb(r.partsCostCents)}</div>
                <div style={{ fontSize: 12, color: "#a89c8b" }}>{dShort(r.createdAt)}</div>
              </div>
              {r.description && <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{r.description}</div>}
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
    <div style={{ ...card, overflow: "hidden" }}>
      {movements.map((m) => <MovementRow key={m.id} m={m} showBalance />)}
    </div>
  );
}

// ── ตัวสลับสาขา (URL param model — คุม ?branch= ของหน้าสต๊อก) ──
function BranchPills({ branches, branchId, tab }: { branches: { id: string; name: string }[]; branchId: string; tab: TabKey }) {
  if (branches.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {branches.map((b) => (
        <Link key={b.id} href={`/playland/stock?branch=${b.id}&tab=${tab}`} style={{
          padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, textDecoration: "none",
          background: b.id === branchId ? BLUE : "#fff", color: b.id === branchId ? "#fff" : MUTED, border: b.id === branchId ? "none" : `1px solid ${LINE}`,
        }}>{b.name}</Link>
      ))}
    </div>
  );
}

// ── แถวความเคลื่อนไหว (ใช้ทั้งภาพรวม + ความเคลื่อนไหว) ──
function MovementRow({ m, showBalance, flush }: { m: { id: string; kind: string; quantity: number; balanceAfter: number | null; createdAt: Date; note: string | null; product: { name: string } | null }; showBalance?: boolean; flush?: boolean }) {
  const lbl = MOVE_LABEL[m.kind] ?? { t: m.kind, up: true };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: flush ? "11px 2px" : "12px 18px", borderBottom: flush ? "none" : `1px solid #f2ebdd`, borderTop: flush ? `1px solid #f2ebdd` : "none" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: lbl.up ? GREEN : RED, background: lbl.up ? "#eaf3eb" : "#fdeceb", padding: "2px 9px", borderRadius: 999, flexShrink: 0, width: 62, textAlign: "center" }}>{lbl.t}</span>
      <div style={{ flex: 1, minWidth: 0, fontSize: 15 }}>{m.product?.name ?? "—"}{m.note ? <span style={{ color: "#a89c8b", fontSize: 12.5 }}> · {m.note}</span> : ""}</div>
      {showBalance && m.balanceAfter != null && <div style={{ fontSize: 12, color: "#a89c8b", width: 64, textAlign: "right", fontFamily: MONO }}>เหลือ {m.balanceAfter}</div>}
      <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 15, color: m.quantity >= 0 ? GREEN : RED, width: 48, textAlign: "right" }}>{m.quantity >= 0 ? "+" : ""}{m.quantity}</div>
      <div style={{ fontSize: 12, color: "#a89c8b", width: 100, textAlign: "right", flexShrink: 0, fontFamily: MONO }}>{dt(m.createdAt)}</div>
    </div>
  );
}

// ── styles ──
function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none", borderRadius: 9, padding: "8px 16px", fontSize: 13, fontWeight: 600,
    background: primary ? BLUE : "#fff", color: primary ? "#fff" : MUTED, border: primary ? "none" : `1px solid ${LINE}` };
}
function badge(fg: string, bg: string): React.CSSProperties {
  return { display: "inline-block", fontSize: 12, fontWeight: 600, color: fg, background: bg, padding: "2px 11px", borderRadius: 999 };
}
const sectionH: React.CSSProperties = { fontFamily: FREDOKA, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 8px 0" };
const emptyCard: React.CSSProperties = { ...card, padding: "22px", color: MUTED, fontSize: 15 };
const rowBase: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid #f2ebdd` };
const itemGrid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1.6fr 1fr 86px 90px 96px 96px 96px", gap: 12 };
const chipPart: React.CSSProperties = { fontSize: 12, color: AMBER, background: "#fdf3df", padding: "1px 8px", borderRadius: 999, marginLeft: 4 };
