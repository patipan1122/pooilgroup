"use client";

// กล่องกรอก "ข้อมูลตำแหน่งสำหรับ AI" — ให้ AI รู้จักงานจริง ก่อนประเมิน
// บันทึกลง posting.settings.aiBrief (ถามครั้งเดียวต่อตำแหน่ง · แก้ทีหลังได้)

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { savePostingAiBrief } from "@/app/(admin)/recruit/_actions/ai";
import type { PostingAiBrief } from "@/lib/recruit/answers";

export function PositionBriefModal({
  postingId,
  postingTitle,
  initial,
  onClose,
  onSaved,
}: {
  postingId: string;
  postingTitle: string;
  initial: PostingAiBrief | null;
  onClose: () => void;
  onSaved: (brief: PostingAiBrief) => void;
}) {
  const [about, setAbout] = useState(initial?.about ?? "");
  const [workplace, setWorkplace] = useState(initial?.workplace ?? "");
  const [headcount, setHeadcount] = useState(initial?.headcount ?? "");
  const [skills, setSkills] = useState(initial?.skills ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (about.trim().length < 5) {
      toast.error("กรอก “ตำแหน่งนี้ทำอะไร” อย่างน้อยสั้น ๆ ก่อนครับ");
      return;
    }
    setSaving(true);
    const brief: PostingAiBrief = { about, workplace, headcount, skills };
    const res = await savePostingAiBrief(postingId, brief);
    setSaving(false);
    if (res.ok) {
      toast.success("บันทึกข้อมูลตำแหน่งแล้ว");
      onSaved(brief);
    } else {
      toast.error(res.error);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-4 py-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 font-bold">
              ข้อมูลตำแหน่งสำหรับ AI
            </p>
            <h2 className="font-extrabold text-zinc-900 leading-tight">
              {postingTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 shrink-0"
            aria-label="ปิด"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-zinc-500 leading-relaxed bg-[var(--color-brand-50)]/50 rounded-lg px-3 py-2">
            บอก AI ให้รู้ว่าตำแหน่งนี้คืออะไร เพื่อให้ประเมินได้ตรงกับงานเราจริง
            (กรอกครั้งเดียว · ใช้กับทุกคนในตำแหน่งนี้ · แก้ทีหลังได้)
          </p>

          <Field
            label="ตำแหน่งนี้ทำอะไร"
            required
            hint="หน้าที่หลัก เช่น ขายหน้าร้าน + ดูแลสต๊อก + ปิดยอดรายวัน"
          >
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              rows={3}
              placeholder="อธิบายงานสั้น ๆ..."
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="สาขา / ที่ทำงาน" hint="เช่น ปั้ม 62 หัวหิน">
              <input
                value={workplace}
                onChange={(e) => setWorkplace(e.target.value)}
                placeholder="สาขา..."
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
              />
            </Field>
            <Field label="ดูแลลูกน้องกี่คน" hint="ไม่มีก็เว้นได้">
              <input
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                placeholder="เช่น 3 คน / ไม่มี"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
              />
            </Field>
          </div>

          <Field
            label="ทักษะ / คุณสมบัติสำคัญ"
            hint="เช่น ใช้ Excel ได้ · มีรถยนต์ · ทำงานเสาร์-อาทิตย์ได้"
          >
            <textarea
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              rows={2}
              placeholder="สิ่งที่คนตำแหน่งนี้ควรมี..."
              className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
            />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-zinc-100 px-4 py-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl text-sm font-bold text-zinc-600 hover:bg-zinc-100"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-xl bg-[var(--color-brand-600)] text-white text-sm font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-50"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-zinc-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-zinc-400 mt-1">{hint}</p>}
    </div>
  );
}
