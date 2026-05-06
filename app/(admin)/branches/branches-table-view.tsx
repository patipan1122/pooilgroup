"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Pencil } from "lucide-react";
import { DataGrid, PasteDialog } from "@/components/ui/data-grid";
import type {
  DataGridBulkAction,
  DataGridColumn,
  DataGridRowAction,
} from "@/components/ui/data-grid";
import { BUSINESS_TYPES } from "@/constants/business-types";

export interface FlatBranch {
  id: string;
  code: string;
  name: string;
  business_type: string;
  company_code: string;
  company_name: string;
  province: string | null;
  region: string | null;
  phone: string | null;
  manager_name: string | null;
  user_count: number;
  is_active: boolean;
  created_at: string;
}

const BUSINESS_OPTIONS = Object.entries(BUSINESS_TYPES).map(([value, cfg]) => ({
  value,
  label: `${cfg.emoji} ${cfg.label}`,
}));

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function BranchesTableView({ branches }: { branches: FlatBranch[] }) {
  const router = useRouter();
  const [pasteText, setPasteText] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const columns: DataGridColumn<FlatBranch>[] = useMemo(
    () => [
      {
        key: "code",
        label: "รหัสสาขา",
        type: "text",
        frozen: true,
        minWidth: 130,
        href: (r) => `/branches/${r.id}`,
        render: (r) => (
          <span className="font-extrabold tabular-num font-display text-zinc-900">
            {r.code}
          </span>
        ),
      },
      {
        key: "name",
        label: "ชื่อสาขา",
        type: "text",
        editable: true,
        minWidth: 220,
        validate: (v) => {
          const s = String(v ?? "").trim();
          if (!s) return "ห้ามว่าง";
          if (s.length > 120) return "ยาวเกิน 120 ตัวอักษร";
          return null;
        },
      },
      {
        key: "business_type",
        label: "ประเภทธุรกิจ",
        type: "select",
        minWidth: 160,
        options: BUSINESS_OPTIONS,
        getValue: (r) => r.business_type,
        format: (r) => BUSINESS_TYPES[r.business_type]?.label ?? r.business_type,
        render: (r) => {
          const cfg = BUSINESS_TYPES[r.business_type];
          return (
            <span className="inline-flex items-center gap-1 text-xs">
              <span>{cfg?.emoji ?? "📋"}</span>
              <span className="font-medium text-zinc-800">
                {cfg?.label ?? r.business_type}
              </span>
            </span>
          );
        },
      },
      {
        key: "company_code",
        label: "บริษัท",
        minWidth: 110,
        render: (r) => (
          <span
            className="text-xs text-zinc-700 tabular-num font-bold"
            title={r.company_name}
          >
            {r.company_code || "—"}
          </span>
        ),
        format: (r) => r.company_code,
      },
      {
        key: "province",
        label: "จังหวัด",
        type: "text",
        editable: true,
        minWidth: 120,
      },
      {
        key: "region",
        label: "ภาค",
        type: "text",
        editable: true,
        minWidth: 100,
      },
      {
        key: "phone",
        label: "เบอร์",
        type: "phone",
        editable: true,
        minWidth: 130,
      },
      {
        key: "manager_name",
        label: "ผู้จัดการสาขา",
        minWidth: 160,
        render: (r) => (
          <span className="text-xs text-zinc-700">
            {r.manager_name || <span className="text-zinc-400">— ยังไม่มี —</span>}
          </span>
        ),
        format: (r) => r.manager_name ?? "",
      },
      {
        key: "user_count",
        label: "คนในสาขา",
        type: "number",
        align: "right",
        minWidth: 80,
        render: (r) => (
          <span className="tabular-num text-xs font-bold text-zinc-700">
            {r.user_count}
          </span>
        ),
        format: (r) => String(r.user_count),
      },
      {
        key: "is_active",
        label: "สถานะ",
        align: "center",
        minWidth: 80,
        getValue: (r) => r.is_active,
        render: (r) => (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${
              r.is_active
                ? "bg-[var(--color-leaf-50)] text-[var(--color-leaf-800)] border-[var(--color-leaf-200)]"
                : "bg-zinc-100 text-zinc-600 border-zinc-300"
            }`}
          >
            {r.is_active ? "เปิด" : "ปิด"}
          </span>
        ),
        format: (r) => (r.is_active ? "เปิด" : "ปิด"),
      },
      {
        key: "created_at",
        label: "สร้าง",
        minWidth: 110,
        getValue: (r) => new Date(r.created_at).getTime(),
        render: (r) => (
          <span className="text-xs text-zinc-500 tabular-num">
            {formatDate(r.created_at)}
          </span>
        ),
        format: (r) => formatDate(r.created_at),
      },
    ],
    [],
  );

  const onCellEdit = async (rowId: string, key: string, newValue: unknown) => {
    const body: Record<string, unknown> = {};
    if (key === "name") body.name = String(newValue ?? "").trim();
    else if (key === "province")
      body.province = String(newValue ?? "").trim() || null;
    else if (key === "region")
      body.region = String(newValue ?? "").trim() || null;
    else if (key === "phone")
      body.phone = String(newValue ?? "").trim() || null;
    else return;

    const res = await fetch(`/api/admin/branches/${rowId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error || "บันทึกไม่สำเร็จ");
      return;
    }
    toast.success("บันทึกแล้ว");
    startTransition(() => router.refresh());
  };

  const handlePasteCommit = async (diff: {
    inserts: Record<string, string>[];
    updates: Array<{
      id: string;
      before: FlatBranch;
      changes: Record<string, string>;
    }>;
  }) => {
    let insertedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    if (diff.inserts.length > 0) {
      const rows = diff.inserts
        .map((rec) => ({
          code: (rec.code ?? "").trim().toUpperCase(),
          name: (rec.name ?? "").trim(),
          businessType: (rec.business_type ?? "").trim(),
          province: (rec.province ?? "").trim() || undefined,
          region: (rec.region ?? "").trim() || undefined,
          phone: (rec.phone ?? "").trim() || undefined,
          companyCode: (rec.company_code ?? "").trim().toUpperCase() || undefined,
        }))
        .filter((r) => r.code && r.name);

      if (rows.length > 0) {
        const res = await fetch("/api/admin/branches/bulk-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) insertedCount = rows.length;
        else {
          toast.error(json.error || "เพิ่มไม่สำเร็จ");
          failedCount += rows.length;
        }
      }
    }

    if (diff.updates.length > 0) {
      const results = await Promise.allSettled(
        diff.updates.map((u) => {
          const body: Record<string, unknown> = {};
          if (u.changes.name !== undefined) body.name = u.changes.name;
          if (u.changes.province !== undefined)
            body.province = u.changes.province || null;
          if (u.changes.region !== undefined)
            body.region = u.changes.region || null;
          if (u.changes.phone !== undefined)
            body.phone = u.changes.phone || null;
          return fetch(`/api/admin/branches/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then(async (res) => {
            if (!res.ok) throw new Error("update failed");
            return res;
          });
        }),
      );
      updatedCount = results.filter((r) => r.status === "fulfilled").length;
      failedCount += results.filter((r) => r.status === "rejected").length;
    }

    const parts: string[] = [];
    if (insertedCount > 0) parts.push(`เพิ่ม ${insertedCount} สาขา`);
    if (updatedCount > 0) parts.push(`แก้ ${updatedCount} สาขา`);
    if (failedCount > 0) parts.push(`ล้มเหลว ${failedCount}`);
    toast[failedCount > 0 ? "error" : "success"](
      parts.length > 0 ? parts.join(" · ") : "ไม่มีอะไรเปลี่ยน",
    );
    router.refresh();
  };

  const bulkActions: DataGridBulkAction<FlatBranch>[] = [
    {
      id: "deactivate",
      label: "ปิดสาขา",
      icon: <Lock className="size-3.5" />,
      danger: true,
      confirm: (n) => `ปิด ${n} สาขา? (ปิดแบบ soft-delete สามารถเปิดกลับได้)`,
      run: async (rows) => {
        const results = await Promise.allSettled(
          rows.map((r) =>
            fetch(`/api/admin/branches/${r.id}`, { method: "DELETE" }).then(
              async (res) => {
                if (!res.ok) throw new Error("deactivate failed");
              },
            ),
          ),
        );
        const ok = results.filter((r) => r.status === "fulfilled").length;
        const fail = results.length - ok;
        toast[fail > 0 ? "error" : "success"](
          fail > 0
            ? `ปิดสำเร็จ ${ok} สาขา · ล้มเหลว ${fail}`
            : `ปิด ${ok} สาขาสำเร็จ`,
        );
        setSelectedIds(new Set());
        router.refresh();
      },
    },
  ];

  const rowActions: DataGridRowAction<FlatBranch>[] = [
    {
      id: "edit",
      label: "แก้ไข",
      icon: <Pencil className="size-3.5" />,
      run: (row) => router.push(`/branches/${row.id}/edit`),
    },
  ];

  return (
    <>
      <DataGrid<FlatBranch>
        rows={branches}
        columns={columns}
        rowHref={(r) => `/branches/${r.id}`}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onCellEdit={onCellEdit}
        onPaste={(text) => setPasteText(text)}
        bulkActions={bulkActions}
        rowActions={rowActions}
        persistKey="admin-branches-table"
        maxHeight={650}
      />

      <PasteDialog<FlatBranch>
        open={pasteText !== null}
        onClose={() => setPasteText(null)}
        initialText={pasteText ?? ""}
        columns={columns}
        existingRows={branches}
        matchKey="code"
        onConfirm={handlePasteCommit}
        title="วางข้อมูลสาขาจาก Excel / Sheets"
      />
    </>
  );
}
