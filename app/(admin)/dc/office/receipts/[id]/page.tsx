// DC Redesign v2 · รายละเอียดใบรับสินค้า (GRN) — มุมมองปฏิบัติการ (ไม่โชว์ต้นทุน · CEO เคาะซ่อน).
//   แต่ละบรรทัด: รูปสินค้า + สั่ง/คาดว่ารับ · รับจริง · ส่วนต่าง(ครบ/ขาด/เกิน) · เสียหาย ·
//   "เหลือในโกดังตอนนี้" (ระดับสินค้า) → กดแถวไป timeline "ดูการเดินของ".
//   หัวกระดาษ: ผู้ขาย + ลิงก์ใบสั่งซื้อต้นทาง (PO) กดเข้าดูได้.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, PackageCheck, Boxes, Activity, ExternalLink, Store } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, DC_ROLE_LABEL } from "@/lib/dc/office-chrome";
import { getGrnRemaining } from "@/lib/dc/movement-tracing";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { DataTable } from "@/components/ui/data-table";

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

// รูปสินค้า: ถ้า path ขึ้นต้น http ใช้ตรง ๆ · ไม่งั้น prefix ด้วย R2_PUBLIC_URL (เหมือน po-detail).
function imageUrl(path: string | null, r2Public: string): string | null {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return r2Public ? `${r2Public}/${path}` : null;
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

// thumbnail สินค้า ~40px + fallback กล่องเทาเมื่อไม่มีรูป.
function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)", flexShrink: 0 }} />;
  }
  return (
    <span style={{ width: 40, height: 40, borderRadius: 8, background: "var(--surf2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", flexShrink: 0 }}>
      <PackageCheck size={16} />
    </span>
  );
}

// ส่วนต่าง: เทียบรับจริง vs สั่ง/คาดว่ารับ → ครบ(เขียว) / ขาด N(แดง) / เกิน N(น้ำเงิน).
function DiffBadge({ expected, received }: { expected: number; received: number }) {
  const diff = received - expected;
  let label: string;
  let c: string;
  let bg: string;
  if (diff === 0) {
    label = "ครบ";
    c = "#1F8A55";
    bg = "#E1F0E8";
  } else if (diff < 0) {
    label = `ขาด ${Math.abs(diff).toLocaleString("en-US")}`;
    c = "#DC5B53";
    bg = "#FBE3E1";
  } else {
    label = `เกิน ${diff.toLocaleString("en-US")}`;
    c = "#1F4FD6";
    bg = "#E9F0FF";
  }
  return <span style={{ fontSize: 11.5, fontWeight: 600, color: c, background: bg, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap" }}>{label}</span>;
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

  const r2Public = process.env.R2_PUBLIC_URL ?? "";
  const post = POST_PILL[grn.postStatus] ?? POST_PILL.NA;
  const metaBits = [
    grn.shipmentCode ? `ชิปเมนต์ ${grn.shipmentCode}` : null,
  ].filter(Boolean).join(" · ");

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
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>ใบรับสินค้า {grn.grnCode}</h1>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: post.c, background: post.bg, padding: "3px 10px", borderRadius: 20 }}>{post.label}</span>
            </div>
            <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 13.5 }}>
              {grn.warehouseName} · รับเมื่อ {fmtDateTime(grn.receivedAt)}{metaBits ? ` · ${metaBits}` : ""}
            </p>
            {/* ผู้ขาย (#13) + ลิงก์ใบสั่งซื้อต้นทาง กดเข้าดู (#10) */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
              {grn.supplierName ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)" }}>
                  <Store size={14} style={{ color: "var(--muted)" }} />
                  ผู้ขาย: <b style={{ color: "var(--ink)", fontWeight: 600 }}>{grn.supplierName}</b>
                </span>
              ) : null}
              {grn.poId ? (
                <a
                  href={`/dc/office/purchasing/${grn.poId}`}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--primary)", background: "var(--primary-soft)", padding: "4px 11px", borderRadius: 20, textDecoration: "none" }}
                >
                  จากใบสั่งซื้อ: {grn.poCode ?? "PO"} (กดดู) <ExternalLink size={13} />
                </a>
              ) : null}
            </div>
          </div>
        </div>

        {/* summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
          <SummaryCard icon={<PackageCheck size={15} />} label="รับเข้ารวม (ใบนี้)" value={grn.totalReceived.toLocaleString("en-US")} hint={`${grn.lines.length} รายการ`} />
          <SummaryCard icon={<Boxes size={15} />} label="เหลือในโกดังตอนนี้" value={grn.totalOnHandNow.toLocaleString("en-US")} hint={`รวมทุกสินค้าในใบนี้ · คลัง ${grn.warehouseName}`} accent />
          <SummaryCard icon={<Activity size={15} />} label="ออกไปแล้ว (ประมาณ)" value={Math.max(0, grn.totalReceived - grn.totalOnHandNow).toLocaleString("en-US")} hint="โอน/เบิก/ขาย — กดดูรายตัวด้านล่าง" />
        </div>

        {/* lines */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>รายการในใบนี้</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>· “ส่วนต่าง” = รับจริงเทียบกับที่สั่ง · “เหลือในโกดัง” = คงเหลือรวมของสินค้านั้นในคลังนี้ตอนนี้</span>
        </div>

        <DataTable
          className="!rounded-[15px]"
          columns={[
            { key: "product", header: "สินค้า" },
            { key: "expected", header: "สั่ง/คาดว่ารับ", align: "right" },
            { key: "received", header: "รับจริง", align: "right" },
            { key: "diff", header: "ส่วนต่าง", align: "right" },
            { key: "damaged", header: "เสียหาย", align: "right" },
            { key: "onHand", header: "เหลือในโกดัง", align: "right" },
            { key: "move", header: "การเดินของ", align: "right" },
          ]}
          rows={grn.lines.map((l) => ({
            key: l.lineId,
            href: `/dc/office/products/${l.productId}/timeline`,
            cells: {
              product: (
                <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                  <Thumb src={imageUrl(l.imageR2Path, r2Public)} alt={l.name} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{l.name}</div>
                    <div className="num" style={{ fontSize: 11, color: "var(--muted)" }}>{l.sku} · หน่วย {l.unit}</div>
                  </div>
                </div>
              ),
              expected: <span className="num" style={{ color: "var(--ink2)" }}>{l.qtyExpected.toLocaleString("en-US")}</span>,
              received: <span className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{l.qtyReceived.toLocaleString("en-US")}</span>,
              diff: <DiffBadge expected={l.qtyExpected} received={l.qtyReceived} />,
              damaged: <span className="num" style={{ color: l.qtyDamaged > 0 ? "#DC5B53" : "var(--muted)" }}>{l.qtyDamaged > 0 ? l.qtyDamaged.toLocaleString("en-US") : "—"}</span>,
              onHand: <span className="num" style={{ fontWeight: 700, color: l.onHandNow <= 0 ? "#DC5B53" : "var(--ink)" }}>{l.onHandNow.toLocaleString("en-US")}</span>,
              move: (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 4, color: "var(--primary)", fontWeight: 600, fontSize: 12.5, whiteSpace: "nowrap" }}>
                  ดูการเดินของ <ChevronRight size={15} />
                </span>
              ),
            },
          }))}
        />

        {grn.note ? (
          <div style={{ marginTop: 14, background: "#fff", border: "1px solid var(--border)", borderRadius: 12, padding: "12px 16px", fontSize: 13, color: "var(--ink2)" }}>
            <b style={{ color: "var(--ink)" }}>หมายเหตุ:</b> {grn.note}
          </div>
        ) : null}
      </div>
    </DcOfficeShell>
  );
}
