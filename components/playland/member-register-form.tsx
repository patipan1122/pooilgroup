"use client";

// Multi-step register form (single page · accordion-style sections)
// Per CEO style "อยู่ในหน้าเดียวให้ได้":
//   1. ถ่ายรูปหน้า  →  ข้อมูล  →  ครอบครัว  →  เลือก package  →  ชำระเงิน
// All visible at once · scroll · cashier can jump between sections

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FaceCapture } from "./face-capture";
import { createMember, checkInSession } from "@/lib/playland/actions";
import { CheckCircle2, AlertCircle, UserPlus } from "lucide-react";

interface Pkg {
  id: string;
  name: string;
  type: string;
  minutes: number | null;
  price: number;
  description: string | null;
}
interface FamilyGroup {
  id: string;
  displayName: string;
}

interface Props {
  branchId: string;
  packages: Pkg[];
  familyGroups: FamilyGroup[];
}

const TYPES = [
  { v: "KID", label: "เด็ก", color: "var(--pl-info)" },
  { v: "PARENT", label: "ผู้ปกครอง", color: "var(--pl-brand)" },
  { v: "STAFF", label: "พนักงาน", color: "var(--pl-text-muted)" },
  { v: "CLEANER", label: "แม่บ้าน", color: "var(--pl-text-muted)" },
  { v: "VIP", label: "VIP", color: "#a855f7" },
  { v: "BABYSITTER", label: "พี่เลี้ยง", color: "#10b981" },
  { v: "GUEST", label: "ทั่วไป", color: "var(--pl-text-muted)" },
] as const;

const PAY_METHODS = [
  { v: "CASH", label: "เงินสด" },
  { v: "PROMPTPAY", label: "PromptPay" },
  { v: "STRIPE", label: "Stripe (บัตร)" },
  { v: "CHARGE_TO_MEMBER", label: "ใส่บิล (จ่ายตอนออก)" },
] as const;

export function MemberRegisterForm({ branchId, packages, familyGroups }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [photo, setPhoto] = useState<string | null>(null);
  const [type, setType] = useState<(typeof TYPES)[number]["v"]>("KID");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [familyMode, setFamilyMode] = useState<"existing" | "new" | "none">("new");
  const [existingFamilyId, setExistingFamilyId] = useState("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [selectedPkg, setSelectedPkg] = useState<string>(packages[0]?.id ?? "");
  const [pay, setPay] = useState<(typeof PAY_METHODS)[number]["v"]>("CASH");
  const [consent, setConsent] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [autoCheckin, setAutoCheckin] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const lastCreatedFamilyIdRef = useRef<string | null>(null);

  function reset() {
    setPhoto(null);
    setName("");
    setNickname("");
    setPhone("");
    setDob("");
    setFamilyMode("new");
    setNewFamilyName("");
    setExistingFamilyId("");
    setConsent(false);
    setWaiver(false);
    setMsg(null);
  }

  // Soft reset · keep family + consent · clear only person-specific fields
  // Lets cashier register family of 3 in 1 flow without re-doing setup per child
  // (per Cashier persona #1 + UX #2 reviews)
  function resetForNextInFamily(familyGroupId?: string) {
    setPhoto(null);
    setName("");
    setNickname("");
    setDob("");
    setType("KID");                                  // most common next-in-family
    if (familyGroupId) {
      setFamilyMode("existing");
      setExistingFamilyId(familyGroupId);
    }
    // KEEP: phone · consent · waiver · familyMode/group · package · pay
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) { setMsg({ kind: "err", text: "ยังไม่ถ่ายรูปหน้า" }); return; }
    if (!name.trim()) { setMsg({ kind: "err", text: "ใส่ชื่อก่อน" }); return; }
    if (!consent) { setMsg({ kind: "err", text: "ต้องยินยอม PDPA ก่อนลงทะเบียน" }); return; }
    if (!waiver) { setMsg({ kind: "err", text: "ต้องเซ็น waiver ก่อน" }); return; }

    start(async () => {
      const res = await createMember({
        branchId,
        type,
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        phone: phone.trim() || undefined,
        dateOfBirth: dob || undefined,
        photoDataUrl: photo,
        familyGroupId: familyMode === "existing" ? existingFamilyId : undefined,
        newFamilyGroupName: familyMode === "new" ? (newFamilyName.trim() || `ครอบครัวคุณ${name.trim()}`) : undefined,
        consentGiven: consent,
      });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }

      if (autoCheckin && selectedPkg) {
        const inRes = await checkInSession({
          branchId,
          memberId: res.data.memberId,
          packageId: selectedPkg,
          paymentMethod: pay,
        });
        if (!inRes.ok) { setMsg({ kind: "err", text: `Member สร้างแล้ว แต่ check-in ไม่สำเร็จ: ${inRes.error}` }); return; }
      }
      setMsg({ kind: "ok", text: `ลงทะเบียน "${name}" สำเร็จ · faceId: ${res.data.faceId ?? "(ยังไม่ผูก device)"}` });
      // If we just created the family, capture its id so "เพิ่มเด็กอีกคน" reuses it
      const justCreatedFamilyId = res.data.memberId ? undefined : undefined; // family id not returned · use existingFamilyId if set
      lastCreatedFamilyIdRef.current = familyMode === "existing" ? existingFamilyId : null;
      reset();
      router.refresh();
    });
  }

  // Used by "เพิ่มเด็กอีกคน" button after a successful registration
  function addAnotherInSameFamily() {
    resetForNextInFamily(lastCreatedFamilyIdRef.current ?? existingFamilyId);
    setMsg(null);
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 16, padding: 16 }}>
      {msg && (
        <div className="pl-card" role={msg.kind === "err" ? "alert" : "status"} aria-live="polite" style={{
          background: msg.kind === "ok" ? "var(--pl-ok-soft)" : "var(--pl-danger-soft)",
          color: msg.kind === "ok" ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)",
          display: "flex", gap: 10, alignItems: "center", fontSize: 14,
        }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ flex: 1 }}>{msg.text}</span>
          {msg.kind === "ok" && (
            <button type="button" className="pl-btn pl-btn-sm pl-btn-primary" onClick={addAnotherInSameFamily}>
              <UserPlus size={12} /> เพิ่มเด็กอีกคน
            </button>
          )}
        </div>
      )}

      <div className="pl-card" style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 24 }}>
        <FaceCapture value={photo} onChange={setPhoto} label="ขั้นที่ 1 · ถ่ายรูปหน้า" />

        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: "var(--pl-text-muted)", fontWeight: 600 }}>ขั้นที่ 2 · ประเภทสมาชิก</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {TYPES.map((t) => (
                <button
                  type="button"
                  key={t.v}
                  onClick={() => setType(t.v)}
                  className="pl-btn"
                  style={type === t.v ? { borderColor: t.color, background: t.color, color: "white" } : {}}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อจริง <span style={{ color: "var(--pl-danger)" }}>*</span></label>
              <input className="pl-input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น น้องเอ" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชื่อเล่น</label>
              <input className="pl-input" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>เบอร์โทร</label>
              <input className="pl-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>วันเกิด</label>
              <input className="pl-input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="pl-card">
        <div style={{ fontSize: 12, color: "var(--pl-text-muted)", fontWeight: 600, marginBottom: 8 }}>ขั้นที่ 3 · ครอบครัว (สำหรับจับคู่เด็ก-ผู้ปกครอง)</div>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button type="button" className="pl-btn" style={familyMode === "new" ? { background: "var(--pl-brand)", color: "white", borderColor: "var(--pl-brand)" } : {}} onClick={() => setFamilyMode("new")}>+ สร้างครอบครัวใหม่</button>
          <button type="button" className="pl-btn" style={familyMode === "existing" ? { background: "var(--pl-brand)", color: "white", borderColor: "var(--pl-brand)" } : {}} onClick={() => setFamilyMode("existing")}>เลือกครอบครัวที่มีอยู่</button>
          <button type="button" className="pl-btn" style={familyMode === "none" ? { background: "var(--pl-text-muted)", color: "white" } : {}} onClick={() => setFamilyMode("none")}>ไม่ผูกครอบครัว</button>
        </div>
        {familyMode === "new" && (
          <input className="pl-input" placeholder="ชื่อกลุ่มครอบครัว (เช่น ครอบครัวคุณสมศักดิ์)" value={newFamilyName} onChange={(e) => setNewFamilyName(e.target.value)} />
        )}
        {familyMode === "existing" && (
          <select className="pl-select" value={existingFamilyId} onChange={(e) => setExistingFamilyId(e.target.value)}>
            <option value="">-- เลือก --</option>
            {familyGroups.map((g) => (<option key={g.id} value={g.id}>{g.displayName}</option>))}
          </select>
        )}
      </div>

      <div className="pl-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: "var(--pl-text-muted)", fontWeight: 600 }}>ขั้นที่ 4 · เลือก Package (สำหรับ check-in ทันที)</div>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={autoCheckin} onChange={(e) => setAutoCheckin(e.target.checked)} /> Check-in อัตโนมัติหลังลงทะเบียน
          </label>
        </div>
        {autoCheckin && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
              {packages.length === 0 ? (
                <div style={{ color: "var(--pl-text-muted)", fontSize: 13 }}>ยังไม่มี package · ไปตั้งค่าก่อน (Settings)</div>
              ) : packages.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedPkg(p.id)}
                  className="pl-card"
                  style={{
                    textAlign: "left",
                    cursor: "pointer",
                    border: selectedPkg === p.id ? "2px solid var(--pl-brand)" : "1px solid var(--pl-line)",
                    background: selectedPkg === p.id ? "var(--pl-brand-soft)" : "white",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>
                    {p.type === "DAY_PASS" ? "ทั้งวัน" : p.type === "PER_MINUTE" ? "คิดนาที" : `${p.minutes ?? 0} นาที`}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 6, color: "var(--pl-brand-dark)" }}>฿{(p.price / 100).toLocaleString()}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>ชำระด้วย</label>
              <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                {PAY_METHODS.map((m) => (
                  <button type="button" key={m.v} className="pl-btn" onClick={() => setPay(m.v)} style={pay === m.v ? { background: "var(--pl-info)", color: "white", borderColor: "var(--pl-info)" } : {}}>{m.label}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="pl-card">
        <div style={{ fontSize: 12, color: "var(--pl-text-muted)", fontWeight: 600, marginBottom: 8 }}>ขั้นที่ 5 · ความยินยอม (จำเป็น)</div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginRight: 6 }} />
          ยินยอมให้ระบบเก็บรูปหน้า + ข้อมูลส่วนตัว ตาม <span style={{ textDecoration: "underline" }}>นโยบายความเป็นส่วนตัว (PDPA)</span> · เก็บ 1 ปีหลัง inactive · ขอลบได้ทุกเมื่อ
        </label>
        <label style={{ display: "block", fontSize: 13 }}>
          <input type="checkbox" checked={waiver} onChange={(e) => setWaiver(e.target.checked)} style={{ marginRight: 6 }} />
          รับทราบและยอมรับ <span style={{ textDecoration: "underline" }}>เงื่อนไขการใช้บริการ (Waiver)</span> · เด็กเล่นเครื่องเล่นด้วยความเสี่ยงของผู้ปกครอง
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="pl-btn" onClick={reset} disabled={pending}>Reset</button>
        <button type="submit" className="pl-btn pl-btn-primary" disabled={pending}>
          {pending ? "กำลังบันทึก..." : autoCheckin ? "ลงทะเบียน + Check-in" : "ลงทะเบียนเท่านั้น"}
        </button>
      </div>
    </form>
  );
}
