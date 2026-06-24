"use client";

// จัดการโกดัง (interactive) — ฟอร์มสร้างคลัง + แต่ละแถวแก้ชื่อ/ตั้งเริ่มต้น/เปิด-ปิด
// เรียก server actions ผ่าน useTransition · โชว์ error เป็นข้อความ inline

import { useState, useTransition } from "react";
import { Plus, Pencil, Star, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import {
  createWarehouse,
  renameWarehouse,
  setDefaultWarehouse,
  toggleWarehouseActive,
  type ActionResult,
} from "@/lib/dc/warehouse-admin-actions";

export type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  isActive: boolean;
  isDefault: boolean;
};

export function WarehouseManager({ warehouses }: { warehouses: WarehouseRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── ฟอร์มสร้างคลังใหม่ ──
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");

  function run(fn: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
      else onOk?.();
    });
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setError("กรุณากรอกชื่อคลัง");
      return;
    }
    run(
      () => createWarehouse({ name, location: newLocation.trim() || undefined }),
      () => {
        setNewName("");
        setNewLocation("");
      },
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* สร้างคลังใหม่ */}
      <div className="dc-card space-y-3">
        <div className="font-display font-semibold text-zinc-900">＋ สร้างคลัง</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              ชื่อคลัง
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="เช่น คลังกลางลาดกระบัง"
              disabled={pending}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700">
              ที่ตั้ง (ไม่บังคับ)
            </label>
            <Input
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="เช่น อ.บางพลี จ.สมุทรปราการ"
              disabled={pending}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleCreate} loading={pending} disabled={pending}>
            <Plus className="size-4" /> สร้างคลัง
          </Button>
        </div>
      </div>

      {/* รายการคลัง */}
      {warehouses.length === 0 ? (
        <EmptyState
          title="ยังไม่มีคลัง"
          description="สร้างคลังแรกด้านบน — คลังแรกจะถูกตั้งเป็นค่าเริ่มต้นให้อัตโนมัติ"
        />
      ) : (
        <div className="space-y-3">
          {warehouses.map((w) => (
            <WarehouseRowCard
              key={w.id}
              row={w}
              pending={pending}
              isEditing={editingId === w.id}
              onEdit={() => {
                setError(null);
                setEditingId(w.id);
              }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={(name, location) =>
                run(
                  () => renameWarehouse(w.id, { name, location }),
                  () => setEditingId(null),
                )
              }
              onSetDefault={() => run(() => setDefaultWarehouse(w.id))}
              onToggleActive={() =>
                run(() => toggleWarehouseActive(w.id, !w.isActive))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function WarehouseRowCard({
  row,
  pending,
  isEditing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onSetDefault,
  onToggleActive,
}: {
  row: WarehouseRow;
  pending: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (name: string, location?: string) => void;
  onSetDefault: () => void;
  onToggleActive: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [location, setLocation] = useState(row.location ?? "");

  if (isEditing) {
    return (
      <div className="dc-card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อคลัง"
            disabled={pending}
          />
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="ที่ตั้ง (ไม่บังคับ)"
            disabled={pending}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancelEdit}
            disabled={pending}
            size="sm"
          >
            <X className="size-4" /> ยกเลิก
          </Button>
          <Button
            onClick={() =>
              onSaveEdit(name.trim(), location.trim() || undefined)
            }
            loading={pending}
            disabled={pending || !name.trim()}
            size="sm"
          >
            <Check className="size-4" /> บันทึก
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="dc-card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display font-semibold text-zinc-900">
            {row.name}
          </span>
          {row.isDefault && (
            <StatusPill tone="brand" dot>
              คลังเริ่มต้น
            </StatusPill>
          )}
          {row.isActive ? (
            <StatusPill tone="success">เปิดใช้งาน</StatusPill>
          ) : (
            <StatusPill tone="neutral">ปิดใช้งาน</StatusPill>
          )}
        </div>
        <div className="mt-1 text-sm text-zinc-500">
          <span className="font-mono">{row.code}</span>
          {row.location ? ` · ${row.location}` : ""}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit} disabled={pending}>
          <Pencil className="size-4" /> แก้ไข
        </Button>
        {!row.isDefault && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSetDefault}
            disabled={pending || !row.isActive}
          >
            <Star className="size-4" /> ตั้งเป็นเริ่มต้น
          </Button>
        )}
        {row.isActive ? (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="sm" disabled={pending}>
                ปิดใช้งาน
              </Button>
            }
            title="ปิดใช้งานคลัง"
            body={`ปิดใช้งานคลัง "${row.name}"? พนักงานจะไม่เห็นคลังนี้ในหน้าคลัง`}
            confirmLabel="ปิดใช้งาน"
            onConfirm={onToggleActive}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleActive}
            disabled={pending}
          >
            เปิดใช้งาน
          </Button>
        )}
      </div>
    </div>
  );
}
