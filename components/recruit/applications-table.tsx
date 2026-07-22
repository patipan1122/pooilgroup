"use client";

// Excel-style table view — ผู้สมัครทั้งหมดเป็นแถว · กดเปลี่ยนสถานะ/คัดกรองในตารางได้เลย
// เรียงคอลัมน์ (server-side) · แบ่งหน้าที่หน้าแม่ · สรุปคะแนนอยู่แถบบน (หน้าแม่)
// + กางคำตอบทุกข้อเป็นคอลัมน์ (เมื่อเลือกตำแหน่ง) · ซ่อน/โชว์คอลัมน์ได้ (จำในเครื่อง)
// + คอลัมน์ "ไฟล์" กดเปิดเรซูเม่/รูป · ชื่อผู้สมัครติดขอบซ้าย · ติ๊กเลือกคน → AI batch
// + คอลัมน์ "สรุป AI" (คะแนน + คำตัดสิน + สรุปอ่านง่าย) · ปุ่มข้อมูลตำแหน่งสำหรับ AI

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  TAG_COLOR_CHIP,
  GENDER_LABELS,
  parseTag,
  type ApplicationStatus,
  type ScreeningVerdict,
  type Gender,
} from "@/lib/recruit/types";
import {
  aiVerdict,
  type AppFileMeta,
  type PostingAiBrief,
} from "@/lib/recruit/answers";
import {
  StatusSelect,
  VerdictButtons,
  InterviewNoteCell,
  type LatestNote,
} from "./application-row-controls";
import { FileQuickOpen } from "./file-quick-open";
import { BatchAiButton } from "./batch-ai-button";
import { AiSearchButton } from "./ai-search";
import { PositionBriefModal } from "./position-brief-modal";
import { ApplicationCard } from "./applications-cards";
import {
  Star,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Columns3,
  Check,
  Briefcase,
} from "lucide-react";

export interface AnswerColumnMeta {
  id: string;
  label: string;
  long: boolean;
}

export interface TableRow {
  id: string;
  refId: string | null;
  fullName: string;
  phone: string;
  gender: Gender | null;
  postingTitle: string;
  iq: { correct: number; total: number } | null;
  aiScore: number | null;
  aiSummary: string | null;
  starRating: number | null;
  verdict: ScreeningVerdict | null;
  status: ApplicationStatus;
  tags: string[];
  flagged: boolean;
  submittedAt: string | null;
  files: AppFileMeta[];
  answers: Record<string, string>; // fieldId → ข้อความที่จัดรูปแล้ว (เฉพาะ answerColumns)
  latestNote: LatestNote | null; // โน้ตสัมภาษณ์ล่าสุด (null = ยังไม่มี)
  noteCount: number; // จำนวนโน้ตทั้งหมดของคนนี้
}

interface Props {
  rows: TableRow[];
  canWrite: boolean;
  currentSort: string;
  sortLinks: { name: string; ai: string; star: string; recent: string };
  answerColumns: AnswerColumnMeta[];
  storageKey: string; // namespace เก็บ pref ซ่อนคอลัมน์ (ต่อตำแหน่ง)
  posting: { id: string; title: string; aiBrief: PostingAiBrief | null } | null;
  batchTargets: Array<{ id: string; scored: boolean }>;
  searchTargets: string[]; // application ids ในตัวกรอง (สำหรับ AI ค้นหาประวัติ)
}

const VERDICT_TEXT: Record<"green" | "amber" | "red", string> = {
  green: "text-green-700",
  amber: "text-amber-600",
  red: "text-red-600",
};

// คอลัมน์พื้นฐานที่ซ่อน/โชว์ได้ (ชื่อ + ปุ่มเปิดเต็มหน้า = โชว์ตลอด)
const HIDEABLE_BASE: { key: string; label: string }[] = [
  { key: "files", label: "ไฟล์แนบ" },
  { key: "position", label: "ตำแหน่ง" },
  { key: "gender", label: "เพศ" },
  { key: "iq", label: "IQ" },
  { key: "ai", label: "คะแนน AI" },
  { key: "aisummary", label: "สรุป AI" },
  { key: "star", label: "ดาว" },
  { key: "verdict", label: "คัดกรอง" },
  { key: "status", label: "สถานะ" },
  { key: "interview", label: "บันทึกสัมภาษณ์" },
  { key: "tags", label: "ป้าย" },
  { key: "submittedAt", label: "วันสมัคร" },
];

export function ApplicationsTable({
  rows,
  canWrite,
  currentSort,
  sortLinks,
  answerColumns,
  storageKey,
  posting,
  batchTargets,
  searchTargets,
}: Props) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [brief, setBrief] = useState<PostingAiBrief | null>(
    posting?.aiBrief ?? null,
  );
  const [briefOpen, setBriefOpen] = useState(false);
  const prefKey = `recruit-table-cols:${storageKey}`;

  // โหลด/บันทึกค่าที่ซ่อนไว้ในเครื่อง (ไม่แตะ DB · ต่อผู้ใช้ต่อเบราว์เซอร์)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefKey);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
      else setHidden(new Set());
    } catch {
      setHidden(new Set());
    }
  }, [prefKey]);

  // เปลี่ยนตำแหน่ง/หน้า → ล้างการติ๊ก + sync brief
  useEffect(() => {
    setSelected(new Set());
    setBrief(posting?.aiBrief ?? null);
  }, [posting?.id, posting?.aiBrief]);

  function toggle(key: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(prefKey, JSON.stringify([...next]));
      } catch {
        /* ignore quota / private mode */
      }
      return next;
    });
  }

  function showAll() {
    setHidden(new Set());
    try {
      localStorage.removeItem(prefKey);
    } catch {
      /* ignore */
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allPageSelected;
  function toggleAllPage() {
    setSelected((prev) => {
      if (rows.every((r) => prev.has(r.id))) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  }

  const vis = (key: string) => !hidden.has(key);

  const allToggles = useMemo(
    () => [
      ...HIDEABLE_BASE,
      ...answerColumns.map((c) => ({ key: `ans:${c.id}`, label: c.label })),
    ],
    [answerColumns],
  );
  const hiddenCount = hidden.size;
  const hasBrief = Boolean(brief?.about && brief.about.trim().length >= 5);

  return (
    <div className="space-y-2">
      {/* แถบเครื่องมือ */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px] text-zinc-400">
          {answerColumns.length > 0
            ? `กางคำตอบ ${answerColumns.length} ข้อเป็นคอลัมน์แล้ว`
            : "เลือกตำแหน่งด้านบนเพื่อกางคำตอบทุกข้อเป็นคอลัมน์"}
          <span className="lg:hidden"> · จอเล็กแสดงเป็นการ์ด กรอกได้เลย</span>
        </p>
        <div className="flex items-center gap-2">
          {/* ข้อมูลตำแหน่งสำหรับ AI */}
          {canWrite && posting && (
            <button
              type="button"
              onClick={() => setBriefOpen(true)}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-bold transition-colors ${
                hasBrief
                  ? "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
                  : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              }`}
              title="บอก AI ว่าตำแหน่งนี้คืออะไร เพื่อประเมินให้ตรงงาน"
            >
              <Briefcase className="size-3.5" />
              ข้อมูลตำแหน่ง
              {!hasBrief && (
                <span className="size-1.5 rounded-full bg-amber-500" />
              )}
            </button>
          )}

          {/* คอลัมน์ — เกี่ยวกับตาราง (จอใหญ่) เท่านั้น */}
          <div className="relative hidden lg:block">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:border-zinc-400"
            >
              <Columns3 className="size-3.5" />
              คอลัมน์
              {hiddenCount > 0 && (
                <span className="ml-0.5 rounded-full bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 tabular-nums">
                  ซ่อน {hiddenCount}
                </span>
              )}
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="ปิดเมนูคอลัมน์"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 z-40 mt-2 w-64 max-h-[60vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">
                      เลือกคอลัมน์ที่จะโชว์
                    </span>
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={showAll}
                        className="text-[11px] font-bold text-[var(--color-brand-700)] hover:underline"
                      >
                        แสดงทั้งหมด
                      </button>
                    )}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {allToggles.map((c) => {
                      const shown = vis(c.key);
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => toggle(c.key)}
                          className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-zinc-50"
                        >
                          <span
                            className={`size-4 shrink-0 grid place-items-center rounded border ${
                              shown
                                ? "bg-[var(--color-brand-600)] border-[var(--color-brand-600)] text-white"
                                : "border-zinc-300 text-transparent"
                            }`}
                          >
                            <Check className="size-3" />
                          </span>
                          <span
                            className={`truncate ${shown ? "text-zinc-800 font-medium" : "text-zinc-400"}`}
                          >
                            {c.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* AI ค้นหาประวัติ (อ่านเรซูเม่ตามคำค้น) */}
          <AiSearchButton targets={searchTargets} canWrite={canWrite} />

          {/* ประเมินด้วย AI (batch) */}
          {canWrite && (
            <BatchAiButton
              selectedIds={[...selected]}
              targets={batchTargets}
              postingSelected={Boolean(posting)}
              hasBrief={hasBrief}
              onEditBrief={() => setBriefOpen(true)}
            />
          )}
        </div>
      </div>

      {/* จอใหญ่ (lg+) — ตาราง Excel เลื่อนแนวนอน */}
      <div className="hidden lg:block overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full min-w-[1080px] text-sm border-collapse">
          <thead className="sticky top-0 z-20 bg-white border-b border-zinc-200 shadow-sm">
            <tr className="text-left text-[11px] text-zinc-500">
              {/* ชื่อ + checkbox เลือก (ติดขอบซ้าย) */}
              <th className="pl-4 pr-3 py-2.5 font-bold whitespace-nowrap sticky left-0 z-30 bg-white border-r border-zinc-100">
                <div className="flex items-center gap-2">
                  {canWrite && (
                    <SelectAllCheckbox
                      checked={allPageSelected}
                      indeterminate={someSelected}
                      onChange={toggleAllPage}
                    />
                  )}
                  <Link
                    href={sortLinks.name}
                    className={`inline-flex items-center gap-1 hover:text-zinc-900 ${
                      currentSort === "name" ? "text-[var(--color-brand-700)]" : ""
                    }`}
                  >
                    ชื่อ / ประวัติ
                    {currentSort === "name" ? (
                      <ArrowUp className="size-3" />
                    ) : (
                      <ArrowDown className="size-3 opacity-30" />
                    )}
                  </Link>
                </div>
              </th>
              {vis("files") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">ไฟล์</th>
              )}
              {vis("position") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">ตำแหน่ง</th>
              )}
              {vis("gender") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">เพศ</th>
              )}
              {vis("iq") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">IQ</th>
              )}
              {vis("ai") && (
                <SortableTh
                  label="คะแนน AI"
                  href={sortLinks.ai}
                  active={currentSort === "ai"}
                  dir="desc"
                />
              )}
              {vis("aisummary") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">สรุป AI</th>
              )}
              {vis("star") && (
                <SortableTh
                  label="ดาว"
                  href={sortLinks.star}
                  active={currentSort === "star"}
                  dir="desc"
                />
              )}
              {vis("verdict") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">คัดกรอง</th>
              )}
              {vis("status") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">สถานะ</th>
              )}
              {vis("interview") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">
                  บันทึกสัมภาษณ์
                </th>
              )}
              {vis("tags") && (
                <th className="px-3 py-2.5 font-bold whitespace-nowrap">ป้าย</th>
              )}
              {answerColumns.map(
                (c) =>
                  vis(`ans:${c.id}`) && (
                    <th
                      key={c.id}
                      className="px-3 py-2.5 font-bold whitespace-nowrap max-w-[220px] truncate"
                      title={c.label}
                    >
                      {c.label}
                    </th>
                  ),
              )}
              {vis("submittedAt") && (
                <SortableTh
                  label="วันสมัคร"
                  href={sortLinks.recent}
                  active={currentSort === "recent"}
                  dir="desc"
                />
              )}
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                canWrite={canWrite}
                vis={vis}
                answerColumns={answerColumns}
                selected={selected.has(row.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* จอเล็ก (มือถือ/แท็บเล็ต) — การ์ดต่อคน ดูง่าย กรอกสัมภาษณ์ได้เลย */}
      <div className="lg:hidden space-y-2">
        {rows.map((row) => (
          <ApplicationCard
            key={row.id}
            row={row}
            canWrite={canWrite}
            answerColumns={answerColumns}
            selected={selected.has(row.id)}
            onToggleSelect={toggleSelect}
          />
        ))}
      </div>

      {briefOpen && posting && (
        <PositionBriefModal
          key={posting.id}
          postingId={posting.id}
          postingTitle={posting.title}
          initial={brief}
          onClose={() => setBriefOpen(false)}
          onSaved={(b) => {
            setBrief(b);
            setBriefOpen(false);
          }}
        />
      )}
    </div>
  );
}

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      title="เลือก/ยกเลิกทั้งหน้านี้"
      className="size-4 shrink-0 accent-[var(--color-brand-600)] cursor-pointer"
    />
  );
}

function SortableTh({
  label,
  href,
  active,
  dir,
  className = "",
}: {
  label: string;
  href: string;
  active: boolean;
  dir: "asc" | "desc";
  className?: string;
}) {
  return (
    <th className={`px-3 py-2.5 font-bold whitespace-nowrap ${className}`}>
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-zinc-900 ${
          active ? "text-[var(--color-brand-700)]" : ""
        }`}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ArrowDown className="size-3 opacity-30" />
        )}
      </Link>
    </th>
  );
}

function Row({
  row,
  canWrite,
  vis,
  answerColumns,
  selected,
  onToggleSelect,
}: {
  row: TableRow;
  canWrite: boolean;
  vis: (key: string) => boolean;
  answerColumns: AnswerColumnMeta[];
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const verdictAi = aiVerdict(row.aiScore);
  const appHref = `/recruit/applications/${row.id}`;
  // ไฮไลต์ = คนที่เล็งไว้ (👍 น่าสนใจ) · อัปเดตสดเมื่อกดปุ่มคัดกรอง
  const [verdict, setVerdict] = useState<ScreeningVerdict | null>(row.verdict);
  // sync เมื่อข้อมูลใหม่มา (เช่น กด "เล็ง" จากผลค้นหา AI แล้ว refresh) → ไฮไลต์ขึ้นทันที
  useEffect(() => setVerdict(row.verdict), [row.verdict]);
  const highlighted = verdict === "INTERESTING";

  return (
    <tr
      className={`group border-b border-zinc-100 align-top transition-colors ${
        selected
          ? "bg-[var(--color-brand-50)]/60"
          : highlighted
            ? "bg-amber-50/60 hover:bg-amber-50"
            : "even:bg-zinc-50/40 hover:bg-[var(--color-brand-50)]/40"
      }`}
    >
      {/* ชื่อ + checkbox + เบอร์ + refId — ติดขอบซ้าย */}
      <td
        className={`pl-4 pr-3 py-2.5 sticky left-0 z-10 border-r border-zinc-100 border-l-4 ${
          highlighted && !selected ? "border-l-amber-400" : "border-l-transparent"
        } ${
          selected
            ? "bg-[var(--color-brand-50)]"
            : highlighted
              ? "bg-amber-50 group-hover:bg-amber-50"
              : "bg-white group-hover:bg-[var(--color-brand-50)]/60"
        }`}
      >
        <div className="flex items-start gap-2">
          {canWrite && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(row.id)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--color-brand-600)] cursor-pointer"
              aria-label={`เลือก ${row.fullName}`}
            />
          )}
          <div className="min-w-0">
            <Link
              href={`/recruit/applications/${row.id}`}
              className="font-bold text-zinc-900 hover:text-[var(--color-brand-700)] hover:underline"
            >
              {row.fullName}
            </Link>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 mt-0.5">
              <span className="tabular-nums">{row.phone}</span>
              {row.refId && (
                <span className="font-mono">#{row.refId.slice(-6)}</span>
              )}
              {row.flagged && (
                <span className="text-red-600 font-bold" title="ตรงกับ Blacklist">
                  ⚠
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* ไฟล์แนบ */}
      {vis("files") && (
        <td className="px-3 py-2.5 whitespace-nowrap">
          <FileQuickOpen files={row.files} variant="cell" />
        </td>
      )}

      {/* ตำแหน่ง */}
      {vis("position") && (
        <td
          className="px-3 py-2.5 text-zinc-600 max-w-[160px] truncate"
          title={row.postingTitle}
        >
          {row.postingTitle}
        </td>
      )}

      {/* เพศ */}
      {vis("gender") && (
        <td className="px-3 py-2.5 text-zinc-700 whitespace-nowrap">
          {row.gender ? (
            GENDER_LABELS[row.gender]
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </td>
      )}

      {/* IQ ข้อถูก */}
      {vis("iq") && (
        <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
          {row.iq ? (
            <span
              className={`font-bold ${
                row.iq.correct >= row.iq.total * 0.7
                  ? "text-green-700"
                  : row.iq.correct >= row.iq.total * 0.5
                    ? "text-amber-600"
                    : "text-red-600"
              }`}
            >
              {row.iq.correct}
              <span className="text-zinc-400 font-normal">/{row.iq.total}</span>
            </span>
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </td>
      )}

      {/* คะแนน AI + คำตัดสิน */}
      {vis("ai") && (
        <td className="px-3 py-2.5 whitespace-nowrap">
          {row.aiScore != null ? (
            <div className="leading-tight">
              <span
                className={`font-bold tabular-nums ${
                  row.aiScore >= 75
                    ? "text-green-700"
                    : row.aiScore >= 50
                      ? "text-amber-600"
                      : "text-red-600"
                }`}
              >
                {row.aiScore}
              </span>
              {verdictAi && (
                <span
                  className={`block text-[10px] font-bold ${VERDICT_TEXT[verdictAi.tone]}`}
                >
                  {verdictAi.label}
                </span>
              )}
            </div>
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </td>
      )}

      {/* สรุป AI (อ่านง่าย · กดขยาย) */}
      {vis("aisummary") && (
        <td className="px-3 py-2.5 max-w-[280px] align-top">
          <AiSummaryCell summary={row.aiSummary} />
        </td>
      )}

      {/* ดาว */}
      {vis("star") && (
        <td className="px-3 py-2.5 whitespace-nowrap">
          {row.starRating != null ? (
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              <Star className="size-3.5 fill-amber-400 text-amber-400" />
              <span className="tabular-nums text-zinc-700 font-medium">
                {row.starRating}
              </span>
            </span>
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </td>
      )}

      {/* คัดกรอง */}
      {vis("verdict") && (
        <td className="px-3 py-2.5 whitespace-nowrap">
          <VerdictButtons
            applicationId={row.id}
            initial={row.verdict}
            canWrite={canWrite}
            onChange={setVerdict}
          />
        </td>
      )}

      {/* สถานะ */}
      {vis("status") && (
        <td className="px-3 py-2.5 whitespace-nowrap">
          <StatusSelect
            applicationId={row.id}
            fullName={row.fullName}
            initial={row.status}
            canWrite={canWrite}
          />
        </td>
      )}

      {/* บันทึกสัมภาษณ์ — จดว่าสัมภาษณ์แล้วเป็นยังไง (กรอกในช่องได้เลย) */}
      {vis("interview") && (
        <td className="px-3 py-2.5 align-top">
          <InterviewNoteCell
            applicationId={row.id}
            initialLatest={row.latestNote}
            initialCount={row.noteCount}
            canWrite={canWrite}
            applicationHref={appHref}
            variant="cell"
          />
        </td>
      )}

      {/* ป้าย */}
      {vis("tags") && (
        <td className="px-3 py-2.5 max-w-[160px]">
          <div className="flex flex-wrap gap-1">
            {row.tags.slice(0, 3).map((raw) => {
              const { color, label } = parseTag(raw);
              return (
                <span
                  key={raw}
                  className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${TAG_COLOR_CHIP[color]}`}
                >
                  {label}
                </span>
              );
            })}
            {row.tags.length > 3 && (
              <span className="text-[10px] text-zinc-400">
                +{row.tags.length - 3}
              </span>
            )}
            {row.tags.length === 0 && <span className="text-zinc-300">—</span>}
          </div>
        </td>
      )}

      {/* คอลัมน์คำตอบ */}
      {answerColumns.map(
        (c) =>
          vis(`ans:${c.id}`) && (
            <td key={c.id} className="px-3 py-2.5 max-w-[240px] align-top">
              <AnswerCell value={row.answers[c.id] ?? ""} long={c.long} />
            </td>
          ),
      )}

      {/* วันสมัคร */}
      {vis("submittedAt") && (
        <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-zinc-500">
          {row.submittedAt ?? "ยังไม่ส่ง"}
        </td>
      )}

      {/* เปิดเต็มหน้า */}
      <td className="px-3 py-2.5">
        <Link
          href={`/recruit/applications/${row.id}`}
          className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--color-brand-700)] hover:underline whitespace-nowrap"
        >
          ดูประวัติ
          <ExternalLink className="size-3" />
        </Link>
      </td>
    </tr>
  );
}

/** เซลล์คำตอบ — ตัดสั้น 2 บรรทัด กดขยายดูเต็มได้ (ค่าว่าง = —) */
function AnswerCell({ value, long }: { value: string; long: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!value) return <span className="text-zinc-300">—</span>;

  const isTruncatable = long || value.length > 40;
  if (!isTruncatable) {
    return <span className="text-zinc-700 text-[13px]">{value}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      title={expanded ? "กดเพื่อย่อ" : value}
      className={`text-left text-zinc-700 text-[13px] hover:text-zinc-900 ${
        expanded ? "" : "line-clamp-2"
      }`}
    >
      {value}
    </button>
  );
}

/** เซลล์สรุป AI — แยกป้ายที่มา (เรซูเม่/คำตอบ) + ข้อความสรุป กดขยายได้ */
function AiSummaryCell({ summary }: { summary: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!summary) return <span className="text-zinc-300">—</span>;

  // aiSummary เก็บเป็น "[จากเรซูเม่] ..." / "[จากคำตอบ] ..."
  const m = summary.match(/^\[(.+?)\]\s*([\s\S]*)$/);
  const source = m ? m[1] : null;
  const text = m ? m[2] : summary;

  return (
    <div className="space-y-1">
      {source && (
        <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--color-brand-100)] text-[var(--color-brand-700)]">
          {source}
        </span>
      )}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "กดเพื่อย่อ" : text}
        className={`block text-left text-zinc-700 text-[13px] leading-snug hover:text-zinc-900 ${
          expanded ? "" : "line-clamp-3"
        }`}
      >
        {text}
      </button>
    </div>
  );
}
