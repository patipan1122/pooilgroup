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
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronLeft,
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

type LineStatus = "collected" | "broken" | "empty" | "skipped" | "mismatch";

interface LineState {
  status: LineStatus;
  amount: string;
  reasonCode: string;
  reasonFree: string;
  /** Filled in when reasonCode === "chair_missing" · the code maid actually
   *  found at this slot (or empty if nothing was there). Wave-2 B3 / NR-1. */
  foundChairCode?: string;
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
  { value: "หยุด", label: "แม่บ้านหยุด/ลา" },
  { value: "machine_broken", label: "เครื่องเสีย" },
  { value: "stuck", label: "ตู้ค้าง · เปิดไม่ได้" },
  { value: "no_customer", label: "ไม่มีลูกค้าใช้" },
  { value: "closed", label: "ปิดสาขาวันนี้" },
  // Wave-2 B3 (NR-1): when the chairCode in the checklist isn't physically
  // present at the branch · maid flags it + writes the real code she found
  // (if any). Office reconciles.
  { value: "chair_missing", label: "ไม่มีรหัสนี้ที่สาขา (พบรหัสอื่น)" },
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
  // Two-phase UX: "flag" = quick-mark problem chairs first · "amounts" = enter amounts
  const [phase, setPhase] = useState<"flag" | "amounts">("flag");

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
        branchOverride: branchOverride ?? null,
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
    // Wave-2 B4: allow all-problem submission (every chair broken/missing).
    // Without this, a branch with one defective chair couldn't close out a
    // round. The server still requires at least 1 collected line, so we let
    // the action gate that case; locally we just guard "every chair is empty
    // by default → nothing flagged".
    let nonDefaultLines = 0;
    for (const code of chairCodes) {
      const l = lines[code];
      if (!l) return `เก้าอี้ ${code} ไม่มีข้อมูล`;
      if (l.status !== "collected" || l.amount !== "") nonDefaultLines += 1;
      if (l.status === "collected") {
        const n = Number(l.amount.replace(/,/g, "")) || 0;
        if (n < 0 && l.amount !== "") return `${code} · กรอกยอดที่เก็บได้`;
      } else {
        if (!l.reasonCode) return `${code} · เลือกเหตุผล`;
        if (l.reasonCode === "other" && !l.reasonFree.trim()) {
          return `${code} · พิมพ์เหตุผลเพิ่ม`;
        }
        if (l.reasonCode === "chair_missing") {
          const fc = (l.foundChairCode ?? "").trim();
          if (fc && fc === code) {
            return `${code} · รหัสที่พบเหมือนเดิม · ไม่ใช่ mismatch`;
          }
        }
      }
    }
    if (nonDefaultLines === 0) {
      return "กรอกยอด · หรือกดธงเก็บไม่ได้ของอย่างน้อย 1 เก้าอี้";
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
        // Auto-convert: collected + 0 บาท → ถือว่าแม่บ้านหยุด/ลา
        const isZeroCollect = l.status === "collected" && amountNum === 0;
        // Wave-2 B3: reasonCode === "chair_missing" overrides the status to
        // "mismatch" and pipes the actual found code through.
        const isMismatch = l.status !== "collected" && l.reasonCode === "chair_missing";
        const effectiveStatus: LineStatus = isMismatch
          ? "mismatch"
          : isZeroCollect
            ? "broken"
            : l.status;
        const reasonText = isZeroCollect
          ? "แม่บ้านหยุด/ลา"
          : l.status === "collected"
            ? null
            : l.reasonCode === "other"
              ? l.reasonFree.trim() || null
              : (REASON_OPTIONS.find((r) => r.value === l.reasonCode)?.label ??
                l.reasonCode);
        return {
          chairCode: code,
          status: effectiveStatus,
          amount: amountNum,
          reason: reasonText,
          foundChairCode: isMismatch
            ? ((l.foundChairCode ?? "").trim() || null)
            : null,
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

      {/* ─── Phase 1: Quick-flag ─── */}
      {phase === "flag" && (
        <>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            กดที่เก้าอี้ตัวไหน <span className="font-semibold text-amber-700">ถ้าเก็บเงินไม่ได้</span>
            {" "}· ที่เหลือถือว่าเก็บปกติ
          </div>
          <ul className="space-y-2">
            {chairCodes.map((code) => {
              const l = lines[code] ?? defaultLine();
              const isProblem = l.status !== "collected";
              const movedIn = movedInMap.get(code);
              return (
                <li key={code}>
                  <button
                    type="button"
                    onClick={() => toggleProblem(code)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors active:scale-[0.98]",
                      isProblem
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-zinc-200 bg-white text-zinc-900",
                    )}
                  >
                    <span className="w-[60px] font-mono text-sm font-bold">
                      {code}
                    </span>
                    <span className="grow text-sm">
                      {movedIn && (
                        <span className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
                          🆕 ย้ายเข้า
                        </span>
                      )}
                      {isProblem
                        ? <span className="font-medium text-amber-700">⚠ เก็บไม่ได้</span>
                        : <span className="text-zinc-500">เก็บปกติ</span>
                      }
                    </span>
                    <span
                      className={cn(
                        "grid size-6 shrink-0 place-items-center rounded-full border-2",
                        isProblem
                          ? "border-amber-400 bg-amber-400 text-white"
                          : "border-zinc-300 bg-white",
                      )}
                    >
                      {isProblem && <X className="size-3.5" aria-hidden />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Button
            type="button"
            size="xl"
            className="h-14 w-full text-base font-semibold"
            onClick={() => setPhase("amounts")}
            disabled={chairCodes.length === 0}
          >
            กรอกยอดต่อ
            <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
          {totals.problem > 0 && (
            <p className="text-center text-xs text-amber-700">
              มีปัญหา {totals.problem} ตัว · กด "กรอกยอดต่อ" เพื่อระบุเหตุผล
            </p>
          )}
        </>
      )}

      {/* ─── Phase 2: Enter amounts ─── */}
      {phase === "amounts" && (
        <>
          <button
            type="button"
            onClick={() => setPhase("flag")}
            className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800"
          >
            <ChevronLeft className="h-4 w-4" /> แก้ไขสถานะ
          </button>

          {/* Normal chairs */}
          {chairCodes.filter((c) => (lines[c] ?? defaultLine()).status === "collected").length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                เก้าอี้เก็บปกติ
              </h2>
              <ul className="space-y-2">
                {chairCodes
                  .filter((c) => (lines[c] ?? defaultLine()).status === "collected")
                  .map((code) => {
                    const l = lines[code] ?? defaultLine();
                    const movedIn = movedInMap.get(code);
                    return (
                      <li key={code}>
                        <div className="flex items-center gap-2">
                          <span className="grid h-10 min-w-[64px] place-items-center rounded-md bg-zinc-100 px-2 font-mono text-sm font-semibold text-zinc-900">
                            {code}
                            {movedIn && (
                              <span className="ml-1 text-[9px] text-sky-600">🆕</span>
                            )}
                          </span>
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
                          <span className="text-sm text-zinc-500">฿</span>
                          <button
                            type="button"
                            onClick={() => toggleProblem(code)}
                            className="grid size-10 shrink-0 place-items-center rounded-md border border-amber-300 bg-amber-50 text-amber-700 active:bg-amber-100"
                            aria-label={`ระบุว่า ${code} ขัดข้อง`}
                          >
                            <AlertTriangle className="size-5" aria-hidden />
                          </button>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}

          {/* Problem chairs */}
          {chairCodes.filter((c) => (lines[c] ?? defaultLine()).status !== "collected").length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                เก้าอี้มีปัญหา — ระบุเหตุผล
              </h2>
              <ul className="space-y-2">
                {chairCodes
                  .filter((c) => (lines[c] ?? defaultLine()).status !== "collected")
                  .map((code) => {
                    const l = lines[code] ?? defaultLine();
                    return (
                      <li key={code}>
                        <Card className="border-amber-300 bg-amber-50/40">
                          <CardBody className="space-y-2 p-3">
                            <div className="flex items-center gap-2">
                              <span className="grid h-8 min-w-[60px] place-items-center rounded-md bg-amber-100 px-2 font-mono text-sm font-semibold text-amber-900">
                                {code}
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleProblem(code)}
                                className="ml-auto grid size-8 shrink-0 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-600 active:bg-zinc-100"
                                aria-label={`ยกเลิก ขัดข้อง ${code}`}
                              >
                                <X className="size-4" aria-hidden />
                              </button>
                            </div>
                            <select
                              value={l.reasonCode}
                              onChange={(e) => patchLine(code, { reasonCode: e.target.value })}
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
                                onChange={(e) => patchLine(code, { reasonFree: e.target.value })}
                                className="h-10"
                                maxLength={200}
                                aria-label={`พิมพ์เหตุผลของ ${code}`}
                              />
                            )}
                            {l.reasonCode === "chair_missing" && (
                              <div className="space-y-1">
                                <Input
                                  type="text"
                                  placeholder="พบรหัสจริง (ถ้ามี) เช่น CH-2042"
                                  value={l.foundChairCode ?? ""}
                                  onChange={(e) =>
                                    patchLine(code, {
                                      foundChairCode: e.target.value
                                        .toUpperCase()
                                        .replace(/[^A-Z0-9_-]/g, "")
                                        .slice(0, 40),
                                    })
                                  }
                                  className="h-10 font-mono"
                                  maxLength={40}
                                  aria-label={`รหัสจริงที่พบแทน ${code}`}
                                />
                                <p className="text-[11px] text-amber-700">
                                  ถ้าไม่มีเก้าอี้เลย ปล่อยว่าง · ออฟฟิศจะตามตรวจ
                                </p>
                              </div>
                            )}
                            <ChairPhotoButton
                              code={code}
                              state={l}
                              onPick={(file) => void onPickChairPhoto(code, file)}
                              disabled={pending}
                            />
                          </CardBody>
                        </Card>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}
        </>
      )}

      {phase === "amounts" && (
        <>
          <Card>
            <CardBody className="space-y-2 p-4">
              <label htmlFor={notesId} className="text-sm font-semibold text-zinc-800">
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
        </>
      )}
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
