// DC Redesign v2 · รายละเอียดใบรับสินค้า (GRN) — มุมมองปฏิบัติการ (ไม่โชว์ต้นทุน · CEO เคาะซ่อน).
//   แต่ละบรรทัด: รับเข้า X · เสียหาย · "เหลือในโกดังตอนนี้ Y" (ระดับสินค้า) → กด "ดูการเดินของ" ไป timeline.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, PackageCheck, Boxes, Activity } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, DC_ROLE_LABEL } from "@/lib/dc/office-chrome";
import { getGrnRemaining } from "@/lib/dc/movement-tracing";
import { DcOfficeShell } from "@/components/dc/office-shell";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

const POST_PILL: Record<string, { label: string; c: string; bg: string }> = {
  PENDING: { label: "รอลงบัญชี", c: "#B45309", bg: "#FEF1DE" },
  POSTED: { label: "ลง TRCloud แล้ว", c: "#1F8A55", bg: "#E1F0E8" },
  FAILED: { label: "ส่งบัญชีไม่สำเร็จ", c: "#DC5B53", bg: "#FBE3E1" },
  NA: { label: "ไม่เกี่ยวข้อง", c: "#5B6477", bg: "#EEF1F5" },
};

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function SummaryCard({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${accent ? "#C7D8FF" : "var(--border)"}`, borderRadius: 15, padding: "16px 18px", boxShadow: "0 1px 2px rgba(30,42,68,.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink2)", fontSize: 12.5, marginBottom: 8 }}>
        <span style={{ width: 26, height: 26, borderRadius: 7, background: accent ? "var(--primary-soft)" : "var(--surf2)", color: accent ? "var(--primary)" : "var(--ink2)", display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</span>
        {label}
      </div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-.02em" }}>{value}</div>
      {hint ? <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}

export default async function DcGrnDetailPage({ params }: { params: Params }) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);
  const orgId = ctx.session.user.org_id;
  const { id } = await params;

  const [chrome, grn] = await Promise.all([
    getDcOfficeChrome(orgId),
    getGrnRemaining({ orgId, grnId: id }),
  ]);
  if (!grn) notFound();

  const post = POST_PILL[grn.postStatus] ?? POST_PILL.NA;
  const refBits = [grn.poCode ? `PO ${grn.poCode}` : null, grn.shipmentCode ? `ชิปเมนต์ ${grn.shipmentCode}` : null].filter(Boolean).join(" · ");
  const COLS = "2.4fr auto auto auto auto";

  return (
    <DcOfficeShell
      active="grn"
      warehouseName={ctx.activeWarehouse?.name ?? "DC คลังกลาง"}
      userName={ctx.session.user.name || ctx.session.user.email || "ผู้ใช้"}
      userRole={DC_ROLE_LABEL[ctx.session.user.role] ?? ctx.session.user.role}
      badges={chrome.badges}
      taskStrip={chrome.taskStrip}
    >
      <div>
        <Link href="/dc/office/receipts" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", marginBottom: 8, textDecoration: "none" }}>
          <ArrowLeft size={15} /> กลับรายการใบรับสินค้า
        </Link>

        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>ใบรับสินค้า {grn.grnCode}</h1>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: post.c, background: post.bg, padding: "3px 10px", borderRadius: 20 }}>{post.label}</span>
            </div>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 13.5 }}>
              {grn.warehouseName} · รับเมื่อ {fmtDateTime(grn.receivedAt)}{refBits ? ` · ${refBits}` : ""}
            </p>
          </div>
        </div>

        {/* summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
          <SummaryCard icon={<PackageCheck size={15} />} label="รับเข้ารวม (ใบนี้)" value={grn.totalReceived.toLocaleString("en-US")} hint={`${grn.lines.length} รายการ`} />
          <SummaryCard icon={<Boxes size={15} />} label="เหลือในโกดังตอนนี้" value={grn.totalOnHandNow.toLocaleString("en-US")} hint={`รวมทุกสินค้าในใบนี้ · คลัง ${grn.warehouseName}`} accent />
          <SummaryCard icon={<Activity size={15} />} label="ออกไปแล้ว (ประมาณ)" value={Math.max(0, grn.totalReceived - grn.totalOnHandNow).toLocaleString("en-US")} hint="โอน/เบิก/ขาย — กดดูรายตัวด้านล่าง" />
        </div>

        {/* lines */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>รายการในใบนี้</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>· “เหลือในโกดัง” = คงเหลือรวมของสินค้านั้นในคลังนี้ตอนนี้ (ระดับสินค้า)</span>
        </div>
        <div style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "0 1px 2px rgba(30,42,68,.04)", overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--border)", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", background: "#FCFAF7", alignItems: "center" }}>
            <span>สินค้า</span>
            <span style={{ textAlign: "right" }}>รับเข้า</span>
            <span style={{ textAlign: "right" }}>เสียหาย</span>
            <span style={{ textAlign: "right" }}>เหลือในโกดัง</span>
            <span style={{ textAlign: "right" }}>การเดินของ</span>
          </div>
          {grn.lines.map((l) => (
            <Link key={l.lineId} href={`/dc/office/products/${l.productId}/timeline`} className="dcx-trow" style={{ display: "grid", gridTemplateColumns: COLS, gap: 14, padding: "14px 20px", borderBottom: "1px solid var(--border)", alignItems: "center", fontSize: 14 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name}</div>
                <div className="num" style={{ fontSize: 11, color: "var(--muted)" }}>{l.sku} · หน่วย {l.unit}</div>
              </div>
              <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{l.qtyReceived.toLocaleString("en-US")}</span>
              <span className="num" style={{ textAlign: "right", color: l.qtyDamaged > 0 ? "#DC5B53" : "var(--muted)" }}>{l.qtyDamaged > 0 ? l.qtyDamaged.toLocaleString("en-US") : "—"}</span>
              <span className="num" style={{ textAlign: "right", fontWeight: 700, color: l.onHandNow <= 0 ? "#DC5B53" : "var(--ink)" }}>{l.onHandNow.toLocaleString("en-US")}</span>
              <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, color: "var(--primary)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>
                ดูการเดินของ <ChevronRight size={15} />
              </span>
            </Link>
          ))}
        </div>

        {grn.note ? (
          <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "var(--ink2)" }}>
            <b style={{ color: "var(--ink)" }}>หมายเหตุ:</b> {grn.note}
          </div>
        ) : null}
      </div>
    </DcOfficeShell>
  );
}
