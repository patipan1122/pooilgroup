// DC · หลังบ้าน · รายงานสต๊อก (server component)
//
// 4 แท็บ (server-driven via ?tab=) — ไม่ต้องใช้ client:
//   • overview  — KPI ภาพรวม + ตารางสต๊อกต่อคลัง
//   • low       — ของใกล้หมด (onHand < จุดสั่งซื้อ)
//   • moves     — ความเคลื่อนไหวล่าสุด (ledger)
//   • landed    — รายงานต้นทุนนำเข้า (landed cost) แยก goods/อากร/ค่าส่ง
//
// ตัวกรองคลัง (?wh=) — เห็นเฉพาะคลังที่มีสิทธิ์ (getDcContext.warehouses).
// ทุกค่า "มูลค่า" ติดป้าย "ประมาณการ · จริงที่ TRCloud" ตาม architecture ที่ล็อกไว้.
import Link from "next/link";
import { BarChart3, AlertTriangle, ArrowRightLeft, Coins, Package, Layers, Truck, FileWarning } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { canDcManage, requireDcManager } from "@/lib/dc/role-guard";
import {
  getDcOverview,
  getLowStock,
  getStockByWarehouse,
  getRecentMovements,
  getLandedCostReport,
  fmtSatang,
  EST_VALUE_NOTE,
} from "@/lib/dc/reports";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { KpiTile } from "@/components/ui/kpi-tile";
import { DataTable } from "@/components/ui/data-table";
import { Section } from "@/components/ui/section";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

type Tab = "overview" | "low" | "moves" | "landed";
const TABS: { key: Tab; label: string; icon: typeof BarChart3 }[] = [
  { key: "overview", label: "ภาพรวมสต๊อก", icon: BarChart3 },
  { key: "low", label: "ของใกล้หมด", icon: AlertTriangle },
  { key: "moves", label: "ความเคลื่อนไหว", icon: ArrowRightLeft },
  { key: "landed", label: "ต้นทุนนำเข้า", icon: Coins },
];

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(d);
}

const MOVE_TONE: Record<string, "success" | "danger" | "info" | "warning" | "neutral"> = {
  RECEIVE: "success",
  RETURN_IN: "success",
  TRANSFER_IN: "info",
  ISSUE: "danger",
  TRANSFER_OUT: "warning",
  COUNT_ADJUST: "warning",
  MOVE: "neutral",
};

export default async function DcReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; wh?: string }>;
}) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;

  const sp = await searchParams;
  const tab: Tab = (["overview", "low", "moves", "landed"] as const).includes(sp.tab as Tab)
    ? (sp.tab as Tab)
    : "overview";

  // ตัวกรองคลัง — เห็นเฉพาะคลังที่มีสิทธิ์
  const allowed = ctx.warehouses;
  const allowedIds = allowed.map((w) => w.id);
  const selectedWh = sp.wh && allowedIds.includes(sp.wh) ? sp.wh : null;
  const scopeIds = selectedWh ? [selectedWh] : allowedIds.length ? allowedIds : null;

  const ov = await getDcOverview(orgId, scopeIds);

  // helper: สร้าง href คงค่า tab/wh
  const hrefFor = (next: Partial<{ tab: Tab; wh: string | null }>) => {
    const t = next.tab ?? tab;
    const w = next.wh === undefined ? selectedWh : next.wh;
    const qs = new URLSearchParams();
    qs.set("tab", t);
    if (w) qs.set("wh", w);
    return `/dc/office/reports?${qs.toString()}`;
  };

  return (
    <div className="dc-page dc-page--wide">
      <div className="dc-head">
        <div>
          <div className="dc-h1">รายงานสต๊อก · DC คลังกลาง</div>
          <div className="dc-sub">ภาพรวม · ของใกล้หมด · ความเคลื่อนไหว · ต้นทุนนำเข้า</div>
        </div>
        <DcModeSwitch canManage={canDcManage(ctx.session.user.role)} />
      </div>

      {/* ตัวกรองคลัง */}
      {allowed.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-xs font-bold text-zinc-500">คลัง:</span>
          <Link
            href={hrefFor({ wh: null })}
            className={`h-7 px-3 rounded-md border text-xs font-bold inline-flex items-center ${
              selectedWh === null
                ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                : "bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            ทุกคลัง
          </Link>
          {allowed.map((w) => (
            <Link
              key={w.id}
              href={hrefFor({ wh: w.id })}
              className={`h-7 px-3 rounded-md border text-xs font-bold inline-flex items-center ${
                selectedWh === w.id
                  ? "bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]"
                  : "bg-white text-zinc-600 border-zinc-300 hover:bg-zinc-50"
              }`}
            >
              {w.name}
            </Link>
          ))}
        </div>
      )}

      {/* แท็บ */}
      <div className="flex items-center gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Link
              key={t.key}
              href={hrefFor({ tab: t.key })}
              className={`px-4 py-2.5 text-sm font-bold inline-flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap ${
                active
                  ? "border-[var(--color-brand-600)] text-[var(--color-brand-700)]"
                  : "border-transparent text-zinc-500 hover:text-zinc-800"
              }`}
            >
              <t.icon size={15} /> {t.label}
            </Link>
          );
        })}
      </div>

      {tab === "overview" && (
        <OverviewTab orgId={orgId} ov={ov} scopeWarehouseId={selectedWh} allowedIds={allowedIds} />
      )}
      {tab === "low" && <LowStockTab orgId={orgId} scopeIds={scopeIds} />}
      {tab === "moves" && <MovesTab orgId={orgId} scopeWarehouseId={selectedWh} />}
      {tab === "landed" && <LandedTab orgId={orgId} />}
    </div>
  );
}

// ── TAB: ภาพรวม ───────────────────────────────────────────────────────────────
async function OverviewTab({
  orgId,
  ov,
  scopeWarehouseId,
  allowedIds,
}: {
  orgId: string;
  ov: Awaited<ReturnType<typeof getDcOverview>>;
  scopeWarehouseId: string | null;
  allowedIds: string[];
}) {
  // ตารางสต๊อกต่อคลัง — ถ้าเลือกคลังเดียวก็แสดงคลังนั้น, ถ้าไม่เลือกใช้คลังแรกที่เห็นได้
  const showWh = scopeWarehouseId ?? allowedIds[0] ?? null;
  const stockRows = showWh ? await getStockByWarehouse(orgId, showWh) : [];

  return (
    <div className="flex flex-col gap-8">
      <Section number="01" label="ภาพรวม" title="สรุปสต๊อกในคลัง">
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
        >
          <KpiTile icon={<Package size={16} />} accent="brand" label="สินค้า (SKU มีของ)" value={ov.totalSkus} unit="รายการ" />
          <KpiTile icon={<Layers size={16} />} accent="info" label="ชิ้นในคลัง" value={ov.totalUnits} unit="ชิ้น" />
          <KpiTile icon={<Coins size={16} />} accent="success" label="มูลค่าประมาณ" value={fmtSatang(ov.estValueSatang)} isMoney sub={EST_VALUE_NOTE} />
          <KpiTile icon={<AlertTriangle size={16} />} accent={ov.lowStockCount > 0 ? "warning" : "zinc"} label="ของใกล้หมด" value={ov.lowStockCount} unit="รายการ" />
          <KpiTile icon={<Truck size={16} />} accent="zinc" label="กำลังส่ง" value={ov.inTransitUnits} unit="ชิ้น" />
          <KpiTile icon={<FileWarning size={16} />} accent={ov.pendingTrcloud > 0 ? "warning" : "zinc"} label="รอลง TRCloud" value={ov.pendingTrcloud} unit="ใบ" />
        </div>
      </Section>

      <Section
        number="02"
        label="ต่อคลัง"
        title="สต๊อกในคลัง (รายตัว)"
        description="มูลค่า = ประมาณการจากต้นทุนนำเข้าล่าสุด · มูลค่าจริงดูที่บัญชี (TRCloud)"
      >
        <DataTable
          columns={[
            { key: "name", header: "สินค้า" },
            { key: "type", header: "ประเภท" },
            { key: "loc", header: "ตำแหน่ง" },
            { key: "onHand", header: "คงเหลือ", align: "right" },
            { key: "inTransit", header: "กำลังส่ง", align: "right" },
            { key: "unit", header: "ต้นทุน/ชิ้น (ปม.)", align: "right" },
            { key: "value", header: "มูลค่า (ปม.)", align: "right" },
          ]}
          rows={stockRows.map((r) => ({
            key: r.productId,
            cells: {
              name: (
                <div>
                  <div className="font-bold text-zinc-900">{r.name}</div>
                  <div className="text-xs text-zinc-400 tabular-nums">{r.sku}</div>
                </div>
              ),
              type: <span className="text-zinc-600">{r.type}</span>,
              loc: <span className="text-zinc-600">{r.location ?? "—"}</span>,
              onHand: <span className="font-bold tabular-nums">{r.onHand.toLocaleString("th-TH")}</span>,
              inTransit: <span className="text-zinc-500 tabular-nums">{r.inTransit.toLocaleString("th-TH")}</span>,
              unit: <span className="text-zinc-500 tabular-nums">{r.landedUnitSatang > 0 ? fmtSatang(r.landedUnitSatang) : "—"}</span>,
              value: <span className="font-bold tabular-nums text-emerald-800">{r.estValueSatang > 0 ? fmtSatang(r.estValueSatang) : "—"}</span>,
            },
          }))}
          emptyState={
            <EmptyState
              icon={<Package size={26} />}
              title="ยังไม่มีสต๊อกในคลังนี้"
              description="เมื่อรับของเข้าคลัง รายการจะปรากฏที่นี่พร้อมมูลค่าประมาณการ"
            />
          }
        />
      </Section>
    </div>
  );
}

// ── TAB: ของใกล้หมด ───────────────────────────────────────────────────────────
async function LowStockTab({ orgId, scopeIds }: { orgId: string; scopeIds: string[] | null }) {
  const rows = await getLowStock(orgId, scopeIds);
  return (
    <Section
      number="01"
      label="ของใกล้หมด"
      title="สินค้าที่ต่ำกว่าจุดสั่งซื้อ"
      description="คงเหลือน้อยกว่าจุดสั่งซื้อที่ตั้งไว้ — ควรเตรียมสั่งเพิ่ม"
    >
      <DataTable
        columns={[
          { key: "name", header: "สินค้า" },
          { key: "wh", header: "คลัง" },
          { key: "onHand", header: "คงเหลือ", align: "right" },
          { key: "rop", header: "จุดสั่งซื้อ", align: "right" },
          { key: "status", header: "สถานะ", align: "right" },
        ]}
        rows={rows.map((r) => ({
          key: `${r.productId}-${r.warehouseName}`,
          cells: {
            name: (
              <div>
                <div className="font-bold text-zinc-900">{r.name}</div>
                <div className="text-xs text-zinc-400 tabular-nums">{r.sku}</div>
              </div>
            ),
            wh: <span className="text-zinc-600">{r.warehouseName}</span>,
            onHand: <span className="font-bold tabular-nums text-red-700">{r.onHand.toLocaleString("th-TH")}</span>,
            rop: <span className="text-zinc-500 tabular-nums">{r.reorderPoint.toLocaleString("th-TH")}</span>,
            status: (
              <StatusPill tone={r.onHand <= 0 ? "danger" : "warning"} size="sm" dot>
                {r.onHand <= 0 ? "หมด" : "ใกล้หมด"}
              </StatusPill>
            ),
          },
        }))}
        emptyState={
          <EmptyState
            icon={<AlertTriangle size={26} />}
            title="ไม่มีสินค้าใกล้หมด"
            description="ทุกสินค้ามีคงเหลือเหนือจุดสั่งซื้อ — สบายใจได้"
          />
        }
      />
    </Section>
  );
}

// ── TAB: ความเคลื่อนไหว ────────────────────────────────────────────────────────
async function MovesTab({ orgId, scopeWarehouseId }: { orgId: string; scopeWarehouseId: string | null }) {
  const rows = await getRecentMovements(orgId, {
    warehouseId: scopeWarehouseId ?? undefined,
    limit: 80,
  });
  return (
    <Section
      number="01"
      label="ความเคลื่อนไหว"
      title="รายการเคลื่อนไหวล่าสุด"
      description="บันทึกการรับ/เบิก/โอน/ปรับ/ย้าย — ใหม่สุดอยู่บน"
    >
      <DataTable
        columns={[
          { key: "when", header: "เวลา" },
          { key: "kind", header: "ประเภท" },
          { key: "product", header: "สินค้า" },
          { key: "wh", header: "คลัง" },
          { key: "qty", header: "จำนวน", align: "right" },
          { key: "after", header: "คงเหลือหลัง", align: "right" },
          { key: "actor", header: "โดย" },
        ]}
        rows={rows.map((m) => ({
          key: m.id,
          cells: {
            when: <span className="text-zinc-500 tabular-nums whitespace-nowrap">{fmtDateTime(m.occurredAt)}</span>,
            kind: (
              <StatusPill tone={MOVE_TONE[m.kind] ?? "neutral"} size="sm" dot>
                {m.kindLabel}
              </StatusPill>
            ),
            product: (
              <div>
                <div className="font-bold text-zinc-900">{m.productName}</div>
                <div className="text-xs text-zinc-400 tabular-nums">{m.sku}</div>
              </div>
            ),
            wh: <span className="text-zinc-600">{m.warehouseName}</span>,
            qty: (
              <span className={`font-bold tabular-nums ${m.qty < 0 ? "text-red-700" : m.qty > 0 ? "text-emerald-700" : "text-zinc-500"}`}>
                {m.qty > 0 ? "+" : ""}
                {m.qty.toLocaleString("th-TH")}
              </span>
            ),
            after: <span className="text-zinc-600 tabular-nums">{m.balanceAfter != null ? m.balanceAfter.toLocaleString("th-TH") : "—"}</span>,
            actor: <span className="text-zinc-500">{m.actorName ?? "—"}</span>,
          },
        }))}
        emptyState={
          <EmptyState
            icon={<ArrowRightLeft size={26} />}
            title="ยังไม่มีความเคลื่อนไหว"
            description="เมื่อมีการรับ/เบิก/โอนของ รายการจะปรากฏที่นี่"
          />
        }
      />
    </Section>
  );
}

// ── TAB: ต้นทุนนำเข้า ──────────────────────────────────────────────────────────
async function LandedTab({ orgId }: { orgId: string }) {
  const rows = await getLandedCostReport(orgId, { limit: 80 });
  return (
    <Section
      number="01"
      label="ต้นทุนนำเข้า"
      title="รายงานต้นทุน Landed (ต่อล็อตที่รับเข้า)"
      description="goods (สินค้า) + อากร + ค่าส่ง + เคลียร์ + ประกัน = ต้นทุนต่อชิ้น · VAT นำเข้าแยกขอคืน (ไม่รวมในต้นทุน)"
    >
      <DataTable
        columns={[
          { key: "when", header: "วันที่" },
          { key: "product", header: "สินค้า" },
          { key: "grn", header: "ใบรับ" },
          { key: "qty", header: "จำนวน", align: "right" },
          { key: "goods", header: "สินค้า", align: "right" },
          { key: "duty", header: "อากร", align: "right" },
          { key: "freight", header: "ค่าส่ง", align: "right" },
          { key: "unit", header: "ต้นทุน/ชิ้น", align: "right" },
          { key: "vat", header: "VAT ขอคืน", align: "right" },
        ]}
        rows={rows.map((r) => ({
          key: r.id,
          cells: {
            when: <span className="text-zinc-500 tabular-nums whitespace-nowrap">{fmtDate(r.createdAt)}</span>,
            product: (
              <div>
                <div className="font-bold text-zinc-900">{r.productName}</div>
                <div className="text-xs text-zinc-400 tabular-nums">{r.sku}</div>
              </div>
            ),
            grn: <span className="text-zinc-500 tabular-nums">{r.grnCode ?? "—"}</span>,
            qty: <span className="font-bold tabular-nums">{r.qty.toLocaleString("th-TH")}</span>,
            goods: <span className="text-zinc-600 tabular-nums">{fmtSatang(r.goodsThbSatang)}</span>,
            duty: <span className="text-zinc-500 tabular-nums">{r.dutyThbSatang > 0 ? fmtSatang(r.dutyThbSatang) : "—"}</span>,
            freight: <span className="text-zinc-500 tabular-nums">{r.freightThbSatang > 0 ? fmtSatang(r.freightThbSatang) : "—"}</span>,
            unit: <span className="font-bold tabular-nums text-zinc-900">{fmtSatang(r.landedUnitSatang)}</span>,
            vat: <span className="text-zinc-400 tabular-nums">{r.vatClaimableSatang > 0 ? fmtSatang(r.vatClaimableSatang) : "—"}</span>,
          },
        }))}
        emptyState={
          <EmptyState
            icon={<Coins size={26} />}
            title="ยังไม่มีข้อมูลต้นทุนนำเข้า"
            description="เมื่อรับของจากจีนเข้าคลังพร้อมคิดต้นทุน รายการ landed cost จะปรากฏที่นี่"
          />
        }
      />
    </Section>
  );
}
