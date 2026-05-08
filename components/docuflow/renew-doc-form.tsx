"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

interface RenewDocFormProps {
  entityType: "vehicle" | "person";
  entityId: string;
  docType: string;
  docTypeLabel: string;
  oldDocumentId: string | null;
  oldDocumentName: string | null;
  oldExpiryDate: string | null;
  defaultName: string;
  redirectTo: string;
}

export function RenewDocForm({
  entityType,
  entityId,
  docType,
  docTypeLabel,
  oldDocumentId,
  oldDocumentName,
  oldExpiryDate,
  defaultName,
  redirectTo,
}: RenewDocFormProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(defaultName);
  const [expiryDate, setExpiryDate] = useState("");
  const [alertDays, setAlertDays] = useState("90,30,7");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("กรุณาเลือกไฟล์เอกสารใหม่");
      return;
    }
    if (!name.trim()) {
      setError("กรอกชื่อเอกสาร");
      return;
    }
    if (!expiryDate) {
      setError("กรอกวันหมดอายุใหม่");
      return;
    }

    const alertDaysArr = alertDays
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 365);

    setSubmitting(true);
    try {
      const res = await fetch("/api/docuflow/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType,
          entityId,
          docType,
          oldDocumentId: oldDocumentId ?? undefined,
          name: name.trim(),
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          expiryDate,
          alertDays: alertDaysArr.length > 0 ? alertDaysArr : undefined,
        }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j.error || "ต่ออายุไม่สำเร็จ");
      }

      const { uploadUrl } = (await res.json()) as { uploadUrl: string };

      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error("อัปโหลดไฟล์ไป R2 ไม่สำเร็จ");
      }

      toast.success(`ต่ออายุ${docTypeLabel}สำเร็จ`);
      startTransition(() => {
        router.push(redirectTo);
        router.refresh();
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ต่ออายุไม่สำเร็จ";
      setError(msg);
      toast.error(msg);
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody>
        {oldDocumentName && (
          <div className="mb-6 rounded-lg bg-zinc-50 border border-zinc-200 p-4">
            <p className="text-xs text-zinc-500 uppercase tracking-wide font-bold">
              เอกสารเดิม
            </p>
            <p className="text-sm font-medium text-zinc-900 mt-1">
              {oldDocumentName}
            </p>
            {oldExpiryDate && (
              <p className="text-xs text-zinc-500 mt-1">
                หมดอายุ: {oldExpiryDate}
              </p>
            )}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="renew-file"
              className="block text-sm font-medium text-zinc-900 mb-2"
            >
              ไฟล์เอกสารใหม่
              <span className="text-rose-600 ml-1">*</span>
            </label>
            <input
              id="renew-file"
              type="file"
              required
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              accept="application/pdf,image/*"
              className="block w-full text-sm text-zinc-700
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-lg file:border-0
                         file:text-sm file:font-medium
                         file:bg-[var(--color-brand-600)] file:text-white
                         hover:file:bg-[var(--color-brand-700)]"
            />
            {file && (
              <p className="mt-1 text-xs text-zinc-500">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="renew-name"
              className="block text-sm font-medium text-zinc-900 mb-2"
            >
              ชื่อเอกสาร <span className="text-rose-600 ml-1">*</span>
            </label>
            <input
              id="renew-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-600)]
                         focus:border-transparent"
            />
          </div>

          <div>
            <label
              htmlFor="renew-expiry"
              className="block text-sm font-medium text-zinc-900 mb-2"
            >
              วันหมดอายุใหม่ <span className="text-rose-600 ml-1">*</span>
            </label>
            <input
              id="renew-expiry"
              type="date"
              required
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="block w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-600)]"
            />
          </div>

          <div>
            <label
              htmlFor="renew-alert"
              className="block text-sm font-medium text-zinc-900 mb-2"
            >
              เตือนล่วงหน้า (วัน, คั่นด้วยลูกน้ำ)
            </label>
            <input
              id="renew-alert"
              type="text"
              value={alertDays}
              onChange={(e) => setAlertDays(e.target.value)}
              placeholder="90,30,7"
              className="block w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-600)]"
            />
            <p className="mt-1 text-xs text-zinc-500">
              ค่าเริ่มต้น: 90, 30, 7 วันก่อนหมด
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={submitting}
              loading={submitting}
            >
              {submitting ? "กำลังต่ออายุ..." : "ต่ออายุเอกสาร"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={() => router.back()}
              disabled={submitting}
            >
              ยกเลิก
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
