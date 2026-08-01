// DC Redesign v2 · ใบรับสินค้า — list. shell ครีม/ฟ้า ตาม prototype isGRN.
//   แยก 2 แท็บ (CEO 2026-08-01): ?tab=po (ค่าเริ่มต้น) = รับจากสั่งซื้อ · ?tab=transfer = รับจากใบโอน
//   • แท็บ PO — "รอรับเข้า" (PO ถึงโกดัง AT_WAREHOUSE) + "ประวัติการรับเข้า" (ตาราง GRN)
//   • แท็บ ใบโอน — ใบโอนที่ "รับเข้าคลังแล้ว" (destType=WAREHOUSE · CONFIRMED/AUTO_UNVERIFIED)
//     + แบนเนอร์ถ้ามีใบโอนกำลังส่งเข้าคลัง (IN_TRANSIT) รอยืนยันรับ → กดไปแท็บใบโอนเดิม
//   หมายเหตุ data model: ของที่รับจากใบโอน "ไม่ได้" อยู่ในตาราง dcGoodsReceipt (คนละตาราง) →
//     แท็บใบโอนดึงจาก dcTransfer โดยตรง (อ่านอย่างเดียว · ไม่แตะ DB)
import Link from "next/link";
import { ScanLine, ArrowRight, PackageCheck, Truck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { DcPoStatus, DcTransferDestType, DcTransferStatus } from "@/lib/generated/prisma/enums";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { DcDeleteButton } from "@/app/(admin)/dc/_components/dc-delete-button";
import { getDcOfficeChrome, DC_ROLE_LABEL } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DcDocsSubnav } from "@/components/dc/docs-subnav";
import { DataTable } from "@/components/ui/data-table";
import { ReceiptsSourceTabs, type ReceiptSource } from "./receipts-source-tabs";

export const dynamic = "force-dynamic";

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit" }).format(d);
}

const statusPill = (ok: boolean) => (
  <span
    style={{
      fontSize: 11,
      fontWeight: 600,
      color: ok ? "#1F8A55" : "#B45309",
      background: ok ? "#E1F0E8" : "#FEF1DE",
      padding: "2px 9px",
      borderRadius: 20,
      whiteSpace: "nowrap",
    }}
  >
    {ok ? "รับครบ" : "รับไม่ครบ"}
  </span>
);

export default async function DcReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const canDelete = isSuperAdmin(ctx.session.user.role); // ลบใบรับ = super_admin เท่านั้น

  const sp = await searchParams;
  const tab: ReceiptSource = sp?.tab === "transfer" ? "transfer" : "po";

  const chrome = await getDcOfficeChrome(orgId);

  const shellProps = {
    active: "grn" as const,
    warehouseName: ctx.activeWarehouse?.name ?? "DC คลังกลาง",
    userName: ctx.session.user.name || ctx.session.user.email || "ผู้ใช้",
    userRole: DC_ROLE_LABEL[ctx.session.user.role] ?? ctx.session.user.role,
    badges: chrome.badges,
    taskStrip: chrome.taskStrip,
  };

  // ── หัวหน้า (ใช้ร่วม 2 แท็บ) ─────────────────────────────────────────────
  const header = (
    <>
      <DcDocsSubnav active="receipts" />
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em" }}>ใบรับสินค้า</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            {tab === "po"
              ? "รับของเข้าคลังตามใบสั่งซื้อ · เทียบจำนวนสั่ง–รับ · กดดูใบไหนก็ได้เพื่อตามว่าของไปไหนต่อ"
              : "ของที่โอนเข้าคลังจากคลังอื่น (ใบโอน) · เทียบจำนวนโอน–รับ · กดดูใบเพื่อตามรายละเอียด"}
          </p>
        </div>
        {tab === "po" ? (
          <Link href="/dc/office/receipts/new" style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--primary)", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, textDecoration: "none", boxShadow: "0 2px 6px rgba(31,79,214,.25)" }}>
            <ScanLine size={16} /> รับสินค้าเข้า
          </Link>
        ) : null}
      </div>
      <ReceiptsSourceTabs active={tab} />
    </>
  );

  // ── แท็บ: รับจากใบโอน ────────────────────────────────────────────────────
  if (tab === "transfer") {
    const [transfers, pendingInbound] = await Promise.all([
      prisma.dcTransfer.findMany({
        // รับเข้าคลัง = ปลายทางเป็นคลัง (WAREHOUSE) · รับแล้ว = CONFIRMED หรือ AUTO_UNVERIFIED (ระบบยืนยันอัตโนมัติ)
        where: {
          orgId,
          destType: DcTransferDestType.WAREHOUSE,
          status: { in: [DcTransferStatus.CONFIRMED, DcTransferStatus.AUTO_UNVERIFIED] },
        },
        orderBy: { dispatchedAt: "desc" },
        take: 100,
        select: {
          id: true, transferCode: true, status: true,
          fromWarehouseId: true, toWarehouseId: true,
          confirmedAt: true, dispatchedAt: true,
          lines: { select: { qty: true, qtyReceived: true } },
        },
      }),
      prisma.dcTransfer.count({
        where: { orgId, destType: DcTransferDestType.WAREHOUSE, status: DcTransferStatus.IN_TRANSIT },
      }),
    ]);

    // join ชื่อคลัง (ต้นทาง + ปลายทาง)
    const whIds = new Set<string>();
    for (const t of transfers) {
      whIds.add(t.fromWarehouseId);
      if (t.toWarehouseId) whIds.add(t.toWarehouseId);
    }
    const whs = whIds.size
      ? await prisma.dcWarehouse.findMany({ where: { id: { in: [...whIds] }, orgId }, select: { id: true, name: true } })
      : [];
    const whName = new Map(whs.map((w) => [w.id, w.name]));

    const rows = transfers.map((t) => {
      // AUTO_UNVERIFIED มักไม่มี qtyReceived (ระบบถือว่ารับครบ) → fallback = qty ที่ส่ง
      const recv = t.lines.reduce((s, l) => s + (l.qtyReceived ?? l.qty), 0);
      const exp = t.lines.reduce((s, l) => s + l.qty, 0);
      return {
        id: t.id,
        code: t.transferCode,
        from: t.fromWarehouseId ? (whName.get(t.fromWarehouseId) ?? "—") : "—",
        to: t.toWarehouseId ? (whName.get(t.toWarehouseId) ?? "—") : "—",
        date: fmtDate(t.confirmedAt ?? t.dispatchedAt),
        recvText: exp > 0 ? `${recv}/${exp}` : `${recv}`,
        ok: exp > 0 ? recv >= exp : true,
        auto: t.status === DcTransferStatus.AUTO_UNVERIFIED,
      };
    });

    return (
      <DcOfficeShell {...shellProps}>
        <div>
          {header}

          {pendingInbound > 0 ? (
            <Link
              href="/dc/office/transfers"
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa",
                borderRadius: 12, padding: "12px 14px", fontSize: 14, fontWeight: 700,
                marginBottom: 16, textDecoration: "none",
              }}
            >
              <span>มี {pendingInbound} ใบโอนกำลังส่งเข้าคลัง — รอกดยืนยันรับ</span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                ไปกดรับ <ArrowRight size={15} />
              </span>
            </Link>
          ) : null}

          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>ประวัติการรับเข้า (จากใบโอน)</div>
          <DataTable
            stickyHeader={false}
            columns={[
              { key: "code", header: "เลขใบโอน" },
              { key: "from", header: "จากคลัง" },
              { key: "to", header: "เข้าคลัง" },
              { key: "date", header: "วันที่รับ" },
              { key: "recv", header: "รับ", align: "center" },
              { key: "status", header: "สถานะ", align: "right" },
            ]}
            rows={rows.map((r) => ({
              key: r.id,
              href: `/dc/office/transfers/${r.id}`,
              cells: {
                code: <span className="font-semibold text-zinc-900">{r.code}</span>,
                from: <span className="text-zinc-700">{r.from}</span>,
                to: <span className="text-zinc-700">{r.to}</span>,
                date: <span className="text-zinc-500">{r.date}</span>,
                recv: <span className="tabular-nums text-zinc-500">{r.recvText}</span>,
                status: (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center", justifyContent: "flex-end" }}>
                    {r.auto ? (
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: "#6B7280", background: "#F1F3F6", padding: "2px 7px", borderRadius: 20, whiteSpace: "nowrap" }}>
                        ระบบยืนยันอัตโนมัติ
                      </span>
                    ) : null}
                    {statusPill(r.ok)}
                  </span>
                ),
              },
            }))}
            emptyState={
              <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: "40px 20px", textAlign: "center", color: "var(--muted)" }}>
                <Truck size={26} style={{ marginBottom: 8, opacity: 0.6 }} />
                <div style={{ fontSize: 14 }}>ยังไม่มีของที่รับจากใบโอน — เมื่อปลายทางกดยืนยันรับใบโอนเข้าคลัง จะมาโผล่ที่นี่</div>
              </div>
            }
          />
        </div>
      </DcOfficeShell>
    );
  }

  // ── แท็บ: รับจากสั่งซื้อ (PO) — ค่าเริ่มต้น ───────────────────────────────
  const [grns, pendingPos] = await Promise.all([
    prisma.dcGoodsReceipt.findMany({
      where: { orgId },
      orderBy: { receivedAt: "desc" },
      take: 100,
      select: {
        id: true, grnCode: true, warehouseId: true, poId: true, postStatus: true, receivedAt: true,
        shipment: { select: { shipmentCode: true } },
        lines: { select: { qtyReceived: true, qtyExpected: true } },
      },
    }),
    prisma.dcPurchaseOrder.findMany({
      // Wave 2 — ยุบด่าน "พร้อมรับเข้า" เป็น "ถึงโกดังแล้ว": ต้องรวม READY_TO_RECEIVE (legacy)
      //   ไม่งั้นใบเก่าที่ค้างสถานะนั้นจะหายจากลิสต์ "รอรับเข้า"
      where: { orgId, status: { in: [DcPoStatus.AT_WAREHOUSE, DcPoStatus.READY_TO_RECEIVE] } },
      orderBy: { orderedAt: "desc" },
      take: 6,
      select: { id: true, poCode: true, supplier: { select: { name: true } }, _count: { select: { lines: true } } },
    }),
  ]);

  // join คลัง + PO code (GRN เก็บแค่ id)
  const whIds = [...new Set(grns.map((g) => g.warehouseId))];
  const poIds = [...new Set(grns.map((g) => g.poId).filter((x): x is string => !!x))];
  const [whs, pos] = await Promise.all([
    whIds.length ? prisma.dcWarehouse.findMany({ where: { id: { in: whIds }, orgId }, select: { id: true, name: true } }) : Promise.resolve([]),
    poIds.length ? prisma.dcPurchaseOrder.findMany({ where: { id: { in: poIds }, orgId }, select: { id: true, poCode: true, supplier: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const whName = new Map(whs.map((w) => [w.id, w.name]));
  const poInfo = new Map(pos.map((p) => [p.id, p]));

  const rows = grns.map((g) => {
    const recv = g.lines.reduce((s, l) => s + l.qtyReceived, 0);
    const exp = g.lines.reduce((s, l) => s + l.qtyExpected, 0);
    const ok = exp > 0 ? recv >= exp : true;
    const po = g.poId ? poInfo.get(g.poId) : null;
    return {
      id: g.id, grnCode: g.grnCode,
      poCode: po?.poCode ?? "—",
      vendor: po?.supplier?.name ?? "—",
      wh: whName.get(g.warehouseId) ?? "—",
      date: fmtDate(g.receivedAt),
      recvText: exp > 0 ? `${recv}/${exp}` : `${recv}`,
      ok,
    };
  });

  return (
    <DcOfficeShell {...shellProps}>
      <div>
        {header}

        {/* รอรับเข้า */}
        {pendingPos.length > 0 ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
              รอรับเข้า <span style={{ fontSize: 12, fontWeight: 600, color: "#2E9D6B", background: "#DFF1E8", padding: "2px 9px", borderRadius: 20 }}>ถึงโกดังแล้ว</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: 14, marginBottom: 24 }}>
              {pendingPos.map((p) => (
                <div key={p.id} style={{ background: "#fff", border: "1px solid var(--border)", borderLeft: "3px solid #2E9D6B", borderRadius: 13, padding: "16px 18px", boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}>
                  <div className="num" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>{p.poCode}</div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{p.supplier?.name ?? "ไม่ระบุผู้ขาย"}</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 14 }}>{p._count.lines} รายการ · รอรับเข้าคลัง</div>
                  <Link href={`/dc/office/receipts/new?po=${p.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#2E9D6B", color: "#fff", borderRadius: 9, padding: 9, fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
                    เริ่มรับเข้า <ArrowRight size={15} />
                  </Link>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* ประวัติการรับเข้า — ตารางจริง (DataTable) แทน fake grid (#11: คอลัมน์ทับกันเวลาข้อความยาว) */}
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>ประวัติการรับเข้า</div>
        <DataTable
          stickyHeader={false}
          columns={[
            { key: "grn", header: "เลข GRN" },
            { key: "po", header: "อ้างอิง PO" },
            { key: "vendor", header: "ผู้ขาย" },
            { key: "wh", header: "คลัง" },
            { key: "date", header: "วันที่" },
            { key: "recv", header: "รับ", align: "center" },
            { key: "status", header: "สถานะ", align: "right" },
            ...(canDelete ? [{ key: "del", header: "ลบ", align: "right" as const }] : []),
          ]}
          rows={rows.map((g) => ({
            key: g.id,
            href: `/dc/office/receipts/${g.id}`,
            cells: {
              grn: <span className="font-semibold text-zinc-900">{g.grnCode}</span>,
              po: <span className="tabular-nums text-zinc-500">{g.poCode}</span>,
              vendor: <span className="text-zinc-700">{g.vendor}</span>,
              wh: <span className="text-zinc-500">{g.wh}</span>,
              date: <span className="text-zinc-500">{g.date}</span>,
              recv: <span className="tabular-nums text-zinc-500">{g.recvText}</span>,
              status: statusPill(g.ok),
              ...(canDelete
                ? { del: <DcDeleteButton docType="grn" docId={g.id} docCode={g.grnCode} size="sm" /> }
                : {}),
            },
          }))}
          emptyState={
            <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, padding: "40px 20px", textAlign: "center", color: "var(--muted)" }}>
              <PackageCheck size={26} style={{ marginBottom: 8, opacity: 0.6 }} />
              <div style={{ fontSize: 14 }}>ยังไม่มีใบรับสินค้า — เมื่อของถึงโกดัง กด “รับสินค้าเข้า” เพื่อสร้างใบแรก</div>
            </div>
          }
        />
      </div>
    </DcOfficeShell>
  );
}
