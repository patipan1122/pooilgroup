// Playland · รายงานกะปัจจุบัน (transaction log ต่อลูกค้า) — เข้าถึงได้จากการ์ด "ดูรายงาน" ในหน้าร้าน
//
// ต่างจาก app/(admin)/playland/reports/page.tsx (สรุปยอดรวมแยกวัน/หมวด สำหรับเจ้าของดูภาพรวม):
// หน้านี้โชว์ "ทีละลูกค้า" — ใครมา จ่ายเท่าไหร่ ซื้อขนมอะไร เล่นอยู่/ออกแล้ว วิธีจ่ายอะไร —
// default = กะที่เปิดอยู่ตอนนี้ของสาขา (ไม่มีกะเปิด → fallback เป็น "วันนี้") · เลือกวันย้อนหลังได้ (CEO 2026-10-10)
//
// รายได้ทั้งหมดอิง soldAt (เวลาขายจริง) เหมือน reports/page.tsx — ไม่ใช่ checkInAt — กันรายได้นับเหลื่อมวัน/กะ

import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "@/lib/playland/role-guard";
import { getPlaylandRole } from "@/lib/playland/position-resolve";
import { prisma } from "@/lib/prisma";
import { getBranchContext } from "@/lib/playland/branch-context";
import { thb, fmtDate, fmtTime, PAYMENT_METHOD_LABEL, paymentMethodLabel, sessionStatusLabel, sessionStatusChipClass } from "@/lib/playland/format";
import { BranchSwitcher } from "@/components/playland/branch-switcher";

export const dynamic = "force-dynamic";
export const metadata = { title: "รายงานกะปัจจุบัน · Play a lot" };

const INK = "#3A3026", MUTED = "#8a7f70", BLUE = "#2D6CB1", GREEN = "#1F8A5B", LINE = "#ece5d8";
const MONO = "'IBM Plex Mono', var(--font-plex-mono), ui-monospace, monospace";
const FREDOKA = "var(--font-fredoka), 'Fredoka', sans-serif";
const MITR = "var(--font-mitr), 'Mitr', sans-serif";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 16, boxShadow: "0 1px 3px rgba(58,48,38,.05)" };
const dateInput: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 9, padding: "7px 10px", fontSize: 13, fontFamily: MITR, color: INK, background: "#fff", outline: "none" };

const fmtD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default async function ShiftReportPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; date?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  // รายได้/เบอร์ลูกค้า = ผู้จัดการขึ้นไปเท่านั้น (เหมือน reports/page.tsx) — กันพนักงานเห็นรายได้รวมทุกคน
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;
  const { branches, activeId } = await getBranchContext(orgId, sp.branch);
  const branchId = activeId ?? "";

  const now = new Date();
  let rangeFrom: Date;
  let rangeTo: Date;
  let rangeLabel: string;

  if (sp.date) {
    rangeFrom = new Date(`${sp.date}T00:00:00+07:00`);
    rangeTo = new Date(`${sp.date}T23:59:59.999+07:00`);
    rangeLabel = fmtDate(rangeFrom);
  } else {
    const openShift = branchId
      ? await prisma.playlandShift.findFirst({
          where: { orgId, branchId, status: "OPEN" },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        })
      : null;
    if (openShift) {
      rangeFrom = openShift.startedAt;
      rangeTo = now;
      rangeLabel = `กะปัจจุบัน · เปิดตั้งแต่ ${fmtTime(openShift.startedAt)}`;
    } else {
      rangeFrom = new Date(now);
      rangeFrom.setHours(0, 0, 0, 0);
      rangeTo = new Date(now);
      rangeTo.setHours(23, 59, 59, 999);
      rangeLabel = "วันนี้ · ยังไม่เปิดกะ";
    }
  }

  const sales = await prisma.playlandSale.findMany({
    where: { orgId, ...(branchId ? { branchId } : {}), soldAt: { gte: rangeFrom, lte: rangeTo }, voidedAt: null },
    include: {
      lines: { select: { productName: true, quantity: true } },
      session: { select: { id: true, checkInAt: true, status: true, member: { select: { name: true, nickname: true } } } },
    },
    orderBy: { soldAt: "asc" },
  });

  interface CustomerRow {
    sessionId: string;
    name: string;
    checkInAt: Date;
    status: string;
    totalCents: number;
    methods: Set<string>;
    snacks: { name: string; qty: number }[];
  }
  const bySession = new Map<string, CustomerRow>();
  const walkins: { id: string; soldAt: Date; totalCents: number; method: string; items: string }[] = [];

  for (const s of sales) {
    if (s.session) {
      const key = s.session.id;
      const row: CustomerRow = bySession.get(key) ?? {
        sessionId: key,
        name: s.session.member?.nickname || s.session.member?.name || "น้อง",
        checkInAt: s.session.checkInAt,
        status: s.session.status,
        totalCents: 0,
        methods: new Set<string>(),
        snacks: [],
      };
      row.totalCents += s.totalCents;
      row.methods.add(s.paymentMethod);
      for (const l of s.lines) row.snacks.push({ name: l.productName, qty: l.quantity });
      bySession.set(key, row);
    } else {
      // ขายหน้าร้านไม่ผูกเด็ก (เช่น ขนมให้ผู้ปกครองที่ไม่ได้เช็คอิน) — ยังนับรายได้ แต่แยกตาราง
      walkins.push({
        id: s.id,
        soldAt: s.soldAt,
        totalCents: s.totalCents,
        method: s.paymentMethod,
        items: s.lines.map((l) => `${l.productName} x${l.quantity}`).join(", "),
      });
    }
  }
  const rows = Array.from(bySession.values()).sort((a, b) => a.checkInAt.getTime() - b.checkInAt.getTime());

  const totalCents = sales.reduce((a, s) => a + s.totalCents, 0);
  const byMethod = new Map<string, number>();
  for (const s of sales) byMethod.set(s.paymentMethod, (byMethod.get(s.paymentMethod) ?? 0) + s.totalCents);
  const methodRows = Array.from(byMethod.entries())
    .filter(([, v]) => v !== 0)
    .sort(([, a], [, b]) => b - a);

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const _bq = branchId ? `&branch=${branchId}` : "";
  const presets = [
    { label: "กะปัจจุบัน", href: `?${branchId ? `branch=${branchId}` : ""}` },
    { label: "วันนี้", href: `?date=${fmtD(today)}${_bq}` },
    { label: "เมื่อวาน", href: `?date=${fmtD(yesterday)}${_bq}` },
  ];

  return (
    <div className="pl-scroll" style={{ background: "#fbfbf9", fontFamily: MITR, color: INK, minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 28px", background: "#fff", borderBottom: `1px solid ${LINE}`, flexWrap: "wrap" }}>
        <div>
          <a href="/playland" style={{ fontSize: 13, color: MUTED, textDecoration: "none" }}>← กลับหน้าร้าน</a>
          <div style={{ fontWeight: 600, fontSize: "1.25rem", fontFamily: FREDOKA, marginTop: 2 }}>ดูรายงาน</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{rangeLabel}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {presets.map((p) => (
            <a key={p.label} href={p.href} style={{ fontSize: 12.5, fontWeight: 600, color: BLUE, background: "#eaf3f6", borderRadius: 8, padding: "7px 12px", textDecoration: "none" }}>{p.label}</a>
          ))}
          <form style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {branchId && <input type="hidden" name="branch" value={branchId} />}
            <input type="date" name="date" defaultValue={sp.date ?? ""} style={dateInput} />
            <button style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: "7px 14px", fontSize: 13, fontFamily: MITR, background: "#fff", color: INK, cursor: "pointer" }}>ดู</button>
          </form>
          <BranchSwitcher branches={branches} activeId={activeId} />
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "22px 28px 40px" }}>
        {/* สรุป */}
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginBottom: 18 }}>
          <div style={{ background: BLUE, borderRadius: 16, padding: 20, color: "#fff" }}>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>รายได้รวม{rangeLabel.startsWith("กะ") ? "ในกะนี้" : "วันนี้"}</div>
            <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 32 }}>{thb(totalCents)}</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>ลูกค้า {rows.length} คน{walkins.length > 0 ? ` · ขายหน้าร้าน ${walkins.length} รายการ` : ""}</div>
          </div>
          <div style={{ ...card, padding: 20 }}>
            <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>แยกตามวิธีชำระเงิน</div>
            {methodRows.length === 0 ? (
              <div style={{ color: MUTED, fontSize: 14 }}>ยังไม่มีรายการ</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {methodRows.map(([m, v]) => (
                  <div key={m} style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                    <span style={{ color: MUTED }}>{PAYMENT_METHOD_LABEL[m] ?? m}</span>
                    <strong style={{ fontFamily: MONO }}>{thb(v)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ตารางลูกค้าทีละคน */}
        <div style={{ ...card, overflow: "hidden", marginBottom: rows.length > 0 ? 18 : 0 }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${LINE}`, fontWeight: 600, fontFamily: FREDOKA, fontSize: 16 }}>ลูกค้า{rangeLabel.startsWith("กะ") ? "ในกะนี้" : "วันนี้"}</div>
          {rows.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: MUTED, fontSize: 14 }}>ยังไม่มีลูกค้าเข้าเล่นในช่วงนี้</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#faf7f0", textAlign: "left" }}>
                    {["เด็ก", "เวลาเข้า", "ขนมที่ซื้อ", "ยอดจ่าย", "วิธีจ่าย", "สถานะ"].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", color: MUTED, fontWeight: 600, borderBottom: `1px solid ${LINE}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sessionId} style={{ borderBottom: `1px solid ${LINE}` }}>
                      <td style={{ padding: "10px 16px", fontWeight: 500 }}>{r.name}</td>
                      <td style={{ padding: "10px 16px", color: MUTED }}>{fmtTime(r.checkInAt)}</td>
                      <td style={{ padding: "10px 16px", color: MUTED }}>{r.snacks.length > 0 ? r.snacks.map((s) => `${s.name} x${s.qty}`).join(", ") : "—"}</td>
                      <td style={{ padding: "10px 16px", fontFamily: MONO, fontWeight: 600, color: GREEN }}>{thb(r.totalCents)}</td>
                      <td style={{ padding: "10px 16px", color: MUTED }}>{Array.from(r.methods).map((m) => paymentMethodLabel(m)).join(", ")}</td>
                      <td style={{ padding: "10px 16px" }}><span className={sessionStatusChipClass(r.status)}>{sessionStatusLabel(r.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ขายหน้าร้านไม่ผูกเด็ก (ถ้ามี) */}
        {walkins.length > 0 && (
          <div style={{ ...card, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${LINE}`, fontWeight: 600, fontFamily: FREDOKA, fontSize: 16 }}>ขายหน้าร้าน (ไม่ผูกเด็ก)</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "#faf7f0", textAlign: "left" }}>
                    {["เวลา", "รายการ", "ยอดจ่าย", "วิธีจ่าย"].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", color: MUTED, fontWeight: 600, borderBottom: `1px solid ${LINE}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {walkins.map((w) => (
                    <tr key={w.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                      <td style={{ padding: "10px 16px", color: MUTED }}>{fmtTime(w.soldAt)}</td>
                      <td style={{ padding: "10px 16px", color: MUTED }}>{w.items || "—"}</td>
                      <td style={{ padding: "10px 16px", fontFamily: MONO, fontWeight: 600, color: GREEN }}>{thb(w.totalCents)}</td>
                      <td style={{ padding: "10px 16px", color: MUTED }}>{paymentMethodLabel(w.method)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
