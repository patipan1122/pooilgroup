"use client";

// การ์ด "ลิงก์กรอกข้อมูลพนักงานใหม่" + ปุ่มคัดลอก/แชร์
//
// CEO 2026-09-23: "กดเอาลิงก์จากไหน มันต้องมีปุ่ม copy link ได้ด้วย เพราะเป็น
// ลิงก์ถาวร แต่เพื่อหาย ให้มาอยู่หน้านี้"
//
// ลิงก์เป็น URL เดียวถาวร ไม่ผูกกับตัวบุคคล ไม่หมดอายุ → HR ไม่ต้องกดสร้างอะไร
// แค่ต้องหยิบไปส่งได้สะดวกทุกครั้งที่รับคนใหม่ จึงปักไว้บนสุดของหน้านี้
//
// ปุ่มแชร์ใช้ Web Share API (ขึ้นเฉพาะมือถือที่รองรับ — ส่งเข้า LINE ได้ในแตะเดียว)
// pattern เดียวกับปุ่มแชร์ประกาศงานใน components/recruit/copy-link-button.tsx

import { useEffect, useState } from "react";
import { Check, Copy, LinkIcon, Share2 } from "lucide-react";
import { toast } from "sonner";

export function OnboardingShareLink() {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- window มีเฉพาะฝั่งเบราว์เซอร์
     ถ้าอ่าน origin ตอน render จะ hydration mismatch */
  useEffect(() => {
    setUrl(`${window.location.origin}/onboard`);
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("คัดลอกลิงก์แล้ว · วางส่งให้พนักงานใหม่ได้เลย");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ · กดค้างที่ลิงก์เพื่อคัดลอกเองได้");
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "กรอกข้อมูลพนักงานใหม่",
        text: "กรอกข้อมูลพนักงานใหม่ + เซ็นสัญญาออนไลน์",
        url,
      });
    } catch {
      /* ผู้ใช้กดยกเลิกเอง — ไม่ใช่ error */
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-4 mb-4">
      <div className="flex items-start gap-3">
        <LinkIcon className="size-5 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--color-brand-900)]">
            ลิงก์กรอกข้อมูลพนักงานใหม่ (ลิงก์เดียว ใช้ได้ตลอด)
          </p>
          <p className="text-[12.5px] text-[var(--color-brand-800)] mt-0.5 leading-relaxed">
            ส่งลิงก์นี้ให้คนที่ตกลงรับเข้าทำงานแล้วเท่านั้น · ใช้ได้ทุกคน ทุกสาขา ทั้ง 2 บริษัท
            · ไม่ต้องสร้างลิงก์ใหม่ทุกครั้ง
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded-xl bg-white border border-[var(--color-brand-200)] px-3 py-2 text-[12.5px] font-mono text-zinc-700">
              {url || "กำลังโหลด..."}
            </code>
            <button
              type="button"
              onClick={copy}
              disabled={url === ""}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-brand-600)] px-3.5 py-2 text-[13px] font-bold text-white disabled:opacity-50"
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
            </button>
            {canShare && (
              <button
                type="button"
                onClick={share}
                disabled={url === ""}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--color-brand-300)] bg-white px-3.5 py-2 text-[13px] font-bold text-[var(--color-brand-800)] disabled:opacity-50"
              >
                <Share2 className="size-4" aria-hidden />
                แชร์
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
