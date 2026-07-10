// DC · หลังบ้าน · ประวัติการลบเอกสาร (deletion history) — CEO 2026-07-10.
//   super_admin เท่านั้น (ลบเอกสารทำได้เฉพาะ super_admin → ประวัติก็จำกัดเช่นกัน).
//   แสดง log จาก DcDeletionLog: ประเภท · เลขที่ · การคืน (สต๊อก/TRCloud) · ลบโดย · เมื่อ · ถูกลบเพราะ.
//   snapshot เก็บไว้เพื่อกู้คืนในอนาคต (ยังไม่มีปุ่มกู้ในเฟสนี้ — display อย่างเดียว).
import { redirect } from "next/navigation";
import { Trash2, History } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { getDcContext } from "@/lib/dc/access";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";

export const dynamic = "force-dynamic";

// map ชนิดเอกสาร → ป้ายไทย (รวม shipment ที่ลบตาม PO)
const DOC_TYPE_LABEL: Record<string, string> = {
  po: "ใบสั่งซื้อ",
  grn: "ใบรับสินค้า",
  transfer: "ใบโอน",
  issue: "ใบเบิก",
  move: "ใบย้ายที่",
  shipment: "ใบขนส่ง",
};

function fmtDateTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** สรุป reversal (Json) เป็นภาษาไทยสั้น ๆ — คืนสต๊อกกี่รายการ · TRCloud ทำอะไร. */
function summarizeReversal(reversal: unknown): string {
  if (reversal == null || typeof reversal !== "object") return "—";
  const r = reversal as Record<string, unknown>;
  const parts: string[] = [];

  const moves = r.movementsReversed;
  if (typeof moves === "number" && moves > 0) parts.push(`คืนสต๊อก ${moves} รายการ`);

  const receipts = r.receiptsDeleted;
  if (typeof receipts === "number" && receipts > 0) parts.push(`ลบใบรับ ${receipts} ใบ`);

  const stock = r.stockReversed;
  if (typeof stock === "number" && stock > 0 && !(typeof moves === "number" && moves > 0)) {
    parts.push(`คืนสต๊อก ${stock} รายการ`);
  }

  const shipments = r.shipmentsDeleted;
  if (typeof shipments === "number" && shipments > 0) parts.push(`ลบใบขนส่ง ${shipments} ใบ`);

  // TRCloud action
  const trcloud = r.trcloud;
  if (trcloud != null && typeof trcloud === "object") {
    const action = (trcloud as Record<string, unknown>).action;
    if (action === "deleted") parts.push("ลบเอกสาร TRCloud");
    else if (action === "failed") parts.push("⚠️ TRCloud ต้องลบเอง");
  }

  // ใบย้ายที่ = ไม่กระทบจำนวน
  if (typeof r.note === "string" && parts.length === 0) return r.note;

  return parts.length > 0 ? parts.join(" · ") : "ไม่กระทบสต๊อก";
}

export default async function DcDeletionsPage() {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/dc/office");
  const orgId = session.user.org_id;

  const ctx = await getDcContext();
  const chrome = await getDcOfficeChrome(orgId);

  const logs = await prisma.dcDeletionLog.findMany({
    where: { orgId },
    orderBy: { deletedAt: "desc" },
    take: 200,
  });

  return (
    <DcOfficeShell {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: "-.01em", display: "inline-flex", alignItems: "center", gap: 9 }}>
            <History size={22} /> ประวัติการลบ
          </h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            เอกสารที่ถูกลบทั้งหมด — พร้อมรายละเอียดการคืนสต๊อก/บัญชี · เก็บสำเนาไว้เผื่อกู้คืน (เฉพาะผู้ดูแลสูงสุด)
          </p>
        </div>

        {logs.length === 0 ? (
          <div className="dc-card" style={{ textAlign: "center", padding: "44px 20px", color: "var(--dc-muted, #71717a)" }}>
            <Trash2 size={26} style={{ marginBottom: 8, opacity: 0.55 }} />
            <div style={{ fontSize: 14 }}>ยังไม่มีการลบเอกสาร — เมื่อมีการลบใบใด ๆ รายการจะมาปรากฏที่นี่</div>
          </div>
        ) : (
          <div className="dc-card" style={{ padding: 0, overflowX: "auto", overflowY: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                  <th style={cellHead}>ประเภทเอกสาร</th>
                  <th style={cellHead}>เลขที่</th>
                  <th style={cellHead}>รายละเอียดการคืน</th>
                  <th style={cellHead}>ลบโดย</th>
                  <th style={cellHead}>เมื่อ</th>
                  <th style={cellHead}>ถูกลบเพราะ</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                    <td style={cell}>
                      <span style={{ fontWeight: 700, color: "#18181b" }}>
                        {DOC_TYPE_LABEL[log.docType] ?? log.docType}
                      </span>
                    </td>
                    <td style={{ ...cell, fontVariantNumeric: "tabular-nums", color: "#3f3f46" }}>{log.docCode}</td>
                    <td style={{ ...cell, color: "#52525b" }}>{summarizeReversal(log.reversal)}</td>
                    <td style={{ ...cell, color: "#52525b" }}>{log.deletedByName ?? "—"}</td>
                    <td style={{ ...cell, color: "#52525b", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmtDateTime(log.deletedAt)}
                    </td>
                    <td style={{ ...cell, color: "#a1a1aa", fontSize: 13 }}>
                      {log.cascadedFromType
                        ? `ลบตาม ${DOC_TYPE_LABEL[log.cascadedFromType] ?? log.cascadedFromType} ${log.cascadedFromId ?? ""}`.trim()
                        : "ลบโดยตรง"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DcOfficeShell>
  );
}

const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};
