// Maid mobile parts hub · /chairops/m/parts.
// Was missing entirely (only /m/parts/new existed) — the maid could submit a
// part request but had NO way to see what they'd asked for, so the request
// "disappeared" (CEO 2026-06-03: "ทำแล้วหาไม่เจอ"). This mirrors the damage hub:
// list this maid's recent requests + a "เบิกใหม่" CTA.
//
// A maid request is a ChairopsSparePartMovement with delta=0 and reason starting
// with MAID_PART_REQUEST_PREFIX ("maid-request:PENDING · qty=<n> · <note>"), the
// same shape office reads in parts-requests-pane.tsx. There is no per-row status
// flip — office fulfils by writing a separate stock movement — so every row here
// is shown as "รออนุมัติ" honestly.
import Link from "next/link";
import { requireExactRole } from "@/lib/chairops/auth/session";
import { prisma } from "@/lib/prisma";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiRelative } from "@/lib/chairops/utils/format";
import { MAID_PART_REQUEST_PREFIX } from "@/lib/chairops/parts/constants";
import { CircleAlert, Package, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

/** Parses "<prefix> · qty=<n> · <free-text>" — kept in sync with lib/chairops/parts/actions.ts. */
function parseRequestReason(raw: string): { qty: number | null; note: string } {
  const body = raw.startsWith(MAID_PART_REQUEST_PREFIX)
    ? raw.slice(MAID_PART_REQUEST_PREFIX.length).replace(/^\s*·\s*/, "")
    : raw;
  const m = body.match(/^qty=(\d+)\s*·\s*(.*)$/);
  if (!m) return { qty: null, note: body };
  return { qty: Number(m[1]), note: m[2] ?? "" };
}

export default async function MaidPartsHubPage() {
  const session = await requireExactRole("MAID");
  const branchId = session.user.primaryBranchId;
  if (!branchId) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardBody className="space-y-2 p-5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-800">
            <CircleAlert className="h-5 w-5" />
            ยังไม่ได้ผูกสาขา
          </div>
          <p className="text-amber-700">ติดต่อออฟฟิศก่อนเบิกของ</p>
        </CardBody>
      </Card>
    );
  }

  const requests = await prisma.chairopsSparePartMovement.findMany({
    where: {
      orgId: session.user.orgId,
      // branchId so the hub scope matches the dedup scope in requestPartFromMaid (P0-3)
      branchId,
      byUserId: session.user.id, // this maid's own requests
      delta: 0,
      reason: { startsWith: MAID_PART_REQUEST_PREFIX },
    },
    orderBy: { at: "desc" },
    take: 20,
    select: {
      id: true,
      reason: true,
      at: true,
      part: { select: { name: true, unit: true, partCode: true } },
    },
  });

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-zinc-900">📦 เบิกของ</h1>
        <p className="text-sm text-zinc-500">
          {requests.length === 0
            ? "ยังไม่เคยเบิกของ"
            : `${requests.length} รายการที่เบิกล่าสุด`}
        </p>
      </header>

      <Link
        href="/chairops/m/parts/new"
        className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-base font-semibold text-white transition-colors active:bg-emerald-700"
      >
        <Plus className="size-5" aria-hidden /> เบิกของใหม่
      </Link>

      {requests.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 p-8 text-center">
            {/* น้องแมวน้ำพักผ่อน — ยังไม่มีรายการเบิก */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/mascot/banner/seal-onsen.jpg"
              alt=""
              aria-hidden
              className="h-32 w-auto rounded-xl"
            />
            <p className="text-sm text-zinc-500">
              ยังไม่เคยเบิกของ · กดปุ่มด้านบนเพื่อเบิกอะไหล่/ของใช้
            </p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const { qty, note } = parseRequestReason(r.reason);
            return (
              <li key={r.id}>
                <Card>
                  <CardBody className="flex items-center gap-3 p-3.5">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                      <Package className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 grow space-y-0.5">
                      <div className="truncate text-sm font-semibold text-zinc-900">
                        {r.part.name}
                        {qty !== null && (
                          <span className="font-normal text-zinc-500">
                            {" "}
                            · {qty} {r.part.unit}
                          </span>
                        )}
                      </div>
                      {note && (
                        <div className="truncate text-xs text-zinc-500">{note}</div>
                      )}
                      <div className="text-xs text-zinc-400">
                        เบิกเมื่อ {thaiRelative(r.at)}
                      </div>
                    </div>
                    <Badge tone="warning" className="shrink-0">
                      รออนุมัติ
                    </Badge>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
