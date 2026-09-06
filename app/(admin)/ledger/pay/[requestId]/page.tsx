// LedgerLine — หน้า "แนบสลิป · จ่าย" ต่อคำขอโอน (CEO 2026-07-26) · /ledger/pay/[requestId]
//
// เปิดจากปุ่ม "📎 แนบสลิป" บนการ์ดขอโอนใน LINE. อยู่ใน (admin) → ครอบด้วย AdminShell
// (เมนูโปรแกรมครบ · hamburger/sidebar) → ผู้บริหารกดไปหน้าอื่นได้ ไม่ใช่หน้าตัน (ต่างจาก
// หน้า LIFF อ่านล้วนเดิม). โชว์ยอด+ผู้รับให้ยืนยัน แล้วอัปสลิปตรงนี้ → ระบบจับคู่+ปิดบิล+
// ออกใบสำคัญจ่ายอัตโนมัติ (money-core เดียวกับเส้น LINE · attachSlipToRequestAction).
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getPaymentRequestDetail } from "@/lib/ledger/payment-request-queries";
import { bankName } from "@/lib/ledger/payment-request-card";
import { AttachSlipForm } from "./AttachSlipForm";

export const dynamic = "force-dynamic";

const baht = (n: number) =>
  "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function LedgerPayPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  // เข้าถึงได้เฉพาะผู้ใช้เว็บสายการเงิน (เหมือนหน้ารายจ่าย) — ผู้บริหาร/บัญชี/ผู้ดูแล.
  const session = await requireRole(
    "super_admin",
    "org_admin",
    "admin",
    "area_manager",
    "viewer",
    "program_admin",
  );
  const req = await getPaymentRequestDetail(session.user.org_id, requestId);
  const acct = req?.payeeAcctNo ?? req?.payeePromptpay ?? null;
  const bank = req ? bankName(req.payeeBankCode) : null;

  return (
    <div className="p-4 sm:px-6 sm:pt-6 sm:pb-8">
      <div className="mx-auto max-w-md">
        <Link
          href="/ledger/to-pay"
          className="press mb-4 inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)]"
        >
          ← กลับไปบิลที่ต้องจ่าย
        </Link>

        {!req ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
            <p className="text-base font-semibold text-zinc-800">ไม่พบคำขอโอนนี้</p>
            <p className="mt-1 text-sm text-zinc-500">อาจถูกยกเลิกหรือลบไปแล้ว</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* สรุปคำขอ — ยืนยันว่าจ่ายถูกใบ/ถูกยอด ก่อนแนบสลิป */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5">
              <p className="text-sm text-zinc-500">
                ยอดที่ต้องโอน{req.vendor ? ` · ${req.vendor}` : ""}
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-900">
                {baht(req.expectedTransfer)}
              </p>
              <div className="mt-3 space-y-1 text-sm text-zinc-600">
                {req.payeeAcctName && (
                  <p>
                    ผู้รับ:{" "}
                    <span className="font-medium text-zinc-800">{req.payeeAcctName}</span>
                  </p>
                )}
                {acct && (
                  <p>
                    บัญชี: <span className="font-mono text-zinc-800">{acct}</span>
                    {bank ? ` · ${bank}` : ""}
                  </p>
                )}
                <p className="text-zinc-400">{req.bills.length} บิลในคำขอนี้</p>
              </div>
            </div>

            {/* สถานะ / ฟอร์มแนบสลิป */}
            {req.state === "paid" ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                <p className="text-base font-semibold text-emerald-700">✓ จ่ายครบแล้ว</p>
                <p className="mt-1 text-sm text-emerald-600">
                  คำขอนี้ปิดเรียบร้อย · ระบบบันทึกการจ่าย + ออกใบสำคัญจ่ายให้แล้ว
                </p>
              </div>
            ) : req.state === "cancelled" || req.state === "reversed" ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-center text-sm text-zinc-600">
                คำขอนี้ถูกยกเลิก/ทำรายการคืนแล้ว — แนบสลิปไม่ได้
              </div>
            ) : (
              <AttachSlipForm requestId={requestId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
