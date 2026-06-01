"use client";

// Wave-2 (CEO 2026-06-01) · ONE dropzone for ALL 3 StarThing XLSX files.
// User drops 1+ files · server auto-detects type per file (daily / cash / coin)
// and routes to the right preview path. Per-file status renders inline.
//
// Daily files → ChairopsPosImport row created · link to /pos-ingest/i/[id]
// Cash/coin   → inline preview rendered + "Commit cash+coin" button
//
// Background: the server runs in parallel; the client stays open during
// processing but the actual ChairopsPosImport row + parsed cash/coin diff are
// persisted on the server side, so closing the tab mid-process doesn't lose
// daily-file work. Cash/coin must be committed in this same session (their
// preview lives in memory).

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Coins,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import {
  previewBatchSmart,
  commitMultiImport,
  runPosIngestMigration,
  type BatchPreviewItem,
} from "@/app/(admin)/chairops/pos-ingest/multi-actions";

const MAX_FILES = 10;

interface ClientFile {
  id: string;
  file: File;
}

type RunState =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "done"; items: BatchPreviewItem[] };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function newId(): string {
  return crypto.randomUUID();
}

export function MultiUploader() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cashFileRef = useRef<File | null>(null);
  const coinFileRef = useRef<File | null>(null);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [drag, setDrag] = useState(false);
  const [run, setRun] = useState<RunState>({ state: "idle" });
  const [committing, startCommit] = useTransition();

  function addFiles(picked: FileList | File[]) {
    const next: ClientFile[] = [];
    for (const f of Array.from(picked)) {
      if (!/\.xlsx$|\.csv$/i.test(f.name)) {
        toast.error(`ข้าม "${f.name}" — รับเฉพาะ .xlsx / .csv`);
        continue;
      }
      if (f.size === 0) {
        toast.error(`ข้าม "${f.name}" — ไฟล์ว่าง`);
        continue;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error(`ข้าม "${f.name}" — ใหญ่เกิน 10MB`);
        continue;
      }
      next.push({ id: newId(), file: f });
    }
    setFiles((prev) => {
      const merged = [...prev, ...next];
      if (merged.length > MAX_FILES) {
        toast.error(`เพิ่มได้สูงสุด ${MAX_FILES} ไฟล์ต่อรอบ`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  }

  async function onUpload() {
    if (files.length === 0) {
      toast.error("ยังไม่ได้เลือกไฟล์");
      return;
    }
    setRun({ state: "uploading" });
    cashFileRef.current = null;
    coinFileRef.current = null;
    // CEO 2026-06-01: send one file per server-action call · in parallel.
    // Next.js 16 ignores experimental.serverActions.bodySizeLimit at the
    // platform layer on Vercel, so a 1.3 MB multi-file POST still throws
    // "Body exceeded 1 MB limit" even after the config is set. Splitting
    // keeps each request well under the 1 MB hard cap (each StarThing
    // XLSX is ~100-700 KB) and the server still aggregates results.
    try {
      const settled = await Promise.all(
        files.map(async (f) => {
          const fd = new FormData();
          fd.set("file0", f.file, f.file.name);
          try {
            const r = await previewBatchSmart(fd);
            return r.items[0] ?? {
              ok: false as const,
              fileName: f.file.name,
              kind: "unknown" as const,
              error: "ไม่ได้รับผลจาก server",
            };
          } catch (err) {
            return {
              ok: false as const,
              fileName: f.file.name,
              kind: "unknown" as const,
              error: err instanceof Error ? err.message : "อัปโหลดล้มเหลว",
            };
          }
        }),
      );
      // Keep raw File refs for cash/coin commit (server doesn't persist them).
      for (const it of settled) {
        if (it.ok && (it.kind === "cash" || it.kind === "coin")) {
          const match = files.find((f) => f.file.name === it.fileName);
          if (match) {
            if (it.kind === "cash") cashFileRef.current = match.file;
            else coinFileRef.current = match.file;
          }
        }
      }
      setRun({ state: "done", items: settled });
      const okCount = settled.filter((i) => i.ok).length;
      const errCount = settled.length - okCount;
      if (errCount > 0) {
        toast.warning(`ตรวจ ${okCount}/${settled.length} ไฟล์ผ่าน · ${errCount} ผิดพลาด`);
      } else {
        toast.success(`ตรวจ ${okCount} ไฟล์เรียบร้อย · พร้อม commit`);
      }
    } catch (e) {
      setRun({ state: "idle" });
      toast.error(e instanceof Error ? e.message : "อัปโหลดล้มเหลว");
    }
  }

  function onCommitCashCoin() {
    if (!cashFileRef.current && !coinFileRef.current) {
      toast.error("ไม่มีไฟล์ cash/coin ให้ commit");
      return;
    }
    startCommit(async () => {
      // Commit cash + coin in TWO separate calls (one file each) to stay
      // under the Vercel/Next 1 MB server-action body cap. The action accepts
      // either / both fields, so a single-file invocation is supported.
      let cashIns = 0;
      let coinIns = 0;
      let coverage: string | null = null;
      const errs: string[] = [];

      if (cashFileRef.current) {
        const fd = new FormData();
        fd.set("cashFile", cashFileRef.current);
        const r = await commitMultiImport(fd);
        if (r.ok) {
          cashIns = r.cashInserted;
          if (r.coverageThrough) coverage = r.coverageThrough;
        } else {
          errs.push(`cash: ${r.error ?? "ล้มเหลว"}`);
        }
      }
      if (coinFileRef.current) {
        const fd = new FormData();
        fd.set("coinFile", coinFileRef.current);
        const r = await commitMultiImport(fd);
        if (r.ok) {
          coinIns = r.coinInserted;
          if (
            r.coverageThrough &&
            (!coverage || r.coverageThrough > coverage)
          ) {
            coverage = r.coverageThrough;
          }
        } else {
          errs.push(`coin: ${r.error ?? "ล้มเหลว"}`);
        }
      }

      if (errs.length > 0) {
        toast.error(errs.join(" · "));
        return;
      }
      toast.success(
        `บันทึก cash +${cashIns} · coin +${coinIns}` +
          (coverage ? ` · ถึง ${coverage}` : ""),
      );
      setFiles([]);
      setRun({ state: "idle" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          drag
            ? "border-emerald-400 bg-emerald-50"
            : "border-zinc-300 bg-zinc-50/60"
        }`}
      >
        <Upload className="h-7 w-7 text-zinc-500" aria-hidden />
        <div className="text-sm font-medium text-zinc-800">
          ลากไฟล์ StarThing มาวาง · หรือกดเลือก
        </div>
        <div className="text-xs text-zinc-500">
          รับ .xlsx / .csv · สูงสุด {MAX_FILES} ไฟล์ · 10MB/ไฟล์ · ระบบจะเดาชนิด (daily / cash / coin) ให้
        </div>
        {/* CEO 2026-06-01 explicit ask · re-upload overlap behaviour. */}
        <div className="text-[11px] text-zinc-500">
          อัปซ้ำได้ปลอดภัย — แถวเดิมจะถูก skip (เห็น dup ในผลตรวจ) · เฉพาะแถวใหม่จะถูกเขียน
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".xlsx,.csv"
          className="hidden"
          onChange={onPick}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1 inline-flex h-9 items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
        >
          เลือกไฟล์
        </button>
      </div>

      {files.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <ul className="divide-y divide-zinc-100">
            {files.map((f) => {
              const itemResult =
                run.state === "done"
                  ? run.items.find((i) => i.fileName === f.file.name)
                  : null;
              return (
                <li
                  key={f.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
                  <div className="flex-1 truncate">
                    <div className="truncate font-medium text-zinc-900">
                      {f.file.name}
                    </div>
                    <div className="text-xs text-zinc-500">{fmtBytes(f.file.size)}</div>
                  </div>
                  <ItemStatus result={itemResult} />
                  {run.state !== "uploading" && (
                    <button
                      type="button"
                      onClick={() => removeFile(f.id)}
                      className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100"
                      aria-label={`ลบ ${f.file.name}`}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {run.state === "idle" && files.length > 0 && (
        <button
          type="button"
          onClick={onUpload}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          <Upload className="h-4 w-4" aria-hidden />
          อัปโหลด {files.length} ไฟล์
        </button>
      )}

      {run.state === "uploading" && (
        <div className="inline-flex items-center gap-2 text-sm text-zinc-700">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          กำลังตรวจ + เตรียม diff · กรุณารอ · เปิด tab อื่นได้
        </div>
      )}

      {run.state === "done" && <BatchResults items={run.items} onCommitCashCoin={onCommitCashCoin} committing={committing} />}
    </div>
  );
}

function ItemStatus({ result }: { result: BatchPreviewItem | null | undefined }) {
  if (!result) {
    return <span className="text-xs text-zinc-500">รอตรวจ</span>;
  }
  if (!result.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {result.error}
      </span>
    );
  }
  if (result.kind === "daily") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> daily · พร้อม commit
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      {result.kind === "cash" ? (
        <>
          <Banknote className="h-3.5 w-3.5" aria-hidden /> cash
        </>
      ) : (
        <>
          <Coins className="h-3.5 w-3.5" aria-hidden /> coin
        </>
      )}{" "}
      · new {result.preview.newCount} / dup {result.preview.dupCount}
    </span>
  );
}

function BatchResults({
  items,
  onCommitCashCoin,
  committing,
}: {
  items: BatchPreviewItem[];
  onCommitCashCoin: () => void;
  committing: boolean;
}) {
  const dailies = items.filter(
    (i): i is Extract<BatchPreviewItem, { ok: true; kind: "daily" }> =>
      i.ok && i.kind === "daily",
  );
  const cashItem = items.find(
    (i): i is Extract<BatchPreviewItem, { ok: true; kind: "cash" }> =>
      i.ok && i.kind === "cash",
  );
  const coinItem = items.find(
    (i): i is Extract<BatchPreviewItem, { ok: true; kind: "coin" }> =>
      i.ok && i.kind === "coin",
  );
  const hasCashOrCoin = Boolean(cashItem || coinItem);

  return (
    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="text-sm font-semibold text-emerald-900">ผลการตรวจ</div>

      {dailies.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-zinc-600">
            ไฟล์ daily ({dailies.length}) — กด &quot;ตรวจ + commit&quot; ทีละไฟล์
          </div>
          <ul className="space-y-1">
            {dailies.map((d) => (
              <li key={d.importId} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm">
                <span className="truncate text-zinc-800">{d.fileName}</span>
                <Link
                  href={`/chairops/pos-ingest/i/${d.importId}`}
                  className="inline-flex h-8 items-center rounded-md bg-zinc-900 px-3 text-xs font-medium text-white hover:bg-zinc-800"
                >
                  ดู preview →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasCashOrCoin && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-zinc-600">
            cash / coin event — commit รวมในปุ่มเดียว
          </div>
          <div className="space-y-1">
            {cashItem && <EventPreviewRow kind="cash" item={cashItem} />}
            {coinItem && <EventPreviewRow kind="coin" item={coinItem} />}
          </div>
          <button
            type="button"
            onClick={onCommitCashCoin}
            disabled={committing}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {committing ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            )}
            Commit cash + coin
          </button>
        </div>
      )}
    </div>
  );
}

function EventPreviewRow({
  kind,
  item,
}: {
  kind: "cash" | "coin";
  item: Extract<BatchPreviewItem, { ok: true; kind: "cash" | "coin" }>;
}) {
  const Icon = kind === "cash" ? Banknote : Coins;
  const bigIntWarn = item.preview.bigIntMigrationRequired;
  const { newCount, dupCount, intraDupCount, dateRange } = item.preview;
  // Goal #2 (CEO 2026-06-01) · spell out dedup at preview time so the
  // operator sees overlap protection working BEFORE committing. Triggered
  // when ANY of the inbound rows matched an existing row-hash in the DB
  // (i.e. the day-3 overlap scenario applies).
  const hasOverlap = dupCount > 0 || intraDupCount > 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-zinc-500" aria-hidden />
          <span className="truncate text-zinc-800">{item.fileName}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-emerald-700">new {newCount}</span>
          <span className="text-zinc-500">dup {dupCount}</span>
          {dateRange && (
            <span className="text-zinc-600">ถึง {dateRange.to}</span>
          )}
        </div>
      </div>
      {hasOverlap && (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <div className="font-semibold">
            ✓ ตรวจเจอข้อมูลซ้ำ {dupCount.toLocaleString("en-US")} แถว
            {intraDupCount > 0 ? ` (+ ${intraDupCount} แถวซ้ำในไฟล์)` : ""}
          </div>
          <div className="mt-0.5 leading-snug">
            ระบบจะ skip ที่ซ้ำอัตโนมัติ · ใส่เฉพาะ{" "}
            <span className="font-semibold">{newCount.toLocaleString("en-US")} แถวใหม่</span>{" "}
            ที่ commit · เนื้อหาเดิมไม่เปลี่ยน · key dedup =
            sha256(เครื่อง+เวลา+ยอด+มิเตอร์)
          </div>
        </div>
      )}
      {bigIntWarn && <BigIntMigrationBanner warn={bigIntWarn} />}
    </div>
  );
}

function BigIntMigrationBanner({
  warn,
}: {
  warn: NonNullable<
    Extract<BatchPreviewItem, { ok: true; kind: "cash" | "coin" }>["preview"]["bigIntMigrationRequired"]
  >;
}) {
  const router = useRouter();
  const [running, startRun] = useTransition();
  const [done, setDone] = useState(false);

  function onRun() {
    startRun(async () => {
      const r = await runPosIngestMigration("20260601_coin_event_bigint");
      if (!r.ok) {
        toast.error(`รัน migration ไม่สำเร็จ · ${r.error ?? "unknown"}`);
        return;
      }
      toast.success(
        `Migration BIGINT รันสำเร็จ${
          r.description ? ` · ${r.description}` : ""
        } · กดอัปโหลดใหม่ได้เลย`,
      );
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
      <div className="font-semibold">
        ต้องรัน migration BIGINT ก่อน commit (ตรวจที่ preview)
      </div>
      <div className="mt-0.5">
        พบ {warn.overflowRowCount.toLocaleString("en-US")} แถวที่ค่าเกิน int4 max ·
        ตัวอย่าง {warn.sampleValue.toLocaleString("en-US")}
      </div>

      {!done && (
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="mt-2 inline-flex h-9 items-center gap-2 rounded-md bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
          )}
          รัน migration BIGINT เลย (1 คลิก)
        </button>
      )}
      {done && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> รันแล้ว · กดอัปโหลด 3 ไฟล์อีกครั้ง
        </div>
      )}

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] underline">
          หรือทำมือเอง — paste SQL นี้ที่ Supabase SQL Editor
        </summary>
        <div className="mt-1 font-mono text-[10px] leading-tight text-rose-800">
          ALTER TABLE chairops.chairops_pos_coin_event<br />
          &nbsp;&nbsp;ALTER COLUMN &quot;coinAdded&quot; TYPE BIGINT USING
          &quot;coinAdded&quot;::bigint,<br />
          &nbsp;&nbsp;ALTER COLUMN &quot;coinMeter&quot; TYPE BIGINT USING
          &quot;coinMeter&quot;::bigint;
        </div>
      </details>
    </div>
  );
}
