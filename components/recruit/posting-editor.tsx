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
import { ImageIcon, Sparkles } from "lucide-react";

interface Props {
  mode: "create" | "edit" | "view";
  postingId?: string;
  slug?: string;
  companies: Array<{ id: string; name: string; code: string }>;
  initialData: {
    title: string;
    description: string;
    companyId: string | null;
    opensAt: string | null;
    closesAt: string | null;
    fieldSchema: FormSchema;
    status: PostingStatus;
    coverImageUrl: string | null;
    caption: string;
  };
  canPublish?: boolean;
  canClose?: boolean;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const COVER_MAX = 10 * 1024 * 1024;

export function PostingEditor({
  mode,
  postingId,
  slug,
  companies,
  initialData,
  canPublish,
  canClose,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialData.title);
  const [description, setDescription] = useState(initialData.description);
  // บริษัทมาจาก "ตัวสลับบริษัทด้านบน" แล้ว (ตอนสร้างประกาศ) — ในฟอร์มไม่มีตัวให้เลือก
  // อีกต่อไป แค่โชว์ว่าประกาศนี้อยู่บริษัทไหน. companyId ยังถูกส่งไปบันทึกตามเดิม.
  const [companyId] = useState<string | null>(initialData.companyId);
  const [opensAt, setOpensAt] = useState(initialData.opensAt ?? "");
  const [closesAt, setClosesAt] = useState(initialData.closesAt ?? "");
  const [schema, setSchema] = useState<FormSchema>(initialData.fieldSchema);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(
    initialData.coverImageUrl,
  );
  const [caption, setCaption] = useState(initialData.caption);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [pending, startTransition] = useTransition();
  const readonly = mode === "view";

  const companyNameForCaption =
    companies.find((c) => c.id === companyId)?.name ?? "";
  const applyUrl = slug && APP_URL ? `${APP_URL}/apply/${slug}` : "";

  async function uploadCover(file: File) {
    if (!postingId) {
      toast.error("บันทึกประกาศก่อน แล้วค่อยเพิ่มรูปหน้าปก");
      return;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("รองรับเฉพาะรูป JPG / PNG / WEBP");
      return;
    }
    if (file.size > COVER_MAX) {
      toast.error(`รูปใหญ่เกิน 10 MB (รูปนี้ ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
    setUploadingCover(true);
    try {
      const signResp = await fetch("/api/recruit/cover-upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          postingId,
          fileName: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      if (!signResp.ok) {
        const err = await signResp.json().catch(() => ({}));
        toast.error(err.error ?? "ขออัปโหลดไม่สำเร็จ");
        return;
      }
      const { url, publicUrl } = await signResp.json();
      const putResp = await fetch(url, {
        method: "PUT",
        body: file,
        headers: { "content-type": file.type },
      });
      if (!putResp.ok) {
        toast.error("อัปโหลดรูปไม่สำเร็จ");
        return;
      }
      setCoverImageUrl(publicUrl);
      // Persist immediately so the cover survives even if HR forgets to save
      await updatePosting(postingId, { coverImageUrl: publicUrl });
      toast.success("อัปรูปหน้าปกแล้ว");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploadingCover(false);
    }
  }

  async function removeCover() {
    setCoverImageUrl(null);
    if (postingId) {
      try {
        await updatePosting(postingId, { coverImageUrl: null });
        toast.success("ลบรูปหน้าปกแล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
  }

  function genCaption() {
    const company = companyNameForCaption;
    const jd = description.trim();
    const lines = [
      `🔔 รับสมัคร${title.trim() ? " " + title.trim() : "พนักงาน"}`,
      company ? `📍 ${company}` : "",
      "",
      jd,
      jd ? "" : "",
      "✅ สนใจสมัคร กรอกใบสมัครออนไลน์ (ไม่ต้องล็อกอิน · ใช้เวลา 3-5 นาที):",
      applyUrl || "(ลิงก์สมัครจะขึ้นหลังเปิดประกาศ)",
      "",
      "📱 สอบถามเพิ่มเติม ทักแชทเพจได้เลย",
      company ? `#รับสมัครงาน #${company.replace(/\s+/g, "")}` : "#รับสมัครงาน",
    ];
    setCaption(lines.filter((l, i) => !(l === "" && lines[i - 1] === "")).join("\n").trim());
  }

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
            caption: caption || undefined,
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
            coverImageUrl,
            caption,
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
      coverImageUrl,
      caption,
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
            <div className="w-full h-11 px-3 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center text-sm font-medium text-zinc-700">
              {companyNameForCaption || "ทุกบริษัท (ใช้รวม)"}
            </div>
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

      {/* Cover image + share caption */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-5">
        <div>
          <h2 className="text-sm font-bold text-zinc-900">
            รูปหน้าปก + คำโพสต์รับสมัคร
          </h2>
          <p className="text-xs text-zinc-500 mt-1">
            รูปสถานที่ทำงานจริงจะขึ้นเป็นพื้นหลังหน้าสมัคร และใช้แนบตอนไปโพสต์ Facebook / LINE
          </p>
        </div>

        {/* Cover uploader */}
        <div>
          <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
            รูปหน้าปก / สถานที่ทำงาน
          </span>
          {coverImageUrl ? (
            <div className="relative rounded-2xl overflow-hidden border border-zinc-200 aspect-[16/9] bg-zinc-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImageUrl}
                alt="รูปหน้าปกประกาศ"
                className="w-full h-full object-cover"
              />
              {!readonly && (
                <div className="absolute top-2 right-2 flex gap-2">
                  <label className="cursor-pointer text-xs font-bold bg-white/90 backdrop-blur text-zinc-800 px-3 h-8 inline-flex items-center rounded-lg hover:bg-white shadow-sm">
                    {uploadingCover ? "กำลังอัป..." : "เปลี่ยนรูป"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingCover}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadCover(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={removeCover}
                    className="text-xs font-bold bg-white/90 backdrop-blur text-red-600 px-3 h-8 rounded-lg hover:bg-white shadow-sm"
                  >
                    ลบ
                  </button>
                </div>
              )}
            </div>
          ) : (
            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-zinc-300 aspect-[16/9] text-center px-4 transition-colors ${
                !postingId || uploadingCover || readonly
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)]/40"
              }`}
            >
              <ImageIcon className="size-7 text-zinc-400" />
              <span className="text-sm font-bold text-zinc-600">
                {uploadingCover ? "กำลังอัปโหลด..." : "แตะเพื่ออัปรูปสถานที่ทำงาน"}
              </span>
              <span className="text-[11px] text-zinc-400">
                JPG / PNG / WEBP · ไม่เกิน 10 MB
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                disabled={!postingId || uploadingCover || readonly}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadCover(f);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          {!postingId && (
            <p className="text-[11px] text-amber-600 mt-1.5">
              💡 บันทึกประกาศก่อน 1 ครั้ง แล้วปุ่มอัปรูปจะใช้งานได้
            </p>
          )}
        </div>

        {/* Caption */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-xs font-bold text-zinc-700">
              คำโพสต์รับสมัคร (เอาไปแปะ Facebook / LINE)
            </span>
            {!readonly && (
              <button
                type="button"
                onClick={genCaption}
                className="inline-flex items-center gap-1 text-xs font-bold text-[var(--color-brand-700)] hover:underline"
              >
                <Sparkles className="size-3.5" />
                สร้างอัตโนมัติ
              </button>
            )}
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            disabled={readonly}
            rows={8}
            placeholder="เขียนคำโพสต์รับสมัคร หรือกด ‘สร้างอัตโนมัติ’ แล้วแก้ได้ตามใจ"
            className="w-full px-3 py-2.5 rounded-xl border border-zinc-300 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] disabled:bg-zinc-50"
            maxLength={2000}
          />
          <p className="text-[11px] text-zinc-400 mt-1">
            คำโพสต์นี้จะโผล่ในปุ่ม &ldquo;ชุดโพสต์&rdquo; หน้ารายการประกาศ · กดคัดลอกไปแปะได้เลย
          </p>
        </div>
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
        <div className="sticky bottom-[64px] lg:bottom-0 left-0 right-0 -mx-5 sm:mx-0 bg-white border-t border-zinc-200 sm:rounded-2xl sm:border p-4 flex items-center justify-between gap-3 flex-wrap shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.08)] z-10">
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
