// Playland · Wristband scanner · cashier scans QR → lookup + action picker

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { listBranches, listPackages } from "@/lib/playland/queries";
import { WristbandScanInput } from "@/components/playland/wristband-scan-input";
import { ArrowLeft, ScanQrCode } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ScanPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const sp = await searchParams;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;
  if (!branchId) return <div className="pl-page"><header className="pl-header"><h1>ตั้งค่าสาขาก่อน</h1></header></div>;

  const packages = await listPackages(orgId, branchId);

  return (
    <div className="pl-page">
      <header className="pl-header">
        <div>
          <Link href="/playland" className="pl-eyebrow" style={{ textDecoration: "none" }}><ArrowLeft size={11} /> Workspace</Link>
          <h1><ScanQrCode size={18} style={{ display: "inline", marginRight: 6, verticalAlign: -3 }} />สแกน wristband</h1>
        </div>
        <Link href="/playland/wristbands" className="pl-btn">ออก wristband ใหม่</Link>
      </header>

      <div style={{ overflowY: "auto", padding: 20, maxWidth: 720, margin: "0 auto", width: "100%" }}>
        <WristbandScanInput
          branchId={branchId}
          packages={packages.map((p) => ({ id: p.id, name: p.name, price: p.price, minutes: p.minutes, type: p.type }))}
        />
      </div>
    </div>
  );
}
