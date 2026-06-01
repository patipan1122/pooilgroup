"use client";

// CEO 2026-06-01: surface storeNames that appeared in the StarThing upload
// but don't exist in ChairopsBranch yet, grouped with row counts + sample
// chair codes. Each row gets a "เพิ่มสาขานี้" button that creates the
// branch on the spot — after which the page revalidates and the affected
// rows flip from "bad" to "new" automatically.
//
// Per `[[pool-csv-import-must-diff-before-write]]` we still NEVER auto-
// create branches as a silent side-effect of upload. This is an explicit,
// audited, CEO-confirmed action — the user clicks each one.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, PlusCircle, AlertTriangle } from "lucide-react";
import { addBranchFromStarThing } from "@/app/(admin)/chairops/pos-ingest/multi-actions";

export interface UnknownBranchGroup {
  storeName: string;
  rowCount: number;
  chairCodeSamples: string[];
}

export function UnknownBranchesCard({
  groups,
}: {
  groups: UnknownBranchGroup[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());

  if (groups.length === 0) return null;

  const totalRows = groups.reduce((acc, g) => acc + g.rowCount, 0);
  const remainingGroups = groups.filter((g) => !done.has(g.storeName));

  function onAdd(storeName: string) {
    startTransition(async () => {
      const r = await addBranchFromStarThing(storeName);
      if (!r.ok) {
        toast.error(`เพิ่มสาขา "${storeName}" ไม่สำเร็จ · ${r.error ?? "unknown"}`);
        return;
      }
      toast.success(
        `เพิ่มสาขา "${r.branch?.name ?? storeName}" แล้ว · slug = ${r.branch?.slug ?? "-"}`,
      );
      setDone((prev) => {
        const next = new Set(prev);
        next.add(storeName);
        return next;
      });
      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <div className="mb-2 flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
        <div className="text-sm">
          <div className="font-semibold text-amber-900">
            สาขาที่ระบบไม่รู้จัก {remainingGroups.length}{" "}
            {remainingGroups.length !== groups.length && `(จากทั้งหมด ${groups.length}) `}
            · มี {totalRows.toLocaleString("en-US")} แถวที่ commit ไม่ได้
          </div>
          <div className="mt-0.5 text-xs text-amber-800">
            แต่ละชื่อ store ในไฟล์ POS หาในตาราง ChairopsBranch ของ org เราไม่เจอ ·
            กด &quot;เพิ่มสาขานี้&quot; เพื่อสร้าง · หรือถ้าเป็นสาขาที่ปิดไปแล้ว ปล่อยข้ามได้
            (แถวจะถูก skip ตอน commit)
          </div>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {groups.map((g) => {
          const isDone = done.has(g.storeName);
          return (
            <li
              key={g.storeName}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                isDone
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-amber-200 bg-white"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-zinc-900">{g.storeName}</div>
                <div className="text-[11px] text-zinc-600">
                  {g.rowCount.toLocaleString("en-US")} แถว
                  {g.chairCodeSamples.length > 0 && (
                    <>
                      {" · เก้าอี้ตัวอย่าง: "}
                      <span className="font-mono">
                        {g.chairCodeSamples.slice(0, 3).join(", ")}
                        {g.chairCodeSamples.length > 3 && ` +${g.chairCodeSamples.length - 3}`}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {isDone ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> เพิ่มแล้ว · รีโหลดหน้า
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onAdd(g.storeName)}
                  disabled={pending}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-700 px-2.5 text-xs font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PlusCircle className="h-3.5 w-3.5" aria-hidden />
                  )}
                  เพิ่มสาขานี้
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-2 text-[11px] text-amber-800">
        หลังเพิ่มสาขาแล้ว · กดรีโหลดหน้า preview · แถว &quot;ผิด&quot; ที่ map ได้
        จะกลายเป็น &quot;ใหม่&quot; · แล้วกด commit ปกติ
      </div>
    </div>
  );
}
