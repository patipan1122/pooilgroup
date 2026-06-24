"use client";

// เมทริกซ์สิทธิ์ (interactive) — เลือกพนักงาน → ผูกเข้าคลัง พร้อมตำแหน่ง (FLOOR/MANAGER)
// เปลี่ยนตำแหน่ง / ปลดสิทธิ์ ได้ในตัว · เรียก server actions ผ่าน useTransition

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { DcWarehouseRole } from "@/lib/generated/prisma/enums";
import {
  assignWarehouseUser,
  removeWarehouseUser,
  setWarehouseUserRole,
  type ActionResult,
} from "@/lib/dc/warehouse-admin-actions";

export type OrgUser = {
  id: string;
  name: string;
  email: string | null;
  role: string;
};

export type WarehouseLite = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
};

export type Assignment = {
  warehouseId: string;
  userId: string;
  role: DcWarehouseRole;
};

const ROLE_LABEL: Record<DcWarehouseRole, string> = {
  [DcWarehouseRole.FLOOR]: "พนักงานคลัง",
  [DcWarehouseRole.MANAGER]: "ผู้จัดการคลัง",
};

export function PermissionMatrix({
  warehouses,
  users,
  assignments,
}: {
  warehouses: WarehouseLite[];
  users: OrgUser[];
  assignments: Assignment[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ฟอร์มผูกพนักงานใหม่
  const [selUser, setSelUser] = useState("");
  const [selWarehouse, setSelWarehouse] = useState(warehouses[0]?.id ?? "");
  const [selRole, setSelRole] = useState<DcWarehouseRole>(DcWarehouseRole.FLOOR);

  const userById = useMemo(() => {
    const m = new Map<string, OrgUser>();
    for (const u of users) m.set(u.id, u);
    return m;
  }, [users]);

  // จัดกลุ่มการผูกตามคลัง (เพื่อแสดงผล)
  const byWarehouse = useMemo(() => {
    const m = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const arr = m.get(a.warehouseId) ?? [];
      arr.push(a);
      m.set(a.warehouseId, arr);
    }
    return m;
  }, [assignments]);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
    });
  }

  function handleAssign() {
    if (!selUser) {
      setError("กรุณาเลือกพนักงาน");
      return;
    }
    if (!selWarehouse) {
      setError("กรุณาเลือกคลัง");
      return;
    }
    run(() =>
      assignWarehouseUser({
        warehouseId: selWarehouse,
        userId: selUser,
        role: selRole,
      }),
    );
    setSelUser("");
  }

  const selectCls =
    "h-12 w-full rounded-xl border border-zinc-200 bg-white px-3 text-base text-zinc-900 outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] disabled:bg-zinc-50";

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ผูกพนักงานใหม่ */}
      <div className="dc-card space-y-3">
        <div className="font-display font-semibold text-zinc-900">
          ＋ ผูกพนักงานเข้าคลัง
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              พนักงาน
            </label>
            <select
              className={selectCls}
              value={selUser}
              onChange={(e) => setSelUser(e.target.value)}
              disabled={pending}
            >
              <option value="">— เลือกพนักงาน —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email || u.id}
                  {u.email ? ` (${u.email})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              คลัง
            </label>
            <select
              className={selectCls}
              value={selWarehouse}
              onChange={(e) => setSelWarehouse(e.target.value)}
              disabled={pending}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.isActive ? "" : " (ปิดใช้งาน)"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              ตำแหน่ง
            </label>
            <select
              className={selectCls}
              value={selRole}
              onChange={(e) => setSelRole(e.target.value as DcWarehouseRole)}
              disabled={pending}
            >
              <option value={DcWarehouseRole.FLOOR}>
                {ROLE_LABEL[DcWarehouseRole.FLOOR]}
              </option>
              <option value={DcWarehouseRole.MANAGER}>
                {ROLE_LABEL[DcWarehouseRole.MANAGER]}
              </option>
            </select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleAssign}
              loading={pending}
              disabled={pending || warehouses.length === 0}
              fullWidth
            >
              <Plus className="size-4" /> ผูก
            </Button>
          </div>
        </div>
      </div>

      {/* รายการคลัง + พนักงานที่ผูก */}
      {warehouses.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="ยังไม่มีคลัง"
          description="สร้างคลังก่อนที่หน้า “โกดัง” แล้วจึงผูกพนักงานเข้าคลังได้"
        />
      ) : (
        <div className="space-y-3">
          {warehouses.map((w) => {
            const rows = byWarehouse.get(w.id) ?? [];
            return (
              <div key={w.id} className="dc-card space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-semibold text-zinc-900">
                    {w.name}
                  </span>
                  <span className="font-mono text-sm text-zinc-500">{w.code}</span>
                  {!w.isActive && (
                    <StatusPill tone="neutral">ปิดใช้งาน</StatusPill>
                  )}
                  <span className="ml-auto text-sm text-zinc-500">
                    {rows.length === 0
                      ? "ยังไม่ผูกใคร (ทุกคนเห็นได้)"
                      : `ผูก ${rows.length} คน`}
                  </span>
                </div>

                {rows.length > 0 && (
                  <ul className="divide-y divide-zinc-100">
                    {rows.map((a) => {
                      const u = userById.get(a.userId);
                      return (
                        <li
                          key={a.userId}
                          className="flex flex-wrap items-center justify-between gap-3 py-2"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-zinc-900">
                              {u?.name || u?.email || a.userId}
                            </div>
                            {u?.email && (
                              <div className="text-sm text-zinc-500">
                                {u.email}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <select
                              className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-[var(--color-brand-500)] disabled:bg-zinc-50"
                              value={a.role}
                              onChange={(e) =>
                                run(() =>
                                  setWarehouseUserRole({
                                    warehouseId: w.id,
                                    userId: a.userId,
                                    role: e.target.value as DcWarehouseRole,
                                  }),
                                )
                              }
                              disabled={pending}
                            >
                              <option value={DcWarehouseRole.FLOOR}>
                                {ROLE_LABEL[DcWarehouseRole.FLOOR]}
                              </option>
                              <option value={DcWarehouseRole.MANAGER}>
                                {ROLE_LABEL[DcWarehouseRole.MANAGER]}
                              </option>
                            </select>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                run(() =>
                                  removeWarehouseUser({
                                    warehouseId: w.id,
                                    userId: a.userId,
                                  }),
                                )
                              }
                              disabled={pending}
                              aria-label="ปลดสิทธิ์"
                            >
                              <Trash2 className="size-4" /> ปลด
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
