import Link from "next/link";
import { XCircle } from "lucide-react";

export default async function CancelPage({ params }: { params: Promise<{ branchSlug: string; bookingId: string }> }) {
  const { branchSlug } = await params;
  return (
    <div style={{ maxWidth: 540, margin: "0 auto", padding: "48px 16px", textAlign: "center" }}>
      <XCircle size={64} color="var(--pl-danger)" style={{ margin: "0 auto 16px" }} />
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>ยกเลิกการชำระเงิน</h1>
      <p style={{ color: "var(--pl-text-muted)", marginBottom: 24 }}>การจองยังไม่ confirmed · ลองใหม่ได้</p>
      <Link href={`/p/playland/${branchSlug}/book`} className="pl-btn pl-btn-primary">จองใหม่</Link>
    </div>
  );
}
