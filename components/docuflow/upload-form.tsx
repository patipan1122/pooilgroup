"use client";

// UploadForm — DocuFlow (admin tier only)
// ────────────────────────────────────────────────────────────────────
// 2026-05-25 — switched to server-side proxy upload for files ≤ 25 MB.
// Reason: browser → R2 PUT was failing silently on prod (R2 bucket CORS
// not allowlisted). Proxy uploads via Next.js server, eliminating CORS
// as a failure mode. Files > 25 MB still use presigned PUT.
// ────────────────────────────────────────────────────────────────────

import { useState, useTransition, useRef, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { PDFDocument } from "pdf-lib";
import {
  Loader2,
  Upload as UploadIcon,
  Search,
  X,
  Building2,
  Store,
  Layers,
  UserCircle,
  Globe2,
  ChevronDown,
  Settings2,
  FileText,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { DocumentTypeOption } from "@/lib/docuflow/document-types";
import type { DocumentGroupRecord } from "@/lib/docuflow/document-groups";

const DEFAULT_ALERT_DAYS = [90, 30, 7];
const PROXY_MAX_BYTES = 25 * 1024 * 1024;
const LAST_USED_KEY_PREFIX = "docuflow-upload-lastused:";

const FormSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อเอกสาร").max(255),
  documentTypeId: z.string().optional(),
  documentGroupId: z.string().optional(),
  expiryDate: z.string().optional(),
  issueDate: z.string().optional(),
  description: z.string().max(2000).optional(),
  responsibleUserId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

type FormValues = z.infer<typeof FormSchema>;

interface Branch {
  id: string;
  name: string;
  code: string;
  businessType: string;
  companyId: string;
}
interface Company {
  id: string;
  name: string;
  code: string;
}
interface UserRow {
  id: string;
  name: string;
  role: string;
}
interface BizType {
  value: string;
  label: string;
  emoji: string;
}

interface Props {
  companies: Company[];
  branches: Branch[];
  users: UserRow[];
  businessTypes: BizType[];
  documentTypes: DocumentTypeOption[];
  documentGroups: DocumentGroupRecord[];
  orgId: string;
  /** Prefill from ?businessType=X (e.g. linked from the checklist page). */
  defaultBusinessType?: string;
}

type ScopeKind = "group" | "company" | "business_type" | "branch" | "person";

interface Scope {
  kind: ScopeKind;
  refId: string | null;
  label: string;
  emoji: string;
}

type FileUploadState = "pending" | "uploading" | "done" | "error";

interface FileUploadStatus {
  fileName: string;
  status: FileUploadState;
  documentId?: string;
  errorMessage?: string;
}

interface LastUsedChoice {
  lastDocumentTypeId?: string;
  lastScopes?: Scope[];
}

/** A single-file upload mode is unambiguous; a multi-file selection can
 * become N separate Documents ("multiple") or 1 combined PDF ("combined"). */
type UploadMode = "multiple" | "combined";

/** Document created by the last successful submit — rendered in the
 * post-upload success panel so every new document gets an easy path to its
 * signature-placement page (Task 5). */
interface CompletedDoc {
  id: string;
  name: string;
}

const TYPE_EMOJI: Record<string, string> = {
  fuel_station: "⛽",
  lpg_station: "🔵",
  lpg_retail: "🛢️",
  bottling_plant: "🏭",
  hotel: "🏨",
  convenience_store: "🏪",
  ev_station: "⚡",
  cafe: "☕",
  cafe_punthai: "🍵",
  massage_chair: "💺",
  claw_machine: "🎰",
  training_center: "🎓",
  transport: "🚛",
  gas_fleet: "🛻",
};

/** Whether a file can be combined into the single-PDF path below — PDF or
 * JPG/PNG only (checked by MIME type first, extension as a fallback for
 * files the browser didn't tag with a type). */
function isCombinableFile(f: File): boolean {
  const lower = f.name.toLowerCase();
  const type = f.type.toLowerCase();
  return (
    type === "application/pdf" ||
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/jpg" ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg")
  );
}

/**
 * Combine multiple files (PDFs and/or JPG/PNG images) into ONE PDF, entirely
 * client-side via pdf-lib, one input file per page in the order given:
 *   - PDF input   → its pages are copied in as-is (`copyPages`)
 *   - image input → a new page sized to the image is created and the image
 *     is drawn to fill it (`embedJpg`/`embedPng`)
 * This powers "เอกสารเดียว หลายหน้า/ไฟล์" mode (Task 4) — the "scanned as
 * photos" case the CEO described. The resulting File is then handed to the
 * existing single-file upload path (uploadViaProxy/uploadViaPresigned)
 * completely unchanged — every new line of logic lives in this pre-upload
 * transform, the server-side upload code isn't touched at all.
 */
async function combineFilesToPdf(
  inputFiles: File[],
  documentName: string,
): Promise<File> {
  const pdfDoc = await PDFDocument.create();

  for (const f of inputFiles) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const lower = f.name.toLowerCase();
    const type = f.type.toLowerCase();

    if (type === "application/pdf" || lower.endsWith(".pdf")) {
      const srcPdf = await PDFDocument.load(bytes);
      const copiedPages = await pdfDoc.copyPages(srcPdf, srcPdf.getPageIndices());
      for (const page of copiedPages) pdfDoc.addPage(page);
    } else if (type === "image/png" || lower.endsWith(".png")) {
      const img = await pdfDoc.embedPng(bytes);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else if (
      type === "image/jpeg" ||
      type === "image/jpg" ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg")
    ) {
      const img = await pdfDoc.embedJpg(bytes);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      throw new Error(
        `ไม่รองรับไฟล์ "${f.name}" ในโหมดเอกสารเดียว — รองรับเฉพาะ PDF และรูปภาพ JPG/PNG`,
      );
    }
  }

  const outBytes = await pdfDoc.save();
  const safeName =
    (documentName || "").trim() || "combined-document";
  // pdf-lib types `.save()`'s return as `Uint8Array<ArrayBufferLike>`, which
  // TS's DOM lib won't accept as a `BlobPart` (it wants `ArrayBuffer`
  // specifically, not `SharedArrayBuffer`) — `new Uint8Array(outBytes)`
  // copies into a fresh, plain-`ArrayBuffer`-backed view to satisfy `File`.
  return new File([new Uint8Array(outBytes)], `${safeName}.pdf`, {
    type: "application/pdf",
  });
}

export function UploadForm({
  companies,
  branches,
  users,
  businessTypes,
  documentTypes,
  documentGroups,
  orgId,
  defaultBusinessType,
}: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [fileStatuses, setFileStatuses] = useState<FileUploadStatus[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [combining, setCombining] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uploadMode, setUploadMode] = useState<UploadMode>("multiple");
  const [completedDocs, setCompletedDocs] = useState<CompletedDoc[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const fileNameSyncRef = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      documentTypeId: "",
      documentGroupId: "",
      expiryDate: "",
      issueDate: "",
      description: "",
      responsibleUserId: "",
      notes: "",
    },
  });

  const expiryWatch = watch("expiryDate");

  // "เอกสารเดียว" mode combines every selected file into one PDF client-side
  // (pdf-lib) — only PDF + JPG/PNG inputs can be combined that way. If any
  // selected file can't be (e.g. a .docx), the option is disabled with a
  // hint instead of failing silently at submit time.
  const combineSupported = useMemo(
    () => files.length <= 1 || files.every(isCombinableFile),
    [files],
  );

  useEffect(() => {
    if (!combineSupported && uploadMode === "combined") {
      setUploadMode("multiple");
    }
  }, [combineSupported, uploadMode]);

  // "หลายเอกสาร" (today's default) still auto-names each Document from its
  // own filename; "เอกสารเดียว" collapses N files into 1 Document, so the
  // name field behaves like the single-file case (user-editable, used as-is).
  const isMultiDocMode = files.length > 1 && uploadMode === "multiple";

  const allScopes: Scope[] = useMemo(() => {
    const list: Scope[] = [];
    list.push({
      kind: "group",
      refId: null,
      label: "ทั้งกลุ่ม Pooilgroup",
      emoji: "🌐",
    });
    for (const c of companies) {
      list.push({
        kind: "company",
        refId: c.id,
        label: `บริษัท ${c.name}`,
        emoji: "🏢",
      });
    }
    for (const b of businessTypes) {
      list.push({
        kind: "business_type",
        refId: b.value,
        label: `ทุกสาขา ${b.label}`,
        emoji: b.emoji ?? "📁",
      });
    }
    for (const br of branches) {
      list.push({
        kind: "branch",
        refId: br.id,
        label: `${br.code} · ${br.name}`,
        emoji: TYPE_EMOJI[br.businessType] ?? "🏪",
      });
    }
    for (const u of users) {
      list.push({
        kind: "person",
        refId: u.id,
        label: `${u.name} (${u.role})`,
        emoji: "👤",
      });
    }
    return list;
  }, [companies, branches, businessTypes, users]);

  const q = scopeQuery.trim().toLowerCase();
  const filteredScopes = useMemo(() => {
    if (!q) return allScopes.slice(0, 40);
    return allScopes
      .filter((s) => s.label.toLowerCase().includes(q))
      .slice(0, 40);
  }, [q, allScopes]);

  // Group document types by business type for the <optgroup> select below —
  // makes a long list scannable instead of one flat alphabetical dump.
  const groupedDocumentTypes = useMemo(() => {
    const groups = new Map<string, DocumentTypeOption[]>();
    for (const dt of documentTypes) {
      const biz = businessTypes.find((b) => b.value === dt.businessType);
      const groupLabel = biz ? `${biz.emoji} ${biz.label}` : "📁 ทั่วไป";
      const list = groups.get(groupLabel);
      if (list) list.push(dt);
      else groups.set(groupLabel, [dt]);
    }
    return Array.from(groups.entries());
  }, [documentTypes, businessTypes]);

  function addScope(s: Scope) {
    setScopes((prev) => {
      const key = `${s.kind}:${s.refId ?? ""}`;
      if (prev.some((x) => `${x.kind}:${x.refId ?? ""}` === key)) return prev;
      return [...prev, s];
    });
    setScopeQuery("");
    setScopeOpen(false);
  }

  function removeScope(idx: number) {
    setScopes((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Free-text tags — search/filter only (not tied to checklist/type matching).
   * Split on comma/Enter, trim, dedupe case-insensitively, cap length. */
  function addTagFromInput() {
    const raw = tagInput.trim().replace(/^#/, "");
    if (!raw) return;
    setTags((prev) => {
      if (prev.some((t) => t.toLowerCase() === raw.toLowerCase())) return prev;
      return [...prev, raw.slice(0, 40)];
    });
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function cleanFileName(f: File) {
    return f.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
  }

  function fileIdentity(f: File) {
    return `${f.name}::${f.size}::${f.lastModified}`;
  }

  function addFiles(newFiles: File[]) {
    if (newFiles.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map(fileIdentity));
      const toAdd = newFiles.filter((f) => !existing.has(fileIdentity(f)));
      return [...prev, ...toAdd];
    });
    if (!fileNameSyncRef.current && !watch("name")) {
      const cleaned = cleanFileName(newFiles[0]);
      setValue("name", cleaned);
      fileNameSyncRef.current = true;
    }
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) setScopeOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Mount-only: prefill from (1) ?businessType=X passed down from the
  // checklist page link, then (2) this browser's last-used choices for this
  // org — both are DEFAULTS only, the user can still change everything
  // before submitting. businessType (an explicit nav intent) wins over the
  // remembered scope so it isn't silently overridden.
  useEffect(() => {
    if (defaultBusinessType) {
      const match = businessTypes.find((b) => b.value === defaultBusinessType);
      if (match) {
        setScopes([
          {
            kind: "business_type",
            refId: match.value,
            label: `ทุกสาขา ${match.label}`,
            emoji: match.emoji ?? "📁",
          },
        ]);
      }
    }

    try {
      const raw = localStorage.getItem(`${LAST_USED_KEY_PREFIX}${orgId}`);
      if (raw) {
        const saved = JSON.parse(raw) as LastUsedChoice;
        if (saved.lastDocumentTypeId) {
          setValue("documentTypeId", saved.lastDocumentTypeId);
        }
        if (!defaultBusinessType && saved.lastScopes && saved.lastScopes.length > 0) {
          setScopes(saved.lastScopes);
        }
      }
    } catch {
      // localStorage unavailable or corrupt JSON — ignore, just skip prefill
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildOwnerships() {
    return scopes.map((s) => {
      if (s.kind === "group") return { level: "group" as const };
      if (s.kind === "company")
        return { level: "company" as const, companyId: s.refId ?? undefined };
      if (s.kind === "business_type")
        return {
          level: "business_type" as const,
          businessType: s.refId ?? undefined,
        };
      if (s.kind === "branch")
        return { level: "branch" as const, branchId: s.refId ?? undefined };
      return { level: "person" as const, personId: s.refId ?? undefined };
    });
  }

  /** `documentTypes` (listDocumentTypesForUpload) is real DB rows only now —
   * no canonical/not-yet-saved fallback entries can appear in the picker
   * anymore, so the select's value is always a real row id. Always submits
   * as the FK `documentTypeId`; the legacy free-text `documentType` string
   * is never sent from this form. */
  function resolveDocumentTypeFields(values: FormValues) {
    return {
      documentTypeId: values.documentTypeId || undefined,
      documentType: undefined,
    };
  }

  function buildRenewal(values: FormValues) {
    if (!values.expiryDate) return undefined;
    return {
      expiryDate: values.expiryDate,
      alertDays: DEFAULT_ALERT_DAYS,
      ...(values.responsibleUserId
        ? { responsibleUserId: values.responsibleUserId }
        : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    };
  }

  /** Same-browser convenience only (no DB write) — remembers the last-used
   * document type + storage scope for next time. Only called after at least
   * one file actually went through, so a total-failure attempt doesn't
   * overwrite good defaults. */
  function saveLastUsed(values: FormValues) {
    try {
      const toSave: LastUsedChoice = {
        lastDocumentTypeId: values.documentTypeId || undefined,
        lastScopes: scopes,
      };
      localStorage.setItem(
        `${LAST_USED_KEY_PREFIX}${orgId}`,
        JSON.stringify(toSave),
      );
    } catch {
      // localStorage unavailable (private mode, quota) — non-fatal
    }
  }

  /** Clears the success panel and every upload-related field so the admin
   * can upload another batch without leaving the page. */
  function resetForNextUpload() {
    setCompletedDocs([]);
    setFiles([]);
    setFileStatuses([]);
    setUploadMode("multiple");
    setTags([]);
    setTagInput("");
    fileNameSyncRef.current = false;
    reset({
      name: "",
      documentTypeId: "",
      documentGroupId: "",
      expiryDate: "",
      issueDate: "",
      description: "",
      responsibleUserId: "",
      notes: "",
    });
  }

  async function uploadViaProxy(values: FormValues, fileObj: File) {
    const fd = new FormData();
    fd.append("file", fileObj);
    fd.append(
      "metadata",
      JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        ...resolveDocumentTypeFields(values),
        documentGroupId: values.documentGroupId || undefined,
        issueDate: values.issueDate || undefined,
        ownerships: buildOwnerships(),
        tags,
        renewal: buildRenewal(values),
      }),
    );

    const res = await fetch("/api/docuflow/upload-proxy", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        err.error ||
          `อัปโหลดไม่สำเร็จ (HTTP ${res.status})${err.detail ? " · " + err.detail : ""}`,
      );
    }
    const data = (await res.json()) as { documentId: string };
    return data.documentId;
  }

  async function uploadViaPresigned(values: FormValues, fileObj: File) {
    const res = await fetch("/api/docuflow/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: values.name,
        description: values.description || undefined,
        ...resolveDocumentTypeFields(values),
        documentGroupId: values.documentGroupId || undefined,
        issueDate: values.issueDate || undefined,
        filename: fileObj.name,
        mimeType: fileObj.type || "application/octet-stream",
        fileSize: fileObj.size,
        ownerships: buildOwnerships(),
        tags,
        renewal: buildRenewal(values),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "เตรียมอัปโหลดไม่สำเร็จ");
    }
    const { documentId, uploadUrl } = (await res.json()) as {
      documentId: string;
      uploadUrl: string;
    };

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": fileObj.type || "application/octet-stream",
      },
      body: fileObj,
    });
    if (!putRes.ok) {
      const text = await putRes.text().catch(() => "");
      // Try to cleanup the orphan row server-side
      fetch(`/api/docuflow/upload?id=${documentId}`, {
        method: "DELETE",
      }).catch(() => {});
      throw new Error(
        `ส่งไฟล์ไป R2 ไม่สำเร็จ (HTTP ${putRes.status})${text ? " · " + text.slice(0, 120) : ""}`,
      );
    }
    return documentId;
  }

  async function onSubmit(values: FormValues) {
    if (files.length === 0) {
      toast.error("เลือกไฟล์อย่างน้อย 1 ไฟล์");
      return;
    }
    const oversized = files.find((f) => f.size > 500 * 1024 * 1024);
    if (oversized) {
      toast.error(`ไฟล์ "${oversized.name}" ใหญ่เกิน 500 MB`);
      return;
    }
    if (scopes.length === 0) {
      toast.error("ระบุที่เก็บอย่างน้อย 1 อย่าง");
      return;
    }

    // "เอกสารเดียว หลายหน้า/ไฟล์" — combine every selected file into ONE PDF
    // client-side first (pdf-lib), then upload that single combined file
    // through the exact same single-file path used everywhere else. The
    // server-side upload endpoints are completely untouched by this mode.
    if (files.length > 1 && uploadMode === "combined") {
      setUploading(true);
      setCombining(true);
      setFileStatuses(
        files.map((f) => ({ fileName: f.name, status: "uploading" })),
      );

      let combinedFile: File;
      try {
        combinedFile = await combineFilesToPdf(files, values.name);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "รวมไฟล์ไม่สำเร็จ";
        console.error("[upload:combine]", e);
        setCombining(false);
        setUploading(false);
        setFileStatuses(
          files.map((f) => ({ fileName: f.name, status: "error", errorMessage: msg })),
        );
        toast.error(msg);
        return;
      }
      setCombining(false);

      if (combinedFile.size > 500 * 1024 * 1024) {
        setUploading(false);
        setFileStatuses(
          files.map((f) => ({
            fileName: f.name,
            status: "error",
            errorMessage: "ไฟล์รวมใหญ่เกิน 500 MB",
          })),
        );
        toast.error("ไฟล์ที่รวมแล้วใหญ่เกิน 500 MB — ลดจำนวน/ขนาดไฟล์แล้วลองใหม่");
        return;
      }

      try {
        const documentId =
          combinedFile.size <= PROXY_MAX_BYTES
            ? await uploadViaProxy(values, combinedFile)
            : await uploadViaPresigned(values, combinedFile);
        setFileStatuses(
          files.map((f) => ({ fileName: f.name, status: "done", documentId })),
        );
        setUploading(false);
        saveLastUsed(values);
        setCompletedDocs([{ id: documentId, name: values.name }]);
        toast.success(`รวม ${files.length} ไฟล์เป็นเอกสารเดียวและอัปโหลดเสร็จ`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ";
        console.error("[upload:combined]", e);
        setFileStatuses(
          files.map((f) => ({ fileName: f.name, status: "error", errorMessage: msg })),
        );
        setUploading(false);
        toast.error(msg);
      }
      return;
    }

    setUploading(true);
    setFileStatuses(files.map((f) => ({ fileName: f.name, status: "pending" })));

    let successCount = 0;
    const createdDocs: CompletedDoc[] = [];

    // Loop the existing single-file endpoints per file — each file becomes
    // its own Document row via the same uploadViaProxy/uploadViaPresigned
    // calls as before. Multi-file uploads share the storage location,
    // document type, and expiry/renewal metadata entered once in the form;
    // only the document name is derived per-file (from that file's own
    // filename) once there's more than one file, so a batch doesn't create
    // N documents with an identical name.
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setFileStatuses((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "uploading" } : s)),
      );
      const perFileValues: FormValues =
        files.length === 1 ? values : { ...values, name: cleanFileName(f) };
      try {
        const documentId =
          f.size <= PROXY_MAX_BYTES
            ? await uploadViaProxy(perFileValues, f)
            : await uploadViaPresigned(perFileValues, f);
        successCount++;
        createdDocs.push({ id: documentId, name: perFileValues.name });
        setFileStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "done", documentId } : s,
          ),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ";
        console.error("[upload]", e);
        setFileStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i ? { ...s, status: "error", errorMessage: msg } : s,
          ),
        );
      }
    }

    setUploading(false);

    if (successCount > 0) {
      saveLastUsed(values);
    }

    // Only switch to the success panel on a FULL success — on a partial
    // failure we deliberately stay on the form so the per-file list (with
    // its error badges/messages) is still visible; those files that did
    // succeed still get an inline "ตั้งค่าลายเซ็น" link in that list below.
    if (successCount === files.length) {
      setCompletedDocs(createdDocs);
      toast.success(
        files.length === 1 ? "อัปโหลดเสร็จ" : `อัปโหลดเสร็จทั้ง ${files.length} ไฟล์`,
      );
    } else if (successCount > 0) {
      toast.error(`สำเร็จ ${successCount}/${files.length} ไฟล์ — ดูรายละเอียดด้านล่าง`);
    } else {
      toast.error("อัปโหลดไม่สำเร็จเลย — ดูรายละเอียดด้านล่าง");
    }
  }

  const busy = uploading || isPending || combining;
  const hasExpiry = Boolean(expiryWatch);

  // Post-upload success view — replaces the form until the admin either
  // uploads another batch or moves on. Every newly created document (single,
  // combined, or each one of a "หลายเอกสาร" batch) gets a direct link to its
  // signature-placement page here (Task 5) — the signature editor itself
  // already exists at this route, this view just links to it.
  if (completedDocs.length > 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
            <p className="text-base font-bold text-zinc-900">
              {completedDocs.length === 1
                ? "อัปโหลดเสร็จ"
                : `อัปโหลดเสร็จ ${completedDocs.length} เอกสาร`}
            </p>
          </div>
          <ul className="space-y-2">
            {completedDocs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border-2 border-zinc-200 bg-white px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-800">
                    {d.name}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Link
                    href={`/docuflow/documents/${d.id}`}
                    className="text-xs font-medium text-zinc-600 hover:text-zinc-900 hover:underline"
                  >
                    ดูเอกสาร
                  </Link>
                  <Link
                    href={`/docuflow/documents/${d.id}/signatures`}
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-brand-600)] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-brand-700)] transition-colors"
                  >
                    ตั้งค่าตำแหน่งลายเซ็น
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" onClick={resetForNextUpload}>
              อัปโหลดเอกสารอื่นต่อ
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                startTransition(() => {
                  router.push("/docuflow/documents");
                  router.refresh();
                });
              }}
            >
              ไปหน้าเอกสารทั้งหมด
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field label="ไฟล์เอกสาร" required hint="เลือกได้หลายไฟล์พร้อมกัน · ลากมาเพิ่มทีหลังได้อีก">
        <label
          className={cn(
            "df-upload-zone relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors",
            files.length > 0
              ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40"
              : "border-[var(--color-brand-500)] hover:border-[var(--color-brand-700)]",
          )}
          style={{
            padding: "32px 24px",
            minHeight: files.length > 0 ? 140 : 220,
            background: files.length > 0
              ? undefined
              : "linear-gradient(180deg, var(--df-brand-soft), var(--df-bg-warm))",
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("df-drop-hover");
          }}
          onDragLeave={(e) =>
            e.currentTarget.classList.remove("df-drop-hover")
          }
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("df-drop-hover");
            const dropped = Array.from(e.dataTransfer.files ?? []);
            if (dropped.length) addFiles(dropped);
          }}
        >
          <input
            type="file"
            multiple
            className="sr-only"
            accept="application/pdf,image/*,.docx,.doc"
            aria-label={
              files.length > 0
                ? "เลือกไฟล์เพิ่ม"
                : "เลือกไฟล์เอกสาร (PDF · รูป · DOCX สูงสุด 500 MB · เลือกได้หลายไฟล์)"
            }
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              if (selected.length) addFiles(selected);
              e.target.value = "";
            }}
            disabled={busy}
          />
          {files.length > 0 ? (
            <>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: "var(--color-brand-50)",
                  color: "var(--color-brand-700)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <UploadIcon className="size-7" />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-zinc-900">
                  {files.length === 1 ? files[0].name : `${files.length} ไฟล์พร้อมส่ง`}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  {files.length === 1
                    ? `${(files[0].size / 1024 / 1024).toFixed(2)} MB · พร้อมส่ง${files[0].size > PROXY_MAX_BYTES ? " · presigned mode" : ""}`
                    : `${(files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024).toFixed(2)} MB รวม`}
                </p>
                <p className="text-[11px] text-zinc-500 mt-2">
                  คลิกหรือลากมาเพิ่มไฟล์อื่นได้อีก
                </p>
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background: "#fff",
                  boxShadow: "0 8px 24px -8px rgba(30,58,255,0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--color-brand-600)",
                }}
              >
                <UploadIcon className="size-7" />
              </div>
              <div className="text-center">
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: "var(--color-zinc-900, #18181b)",
                    margin: 0,
                  }}
                >
                  ลากไฟล์มาวางตรงนี้
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--color-zinc-500, #71717a)",
                    marginTop: 6,
                    marginBottom: 0,
                  }}
                >
                  หรือคลิกเพื่อเลือกจากเครื่อง · PDF · รูป · DOCX (สูงสุด 500 MB · เลือกได้หลายไฟล์)
                </p>
              </div>
              <span
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  background: "#fff",
                  padding: "6px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--color-brand-600)",
                  border: "1px solid var(--color-brand-200)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ✦ AI Auto-fill เปิดอยู่
              </span>
            </>
          )}
        </label>

        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((f, idx) => {
              const status = fileStatuses[idx];
              return (
                <li
                  key={`${f.name}:${f.size}:${f.lastModified}:${idx}`}
                  className="flex items-center gap-3 rounded-xl border-2 border-zinc-200 bg-white px-3 py-2"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-50 text-zinc-500">
                    <FileText className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-800">
                      {f.name}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      {(f.size / 1024 / 1024).toFixed(2)} MB
                      {status?.errorMessage ? ` · ${status.errorMessage}` : ""}
                    </p>
                  </div>
                  <FileStatusBadge status={status?.status ?? "pending"} />
                  {status?.status === "done" && status.documentId && (
                    <Link
                      href={`/docuflow/documents/${status.documentId}/signatures`}
                      className="text-[11px] font-medium text-[var(--color-brand-600)] hover:underline shrink-0 whitespace-nowrap"
                    >
                      ตั้งค่าลายเซ็น
                    </Link>
                  )}
                  {(!status || status.status === "pending") && (
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="text-zinc-400 hover:text-rose-700 disabled:opacity-40"
                      disabled={busy}
                      aria-label={`ลบ ${f.name}`}
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {files.length > 1 && (
          <div className="mt-3 rounded-xl border-2 border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs font-bold text-zinc-700 mb-2">ไฟล์เหล่านี้คือ</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="radio"
                  name="uploadMode"
                  checked={uploadMode === "multiple"}
                  onChange={() => setUploadMode("multiple")}
                  disabled={busy}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium text-zinc-800">หลายเอกสาร</span>
                  <span className="block text-xs text-zinc-500">
                    แต่ละไฟล์กลายเป็นเอกสารแยกกัน ({files.length} เอกสาร)
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "flex items-start gap-2.5",
                  combineSupported ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                )}
              >
                <input
                  type="radio"
                  name="uploadMode"
                  checked={uploadMode === "combined"}
                  onChange={() => setUploadMode("combined")}
                  disabled={busy || !combineSupported}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="font-medium text-zinc-800">เอกสารเดียว หลายหน้า/ไฟล์</span>
                  <span className="block text-xs text-zinc-500">
                    {combineSupported
                      ? `รวมทุกไฟล์เป็น PDF เดียว ${files.length} หน้า — เช่น สแกนเป็นรูปหลายใบ`
                      : "รองรับเฉพาะ PDF และรูปภาพ JPG/PNG เท่านั้น — เอาไฟล์ประเภทอื่นออกก่อน"}
                  </span>
                </span>
              </label>
            </div>
          </div>
        )}
      </Field>

      <Field
        label="ชื่อเอกสาร"
        required
        error={errors.name?.message}
        htmlFor="name"
        hint={
          isMultiDocMode
            ? `หลายไฟล์ — ระบบตั้งชื่อจากไฟล์แต่ละไฟล์อัตโนมัติ (${files.length} ไฟล์)`
            : files.length > 1
              ? "รวมเป็นเอกสารเดียว — ใช้ชื่อนี้เป็นชื่อเอกสาร"
              : "ระบบดึงจากชื่อไฟล์ให้ — แก้ได้"
        }
      >
        <Input
          id="name"
          {...register("name")}
          invalid={!!errors.name}
          placeholder="เช่น ใบอนุญาตปั๊ม KKN-001"
          disabled={busy || isMultiDocMode}
        />
      </Field>

      <Field
        label="ประเภทเอกสาร"
        optional
        htmlFor="documentTypeId"
        hint={documentTypes.length > 0 ? "ช่วยจัดหมวดและค้นหาเอกสารในอนาคต" : undefined}
      >
        {documentTypes.length > 0 ? (
          <select
            id="documentTypeId"
            {...register("documentTypeId")}
            disabled={busy}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
          >
            <option value="">— ไม่ระบุ —</option>
            {groupedDocumentTypes.map(([groupLabel, opts]) => (
              <optgroup key={groupLabel} label={groupLabel}>
                {opts.map((dt) => (
                  <option key={dt.id ?? dt.name} value={dt.id ?? ""}>
                    {dt.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <div className="rounded-lg border-2 border-dashed border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">
            ยังไม่ได้ตั้งค่าประเภทเอกสาร ·{" "}
            <Link
              href="/docuflow/settings/document-types"
              className="font-medium text-[var(--color-brand-600)] hover:underline"
            >
              ไปตั้งค่า
            </Link>
          </div>
        )}
      </Field>

      <Field
        label="กลุ่มเอกสาร"
        optional
        htmlFor="documentGroupId"
        hint="การจัดกลุ่มอีกมิติหนึ่ง นอกเหนือจากประเภทเอกสาร"
      >
        <select
          id="documentGroupId"
          {...register("documentGroupId")}
          disabled={busy}
          className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
        >
          <option value="">— ไม่ระบุ —</option>
          {documentGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Tag"
        optional
        htmlFor="tagInput"
        hint="ใช้ค้นหา/กรองเอกสารภายหลัง · กด Enter หรือ , เพื่อเพิ่ม"
      >
        <div className="space-y-2">
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] text-xs"
                >
                  #{t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    disabled={busy}
                    className="text-zinc-400 hover:text-zinc-700"
                    aria-label={`ลบ tag ${t}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Input
            id="tagInput"
            value={tagInput}
            disabled={busy}
            placeholder="พิมพ์ tag แล้วกด Enter เช่น ด่วน, ต่ออายุ"
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTagFromInput();
              }
            }}
            onBlur={addTagFromInput}
          />
        </div>
      </Field>

      <Field
        label="เก็บไว้ที่ไหน"
        required
        hint="พิมพ์ค้นหา · เลือกเพิ่มได้ถ้าใช้หลายที่"
      >
        <div className="space-y-2" ref={pickerRef}>
          {scopes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scopes.map((s, i) => (
                <span
                  key={`${s.kind}:${s.refId}:${i}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] text-sm"
                >
                  <span>{s.emoji}</span>
                  <span className="font-medium text-zinc-800">{s.label}</span>
                  <button
                    type="button"
                    onClick={() => removeScope(i)}
                    className="text-zinc-500 hover:text-rose-700"
                    disabled={busy}
                    aria-label={`ลบ ${s.label}`}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <Search className="size-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={scopeQuery}
              onChange={(e) => {
                setScopeQuery(e.target.value);
                setScopeOpen(true);
              }}
              onFocus={() => setScopeOpen(true)}
              placeholder={
                scopes.length === 0
                  ? "พิมพ์ เช่น KKN, ปั๊ม, Pooil, ทั้งกลุ่ม, ชื่อพนักงาน"
                  : "+ เพิ่มที่อื่นด้วย (ถ้าใช้หลายที่)"
              }
              className="pl-10"
              disabled={busy}
            />
            {scopeOpen && filteredScopes.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 rounded-xl border-2 border-zinc-200 bg-white shadow-pop z-20 max-h-72 overflow-y-auto">
                {filteredScopes.map((s) => (
                  <button
                    key={`${s.kind}:${s.refId ?? ""}`}
                    type="button"
                    onClick={() => addScope(s)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-b-0"
                  >
                    <span className="text-base shrink-0">{s.emoji}</span>
                    <span className="flex-1 truncate text-zinc-800">
                      {s.label}
                    </span>
                    <ScopeKindBadge kind={s.kind} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="วันหมดอายุ"
          optional
          htmlFor="expiryDate"
          hint="ไม่มีก็เว้นได้ · ถ้าใส่ระบบจะเตือน 90/30/7 วันก่อน"
        >
          <Input
            id="expiryDate"
            type="date"
            {...register("expiryDate")}
            disabled={busy}
          />
        </Field>

        <Field
          label="วันที่ออกเอกสาร"
          optional
          htmlFor="issueDate"
          hint="ไม่บังคับ · วันที่เอกสารนี้ออกจริง"
        >
          <Input
            id="issueDate"
            type="date"
            {...register("issueDate")}
            disabled={busy}
          />
        </Field>
      </div>

      {/* Advanced section — collapsed by default */}
      <div className="border-2 border-zinc-200 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 transition-colors"
          aria-expanded={advancedOpen}
        >
          <span className="inline-flex items-center gap-2 text-sm font-bold text-zinc-700">
            <Settings2 className="size-4 text-[var(--color-brand-600)]" />
            ตั้งค่าขั้นสูง
            <span className="text-[11px] font-medium text-zinc-500 ml-1">
              คำอธิบาย · ผู้รับผิดชอบ · หมายเหตุ
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-zinc-500 transition-transform",
              advancedOpen && "rotate-180",
            )}
          />
        </button>
        {advancedOpen && (
          <div className="p-4 space-y-4 bg-white">
            <Field
              label="คำอธิบาย"
              optional
              htmlFor="description"
              hint="บอกข้อมูลเพิ่มเติม · เช่น สำหรับยื่นกระทรวงพลังงาน"
            >
              <textarea
                id="description"
                {...register("description")}
                rows={3}
                disabled={busy}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none resize-none"
                placeholder="(ไม่บังคับ)"
              />
            </Field>

            <Field
              label="ผู้รับผิดชอบ"
              optional
              htmlFor="responsibleUserId"
              hint={
                hasExpiry
                  ? "ระบบจะส่ง notification ให้คนนี้ก่อนหมดอายุ"
                  : "ใช้คู่กับวันหมดอายุ · ระบบจะเตือนคนนี้"
              }
            >
              <select
                id="responsibleUserId"
                {...register("responsibleUserId")}
                disabled={busy || !hasExpiry}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white disabled:bg-zinc-50 disabled:text-zinc-400"
              >
                <option value="">— ไม่ระบุ —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="หมายเหตุการต่ออายุ"
              optional
              htmlFor="notes"
              hint={
                hasExpiry
                  ? "บอกขั้นตอนพิเศษ · เช่น ต้องยื่นล่วงหน้า 60 วัน"
                  : "ใช้คู่กับวันหมดอายุ"
              }
            >
              <textarea
                id="notes"
                {...register("notes")}
                rows={2}
                disabled={busy || !hasExpiry}
                className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none resize-none disabled:bg-zinc-50 disabled:text-zinc-400"
                placeholder="(ไม่บังคับ)"
              />
            </Field>
          </div>
        )}
      </div>

      {combining && (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--color-brand-50)] px-3 py-2 text-sm font-medium text-[var(--color-brand-700)]">
          <Loader2 className="size-4 animate-spin" />
          กำลังรวมไฟล์เป็น PDF เดียว…
        </div>
      )}

      <div className="flex items-center gap-2 justify-end pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={busy}
        >
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" loading={busy} size="lg">
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {combining ? "กำลังรวมไฟล์…" : "กำลังอัปโหลด…"}
            </>
          ) : (
            <>
              <UploadIcon className="size-4" />
              {files.length > 1
                ? uploadMode === "combined"
                  ? "รวมและอัปโหลดเป็นเอกสารเดียว"
                  : `อัปโหลด ${files.length} ไฟล์`
                : "อัปโหลดเอกสาร"}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function ScopeKindBadge({ kind }: { kind: ScopeKind }) {
  const map: Record<ScopeKind, { label: string; icon: React.ReactNode }> = {
    group: { label: "กลุ่ม", icon: <Globe2 className="size-3" /> },
    company: { label: "บริษัท", icon: <Building2 className="size-3" /> },
    business_type: { label: "ธุรกิจ", icon: <Layers className="size-3" /> },
    branch: { label: "สาขา", icon: <Store className="size-3" /> },
    person: { label: "บุคคล", icon: <UserCircle className="size-3" /> },
  };
  const { label, icon } = map[kind];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 text-zinc-600 text-[10px] font-bold shrink-0">
      {icon}
      {label}
    </span>
  );
}

function FileStatusBadge({ status }: { status: FileUploadState }) {
  const map: Record<
    FileUploadState,
    { label: string; className: string; icon?: React.ReactNode }
  > = {
    pending: { label: "รอคิว", className: "bg-zinc-100 text-zinc-600" },
    uploading: {
      label: "กำลังอัปโหลด",
      className: "bg-[var(--color-brand-50)] text-[var(--color-brand-700)]",
      icon: <Loader2 className="size-3 animate-spin" />,
    },
    done: {
      label: "สำเร็จ",
      className: "bg-emerald-50 text-emerald-700",
      icon: <CheckCircle2 className="size-3" />,
    },
    error: {
      label: "ผิดพลาด",
      className: "bg-rose-50 text-rose-700",
      icon: <AlertCircle className="size-3" />,
    },
  };
  const { label, className, icon } = map[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold",
        className,
      )}
    >
      {icon}
      {label}
    </span>
  );
}
