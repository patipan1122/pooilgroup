"use client";

// ฟอร์มแนบสลิปต่อคำขอโอน — ถ่าย/เลือกรูปสลิป → ส่งให้ attachSlipToRequestAction
// (อัป R2 → OCR → จับคู่คำขอนี้ → ปิดบิล + ออก PV). โชว์ผลชัด: ปิดครบ / รอบัญชีตรวจ / ผิดพลาด.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachSlipToRequestAction } from "../../_actions";

type Msg = { tone: "ok" | "warn" | "err"; text: string };

export function AttachSlipForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setMsg(null);
    setFile(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  function submit() {
    if (!file || pending) return;
    const fd = new FormData();
    fd.append("slip", file);
    start(async () => {
      const res = await attachSlipToRequestAction(requestId, fd);
      if (res.ok && res.state === "paid") {
        setMsg({
          tone: "ok",
          text: "✓ แนบสลิปแล้ว · ปิดบิลเรียบร้อย — ระบบออกใบสำคัญจ่ายให้อัตโนมัติ",
        });
        setDone(true);
        router.refresh();
      } else if (res.ok) {
        setMsg({ tone: "warn", text: res.warning ?? "แนบสลิปแล้ว — รอบัญชีตรวจ" });
        setDone(true);
        router.refresh();
      } else {
        setMsg({ tone: "err", text: res.error ?? "แนบสลิปไม่สำเร็จ" });
      }
    });
  }

  const toneClass =
    msg?.tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : msg?.tone === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-700";

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-base font-semibold text-zinc-800">แนบสลิปโอนเงิน</p>
      <p className="mt-1 text-sm text-zinc-500">
        โอนแล้วถ่ายรูปสลิปแนบตรงนี้ ระบบจะจับคู่ยอด + ปิดบิลให้อัตโนมัติ
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
      />

      {preview ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={done}
          className="press mt-4 block w-full overflow-hidden rounded-xl border border-zinc-200"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="สลิปที่เลือก" className="max-h-64 w-full object-contain bg-zinc-50" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="press mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
        >
          📎 เลือก / ถ่ายรูปสลิป
        </button>
      )}

      {msg && (
        <div className={`mt-3 rounded-xl border px-3 py-2 text-sm ${toneClass}`}>{msg.text}</div>
      )}

      {!done && (
        <button
          type="button"
          onClick={submit}
          disabled={!file || pending}
          className="press mt-4 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[var(--color-brand-600)] text-base font-semibold text-white transition-colors hover:bg-[var(--color-brand-700)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "กำลังตรวจสลิป…" : "ยืนยันแนบสลิป"}
        </button>
      )}
    </div>
  );
}
