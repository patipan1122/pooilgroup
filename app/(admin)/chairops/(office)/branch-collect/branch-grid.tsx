"use client";

// Client island ONLY for the live search filter — navigation is plain <Link>,
// same split as reconcile-sidebar.tsx's own search box.
// ultramobileux audit P1 (2026-10-07): this picker listed all 54 branches
// with no way to search/filter — reuses that reconcile pattern.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Banknote, ChevronRight } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";

export interface BranchCollectRow {
  id: string;
  name: string;
  city: string | null;
  chairCount: number;
  maidName: string | null;
}

export function BranchCollectGrid({ branches }: { branches: BranchCollectRow[] }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return branches;
    return branches.filter(
      (b) =>
        b.name.toLowerCase().includes(query) ||
        (b.city ?? "").toLowerCase().includes(query) ||
        (b.maidName ?? "").toLowerCase().includes(query),
    );
  }, [q, branches]);

  return (
    <>
      <div className="relative mb-3 sm:max-w-sm">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
          aria-hidden
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาสาขา / แม่บ้าน…"
          aria-label="ค้นหาสาขา"
          className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((b) => {
          const hasChairs = b.chairCount > 0;
          return (
            <li key={b.id}>
              <Card
                className={hasChairs ? "border-zinc-200" : "border-amber-200 bg-amber-50/50"}
              >
                <CardBody className="space-y-3 p-4">
                  <div className="space-y-1">
                    <div className="font-semibold text-zinc-900">{b.name}</div>
                    <div className="text-xs text-zinc-500">
                      {b.city ?? "—"} · {b.chairCount} เก้าอี้
                      {b.maidName ? ` · แม่บ้าน ${b.maidName}` : ""}
                    </div>
                  </div>
                  {hasChairs ? (
                    <Link
                      href={`/chairops/collect/${b.id}/new`}
                      className="inline-flex w-full items-center justify-between gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white active:bg-emerald-700"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Banknote className="size-4" aria-hidden />
                        เก็บเงินสาขานี้
                      </span>
                      <ChevronRight className="size-4" aria-hidden />
                    </Link>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-md border border-amber-200 bg-white p-2 text-xs text-amber-700">
                        ยังไม่มีเก้าอี้ในสาขา
                      </div>
                      <Link
                        href={`/chairops/branches/${b.id}/chairs/add`}
                        className="inline-flex w-full items-center justify-between gap-2 rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-800 active:bg-amber-50"
                      >
                        + เพิ่มเก้าอี้สาขานี้
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    </div>
                  )}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>

      {filtered.length === 0 && (
        <Card className="border-zinc-200">
          <CardBody className="p-4 text-sm text-zinc-500">
            ไม่พบสาขาที่ตรงกับ &quot;{q}&quot;
          </CardBody>
        </Card>
      )}
    </>
  );
}
