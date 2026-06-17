"use client";

// ClawHub refund — the money screen. Customer (a) snaps/uploads the machine LCD photo,
// (b) types the baht they inserted, then submits. We compress the image client-side,
// POST {idToken, claimedBaht, imageBase64, mimeType, machineCode?} and the server
// verifies the token, runs AI vision, and decides. Result states are shown clearly.

import { useRef, useState } from "react";
import { useClawhub } from "./liff-context";
import { CwHeader, CwButtonLink } from "./ui";
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
    const claimed = Number(baht);
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
        <ResultShell emoji="✅" tone="ok" title={`ได้รับ ${result.pointsAwarded} แต้ม!`}>
          <p className="text-[14px]" style={{ color: "var(--cw-text-2)" }}>
            แต้มคงเหลือ <strong>{result.balance.toLocaleString("th-TH")}</strong> แต้ม
          </p>
          <p className="mt-1 text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
            แต้มหมดอายุใน 30 วัน รีบใช้แลกของนะ
          </p>
          <div className="mt-5 space-y-3">
            <CwButtonLink href="/liff/clawhub?screen=rewards">
              🧸 ไปแลกตุ๊กตา
            </CwButtonLink>
            <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
              กลับหน้าหลัก
            </CwButtonLink>
          </div>
        </ResultShell>
      );
    }
    if (result.status === "NEEDS_REPHOTO") {
      return (
        <ResultShell emoji="📷" tone="pending" title="รูปไม่ชัด">
          <p className="text-[14px]" style={{ color: "var(--cw-text-2)" }}>
            ถ่ายใหม่ให้เห็นหน้าจอตู้ (จอ LCD สีฟ้า) ชัด ๆ ทั้งตัวเลข Credit / Price / Add up
            โดยไม่ให้แสงสะท้อนหรือมือบัง
          </p>
          <div className="mt-5">
            <button type="button" className="cw-btn" style={{ width: "100%" }} onClick={resetPhoto}>
              ถ่ายใหม่
            </button>
          </div>
        </ResultShell>
      );
    }
    if (result.status === "PENDING_REVIEW") {
      return (
        <ResultShell emoji="🔎" tone="pending" title="ระบบขอตรวจสอบเพิ่มเติม">
          <p className="text-[14px]" style={{ color: "var(--cw-text-2)" }}>
            แอดมินจะยืนยันให้เร็ว ๆ นี้ — เพราะคุณขอคืนบ่อย ระบบจึงขอตรวจเพื่อความเป็นธรรมกับทุกคน
            โปรดแนบหลักฐานให้ครบถ้วน
          </p>
          <div className="mt-5 space-y-3">
            <CwButtonLink href="/liff/clawhub?screen=points" variant="ghost">
              ดูสถานะคำขอ
            </CwButtonLink>
            <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
              กลับหน้าหลัก
            </CwButtonLink>
          </div>
        </ResultShell>
      );
    }
    // DUPLICATE
    return (
      <ResultShell emoji="🔁" tone="danger" title="รูปนี้ถูกใช้ขอคืนไปแล้ว">
        <p className="text-[14px]" style={{ color: "var(--cw-text-2)" }}>
          กรุณาถ่ายรูปหน้าจอตู้ใหม่สำหรับการขอคืนครั้งนี้
        </p>
        <div className="mt-5">
          <button type="button" className="cw-btn" style={{ width: "100%" }} onClick={resetPhoto}>
            ถ่ายใหม่
          </button>
        </div>
      </ResultShell>
    );
  }

  // ---------- FORM ----------
  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="ขอคืนเงิน (ตู้มีปัญหา)" />

      <div className="space-y-4 px-4">
        {machine ? (
          <div
            className="rounded-xl px-3 py-2 text-[13px] font-semibold"
            style={{ background: "var(--cw-info-soft)", color: "var(--cw-teal)" }}
          >
            ตู้: {machine.machineCode}
            {machine.branchName ? ` · สาขา ${machine.branchName}` : ""}
          </div>
        ) : null}

        {needsConsent ? (
          <div
            className="rounded-xl p-3 text-[13px] font-medium"
            style={{ background: "var(--cw-pending-soft)", color: "var(--cw-brand-700)" }}
          >
            ต้องยอมรับเงื่อนไขก่อนขอคืน —{" "}
            <a className="underline" href="/liff/clawhub?screen=register">
              กดที่นี่
            </a>
          </div>
        ) : null}

        {/* photo */}
        <div className="cw-card p-4">
          <div className="text-[14px] font-bold" style={{ color: "var(--cw-text)" }}>
            1. ถ่ายรูปหน้าจอตู้
          </div>
          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
            ให้เห็นตัวเลขบนจอ LCD สีฟ้าชัด ๆ
          </p>

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
              className="mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-xl py-7"
              style={{ background: "var(--cw-bg-3)", border: "1.5px dashed var(--cw-border-strong)" }}
              onClick={() => fileRef.current?.click()}
            >
              <span className="text-3xl">📸</span>
              <span className="text-[14px] font-semibold" style={{ color: "var(--cw-brand-700)" }}>
                แตะเพื่อถ่ายรูป
              </span>
            </button>
          )}
        </div>

        {/* baht */}
        <div className="cw-card p-4">
          <label className="text-[14px] font-bold" style={{ color: "var(--cw-text)" }}>
            2. จำนวนเงินที่หยอด (บาท)
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={baht}
            onChange={(e) => setBaht(e.target.value)}
            placeholder="เช่น 50"
            className="cw-tnum mt-2 w-full rounded-xl px-4 text-[18px] font-bold"
            style={{
              height: "var(--cw-touch)",
              background: "var(--cw-bg-2)",
              border: "1px solid var(--cw-border-strong)",
              color: "var(--cw-text)",
            }}
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

        <button
          type="button"
          className="cw-btn"
          style={{ width: "100%" }}
          disabled={busy || needsConsent}
          onClick={() => void submit()}
        >
          {busy ? "กำลังตรวจสอบ..." : "ส่งขอคืนแต้ม"}
        </button>
        <a href={`tel:${SUPPORT_PHONE}`} className="block text-center text-[12.5px] underline" style={{ color: "var(--cw-text-3)" }}>
          มีปัญหา? โทรหาทีมงาน {SUPPORT_PHONE}
        </a>
      </div>
    </div>
  );
}

function ResultShell({
  emoji,
  title,
  tone,
  children,
}: {
  emoji: string;
  title: string;
  tone: "ok" | "pending" | "danger";
  children: React.ReactNode;
}) {
  const bg =
    tone === "ok"
      ? "var(--cw-ok-soft)"
      : tone === "pending"
        ? "var(--cw-pending-soft)"
        : "var(--cw-danger-soft)";
  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="ขอคืนเงิน" />
      <div className="px-4">
        <div className="cw-card p-6 text-center">
          <div className="mx-auto grid size-16 place-items-center rounded-2xl text-4xl" style={{ background: bg }}>
            {emoji}
          </div>
          <h2 className="mt-3 text-[20px] font-extrabold" style={{ color: "var(--cw-text)", letterSpacing: "-0.02em" }}>
            {title}
          </h2>
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}
