// BankLogo — branded square badge per Thai bank (color + short mark).
// No external image assets — uses each bank's brand colour + a short Thai/Latin mark.

const BRAND: Record<string, { bg: string; fg: string; mark: string }> = {
  KBANK:     { bg: "#138f2d", fg: "#fff", mark: "ก" },     // กสิกรไทย — green
  SCB:       { bg: "#4e2a84", fg: "#fff", mark: "SCB" },   // ไทยพาณิชย์ — purple
  BBL:       { bg: "#1e4598", fg: "#fff", mark: "BBL" },   // กรุงเทพ — blue
  TTB:       { bg: "#1565c0", fg: "#fff", mark: "ttb" },   // ทหารไทยธนชาต — blue
  BAAC:      { bg: "#1b7f3b", fg: "#fff", mark: "ธกส" },   // ธ.ก.ส. — green
  KTB:       { bg: "#00a4e4", fg: "#fff", mark: "KTB" },   // กรุงไทย — sky
  BAY:       { bg: "#fdb913", fg: "#3b2f00", mark: "BAY" },// กรุงศรีฯ — gold
  GSB:       { bg: "#eb008b", fg: "#fff", mark: "ออม" },   // ออมสิน — magenta
  CIMB:      { bg: "#7a1f2b", fg: "#fff", mark: "CIMB" },  // CIMB — maroon
  UOB:       { bg: "#003da5", fg: "#fff", mark: "UOB" },   // UOB — blue
  TRUEMONEY: { bg: "#ff6a00", fg: "#fff", mark: "true" },  // ทรูมันนี่ — orange
  OTHER:     { bg: "#71717a", fg: "#fff", mark: "•" },     // อื่นๆ — zinc
};

export function BankLogo({ bankCode, size = 36 }: { bankCode: string; size?: number }) {
  const b = BRAND[bankCode] ?? BRAND.OTHER;
  const fontSize = b.mark.length >= 3 ? Math.round(size * 0.3) : Math.round(size * 0.42);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: b.bg, color: b.fg, fontSize }}
      className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold leading-none tracking-tight"
    >
      {b.mark}
    </span>
  );
}
