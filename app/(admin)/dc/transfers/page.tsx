// DC · หน้าคลัง · "ใบที่ฉันส่ง / รอรับเข้า" (transfer list — floor)
//   • สองแท็บ: "ที่ฉันส่งออก" (fromWarehouse=คลังนี้) + "รอรับเข้า" (toWarehouse=คลังนี้ · IN_TRANSIT)
//   • พนักงานหน้างานกดรับของเข้าได้ (ล็อกตามคลังที่ผูกสิทธิ์)
//   server shell: gate floor role + dc context → โหลด list รอบแรกฝั่ง server ส่งให้ client.

import Link from "next/link";
import { getDcContext } from "@/lib/dc/access";
import { requireDcFloor, canDcManage } from "@/lib/dc/role-guard";
import { DcModeSwitch } from "@/components/dc/mode-switch";
import { DcWarehousePicker } from "@/components/dc/warehouse-picker";
import {
  listMyOutgoingTransfers,
  listIncomingTransfers,
  listTransferPartyOptions,
  type TransferListRow,
  type TransferPartyOption,
} from "@/lib/dc/transfer-list-actions";
import { TransfersFloorView } from "./transfers-floor-view";

export const dynamic = "force-dynamic";

// filter อยู่บน URL (?from=&to=&dest=&src=&tab=) → server กรองจริงใน DB
// (ไม่ใช่กรองแค่ 100 ใบที่โหลดมา — ค้นใบเก่าเจอด้วย) · refresh/แชร์ลิงก์แล้วเห็นหน้าเดิม
export default async function DcTransfersFloorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const filters = {
    dateFrom: one(sp.from),
    dateTo: one(sp.to),
    dest: one(sp.dest),
    src: one(sp.src),
  };
  const tabParam = one(sp.tab);

  const ctx = await getDcContext();
  requireDcFloor(ctx.session.user.role);
  const canManage = canDcManage(ctx.session.user.role);

  let outgoing: TransferListRow[] = [];
  let incoming: TransferListRow[] = [];
  let destOptions: TransferPartyOption[] = [];
  let srcOptions: TransferPartyOption[] = [];
  let incomingTotal = 0;
  if (ctx.activeWarehouseId) {
    // โหลด options ก่อน — ใช้ sanitize คีย์ filter ที่ค้างบน URL จากคลังเก่า
    // (สลับคลังจาก picker → revalidatePath คง query เดิมไว้ → dest/src ของคลังเก่า
    //  ไม่มีในคลังใหม่ → ถ้าปล่อยผ่านจะได้ลิสต์ว่าง + dropdown ค่า blank งงฟรี)
    const optRes = await listTransferPartyOptions({ warehouseId: ctx.activeWarehouseId });
    destOptions = optRes.ok ? optRes.outgoing : [];
    srcOptions = optRes.ok ? optRes.incoming : [];
    incomingTotal = optRes.ok ? optRes.incomingTotal : 0;
    if (filters.dest && !destOptions.some((o) => o.key === filters.dest)) filters.dest = "";
    if (filters.src && !srcOptions.some((o) => o.key === filters.src)) filters.src = "";

    const [outRes, inRes] = await Promise.all([
      listMyOutgoingTransfers({
        warehouseId: ctx.activeWarehouseId,
        limit: 100,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        dest: filters.dest,
      }),
      listIncomingTransfers({
        warehouseId: ctx.activeWarehouseId,
        limit: 100,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        src: filters.src,
      }),
    ]);
    outgoing = outRes.ok ? outRes.rows : [];
    incoming = inRes.ok ? inRes.rows : [];
  }

  // แท็บเริ่มต้น: ตาม URL ก่อน · ไม่มีก็เด้งเข้า "รอรับเข้า" ถ้ามีของรอจริง (นับแบบไม่กรอง)
  const initialTab: "outgoing" | "incoming" =
    tabParam === "out" ? "outgoing"
    : tabParam === "in" ? "incoming"
    : incomingTotal > 0 ? "incoming" : "outgoing";

  return (
    <div className="dc-page">
      <div className="dc-head">
        <div>
          <div className="dc-h1">ใบที่ฉันส่ง / รอรับเข้า</div>
          <div className="dc-sub">
            {ctx.activeWarehouse
              ? `คลัง: ${ctx.activeWarehouse.name} · ดูของที่ส่งออก + ของที่รอรับเข้าคลังนี้`
              : "ยังไม่มีคลัง"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/dc"
            className="dc-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 14px",
              borderRadius: 10,
              border: "1.5px solid var(--dc-line)",
              background: "var(--dc-paper)",
              color: "var(--dc-ink)",
              fontWeight: 700,
              fontSize: 14,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            ← กลับหน้าคลัง
          </Link>
          <DcWarehousePicker warehouses={ctx.warehouses} activeId={ctx.activeWarehouseId} />
          <DcModeSwitch canManage={canManage} />
        </div>
      </div>

      {/* key = warehouseId → สลับคลังแล้ว remount client state (ช่องกรอง/แถวที่กาง)
          กัน state ค้างข้ามคลัง — filter เปลี่ยนปกติเป็น replace ไม่ remount (focus ไม่หลุด) */}
      <TransfersFloorView
        key={ctx.activeWarehouseId ?? "none"}
        outgoing={outgoing}
        incoming={incoming}
        destOptions={destOptions}
        srcOptions={srcOptions}
        incomingTotal={incomingTotal}
        filters={filters}
        initialTab={initialTab}
      />
    </div>
  );
}
