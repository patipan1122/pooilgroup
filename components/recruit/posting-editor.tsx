"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createPosting,
  updatePosting,
  publishPosting,
  closePosting,
  deletePosting,
} from "@/lib/recruit/actions";
import {
  FormSchema,
  PostingStatus,
} from "@/lib/recruit/types";
import { FormBuilder } from "./form-builder";
import { IPhonePreview } from "./iphone-preview";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface Props {
  mode: "create" | "edit" | "view";
  postingId?: string;
  companies: Array<{ id: string; name: string; code: string }>;
  initialData: {
    title: string;
    description: string;
    companyId: string | null;
    opensAt: string | null;
    closesAt: string | null;
    fieldSchema: FormSchema;
    status: PostingStatus;
  };
  canPublish?: boolean;
  canClose?: boolean;
}

export function PostingEditor({
  mode,
  postingId,
  companies,
  initialData,
  canPublish,
  canClose,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialData.title);
  const [description, setDescription] = useState(initialData.description);
  const [companyId, setCompanyId] = useState<string | null>(
    initialData.companyId,
  );
  const [opensAt, setOpensAt] = useState(initialData.opensAt ?? "");
  const [closesAt, setClosesAt] = useState(initialData.closesAt ?? "");
  const [schema, setSchema] = useState<FormSchema>(initialData.fieldSchema);
  const [pending, startTransition] = useTransition();
  const readonly = mode === "view";

  function save() {
    startTransition(async () => {
      try {
        if (mode === "create") {
          if (!title.trim()) {
            toast.error("กรอกตำแหน่ง");
            return;
          }
          const result = await createPosting({
            title,
            description: description || undefined,
            companyId: companyId ?? undefined,
            opensAt: opensAt || undefined,
            closesAt: closesAt || undefined,
            fieldSchema: schema,
          });
          toast.success("สร้างประกาศแล้ว");
          router.push(`/recruit/postings/${result.id}`);
        } else if (postingId) {
          await updatePosting(postingId, {
            title,
            description,
            companyId,
            opensAt: opensAt || null,
            closesAt: closesAt || null,
            fieldSchema: schema,
          });
          toast.success("บันทึกแล้ว");
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function publish() {
    if (!postingId) return;
    if (!schema.sections.some((s) => s.fields.length > 0)) {
      toast.error("เพิ่ม field อย่างน้อย 1 ข้อก่อน publish");
      return;
    }
    startTransition(async () => {
      try {
        await save_no_toast();
        await publishPosting(postingId);
        toast.success("เผยแพร่ลิ้งค์รับสมัครแล้ว");
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  // Save without toast (used in publish flow)
  async function save_no_toast() {
    if (!postingId) return;
    await updatePosting(postingId, {
      title,
      description,
      companyId,
      opensAt: opensAt || null,
      closesAt: closesAt || null,
      fieldSchema: schema,
    });
  }

  async function close() {
    if (!postingId) return;
    try {
      await closePosting(postingId);
      toast.success("ปิดรับแล้ว");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function deleteMe() {
    if (!postingId) return;
    try {
      await deletePosting(postingId);
      toast.success("ลบแล้ว");
      router.push("/recruit/postings");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Match companyId to its display name for the iPhone preview
  const companyName =
    companies.find((c) => c.id === companyId)?.name ?? "Pooilgroup";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
      {/* LEFT: editor */}
      <div className="space-y-6 min-w-0">
      {/* Basic info */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4">
        <h2 className="text-sm font-bold text-zinc-900">
          ข้อมูลประกาศ
        </h2>
        <Field label="ตำแหน่ง" required>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={readonly}
            placeholder="เช่น พนักงานขับรถบรรทุก"
            className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] disabled:bg-zinc-50"
            maxLength={120}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="บริษัท">
            <select
              value={companyId ?? ""}
              onChange={(e) => setCompanyId(e.target.value || null)}
              disabled={readonly}
              className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] disabled:bg-zinc-50"
            >
              <option value="">— ไม่ระบุ / ใช้รวม —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="เปิดรับวันที่">
            <input
              type="date"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              disabled={readonly}
              className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] disabled:bg-zinc-50"
            />
          </Field>
          <Field label="ปิดรับวันที่">
            <input
              type="date"
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              disabled={readonly}
              className="w-full h-11 px-3 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] disabled:bg-zinc-50"
            />
          </Field>
        </div>

        <Field label="รายละเอียดงาน (JD)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={readonly}
            rows={4}
            placeholder="หน้าที่ความรับผิดชอบ · คุณสมบัติ · เงินเดือน · สวัสดิการ"
            className="w-full px-3 py-2 rounded-xl border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] disabled:bg-zinc-50"
            maxLength={5000}
          />
        </Field>
      </div>

      {/* Form Builder */}
      <FormBuilder
        schema={schema}
        onChange={setSchema}
        jobTitle={title}
        readonly={readonly}
      />

      {/* Save bar (sticky bottom) */}
      {!readonly && (
        <div className="sticky bottom-0 left-0 right-0 -mx-5 sm:mx-0 bg-white border-t border-zinc-200 sm:rounded-2xl sm:border p-4 flex items-center justify-between gap-3 flex-wrap shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)] z-10">
          <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
            <span>
              <span className="font-bold text-zinc-900">
                {schema.sections.reduce((s, sec) => s + sec.fields.length, 0)}
              </span>{" "}
              field ·{" "}
              <span className="font-bold text-zinc-900">
                {schema.sections.reduce(
                  (s, sec) => s + sec.fields.filter((f) => f.required).length,
                  0,
                )}
              </span>{" "}
              บังคับ
            </span>
          </div>
          <div className="flex items-center gap-2">
            {mode === "edit" && (
              <ConfirmDialog
                title="ลบประกาศนี้?"
                body="ประกาศและใบสมัครทั้งหมดจะถูกลบ · ลบแล้วกู้คืนไม่ได้"
                confirmLabel="ลบประกาศ"
                onConfirm={deleteMe}
                trigger={
                  <button
                    type="button"
                    disabled={pending}
                    className="text-sm font-bold text-red-600 px-3 h-11 hover:bg-red-50 rounded-lg"
                  >
                    ลบประกาศ
                  </button>
                }
              />
            )}
            {canClose && (
              <ConfirmDialog
                title="ปิดรับสมัคร?"
                body="ประกาศจะไม่รับใบสมัครใหม่ · เปิดใหม่ภายหลังได้"
                confirmLabel="ปิดรับสมัคร"
                variant="primary"
                onConfirm={close}
                trigger={
                  <button
                    type="button"
                    disabled={pending}
                    className="text-sm font-bold text-amber-700 bg-amber-50 px-4 h-11 rounded-xl hover:bg-amber-100"
                  >
                    ปิดรับสมัคร
                  </button>
                }
              />
            )}
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="text-sm font-bold text-zinc-700 border border-zinc-300 px-4 h-11 rounded-xl hover:bg-zinc-50 disabled:opacity-40"
            >
              {pending ? "กำลังบันทึก..." : "บันทึก"}
            </button>
            {canPublish && (
              <button
                type="button"
                onClick={publish}
                disabled={pending}
                className="text-sm font-bold text-white bg-[var(--color-brand-600)] px-4 h-11 rounded-xl hover:bg-[var(--color-brand-700)] disabled:opacity-40"
              >
                เปิดประกาศ · ให้คนสมัครได้
              </button>
            )}
          </div>
        </div>
      )}
      </div>
      {/* RIGHT: iPhone live preview (xl+ only · sticky) */}
      <aside className="hidden xl:block">
        <div className="sticky top-20">
          <IPhonePreview
            schema={schema}
            jobTitle={title}
            jobDescription={description}
            companyName={companyName}
          />
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
