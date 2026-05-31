"use client";

import { type FormEvent, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { importStarThingEquipment } from "@/app/(admin)/chairops/branches/actions";

type ImportSummary = {
  storesInFile: number;
  storesAtHome: number;
  chairsInFile: number;
  branchesMatched: number;
  branchesCreated: number;
  chairsInserted: number;
  chairsMoved: number;
  chairsAlreadyExisting: number;
  perStore: Array<{
    store: string;
    branchName: string;
    created: boolean;
    chairsInserted: number;
    chairsMoved: number;
    chairsAlreadyExisting: number;
  }>;
};

export function ImportEquipmentForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const urlId = useId();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error("วาง URL ก่อน");
      return;
    }
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("URL ต้องขึ้นต้น http:// หรือ https://");
      return;
    }
    setSummary(null);
    startTransition(async () => {
      const res = await importStarThingEquipment({ xlsxUrl: trimmed });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setSummary(res.data);
      const { chairsInserted, chairsMoved, branchesCreated } = res.data;
      toast.success(
        `นำเข้าเรียบร้อย · เพิ่ม ${chairsInserted} เก้าอี้ · ย้าย ${chairsMoved} ตัว · สร้าง ${branchesCreated} สาขาใหม่`,
      );
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardBody className="space-y-3 p-4">
          <label htmlFor={urlId} className="text-sm font-semibold text-zinc-800">
            URL ของไฟล์ XLSX
          </label>
          <textarea
            id={urlId}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            rows={4}
            placeholder="https://starthing-private-... .xlsx?q-sign-algorithm=..."
            className="w-full break-all rounded-md border border-zinc-200 bg-white p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
          <Button
            type="submit"
            size="xl"
            className="h-12 w-full text-base font-semibold"
            disabled={pending || !url.trim()}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังนำเข้า...
              </>
            ) : (
              "นำเข้า"
            )}
          </Button>
        </CardBody>
      </Card>

      {summary && (
        <Card>
          <CardBody className="space-y-3 p-4 text-sm">
            <div className="font-semibold text-zinc-800">สรุปผลนำเข้า</div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <Cell label="สาขาในไฟล์" value={summary.storesInFile} />
              <Cell label="เก้าอี้ในไฟล์" value={summary.chairsInFile} />
              <Cell label="อยู่บ้าน (ข้าม)" value={summary.storesAtHome} />
              <Cell label="สาขาที่ match" value={summary.branchesMatched} />
              <Cell
                label="สาขาสร้างใหม่"
                value={summary.branchesCreated}
                tone={summary.branchesCreated > 0 ? "amber" : undefined}
              />
              <Cell
                label="เก้าอี้เพิ่มใหม่"
                value={summary.chairsInserted}
                tone="emerald"
              />
              <Cell
                label="เก้าอี้ย้ายสาขา"
                value={summary.chairsMoved}
                tone={summary.chairsMoved > 0 ? "amber" : undefined}
              />
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                ดูรายสาขา ({summary.perStore.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {summary.perStore.map((s) => (
                  <li
                    key={s.store}
                    className="flex items-center justify-between gap-2 border-b border-zinc-100 py-1"
                  >
                    <span className="grow truncate">
                      {s.created ? "🆕 " : "✓ "}
                      {s.store}
                      {s.store !== s.branchName ? ` → ${s.branchName}` : ""}
                    </span>
                    <span className="shrink-0 font-mono text-zinc-500">
                      +{s.chairsInserted}
                      {s.chairsMoved > 0 ? ` · ↪${s.chairsMoved}` : ""} (มี{" "}
                      {s.chairsAlreadyExisting})
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </CardBody>
        </Card>
      )}
    </form>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const colorClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-zinc-800";
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={"text-lg font-bold tabular-nums " + colorClass}>
        {value}
      </div>
    </div>
  );
}
