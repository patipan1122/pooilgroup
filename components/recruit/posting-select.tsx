"use client";

// ตัวเลือกตำแหน่งบนหน้าตาราง — เลือกแล้วกางคำตอบเป็นคอลัมน์ได้
// นำทางด้วย router.push (คงตัวกรอง status/q/sort เดิม · รีเซ็ตหน้าเป็น 1)

import { useRouter } from "next/navigation";

interface Props {
  postings: Array<{ id: string; title: string }>;
  currentPosting: string | null;
  status: string | null;
  q: string;
  sort: string;
}

export function PostingSelect({
  postings,
  currentPosting,
  status,
  q,
  sort,
}: Props) {
  const router = useRouter();

  function go(posting: string) {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (posting) sp.set("posting", posting);
    if (q) sp.set("q", q);
    if (sort && sort !== "recent") sp.set("sort", sort);
    const qs = sp.toString();
    router.push(`/recruit/table${qs ? `?${qs}` : ""}`);
  }

  return (
    <select
      value={currentPosting ?? ""}
      onChange={(e) => go(e.target.value)}
      className="h-10 max-w-[240px] truncate rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
      title="เลือกตำแหน่งเพื่อกางคำตอบเป็นคอลัมน์"
    >
      <option value="">ทุกตำแหน่ง</option>
      {postings.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </select>
  );
}
