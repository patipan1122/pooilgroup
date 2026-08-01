"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { actSyncTrcloudDocsPage } from "../actions";

// ดึงทีละหน้าเพื่อโชว์ "เปอร์เซ็นต์การโหลด" — โหลดถึงหน้าไหนแล้ว.
// MAX_PAGES ต่อชนิด: ต้องเท่ากับ DEFAULT_MAX_PAGES ใน lib/ledger/trcloud-docs.ts (เพดานหน้า/รอบ).
const MAX_PAGES = 5;
const KINDS = ["AP", "PO"] as const;
const THROTTLE_MS = 1800; // เว้นจังหวะระหว่างเรียก TRCloud กัน 429 (ตรงกับฝั่ง batch)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function SyncButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [pct, setPct] = useState(0);
  const [step, setStep] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    if (running) return;
    setRunning(true);
    setMsg(null);
    setPct(0);
    const totalSteps = MAX_PAGES * KINDS.length; // เพดานหน้ารวม (AP+PO) → ใช้หาร %
    let done = 0;
    let addedAp = 0;
    let addedPo = 0;
    let rateLimited = false;
    let capped = false;
    let firstCall = true;

    try {
      for (const kind of KINDS) {
        for (let p = 0; p < MAX_PAGES; p++) {
          if (!firstCall) await sleep(THROTTLE_MS);
          firstCall = false;
          setStep(`${kind === "AP" ? "ใบซื้อ/ค่าใช้จ่าย (AP)" : "ใบสั่งซื้อ (PO)"} · หน้า ${p + 1}`);
          const r = await actSyncTrcloudDocsPage(kind, p * 100);
          done += 1;
          setPct(Math.min(99, Math.round((done / totalSteps) * 100)));
          if (!r.ok) {
            setMsg({ ok: false, text: r.error ?? "ดึงข้อมูลไม่สำเร็จ" });
            return;
          }
          if (kind === "AP") addedAp += r.added;
          else addedPo += r.added;
          if (r.rateLimited) {
            rateLimited = true;
            break;
          }
          if (!r.hasMore) break; // ชนิดนี้ดึงครบแล้ว (ไม่มีของเก่ากว่านี้)
          if (p === MAX_PAGES - 1) capped = true; // ชนเพดานหน้า → ยังมีของเก่ากว่านี้
        }
        if (rateLimited) break;
      }
      setPct(100);
      let text = `อัปเดตแล้ว (AP +${addedAp} · PO +${addedPo})`;
      if (rateLimited) text += " · TRCloud จำกัดการเรียก หยุดกลางคัน ลองรีเฟรชอีกครั้งใน 1–2 นาที";
      else if (capped) text += " · ยังมีของเก่ากว่านี้ กดรีเฟรชซ้ำเพื่อดึงต่อ";
      setMsg({ ok: true, text });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "ดึงข้อมูลไม่สำเร็จ" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {running ? (
        // แถบเปอร์เซ็นต์ระหว่างโหลด — โชว์ว่าดึงถึงไหนแล้ว
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-[var(--color-brand-600)] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-zinc-500">
            {pct}% <span className="text-zinc-400">· {step}</span>
          </span>
        </div>
      ) : (
        msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
        {running ? "กำลังดึง…" : "รีเฟรชจาก TRCloud"}
      </button>
    </div>
  );
}
