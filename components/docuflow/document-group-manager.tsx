"use client";

// DocumentGroupManager — client CRUD UI for /docuflow/settings/document-groups
// ────────────────────────────────────────────────────────────────────
// Parallel component to document-type-manager.tsx but simpler: DocumentGroup
// only has `name` + `description` (no category/businessType/frequency/
// dangerLevel/regulator/canonicalKey) and has NO canonical-import feature —
// it's a freely-defined, independent taxonomy, not derived from any
// standard list. So: list + create/edit dialog + deactivate/reactivate
// only, no import button/dialog.
//
// Page chrome (list rows) uses the DocuFlow df-* tokens/primitives.
// Form controls (inputs/textareas) use components/ui/* + Tailwind zinc
// classes — mirrors the exact split already established in
// document-type-manager.tsx.
// ────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, EyeOff, Eye, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DfCard, DfPill } from "@/components/docuflow/df-ui";

export interface DocumentGroupRow {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

interface Props {
  initialDocumentGroups: DocumentGroupRow[];
}

export function DocumentGroupManager({ initialDocumentGroups }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState<DocumentGroupRow[]>(initialDocumentGroups);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentGroupRow | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(row: DocumentGroupRow) {
    setEditing(row);
    setFormOpen(true);
  }

  function upsertRow(row: DocumentGroupRow) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === row.id);
      const next = idx >= 0 ? prev.map((r, i) => (i === idx ? row : r)) : [row, ...prev];
      return next.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name, "th");
      });
    });
  }

  async function setActive(row: DocumentGroupRow, isActive: boolean) {
    try {
      if (!isActive) {
        const res = await fetch(`/api/docuflow/document-groups/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "ปิดใช้งานไม่สำเร็จ");
        }
      } else {
        const res = await fetch(`/api/docuflow/document-groups/${row.id}`, {
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
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" />
          เพิ่มกลุ่มเอกสาร
        </Button>
      </div>

      {rows.length === 0 ? (
        <DfCard padding={36} style={{ textAlign: "center" }}>
          <FolderKanban size={28} style={{ color: "var(--df-muted)", margin: "0 auto 10px" }} />
          <p style={{ fontSize: 14, color: "var(--df-muted)", marginBottom: 14 }}>
            ยังไม่มีกลุ่มเอกสารในองค์กรนี้
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <Button size="sm" onClick={openCreate}>
              สร้างกลุ่มเอกสาร
            </Button>
          </div>
        </DfCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeRows.map((row) => (
            <DocGroupRow
              key={row.id}
              row={row}
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
                <DocGroupRow
                  key={row.id}
                  row={row}
                  onEdit={() => openEdit(row)}
                  onToggleActive={() => setActive(row, true)}
                />
              ))}
            </>
          )}
        </div>
      )}

      <DocumentGroupFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        onSaved={(row) => {
          upsertRow(row);
          setFormOpen(false);
          router.refresh();
        }}
      />
    </div>
  );
}

/* ============================================================
   DocGroupRow — one list row
   ============================================================ */

function DocGroupRow({
  row,
  onEdit,
  onToggleActive,
}: {
  row: DocumentGroupRow;
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
            {!row.isActive && (
              <DfPill tone="outline" small>
                ปิดใช้งาน
              </DfPill>
            )}
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
              title="ปิดใช้งานกลุ่มเอกสารนี้?"
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
   DocumentGroupFormDialog — create + edit (shared)
   ============================================================ */

const FormSchema = z.object({
  name: z.string().min(1, "ใส่ชื่อกลุ่มเอกสาร").max(255),
  description: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof FormSchema>;

function DocumentGroupFormDialog({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing: DocumentGroupRow | null;
  onSaved: (row: DocumentGroupRow) => void;
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
        description: values.description || null,
      };
      const url = editing
        ? `/api/docuflow/document-groups/${editing.id}`
        : "/api/docuflow/document-groups";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "บันทึกไม่สำเร็จ");
      }
      const data = (await res.json()) as { documentGroup: DocumentGroupRow };
      toast.success(editing ? "แก้ไขแล้ว" : "สร้างกลุ่มเอกสารแล้ว");
      onSaved({ ...data.documentGroup, isActive: data.documentGroup.isActive ?? true });
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
      title={editing ? "แก้ไขกลุ่มเอกสาร" : "เพิ่มกลุ่มเอกสาร"}
    >
      <form onSubmit={handleSubmit(onSubmit)} className="p-5 space-y-4 overflow-y-auto">
        <Field label="ชื่อกลุ่มเอกสาร" required htmlFor="dg-name" error={errors.name?.message}>
          <Input id="dg-name" {...register("name")} disabled={busy} placeholder="เช่น เอกสารสาขา A" />
        </Field>

        <Field label="คำอธิบาย" optional htmlFor="dg-description">
          <textarea
            id="dg-description"
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
            {editing ? "บันทึกการแก้ไข" : "สร้างกลุ่มเอกสาร"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
