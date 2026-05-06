"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, LogOut, Mail, Unlock } from "lucide-react";
import { DataGrid, PasteDialog } from "@/components/ui/data-grid";
import type {
  DataGridBulkAction,
  DataGridColumn,
  DataGridRowAction,
} from "@/components/ui/data-grid";
import { ROLE_OPTIONS, roleLabel, roleColor } from "@/lib/constants/roles";

export interface FlatUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  branchCodes: string;
  status: "active" | "pending" | "inactive";
  has_line: boolean;
  has_telegram: boolean;
  last_login_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<
  FlatUser["status"],
  { label: string; className: string }
> = {
  active: {
    label: "พร้อมใช้งาน",
    className:
      "bg-[var(--color-leaf-50)] text-[var(--color-leaf-800)] border-[var(--color-leaf-200)]",
  },
  pending: {
    label: "รอ activate",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  inactive: {
    label: "ปิดบัญชี",
    className: "bg-zinc-100 text-zinc-600 border-zinc-300",
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "เพิ่งเข้า";
  if (min < 60) return `${min} น.`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} ชม.`;
  const d = Math.floor(hr / 24);
  return `${d} วัน`;
}

export function UsersTableView({ users }: { users: FlatUser[] }) {
  const router = useRouter();
  const [pasteText, setPasteText] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const columns: DataGridColumn<FlatUser>[] = useMemo(
    () => [
      {
        key: "name",
        label: "ชื่อ",
        type: "text",
        editable: true,
        frozen: true,
        minWidth: 180,
        href: (r) => `/users/${r.id}`,
        validate: (v) => {
          const s = String(v ?? "").trim();
          if (!s) return "ห้ามว่าง";
          if (s.length > 100) return "ยาวเกิน 100 ตัวอักษร";
          return null;
        },
      },
      {
        key: "email",
        label: "อีเมล",
        type: "email",
        minWidth: 200,
        editable: true,
        validate: (v) => {
          const s = String(v ?? "").trim();
          if (!s) return null;
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return "รูปแบบอีเมลไม่ถูก";
          return null;
        },
      },
      {
        key: "phone",
        label: "เบอร์",
        type: "phone",
        minWidth: 130,
        editable: true,
      },
      {
        key: "role",
        label: "ตำแหน่ง",
        type: "select",
        minWidth: 120,
        editable: true,
        options: ROLE_OPTIONS,
        getValue: (r) => r.role,
        format: (r) => roleLabel(r.role),
        render: (r) => (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${roleColor(r.role)}`}
          >
            {roleLabel(r.role)}
          </span>
        ),
      },
      {
        key: "branchCodes",
        label: "สาขา",
        minWidth: 180,
        getValue: (r) => r.branchCodes,
        render: (r) => (
          <span className="text-xs text-zinc-700 tabular-num">
            {r.branchCodes || (
              <span className="text-zinc-400">— ไม่ผูก —</span>
            )}
          </span>
        ),
      },
      {
        key: "status",
        label: "สถานะ",
        type: "badge",
        minWidth: 110,
        getValue: (r) => r.status,
        render: (r) => {
          const s = STATUS_LABEL[r.status];
          return (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${s.className}`}
            >
              {s.label}
            </span>
          );
        },
        format: (r) => STATUS_LABEL[r.status].label,
      },
      {
        key: "has_line",
        label: "LINE",
        align: "center",
        minWidth: 60,
        getValue: (r) => r.has_line,
        render: (r) => (
          <span
            className={`inline-block size-2 rounded-full ${
              r.has_line ? "bg-[var(--color-leaf-500)]" : "bg-zinc-200"
            }`}
            title={r.has_line ? "ผูกแล้ว" : "ยังไม่ผูก"}
          />
        ),
        format: (r) => (r.has_line ? "ผูกแล้ว" : "ยังไม่ผูก"),
      },
      {
        key: "has_telegram",
        label: "TELEGRAM",
        align: "center",
        minWidth: 60,
        getValue: (r) => r.has_telegram,
        render: (r) => (
          <span
            className={`inline-block size-2 rounded-full ${
              r.has_telegram ? "bg-[var(--color-leaf-500)]" : "bg-zinc-200"
            }`}
            title={r.has_telegram ? "ผูกแล้ว" : "ยังไม่ผูก"}
          />
        ),
        format: (r) => (r.has_telegram ? "ผูกแล้ว" : "ยังไม่ผูก"),
      },
      {
        key: "last_login_at",
        label: "LOGIN ล่าสุด",
        minWidth: 110,
        getValue: (r) =>
          r.last_login_at ? new Date(r.last_login_at).getTime() : 0,
        render: (r) => (
          <span className="text-xs text-zinc-600 tabular-num">
            {timeAgo(r.last_login_at)}
          </span>
        ),
        format: (r) => formatDate(r.last_login_at),
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
    else if (key === "phone") body.phone = String(newValue ?? "").trim() || null;
    else if (key === "email") body.email = String(newValue ?? "").trim() || null;
    else if (key === "role") body.role = newValue;
    else return;

    const res = await fetch(`/api/admin/users/${rowId}`, {
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
      before: FlatUser;
      changes: Record<string, string>;
    }>;
  }) => {
    let insertedCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    if (diff.inserts.length > 0) {
      const rows = diff.inserts
        .map((rec) => ({
          name: (rec.name ?? "").trim(),
          email: (rec.email ?? "").trim() || undefined,
          phone: (rec.phone ?? "").trim() || undefined,
          role: ((rec.role ?? "staff").trim() || "staff") as
            | "super_admin"
            | "org_admin"
            | "branch_manager"
            | "staff"
            | "driver"
            | "viewer",
          branchCodes: (rec.branchCodes ?? "")
            .split(/[,;|]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }))
        .filter((r) => r.name);

      if (rows.length > 0) {
        const res = await fetch("/api/admin/users/bulk-import", {
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
          if (u.changes.email !== undefined)
            body.email = u.changes.email || null;
          if (u.changes.phone !== undefined)
            body.phone = u.changes.phone || null;
          if (u.changes.role !== undefined) body.role = u.changes.role;
          return fetch(`/api/admin/users/${u.id}`, {
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
    if (insertedCount > 0) parts.push(`เพิ่ม ${insertedCount} คน`);
    if (updatedCount > 0) parts.push(`แก้ ${updatedCount} คน`);
    if (failedCount > 0) parts.push(`ล้มเหลว ${failedCount}`);
    toast[failedCount > 0 ? "error" : "success"](
      parts.length > 0 ? parts.join(" · ") : "ไม่มีอะไรเปลี่ยน",
    );
    router.refresh();
  };

  const callBulk = async (
    action: "lock" | "unlock" | "force_logout" | "resend_invite",
    rows: FlatUser[],
    label: string,
  ) => {
    const res = await fetch("/api/admin/users/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: rows.map((r) => r.id), action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || "ดำเนินการไม่สำเร็จ");
      return;
    }
    toast.success(`${label}สำเร็จ ${json.processed} คน`);
    setSelectedIds(new Set());
    router.refresh();
  };

  const bulkActions: DataGridBulkAction<FlatUser>[] = [
    {
      id: "resend",
      label: "ส่งลิงก์ใหม่",
      icon: <Mail className="size-3.5" />,
      run: (rows) => callBulk("resend_invite", rows, "ส่งลิงก์เชิญ"),
    },
    {
      id: "force_logout",
      label: "Force Logout",
      icon: <LogOut className="size-3.5" />,
      run: (rows) => callBulk("force_logout", rows, "Force logout "),
    },
    {
      id: "unlock",
      label: "เปิดบัญชี",
      icon: <Unlock className="size-3.5" />,
      run: (rows) => callBulk("unlock", rows, "เปิดบัญชี"),
    },
    {
      id: "lock",
      label: "ปิดบัญชี",
      icon: <Lock className="size-3.5" />,
      danger: true,
      confirm: (n) => `ปิดบัญชี ${n} คน?`,
      run: (rows) => callBulk("lock", rows, "ปิดบัญชี"),
    },
  ];

  const rowActions: DataGridRowAction<FlatUser>[] = [
    {
      id: "view",
      label: "ดูโปรไฟล์ + audit",
      run: (row) => router.push(`/users/${row.id}`),
    },
  ];

  return (
    <>
      <DataGrid<FlatUser>
        rows={users}
        columns={columns}
        rowHref={(r) => `/users/${r.id}`}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onCellEdit={onCellEdit}
        onPaste={(text) => setPasteText(text)}
        bulkActions={bulkActions}
        rowActions={rowActions}
        persistKey="admin-users-table"
        maxHeight={600}
      />

      <PasteDialog<FlatUser>
        open={pasteText !== null}
        onClose={() => setPasteText(null)}
        initialText={pasteText ?? ""}
        columns={columns}
        existingRows={users}
        matchKey="email"
        onConfirm={handlePasteCommit}
        title="วางผู้ใช้จาก Excel / Sheets"
      />
    </>
  );
}
