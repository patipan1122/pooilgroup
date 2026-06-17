"use client";

// ClawHub redeem-confirm — confirm spending points on a reward, then POST
// /api/clawhub/redeem {idToken, rewardId}. On success: big pickup code (no QR lib in this
// project → big mono text the staff keys in) + "แสดงรหัสนี้ให้พนักงาน". Handles
// insufficient_points / out_of_stock cleanly.

import { useState } from "react";
import { useClawhub } from "./liff-context";
import { CwHeader, CwButtonLink } from "./ui";
import type { RewardCard } from "./rewards-screen";

type Outcome =
  | { kind: "idle" }
  | { kind: "ok"; pickupCode: string }
  | { kind: "fail"; message: string };

export function RedeemConfirmScreen({ reward }: { reward: RewardCard }) {
  const { member, getIdToken, setMember } = useClawhub();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });

  const balance = member?.balance ?? 0;
  const short = Math.max(0, reward.pointsPrice - balance);
  const afterBalance = Math.max(0, balance - reward.pointsPrice);

  async function confirm() {
    setBusy(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setOutcome({ kind: "fail", message: "ไม่ได้ข้อมูล LINE — เปิดผ่านแอป LINE อีกครั้ง" });
        return;
      }
      const res = await fetch("/api/clawhub/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, rewardId: reward.id }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        pickupCode?: string;
        message?: string;
        balance?: number;
      };
      if (typeof json.balance === "number" && member) {
        setMember({ ...member, balance: json.balance });
      }
      if (json.ok && json.pickupCode) {
        setOutcome({ kind: "ok", pickupCode: json.pickupCode });
      } else {
        setOutcome({ kind: "fail", message: json.message ?? "แลกไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    } catch {
      setOutcome({ kind: "fail", message: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally {
      setBusy(false);
    }
  }

  if (outcome.kind === "ok") {
    return (
      <div className="mx-auto w-full max-w-md pb-10">
        <CwHeader title="แลกสำเร็จ" />
        <div className="px-4">
          <div className="cw-card p-6 text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl text-4xl" style={{ background: "var(--cw-ok-soft)" }}>
              🎉
            </div>
            <h2 className="mt-3 text-[20px] font-extrabold" style={{ color: "var(--cw-text)", letterSpacing: "-0.02em" }}>
              แลก {reward.name} สำเร็จ
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--cw-text-2)" }}>
              แสดงรหัสนี้ให้พนักงานที่หน้าร้าน
            </p>

            {/* big pickup code (no QR lib → readable mono code) */}
            <div
              className="mx-auto mt-4 rounded-2xl px-4 py-5"
              style={{ background: "var(--cw-charcoal)", color: "#fff" }}
            >
              <div className="text-[11px] tracking-widest" style={{ color: "var(--cw-brand-100)" }}>
                รหัสรับของ
              </div>
              <div className="cw-tnum mt-1 select-all font-mono text-[40px] font-extrabold tracking-[0.12em]">
                {outcome.pickupCode}
              </div>
            </div>

            <p className="mt-3 text-[12px]" style={{ color: "var(--cw-text-3)" }}>
              แต้มคงเหลือ {(member?.balance ?? afterBalance).toLocaleString("th-TH")} แต้ม ·
              ดูได้ที่เมนู แต้ม &amp; ประวัติ
            </p>

            <div className="mt-5 space-y-3">
              <CwButtonLink href="/liff/clawhub?screen=rewards">แลกของชิ้นอื่น</CwButtonLink>
              <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">กลับหน้าหลัก</CwButtonLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (outcome.kind === "fail") {
    return (
      <div className="mx-auto w-full max-w-md pb-10">
        <CwHeader title="แลกตุ๊กตา" />
        <div className="px-4">
          <div className="cw-card p-6 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl text-2xl" style={{ background: "var(--cw-danger-soft)" }}>
              😢
            </div>
            <p className="mt-3 text-[15px] font-semibold" style={{ color: "var(--cw-text)" }}>
              {outcome.message}
            </p>
            <div className="mt-5 space-y-3">
              <CwButtonLink href="/liff/clawhub?screen=rewards">ดูของอื่น</CwButtonLink>
              <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">กลับหน้าหลัก</CwButtonLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // idle — confirm form
  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="ยืนยันการแลก" />
      <div className="space-y-4 px-4">
        <div className="cw-card overflow-hidden">
          <div className="aspect-[16/10] w-full" style={{ background: "var(--cw-bg-3)" }}>
            {reward.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={reward.imageUrl} alt={reward.name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-5xl">🧸</div>
            )}
          </div>
          <div className="p-4">
            <div className="text-[17px] font-bold" style={{ color: "var(--cw-text)" }}>
              {reward.name}
            </div>
            <div className="cw-tnum mt-1 text-[16px] font-extrabold" style={{ color: "var(--cw-brand-700)" }}>
              {reward.pointsPrice.toLocaleString("th-TH")} แต้ม
            </div>
          </div>
        </div>

        <div className="cw-card divide-y p-0" style={{ borderColor: "var(--cw-border)" }}>
          <Line label="แต้มของคุณตอนนี้" value={`${balance.toLocaleString("th-TH")} แต้ม`} />
          <Line label="ใช้แลก" value={`-${reward.pointsPrice.toLocaleString("th-TH")} แต้ม`} />
          <Line label="คงเหลือหลังแลก" value={`${afterBalance.toLocaleString("th-TH")} แต้ม`} strong />
        </div>

        {short > 0 ? (
          <div className="rounded-xl p-3 text-[13px] font-medium" style={{ background: "var(--cw-pending-soft)", color: "var(--cw-brand-700)" }}>
            แต้มไม่พอ — ขาดอีก {short.toLocaleString("th-TH")} แต้ม
          </div>
        ) : null}

        <button
          type="button"
          className="cw-btn"
          style={{ width: "100%" }}
          disabled={busy || short > 0}
          onClick={() => void confirm()}
        >
          {busy ? "กำลังแลก..." : "ยืนยันแลกตุ๊กตา"}
        </button>
        <CwButtonLink href="/liff/clawhub?screen=rewards" variant="ghost">
          ยกเลิก
        </CwButtonLink>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13.5px]" style={{ color: "var(--cw-text-2)" }}>
        {label}
      </span>
      <span
        className={`cw-tnum text-[14px] ${strong ? "font-extrabold" : "font-semibold"}`}
        style={{ color: strong ? "var(--cw-text)" : "var(--cw-text-2)" }}
      >
        {value}
      </span>
    </div>
  );
}
