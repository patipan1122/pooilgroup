"use client";

// W3 (claude-design) · POS CSV upload form (client).
// Posts FormData to legacy `previewImport` server action — parser is unchanged.
// On success → /chairops/pos-ingest/i/[importId].

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { previewImport } from "@/app/(admin)/chairops/pos-ingest/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Branch {
  id: string;
  name: string;
  slug: string;
  tabName: string;
}

export function UploadForm({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [branchMode, setBranchMode] = useState<"auto" | "manual">("auto");

  function onSubmit(formData: FormData) {
    setError(null);
    if (branchMode === "auto") {
      formData.delete("branchId");
    }
    startTransition(async () => {
      const res = await previewImport(formData);
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success("อ่านไฟล์เรียบร้อย · เปิดหน้า preview");
      router.push(`/chairops/pos-ingest/i/${res.importId}`);
    });
  }

  return (
    <form action={onSubmit} className="space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-foreground">
          ไฟล์ CSV
        </label>
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          disabled={isPending}
          className="h-12 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium"
        />
        {fileName && (
          <p className="mt-1 text-xs text-muted-foreground">
            เลือกไฟล์: {fileName}
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-foreground">
          ระบุสาขา
        </label>
        <div className="flex gap-2 text-sm">
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-muted">
            <input
              type="radio"
              name="branchMode"
              value="auto"
              checked={branchMode === "auto"}
              onChange={() => setBranchMode("auto")}
              disabled={isPending}
            />
            <div>
              <div className="font-medium">
                auto-detect จากคอลัมน์ &quot;ชื่อร้าน&quot;
              </div>
              <div className="text-xs text-muted-foreground">
                ระบบจะ map ชื่อร้านกับ tabName ของสาขา
              </div>
            </div>
          </label>
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-muted">
            <input
              type="radio"
              name="branchMode"
              value="manual"
              checked={branchMode === "manual"}
              onChange={() => setBranchMode("manual")}
              disabled={isPending}
            />
            <div>
              <div className="font-medium">เลือกสาขาเอง</div>
              <div className="text-xs text-muted-foreground">
                ใช้เมื่อไฟล์ไม่มีชื่อร้าน หรือไฟล์ 1 สาขา
              </div>
            </div>
          </label>
        </div>
        {branchMode === "manual" && (
          <select
            name="branchId"
            required
            disabled={isPending}
            className="mt-3 h-12 w-full rounded-md border border-border bg-background px-3 text-sm"
            defaultValue=""
          >
            <option value="" disabled>
              — เลือกสาขา —
            </option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.tabName})
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-foreground">
          หมายเหตุ (ไม่จำเป็น)
        </label>
        <Input
          type="text"
          name="notes"
          placeholder="เช่น POS ส่งช้า · sheet วันที่ 21 ขาด"
          disabled={isPending}
          maxLength={200}
        />
      </div>

      {error && (
        <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          ขั้นถัดไป: ระบบจะแสดง diff 4 กลุ่ม · ยังไม่บันทึกอะไรลง DB
        </p>
        <Button type="submit" disabled={isPending} size="lg">
          {isPending ? "กำลังอ่านไฟล์..." : "ขั้นต่อไป → ดู preview"}
        </Button>
      </div>
    </form>
  );
}
