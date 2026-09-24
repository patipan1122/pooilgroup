"use client";

// DocumentTypeManager — client CRUD UI for /docuflow/settings/document-types
// ────────────────────────────────────────────────────────────────────
// List + create/edit dialog + deactivate/reactivate + the one explicit
// "นำเข้าจากรายการมาตรฐาน" bulk-import action (POST /api/docuflow/
// document-types/import — the ONLY path that writes canonical-docs.ts
// entries into real rows, always admin-triggered from this button).
//
// Page chrome (list rows) uses the DocuFlow df-* tokens/primitives.
// Form controls (inputs/selects/textareas) use components/ui/* +
// Tailwind zinc classes — mirrors the exact split already established
// in upload-form.tsx (df-tokens for chrome, Tailwind for form fields).
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  EyeOff,
  Eye,
  Import,
  Tag,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DfCard, DfPill } from "@/components/docuflow/df-ui";

export interface DocumentTypeRow {
  id: string;
  name: string;
  category: string | null;
  businessType: string | null;
  companyId: string | null;
  frequency: string | null;
  dangerLevel: string | null;
  regulator: string | null;
  description: string | null;
  isActive: boolean;
}

export interface BizTypeOption {
  value: string;
  label: string;
  canonicalCount: number;
}

export interface CompanyOption {
  id: string;
  name: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  license: "📋 ใบอนุญาต/ต่ออายุ",
  permanent: "📁 เอกสารถาวร",
  form: "📝 แบบฟอร์ม/บันทึก",
  personnel: "🧑‍💼 ใบรับรองบุคลากร",
};

const DANGER_TONE: Record<string, "danger" | "warn" | "brand" | "default"> = {
  critical: "danger",
  high: "warn",
  medium: "brand",
  low: "default",
};

const DANGER_LABEL: Record<string, string> = {
  critical: "วิกฤต",
  high: "สูง",
  medium: "กลาง",
  low: "ต่ำ",
};

interface Props {
  initialDocumentTypes: DocumentTypeRow[];
  businessTypeOptions: BizTypeOption[];
  companyOptions: CompanyOption[];
}

export function DocumentTypeManager({
  initialDocumentTypes,
  businessTypeOptions,
  companyOptions,
}: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<DocumentTypeRow[]>(initialDocumentTypes);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentTypeRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const businessTypeLabel = useMemo(() => {
    const map = new Map(businessTypeOptions.map((b) => [b.value, b.label]));
    return (v: string | null) => (v ? (map.get(v) ?? v) : "ทั้งองค์กร");
  }, [businessTypeOptions]);

  const companyLabel = useMemo(() => {
    const map = new Map(companyOptions.map((c) => [c.id, c.name]));
    return (v: string | null) => (v ? (map.get(v) ?? v) : null);
  }, [companyOptions]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(row: DocumentTypeRow) {
    setEditing(row);
    setFormOpen(true);
  }

  function upsertRow(row: DocumentTypeRow) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      const next = idx >= 0 ? prev.map((r, i) => (i === idx ? row : r)) : [row, ...prev];
      return next.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name, "th");
      });
    });
  }

  async function setActive(row: DocumentTypeRow, isActive: boolean) {
    try {
      if (!isActive) {
        const res = await fetch(`/api/docuflow/document-types/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "ปิดใช้งานไม่สำเร็จ");
        }
      } else {
        const res = await fetch(`/api/docuflow/document-types/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: true }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "เปิดใช้งานไม่สำเร็จ");
        }
      }
      upsertRow({ ...row, isActive });
      toast.success(isActive ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ทำรายการไม่สำเร็จ");
    }
  }

  async function refetchAll() {
    try {
      const res = await fetch("/api/docuflow/document-types");
      if (!res.ok) return;
      const data = (await res.json()) as { documentTypes: DocumentTypeRow[] };
      setRows(
        [...data.documentTypes].sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return a.name.localeCompare(b.name, "th");
        }),
      );
    } catch {
      // best-effort refresh only — router.refresh() below still keeps the
      // server-rendered page itself consistent even if this fetch fails.
    }
  }

  const activeRows = rows.filter((r) => r.isActive);
  const inactiveRows = rows.filter((r) => !r.isActive);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
          <Import className="size-4" />
          นำเข้าจากรายการมาตรฐาน
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          เพิ่มประเภทเอกสาร
        </Button>
      </div>

      {rows.length === 0 ? (
        <DfCard padding={36} style={{ textAlign: "center" }}>
          <Tag size={28} style={{ color: "var(--df-muted)", margin: "0 auto 10px" }} />
          <p style={{ fontSize: 14, color: "var(--df-muted)", marginBottom: 14 }}>
            ยังไม่มีประเภทเอกสารในองค์กรนี้
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              นำเข้าจากรายการมาตรฐาน
            </Button>
            <Button size="sm" onClick={openCreate}>
              สร้างเอง
            </Button>
          </div>
        </DfCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeRows.map((row) => (
            <DocTypeRow
              key={row.id}
              row={row}
              businessTypeLabel={businessTypeLabel}
              companyLabel={companyLabel}
              onEdit={() => openEdit(row)}
              onToggleActive={() => setActive(row, false)}
            />
          ))}

          {inactiveRows.length > 0 && (
            <>
              <p
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--df-muted)",
                  letterSpacing: "0.05em",
                  marginTop: 18,
                  marginBottom: 4,
                }}
              >
                ปิดใช้งานแล้ว · {inactiveRows.length} รายการ
              </p>
              {inactiveRows.map((row) => (
                <DocTypeRow
                  key={row.id}
                  row={row}
                  businessTypeLabel={businessTypeLabel}
                  companyLabel={companyLabel}
                  onEdit={() => openEdit(row)}
                  onToggleActive={() => setActive(row, true)}
                />
              ))}
            </>
          )}
        </div>
      )}

      <DocumentTypeFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        businessTypeOptions={businessTypeOptions}
        companyOptions={companyOptions}
        onSaved={(row) => {
          upsertRow(row);
          setFormOpen(false);
          router.refresh();
        }}
      />

      <ImportCanonicalDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        businessTypeOptions={businessTypeOptions}
        onImported={async () => {
          setImportOpen(false);
          await refetchAll();
          router.refresh();
        }}
      />
    </div>
  );
}

/* ============================================================
   DocTypeRow — one list row
   ============================================================ */

function DocTypeRow({
  row,
  businessTypeLabel,
  companyLabel,
  onEdit,
  onToggleActive,
}: {
  row: DocumentTypeRow;
  businessTypeLabel: (v: string | null) => string;
  companyLabel: (v: string | null) => string | null;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  return (
    <DfCard
      padding={16}
      style={{ opacity: row.isActive ? 1 : 0.6 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--df-ink)" }}>
              {row.name}
            </span>
            {row.dangerLevel && (
              <DfPill tone={DANGER_TONE[row.dangerLevel] ?? "default"} small>
                {DANGER_LABEL[row.dangerLevel] ?? row.dangerLevel}
              </DfPill>
            )}
            {!row.isActive && (
              <DfPill tone="outline" small>
                ปิดใช้งาน
              </DfPill>
            )}
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 6,
              fontSize: 12,
              color: "var(--df-muted)",
            }}
          >
            <span>{businessTypeLabel(row.businessType)}</span>
            {companyLabel(row.companyId) && <span>· 🏢 {companyLabel(row.companyId)}</span>}
            {row.category && <span>· {CATEGORY_LABEL[row.category] ?? row.category}</span>}
            {row.frequency && <span>· ต่ออายุ {row.frequency}</span>}
            {row.regulator && <span>· {row.regulator}</span>}
          </div>
          {row.description && (
            <p style={{ fontSize: 12, color: "var(--df-muted)", marginTop: 6, marginBottom: 0 }}>
              {row.description}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="size-4" />
            แก้ไข
          </Button>
          {row.isActive ? (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  <EyeOff className="size-4" />
                  ปิดใช้งาน
                </Button>
              }
              title="ปิดใช้งานประเภทเอกสารนี้?"
              body={`"${row.name}" จะไม่แสดงในตัวเลือกอัปโหลด/กรองอีกต่อไป — เอกสารที่ผูกไว้แล้วยังอยู่ครบ และกู้คืนได้ภายหลัง`}
              confirmLabel="ปิดใช้งาน"
              onConfirm={onToggleActive}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={onToggleActive}>
              <Eye className="size-4" />
              เปิดใช้งานอีกครั้ง
            </Button>
          )}
        </div>
      </div>
    </DfCard>
  );
}

/* ============================================================
   DocumentTypeFormDialog — create + edit (shared)
   ============================================================ */

const FormSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อประเภทเอกสาร").max(255),
  category: z.string().optional(),
  businessType: z.string().optional(),
  companyId: z.string().optional(),
  dangerLevel: z.string().optional(),
  frequency: z.string().max(64).optional(),
  regulator: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof FormSchema>;

function DocumentTypeFormDialog({
  open,
  onClose,
  editing,
  businessTypeOptions,
  companyOptions,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: DocumentTypeRow | null;
  businessTypeOptions: BizTypeOption[];
  companyOptions: CompanyOption[];
  onSaved: (row: DocumentTypeRow) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Memoized on `editing` (not recreated every render) — react-hook-form's
  // `values` option resets all fields whenever this object's REFERENCE
  // changes, not just when its content differs. An unmemoized literal here
  // would silently wipe whatever the admin just typed on any incidental
  // re-render (e.g. right after a validation error sets `errors`).
  const values = useMemo<FormValues>(
    () => ({
      name: editing?.name ?? "",
      category: editing?.category ?? "",
      businessType: editing?.businessType ?? "",
      companyId: editing?.companyId ?? "",
      dangerLevel: editing?.dangerLevel ?? "",
      frequency: editing?.frequency ?? "",
      regulator: editing?.regulator ?? "",
      description: editing?.description ?? "",
    }),
    [editing],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    values,
  });

  async function onSubmit(values: FormValues) {
    setBusy(true);
    try {
      const payload = {
        name: values.name,
        category: values.category || null,
        businessType: values.businessType || null,
        companyId: values.companyId || null,
        dangerLevel: values.dangerLevel || null,
        frequency: values.frequency || null,
        regulator: values.regulator || null,
        description: values.description || null,
      };
      const url = editing
        ? `/api/docuflow/document-types/${editing.id}`
        : "/api/docuflow/document-types";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกไม่สำเร็จ");
      }
      const data = (await res.json()) as { documentType: DocumentTypeRow };
      toast.success(editing ? "แก้ไขแล้ว" : "สร้างประเภทเอกสารแล้ว");
      onSaved({ ...data.documentType, isActive: data.documentType.isActive ?? true });
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) {
          reset();
          onClose();
        }
      }}
      title={editing ? "แก้ไขประเภทเอกสาร" : "เพิ่มประเภทเอกสาร"}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4 overflow-y-auto">
        <Field label="ชื่อประเภทเอกสาร" required htmlFor="dt-name" error={errors.name?.message}>
          <Input id="dt-name" {...register("name")} disabled={busy} placeholder="เช่น ใบอนุญาตประกอบกิจการ" />
        </Field>

        <Field label="กลุ่มเอกสาร" optional htmlFor="dt-category">
          <select
            id="dt-category"
            {...register("category")}
            disabled={busy}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
          >
            <option value="">— ไม่ระบุ —</option>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ประเภทธุรกิจ" optional htmlFor="dt-biztype" hint="เว้นว่าง = ใช้ได้ทั้งองค์กร">
          <select
            id="dt-biztype"
            {...register("businessType")}
            disabled={busy}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
          >
            <option value="">— ทั้งองค์กร —</option>
            {businessTypeOptions.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="บริษัท" optional htmlFor="dt-company" hint="เว้นว่าง = ใช้ได้ทุกบริษัท">
          <select
            id="dt-company"
            {...register("companyId")}
            disabled={busy}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
          >
            <option value="">— ทุกบริษัท —</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="ความสำคัญ" optional htmlFor="dt-danger">
          <select
            id="dt-danger"
            {...register("dangerLevel")}
            disabled={busy}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
          >
            <option value="">— ไม่ระบุ —</option>
            {Object.entries(DANGER_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="รอบต่ออายุ" optional htmlFor="dt-frequency" hint="เช่น ทุกปี, ทุก 2 ปี, ถาวร">
          <Input id="dt-frequency" {...register("frequency")} disabled={busy} placeholder="เช่น ทุกปี" />
        </Field>

        <Field label="หน่วยงานที่กำกับ" optional htmlFor="dt-regulator">
          <Input id="dt-regulator" {...register("regulator")} disabled={busy} placeholder="เช่น กรมธุรกิจพลังงาน" />
        </Field>

        <Field label="คำอธิบาย" optional htmlFor="dt-description">
          <textarea
            id="dt-description"
            {...register("description")}
            disabled={busy}
            rows={3}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none resize-none"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="submit" loading={busy}>
            {editing ? "บันทึกการแก้ไข" : "สร้างประเภทเอกสาร"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ============================================================
   ImportCanonicalDialog — bulk import from canonical-docs.ts
   ============================================================ */

function ImportCanonicalDialog({
  open,
  onClose,
  businessTypeOptions,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  businessTypeOptions: BizTypeOption[];
  onImported: () => void | Promise<void>;
}) {
  const [businessType, setBusinessType] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = businessTypeOptions.find((b) => b.value === businessType);

  async function handleImport() {
    if (!businessType) {
      toast.error("เลือกประเภทธุรกิจก่อน");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/docuflow/document-types/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessType }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "นำเข้าไม่สำเร็จ");
      }
      const data = (await res.json()) as { created: number; skipped: number };
      toast.success(
        data.skipped > 0
          ? `นำเข้า ${data.created} รายการ (ข้าม ${data.skipped} รายการที่มีอยู่แล้ว)`
          : `นำเข้า ${data.created} รายการเรียบร้อย`,
      );
      setBusinessType("");
      await onImported();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="นำเข้าจากรายการมาตรฐาน"
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-2 rounded-lg bg-[var(--df-brand-soft,#eef1ff)] p-3 text-xs text-zinc-700">
          <Sparkles className="size-4 shrink-0 text-[var(--color-brand-600)]" />
          <span>
            เลือกประเภทธุรกิจ ระบบจะสร้างประเภทเอกสารตามรายการมาตรฐานของอุตสาหกรรมนั้นให้อัตโนมัติ ·
            รายการที่ชื่อซ้ำกับของเดิมจะถูกข้าม ไม่ทับข้อมูลเดิม
          </span>
        </div>

        <Field label="ประเภทธุรกิจ" required htmlFor="import-biztype">
          <select
            id="import-biztype"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            disabled={busy}
            className="w-full rounded-lg border-2 border-zinc-200 px-3 py-2 text-sm focus:border-[var(--color-brand-500)] focus:outline-none bg-white"
          >
            <option value="">— เลือกประเภทธุรกิจ —</option>
            {businessTypeOptions.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label} ({b.canonicalCount} รายการ)
              </option>
            ))}
          </select>
        </Field>

        {selected && (
          <p className="text-xs text-zinc-500">
            จะนำเข้าสูงสุด {selected.canonicalCount} รายการสำหรับ {selected.label}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button type="button" onClick={handleImport} loading={busy} disabled={!businessType}>
            <Import className="size-4" />
            นำเข้า
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
