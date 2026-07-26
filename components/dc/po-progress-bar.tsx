// DC · แถบคืบหน้า "ของในใบ PO" (เส้นตรง + %) — โชว์ตั้งแต่หน้าลิสต์ ก่อนคลิกเข้าใบ (CEO 2026-07-26)
//   ใช้ได้ 2 ความหมาย:
//     • หน้าหยิบของ (นับสต๊อก/ย้าย/เบิก/office/ดูเป็นใบ PO) = "เหลือในคลัง / รับเข้า"
//     • หน้าสั่งซื้อ (purchasing) = "รับเข้าแล้ว / สั่ง"
//   สี: คืบหน้าน้อย = ส้ม-แดง (สะดุดตา ให้เห็นว่าเหลือน้อย) · มาก = เขียว
//   ไม่มี state/hook → ใช้ได้ทั้ง server และ client component. อ่านล้วน ไม่แตะเงิน/สต๊อกจริง.

/** สีตามระดับ % (น้อย=แดง กลาง=ส้ม มาก=เขียว) — export เผื่อ caller อยากย้อมป้ายอื่นให้เข้าชุด. */
export function poBarColor(pct: number): { fill: string; text: string } {
  if (pct <= 20) return { fill: "#e5533c", text: "#b23a26" }; // น้อยมาก
  if (pct <= 50) return { fill: "#f0a132", text: "#b9781a" }; // ปานกลาง
  return { fill: "#1fa25a", text: "#1e8e4e" }; // เยอะ
}

export function poRemainingPct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.max(0, Math.min(value, total)) / total) * 100);
}

export function PoProgressBar({
  value,
  total,
  label,
  unit,
  compact = false,
}: {
  value: number;
  total: number;
  /** ป้ายหน้าเลข เช่น "เหลือ" หรือ "รับแล้ว" */
  label: string;
  /** หน่วย เช่น "ชิ้น" (ไม่ใส่ก็ได้) */
  unit?: string;
  /** แถวลิสต์แคบ ๆ → แถบบางลง */
  compact?: boolean;
}) {
  const pct = poRemainingPct(value, total);
  const c = poBarColor(pct);
  const nf = (n: number) => n.toLocaleString("th-TH");
  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: c.text, whiteSpace: "nowrap" }}>
          {label} {nf(value)}
          {unit ? ` ${unit}` : ""}
          <span style={{ color: "var(--dc-muted, #6b7785)", fontWeight: 600 }}> / {nf(total)}</span>
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: c.text, whiteSpace: "nowrap" }}>
          {pct}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${pct}%`}
        style={{
          height: compact ? 6 : 8,
          borderRadius: 999,
          background: "var(--dc-canvas, #eef1f6)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: c.fill,
            borderRadius: 999,
            transition: "width .2s ease",
          }}
        />
      </div>
    </div>
  );
}
