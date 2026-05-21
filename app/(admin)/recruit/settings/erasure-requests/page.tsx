// /recruit/settings/erasure-requests — admin reviews PDPA erasure requests
// Per Recruit Redesign canvas section 13B (PDPASettings · "Right to Erasure" subsection)

import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { requireRecruitAdmin } from "@/lib/recruit/role-guard";
import { prisma } from "@/lib/prisma";
import { Section } from "@/components/ui/section";
import { ErasureRow } from "@/components/recruit/erasure-row";
import { Trash2, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ErasureRequestsPage() {
  const session = await requireSession();
  requireRecruitAdmin(session.user.role);
  const orgId = session.user.org_id;

  const requests = await prisma.recruitErasureRequest.findMany({
    where: { orgId },
    include: {
      applicant: { select: { fullName: true, phone: true, email: true } },
      decidedBy: { select: { name: true } },
    },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });

  const pending = requests.filter((r) => r.status === "PENDING");
  const decided = requests.filter((r) => r.status !== "PENDING");

  return (
    <div className="p-5 sm:p-8 max-w-5xl mx-auto">
      <Section
        number="13.1"
        label="PDPA · Right to erasure"
        title="คำขอลบข้อมูล"
        description="คำขอลบข้อมูลส่วนตัวจากผู้สมัคร · ต้องดำเนินการภายใน 30 วันตามกฎหมาย"
      >
        {pending.length > 0 && (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-900">
                มีคำขอรอพิจารณา {pending.length} รายการ
              </p>
              <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                ตามกฎหมาย PDPA · ต้องดำเนินการ (อนุมัติ/ปฏิเสธ) ภายใน 30 วันนับจากวันที่ขอ
              </p>
            </div>
          </div>
        )}

        {requests.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-zinc-200 bg-white p-12 text-center">
            <Trash2 className="size-12 mx-auto text-zinc-300" />
            <p className="mt-4 font-bold text-zinc-900">ไม่มีคำขอลบข้อมูล</p>
            <p className="text-sm text-zinc-500 mt-1">
              ผู้สมัครสามารถส่งคำขอจากหน้าตามสถานะ <code className="font-mono bg-zinc-100 px-1 rounded">/my/[refId]</code>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pending.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-zinc-900 mb-3">
                  รอพิจารณา ({pending.length})
                </h2>
                <div className="rounded-2xl border border-amber-200 bg-white divide-y divide-zinc-100">
                  {pending.map((r) => (
                    <ErasureRow
                      key={r.id}
                      request={{
                        id: r.id,
                        refId: r.refId,
                        applicantName: r.applicant.fullName,
                        phone: r.applicant.phone,
                        email: r.applicant.email,
                        reason: r.reason,
                        status: r.status,
                        requestedAt: r.requestedAt.toISOString(),
                        decidedAt: r.decidedAt?.toISOString() ?? null,
                        decidedByName: r.decidedBy?.name ?? null,
                        decisionNote: r.decisionNote,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            {decided.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-zinc-900 mb-3">
                  พิจารณาแล้ว ({decided.length})
                </h2>
                <div className="rounded-2xl border border-zinc-200 bg-white divide-y divide-zinc-100">
                  {decided.map((r) => (
                    <ErasureRow
                      key={r.id}
                      request={{
                        id: r.id,
                        refId: r.refId,
                        applicantName: r.applicant.fullName,
                        phone: r.applicant.phone,
                        email: r.applicant.email,
                        reason: r.reason,
                        status: r.status,
                        requestedAt: r.requestedAt.toISOString(),
                        decidedAt: r.decidedAt?.toISOString() ?? null,
                        decidedByName: r.decidedBy?.name ?? null,
                        decisionNote: r.decisionNote,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-6">
          <Link
            href="/recruit/settings/pdpa"
            className="text-xs font-bold text-[var(--color-brand-700)] hover:underline"
          >
            ← กลับไปหน้า PDPA Compliance
          </Link>
        </div>
      </Section>
    </div>
  );
}
