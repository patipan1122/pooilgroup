"use client";

/**
 * Client-side search + card grid for /recruit/postings.
 * CEO ask (2026-10-11): ค้นหาประกาศได้ · เห็นวันที่สมัครล่าสุด (ดูว่ายัง active ไหม) ·
 * จัดประกาศเป็น "กลุ่ม" ได้ (สร้างกลุ่มใหม่ + ย้ายประกาศเข้ากลุ่ม จากหน้ารายการเลย ไม่ต้องเปิดแก้ทีละใบ).
 *
 * "กลุ่ม" ใช้ field `tags` เดิมที่มีอยู่แล้ว (ไม่สร้างตาราง/คอลัมน์ใหม่) — แถบกรองกลุ่มด้านบนหน้า
 * (postings/page.tsx) ก็ผูกกับ field เดียวกันนี้อยู่แล้ว แค่ไม่มีทางสร้าง/ย้ายด่วนจากรายการมาก่อน.
 * ค้นหาเป็น client-side ล้วน (ข้อมูล ~หลักสิบรายการต่อองค์กร โหลดมาหมดแล้วจาก server) — รูปแบบเดียวกับ
 * ที่เพิ่งทำให้คลังสินค้า ClawFleet วันนี้ (stock-client.tsx) ไม่ยิง query ใหม่ทุกตัวอักษร.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Flame, Link as LinkIcon, Tags, FileQuestion } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { TagCombobox } from "@/components/docuflow/tag-combobox";
import { CopyLinkButton } from "@/components/recruit/copy-link-button";
import { ShareKitButton } from "@/components/recruit/share-kit-button";
import { ApplicantShareButton } from "@/components/recruit/applicant-share-button";
import { updatePosting } from "@/lib/recruit/actions";
import { bkkRelative } from "@/lib/utils/format";
import { POSTING_STATUS_LABELS, type PostingStatus } from "@/lib/recruit/types";

const STATUS_TONE: Record<PostingStatus, "neutral" | "brand" | "success" | "warning"> = {
  DRAFT: "neutral",
  OPEN: "success",
  CLOSED: "warning",
  ARCHIVED: "neutral",
};

const SOURCE_LABELS: Record<string, { label: string; color: string; bgClass: string; textClass: string }> = {
  facebook: { label: "Facebook", color: "#1877f2", bgClass: "bg-blue-50", textClass: "text-blue-700" },
  line: { label: "LINE", color: "#06c755", bgClass: "bg-green-50", textClass: "text-green-700" },
  tiktok: { label: "TikTok", color: "#000000", bgClass: "bg-zinc-100", textClass: "text-zinc-900" },
  qr: { label: "QR หน้าร้าน", color: "#f59e0b", bgClass: "bg-amber-50", textClass: "text-amber-700" },
  instagram: { label: "Instagram", color: "#e4405f", bgClass: "bg-pink-50", textClass: "text-pink-700" },
  jobsdb: { label: "JobsDB", color: "#dc2626", bgClass: "bg-red-50", textClass: "text-red-700" },
  direct: { label: "เปิดตรง", color: "#71717a", bgClass: "bg-zinc-100", textClass: "text-zinc-700" },
};

export interface PostingCardData {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  tags: string[];
  settings: unknown;
  company: { name: string; code: string } | null;
  _count: { applications: number };
  counts: {
    NEW: number;
    SCREENING: number;
    INTERVIEW: number;
    OFFERED: number;
    HIRED: number;
    REJECTED: number;
    WITHDRAWN: number;
  };
  sources: { key: string; count: number }[];
  recentCount: number;
  lastAppliedAt: Date | null;
  daysOpen: number;
  urgent: boolean;
}

export function PostingsGrid({
  postings,
  canWrite,
  orgTags,
}: {
  postings: PostingCardData[];
  canWrite: boolean;
  orgTags: string[];
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return postings;
    return postings.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.company?.name ?? "").toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [postings, query]);

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาประกาศ ชื่อตำแหน่ง บริษัท หรือกลุ่ม..."
          aria-label="ค้นหาประกาศ"
          className="w-full h-11 pl-10 pr-4 rounded-xl border-2 border-zinc-200 bg-white text-sm focus:border-[var(--color-brand-500)] focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-10 text-center">
          <FileQuestion className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 font-bold text-zinc-900">
            ไม่พบประกาศที่ตรงกับ &ldquo;{query}&rdquo;
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-3 text-sm font-medium text-[var(--color-brand-700)] hover:underline"
          >
            ล้างคำค้นหา
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <PostingCard key={p.id} posting={p} canWrite={canWrite} orgTags={orgTags} />
          ))}
        </div>
      )}
    </div>
  );
}

function PostingCard({
  posting,
  canWrite,
  orgTags,
}: {
  posting: PostingCardData;
  canWrite: boolean;
  orgTags: string[];
}) {
  const { counts, sources, recentCount, lastAppliedAt, daysOpen, urgent } = posting;
  const apply = posting._count.applications;
  const hasApps = apply > 0;
  const settings =
    posting.settings &&
    typeof posting.settings === "object" &&
    !Array.isArray(posting.settings)
      ? (posting.settings as { coverImageUrl?: string; caption?: string })
      : {};

  return (
    <div
      className={`relative rounded-3xl border-2 bg-white p-5 transition-all group flex flex-col gap-3 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)] ${
        urgent
          ? "border-[#f5b800] bg-gradient-to-b from-[#fffbeb] to-white"
          : "border-zinc-200 hover:border-[var(--color-brand-300)]"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={STATUS_TONE[posting.status as PostingStatus]}>
            <span className="size-1.5 rounded-full bg-current opacity-70" />
            {POSTING_STATUS_LABELS[posting.status as PostingStatus]}
          </Badge>
          {urgent && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
              <Flame className="size-3" />
              เร่งด่วน
            </span>
          )}
        </div>
        {daysOpen > 0 && posting.status === "OPEN" && (
          <span className="text-[11px] text-zinc-500">
            เปิดมา <b className="text-zinc-700">{daysOpen}</b> วัน
          </span>
        )}
      </div>

      {/* Title + company */}
      <Link href={`/recruit/postings/${posting.id}`} className="block group/title">
        <h3 className="text-lg font-extrabold text-zinc-900 tracking-tight font-display group-hover/title:text-[var(--color-brand-700)]">
          {posting.title}
        </h3>
        {posting.company && (
          <p className="text-xs text-zinc-500 mt-1">{posting.company.name}</p>
        )}
      </Link>

      {/* กลุ่ม — chips + ปุ่มจัดกลุ่ม (สร้าง/ย้ายได้ทันทีไม่ต้องเปิดแก้ประกาศ) */}
      <PostingGroupChips
        postingId={posting.id}
        initialTags={posting.tags}
        orgTags={orgTags}
        canWrite={canWrite}
      />

      {/* Funnel mini bar */}
      {hasApps ? (
        <MiniFunnel
          apply={apply}
          screen={counts.SCREENING}
          interview={counts.INTERVIEW}
          offer={counts.OFFERED}
          hired={counts.HIRED}
        />
      ) : (
        <div className="py-3 text-center text-xs text-zinc-400 border-y border-dashed border-zinc-200">
          ยังไม่มีใบสมัคร — กด &ldquo;แชร์&rdquo; ด้านล่างเพื่อรับใบสมัคร
        </div>
      )}

      {/* วันที่สมัครล่าสุด — ดูได้ว่าประกาศนี้ยัง active แค่ไหน */}
      {hasApps && (
        <p className="text-[11px] text-zinc-500 -mt-1.5">
          สมัครล่าสุด{" "}
          <b className="text-zinc-700">
            {lastAppliedAt ? bkkRelative(lastAppliedAt) : "ไม่ทราบวันที่"}
          </b>
        </p>
      )}

      {/* Sources + new */}
      {(sources.length > 0 || recentCount > 0) && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {sources.map((s) => {
              const meta = SOURCE_LABELS[s.key] ?? SOURCE_LABELS.direct;
              return (
                <span
                  key={s.key}
                  className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md ${meta.bgClass} ${meta.textClass}`}
                  title={`${meta.label} · ${s.count} ใบ`}
                >
                  <span className="size-1.5 rounded-full" style={{ background: meta.color }} />
                  {meta.label}
                  <b className="ml-0.5 tabular-num">{s.count}</b>
                </span>
              );
            })}
          </div>
          {recentCount > 0 && (
            <span className="text-[11px] font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
              ● {recentCount} ใหม่ 24h
            </span>
          )}
        </div>
      )}

      {/* Share link + actions */}
      <div className="mt-1 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-2.5 py-1.5 font-mono text-[11px] text-zinc-600">
            <LinkIcon className="size-3 text-zinc-400 shrink-0" />
            <span className="truncate">/apply/{posting.slug}</span>
          </div>
          <CopyLinkButton slug={posting.slug} />
        </div>
        <div className="flex items-center gap-2">
          <ShareKitButton
            postingId={posting.id}
            slug={posting.slug}
            title={posting.title}
            companyName={posting.company?.name}
            description={posting.description}
            caption={settings.caption}
            coverImageUrl={settings.coverImageUrl}
          />
          <ApplicantShareButton postingId={posting.id} />
          <Link
            href={`/recruit?posting=${posting.id}`}
            className="flex-1 text-center text-xs h-9 px-3 inline-flex items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-700)] font-bold hover:bg-[var(--color-brand-100)] whitespace-nowrap"
          >
            ดู {apply} ใบ →
          </Link>
        </div>
      </div>
    </div>
  );
}

function PostingGroupChips({
  postingId,
  initialTags,
  orgTags,
  canWrite,
}: {
  postingId: string;
  initialTags: string[];
  orgTags: string[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState(initialTags);
  const [, startTransition] = useTransition();

  function persist(next: string[]) {
    const prev = tags;
    setTags(next);
    startTransition(async () => {
      try {
        await updatePosting(postingId, { tags: next });
        router.refresh(); // ให้แถบกรองกลุ่มด้านบนเห็นกลุ่มใหม่ (ถ้าเพิ่งสร้าง)
      } catch (e) {
        setTags(prev);
        toast.error(e instanceof Error ? e.message : "บันทึกกลุ่มไม่สำเร็จ");
      }
    });
  }

  if (!canWrite && tags.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-600"
        >
          #{t}
        </span>
      ))}
      {canWrite && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border border-dashed border-zinc-300 text-zinc-500 hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-700)]"
        >
          <Tags size={11} />
          {tags.length > 0 ? "แก้กลุ่ม" : "ใส่กลุ่ม"}
        </button>
      )}
      {canWrite && (
        <Dialog open={open} onClose={() => setOpen(false)} title="จัดกลุ่มประกาศนี้">
          <p className="text-xs text-zinc-500 mb-3">
            เลือกกลุ่มที่มีอยู่แล้ว หรือพิมพ์ชื่อใหม่แล้วกด &ldquo;เพิ่มกลุ่มใหม่&rdquo; (ประกาศนี้อยู่ได้หลายกลุ่ม)
          </p>
          <TagCombobox
            selected={tags}
            availableTags={orgTags}
            onAdd={(t) => persist([...tags, t])}
            onRemove={(t) => persist(tags.filter((x) => x !== t))}
            placeholder="เช่น แม่บ้าน, คนขับรถ..."
          />
        </Dialog>
      )}
    </div>
  );
}

function MiniFunnel({
  apply,
  screen,
  interview,
  offer,
  hired,
}: {
  apply: number;
  screen: number;
  interview: number;
  offer: number;
  hired: number;
}) {
  const total = Math.max(apply, 1);
  const newBucket = Math.max(apply - screen - interview - offer - hired, 0);
  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-100">
        <div className="bg-green-500" style={{ width: `${(hired / total) * 100}%` }} />
        <div className="bg-purple-500" style={{ width: `${(offer / total) * 100}%` }} />
        <div className="bg-orange-500" style={{ width: `${(interview / total) * 100}%` }} />
        <div className="bg-amber-400" style={{ width: `${(screen / total) * 100}%` }} />
        <div
          className="bg-[var(--color-brand-500)]"
          style={{ width: `${(newBucket / total) * 100}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-[11px] text-zinc-600">
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-[var(--color-brand-500)]" />
          <b className="text-zinc-900 tabular-num">{apply}</b> สมัคร
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-amber-400" />
          คัด <b className="tabular-num">{screen}</b>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-orange-500" />
          สัมภาษณ์ <b className="tabular-num">{interview}</b>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-purple-500" />
          เสนอ <b className="tabular-num">{offer}</b>
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-green-500" />
          รับ <b className="tabular-num text-green-700">{hired}</b>
        </span>
      </div>
    </div>
  );
}
