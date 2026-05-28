"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addApplicationNote } from "@/lib/recruit/actions";
import {
  Phone,
  MessageCircle,
  CalendarCheck,
  Mail,
  StickyNote,
  CheckCircle2,
  XCircle,
} from "lucide-react";

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

// Activity types encoded as "[TYPE] body" prefix in the note body
// New notes from quick actions emit this prefix; legacy plain notes show as NOTE
type ActivityType =
  | "CALL"
  | "CALL_NO_ANSWER"
  | "MSG"
  | "INTERVIEW"
  | "EMAIL"
  | "NOTE";

const ACTIVITY_META: Record<
  ActivityType,
  { label: string; Icon: React.ComponentType<{ className?: string }>; chip: string }
> = {
  CALL: {
    label: "โทรคุยแล้ว",
    Icon: CheckCircle2,
    chip: "bg-green-100 text-green-800 border-green-200",
  },
  CALL_NO_ANSWER: {
    label: "โทรไม่รับ",
    Icon: XCircle,
    chip: "bg-red-100 text-red-800 border-red-200",
  },
  MSG: {
    label: "ส่ง LINE / ข้อความ",
    Icon: MessageCircle,
    chip: "bg-blue-100 text-blue-800 border-blue-200",
  },
  INTERVIEW: {
    label: "นัดสัมภาษณ์",
    Icon: CalendarCheck,
    chip: "bg-purple-100 text-purple-800 border-purple-200",
  },
  EMAIL: {
    label: "ส่งอีเมล",
    Icon: Mail,
    chip: "bg-amber-100 text-amber-800 border-amber-200",
  },
  NOTE: {
    label: "บันทึก",
    Icon: StickyNote,
    chip: "bg-zinc-100 text-zinc-700 border-zinc-200",
  },
};

const ACTIVITY_PREFIX_RE = /^\[(CALL|CALL_NO_ANSWER|MSG|INTERVIEW|EMAIL|NOTE)\]\s*/;

function parseNoteBody(body: string): { type: ActivityType; text: string } {
  const m = body.match(ACTIVITY_PREFIX_RE);
  if (m) {
    return {
      type: m[1] as ActivityType,
      text: body.slice(m[0].length),
    };
  }
  return { type: "NOTE", text: body };
}

const QUICK_ACTIONS: Array<{
  type: ActivityType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  {
    type: "CALL",
    label: "โทรคุยแล้ว",
    Icon: Phone,
    hint: "เพิ่มรายละเอียดที่คุยได้",
  },
  {
    type: "CALL_NO_ANSWER",
    label: "โทรไม่รับ",
    Icon: XCircle,
    hint: "เช่น เบอร์ดับ · ไม่รับสาย",
  },
  {
    type: "MSG",
    label: "LINE / ข้อความ",
    Icon: MessageCircle,
    hint: "ส่งข้อความไปแล้ว",
  },
  {
    type: "INTERVIEW",
    label: "นัดสัมภาษณ์",
    Icon: CalendarCheck,
    hint: "วัน-เวลา-สถานที่",
  },
  {
    type: "EMAIL",
    label: "ส่งอีเมล",
    Icon: Mail,
    hint: "เนื้อหาที่ส่ง",
  },
];

export function ApplicationNotes({ applicationId, notes, canWrite }: Props) {
  const [draft, setDraft] = useState("");
  const [activeType, setActiveType] = useState<ActivityType>("NOTE");
  const [isPending, startTransition] = useTransition();

  function submit() {
    const text = draft.trim();
    if (!text) return;
    const body = activeType === "NOTE" ? text : `[${activeType}] ${text}`;
    startTransition(async () => {
      try {
        await addApplicationNote(applicationId, body);
        setDraft("");
        setActiveType("NOTE");
        toast.success("บันทึกลง timeline แล้ว");
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const activeMeta = activeType === "NOTE" ? null : ACTIVITY_META[activeType];
  const activeQuick = QUICK_ACTIONS.find((q) => q.type === activeType);

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-3 space-y-2.5">
          {/* Quick-action buttons */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map(({ type, label, Icon }) => {
              const isActive = activeType === type;
              const meta = ACTIVITY_META[type];
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setActiveType(isActive ? "NOTE" : type)}
                  className={`inline-flex items-center gap-1 text-xs h-9 px-2.5 rounded-lg border transition-colors ${
                    isActive
                      ? `${meta.chip} font-bold`
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Active type indicator */}
          {activeMeta && (
            <div
              className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-md ${activeMeta.chip} border`}
            >
              <activeMeta.Icon className="size-3" />
              กำลังบันทึก: {activeMeta.label}
              <span className="text-[10px] font-normal opacity-70 ml-1">
                · {activeQuick?.hint}
              </span>
            </div>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              activeType === "NOTE"
                ? "เขียน note ทั่วไป... (ส่ง = Cmd+Enter)"
                : `รายละเอียด: ${activeQuick?.hint ?? ""}`
            }
            className="w-full resize-none text-sm focus:outline-none min-h-[60px]"
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !draft.trim()}
              className="text-xs font-bold text-white bg-[var(--color-brand-600)] px-3 h-9 rounded-lg hover:bg-[var(--color-brand-700)] disabled:opacity-40"
            >
              {isPending ? "กำลังบันทึก..." : activeMeta ? `บันทึก: ${activeMeta.label}` : "เพิ่ม Note"}
            </button>
          </div>
        </div>
      )}

      {/* Timeline */}
      {notes.length === 0 ? (
        <p className="text-xs text-zinc-400 text-center py-4">
          ยังไม่มีกิจกรรม · กดปุ่มด้านบนเพื่อบันทึก
        </p>
      ) : (
        <ol className="relative space-y-2 pl-3 border-l-2 border-zinc-100">
          {notes.map((n) => {
            const { type, text } = parseNoteBody(n.body);
            const meta = ACTIVITY_META[type];
            const Icon = meta.Icon;
            return (
              <li key={n.id} className="relative">
                {/* Timeline dot */}
                <span
                  className={`absolute -left-[18px] top-2 size-3 rounded-full ${
                    meta.chip
                  } border flex items-center justify-center`}
                >
                  <Icon className="size-2" />
                </span>
                <div className="rounded-2xl border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1.5 gap-2">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${meta.chip} border`}
                    >
                      <Icon className="size-2.5" />
                      {meta.label}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-bold text-zinc-700">{n.userName}</span>
                      <span>·</span>
                      <span>{new Date(n.createdAt).toLocaleString("th-TH")}</span>
                    </span>
                  </div>
                  <p className="text-sm text-zinc-900 whitespace-pre-wrap">{text}</p>
                  {n.rating != null && (
                    <p className="text-xs text-amber-500 mt-1">
                      {"★".repeat(n.rating)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
