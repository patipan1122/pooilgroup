"use client";

// Batch-deposit client form — 2-phase:
// Phase "select": tick which pending rounds to batch (checkboxes only).
// Phase "deposit": deposit form + slip upload + submit.
// File inputs use <label htmlFor> (not ref.click()) for iOS LINE browser.

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Camera,
  CheckCircle2,
  ChevronLeft,
  Images,
  Landmark,
  Loader2,
  Sparkles,
  WifiOff,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { compressImage } from "@/lib/chairops/utils/image-compress";
import { isOnline } from "@/lib/chairops/utils/maid-outbox";

import {
  batchDeposit,
  uploadSlipServer,
  extractSlipAmount,
} from "@/app/(admin)/chairops/collect/actions";
import {
  DEPOSIT_NOTES_GATE_BAHT,
  DEPOSIT_REVIEW_GATE_BAHT,
  DEPOSIT_NOTES_MIN_LEN,
} from "@/app/(admin)/chairops/(office)/maids/types";

interface PendingCollection {
  id: string;
  countedAmount: number;
  collectedAt: string;
  notes: string | null;
}

interface Props {
  pendingCollections: ReadonlyArray<PendingCollection>;
  /** OFFICE+ deposit: the branch these office-collected rounds belong to.
   *  Omitted → maid flow (branch resolved server-side from primaryBranchId). */
  branchOverride?: string;
  /** Where to go after a successful deposit (default: maid home). */
  redirectTo?: string;
}

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface SlipState {
  publicUrl: string;
  hash: string;
  previewUrl: string;
  sizeKb: number;
}

export function BatchDepositForm({
  pendingCollections,
  branchOverride,
  redirectTo,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [online, setOnline] = useState(true);
  const [phase, setPhase] = useState<"select" | "deposit">("select");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(pendingCollections.map((p) => p.id)),
  );
  const [deposited, setDeposited] = useState("");
  const [bankFee, setBankFee] = useState("");
  const [notes, setNotes] = useState("");
  const [slip, setSlip] = useState<SlipState | null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  // refs used only for resetting input value (allow re-picking same file)
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const draftIdRef = useRef<string>(newUuid());

  const depositedId = useId();
  const bankFeeId = useId();
  const notesId = useId();
  // IDs for label→input binding (iOS-reliable alternative to ref.click())
  const cameraInputId = useId();
  const galleryInputId = useId();

  useEffect(() => {
    setOnline(isOnline());
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const selectedSum = useMemo(() => {
    return pendingCollections
      .filter((p) => selectedIds.has(p.id))
      .reduce((s, p) => s + p.countedAmount, 0);
  }, [pendingCollections, selectedIds]);

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const depositedNum = Number(deposited.replace(/,/g, "")) || 0;
  const bankFeeNum = Number(bankFee.replace(/,/g, "")) || 0;

  async function onPickSlip(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // iOS LINE browser may return "" for HEIC photos — treat as image
    const resolvedType = file.type || "image/jpeg";
    if (!/^image\//.test(resolvedType)) {
      toast.error("ต้องเป็นไฟล์รูปภาพ");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · ถ่ายใหม่");
      return;
    }
    if (!isOnline()) {
      toast.error("ออฟไลน์ · เชื่อมต่อก่อนแล้วลองอีกครั้ง");
      return;
    }

    setUploading(true);
    // Capture preview URL before we lose the file reference
    const localPreview = URL.createObjectURL(file);
    try {
      const compressed = await compressImage(file);
      const blob = compressed.blob;

      // Upload server-side — bypasses R2 CORS (same fix as DocuFlow proxy)
      const fd = new FormData();
      fd.append("file", blob, "slip.jpg");
      fd.append("depositDraftId", draftIdRef.current);
      if (branchOverride) fd.append("branchOverride", branchOverride);

      const result = await uploadSlipServer(fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { publicUrl, hash, sizeKb } = result.data;
      setSlip({ publicUrl, hash, previewUrl: localPreview, sizeKb });
      toast.success(`แนบสลิปแล้ว (${sizeKb} KB)`);

      // OCR: อ่านยอดจากสลิปอัตโนมัติ (best-effort)
      setOcrRunning(true);
      extractSlipAmount(publicUrl)
        .then((r) => {
          if (r.ok && r.data.amount !== null && depositedNum === 0) {
            setDeposited(String(r.data.amount));
            toast.success(
              `OCR อ่านยอดได้ ${r.data.amount.toLocaleString()} ฿ · ตรวจสอบก่อนกดบันทึก`,
            );
          }
        })
        .catch(() => undefined)
        .finally(() => setOcrRunning(false));
    } catch {
      URL.revokeObjectURL(localPreview);
      toast.error("เกิดข้อผิดพลาด · ลองอีกครั้ง");
    } finally {
      setUploading(false);
      // reset so same file can be re-picked
      if (cameraRef.current) cameraRef.current.value = "";
      if (galleryRef.current) galleryRef.current.value = "";
    }
  }

  function validateBeforeSubmit(): string | null {
    if (selectedIds.size === 0) return "เลือกอย่างน้อย 1 รอบ";
    if (depositedNum <= 0) return "กรอกยอดที่ฝากจริง (มากกว่า 0)";
    if (bankFeeNum < 0) return "ค่าธรรมเนียมต้องไม่ติดลบ";
    if (!slip) return "แนบสลิปธนาคารก่อนบันทึก";
    // BF1 MAID-04 · anti-fraud gate. Notes mandatory when |diff| ≥ 100฿.
    const effectiveDiff = depositedNum + bankFeeNum - selectedSum;
    if (
      Math.abs(effectiveDiff) >= DEPOSIT_NOTES_GATE_BAHT &&
      notes.trim().length < DEPOSIT_NOTES_MIN_LEN
    ) {
      return `ผลต่าง ≥ ${DEPOSIT_NOTES_GATE_BAHT} ฿ ต้องระบุเหตุผลในหมายเหตุ (อย่างน้อย ${DEPOSIT_NOTES_MIN_LEN} ตัวอักษร)`;
    }
    return null;
  }

  function submitNow() {
    if (!slip) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      const res = await batchDeposit(
        {
          collectionIds: ids,
          depositedAmount: depositedNum,
          bankFee: bankFeeNum,
          slipPhotoUrl: slip.publicUrl,
          slipImageHash: slip.hash,
          notes: notes.trim() || null,
        },
        branchOverride ? { branchOverride } : undefined,
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("ฝากเงินก้อนบันทึกแล้ว ✓");
      router.push(redirectTo ?? "/chairops/m");
      router.refresh();
    });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validateBeforeSubmit();
    if (err) {
      toast.error(err);
      return;
    }
    if (!isOnline()) {
      toast.error("ออฟไลน์ · เชื่อมต่อก่อนแล้วลองอีกครั้ง");
      return;
    }
    submitNow();
  }

  // Hidden file inputs — always rendered, IDs stable across phases.
  // Labels reference these IDs (htmlFor) — works reliably on iOS LINE browser.
  const fileInputs = (
    <>
      <input
        ref={cameraRef}
        id={cameraInputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPickSlip}
      />
      <input
        ref={galleryRef}
        id={galleryInputId}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickSlip}
      />
    </>
  );

  // Tailwind classes that mimic the outline Button variant
  const labelBtn =
    "inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 font-medium text-zinc-700 transition-colors hover:bg-zinc-50 active:bg-zinc-100";

  // ─── PHASE 1: select rounds ──────────────────────────────────────────────
  if (phase === "select") {
    return (
      <div className="space-y-4">
        {fileInputs}

        {!online && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800">
            <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
            ออฟไลน์ · เชื่อมต่อก่อนกดบันทึก
          </div>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-700">
            รอบที่ยังไม่ได้ฝาก ({pendingCollections.length})
          </h2>
          <ul className="space-y-2">
            {pendingCollections.map((p) => {
              const checked = selectedIds.has(p.id);
              return (
                <li key={p.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors active:bg-zinc-100",
                      checked
                        ? "border-emerald-300 bg-emerald-50/60"
                        : "border-zinc-200 bg-white",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      className="size-5 accent-emerald-600"
                    />
                    <div className="min-w-0 grow">
                      <div className="text-base font-semibold tabular-nums text-zinc-900">
                        {p.countedAmount.toLocaleString()} ฿
                      </div>
                      <div className="text-xs text-zinc-500">
                        นับเมื่อ {fmtDate(p.collectedAt)}
                        {p.notes ? ` · ${p.notes.slice(0, 50)}` : ""}
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <button
          type="button"
          onClick={() => setPhase("deposit")}
          disabled={selectedIds.size === 0}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white transition-colors active:bg-emerald-700 disabled:bg-zinc-200 disabled:text-zinc-400"
        >
          <Landmark className="h-5 w-5" />
          ฝากเงิน · {selectedIds.size} รอบ · {selectedSum.toLocaleString()} ฿
        </button>
      </div>
    );
  }

  // ─── PHASE 2: deposit form ────────────────────────────────────────────────
  const selectedList = pendingCollections.filter((p) => selectedIds.has(p.id));

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {fileInputs}

      {!online && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800">
          <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
          ออฟไลน์ · เชื่อมต่อก่อนกดบันทึก
        </div>
      )}

      <button
        type="button"
        onClick={() => setPhase("select")}
        className="flex items-center gap-1 text-sm font-medium text-zinc-500 hover:text-zinc-700"
      >
        <ChevronLeft className="h-4 w-4" />
        เปลี่ยนรอบที่เลือก
      </button>

      {/* Summary of selected rounds (read-only) */}
      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardBody className="p-4">
          <div className="mb-2 text-xs font-semibold text-emerald-700">
            รอบที่จะฝากพร้อมกัน ({selectedList.length} รอบ)
          </div>
          <ul className="space-y-1.5">
            {selectedList.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-xs text-zinc-600">
                  นับเมื่อ {fmtDate(p.collectedAt)}
                </span>
                <span className="font-semibold tabular-nums text-zinc-900">
                  {p.countedAmount.toLocaleString()} ฿
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-emerald-200 pt-2">
            <span className="text-xs font-semibold text-emerald-800">รวม</span>
            <span className="text-lg font-bold tabular-nums text-emerald-900">
              {selectedSum.toLocaleString()} ฿
            </span>
          </div>
        </CardBody>
      </Card>

      {/* Amount + fee inputs */}
      <Card>
        <CardBody className="space-y-4 p-4">
          <div className="space-y-2">
            <label
              htmlFor={depositedId}
              className="text-sm font-semibold text-zinc-800"
            >
              ยอดที่ฝากธนาคารจริง (บาท)
            </label>
            <Input
              id={depositedId}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={deposited}
              onChange={(e) =>
                setDeposited(e.target.value.replace(/[^0-9]/g, ""))
              }
              className="h-14 text-right text-2xl font-semibold tabular-nums"
            />
            <p className="text-xs text-zinc-500">
              ยอดในสลิป · ถ้านับรวม {selectedSum.toLocaleString()} ก็ฝากเท่านั้น
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor={bankFeeId}
              className="text-sm font-semibold text-zinc-800"
            >
              ค่าธรรมเนียม (ถ้ามี)
            </label>
            <Input
              id={bankFeeId}
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={bankFee}
              onChange={(e) =>
                setBankFee(e.target.value.replace(/[^0-9]/g, ""))
              }
              className="h-12 text-right text-lg font-semibold tabular-nums"
            />
            <p className="text-xs text-zinc-500">
              บางสาขาฝากต่างจังหวัดมีค่าธรรมเนียม · ใส่ตามจริง
            </p>
          </div>

          {depositedNum > 0 &&
            (() => {
              const eff = depositedNum + bankFeeNum - selectedSum;
              const absEff = Math.abs(eff);
              const overReview = absEff >= DEPOSIT_REVIEW_GATE_BAHT;
              const overNotes = absEff >= DEPOSIT_NOTES_GATE_BAHT;
              const isShort = eff < 0;
              // CEO 2026-08-29: only reveal the exact number (and that it's a
              // surplus) when short — showing a maid "you're over by X" hands
              // her a safe amount to skim next time. Notes-required / auto-
              // review gates below still fire both ways; server enforces them
              // regardless of what this box shows (see actions.ts BF1 MAID-04).
              if (!isShort && !overNotes) return null;
              return (
                <div
                  className={cn(
                    "rounded-md border p-3 text-sm space-y-1",
                    overReview
                      ? "border-rose-300 bg-rose-50 text-rose-800"
                      : overNotes
                        ? "border-amber-300 bg-amber-50 text-amber-800"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700",
                  )}
                  aria-live="polite"
                >
                  {isShort && (
                    <div>
                      ผลต่าง (ฝาก + ค่าธรรมเนียม − นับรวม):{" "}
                      <span className="font-semibold tabular-nums">
                        {eff.toLocaleString()} ฿
                      </span>
                    </div>
                  )}
                  {overReview && (
                    <div className="font-medium">
                      ⚠ ผลต่าง ≥ {DEPOSIT_REVIEW_GATE_BAHT.toLocaleString()} ฿
                      · ออฟฟิศจะตรวจรายการนี้ก่อนยืนยัน
                    </div>
                  )}
                  {!overReview && overNotes && (
                    <div className="font-medium">
                      ⚠ ผลต่าง ≥ {DEPOSIT_NOTES_GATE_BAHT.toLocaleString()} ฿
                      · ต้องระบุเหตุผลในหมายเหตุ (อย่างน้อย{" "}
                      {DEPOSIT_NOTES_MIN_LEN} ตัวอักษร)
                    </div>
                  )}
                </div>
              );
            })()}
        </CardBody>
      </Card>

      {/* Slip upload */}
      <Card>
        <CardBody className="space-y-3 p-4">
          <div className="text-sm font-semibold text-zinc-800">
            สลิปธนาคาร (ต้องแนบ)
          </div>

          {slip ? (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slip.previewUrl}
                alt="สลิป"
                className="max-h-72 w-full rounded-md object-contain"
              />
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> อัปโหลดเรียบร้อย
                </span>
                <span className="font-mono text-zinc-500">
                  {slip.sizeKb} KB
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label
                  htmlFor={cameraInputId}
                  className={cn(
                    labelBtn,
                    "h-12 text-sm",
                    (uploading || pending) && "pointer-events-none opacity-50",
                  )}
                >
                  <Camera className="h-4 w-4" /> ถ่ายใหม่
                </label>
                <label
                  htmlFor={galleryInputId}
                  className={cn(
                    labelBtn,
                    "h-12 text-sm",
                    (uploading || pending) && "pointer-events-none opacity-50",
                  )}
                >
                  <Images className="h-4 w-4" /> เลือกใหม่
                </label>
              </div>
            </div>
          ) : uploading ? (
            <div className="flex h-14 items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 text-sm text-zinc-600">
              <Loader2 className="h-5 w-5 animate-spin" /> กำลังอัปโหลด...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label
                htmlFor={cameraInputId}
                className={cn(
                  labelBtn,
                  "h-14 text-sm",
                  (uploading || pending) && "pointer-events-none opacity-50",
                )}
              >
                <Camera className="h-5 w-5" /> ถ่ายรูปสด
              </label>
              <label
                htmlFor={galleryInputId}
                className={cn(
                  labelBtn,
                  "h-14 text-sm",
                  (uploading || pending) && "pointer-events-none opacity-50",
                )}
              >
                <Images className="h-5 w-5" /> เลือกจากคลัง
              </label>
            </div>
          )}

          {ocrRunning && (
            <div className="flex items-center gap-2 text-xs text-violet-600">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              กำลังอ่านยอดจากสลิป...
            </div>
          )}
        </CardBody>
      </Card>

      {/* Notes */}
      <Card>
        <CardBody className="space-y-2 p-4">
          <label
            htmlFor={notesId}
            className="text-sm font-semibold text-zinc-800"
          >
            หมายเหตุ (ถ้ามี)
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="เช่น แลกเงินก่อนฝาก, รวมหลายวัน, ..."
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || uploading || !slip || selectedIds.size === 0}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          <>
            <Landmark className="mr-2 h-5 w-5" />
            ยืนยันฝากเงินก้อน · {selectedIds.size} รอบ
          </>
        )}
      </Button>
    </form>
  );
}
