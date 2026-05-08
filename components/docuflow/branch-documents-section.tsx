// BranchDocumentsSection — DocuFlow Mode 2 (Branch → Documents)
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §8 (lines 422-447)
//
// แสดง 5 หมวดของเอกสารที่ apply กับสาขาหนึ่ง:
//   1. เอกสารเฉพาะสาขา        ownership.level=branch  + branchId
//   2. เอกสารร่วม (ประเภทธุรกิจ) ownership.level=business_type + businessType
//   3. เอกสารจากบริษัท         ownership.level=company + companyId
//   4. เอกสารกลุ่ม              ownership.level=group
//   5. ใช้ร่วมจากสาขาอื่น       document_shared_branches.branchId
//
// Server component — เรียก canonical loaders ใน lib/docuflow/data.ts
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { FileText, AlertTriangle } from "lucide-react";
import {
  loadDocuments,
  loadDocumentsSharedToBranch,
} from "@/lib/docuflow/data";
import { Card, CardBody } from "@/components/ui/card";

interface Props {
  orgId: string;
  branchId: string;
  /** ใช้กรองเอกสารระดับบริษัท */
  companyId: string | null;
  /** ใช้กรองเอกสารระดับประเภทธุรกิจ */
  businessType: string;
}

/**
 * รายการการ์ดสรุปจำนวนเอกสารที่ apply กับสาขา + ปุ่ม "ดูรายการ"
 * ลิงก์ไป /docuflow/documents พร้อม searchParams ที่ list page รับรู้
 */
export async function BranchDocumentsSection({
  orgId,
  branchId,
  companyId,
  businessType,
}: Props) {
  // Five buckets — paralleled to keep page fast.
  const [
    branchOwnDocs,
    bizTypeDocs,
    companyDocs,
    groupDocs,
    sharedDocs,
  ] = await Promise.all([
    loadDocuments(orgId, {
      level: "branch",
      branchId,
      limit: 200,
    }),
    loadDocuments(orgId, {
      level: "business_type",
      businessType,
      limit: 200,
    }),
    companyId
      ? loadDocuments(orgId, {
          level: "company",
          companyId,
          limit: 200,
        })
      : Promise.resolve([]),
    loadDocuments(orgId, {
      level: "group",
      limit: 200,
    }),
    loadDocumentsSharedToBranch(orgId, branchId, { limit: 200 }),
  ]);

  // Total = unique docs across all buckets (avoid double-counting if a doc has
  // both ownership AND a shared row — rare but possible)
  const allIds = new Set<string>();
  for (const d of branchOwnDocs) allIds.add(d.id);
  for (const d of bizTypeDocs) allIds.add(d.id);
  for (const d of companyDocs) allIds.add(d.id);
  for (const d of groupDocs) allIds.add(d.id);
  for (const d of sharedDocs) allIds.add(d.id);
  const total = allIds.size;

  // Helper: count expiring docs (≤90 days) in a bucket — surface compliance risk
  const countAtRisk = (docs: { renewal: { expiryStatus: string } | null }[]) =>
    docs.filter(
      (d) =>
        d.renewal &&
        ["expired", "critical", "urgent", "watch"].includes(
          d.renewal.expiryStatus,
        ),
    ).length;

  const buckets: BucketProps[] = [
    {
      title: "เอกสารเฉพาะสาขา",
      hint: "ผูกกับสาขานี้โดยตรง",
      count: branchOwnDocs.length,
      atRisk: countAtRisk(branchOwnDocs),
      href: `/docuflow/documents?level=branch&branchId=${encodeURIComponent(branchId)}`,
    },
    {
      title: "เอกสารร่วม (ประเภทธุรกิจ)",
      hint: `ใช้กับทุกสาขาประเภทเดียวกัน`,
      count: bizTypeDocs.length,
      atRisk: countAtRisk(bizTypeDocs),
      href: `/docuflow/documents?level=business_type&businessType=${encodeURIComponent(businessType)}`,
    },
    {
      title: "เอกสารจากบริษัท",
      hint: companyId
        ? "ระดับนิติบุคคลของสาขา"
        : "สาขายังไม่ได้กำหนดบริษัท",
      count: companyDocs.length,
      atRisk: countAtRisk(companyDocs),
      href: companyId
        ? `/docuflow/documents?level=company&companyId=${encodeURIComponent(companyId)}`
        : null,
    },
    {
      title: "เอกสารกลุ่ม",
      hint: "Pooilgroup ทั้งกลุ่ม",
      count: groupDocs.length,
      atRisk: countAtRisk(groupDocs),
      href: `/docuflow/documents?level=group`,
    },
    {
      title: "ใช้ร่วมจากสาขาอื่น",
      hint: "เอกสารที่ share เข้ามายังสาขานี้",
      count: sharedDocs.length,
      atRisk: countAtRisk(sharedDocs),
      href: `/docuflow/documents?branchId=${encodeURIComponent(branchId)}&shared=1`,
    },
  ];

  return (
    <Card>
      <CardBody className="space-y-4">
        {/* Total summary row */}
        <div className="flex items-end justify-between gap-3 pb-3 border-b border-zinc-100">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold">
              รวมเอกสารที่ apply กับสาขานี้
            </p>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums mt-0.5">
              {total} <span className="text-sm text-zinc-500 font-medium">ไฟล์</span>
            </div>
          </div>
          <Link
            href={`/docuflow/documents?branchId=${encodeURIComponent(branchId)}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-700)] hover:underline"
          >
            <FileText className="size-4" />
            ดูทั้งหมด
          </Link>
        </div>

        {/* Bucket grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {buckets.map((b) => (
            <BucketCard key={b.title} {...b} />
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

interface BucketProps {
  title: string;
  hint: string;
  count: number;
  atRisk: number;
  href: string | null;
}

function BucketCard({ title, hint, count, atRisk, href }: BucketProps) {
  const inner = (
    <div className="flex flex-col gap-1.5 rounded-xl border-2 border-zinc-200 bg-white p-4 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)]/30 transition-colors h-full">
      <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold">
        {title}
      </p>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold tabular-nums text-zinc-900 leading-none">
          {count}
        </span>
        <span className="text-xs text-zinc-500 mb-0.5">ไฟล์</span>
      </div>
      <p className="text-xs text-zinc-500 mt-0.5">{hint}</p>
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-zinc-100">
        {atRisk > 0 ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700">
            <AlertTriangle className="size-3" />
            ใกล้หมดอายุ {atRisk}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-400">ปลอดภัย</span>
        )}
        {href ? (
          <span className="text-xs font-medium text-[var(--color-brand-700)]">
            ดูรายการ →
          </span>
        ) : (
          <span className="text-xs text-zinc-300">—</span>
        )}
      </div>
    </div>
  );

  if (!href) {
    return <div className="opacity-70 cursor-not-allowed">{inner}</div>;
  }

  return (
    <Link href={href} className="block">
      {inner}
    </Link>
  );
}
