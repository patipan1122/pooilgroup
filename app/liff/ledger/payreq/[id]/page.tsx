// LedgerLine — in-LIFF payment-request DETAIL (ดูรายละเอียด/จ่าย) · /liff/ledger/payreq/[id]
//
// Opened by the "ดูรายละเอียด / จ่าย" button on the ขอโอนเงิน LINE card. Read-only:
// the 2 executives see the full bill list + net amount + payee (copyable) + a
// PromptPay QR (generated from the stored payee promptpay) so they can pay in one
// scan, then drop the slip back in the group. Auth reuses the /liff layout's
// LiffBootstrap (verified LINE id_token → Pool session) like every other ledger LIFF page.
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { resolveLedgerActor } from "@/lib/ledger/liff-auth";
import { getPaymentRequestDetail } from "@/lib/ledger/payment-request-queries";
import { bankName } from "@/lib/ledger/payment-request-card";
import { PayreqDetailClient } from "./PayreqDetailClient";

export const dynamic = "force-dynamic";

function Center({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-base font-semibold text-zinc-800">{title}</p>
      {sub && <p className="text-sm text-zinc-500">{sub}</p>}
    </div>
  );
}

export default async function LedgerLiffPayreqPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) return <Center title="กำลังเข้าสู่ระบบ" sub="ถ้าค้างนาน · บัญชีนี้อาจยังไม่ได้เปิดใช้ · ติดต่อออฟฟิศ" />;
  const actor = await resolveLedgerActor();
  if (!actor) return <Center title="บัญชียังไม่เปิดใช้งานสำหรับคุณ" sub="ติดต่อออฟฟิศเพื่อผูกบัญชี" />;

  const req = await getPaymentRequestDetail(actor.orgId, id);
  if (!req) return <Center title="ไม่พบคำขอโอนนี้" sub="อาจถูกยกเลิกหรือลบไปแล้ว" />;

  // PromptPay payload (server-side) for the QR — if a promptpay id is on the request.
  let ppPayload: string | null = null;
  if (req.payeePromptpay && req.expectedTransfer > 0) {
    try {
      // promptparse is a server-safe lib (also used for slip QR decode).
      const { generate } = await import("promptparse");
      const target = req.payeePromptpay.replace(/\D/g, "");
      if (target.length >= 10) {
        const type = target.length === 13 ? "NATID" : "MSISDN";
        ppPayload = generate.anyId({ type, target, amount: req.expectedTransfer });
      }
    } catch {
      ppPayload = null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-4">
      <Link
        href="/liff/ledger/my"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[var(--color-brand-600)]"
      >
        <ChevronLeft className="size-4" aria-hidden /> กลับ
      </Link>
      <PayreqDetailClient req={req} bankLabel={bankName(req.payeeBankCode)} ppPayload={ppPayload} />
    </div>
  );
}
