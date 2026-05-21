"use client";

// Inline-editable table of bank accounts
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/chairops/ui/badge";
import { Button } from "@/components/chairops/ui/button";
import { Input } from "@/components/chairops/ui/input";
import { deactivateAccount, updateAccount } from "./actions";

interface Item {
  id: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  branchId: string | null;
  branchName: string | null;
  notes: string | null;
  isActive: boolean;
}

export function AccountsTable({
  items,
  branches,
}: {
  items: Item[];
  branches: { id: string; name: string }[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">ยังไม่มีบัญชี · เพิ่มทางด้านขวา</p>
    );
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        setEditingId(null);
      } else {
        toast.error(r.error ?? "ทำงานไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 font-medium">ธนาคาร</th>
            <th className="py-2 font-medium">เลขบัญชี</th>
            <th className="py-2 font-medium">ชื่อบัญชี</th>
            <th className="py-2 font-medium">สาขา</th>
            <th className="py-2 font-medium">สถานะ</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) =>
            editingId === a.id ? (
              <tr key={a.id} className="border-t border-border bg-muted/30">
                <td colSpan={6} className="p-3">
                  <form
                    action={(fd) =>
                      run(() => updateAccount(fd), "บันทึกการแก้ไขแล้ว")
                    }
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <input type="hidden" name="id" value={a.id} />
                    <Input name="bankName" defaultValue={a.bankName} placeholder="ธนาคาร" required />
                    <Input
                      name="accountNo"
                      defaultValue={a.accountNo}
                      placeholder="เลขบัญชี"
                      required
                    />
                    <Input
                      name="accountName"
                      defaultValue={a.accountName}
                      placeholder="ชื่อบัญชี"
                      required
                      className="sm:col-span-2"
                    />
                    <select
                      name="branchId"
                      defaultValue={a.branchId ?? ""}
                      className="h-12 rounded-md border border-border bg-background px-3 text-base"
                    >
                      <option value="">— ทุกสาขา —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <Input name="notes" defaultValue={a.notes ?? ""} placeholder="หมายเหตุ" />
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" disabled={isPending}>
                        บันทึก
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setEditingId(null)}
                        disabled={isPending}
                      >
                        ยกเลิก
                      </Button>
                    </div>
                  </form>
                </td>
              </tr>
            ) : (
              <tr
                key={a.id}
                className={
                  "border-t border-border " + (a.isActive ? "" : "opacity-50")
                }
              >
                <td className="py-2 font-medium">{a.bankName}</td>
                <td className="py-2 font-mono text-xs">{a.accountNo}</td>
                <td className="py-2">{a.accountName}</td>
                <td className="py-2 text-xs">{a.branchName ?? "ทุกสาขา"}</td>
                <td className="py-2">
                  <Badge variant={a.isActive ? "success" : "secondary"}>
                    {a.isActive ? "ใช้งาน" : "ปิด"}
                  </Badge>
                </td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => setEditingId(a.id)}
                      disabled={isPending}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      แก้
                    </button>
                    <button
                      onClick={() =>
                        run(
                          () => deactivateAccount(a.id),
                          a.isActive ? "ปิดบัญชีแล้ว" : "เปิดบัญชีแล้ว"
                        )
                      }
                      disabled={isPending}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    >
                      {a.isActive ? "ปิด" : "เปิด"}
                    </button>
                  </div>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
