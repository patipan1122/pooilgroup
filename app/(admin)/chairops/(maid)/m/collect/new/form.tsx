"use client";

// Maid cash-collection STEP 1 form · chair-checklist edition (2026-05-30).
//
// CEO spec:
// - หน้านี้ต้องแสดงเก้าอี้ทุกตัวของสาขาให้ครบ (no typing chairCode by hand).
// - maid กรอกยอดต่อเก้าอี้.
// - เก้าอี้ตัวไหนเก็บไม่ได้ → กดไอคอนเล็กๆ ข้างเก้าอี้ → ระบุเหตุผล + ถ่ายรูป 1 ใบ.
// - ไม่มีรูปเงินรวม (CEO บอกไม่จำเป็น).
// - เก็บได้อย่างน้อย 1 ตัวจึงจะ submit ได้.
//
// Submits to createCashCollection({lines, evidencePhotoUrl?, imageHash?, notes?})
// which writes the per-chair JSON into chair_breakdown and sums countedAmount
// server-side. Deposit happens later via the batch /m/deposit page.

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
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { compressImage } from "@/lib/chairops/utils/image-compress";
import { isOnline } from "@/lib/chairops/utils/maid-outbox";
import {
  createCashCollection,
  presignChairPhoto,
} from "@/app/(admin)/chairops/collect/actions";

type LineStatus = "collected" | "broken" | "empty" | "skipped";

interface LineState {
  status: LineStatus;
  amount: string;
  reasonCode: string;
  reasonFree: string;
  photoUrl?: string;
  photoHash?: string;
  photoPreviewUrl?: string;
  photoSizeKb?: number;
  uploading?: boolean;
}

interface Props {
  chairCodes: ReadonlyArray<string>;
  /**
   * When set, the action will record the collection for THIS branch instead
   * of the caller's primaryBranchId. Used by the office-direct-collect route
   * /chairops/(office)/collect/[branchId]/new where an admin/CEO picks a
   * branch from the multi-select picker and acts on its behalf.
   */
  branchOverride?: string | null;
  /**
   * Chairs that moved INTO this branch within the last 14 days. Surfaced as
   * "🆕 ย้ายมาใหม่" badges so the maid isn't confused by unfamiliar codes
   * (CEO 2026-05-31).
   */
  recentlyMovedIn?: ReadonlyArray<{
    chairCode: string;
    fromName: string | null;
    movedAt: string;
  }>;
}

const REASON_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "เลือกเหตุผล …" },
  { value: "machine_broken", label: "เครื่องเสีย" },
  { value: "stuck", label: "ตู้ค้าง · เปิดไม่ได้" },
  { value: "no_customer", label: "ไม่มีลูกค้าใช้" },
  { value: "closed", label: "ปิดสาขาวันนี้" },
  { value: "other", label: "อื่น ๆ (พิมพ์ระบุ)" },
];

function newUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function defaultLine(): LineState {
  return { status: "collected", amount: "", reasonCode: "", reasonFree: "" };
}

export function CollectNewForm({
  chairCodes,
  branchOverride,
  recentlyMovedIn,
}: Props) {
  const movedInMap = new Map(
    (recentlyMovedIn ?? []).map((m) => [m.chairCode, m] as const),
  );
  function fmtMovedAt(iso: string): string {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days <= 0) return "วันนี้";
    if (days === 1) return "เมื่อวาน";
    return `${days} วันก่อน`;
  }
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [notes, setNotes] = useState("");
  const draftIdRef = useRef<string>(newUuid());
  const [lines, setLines] = useState<Record<string, LineState>>(() => {
    const init: Record<string, LineState> = {};
    for (const code of chairCodes) init[code] = defaultLine();
    return init;
  });

  const notesId = useId();

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

  const totals = useMemo(() => {
    let countedSum = 0;
    let collected = 0;
    let problem = 0;
    for (const code of chairCodes) {
      const l = lines[code];
      if (!l) continue;
      if (l.status === "collected") {
        collected += 1;
        const n = Number(l.amount.replace(/,/g, "")) || 0;
        countedSum += n;
      } else {
        problem += 1;
      }
    }
    return { countedSum, collected, problem };
  }, [chairCodes, lines]);

  function patchLine(code: string, patch: Partial<LineState>) {
    setLines((prev) => ({ ...prev, [code]: { ...prev[code], ...patch } }));
  }

  function toggleProblem(code: string) {
    const current = lines[code];
    if (!current) return;
    if (current.status === "collected") {
      patchLine(code, {
        status: "broken",
        amount: "",
        reasonCode: "machine_broken",
      });
    } else {
      patchLine(code, {
        status: "collected",
        reasonCode: "",
        reasonFree: "",
        photoUrl: undefined,
        photoHash: undefined,
        photoPreviewUrl: undefined,
        photoSizeKb: undefined,
      });
    }
  }

  async function onPickChairPhoto(code: string, file: File) {
    if (!/^image\//.test(file.type)) {
      toast.error("ต้องเป็นไฟล์รูปภาพ");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast.error("รูปใหญ่เกินไป · ถ่ายใหม่");
      return;
    }
    patchLine(code, { uploading: true });
    try {
      const compressed = await compressImage(file);
      const blob = compressed.blob;
      const buf = await blob.arrayBuffer();
      const hash = await sha256Hex(buf);
      const presign = await presignChairPhoto({
        contentType: compressed.compressed ? "image/jpeg" : file.type,
        draftId: draftIdRef.current,
        chairCode: code,
      });
      if (!presign.ok) {
        toast.error(presign.error);
        return;
      }
      if (!isOnline()) {
        toast.error("ออฟไลน์ · เชื่อมต่อก่อนแล้วลองอีกครั้ง");
        return;
      }
      const putRes = await fetch(presign.data.url, {
        method: "PUT",
        body: blob,
        headers: {
          "Content-Type": compressed.compressed ? "image/jpeg" : file.type,
        },
      });
      if (!putRes.ok) {
        toast.error("อัปโหลดรูปไม่สำเร็จ");
        return;
      }
      patchLine(code, {
        photoUrl: presign.data.publicUrl,
        photoHash: hash,
        photoPreviewUrl: URL.createObjectURL(blob),
        photoSizeKb: Math.round(blob.size / 1024),
      });
      toast.success(`รูป ${code} แนบแล้ว`);
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      patchLine(code, { uploading: false });
    }
  }

  function validateBeforeSubmit(): string | null {
    if (chairCodes.length === 0) {
      return "สาขานี้ยังไม่มีเก้าอี้ในระบบ · ติดต่อออฟฟิศ";
    }
    if (totals.collected === 0) {
      return "ต้องเก็บอย่างน้อย 1 เก้าอี้ (หรือทุกตัวมีปัญหา?)";
    }
    for (const code of chairCodes) {
      const l = lines[code];
      if (!l) return `เก้าอี้ ${code} ไม่มีข้อมูล`;
      if (l.status === "collected") {
        const n = Number(l.amount.replace(/,/g, "")) || 0;
        if (n <= 0) return `${code} · กรอกยอดที่เก็บได้`;
      } else {
        if (!l.reasonCode) return `${code} · เลือกเหตุผล`;
        if (l.reasonCode === "other" && !l.reasonFree.trim()) {
          return `${code} · พิมพ์เหตุผลเพิ่ม`;
        }
      }
    }
    return null;
  }

  function submitNow() {
    startTransition(async () => {
      const payloadLines = chairCodes.map((code) => {
        const l = lines[code]!;
        const amountNum =
          l.status === "collected"
            ? Number(l.amount.replace(/,/g, "")) || 0
            : 0;
        const reasonText =
          l.status === "collected"
            ? null
            : l.reasonCode === "other"
              ? l.reasonFree.trim() || null
              : (REASON_OPTIONS.find((r) => r.value === l.reasonCode)?.label ??
                l.reasonCode);
        return {
          chairCode: code,
          status: l.status,
          amount: amountNum,
          reason: reasonText,
          photoUrl: l.photoUrl ?? null,
          photoHash: l.photoHash ?? null,
        };
      });
      const res = await createCashCollection({
        lines: payloadLines,
        branchOverride: branchOverride ?? null,
        evidencePhotoUrl: null,
        imageHash: null,
        notes: notes.trim() || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("บันทึกการนับแล้ว · ฝากเงินทีหลังได้");
      // Office collect routes go to the office collection detail; maid path
      // stays on the maid hub for the back-button breadcrumb.
      router.push(
        branchOverride
          ? `/chairops/collect/${res.data.id}`
          : `/chairops/m/collect/${res.data.id}`,
      );
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

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-800"
        >
          <WifiOff className="h-5 w-5 shrink-0" aria-hidden />
          ออฟไลน์ · เชื่อมต่อก่อนกดบันทึก
        </div>
      )}
      {online && (
        <div className="sr-only" role="status" aria-live="polite">
          <Wifi className="hidden" aria-hidden /> ออนไลน์
        </div>
      )}

      {chairCodes.length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardBody className="space-y-1 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4" /> ยังไม่มีเก้าอี้ในสาขา
            </div>
            <p className="text-amber-700">
              กรุณาแจ้งออฟฟิศให้ลงทะเบียนรหัสเก้าอี้ในระบบก่อน
            </p>
          </CardBody>
        </Card>
      )}

      {/* Totals summary — sticks at the top for quick visual feedback. */}
      {chairCodes.length > 0 && (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardBody className="flex items-center justify-between gap-3 p-4">
            <div>
              <div className="text-xs text-emerald-700">รวมยอดที่กรอก</div>
              <div className="text-2xl font-bold tabular-nums text-emerald-900">
                {totals.countedSum.toLocaleString()} ฿
              </div>
            </div>
            <div className="text-right text-xs text-emerald-800">
              <div>เก็บได้ {totals.collected} ตัว</div>
              {totals.problem > 0 && (
                <div className="text-amber-700">มีปัญหา {totals.problem} ตัว</div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Chair list — one row per chair. Order = chairCode asc (server sorted). */}
      <ul className="space-y-2">
        {chairCodes.map((code) => {
          const l = lines[code] ?? defaultLine();
          const isProblem = l.status !== "collected";
          const movedIn = movedInMap.get(code);
          return (
            <li key={code}>
              <Card
                className={cn(
                  "transition-colors",
                  isProblem
                    ? "border-amber-300 bg-amber-50/40"
                    : movedIn
                      ? "border-sky-300 bg-sky-50/40"
                      : "border-zinc-200",
                )}
              >
                <CardBody className="space-y-2 p-3">
                  {movedIn && (
                    <div className="flex items-center gap-1.5 text-xs text-sky-700">
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 font-medium">
                        🆕 ย้ายมาใหม่
                      </span>
                      <span>
                        {movedIn.fromName ? `จาก ${movedIn.fromName} · ` : ""}
                        {fmtMovedAt(movedIn.movedAt)}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="grid h-10 min-w-[64px] place-items-center rounded-md bg-zinc-100 px-2 font-mono text-sm font-semibold text-zinc-900">
                      {code}
                    </span>
                    {isProblem ? (
                      <div className="grow text-sm font-medium text-amber-700">
                        ⚠ เก็บไม่ได้
                      </div>
                    ) : (
                      <Input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="0"
                        value={l.amount}
                        onChange={(e) =>
                          patchLine(code, {
                            amount: e.target.value.replace(/[^0-9]/g, ""),
                          })
                        }
                        className="h-10 grow text-right text-lg font-semibold tabular-nums"
                        aria-label={`ยอดที่เก็บได้จาก ${code}`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => toggleProblem(code)}
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-md border transition-colors",
                        isProblem
                          ? "border-zinc-300 bg-white text-zinc-600 active:bg-zinc-100"
                          : "border-amber-300 bg-amber-50 text-amber-700 active:bg-amber-100",
                      )}
                      aria-label={
                        isProblem
                          ? `ยกเลิก ขัดข้อง ${code}`
                          : `ระบุว่า ${code} ขัดข้อง`
                      }
                    >
                      {isProblem ? (
                        <X className="size-5" aria-hidden />
                      ) : (
                        <AlertTriangle className="size-5" aria-hidden />
                      )}
                    </button>
                  </div>
                  {isProblem && (
                    <div className="space-y-2 rounded-md border border-amber-200 bg-white p-2">
                      <select
                        value={l.reasonCode}
                        onChange={(e) =>
                          patchLine(code, { reasonCode: e.target.value })
                        }
                        className="h-10 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                        aria-label={`เหตุผล ${code}`}
                      >
                        {REASON_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {l.reasonCode === "other" && (
                        <Input
                          type="text"
                          placeholder="ระบุเหตุผล …"
                          value={l.reasonFree}
                          onChange={(e) =>
                            patchLine(code, { reasonFree: e.target.value })
                          }
                          className="h-10"
                          maxLength={200}
                          aria-label={`พิมพ์เหตุผลของ ${code}`}
                        />
                      )}
                      <ChairPhotoButton
                        code={code}
                        state={l}
                        onPick={(file) => void onPickChairPhoto(code, file)}
                        disabled={pending}
                      />
                    </div>
                  )}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>

      <Card>
        <CardBody className="space-y-2 p-4">
          <label
            htmlFor={notesId}
            className="text-sm font-semibold text-zinc-800"
          >
            หมายเหตุรอบนี้ (ถ้ามี)
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="เช่น แลกเงินก่อนฝาก, มีเหรียญแยก, ..."
            className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          />
        </CardBody>
      </Card>

      <Button
        type="submit"
        size="xl"
        className="h-14 w-full text-base font-semibold"
        disabled={pending || chairCodes.length === 0}
      >
        {pending ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> กำลังบันทึก...
          </>
        ) : (
          "บันทึกการนับ · ฝากเงินทีหลังได้"
        )}
      </Button>
      <p className="text-center text-xs text-zinc-500">
        Step 1 จาก 2 · ฝากเงินก้อนใหญ่ทีหลัง (รวมรอบไหนก็ได้ที่ยังไม่ฝาก) ที่หน้าหลัก
      </p>
    </form>
  );
}

function ChairPhotoButton({
  code,
  state,
  onPick,
  disabled,
}: {
  code: string;
  state: LineState;
  onPick: (file: File) => void;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onPick(file);
  }
  return (
    <div className="space-y-2">
      {state.photoPreviewUrl ? (
        <div className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.photoPreviewUrl}
            alt={`รูป ${code}`}
            className="max-h-44 w-full rounded-md object-contain"
          />
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 font-medium text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> แนบแล้ว
            </span>
            <span className="font-mono text-zinc-500">
              {state.photoSizeKb} KB
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || state.uploading}
            className="h-9 w-full text-xs"
          >
            ถ่ายใหม่
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || state.uploading}
          className="h-10 w-full text-sm"
        >
          {state.uploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> กำลังอัปโหลด...
            </>
          ) : (
            <>
              <Camera className="mr-2 h-4 w-4" /> แนบรูปเก้าอี้ {code}
            </>
          )}
        </Button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onChange}
      />
    </div>
  );
}
