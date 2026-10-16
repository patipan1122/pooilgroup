"use client";

// Telegram Mini App — DocuFlow signing. State machine for the 3 views
// (list → preview → signing/success) PLUS the informational states that
// gate them (loading / not-connected / no-saved-signature / empty /
// error). Everything here is client-only: no cookie session exists on
// this surface — every data call carries the Telegram SDK's raw
// `initData` string, verified fresh server-side on every request (see
// lib/telegram/webapp-auth.ts). `initDataUnsafe` is never read.
//
// Deliberately ONE route with in-memory view state, not 3 separate
// Next.js routes — Telegram's BackButton drives in-app navigation here
// (useBackButton below), which only makes sense against local state, not
// browser history, inside an embedded WebView.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTelegramWebApp,
  useMainButton,
  useBackButton,
} from "./use-telegram-webapp";
import {
  Screen,
  Header,
  ListSkeleton,
  EmptyCard,
  LinkButton,
  DocumentCard,
  ChecklistRow,
  SuccessCheckmark,
} from "./views";

interface ToSignPlacementVm {
  id: string;
  pageNumber: number;
  label: string | null;
}
interface ToSignDocumentVm {
  documentId: string;
  documentName: string;
  uploadedAt: string;
  placements: ToSignPlacementVm[];
}
type ToSignResponse =
  | { connected: false; reason: "not_connected" | "invalid" }
  | {
      connected: true;
      userName: string;
      hasSavedSignature: boolean;
      savedSignatureUrl: string | null;
      documents: ToSignDocumentVm[];
    };

type Phase =
  | "loading"
  | "error"
  | "not_connected"
  | "no_signature"
  | "empty"
  | "list"
  | "preview"
  | "signing";

interface Job {
  documentId: string;
  documentName: string;
  placementId: string;
  pageNumber: number;
  label: string | null;
}
type JobStatus = "waiting" | "running" | "success" | "error";
interface JobResult {
  status: JobStatus;
  error?: string;
}

const CONCURRENCY = 3;

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

function placementMeta(placements: ToSignPlacementVm[]): string {
  const pages = Array.from(new Set(placements.map((p) => p.pageNumber))).sort(
    (a, b) => a - b,
  );
  const pageLabel = pages.length === 1 ? `หน้า ${pages[0]}` : `หน้า ${pages.join(", ")}`;
  if (placements.length === 1 && placements[0].label) {
    return `${pageLabel} · ${placements[0].label}`;
  }
  return placements.length > 1 ? `${pageLabel} (${placements.length} จุดเซ็น)` : pageLabel;
}

const CONNECT_URL = "https://pooilgroup.com/docuflow/settings/telegram";
const SIGNATURE_URL = "https://pooilgroup.com/profile/signature";

export function TelegramMiniApp() {
  const { webApp, isReady, isInsideTelegram, initData, rootRef, haptic } =
    useTelegramWebApp();

  const [phase, setPhase] = useState<Phase>("loading");
  const [documents, setDocuments] = useState<ToSignDocumentVm[]>([]);
  const [savedSignatureUrl, setSavedSignatureUrl] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobResults, setJobResults] = useState<Map<string, JobResult>>(new Map());
  const [signingInFlight, setSigningInFlight] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const res = await fetch("/api/telegram/webapp/to-sign", {
        headers: initData ? { "X-Telegram-Init-Data": initData } : {},
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as ToSignResponse | null;
      if (!data) {
        setPhase("error");
        return;
      }
      if (!data.connected) {
        setPhase(data.reason === "not_connected" ? "not_connected" : "error");
        return;
      }
      setDocuments(data.documents);
      setSavedSignatureUrl(data.savedSignatureUrl);
      if (!data.hasSavedSignature) {
        setPhase("no_signature");
      } else if (data.documents.length === 0) {
        setPhase("empty");
      } else {
        setPhase("list");
      }
    } catch (err) {
      console.error("[telegram-app] load to-sign failed", err);
      setPhase("error");
    }
  }, [initData]);

  useEffect(() => {
    // Standard fetch-on-mount: once the Telegram SDK bootstrap settles
    // (`isReady`), kick off the initial data load. `load()` itself calls
    // `setPhase`/`setDocuments` — eslint-plugin-react-hooks v7's new
    // `set-state-in-effect` rule flags any effect that (transitively)
    // triggers a synchronous setState, which includes this ubiquitous
    // "fetch on mount" idiom. Same rule already fires on equivalent,
    // already-shipped code elsewhere in this repo (e.g.
    // app/(admin)/dc/products/products-browse.tsx's posLoading effect) —
    // it is not specific to this file. `load` is also reused directly
    // from retry buttons (plain event handlers, which this rule does not
    // flag), so it can't be rewritten as an effect-only helper.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isReady) load();
  }, [isReady, load]);

  const selectedDocuments = useMemo(
    () => documents.filter((d) => selected.has(d.documentId)),
    [documents, selected],
  );

  function toggle(documentId: string) {
    haptic.impact("light");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }

  const startSigning = useCallback(
    async (docs: ToSignDocumentVm[]) => {
      const flatJobs: Job[] = docs.flatMap((d) =>
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
      setPhase("signing");
      setSigningInFlight(true);

      let errorCount = 0;

      await runPool(flatJobs, CONCURRENCY, async (job) => {
        setJobResults((prev) => new Map(prev).set(job.placementId, { status: "running" }));
        try {
          const res = await fetch("/api/telegram/webapp/sign", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(initData ? { "X-Telegram-Init-Data": initData } : {}),
            },
            body: JSON.stringify({
              items: [{ documentId: job.documentId, placementId: job.placementId }],
            }),
          });
          const data = (await res.json().catch(() => ({}))) as {
            results?: Array<{ placementId: string; success: boolean; error?: string }>;
            error?: string;
          };
          const item = data.results?.[0];
          if (!res.ok || !item?.success) {
            throw new Error(item?.error || data.error || `HTTP ${res.status}`);
          }
          setJobResults((prev) => new Map(prev).set(job.placementId, { status: "success" }));
        } catch (err) {
          errorCount += 1;
          const message = err instanceof Error ? err.message : "เซ็นไม่สำเร็จ";
          setJobResults((prev) =>
            new Map(prev).set(job.placementId, { status: "error", error: message }),
          );
        }
      });

      setSigningInFlight(false);
      if (errorCount === 0) {
        haptic.success();
      } else {
        haptic.error();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initData],
  );

  function backToListAfterSigning() {
    // Drop fully-signed documents from local state; keep only the
    // still-unsigned placement(s) of any document with a failure, and
    // re-select those so the signer can retry without losing context —
    // mirrors components/docuflow/to-sign-list.tsx's backToList(). Computed
    // directly (not via a setDocuments functional updater) so the
    // resulting length is available synchronously for the phase decision
    // below, instead of reading the stale pre-update `documents` closure.
    const nextDocs: ToSignDocumentVm[] = [];
    for (const doc of documents) {
      if (!selected.has(doc.documentId)) {
        nextDocs.push(doc);
        continue;
      }
      const remaining = doc.placements.filter(
        (p) => jobResults.get(p.id)?.status !== "success",
      );
      if (remaining.length > 0) nextDocs.push({ ...doc, placements: remaining });
    }
    setDocuments(nextDocs);

    const stillFailed = new Set(
      selectedDocuments
        .filter((d) => d.placements.some((p) => jobResults.get(p.id)?.status === "error"))
        .map((d) => d.documentId),
    );
    setSelected(stillFailed);
    setJobs([]);
    setJobResults(new Map());
    setPhase(nextDocs.length > 0 ? "list" : "empty");
  }

  const settled = phase === "signing" && !signingInFlight;
  const successCount = jobs.filter((j) => jobResults.get(j.placementId)?.status === "success").length;
  const errorCount = jobs.filter((j) => jobResults.get(j.placementId)?.status === "error").length;

  /* ---------------- Telegram chrome wiring per phase ----------------
   * ONE useMainButton() call and ONE useBackButton() call for the whole
   * component — not one per phase. Telegram's MainButton/BackButton are
   * each a SINGLE underlying button with ONE current click handler; an
   * earlier version of this file called useMainButton() three times
   * (once per phase, each internally doing btn.onClick(handler) in its
   * own effect). Since React runs every hook on every render regardless
   * of that phase's `visible` flag, whichever of the three effects
   * happened to re-run LAST (e.g. because ITS OWN unrelated deps
   * changed) silently became the "active" handler — verified via a real
   * Playwright repro where tapping MainButton from the list screen could
   * fire the signing-phase handler instead. Computing one props object
   * per render and wiring it through a single hook call makes "the
   * registered handler" and "the currently visible phase" the same
   * thing by construction. */

  const mainButtonProps = (() => {
    switch (phase) {
      case "list":
        return {
          text:
            selected.size > 0
              ? `ถัดไป (${selected.size} ฉบับ)`
              : "เลือกเอกสารที่จะเซ็น",
          visible: true,
          enabled: selected.size > 0,
          progress: false,
          onClick: () => {
            if (selected.size === 0) return;
            setPhase("preview");
          },
        };
      case "preview":
        return {
          text: `ยืนยันเซ็น ${selectedDocuments.length} ฉบับ`,
          visible: true,
          enabled: selectedDocuments.length > 0,
          progress: false,
          onClick: () => startSigning(selectedDocuments),
        };
      case "signing":
        return {
          text: settled
            ? errorCount > 0
              ? "ลองใหม่รายการที่ล้มเหลว"
              : "เสร็จสิ้น"
            : "กำลังเซ็น...",
          visible: true,
          enabled: settled,
          progress: !settled,
          onClick: () => {
            if (!settled) return;
            if (errorCount > 0) {
              // Requeue failed docs by going back to preview with just
              // those selected (selectedDocuments already reflects the
              // current `selected`).
              setJobs([]);
              setJobResults(new Map());
              setPhase("preview");
            } else {
              backToListAfterSigning();
            }
          },
        };
      default:
        return { text: "", visible: false, enabled: false, progress: false, onClick: () => {} };
    }
  })();
  useMainButton(webApp, mainButtonProps);

  const backButtonProps = (() => {
    if (phase === "preview") return { visible: true, onClick: () => setPhase("list") };
    if (phase === "signing" && settled) return { visible: true, onClick: backToListAfterSigning };
    return { visible: false, onClick: () => {} };
  })();
  useBackButton(webApp, backButtonProps);

  /* ---------------------------- Render ---------------------------- */

  return (
    <div ref={rootRef} className="tg-root tg-bottom-safe">
      {phase === "loading" && (
        <Screen>
          <Header eyebrow="เซ็นเอกสาร" title="กำลังโหลด…" />
          <ListSkeleton />
        </Screen>
      )}

      {phase === "error" && (
        <Screen>
          <EmptyCard
            icon={<ErrorIcon />}
            title={!isInsideTelegram ? "เปิดผ่านแอป Telegram เท่านั้น" : "โหลดข้อมูลไม่สำเร็จ"}
            body={
              !isInsideTelegram
                ? "หน้านี้ใช้งานได้เฉพาะตอนเปิดจากปุ่มในแชท Telegram ของบอท @PooilgroupDocuFlowBot"
                : "ลองปิดแล้วเปิดใหม่อีกครั้ง หรือติดต่อแอดมินถ้ายังไม่หาย"
            }
            action={
              isInsideTelegram ? (
                <button
                  type="button"
                  onClick={load}
                  className="tg-pressable inline-flex h-10 items-center justify-center rounded-xl px-5 text-sm font-semibold"
                  style={{ background: "var(--tg-button)", color: "var(--tg-button-text)" }}
                >
                  ลองใหม่
                </button>
              ) : undefined
            }
          />
        </Screen>
      )}

      {phase === "not_connected" && (
        <Screen>
          <EmptyCard
            icon={<LinkIcon />}
            title="เชื่อมบัญชีก่อนใช้งาน"
            body="บัญชี Telegram นี้ยังไม่ได้เชื่อมกับบัญชี Pooilgroup ของคุณ — เชื่อมครั้งเดียว ใช้ได้ตลอด"
            action={<LinkButton href={CONNECT_URL}>⚙️ ไปเชื่อมบัญชี</LinkButton>}
          />
        </Screen>
      )}

      {phase === "no_signature" && (
        <Screen>
          <EmptyCard
            icon={<PenIcon />}
            title="ยังไม่มีลายเซ็นบันทึกไว้"
            body="บันทึกลายเซ็นไว้ครั้งเดียวในเว็บ แล้วกลับมาเซ็นเอกสารผ่าน Telegram ได้เลย"
            action={<LinkButton href={SIGNATURE_URL}>✍️ ไปตั้งค่าลายเซ็น</LinkButton>}
          />
        </Screen>
      )}

      {phase === "empty" && (
        <Screen>
          <Header eyebrow="เซ็นเอกสาร" title="ไม่มีเอกสารรอเซ็น" />
          <EmptyCard icon={<CheckIcon />} title="เคลียร์หมดแล้ว" body="ไม่มีเอกสารค้างให้เซ็นตอนนี้" />
        </Screen>
      )}

      {phase === "list" && (
        <Screen>
          <Header
            eyebrow="เซ็นเอกสาร"
            title="เอกสารรอเซ็น"
            subtitle={`เลือกเอกสารที่ต้องการเซ็น (${documents.length} ฉบับ)`}
          />
          <div className="space-y-2.5">
            {documents.map((doc, i) => (
              <DocumentCard
                key={doc.documentId}
                index={i}
                name={doc.documentName}
                meta={placementMeta(doc.placements)}
                selected={selected.has(doc.documentId)}
                onToggle={() => toggle(doc.documentId)}
              />
            ))}
          </div>
        </Screen>
      )}

      {phase === "preview" && (
        <Screen>
          <Header
            eyebrow="ตรวจสอบก่อนเซ็น"
            title={`กำลังจะเซ็น ${selectedDocuments.length} ฉบับ`}
            subtitle="ด้วยลายเซ็นที่บันทึกไว้ของคุณ — ตรวจรายการให้ครบก่อนกดยืนยัน"
          />
          {savedSignatureUrl && (
            <div className="tg-card tg-fade-up flex items-center justify-center rounded-2xl p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed R2 URL */}
              <img
                src={savedSignatureUrl}
                alt="ลายเซ็นที่บันทึกไว้"
                className="max-h-16 max-w-full object-contain"
              />
            </div>
          )}
          <div className="tg-card tg-fade-up rounded-2xl p-3.5">
            {selectedDocuments.map((doc) => (
              <div key={doc.documentId} className="flex items-start gap-3 py-2 border-b tg-border last:border-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{doc.documentName}</span>
                  <span className="block text-xs tg-hint">{placementMeta(doc.placements)}</span>
                </span>
              </div>
            ))}
          </div>
        </Screen>
      )}

      {phase === "signing" && (
        <Screen>
          {settled && errorCount === 0 ? (
            <>
              {/* Document count (selectedDocuments), not placement count
                  (successCount/jobs) — a document can carry >1 placement
                  (e.g. signature on page 2 AND page 3), and "ฉบับ" means
                  "documents," so this intentionally echoes the preview
                  screen's "กำลังจะเซ็น N ฉบับ" number rather than the
                  per-placement tally shown in the checklist below. */}
              <SuccessCheckmark label={`เซ็นสำเร็จทั้งหมด ${selectedDocuments.length} ฉบับ`} />
              <div className="tg-card tg-fade-up rounded-2xl p-3.5">
                {/* De-duplicated by document — jobs is per-PLACEMENT, so a
                    2-placement document would otherwise print its name
                    twice in this summary. */}
                {selectedDocuments.map((doc) => (
                  <div key={doc.documentId} className="flex items-center gap-2 py-1.5 text-sm tg-hint">
                    <CheckIcon className="size-3.5 shrink-0" />
                    <span className="truncate">{doc.documentName}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <Header
                title={settled ? "เซ็นเสร็จแล้ว" : "กำลังเซ็นเอกสาร…"}
                subtitle={
                  settled
                    ? `สำเร็จ ${successCount} รายการ${errorCount > 0 ? ` · ล้มเหลว ${errorCount} รายการ` : ""} จากทั้งหมด ${jobs.length} รายการ`
                    : undefined
                }
              />
              <div className="tg-card tg-fade-up rounded-2xl p-3.5">
                {jobs.map((job) => (
                  <ChecklistRow
                    key={job.placementId}
                    name={job.documentName}
                    meta={`หน้า ${job.pageNumber}${job.label ? ` · ${job.label}` : ""}`}
                    status={jobResults.get(job.placementId)?.status ?? "waiting"}
                    error={jobResults.get(job.placementId)?.error}
                  />
                ))}
              </div>
            </>
          )}
        </Screen>
      )}
    </div>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 tg-hint" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
    </svg>
  );
}
function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 tg-accent-text" fill="none">
      <path
        d="M9 15l6-6M9 9H7a3 3 0 100 6h2m6-6h2a3 3 0 110 6h-2"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6 tg-accent-text" fill="none">
      <path
        d="M4 20l4-1 10-10-3-3L5 16l-1 4z"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CheckIcon({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} tg-accent-text`} fill="none">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
