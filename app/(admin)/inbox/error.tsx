"use client";

// Graceful boundary for the inbox module. The most likely cause of an error
// here right after deploy is that the database migration
// (supabase/migrations/20260528100000_inbox_omnichannel.sql) hasn't been
// applied yet, so the inbox_* tables don't exist. Show a friendly notice
// instead of a crash.

import { MessagesSquare, RefreshCw } from "lucide-react";

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <MessagesSquare className="size-7" />
        </div>
        <h2 className="text-lg font-bold text-zinc-900">
          กล่องข้อความรวมยังไม่พร้อมใช้งาน
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">
          ถ้าเพิ่งติดตั้งระบบ — สาเหตุที่พบบ่อยคือ <b>ยังไม่ได้รันฐานข้อมูล</b>{" "}
          (migration) ของโมดูลนี้ รบกวนแจ้งทีมเทคนิคให้รันไฟล์{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px]">
            20260528100000_inbox_omnichannel.sql
          </code>{" "}
          ก่อนนะคะ แล้วลองใหม่อีกครั้ง
        </p>
        <button
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          <RefreshCw className="size-4" />
          ลองใหม่
        </button>
      </div>
    </div>
  );
}
