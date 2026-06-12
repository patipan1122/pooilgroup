// BankLogo — โลโก้ธนาคารจริง (SVG) สำหรับบอกว่าบัญชี/payee เป็นของธนาคารอะไร.
// มีไฟล์จริง 10 ธนาคารใหญ่ (public/logos/banks/) · ที่ไม่มี (TrueMoney/อื่น ๆ) → badge
// สีแบรนด์ + ตัวย่อ. plain component (ไม่มี state) → ใช้ได้ทั้ง server + client.
import { cn } from "@/lib/utils/cn";
import { bankLogoSrc, bankBadge, bankBrandColor } from "@/lib/ledger/bank-logos";

export function BankLogo({
  code,
  name,
  size = 28,
  className,
}: {
  /** ตัวย่อธนาคาร (KBANK) หรือรหัสตัวเลข BOT ("004"). */
  code: string | null | undefined;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const src = bankLogoSrc(code);
  if (src) {
    // โลโก้ omise เป็นสีขาว/โมโนโครม (ออกแบบมาวางบนพื้นสี) → วางบนพื้นสีแบรนด์ของธนาคาร
    // + บังคับให้เป็นสีขาวด้วย filter (กัน logo ที่ default เป็นสีดำ เช่น ttb) → เห็นชัด
    // ทุกธนาคาร เหมือนไอคอนแอป.
    return (
      <span
        className={cn(
          "inline-grid shrink-0 place-items-center overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5",
          className,
        )}
        style={{ width: size, height: size, background: bankBrandColor(code) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name ?? code ?? "ธนาคาร"}
          width={size}
          height={size}
          className="object-contain"
          style={{ width: "68%", height: "68%", filter: "brightness(0) invert(1)" }}
        />
      </span>
    );
  }
  const badge = bankBadge(code, name);
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg font-bold text-white",
        className,
      )}
      style={{ width: size, height: size, background: badge.color, fontSize: Math.round(size * 0.32) }}
      aria-label={name ?? code ?? "ธนาคาร"}
    >
      {badge.label}
    </span>
  );
}
