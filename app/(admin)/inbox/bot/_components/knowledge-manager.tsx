"use client";

// Knowledge manager — title+content blocks the bot uses to answer questions
// that are not covered by an exact FAQ keyword match.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createKnowledge,
  updateKnowledge,
  deleteKnowledge,
} from "@/lib/inbox/bot/knowledge-actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Plus, Pencil, Trash2, Check, X, BookOpen } from "lucide-react";

export interface Knowledge {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
}

const inputCls =
  "w-full h-10 px-3 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm";
const areaCls =
  "w-full px-3 py-2 rounded-lg border border-zinc-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] text-sm leading-relaxed resize-y";

export function KnowledgeManager({
  businessTag,
  initialKnowledge,
}: {
  businessTag: string;
  initialKnowledge: Knowledge[];
}) {
  const [items, setItems] = useState(initialKnowledge);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [eTitle, setETitle] = useState("");
  const [eContent, setEContent] = useState("");

  function resetAdd() {
    setTitle("");
    setContent("");
    setShowAdd(false);
  }

  function add() {
    if (!title.trim() || !content.trim()) {
      toast.error("กรอกหัวข้อและเนื้อหา");
      return;
    }
    start(async () => {
      try {
        await createKnowledge({ businessTag, title, content });
        setItems((cur) => [
          ...cur,
          { id: `tmp-${Date.now()}`, title: title.trim(), content: content.trim(), enabled: true },
        ]);
        toast.success("เพิ่มข้อมูลร้านแล้ว");
        resetAdd();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function startEdit(k: Knowledge) {
    setEditingId(k.id);
    setETitle(k.title);
    setEContent(k.content);
  }

  function saveEdit(k: Knowledge) {
    if (!eTitle.trim() || !eContent.trim()) {
      toast.error("กรอกหัวข้อและเนื้อหา");
      return;
    }
    start(async () => {
      try {
        await updateKnowledge(k.id, { title: eTitle, content: eContent });
        setItems((cur) =>
          cur.map((x) =>
            x.id === k.id ? { ...x, title: eTitle.trim(), content: eContent.trim() } : x,
          ),
        );
        toast.success("บันทึกแล้ว");
        setEditingId(null);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function toggleEnabled(k: Knowledge) {
    const next = !k.enabled;
    start(async () => {
      try {
        await updateKnowledge(k.id, { enabled: next });
        setItems((cur) => cur.map((x) => (x.id === k.id ? { ...x, enabled: next } : x)));
        toast.success(next ? "เปิดใช้ข้อมูลนี้" : "ปิดข้อมูลนี้");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  async function remove(k: Knowledge) {
    try {
      await deleteKnowledge(k.id);
      setItems((cur) => cur.filter((x) => x.id !== k.id));
      toast.success("ลบแล้ว");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      {/* Explainer */}
      <div className="rounded-2xl bg-[var(--color-brand-50)]/50 border border-[var(--color-brand-200)] p-4 flex items-start gap-3">
        <BookOpen className="size-5 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-700 leading-relaxed">
          ข้อมูลร้าน เช่น ราคา/นาที, เวลาเปิด-ปิด, เบอร์ติดต่อ, รายชื่อสาขา — บอทใช้ตอบคำถามที่ไม่มีใน
          คลังคำตอบ (FAQ)
        </p>
      </div>

      {/* Header + add */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm font-bold text-zinc-900">
          ข้อมูลร้าน{" "}
          <span className="text-zinc-400 tabular-nums font-normal">({items.length})</span>
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-1.5 text-sm font-bold text-white bg-[var(--color-brand-600)] px-3 h-10 rounded-xl hover:bg-[var(--color-brand-700)]"
        >
          <Plus className="size-4" />
          เพิ่มข้อมูล
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-2xl border-2 border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40 p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              หัวข้อ <span className="text-red-500">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น เวลาเปิด-ปิด · รายชื่อสาขา · เบอร์ติดต่อ"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-xs font-bold text-zinc-700 mb-1.5 block">
              เนื้อหา <span className="text-red-500">*</span>
            </span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="เช่น เปิดทุกวัน 10:00-22:00 น. · มี 30 สาขาทั่วกรุงเทพ"
              rows={4}
              className={areaCls}
            />
          </label>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetAdd}
              className="text-sm font-bold text-zinc-700 px-3 h-10 rounded-lg hover:bg-zinc-100"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={add}
              disabled={pending || !title.trim() || !content.trim()}
              className="text-sm font-bold text-white bg-[var(--color-brand-600)] px-4 h-10 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              {pending ? "กำลังบันทึก..." : "เพิ่มข้อมูล"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {items.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border-2 border-dashed border-zinc-300 text-sm text-zinc-500">
          <p className="font-bold text-zinc-900 mb-1">ยังไม่มีข้อมูลร้าน</p>
          <p>เพิ่มข้อมูลพื้นฐาน เช่น ราคา เวลาเปิด-ปิด เพื่อให้บอทตอบลูกค้าได้ครบ</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((k) =>
            editingId === k.id ? (
              <div
                key={k.id}
                className="rounded-2xl border-2 border-[var(--color-brand-300)] bg-[var(--color-brand-50)]/40 p-4 space-y-3"
              >
                <label className="block">
                  <span className="text-xs font-bold text-zinc-700 mb-1.5 block">หัวข้อ</span>
                  <input
                    type="text"
                    value={eTitle}
                    onChange={(e) => setETitle(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-700 mb-1.5 block">เนื้อหา</span>
                  <textarea
                    value={eContent}
                    onChange={(e) => setEContent(e.target.value)}
                    rows={4}
                    className={areaCls}
                  />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="inline-flex items-center gap-1 text-sm font-bold text-zinc-700 px-3 h-9 rounded-lg hover:bg-zinc-100"
                  >
                    <X className="size-4" /> ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(k)}
                    disabled={pending}
                    className="inline-flex items-center gap-1 text-sm font-bold text-white bg-[var(--color-brand-600)] px-3 h-9 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
                  >
                    <Check className="size-4" /> บันทึก
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={k.id}
                className={`rounded-2xl border-2 p-4 transition-colors ${
                  k.enabled
                    ? "border-zinc-200 bg-white hover:border-[var(--color-brand-300)]"
                    : "border-zinc-200 bg-zinc-50/60 opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900">
                      {k.title}
                      {!k.enabled && (
                        <span className="ml-2 text-[10px] font-medium text-zinc-400">(ปิดอยู่)</span>
                      )}
                    </p>
                    <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed mt-1">
                      {k.content}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleEnabled(k)}
                      disabled={pending}
                      role="switch"
                      aria-checked={k.enabled}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        k.enabled ? "bg-[var(--color-brand-600)]" : "bg-zinc-300"
                      }`}
                      title={k.enabled ? "ปิดข้อมูลนี้" : "เปิดข้อมูลนี้"}
                    >
                      <span
                        className={`inline-block size-4 transform rounded-full bg-white transition-transform ${
                          k.enabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(k)}
                      className="size-9 inline-flex items-center justify-center text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50 rounded-lg"
                      title="แก้ไข"
                      aria-label="แก้ไขข้อมูล"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <ConfirmDialog
                      title="ลบข้อมูลนี้?"
                      body="บอทจะไม่ใช้ข้อมูลนี้อีก · ลบแล้วกู้คืนไม่ได้"
                      confirmLabel="ลบ"
                      onConfirm={() => remove(k)}
                      trigger={
                        <button
                          type="button"
                          className="size-9 inline-flex items-center justify-center text-zinc-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                          title="ลบ"
                          aria-label="ลบข้อมูล"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      }
                    />
                  </div>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
