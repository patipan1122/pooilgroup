"use client";

import { useRouter } from "next/navigation";

interface Props {
  postings: Array<{ id: string; title: string }>;
  currentValue?: string;
}

export function PipelineFilter({ postings, currentValue }: Props) {
  const router = useRouter();
  return (
    <select
      defaultValue={currentValue ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        router.push(v ? `/recruit/pipeline?posting=${v}` : "/recruit/pipeline");
      }}
      className="text-xs px-3 py-2 rounded-lg border border-zinc-300 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-300)]"
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
