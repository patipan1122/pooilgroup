"use client";

// ClawHub register + PDPA consent. Collects the member's real full name + mobile phone
// + birthday + gender (all REQUIRED) + (optional) delivery address — prefilled from
// useClawhub().member when present. Age is auto-computed from the birthday and shown
// read-only. On accept we POST /api/clawhub/member
// { idToken, consent:true, fullName, phone, birthDate, gender, address? }. The server
// verifies the token, saves the profile, and stamps consentAt.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useClawhub } from "./liff-context";
import { CwHeader, CwMascot, CW_MASCOT, computeAge } from "./ui";
import { SUPPORT_PHONE } from "@/lib/clawhub/constants";

const GENDERS = ["ชาย", "หญิง", "ไม่ระบุ"] as const;

export function RegisterScreen() {
  const router = useRouter();
  const { profile, member, getIdToken, setMember } = useClawhub();
  const [fullName, setFullName] = useState(member?.fullName ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [birthDate, setBirthDate] = useState(member?.birthDate ?? "");
  const [gender, setGender] = useState(member?.gender ?? "");
  const [address, setAddress] = useState(member?.address ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const age = computeAge(birthDate || null);
  const canSubmit =
    fullName.trim() !== "" &&
    phone.trim() !== "" &&
    birthDate.trim() !== "" &&
    gender.trim() !== "";

  // Already consented → straight to home.
  if (member?.consented) {
    router.replace("/liff/clawhub?screen=home");
  }

  async function accept() {
    setErr(null);
    const name = fullName.trim();
    const tel = phone.trim();
    if (!name) {
      setErr("กรุณากรอกชื่อ-นามสกุล");
      return;
    }
    if (!tel) {
      setErr("กรุณากรอกเบอร์โทรศัพท์มือถือ");
      return;
    }
    if (!birthDate.trim()) {
      setErr("กรุณาเลือกวันเกิด");
      return;
    }
    if (age == null) {
      setErr("วันเกิดไม่ถูกต้อง กรุณาเลือกใหม่");
      return;
    }
    if (!gender.trim()) {
      setErr("กรุณาเลือกเพศ");
      return;
    }
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
          fullName: name,
          phone: tel,
          birthDate: birthDate.trim(),
          gender: gender.trim(),
          address: address.trim() || undefined,
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
    <div className="mx-auto w-full max-w-md pb-28">
      <CwHeader title="สมัครสมาชิก" />

      <div className="space-y-4 px-4">
        {/* friendly intro + mascot */}
        <div className="flex items-center gap-3 px-1">
          <CwMascot src={CW_MASCOT.knight} alt="อัศวิน JOLLY PLAY" size={84} />
          <div className="min-w-0">
            <h1 className="cw-title text-[22px]">
              ยินดีต้อนรับสู่ <span className="accent">JOLLY PLAY</span>
            </h1>
            <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
              กรอกข้อมูลสั้น ๆ เพื่อรับแต้มและแลกของได้เลย ใช้เวลาไม่ถึงนาที
            </p>
          </div>
        </div>

        {/* LINE identity card */}
        <div className="cw-card flex items-center gap-3 p-4">
          {profile?.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.pictureUrl} alt="" className="size-11 rounded-full object-cover" />
          ) : (
            <div
              className="grid size-11 place-items-center rounded-full text-lg"
              style={{ background: "var(--cw-brand-50)" }}
            >
              🙂
            </div>
          )}
          <div className="min-w-0">
            <div className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
              บัญชี LINE
            </div>
            <div className="truncate text-[15px] font-bold" style={{ color: "var(--cw-text)" }}>
              {profile?.displayName ?? "ลูกค้า JOLLY PLAY"}
            </div>
          </div>
        </div>

        {/* profile fields */}
        <div className="cw-card space-y-4 p-4">
          <div>
            <label htmlFor="reg-name" className="cw-label">
              ชื่อ-นามสกุล <span style={{ color: "var(--cw-red)" }}>*</span>
            </label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              className="cw-input"
            />
          </div>
          <div>
            <label htmlFor="reg-phone" className="cw-label">
              เบอร์โทรศัพท์มือถือ <span style={{ color: "var(--cw-red)" }}>*</span>
            </label>
            <input
              id="reg-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="08X-XXX-XXXX"
              className="cw-input cw-tnum"
            />
          </div>
          <div>
            <label htmlFor="reg-birth" className="cw-label">
              วันเกิด <span style={{ color: "var(--cw-red)" }}>*</span>
            </label>
            <input
              id="reg-birth"
              type="date"
              autoComplete="bday"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setBirthDate(e.target.value)}
              className="cw-input cw-tnum"
            />
            {age != null ? (
              <div
                className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold"
                style={{ background: "var(--cw-brand-50)", color: "var(--cw-brand-700)" }}
                aria-live="polite"
              >
                <span aria-hidden>🎂</span> อายุ {age} ปี
              </div>
            ) : null}
          </div>
          <div>
            <span className="cw-label">
              เพศ <span style={{ color: "var(--cw-red)" }}>*</span>
            </span>
            <div className="cw-seg" role="radiogroup" aria-label="เพศ">
              {GENDERS.map((g) => (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={gender === g}
                  className={`cw-seg-btn ${gender === g ? "active" : ""}`}
                  onClick={() => setGender(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="reg-address" className="cw-label">
              ที่อยู่จัดส่ง{" "}
              <span className="font-normal" style={{ color: "var(--cw-text-3)" }}>
                (ไม่บังคับ — เผื่อให้ส่งของถึงบ้าน)
              </span>
            </label>
            <textarea
              id="reg-address"
              autoComplete="street-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="บ้านเลขที่ / ถนน / ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์"
              className="cw-input"
              rows={3}
            />
          </div>
        </div>

        {/* PDPA */}
        <div className="cw-card p-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold" style={{ color: "var(--cw-text)" }}>
            <span aria-hidden>🔒</span> ข้อตกลงการใช้งาน (PDPA)
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
            เราเก็บข้อมูลของคุณ<strong> เพื่อตรวจสอบการคืนแต้มและจัดส่งของรางวัลเท่านั้น </strong>
            ไม่ส่งต่อให้บุคคลภายนอก
          </p>
          <ul className="mt-3 space-y-1.5 text-[12.5px]" style={{ color: "var(--cw-text-2)" }}>
            <li>• ชื่อ · เบอร์ · ที่อยู่ ใช้เพื่อยืนยันตัวและจัดส่งของ</li>
            <li>• รูปหน้าจอตู้ที่ส่ง ใช้ตรวจสอบการคืนแต้ม</li>
            <li>• แต้มใช้แลกของจริงเท่านั้น ไม่ใช่เงินสด</li>
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

        <a
          href={`tel:${SUPPORT_PHONE}`}
          className="block text-center text-[12px] underline"
          style={{ color: "var(--cw-text-3)" }}
        >
          ไม่ยอมรับเงื่อนไข? ติดต่อทีมงาน {SUPPORT_PHONE}
        </a>
      </div>

      {/* sticky primary action */}
      <div className="cw-stickybar mx-auto max-w-md">
        <button
          type="button"
          className="cw-btn"
          style={{ width: "100%" }}
          disabled={submitting || !canSubmit}
          onClick={() => void accept()}
        >
          {submitting ? "กำลังบันทึก..." : "ยอมรับ และเริ่มใช้งาน"}
        </button>
      </div>
    </div>
  );
}
