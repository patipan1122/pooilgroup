// LedgerLine — /ledger/bank-recon/scb-history
// ประวัติการดึง statement SCB จาก Gmail (วันไหนดึง · หัวข้อ · กี่บัญชี/รายการ · สำเร็จ/พลาด).
// Reads ledger_email_message (the same table the import records into), filtered to SCB mail.

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Landmark, CheckCircle2, AlertTriangle, MinusCircle, ChevronLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function thDateTime(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("th-TH", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function thDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  imported: { label: "สำเร็จ", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  skipped:  { label: "ไม่มีไฟล์/ข้าม", cls: "bg-zinc-50 text-zinc-500 border-zinc-200", Icon: MinusCircle },
  error:    { label: "พลาด", cls: "bg-rose-50 text-rose-700 border-rose-200", Icon: AlertTriangle },
};

export default async function ScbHistoryPage() {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  const orgId = session.user.org_id;

  const rows = await prisma.ledgerEmailMessage.findMany({
    where: {
      orgId,
      OR: [
        { subject: { contains: "SCB Business Anywhere" } },
        { senderEmail: { contains: "scb.co.th" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, createdAt: true, receivedAt: true,
      subject: true, status: true, note: true,
    },
  });

  const importedCount = rows.filter((r) => r.status === "imported").length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-5">
      <div>
        <Link
          href="/ledger/settings/google"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700"
        >
          <ChevronLeft className="size-4" /> กลับไปการเชื่อมต่อ Google
        </Link>
        <div className="mt-2 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--color-brand-50)] text-[var(--color-brand-700)]">
            <Landmark className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">ประวัติการดึง statement SCB</h1>
            <p className="text-sm text-zinc-500">
              ระบบดึงเข้าอัตโนมัติทุกเช้า 09:00 น. · แสดง {rows.length} ครั้งล่าสุด ({importedCount} ครั้งเข้าข้อมูล)
            </p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 p-10 text-center">
          <Landmark className="mx-auto size-8 text-zinc-300" />
          <p className="mt-2 text-sm text-zinc-500">ยังไม่มีประวัติการดึง</p>
          <p className="mt-1 text-xs text-zinc-400">
            กดปุ่ม &quot;ดึง SCB&quot; ในหน้าการเชื่อมต่อ Google หรือรอระบบดึงเองตอนเช้า
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50/70 text-left text-xs text-zinc-500">
                <th className="px-4 py-2.5 font-medium">เวลาที่ดึง</th>
                <th className="px-4 py-2.5 font-medium">วันที่อีเมล</th>
                <th className="px-4 py-2.5 font-medium">สถานะ</th>
                <th className="px-4 py-2.5 font-medium">รายละเอียด (บัญชี · รายการ)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = STATUS[r.status] ?? STATUS.skipped;
                return (
                  <tr key={r.id} className="border-b border-zinc-50 last:border-0 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{thDateTime(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{thDate(r.receivedAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
                        <s.Icon className="size-3.5" /> {s.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{r.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
