// เวฟ 2 — แผง "ประวัติล่าสุด (Log)" ข้างหน้า "เบิก · โอน · ย้ายที่" (ตาม mockup CEO)
// อ่านอย่างเดียว 100% — ข้อมูลจาก getRecentMovements (ledger เดียวกับหน้ารายงาน) · ไม่มีปุ่มเขียนอะไร
// server component ล้วน (ไม่มี "use client") — render พร้อมหน้า ไม่มี fetch ฝั่ง browser
import Link from "next/link";
import type { MovementRow } from "@/lib/dc/reports";

// โทนสีต่อประเภทความเคลื่อนไหว — ให้กวาดตาแล้วรู้ทันทีว่าของเข้า(เขียว)/ออก(แดง)/โอน(น้ำเงิน)/ย้าย(เทา)
const KIND_TONE: Record<string, { bg: string; fg: string; glyph: string }> = {
  ISSUE: { bg: "#fdecea", fg: "#c0392b", glyph: "↑" },
  TRANSFER_OUT: { bg: "#e8f0fe", fg: "#1d4ed8", glyph: "⇄" },
  TRANSFER_IN: { bg: "#e9f7ef", fg: "#1b7f4d", glyph: "↓" },
  RECEIVE: { bg: "#e9f7ef", fg: "#1b7f4d", glyph: "↓" },
  RETURN_IN: { bg: "#e9f7ef", fg: "#1b7f4d", glyph: "↓" },
  MOVE: { bg: "#f1f3f5", fg: "#5b6675", glyph: "⇢" },
  COUNT_ADJUST: { bg: "#fef7e6", fg: "#b7791f", glyph: "≈" },
};
const FALLBACK_TONE = { bg: "#f1f3f5", fg: "#5b6675", glyph: "•" };

// เวลาแบบไทย โซนกรุงเทพ (server บน Vercel เป็น UTC — ห้ามใช้ getHours ตรง ๆ)
const TZ = "Asia/Bangkok";
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, day: "numeric", month: "short", year: "2-digit" });

function fmtWhen(d: Date, now: Date): string {
  if (dayKeyFmt.format(d) === dayKeyFmt.format(now)) return `วันนี้ ${timeFmt.format(d)}`;
  return `${dateFmt.format(d)} ${timeFmt.format(d)}`;
}

export function DcRecentActivityPanel({ rows }: { rows: MovementRow[] }) {
  const now = new Date();
  return (
    <aside className="dc-card" style={{ padding: 14, minWidth: 0 }} aria-label="ประวัติล่าสุด">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800 }}>🕘 ประวัติล่าสุด (Log)</div>
        <Link
          href="/dc/office/reports"
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--primary, #1F4FD6)", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          ดูทั้งหมด →
        </Link>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted, #8a94a3)", padding: "14px 2px" }}>
          ยังไม่มีความเคลื่อนไหวในคลังนี้
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((m, i) => {
            const tone = KIND_TONE[m.kind] ?? FALLBACK_TONE;
            const before = m.balanceAfter != null ? m.balanceAfter - m.qty : null;
            return (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "9px 2px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border, #EBE3D8)",
                  alignItems: "flex-start",
                }}
              >
                <div
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: tone.bg,
                    color: tone.fg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 800,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {tone.glyph}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>
                    {m.actorName ?? "ระบบ"}{" "}
                    <span style={{ color: tone.fg }}>{m.kindLabel}</span>
                    {/* ย้ายที่ = qty 0 ใน ledger (ยอดรวมไม่เปลี่ยน) → ไม่โชว์ "0 ชิ้น" ให้งง */}
                    {m.qty !== 0 ? ` ${Math.abs(m.qty).toLocaleString()} ชิ้น` : ""}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--ink2, #5b6675)",
                      lineHeight: 1.35,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={`${m.productName} · ${m.sku}`}
                  >
                    {m.productName}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted, #8a94a3)", marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{fmtWhen(m.occurredAt, now)}</span>
                    {before != null && m.balanceAfter != null && m.qty !== 0 && (
                      <span
                        style={{
                          background: "var(--primary-soft, #eef3fe)",
                          color: "var(--ink2, #5b6675)",
                          borderRadius: 6,
                          padding: "1px 6px",
                          fontWeight: 700,
                          fontVariantNumeric: "tabular-nums",
                        }}
                        title="คงเหลือก่อน → หลัง"
                      >
                        {before.toLocaleString()} → {m.balanceAfter.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
