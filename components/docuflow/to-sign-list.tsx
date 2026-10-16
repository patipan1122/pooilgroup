"use client";

// ToSignList — "เซ็นทีละหลายฉบับ" (bulk sign) UI for /sign/to-sign
// ────────────────────────────────────────────────────────────────────
// 3-step flow, mirroring signer-interface.tsx's "preview → confirm" idea
// but at list-scale:
//   1. "list"    — one row per pending document, explicit opt-in checkbox
//                  (none pre-checked — the signer must deliberately pick
//                  what they're about to sign, not rubber-stamp a
//                  select-all).
//   2. "preview" — shows exactly what's about to be signed (document
//                  names + which page(s)/placement labels) before the
//                  confirm button is even clickable. This is the human-
//                  visible "I saw the list" step — never auto-advanced.
//   3. "signing" — client-side loop over the EXISTING
//                  POST /api/docuflow/[id]/signatures/[placementId]/sign
//                  endpoint (useSavedSignature: true), capped at 4
//                  concurrent requests, with a live per-item checklist
//                  (not one opaque spinner).
//
// Nothing here touches the sign endpoint, embedSignatures(), or
// my-signature.ts — this is purely a client-side batch caller over the
// same API a single-document signer already uses one placement at a
// time. On completion, fully-signed documents drop out of the pending
// list; documents with a failed placement keep ONLY their still-unsigned
// placement(s) (never resubmits an already-signed one — the API 409s on
// that) and stay selected so the signer can retry without losing state.
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  PenLine,
  ArrowLeft,
  FileText,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { thaiDateLong } from "@/lib/utils/format";
import type {
  ToSignDocumentVm,
  ToSignPlacementVm,
} from "@/lib/docuflow/to-sign";

// Re-exported for existing callers (app/sign/to-sign/page.tsx) that import
// these types from this component file — canonical definition now lives in
// lib/docuflow/to-sign.ts, shared with the Telegram Mini App API route.
export type { ToSignDocumentVm, ToSignPlacementVm };

export interface ToSignListProps {
  documents: ToSignDocumentVm[];
  /** Short-lived signed R2 URL for the signer's saved signature, or null
   *  if they haven't registered one yet — bulk-signing requires one. */
  savedSignatureUrl: string | null;
}

type Step = "list" | "preview" | "signing";
type JobStatus = "waiting" | "running" | "success" | "error";

interface Job {
  documentId: string;
  documentName: string;
  placementId: string;
  pageNumber: number;
  label: string | null;
}

interface JobResult {
  status: JobStatus;
  error?: string;
}

const CONCURRENCY = 4;

/** Tiny worker-pool runner — no new dependency needed for a client-side
 *  loop this small. Runs `worker` over `items` with at most `limit`
 *  in-flight at once. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function pullNext(): Promise<void> {
    const i = cursor++;
    if (i >= items.length) return;
    await worker(items[i]);
    return pullNext();
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => pullNext()),
  );
}

function placementSummary(placements: ToSignPlacementVm[]): string {
  const pages = Array.from(new Set(placements.map((p) => p.pageNumber))).sort(
    (a, b) => a - b,
  );
  const pageLabel = pages.length === 1 ? `หน้า ${pages[0]}` : `หน้า ${pages.join(", ")}`;
  if (placements.length === 1 && placements[0].label) {
    return `${pageLabel} · ${placements[0].label}`;
  }
  return placements.length > 1 ? `${pageLabel} (${placements.length} จุดเซ็น)` : pageLabel;
}

export function ToSignList({
  documents: initialDocuments,
  savedSignatureUrl,
}: ToSignListProps) {
  const [documents, setDocuments] = useState<ToSignDocumentVm[]>(initialDocuments);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>("list");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobResults, setJobResults] = useState<Map<string, JobResult>>(new Map());
  const [signing, setSigning] = useState(false);

  const hasSavedSignature = !!savedSignatureUrl;

  const selectedDocuments = useMemo(
    () => documents.filter((d) => selected.has(d.documentId)),
    [documents, selected],
  );

  function toggle(documentId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  function goToPreview() {
    if (selected.size === 0) {
      toast.error("กรุณาเลือกเอกสารก่อน");
      return;
    }
    setStep("preview");
  }

  async function confirmSignAll() {
    const flatJobs: Job[] = selectedDocuments.flatMap((d) =>
      d.placements.map((p) => ({
        documentId: d.documentId,
        documentName: d.documentName,
        placementId: p.id,
        pageNumber: p.pageNumber,
        label: p.label,
      })),
    );
    if (flatJobs.length === 0) return;

    setJobs(flatJobs);
    setJobResults(new Map(flatJobs.map((j) => [j.placementId, { status: "waiting" }])));
    setStep("signing");
    setSigning(true);

    const tally = { success: 0, error: 0 };

    await runPool(flatJobs, CONCURRENCY, async (job) => {
      setJobResults((prev) => new Map(prev).set(job.placementId, { status: "running" }));
      try {
        const res = await fetch(
          `/api/docuflow/${job.documentId}/signatures/${job.placementId}/sign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ useSavedSignature: true }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
        };
        if (!res.ok || !data.success) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        tally.success += 1;
        setJobResults((prev) => new Map(prev).set(job.placementId, { status: "success" }));
      } catch (err) {
        tally.error += 1;
        const message = err instanceof Error ? err.message : "เซ็นไม่สำเร็จ";
        setJobResults((prev) =>
          new Map(prev).set(job.placementId, { status: "error", error: message }),
        );
      }
    });

    setSigning(false);
    if (tally.error === 0) {
      toast.success(`เซ็นสำเร็จทั้งหมด ${tally.success} รายการ`);
    } else {
      toast.error(`เซ็นสำเร็จ ${tally.success} รายการ · ล้มเหลว ${tally.error} รายการ`);
    }
  }

  // Fold the just-finished run back into state: documents whose every
  // placement succeeded drop out of the pending list entirely; documents
  // with a failure keep only their still-unsigned placement(s) and stay
  // selected so "ถัดไป" → preview → confirm retries just those.
  function backToList() {
    setDocuments((prevDocs) => {
      const next: ToSignDocumentVm[] = [];
      for (const doc of prevDocs) {
        if (!selected.has(doc.documentId)) {
          next.push(doc);
          continue;
        }
        const remaining = doc.placements.filter(
          (p) => jobResults.get(p.id)?.status !== "success",
        );
        if (remaining.length > 0) next.push({ ...doc, placements: remaining });
      }
      return next;
    });

    const stillFailed = new Set(
      selectedDocuments
        .filter((d) => d.placements.some((p) => jobResults.get(p.id)?.status === "error"))
        .map((d) => d.documentId),
    );
    setSelected(stillFailed);
    setJobs([]);
    setJobResults(new Map());
    setStep("list");
  }

  /* ============================================================
     Step "signing" — live per-item checklist + results summary.
     ============================================================ */
  if (step === "signing") {
    const successCount = jobs.filter((j) => jobResults.get(j.placementId)?.status === "success").length;
    const errorCount = jobs.filter((j) => jobResults.get(j.placementId)?.status === "error").length;
    const settled = !signing;

    return (
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-1">
            <p className="text-xs font-bold text-zinc-500">เซ็นทีละหลายฉบับ</p>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display">
              {settled ? "เซ็นเสร็จแล้ว" : "กำลังเซ็นเอกสาร..."}
            </h1>
            {settled && (
              <p className="text-sm text-zinc-600">
                สำเร็จ {successCount} รายการ
                {errorCount > 0 ? ` · ล้มเหลว ${errorCount} รายการ` : ""} จากทั้งหมด {jobs.length} รายการ
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-2">
            {jobs.map((job) => {
              const result = jobResults.get(job.placementId);
              const status = result?.status ?? "waiting";
              return (
                <div
                  key={job.placementId}
                  className="flex items-start gap-3 py-2 border-b border-zinc-100 last:border-0"
                >
                  <div className="shrink-0 mt-0.5">
                    {status === "success" && <CheckCircle2 className="size-5 text-green-600" />}
                    {status === "error" && <XCircle className="size-5 text-red-600" />}
                    {status === "running" && <Loader2 className="size-5 text-zinc-400 animate-spin" />}
                    {status === "waiting" && <Circle className="size-5 text-zinc-300" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-800 truncate">
                      {job.documentName}
                    </p>
                    <p className="text-xs text-zinc-500">
                      หน้า {job.pageNumber}
                      {job.label ? ` · ${job.label}` : ""}
                    </p>
                    {status === "error" && result?.error && (
                      <p className="text-xs text-red-600 mt-0.5">{result.error}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        {settled && (
          <div className="sticky bottom-3 z-20 px-1">
            <Button variant="primary" size="xl" fullWidth onClick={backToList}>
              {errorCount > 0 ? "กลับไปลองใหม่รายการที่ล้มเหลว" : "กลับไปที่รายการ"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  /* ============================================================
     Step "preview" — exactly what's about to be signed.
     ============================================================ */
  if (step === "preview") {
    return (
      <div className="space-y-4">
        <Card>
          <CardBody className="space-y-2">
            <button
              type="button"
              onClick={() => setStep("list")}
              className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
            >
              <ArrowLeft className="size-3.5" />
              กลับไปเลือกใหม่
            </button>
            <p className="text-xs font-bold text-zinc-500">ตรวจสอบก่อนเซ็น</p>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display">
              กำลังจะเซ็น {selectedDocuments.length} ฉบับ
            </h1>
            <p className="text-sm text-zinc-600">
              ด้วยลายเซ็นที่บันทึกไว้ของคุณ — ตรวจรายการด้านล่างให้ครบก่อนกดยืนยัน
            </p>
          </CardBody>
        </Card>

        {savedSignatureUrl && (
          <Card>
            <CardBody className="flex items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed R2 URL */}
              <img
                src={savedSignatureUrl}
                alt="ลายเซ็นที่บันทึกไว้"
                className="max-h-20 max-w-full object-contain"
              />
            </CardBody>
          </Card>
        )}

        <Card>
          <CardBody className="space-y-2">
            {selectedDocuments.map((doc) => (
              <div
                key={doc.documentId}
                className="flex items-start gap-3 py-2 border-b border-zinc-100 last:border-0"
              >
                <FileText className="size-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-zinc-800 truncate">
                    {doc.documentName}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {placementSummary(doc.placements)} · อัปโหลด {thaiDateLong(doc.uploadedAt)}
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <div className="sticky bottom-3 z-20 px-1">
          <Button variant="primary" size="xl" fullWidth onClick={confirmSignAll}>
            <CheckCircle2 className="size-5" />
            ยืนยัน — เซ็นทั้งหมด {selectedDocuments.length} ฉบับ
          </Button>
        </div>
      </div>
    );
  }

  /* ============================================================
     Step "list" — the default/entry view.
     ============================================================ */
  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/docuflow"
          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
        >
          <ArrowLeft className="size-3.5" />
          กลับ Dashboard
        </Link>
      </div>

      <Card>
        <CardBody className="space-y-2">
          <p className="text-xs font-bold text-zinc-500">เซ็นเอกสาร</p>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display">
            เซ็นทีละหลายฉบับ
          </h1>
          <p className="text-sm text-zinc-600">
            เลือกเอกสารที่ต้องการเซ็นพร้อมกัน ใช้ลายเซ็นที่บันทึกไว้ครั้งเดียว
          </p>
        </CardBody>
      </Card>

      {documents.length === 0 ? (
        <Card>
          <CardBody className="text-center text-sm text-zinc-500 py-8">
            ✓ ไม่มีคิวเซ็นค้าง
          </CardBody>
        </Card>
      ) : !hasSavedSignature ? (
        <>
          <Card className="border-amber-200 bg-amber-50">
            <CardBody className="space-y-3">
              <div className="flex items-start gap-2">
                <ShieldAlert className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  คุณยังไม่ได้บันทึกลายเซ็น — ต้องบันทึกไว้ก่อนจึงจะเซ็นทีละหลายฉบับได้
                  (เซ็นทีละฉบับแบบปกติยังทำได้ตามลิงก์ด้านล่าง)
                </p>
              </div>
              <Link href="/profile/signature">
                <Button type="button" variant="primary" size="md">
                  <PenLine className="size-4" />
                  ไปบันทึกลายเซ็น
                </Button>
              </Link>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-1">
              <p className="text-xs font-semibold text-zinc-500 mb-1">
                เอกสารที่รอเซ็น ({documents.length})
              </p>
              {documents.map((doc) => (
                <Link
                  key={doc.documentId}
                  href={`/sign/${doc.placements[0]?.id}`}
                  className="flex items-start gap-3 py-2 border-b border-zinc-100 last:border-0 hover:bg-zinc-50 -mx-2 px-2 rounded-lg"
                >
                  <FileText className="size-4 text-zinc-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-800 truncate">
                      {doc.documentName}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {placementSummary(doc.placements)} · อัปโหลด {thaiDateLong(doc.uploadedAt)}
                    </p>
                  </div>
                </Link>
              ))}
            </CardBody>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-1 divide-y divide-zinc-100">
              {documents.map((doc) => {
                const checked = selected.has(doc.documentId);
                return (
                  <label
                    key={doc.documentId}
                    className="flex items-start gap-3 py-3 first:pt-0 last:pb-0 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(doc.documentId)}
                      className="size-4 mt-0.5 rounded border-zinc-300 text-[var(--color-brand-600)] focus:ring-[var(--color-brand-500)]"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">
                        {doc.documentName}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {placementSummary(doc.placements)} · อัปโหลด {thaiDateLong(doc.uploadedAt)}
                      </p>
                    </div>
                  </label>
                );
              })}
            </CardBody>
          </Card>

          <div className="sticky bottom-3 z-20 px-1">
            <Button
              type="button"
              variant="primary"
              size="xl"
              fullWidth
              disabled={selected.size === 0}
              onClick={goToPreview}
            >
              ถัดไป{selected.size > 0 ? ` (${selected.size} ฉบับ)` : ""} →
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
