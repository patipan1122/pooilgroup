"use client";

// Playland · พิมพ์สายรัดเด็กออกเครื่อง NIIMBOT K2 ผ่านคิว (เบราว์เซอร์วางภาพ → server action เข้าคิว → agent หน้าร้านพิมพ์)
// ขั้นเข้าคิวเร็ว (<1 วิ) แล้วคืนผลทันที เพื่อให้ผู้เรียกสลับไปพิมพ์ popup แบบเดิมได้ภายในจังหวะคลิก (กัน popup โดนบล็อก)
// ส่วน "รอเครื่องพิมพ์เสร็จจริง" (~45 วิ) แยกเป็น waitForResult ให้ผู้เรียกรอเองเบื้องหลัง ไม่บล็อกหน้าจอแคชเชียร์

import { enqueueWristbandPrint, getPrintJobStatus } from "@/lib/playland/print-jobs";
import { renderWristbandBitmap } from "@/lib/playland/wristband-bitmap";

export interface K2PrintArgs {
  branchId: string;
  /** รหัสเต็ม เช่น PW-A3F7K9M4Q (บาร์โค้ดจะตัด PW- ให้เอง) */
  code: string;
  /** ชื่อที่จะพิมพ์ (ชื่อเล่นก่อน ไม่มีค่อยใช้ชื่อจริง) */
  displayName: string;
  memberId?: string | null;
  /** นาทีของแพ็กเกจ · null/0 = ไม่แสดง (เช่นรายวัน) */
  durationMinutes: number | null;
}

export type K2QueueResult =
  | { queued: true; jobId: string; waitForResult: () => Promise<{ ok: true } | { ok: false; message: string }> }
  | { queued: false; reason: "NO_PRINTER" | "PRINTER_OFFLINE" | "QUEUE_FULL" | "ERROR"; message: string };

const POLL_MS = 2000;
const GIVE_UP_MS = 150_000; // งาน 1 ใบ ~45 วิ · เผื่อคิวหน้าอีก 2 ใบ

export async function queueWristbandOnK2(args: K2PrintArgs): Promise<K2QueueResult> {
  let bitmapBase64: string;
  try {
    const bmp = await renderWristbandBitmap({
      name: args.displayName,
      durationMinutes: args.durationMinutes && args.durationMinutes > 0 ? args.durationMinutes : null,
      date: new Date(),
      code: args.code,
    });
    bitmapBase64 = bmp.bitmapBase64;
  } catch (e) {
    return { queued: false, reason: "ERROR", message: e instanceof Error ? e.message : "วาดสายรัดไม่สำเร็จ" };
  }

  let res;
  try {
    res = await enqueueWristbandPrint({
      branchId: args.branchId,
      bitmapBase64,
      wristbandCode: args.code,
      memberId: args.memberId ?? null,
      displayName: args.displayName,
    });
  } catch (e) {
    return { queued: false, reason: "ERROR", message: e instanceof Error ? e.message : "ส่งงานพิมพ์ไม่สำเร็จ" };
  }
  if (!res.ok) {
    const reason = res.code === "NO_PRINTER" || res.code === "PRINTER_OFFLINE" || res.code === "QUEUE_FULL" ? res.code : "ERROR";
    return { queued: false, reason, message: res.error };
  }

  const jobId = res.data.jobId;
  return {
    queued: true,
    jobId,
    waitForResult: async () => {
      const deadline = Date.now() + GIVE_UP_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        try {
          const st = await getPrintJobStatus(jobId);
          if (!st.ok) return { ok: false as const, message: st.error };
          if (st.data.status === "DONE") return { ok: true as const };
          if (st.data.status === "FAILED") return { ok: false as const, message: st.data.error ?? "เครื่องพิมพ์ไม่สำเร็จ" };
        } catch {
          /* เน็ตสะดุด — รอบถัดไปลองใหม่ */
        }
      }
      return { ok: false as const, message: "รอเครื่องพิมพ์นานเกินไป (ไม่ตอบ)" };
    },
  };
}
