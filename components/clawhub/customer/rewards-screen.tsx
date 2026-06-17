"use client";

// ClawHub rewards — grid of doll cards. Affordable = bright + tappable; unaffordable =
// greyed with "ขาดอีก N แต้ม". The catalog is passed from the server page (listActiveRewards);
// the affordability check uses the live member balance from the LIFF context. Tapping an
// affordable card → redeem-confirm screen.

import { useClawhub } from "./liff-context";
import { CwHeader, CwButtonLink } from "./ui";

export type RewardCard = {
  id: string;
  name: string;
  imageUrl: string | null;
  pointsPrice: number;
  stock: number | null; // null = unlimited
};

export function RewardsScreen({ rewards }: { rewards: RewardCard[] }) {
  const { member } = useClawhub();
  const balance = member?.balance ?? 0;

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="แลกตุ๊กตา" />

      <div className="px-4">
        <div
          className="rounded-xl px-4 py-2.5 text-[13.5px] font-semibold"
          style={{ background: "var(--cw-brand-50)", color: "var(--cw-brand-700)" }}
        >
          แต้มของคุณ: <span className="cw-tnum">{balance.toLocaleString("th-TH")}</span> แต้ม
        </div>
      </div>

      {rewards.length === 0 ? (
        <div className="py-16 text-center text-[14px]" style={{ color: "var(--cw-text-3)" }}>
          ยังไม่มีของให้แลกตอนนี้ 🧸<br />กลับมาดูใหม่เร็ว ๆ นี้นะ
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 px-4">
          {rewards.map((r) => {
            const soldOut = r.stock != null && r.stock <= 0;
            const short = Math.max(0, r.pointsPrice - balance);
            const affordable = !soldOut && short === 0;
            const href = `/liff/clawhub?screen=redeem-confirm&reward=${r.id}`;

            const card = (
              <div
                className="cw-card flex h-full flex-col overflow-hidden"
                style={{ opacity: affordable ? 1 : 0.7 }}
              >
                <div
                  className="aspect-square w-full"
                  style={{ background: "var(--cw-bg-3)" }}
                >
                  {r.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full place-items-center text-4xl">🧸</div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <div className="line-clamp-2 text-[14px] font-bold" style={{ color: "var(--cw-text)" }}>
                    {r.name}
                  </div>
                  <div className="cw-tnum text-[15px] font-extrabold" style={{ color: "var(--cw-brand-700)" }}>
                    {r.pointsPrice.toLocaleString("th-TH")} แต้ม
                  </div>
                  <div className="mt-auto pt-1">
                    {soldOut ? (
                      <span className="cw-badge cw-badge-danger">หมดแล้ว</span>
                    ) : affordable ? (
                      <span className="cw-badge cw-badge-ok">แลกได้เลย</span>
                    ) : (
                      <span className="cw-badge cw-badge-pending">ขาดอีก {short.toLocaleString("th-TH")} แต้ม</span>
                    )}
                    {r.stock != null && r.stock > 0 && r.stock <= 5 ? (
                      <span className="ml-1 text-[11px]" style={{ color: "var(--cw-text-3)" }}>
                        เหลือ {r.stock}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            );

            return affordable ? (
              <a key={r.id} href={href} className="active:scale-[0.98]" style={{ transition: "transform 0.08s" }}>
                {card}
              </a>
            ) : (
              <div key={r.id}>{card}</div>
            );
          })}
        </div>
      )}

      <div className="mt-6 px-4">
        <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
          กลับหน้าหลัก
        </CwButtonLink>
      </div>
    </div>
  );
}
