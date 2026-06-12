// BankLogo — โลโก้ธนาคารจริง (SVG) สำหรับบอกว่าบัญชี/payee เป็นของธนาคารอะไร.
// มีไฟล์จริง 10 ธนาคารใหญ่ (public/logos/banks/) · ที่ไม่มี (TrueMoney/อื่น ๆ) → badge
// สีแบรนด์ + ตัวย่อ. plain component (ไม่มี state) → ใช้ได้ทั้ง server + client.
import { cn } from "@/lib/utils/cn";
import { bankLogoSrc, bankBadge } from "@/lib/ledger/bank-logos";

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
    return (
      <span
        className={cn(
          "inline-grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white ring-1 ring-zinc-200",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {/* โลโก้ local SVG — ใช้ <img> ตรง ๆ ไม่ต้อง next/image config */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={name ?? code ?? "ธนาคาร"}
          width={size}
          height={size}
          className="size-full object-contain p-[3px]"
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
