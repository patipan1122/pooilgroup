import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionDetail } from "@/lib/clawfleet/queries";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { CollectForm } from "@/components/clawfleet/collect-form";

export const dynamic = "force-dynamic";

export default async function CollectPage({
  params,
}: {
  params: Promise<{ id: string; machineCode: string }>;
}) {
  const { id, machineCode } = await params;
  const session = await requireSession();
  const cf = await getSessionDetail(id);
  if (!cf) notFound();
  if (cf.status !== "OPEN") {
    redirect(`/clawfleet/sessions/${id}`);
  }
  // Legacy collect flow is group-scoped only. Branch-level v2 sessions (group=null)
  // never reach this page; if they somehow do, there is no group machine list to collect.
  if (!cf.group) notFound();
  const machine = cf.group.machines.find((m) => m.code === machineCode);
  if (!machine) notFound();
  // duplicate guard: already collected in this session?
  const already = cf.events.find(
    (e) => e.machineId === machine.id && e.eventType === "COLLECTION",
  );
  if (already) redirect(`/clawfleet/sessions/${id}`);

  // pricing snapshot
  const loadout = machine.loadouts[0];
  const exchLoadout =
    machine.kind === "EXCHANGER"
      ? await prisma.cfExchangerLoadout.findFirst({
          where: { machineId: machine.id, effectiveTo: null },
          orderBy: { effectiveFrom: "desc" },
        })
      : null;

  return (
    <div className="mx-auto max-w-md space-y-4 p-3 sm:p-6">
      <Link
        href={`/clawfleet/sessions/${id}`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
      >
        <ArrowLeft className="h-4 w-4" /> กลับรอบเก็บ
      </Link>

      <CollectForm
        sessionId={cf.id}
        sessionCode={cf.sessionCode}
        machineId={machine.id}
        machineCode={machine.code}
        machineKind={machine.kind}
        qrToken={machine.qrToken}
        lastCoinMeter={machine.lastCoinMeter}
        lastDollMeter={machine.lastDollMeter}
        lastDollStock={machine.lastDollStock}
        productName={loadout?.product.name ?? null}
        pricePerPlayCoins={loadout?.pricePerPlayCoins ?? 1}
        baseCoinPerBaht={
          exchLoadout ? Number(exchLoadout.baseCoinPerBaht) : 1
        }
        userId={session.user.id}
        orgId={session.user.org_id}
      />
    </div>
  );
}
