"use client";

import { useState, useTransition } from "react";
import { actSyncAll, actSyncProvider } from "../_actions";

export function SyncAllButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-zinc-600">{msg}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("กำลัง sync...");
            try {
              const r = await actSyncAll();
              setMsg(`✓ ${r.totalNewRows} rows · ${r.alertsTriggered} alerts`);
            } catch (e) {
              setMsg(`✗ ${(e as Error).message.slice(0, 60)}`);
            }
          })
        }
        className="h-9 px-3 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 disabled:opacity-50"
      >
        {pending ? "กำลัง sync..." : "Sync ตอนนี้ (ทั้งหมด)"}
      </button>
    </div>
  );
}

export function SyncProviderButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-zinc-600">{msg}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg("กำลัง sync...");
            try {
              const r = await actSyncProvider(slug);
              setMsg(`✓ ${r.status} · ${r.newRows} rows`);
            } catch (e) {
              setMsg(`✗ ${(e as Error).message.slice(0, 60)}`);
            }
          })
        }
        className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        {pending ? "กำลัง sync..." : "Sync provider นี้"}
      </button>
    </div>
  );
}
