"use client";

// ClawHub register + PDPA consent. Name auto-filled from LINE profile. On accept we POST
// /api/clawhub/member {idToken, consent:true} → server verifies the token + stamps
// consentAt. Required once before the first refund.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useClawhub } from "./liff-context";
import { CwHeader } from "./ui";
import { SUPPORT_PHONE } from "@/lib/clawhub/constants";

export function RegisterScreen() {
  const router = useRouter();
  const { profile, member, getIdToken, setMember } = useClawhub();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Already consented → straight to home.
  if (member?.consented) {
    router.replace("/liff/clawhub?screen=home");
  }

  async function accept() {
    setErr(null);
    setSubmitting(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setErr("ไม่ได้ข้อมูล LINE — เปิดผ่านแอป LINE อีกครั้ง");
        return;
      }
      const res = await fetch("/api/clawhub/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          consent: true,
          displayName: profile?.displayName,
          pictureUrl: profile?.pictureUrl,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        member?: import("@/lib/clawhub/customer-data").MemberSummary;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.member) {
        setErr(json.error ?? "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      }
      setMember(json.member);
      router.replace("/liff/clawhub?screen=home");
    } catch {
      setErr("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="สมัครสมาชิก" />

      <div className="space-y-4 px-4">
        <div className="cw-card p-4">
          <div className="text-[13px]" style={{ color: "var(--cw-text-3)" }}>
            ชื่อ LINE ของคุณ
          </div>
          <div className="mt-1 flex items-center gap-3">
            {profile?.pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.pictureUrl}
                alt=""
                className="size-11 rounded-full object-cover"
              />
            ) : (
              <div
                className="grid size-11 place-items-center rounded-full text-lg"
                style={{ background: "var(--cw-brand-50)" }}
              >
                🙂
              </div>
            )}
            <div className="text-[16px] font-bold" style={{ color: "var(--cw-text)" }}>
              {profile?.displayName ?? "ลูกค้า JOLLY PLAY"}
            </div>
          </div>
        </div>

        <div className="cw-card p-4">
          <h2 className="text-[15px] font-bold" style={{ color: "var(--cw-text)" }}>
            ข้อตกลงการใช้งาน (PDPA)
          </h2>
          <p className="mt-2 text-[13.5px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
            เมื่อตู้มีปัญหา คุณจะส่ง<strong> รูปหน้าจอตู้ </strong>ให้ระบบ AI อ่านยอดเพื่อตรวจสอบ
            เราเก็บรูปและจำนวนเงินที่คุณแจ้งไว้<strong> เพื่อตรวจสอบการคืนแต้มเท่านั้น </strong>
            ไม่เก็บข้อมูลส่วนตัวอื่น และไม่ส่งต่อให้บุคคลภายนอก
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px]" style={{ color: "var(--cw-text-2)" }}>
            <li>• ใช้ชื่อและรูปจาก LINE เพื่อระบุตัวสมาชิก</li>
            <li>• เก็บรูปหน้าจอตู้ที่คุณส่ง เพื่อตรวจสอบการคืนแต้ม</li>
            <li>• แต้มใช้แลกตุ๊กตาเท่านั้น ไม่ใช่เงินสด</li>
          </ul>
        </div>

        {err ? (
          <div
            className="rounded-xl p-3 text-[13px] font-medium"
            style={{ background: "var(--cw-danger-soft)", color: "var(--cw-danger)" }}
          >
            {err}
          </div>
        ) : null}

        <button
          type="button"
          className="cw-btn"
          style={{ width: "100%" }}
          disabled={submitting}
          onClick={() => void accept()}
        >
          {submitting ? "กำลังบันทึก..." : "ยอมรับ และเริ่มใช้งาน"}
        </button>
        <a
          href={`tel:${SUPPORT_PHONE}`}
          className="cw-btn cw-btn-ghost"
          style={{ width: "100%" }}
        >
          ไม่ยอมรับ — ติดต่อทีมงาน {SUPPORT_PHONE}
        </a>
        <p className="text-center text-[11.5px]" style={{ color: "var(--cw-text-3)" }}>
          ถ้าไม่ยอมรับ จะยังใช้ขอคืนแต้มไม่ได้ แต่ติดต่อทีมงานได้เสมอ
        </p>
      </div>
    </div>
  );
}
