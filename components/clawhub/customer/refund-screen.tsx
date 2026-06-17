"use client";

// ClawHub refund — the money screen. Customer (1) types the 7-Eleven branch code, (2)
// snaps/uploads the machine LCD photo, (3) types the baht inserted, then submits. We
// compress the image client-side and POST
//   { idToken, claimedBaht, imageBase64, mimeType, machineCode?, storeBranchCode }.
// storeBranchCode is REQUIRED (server 400 "ต้องระบุเลขสาขา 7-11" otherwise). The server
// re-verifies the token, runs AI vision, and decides. Result states are shown clearly &
// reassuringly (never accusatory).

import { useRef, useState } from "react";
import { useClawhub } from "./liff-context";
import { CwHeader, CwButtonLink, CwExample } from "./ui";
import { compressImage } from "./image-compress";
import { SUPPORT_PHONE } from "@/lib/clawhub/constants";

type ResolvedMachineLite = {
  machineCode: string;
  branchName: string | null;
} | null;

type RefundResult = {
  status: "AUTO_APPROVED" | "PENDING_REVIEW" | "DUPLICATE" | "NEEDS_REPHOTO";
  pointsAwarded: number;
  reason: string;
  balance: number;
};

export function RefundScreen({
  machine,
  machineCode,
}: {
  machine: ResolvedMachineLite;
  /** Raw ?machine= value to forward (resolves again server-side for the snapshot). */
  machineCode: string | null;
}) {
  const { member, getIdToken, setMember } = useClawhub();
  const fileRef = useRef<HTMLInputElement>(null);
  const [branchCode, setBranchCode] = useState<string>("");
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>("image/jpeg");
  const [baht, setBaht] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<RefundResult | null>(null);

  const needsConsent = member != null && !member.consented;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    try {
      const img = await compressImage(file);
      setBase64(img.base64);
      setMimeType(img.mimeType);
      setPreview(img.previewUrl);
    } catch {
      setErr("อ่านรูปไม่สำเร็จ ลองถ่ายใหม่อีกครั้ง");
    }
  }

  function resetPhoto() {
    setPreview(null);
    setBase64(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    setErr(null);
    const branch = branchCode.trim();
    const claimed = Number(baht);
    if (!branch) {
      setErr("กรุณากรอกเลขสาขา 7-11 (เช่น 00024)");
      return;
    }
    if (!base64) {
      setErr("กรุณาถ่ายรูปหน้าจอตู้ก่อน");
      return;
    }
    if (!Number.isInteger(claimed) || claimed <= 0) {
      setErr("กรุณากรอกจำนวนเงินเป็นตัวเลข (บาท)");
      return;
    }
    setBusy(true);
    try {
      const idToken = await getIdToken();
      if (!idToken) {
        setErr("ไม่ได้ข้อมูล LINE — เปิดผ่านแอป LINE อีกครั้ง");
        return;
      }
      const res = await fetch("/api/clawhub/refund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          claimedBaht: claimed,
          imageBase64: base64,
          mimeType,
          machineCode: machineCode ?? undefined,
          storeBranchCode: branch,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<RefundResult> & {
        error?: string;
        needsConsent?: boolean;
      };
      if (res.status === 403 && json.needsConsent) {
        setErr("ต้องยอมรับเงื่อนไขก่อนใช้งาน");
        return;
      }
      if (!res.ok || !json.status) {
        setErr(json.error ?? "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      }
      const r: RefundResult = {
        status: json.status,
        pointsAwarded: json.pointsAwarded ?? 0,
        reason: json.reason ?? "",
        balance: json.balance ?? member?.balance ?? 0,
      };
      setResult(r);
      // Keep the home balance in sync.
      if (member) setMember({ ...member, balance: r.balance });
    } catch {
      setErr("เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  // ---------- RESULT STATES ----------
  if (result) {
    if (result.status === "AUTO_APPROVED") {
      return (
        <ResultShell emoji="🎉" tone="ok" pop title={`+${result.pointsAwarded.toLocaleString("th-TH")} แต้ม!`}>
          <p className="text-[14px]" style={{ color: "var(--cw-text-2)" }}>
            เยี่ยม! แต้มเข้าบัญชีแล้ว ตอนนี้คุณมี{" "}
            <strong className="cw-tnum">{result.balance.toLocaleString("th-TH")}</strong> แต้ม
          </p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
            แต้มมีอายุ 30 วัน รีบใช้แลกของน่ารัก ๆ กันนะ
          </p>
          <div className="mt-5 space-y-3">
            <CwButtonLink href="/liff/clawhub?screen=rewards">🧸 ไปแลกตุ๊กตา</CwButtonLink>
            <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
              กลับหน้าหลัก
            </CwButtonLink>
          </div>
        </ResultShell>
      );
    }
    if (result.status === "NEEDS_REPHOTO") {
      return (
        <ResultShell emoji="📷" tone="pending" title="ขอรูปที่ชัดขึ้นอีกนิด">
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
            ถ่ายใหม่ให้เห็นหน้าจอ LCD สีฟ้าชัด ๆ — เห็นตัวเลข Credit / Price / Add up ครบ
            โดยไม่ให้แสงสะท้อนหรือมือบัง แล้วได้แต้มแน่นอน
          </p>
          <div className="mt-5">
            <button type="button" className="cw-btn" style={{ width: "100%" }} onClick={resetPhoto}>
              ถ่ายรูปใหม่
            </button>
          </div>
        </ResultShell>
      );
    }
    if (result.status === "PENDING_REVIEW") {
      return (
        <ResultShell emoji="🔎" tone="pending" title="กำลังตรวจสอบ ได้แต้มแน่นอน">
          <p className="text-[14px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
            เราได้รับคำขอของคุณแล้ว ทีมงานกำลังตรวจสอบให้เร็วที่สุด เมื่อยืนยันเสร็จ แต้มจะเข้าบัญชีอัตโนมัติ
            ติดตามสถานะได้ที่เมนู แต้ม &amp; ประวัติ
          </p>
          <div className="mt-5 space-y-3">
            <CwButtonLink href="/liff/clawhub?screen=points">ดูสถานะคำขอ</CwButtonLink>
            <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
              กลับหน้าหลัก
            </CwButtonLink>
          </div>
        </ResultShell>
      );
    }
    // DUPLICATE
    return (
      <ResultShell emoji="🔁" tone="info" title="รูปนี้ใช้ขอคืนไปแล้ว">
        <p className="text-[14px] leading-relaxed" style={{ color: "var(--cw-text-2)" }}>
          แต่ละครั้งใช้รูปหน้าจอใหม่นะ ถ้าตู้มีปัญหาอีกครั้ง ถ่ายรูปจอใหม่แล้วส่งได้เลย
        </p>
        <div className="mt-5">
          <button type="button" className="cw-btn" style={{ width: "100%" }} onClick={resetPhoto}>
            ถ่ายรูปใหม่
          </button>
        </div>
      </ResultShell>
    );
  }

  // ---------- FORM ----------
  return (
    <div className="mx-auto w-full max-w-md pb-28">
      <CwHeader title="ขอคืนแต้ม (ตู้มีปัญหา)" />

      <div className="space-y-4 px-4">
        {machine ? (
          <div
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold"
            style={{ background: "var(--cw-info-soft)", color: "var(--cw-teal)" }}
          >
            <span aria-hidden>🎰</span>
            ตู้ {machine.machineCode}
            {machine.branchName ? ` · สาขา ${machine.branchName}` : ""}
          </div>
        ) : null}

        {needsConsent ? (
          <div
            className="rounded-xl p-3 text-[13px] font-medium"
            style={{ background: "var(--cw-pending-soft)", color: "var(--cw-brand-700)" }}
          >
            ต้องยอมรับเงื่อนไขก่อนขอคืน —{" "}
            <a className="font-bold underline" href="/liff/clawhub?screen=register">
              กดที่นี่
            </a>
          </div>
        ) : null}

        {/* STEP 1 — branch code (REQUIRED) */}
        <div className="cw-card p-4">
          <div className="flex items-center gap-2.5">
            <span className="cw-step">1</span>
            <div>
              <label htmlFor="rf-branch" className="block text-[14.5px] font-bold" style={{ color: "var(--cw-text)" }}>
                เลขสาขา 7-11 ที่ตั้งตู้
              </label>
              <p className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
                ดูที่หน้าร้าน 7-11 (ตัวเลข 5 หลัก เช่น 00024)
              </p>
            </div>
          </div>
          <input
            id="rf-branch"
            type="text"
            inputMode="numeric"
            value={branchCode}
            onChange={(e) => setBranchCode(e.target.value)}
            placeholder="เช่น 00024"
            className="cw-input cw-tnum mt-3"
          />
          <CwExample
            src="/clawhub/example-7eleven-branch.jpg"
            label="ดูตัวอย่าง: หารหัสสาขาตรงไหน"
            alt="ตัวอย่างป้ายหน้าร้าน 7-11 ที่แสดงรหัสสาขาและชื่อสาขา"
          />
        </div>

        {/* STEP 2 — photo */}
        <div className="cw-card p-4">
          <div className="flex items-center gap-2.5">
            <span className="cw-step">2</span>
            <div>
              <div className="text-[14.5px] font-bold" style={{ color: "var(--cw-text)" }}>
                ถ่ายรูปหน้าจอตู้
              </div>
              <p className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
                ให้เห็นตัวเลขบนจอ LCD สีฟ้าชัด ๆ
              </p>
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void onPick(e)}
          />

          {preview ? (
            <div className="mt-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview}
                alt="หน้าจอตู้"
                className="w-full rounded-xl object-cover"
                style={{ maxHeight: 260, border: "1px solid var(--cw-border)" }}
              />
              <button
                type="button"
                className="cw-btn cw-btn-ghost mt-3"
                style={{ width: "100%" }}
                onClick={() => fileRef.current?.click()}
              >
                ถ่าย/เลือกรูปใหม่
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="cw-tap mt-3 flex w-full flex-col items-center justify-center gap-1.5 rounded-xl py-8"
              style={{ background: "var(--cw-bg-3)", border: "1.5px dashed var(--cw-border-strong)" }}
              onClick={() => fileRef.current?.click()}
            >
              <span className="text-4xl">📸</span>
              <span className="text-[14.5px] font-bold" style={{ color: "var(--cw-brand-700)" }}>
                แตะเพื่อถ่ายรูป
              </span>
            </button>
          )}

          <CwExample
            src="/clawhub/example-machine-screen.jpg"
            label="ถ่ายหน้าจอเครื่องแบบนี้"
            alt="ตัวอย่างหน้าจอ LCD ของเครื่อง แสดง Credit / Time / Price / Add up"
          />
        </div>

        {/* STEP 3 — baht */}
        <div className="cw-card p-4">
          <div className="flex items-center gap-2.5">
            <span className="cw-step">3</span>
            <label htmlFor="rf-baht" className="text-[14.5px] font-bold" style={{ color: "var(--cw-text)" }}>
              จำนวนเงินที่หยอด (บาท)
            </label>
          </div>
          <input
            id="rf-baht"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={baht}
            onChange={(e) => setBaht(e.target.value)}
            placeholder="เช่น 50"
            className="cw-input cw-tnum mt-3 font-bold"
            style={{ fontSize: 20 }}
          />
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
          className="block text-center text-[12.5px] underline"
          style={{ color: "var(--cw-text-3)" }}
        >
          มีปัญหา? โทรหาทีมงาน {SUPPORT_PHONE}
        </a>
      </div>

      {/* sticky primary action */}
      <div className="cw-stickybar mx-auto max-w-md">
        <button
          type="button"
          className="cw-btn"
          style={{ width: "100%" }}
          disabled={busy || needsConsent}
          onClick={() => void submit()}
        >
          {busy ? "กำลังตรวจสอบ..." : "ส่งขอคืนแต้ม"}
        </button>
      </div>
    </div>
  );
}

function ResultShell({
  emoji,
  title,
  tone,
  pop,
  children,
}: {
  emoji: string;
  title: string;
  tone: "ok" | "pending" | "danger" | "info";
  pop?: boolean;
  children: React.ReactNode;
}) {
  const bg =
    tone === "ok"
      ? "var(--cw-ok-soft)"
      : tone === "pending"
        ? "var(--cw-pending-soft)"
        : tone === "info"
          ? "var(--cw-info-soft)"
          : "var(--cw-danger-soft)";
  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="ขอคืนแต้ม" back />
      <div className="px-4">
        <div className="cw-card p-6 text-center">
          <div
            className={`mx-auto grid size-20 place-items-center rounded-3xl text-5xl ${pop ? "cw-pop" : ""}`}
            style={{ background: bg }}
          >
            {emoji}
          </div>
          <h2
            className="mt-4 text-[24px] font-extrabold"
            style={{ color: tone === "ok" ? "var(--cw-brand-700)" : "var(--cw-text)", letterSpacing: "-0.02em" }}
          >
            {title}
          </h2>
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
