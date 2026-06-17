"use client";

// ClawHub redeem-confirm — confirm spending points on a reward, choose how to receive it,
// then POST /api/clawhub/redeem { idToken, rewardId, fulfillment }. Fulfillment is a
// segmented chooser:
//   DELIVERY → recipientName / recipientPhone / recipientAddress (prefilled from member)
//   PICKUP   → pickupBranchCode (required) + pickupTime (นัดวัน/เวลา, free text)
//   CONTACT  → optional contactNote
// On { ok:false, reason } we show the Thai message. On ok:true we show the big pickup code
// (staff keys it in — no QR lib here) + a friendly summary of how they'll receive it.

import { useState } from "react";
import { useClawhub } from "./liff-context";
import { CwHeader, CwButtonLink } from "./ui";
import type { RewardCard } from "./rewards-screen";

type Method = "DELIVERY" | "PICKUP" | "CONTACT";

type Fulfillment = {
  method: Method;
  recipientName?: string;
  recipientPhone?: string;
  recipientAddress?: string;
  pickupBranchCode?: string;
  pickupTime?: string;
  contactNote?: string;
};

type Outcome =
  | { kind: "idle" }
  | { kind: "ok"; pickupCode: string; method: Method }
  | { kind: "fail"; message: string };

const METHOD_LABEL: Record<Method, string> = {
  DELIVERY: "ส่งถึงบ้าน",
  PICKUP: "รับที่ 7-11",
  CONTACT: "ให้เจ้าหน้าที่ติดต่อ",
};

export function RedeemConfirmScreen({ reward }: { reward: RewardCard }) {
  const { member, getIdToken, setMember } = useClawhub();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [err, setErr] = useState<string | null>(null);

  const [method, setMethod] = useState<Method>("DELIVERY");
  // DELIVERY — prefilled from the member profile.
  const [recipientName, setRecipientName] = useState(member?.fullName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(member?.phone ?? "");
  const [recipientAddress, setRecipientAddress] = useState(member?.address ?? "");
  // PICKUP
  const [pickupBranchCode, setPickupBranchCode] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  // CONTACT
  const [contactNote, setContactNote] = useState("");

  const balance = member?.balance ?? 0;
  const short = Math.max(0, reward.pointsPrice - balance);
  const afterBalance = Math.max(0, balance - reward.pointsPrice);

  function buildFulfillment(): Fulfillment | null {
    setErr(null);
    if (method === "DELIVERY") {
      const name = recipientName.trim();
      const phone = recipientPhone.trim();
      const address = recipientAddress.trim();
      if (!name || !phone || !address) {
        setErr("กรุณากรอกชื่อ เบอร์โทร และที่อยู่สำหรับจัดส่ง");
        return null;
      }
      return { method, recipientName: name, recipientPhone: phone, recipientAddress: address };
    }
    if (method === "PICKUP") {
      const branch = pickupBranchCode.trim();
      if (!branch) {
        setErr("กรุณาระบุเลขสาขา 7-11 ที่จะรับของ");
        return null;
      }
      return { method, pickupBranchCode: branch, pickupTime: pickupTime.trim() || undefined };
    }
    return { method, contactNote: contactNote.trim() || undefined };
  }

  async function confirm() {
    const fulfillment = buildFulfillment();
    if (!fulfillment) return;
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
        body: JSON.stringify({ idToken, rewardId: reward.id, fulfillment }),
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
        setOutcome({ kind: "ok", pickupCode: json.pickupCode, method: fulfillment.method });
      } else {
        setOutcome({ kind: "fail", message: json.message ?? "แลกไม่สำเร็จ ลองใหม่อีกครั้ง" });
      }
    } catch {
      setOutcome({ kind: "fail", message: "เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง" });
    } finally {
      setBusy(false);
    }
  }

  // ---------- SUCCESS ----------
  if (outcome.kind === "ok") {
    const summary =
      outcome.method === "DELIVERY"
        ? "เราจะจัดส่งของไปตามที่อยู่ของคุณ ทีมงานจะติดต่อยืนยันก่อนส่ง"
        : outcome.method === "PICKUP"
          ? "นำรหัสนี้ไปแสดงที่ 7-11 สาขาที่เลือก เพื่อรับของได้เลย"
          : "ทีมงานจะติดต่อกลับเพื่อนัดรับของให้เร็วที่สุด";
    return (
      <div className="mx-auto w-full max-w-md pb-10">
        <CwHeader title="แลกสำเร็จ" back />
        <div className="px-4">
          <div className="cw-card p-6 text-center">
            <div className="cw-pop mx-auto grid size-20 place-items-center rounded-3xl text-5xl" style={{ background: "var(--cw-ok-soft)" }}>
              🎉
            </div>
            <h2 className="mt-4 text-[22px] font-extrabold" style={{ color: "var(--cw-text)", letterSpacing: "-0.02em" }}>
              แลก {reward.name} สำเร็จ!
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: "var(--cw-text-2)" }}>
              {summary}
            </p>

            {/* big pickup code (no QR lib → selectable mono code) */}
            <div
              className="mx-auto mt-4 rounded-2xl px-4 py-5"
              style={{ background: "var(--cw-charcoal)", color: "#fff", boxShadow: "var(--cw-shadow)" }}
            >
              <div className="text-[11px] font-bold tracking-widest" style={{ color: "var(--cw-brand-100)" }}>
                รหัสรับของ — แสดงให้พนักงาน
              </div>
              <div className="cw-tnum mt-1 select-all font-mono text-[40px] font-extrabold tracking-[0.12em]">
                {outcome.pickupCode}
              </div>
            </div>

            <p className="mt-3 text-[12px]" style={{ color: "var(--cw-text-3)" }}>
              แต้มคงเหลือ{" "}
              <span className="cw-tnum">{(member?.balance ?? afterBalance).toLocaleString("th-TH")}</span> แต้ม ·
              ดูได้ที่เมนู แต้ม &amp; ประวัติ
            </p>

            <div className="mt-5 space-y-3">
              <CwButtonLink href="/liff/clawhub?screen=rewards">แลกของชิ้นอื่น</CwButtonLink>
              <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
                กลับหน้าหลัก
              </CwButtonLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- FAIL ----------
  if (outcome.kind === "fail") {
    return (
      <div className="mx-auto w-full max-w-md pb-10">
        <CwHeader title="แลกตุ๊กตา" back />
        <div className="px-4">
          <div className="cw-card p-6 text-center">
            <div className="mx-auto grid size-16 place-items-center rounded-2xl text-3xl" style={{ background: "var(--cw-danger-soft)" }}>
              😢
            </div>
            <p className="mt-3 text-[15px] font-semibold" style={{ color: "var(--cw-text)" }}>
              {outcome.message}
            </p>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                className="cw-btn"
                style={{ width: "100%" }}
                onClick={() => setOutcome({ kind: "idle" })}
              >
                ลองอีกครั้ง
              </button>
              <CwButtonLink href="/liff/clawhub?screen=rewards" variant="ghost">
                ดูของอื่น
              </CwButtonLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- IDLE — confirm form ----------
  return (
    <div className="mx-auto w-full max-w-md pb-28">
      <CwHeader title="ยืนยันการแลก" back />
      <div className="space-y-4 px-4">
        {/* reward card */}
        <div className="cw-card overflow-hidden">
          <div className="flex gap-3 p-3">
            <div className="size-20 flex-none overflow-hidden rounded-xl" style={{ background: "var(--cw-bg-3)" }}>
              {reward.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={reward.imageUrl} alt={reward.name} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-3xl">🧸</div>
              )}
            </div>
            <div className="min-w-0 flex-1 self-center">
              <div className="text-[16px] font-bold" style={{ color: "var(--cw-text)" }}>
                {reward.name}
              </div>
              <div className="cw-tnum mt-0.5 text-[16px] font-extrabold" style={{ color: "var(--cw-brand-700)" }}>
                {reward.pointsPrice.toLocaleString("th-TH")} แต้ม
              </div>
            </div>
          </div>
        </div>

        {/* points math */}
        <div className="cw-card divide-y p-0" style={{ borderColor: "var(--cw-border)" }}>
          <Line label="แต้มของคุณตอนนี้" value={`${balance.toLocaleString("th-TH")} แต้ม`} />
          <Line label="ใช้แลก" value={`-${reward.pointsPrice.toLocaleString("th-TH")} แต้ม`} />
          <Line label="คงเหลือหลังแลก" value={`${afterBalance.toLocaleString("th-TH")} แต้ม`} strong />
        </div>

        {short > 0 ? (
          <div
            className="rounded-xl p-3 text-[13px] font-medium"
            style={{ background: "var(--cw-pending-soft)", color: "var(--cw-brand-700)" }}
          >
            แต้มไม่พอ — ขาดอีก{" "}
            <span className="cw-tnum font-bold">{short.toLocaleString("th-TH")}</span> แต้ม
          </div>
        ) : (
          <>
            {/* fulfillment chooser */}
            <div>
              <div className="mb-2 px-1 text-[13.5px] font-bold" style={{ color: "var(--cw-text)" }}>
                รับของอย่างไร?
              </div>
              <div className="cw-seg" role="tablist" aria-label="วิธีรับของ">
                {(["DELIVERY", "PICKUP", "CONTACT"] as Method[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={method === m}
                    className={`cw-seg-btn ${method === m ? "active" : ""}`}
                    onClick={() => {
                      setMethod(m);
                      setErr(null);
                    }}
                  >
                    <span className="cw-seg-ico" aria-hidden>
                      {m === "DELIVERY" ? "🚚" : m === "PICKUP" ? "🏪" : "📞"}
                    </span>
                    {METHOD_LABEL[m]}
                  </button>
                ))}
              </div>
            </div>

            {/* method-specific fields */}
            <div className="cw-card space-y-4 p-4">
              {method === "DELIVERY" ? (
                <>
                  <div>
                    <label htmlFor="rc-name" className="cw-label">
                      ชื่อผู้รับ <span style={{ color: "var(--cw-red)" }}>*</span>
                    </label>
                    <input
                      id="rc-name"
                      type="text"
                      autoComplete="name"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="เช่น สมชาย ใจดี"
                      className="cw-input"
                    />
                  </div>
                  <div>
                    <label htmlFor="rc-phone" className="cw-label">
                      เบอร์โทรผู้รับ <span style={{ color: "var(--cw-red)" }}>*</span>
                    </label>
                    <input
                      id="rc-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      placeholder="08X-XXX-XXXX"
                      className="cw-input cw-tnum"
                    />
                  </div>
                  <div>
                    <label htmlFor="rc-address" className="cw-label">
                      ที่อยู่จัดส่ง <span style={{ color: "var(--cw-red)" }}>*</span>
                    </label>
                    <textarea
                      id="rc-address"
                      autoComplete="street-address"
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                      placeholder="บ้านเลขที่ / ถนน / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์"
                      className="cw-input"
                      rows={3}
                    />
                  </div>
                </>
              ) : method === "PICKUP" ? (
                <>
                  <div>
                    <label htmlFor="rc-branch" className="cw-label">
                      เลขสาขา 7-11 ที่จะรับของ <span style={{ color: "var(--cw-red)" }}>*</span>
                    </label>
                    <input
                      id="rc-branch"
                      type="text"
                      inputMode="numeric"
                      value={pickupBranchCode}
                      onChange={(e) => setPickupBranchCode(e.target.value)}
                      placeholder="เช่น 00024"
                      className="cw-input cw-tnum"
                    />
                  </div>
                  <div>
                    <label htmlFor="rc-time" className="cw-label">
                      นัดวัน/เวลารับ{" "}
                      <span className="font-normal" style={{ color: "var(--cw-text-3)" }}>
                        (ถ้ามี)
                      </span>
                    </label>
                    <input
                      id="rc-time"
                      type="text"
                      value={pickupTime}
                      onChange={(e) => setPickupTime(e.target.value)}
                      placeholder="เช่น เสาร์นี้ บ่าย 2 โมง"
                      className="cw-input"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="rc-note" className="cw-label">
                    ข้อความถึงเจ้าหน้าที่{" "}
                    <span className="font-normal" style={{ color: "var(--cw-text-3)" }}>
                      (ถ้ามี)
                    </span>
                  </label>
                  <textarea
                    id="rc-note"
                    value={contactNote}
                    onChange={(e) => setContactNote(e.target.value)}
                    placeholder="เช่น สะดวกรับสายช่วงเย็น"
                    className="cw-input"
                    rows={3}
                  />
                  <p className="mt-1.5 text-[12px]" style={{ color: "var(--cw-text-3)" }}>
                    ทีมงานจะติดต่อกลับเพื่อนัดรับของให้คุณ
                  </p>
                </div>
              )}
            </div>

            {err ? (
              <div
                className="rounded-xl p-3 text-[13px] font-medium"
                style={{ background: "var(--cw-danger-soft)", color: "var(--cw-danger)" }}
              >
                {err}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* sticky primary action */}
      <div className="cw-stickybar mx-auto max-w-md">
        <button
          type="button"
          className="cw-btn"
          style={{ width: "100%" }}
          disabled={busy || short > 0}
          onClick={() => void confirm()}
        >
          {busy ? "กำลังแลก..." : short > 0 ? "แต้มยังไม่พอ" : "ยืนยันแลกตุ๊กตา"}
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
