"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addApplicationNote } from "@/lib/recruit/actions";

interface Note {
  id: string;
  body: string;
  rating: number | null;
  userName: string;
  createdAt: string;
}

interface Props {
  applicationId: string;
  notes: Note[];
  canWrite: boolean;
}

export function ApplicationNotes({ applicationId, notes, canWrite }: Props) {
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      try {
        await addApplicationNote(applicationId, text);
        setDraft("");
        toast.success("เพิ่ม note แล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="เขียน note เกี่ยวกับผู้สมัครคนนี้... (ส่ง = Cmd+Enter)"
            className="w-full resize-none text-sm focus:outline-none min-h-[60px]"
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex justify-end mt-2">
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !draft.trim()}
              className="text-xs font-bold text-white bg-[var(--color-brand-600)] px-3 py-1.5 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              {isPending ? "กำลังบันทึก..." : "เพิ่ม Note"}
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 ? (
        <p className="text-xs text-zinc-400 text-center py-4">
          ยังไม่มี note · เพิ่ม note แรกได้เลย
        </p>
      ) : (
        notes.map((n) => (
          <div
            key={n.id}
            className="rounded-2xl border border-zinc-200 bg-white p-3"
          >
            <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1.5">
              <span className="font-bold text-zinc-700">{n.userName}</span>
              <span>{new Date(n.createdAt).toLocaleString("th-TH")}</span>
            </div>
            <p className="text-sm text-zinc-900 whitespace-pre-wrap">{n.body}</p>
            {n.rating != null && (
              <p className="text-xs text-amber-500 mt-1">
                {"★".repeat(n.rating)}
              </p>
            )}
          </div>
        ))
      )}
    </div>
  );
}
