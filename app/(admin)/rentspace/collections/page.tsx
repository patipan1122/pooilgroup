import Link from "next/link";
import { Search } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { overdueUnits, collectionsSummary } from "@/lib/rentspace/collections";
import { formatBaht } from "@/lib/rentspace/format";
import { RsPage, RsHeader, RsBackLink, RsEmpty } from "@/components/rentspace/ui";
import { CollectionRow } from "./_components/collection-row";

export const dynamic = "force-dynamic";

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? "").trim();
  const session = await requireSession();
  const orgId = session.user.org_id;
  const project = await getPrimaryProject(orgId);

  if (!project) {
    return (
      <RsPage>
        <RsBackLink href="/rentspace" label="กลับหน้าหลัก" />
        <RsHeader title="ห้องค้างชำระ" subtitle="ตามเก็บค่าเช่าที่ยังค้างอยู่" />
        <RsEmpty
          icon="🏗️"
          title="ยังไม่มีโครงการ"
          hint="ตั้งค่าโครงการเช่าก่อนในหน้า ตั้งค่า เพื่อเริ่มออกบิลและตามเก็บ"
          action={
            <Link href="/rentspace/settings" className="rs-btn">
              ไปที่ตั้งค่า
            </Link>
          }
        />
      </RsPage>
    );
  }

  const rooms = await overdueUnits(orgId, project.id, search || undefined);
  const { roomCount, grandTotal } = collectionsSummary(rooms);

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก" />
      <RsHeader title="ห้องค้างชำระ" subtitle="ตามเก็บค่าเช่าที่ยังค้างอยู่ทุกห้องในโครงการ" />

      {/* summary line — rooms owing + grand total (red) */}
      <p className="text-sm" style={{ color: "var(--rs-text-2)" }}>
        {roomCount} ห้อง · ค้างรวม{" "}
        <span className="font-bold tabular-nums" style={{ color: "var(--rs-danger)" }}>
          {formatBaht(grandTotal)}
        </span>
      </p>

      {/* search — server-driven GET form (no JS needed) */}
      <form method="get" className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4"
          style={{ color: "var(--rs-text-3)" }}
        />
        <input
          name="q"
          defaultValue={search}
          placeholder="ค้นหาห้อง / ชื่อผู้เช่า"
          aria-label="ค้นหาห้องค้างชำระ"
          className="w-full h-11 pl-9 pr-4 rounded-xl text-sm"
          style={{ border: "1px solid var(--rs-border)", background: "#fff", color: "var(--rs-text)" }}
        />
      </form>

      {rooms.length === 0 ? (
        <RsEmpty
          icon={search ? "🔍" : "🎉"}
          title={search ? "ไม่พบห้องที่ค้นหา" : "ไม่มีห้องค้างชำระ 🎉"}
          hint={
            search
              ? `ลองค้นด้วยคำอื่น (ค้นหา: "${search}")`
              : "ทุกห้องชำระครบแล้ว — เยี่ยมมาก"
          }
          action={
            search ? (
              <Link href="/rentspace/collections" className="rs-btn rs-btn-ghost">
                ล้างการค้นหา
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2.5">
          {rooms.map((room) => (
            <CollectionRow key={room.unitId} room={room} />
          ))}
        </div>
      )}
    </RsPage>
  );
}
