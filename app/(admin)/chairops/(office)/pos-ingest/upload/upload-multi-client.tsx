"use client";

// Plan B · multi-file timestamped-event uploader (cash + coin).
// Two-step in-memory flow: pick files → preview (dedup buckets) → commit.
// Files stay in browser state between steps (no temp storage · commit re-parses).

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  previewMultiImport,
  commitMultiImport,
  type MultiPreviewResult,
} from "@/app/(admin)/chairops/pos-ingest/multi-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  Coins,
  Banknote,
  CalendarRange,
} from "lucide-react";

type EventSummary = NonNullable<MultiPreviewResult["cash"]>;

const SLOTS = [
  { field: "cashFile", label: "ไฟล์เงินสด (timestamped)", icon: Banknote, hint: "คอลัมน์ การเพิ่มเงินสด · เงินสดทั้งหมด" },
  { field: "coinFile", label: "ไฟล์เหรียญ (timestamped)", icon: Coins, hint: "คอลัมน์ การเพิ่มเหรียญ · จำนวนเหรียญทั้งหมด" },
] as const;

export function UploadMultiClient() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<MultiPreviewResult | null>(null);
  const [isPreviewing, startPreview] = useTransition();
  const [isCommitting, startCommit] = useTransition();
  const [names, setNames] = useState<Record<string, string>>({});

  function onPreview() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    if (!(fd.get("cashFile") instanceof File && (fd.get("cashFile") as File).size) &&
        !(fd.get("coinFile") instanceof File && (fd.get("coinFile") as File).size)) {
      toast.error("เลือกอย่างน้อย 1 ไฟล์ (เงินสด หรือ เหรียญ)");
      return;
    }
    startPreview(async () => {
      const res = await previewMultiImport(fd);
      setPreview(res);
      res.errors.forEach((e) => toast.error(e));
      res.warnings.forEach((w) => toast.warning(w));
      if (!res.cash && !res.coin && res.errors.length === 0) {
        toast.error("อ่านไฟล์ไม่พบข้อมูล");
      }
    });
  }

  function onCommit() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startCommit(async () => {
      const res = await commitMultiImport(fd);
      if (!res.ok) {
        toast.error(res.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success(
        `บันทึกแล้ว · เงินสด ${res.cashInserted} รายการใหม่ (ข้ามซ้ำ ${res.cashSkipped}) · เหรียญ ${res.coinInserted} ใหม่ (ข้ามซ้ำ ${res.coinSkipped})`,
      );
      setPreview(null);
      form.reset();
      setNames({});
      router.push("/chairops/pos-ingest?ingested=events");
    });
  }

  const busy = isPreviewing || isCommitting;
  const totalNew = (preview?.cash?.newCount ?? 0) + (preview?.coin?.newCount ?? 0);

  return (
    <div className="space-y-5">
      <form ref={formRef} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {SLOTS.map(({ field, label, icon: Icon, hint }) => (
            <div key={field} className="rounded-lg border border-border bg-background p-4">
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Icon className="size-4" /> {label}
              </label>
              <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
              <Input
                type="file"
                name={field}
                accept=".csv,.xlsx,.xls,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => {
                  setNames((n) => ({ ...n, [field]: e.target.files?.[0]?.name ?? "" }));
                  setPreview(null);
                }}
                className="mt-2 h-11 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm"
              />
              {names[field] && (
                <p className="mt-1 truncate text-xs text-muted-foreground">{names[field]}</p>
              )}
            </div>
          ))}
        </div>

        <Input type="text" name="notes" placeholder="หมายเหตุ (ไม่จำเป็น)" disabled={busy} maxLength={200} />

        <div className="flex items-center gap-3">
          <Button type="button" onClick={onPreview} disabled={busy} size="lg" variant={preview ? "outline" : "primary"}>
            {isPreviewing ? "กำลังตรวจ..." : "ตรวจข้อมูล (เช็คซ้ำก่อนบันทึก)"}
          </Button>
          {preview && (totalNew > 0) && (
            <Button type="button" onClick={onCommit} disabled={busy} size="lg">
              {isCommitting ? "กำลังบันทึก..." : `ยืนยันบันทึก ${totalNew} รายการใหม่`}
            </Button>
          )}
        </div>
      </form>

      {preview && (
        <div className="space-y-4">
          {preview.cash && <EventPreviewCard s={preview.cash} kindLabel="เงินสด" />}
          {preview.coin && <EventPreviewCard s={preview.coin} kindLabel="เหรียญ" />}
          {preview && totalNew === 0 && (preview.cash || preview.coin) && (
            <Card className="border-amber-200 bg-amber-50">
              <CardBody className="p-4 text-sm text-amber-800">
                ทุกรายการในไฟล์นี้ถูกบันทึกไปแล้ว (ซ้ำทั้งหมด) · ไม่มีอะไรต้องบันทึกเพิ่ม
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function EventPreviewCard({ s, kindLabel }: { s: EventSummary; kindLabel: string }) {
  return (
    <Card>
      <CardBody className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground">
            {kindLabel} · {s.fileName}
          </h3>
          {s.continuityOk ? (
            <Badge tone="success" className="gap-1">
              <CheckCircle2 className="size-3" /> วันเวลาต่อเนื่อง
            </Badge>
          ) : (
            <Badge tone="warning" className="gap-1">
              <AlertTriangle className="size-3" /> มีช่วงเวลาขาด
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="ใหม่ (จะบันทึก)" value={s.newCount} tone="ok" />
          <Stat label="ซ้ำของเดิม (ข้าม)" value={s.dupCount} tone="muted" />
          <Stat label="ซ้ำในไฟล์ (ข้าม)" value={s.intraDupCount} tone="muted" />
          <Stat label="สาขาไม่รู้จัก" value={s.unmatchedBranchCount} tone={s.unmatchedBranchCount ? "warn" : "muted"} />
        </div>

        {s.dateRange && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" /> ช่วงเวลา {s.dateRange.from} → {s.dateRange.to}
            {s.badRowCount > 0 && <span className="text-rose-600"> · แถวเสีย {s.badRowCount}</span>}
          </p>
        )}

        {s.unmatchedBranches.length > 0 && (
          <p className="text-xs text-amber-700">
            สาขาที่ไม่ตรงกับระบบ: {s.unmatchedBranches.join(", ")} (รายการเหล่านี้จะบันทึกแบบยังไม่ผูกสาขา)
          </p>
        )}

        {/* per-branch breakdown */}
        <div className="overflow-x-auto rounded-md border border-border [scrollbar-width:thin]">
          <table className="min-w-[640px] w-full text-xs">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th className="px-2.5 py-1.5">สาขา</th>
                <th className="px-2.5 py-1.5 text-right">ใหม่</th>
                <th className="px-2.5 py-1.5 text-right">ซ้ำ</th>
                <th className="px-2.5 py-1.5">รายการแรกในไฟล์</th>
                <th className="px-2.5 py-1.5">ล่าสุดในไฟล์</th>
                <th className="px-2.5 py-1.5">ต่อเนื่อง</th>
              </tr>
            </thead>
            <tbody>
              {s.perBranch.map((b) => (
                <tr key={b.storeName} className="border-t border-border">
                  <td className="px-2.5 py-1.5">{b.branchName ?? `${b.storeName} (ไม่รู้จัก)`}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums font-medium text-emerald-700">{b.newCount}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">{b.dupCount}</td>
                  <td className="px-2.5 py-1.5 text-muted-foreground">{fmtDt(b.firstEventAt)}</td>
                  <td className="px-2.5 py-1.5 text-muted-foreground">{fmtDt(b.lastEventAt)}</td>
                  <td className="px-2.5 py-1.5">
                    {b.gapWarning ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <CircleDot className="size-3" /> ขาด
                      </span>
                    ) : (
                      <span className="text-emerald-700">ปกติ</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "muted" }) {
  const cls =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-zinc-600";
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className={`text-lg font-bold tabular-nums ${cls}`}>{value.toLocaleString("en-US")}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function fmtDt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("th-TH", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
