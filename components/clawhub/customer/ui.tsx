"use client";

// ClawHub customer shared UI bits — header w/ logo, balance pill, loading/error states,
// and small format helpers. All visual; everything is rendered inside .clawhub-scope.

import Link from "next/link";

/** JOLLY PLAY header — logo + page title. Optional back link for sub-screens. */
export function CwHeader({ title, back }: { title?: string; back?: boolean }) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3 pt-5"
      style={{
        background: "var(--cw-bg)",
        paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)",
      }}
    >
      {back ? (
        <a
          href="/liff/clawhub?screen=home"
          aria-label="กลับหน้าหลัก"
          className="cw-tap grid size-10 flex-none place-items-center rounded-full text-[18px]"
          style={{ background: "var(--cw-surface)", border: "1px solid var(--cw-border)", color: "var(--cw-text-2)" }}
        >
          ‹
        </a>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/clawhub/logo.jpg"
          alt="JOLLY PLAY"
          className="size-12 flex-none rounded-2xl object-cover"
          style={{ border: "1px solid var(--cw-border)", boxShadow: "var(--cw-shadow-sm)" }}
        />
      )}
      <div className="min-w-0 flex-1">
        <div
          className="text-[15px] font-extrabold leading-tight"
          style={{ color: "var(--cw-brand-700)", letterSpacing: "-0.02em" }}
        >
          JOLLY PLAY
        </div>
        {title ? (
          <div className="truncate text-[13px] font-medium" style={{ color: "var(--cw-text-2)" }}>
            {title}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** Example-image disclosure — "ดูตัวอย่าง" expand; the caption is baked into the image. */
export function CwExample({ src, label, alt }: { src: string; label: string; alt: string }) {
  return (
    <details className="cw-example">
      <summary>
        <span aria-hidden>🔍</span>
        <span>{label}</span>
        <span className="cw-example-caret" aria-hidden>
          ⌄
        </span>
      </summary>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" />
    </details>
  );
}

/** Full-screen centered spinner. */
export function CwLoading({ label = "กำลังโหลด..." }: { label?: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div
        className="size-11 animate-spin rounded-full border-4"
        style={{
          borderColor: "var(--cw-brand-100)",
          borderTopColor: "var(--cw-brand)",
        }}
      />
      <p className="text-sm" style={{ color: "var(--cw-text-2)" }}>
        {label}
      </p>
    </div>
  );
}

/** Calm error block (LINE-only / init failure). */
export function CwError({ message }: { message: string }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="grid size-14 place-items-center rounded-2xl text-2xl"
        style={{ background: "var(--cw-brand-50)" }}>
        🎯
      </div>
      <p className="text-base font-semibold" style={{ color: "var(--cw-text)" }}>
        {message}
      </p>
      <p className="text-sm" style={{ color: "var(--cw-text-3)" }}>
        ถ้ายังไม่ได้ผล ลองปิดแล้วเปิดใหม่จากเมนูด้านล่างของแชต JOLLY PLAY
      </p>
    </div>
  );
}

/** Big tabular-nums points number. */
export function CwBalance({ points }: { points: number }) {
  return (
    <span className="cw-points cw-tnum">
      <span className="text-[44px] leading-none">{points.toLocaleString("th-TH")}</span>
      <span className="text-base font-bold">แต้ม</span>
    </span>
  );
}

/**
 * Points-balance hero — the headline number + an expiry countdown chip. Reused across
 * home / points / rewards for a consistent JOLLY PLAY identity. `sheen` plays a one-shot
 * gloss sweep (home only — calm elsewhere).
 */
export function CwPointsHero({
  balance,
  expiryAt,
  expiryPoints,
  caption = "แต้มของคุณ",
  sheen = false,
}: {
  balance: number;
  expiryAt: string | null;
  expiryPoints: number;
  caption?: string;
  sheen?: boolean;
}) {
  const days = daysUntil(expiryAt);
  return (
    <div
      className={`cw-card overflow-hidden p-5 ${sheen ? "cw-hero" : ""}`}
      style={{
        background:
          "radial-gradient(120% 140% at 0% 0%, var(--cw-brand-50) 0%, var(--cw-bg-2) 70%)",
        borderColor: "var(--cw-border-strong)",
        boxShadow: "var(--cw-shadow)",
      }}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: "var(--cw-text-2)" }}>
        <span aria-hidden>⭐</span>
        {caption}
      </div>
      <div className="mt-1">
        <CwBalance points={balance} />
      </div>
      {expiryAt ? (
        <div
          className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold"
          style={{ background: "var(--cw-pending-soft)", color: "var(--cw-brand-700)" }}
        >
          <span aria-hidden>⏳</span>
          <span className="cw-tnum">{expiryPoints.toLocaleString("th-TH")}</span> แต้มหมดอายุ{" "}
          {formatThaiDate(expiryAt)}
          {days != null ? ` · อีก ${days} วัน` : ""}
        </div>
      ) : (
        <div className="mt-3 text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
          ยังไม่มีแต้มใกล้หมดอายุ — เก็บแต้มไว้แลกของได้เลย
        </div>
      )}
    </div>
  );
}

/** Pill link styled like the primary button (for navigation between screens). */
export function CwButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  return (
    <Link
      href={href}
      className={variant === "ghost" ? "cw-btn cw-btn-ghost" : "cw-btn"}
      style={{ width: "100%" }}
    >
      {children}
    </Link>
  );
}

/**
 * Digital membership card — the real JOLLY PLAY card artwork (member-card.png) as the
 * background, with the member's name / code / points overlaid. Looks like a physical
 * loyalty card (rounded, drop shadow, on-brand). Used on home + points header.
 */
export function CwMembershipCard({
  name,
  memberCode,
  balance,
  expiryAt,
}: {
  name: string;
  memberCode: string;
  balance: number;
  expiryAt: string | null;
}) {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: "1.586 / 1", // standard credit-card ratio
        borderRadius: "var(--cw-radius-lg)",
        boxShadow: "var(--cw-shadow)",
        border: "1px solid var(--cw-border-strong)",
      }}
    >
      {/* card artwork */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/clawhub/member-card.png"
        alt="บัตรสมาชิก JOLLY PLAY"
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      {/* legibility scrim — keeps overlaid text readable over any artwork */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0) 28%, rgba(0,0,0,0.06) 52%, rgba(0,0,0,0.46) 100%)",
        }}
      />
      {/* overlaid member data */}
      <div className="absolute inset-0 flex flex-col justify-end p-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[10.5px] font-bold uppercase tracking-wide"
              style={{ color: "rgba(255,255,255,0.82)", letterSpacing: "0.04em" }}
            >
              สมาชิก
            </div>
            <div
              className="truncate text-[16px] font-extrabold leading-tight"
              style={{ color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.45)" }}
            >
              {name || "ลูกค้า JOLLY PLAY"}
            </div>
            <div
              className="cw-tnum mt-0.5 text-[12.5px] font-semibold"
              style={{ color: "rgba(255,255,255,0.9)", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}
            >
              {memberCode}
            </div>
          </div>
          <div
            className="flex-none rounded-2xl px-3 py-2 text-right"
            style={{
              background: "rgba(17,17,17,0.6)",
              backdropFilter: "blur(7px)",
              WebkitBackdropFilter: "blur(7px)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.18)",
            }}
          >
            <div
              className="text-[10.5px] font-bold"
              style={{ color: "rgba(255,255,255,0.88)" }}
            >
              แต้มคงเหลือ
            </div>
            <div className="flex items-baseline justify-end gap-1">
              <span
                className="cw-tnum text-[34px] font-black leading-none"
                style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}
              >
                {balance.toLocaleString("th-TH")}
              </span>
              <span
                className="text-[13px] font-extrabold"
                style={{ color: "rgba(255,255,255,0.92)" }}
              >
                แต้ม
              </span>
            </div>
          </div>
        </div>
        {expiryAt ? (
          <div
            className="mt-2 self-start rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ background: "rgba(255,255,255,0.92)", color: "var(--cw-brand-700)" }}
          >
            ⏳ แต้มหมดอายุ {formatThaiDate(expiryAt)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * JOLLY PLAY mascot illustration — the cute character art used as screen hero / empty-state
 * art instead of a flat icon. Sizes sensibly (default 96px), keeps a soft brand halo.
 */
export function CwMascot({
  src,
  alt,
  size = 96,
  halo = true,
}: {
  src: string;
  alt: string;
  size?: number;
  halo?: boolean;
}) {
  return (
    <div
      className="relative grid flex-none place-items-center"
      style={{ width: size, height: size }}
    >
      {halo ? (
        <div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, var(--cw-brand-50) 0%, rgba(255,243,224,0) 78%)",
          }}
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        className="relative h-full w-full rounded-3xl object-cover"
        style={{ boxShadow: "var(--cw-shadow-sm)" }}
      />
    </div>
  );
}

/** Mascot asset paths (served from public/clawhub/). */
export const CW_MASCOT = {
  knightDragon: "/clawhub/mascot-welcome.png",
  knight: "/clawhub/mascot-help.png",
  babyDragon: "/clawhub/character-baby-dragon.jpg",
  success: "/clawhub/mascot-success.png",
} as const;

/**
 * Compute age in whole years from an ISO "YYYY-MM-DD" birthday. Returns null for
 * missing / malformed / future dates (caller hides the chip in that case).
 */
export function computeAge(isoDate: string | null): number | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  // Subtract a year if this year's birthday hasn't happened yet.
  const hadBirthday =
    now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!hadBirthday) age -= 1;
  if (age < 0 || age > 130) return null;
  return age;
}

/** Format an ISO date → "17 มิ.ย. 2569" (Buddhist year), short. */
export function formatThaiDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Days from now until an ISO date (floored, min 0). */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
