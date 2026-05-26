import { requireSession } from "@/lib/auth/session";
import { listBranches, listProducts } from "@/lib/playland/queries";
import { PosClient } from "@/components/playland/pos-client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function PosPage({ searchParams }: { searchParams: Promise<{ branch?: string; session?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;

  if (!branchId) {
    return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;
  }

  // Charge-to-bill linkage: when arriving from Session Inspector with ?session=<id>,
  // verify the session belongs to this org+branch and is active · pass to PosClient
  // so createSale() records sessionId (bill rolls up at member check-out).
  let chargeSession: { id: string; memberName: string } | null = null;
  if (sp.session) {
    const s = await prisma.playlandSession.findFirst({
      where: { id: sp.session, orgId, branchId, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true, member: { select: { name: true, nickname: true } } },
    });
    if (s) chargeSession = { id: s.id, memberName: s.member.nickname ?? s.member.name };
  }

  const products = await listProducts(orgId, branchId);
  return <PosClient
    branchId={branchId}
    chargeSession={chargeSession}
    products={products.map((p) => ({
      id: p.id, name: p.name, priceCents: p.priceCents, stock: p.stock, barcode: p.barcode, category: p.category,
    }))}
  />;
}
