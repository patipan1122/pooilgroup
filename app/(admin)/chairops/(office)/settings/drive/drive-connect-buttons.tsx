"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Unplug } from "lucide-react";
import { startDriveConnect, disconnectDrive } from "./actions";

export function ConnectButton() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const res = await startDriveConnect();
            if (res.ok) window.location.href = res.url;
            else setErr(res.error);
          })
        }
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Link2 className="size-4" />
        )}
        เชื่อม Google Drive
      </button>
      {err ? <p className="mt-2 text-xs text-rose-700">{err}</p> : null}
    </div>
  );
}

export function DisconnectButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm("ยกเลิกการเชื่อม Google Drive? (ไฟล์เก่าใน Drive ไม่ถูกลบ)")) return;
        start(async () => {
          await disconnectDrive();
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
      ยกเลิกการเชื่อม
    </button>
  );
}
