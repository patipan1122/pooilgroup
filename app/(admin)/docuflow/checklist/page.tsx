// DocuFlow · Checklist เอกสารที่ต้องมี (per business type)
// ────────────────────────────────────────────────────────────────────
// แสดงเทียบ "เอกสารที่อัปโหลดแล้ว" vs "เอกสารที่กฎหมายกำหนดให้ต้องมี"
// ต่อ business type — ช่วยผู้บริหารเห็น compliance gap ทันที
//
// Data sources:
//   - Canonical: lib/docuflow/canonical-docs.ts (static, ไม่มี orgId)
//   - Uploaded : lib/docuflow/data.ts → loadDocuments(orgId, { businessType })
//
// Spec: ดีเทลv1/DOCUFLOW.md §3 (เอกสารตามประเภทธุรกิจ)
// ────────────────────────────────────────────────────────────────────

import Link from "next/link";
import {
  CheckSquare,
  Upload,
  CheckCircle2,
  XCircle,
  ChevronRight,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { isAdminTier } from "@/lib/auth/module-access";
import { loadDocuments } from "@/lib/docuflow/data";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  getCanonicalDocsForBizType,
  listSupportedBizTypes,
  DOC_DANGER_TONE,
  type CanonicalDocSpec,
  type CanonicalBizType,
} from "@/lib/docuflow/canonical-docs";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

// FuelOS biztypes ที่ไม่มีใน BUSINESS_TYPES registry — ใส่ label/emoji เอง
const EXTRA_BIZTYPE_META: Record<
  string,
  { label: string; emoji: string }
> = {
  transport: { label: "ขนส่ง", emoji: "🚛" },
  gas_fleet: { label: "รถก๊าซ/Delivery", emoji: "🚚" },
};

interface ChecklistRow {
  bizType: CanonicalBizType;
  label: string;
  emoji: string;
  canonical: CanonicalDocSpec[];
  /** uploaded — distinct doc names ที่อัปโหลดผูก biztype นี้ */
  uploadedNames: Set<string>;
  /** total uploaded ฉบับ (รวม duplicate sub-branches) */
  uploadedCount: number;
  /** matched canonical specs (อัปโหลดครบแล้ว) */
  matched: CanonicalDocSpec[];
  /** missing canonical specs */
  missing: CanonicalDocSpec[];
}

/**
 * Match canonical name → uploaded name (fuzzy substring both ways)
 * เพื่อให้ทนต่อชื่อที่ admin พิมพ์ยาว/สั้นกว่ามาตรฐาน
 */
function matchCanonical(
  canonical: CanonicalDocSpec[],
  uploadedNames: Set<string>,
): { matched: CanonicalDocSpec[]; missing: CanonicalDocSpec[] } {
  const uploadedLowerArr = Array.from(uploadedNames).map((n) =>
    n.toLowerCase(),
  );
  const matched: CanonicalDocSpec[] = [];
  const missing: CanonicalDocSpec[] = [];
  for (const c of canonical) {
    const cLower = c.name.toLowerCase();
    const hit = uploadedLowerArr.some(
      (u) => u.includes(cLower) || cLower.includes(u),
    );
    if (hit) matched.push(c);
    else missing.push(c);
  }
  return { matched, missing };
}

export default async function DocuFlowChecklistPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);
  const orgId = session.user.org_id;
  const adminTier = isAdminTier(session.user.role);

  // Fetch uploaded docs ต่อ biztype แบบขนาน (max 14 biztype × 50 = 700 docs)
  const supported = listSupportedBizTypes();
  const rowsRaw = await Promise.all(
    supported.map(async (bt): Promise<ChecklistRow> => {
      const meta =
        BUSINESS_TYPES[bt] ??
        EXTRA_BIZTYPE_META[bt] ?? { label: bt, emoji: "📦" };

      const canonical = getCanonicalDocsForBizType(bt);
      const uploaded = await loadDocuments(orgId, {
        businessType: bt,
        limit: 200,
      });

      const uploadedNames = new Set(uploaded.map((d) => d.name));
      const { matched, missing } = matchCanonical(canonical, uploadedNames);

      return {
        bizType: bt,
        label: meta.label,
        emoji: meta.emoji,
        canonical,
        uploadedNames,
        uploadedCount: uploaded.length,
        matched,
        missing,
      };
    }),
  );

  // เรียงตาม % ขาด มากสุดก่อน (เน้น compliance gap)
  const rows = rowsRaw.sort((a, b) => {
    const aRatio = a.canonical.length === 0 ? 0 : a.missing.length / a.canonical.length;
    const bRatio = b.canonical.length === 0 ? 0 : b.missing.length / b.canonical.length;
    return bRatio - aRatio;
  });

  // Org-wide stats
  const totalCanonical = rows.reduce((s, r) => s + r.canonical.length, 0);
  const totalMatched = rows.reduce((s, r) => s + r.matched.length, 0);
  const totalMissing = rows.reduce((s, r) => s + r.missing.length, 0);
  const overallPct =
    totalCanonical === 0 ? 100 : Math.round((totalMatched / totalCanonical) * 100);

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <header className="mb-6 animate-fade-up">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold">
          📄 DocuFlow · {thaiDateLong(new Date())}
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[0.95]">
          Checklist <span className="text-gradient-blue">เอกสารที่ต้องมี</span>
        </h1>
        <p className="text-zinc-600 mt-1.5 text-sm max-w-3xl">
          เทียบเอกสารที่อัปโหลดแล้วกับมาตรฐานกฎหมาย ต่อประเภทธุรกิจ —
          ตามสเปคในคู่มือ DOCUFLOW §3
        </p>
      </header>

      {/* Summary stat */}
      <Section
        number="01"
        label="OVERVIEW"
        title="ภาพรวม Compliance"
        className="mb-10 animate-fade-up delay-100"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="hover-lift">
            <CardBody className="p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-zinc-500">
                ตามกฎหมายต้องมี
              </p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-zinc-900">
                {totalCanonical.toLocaleString("th-TH")}
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">
                รวมทุกประเภทธุรกิจ
              </p>
            </CardBody>
          </Card>
          <Card className="hover-lift">
            <CardBody className="p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-green-700">
                อัปโหลดครบแล้ว
              </p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-green-700">
                {totalMatched.toLocaleString("th-TH")}
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">
                ตรงกับ canonical
              </p>
            </CardBody>
          </Card>
          <Card className="hover-lift">
            <CardBody className="p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-rose-700">
                ยังขาด
              </p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-rose-700">
                {totalMissing.toLocaleString("th-TH")}
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">ต้องอัปโหลด</p>
            </CardBody>
          </Card>
          <Card className="hover-lift">
            <CardBody className="p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-[var(--color-brand-700)]">
                Compliance
              </p>
              <p className="mt-2 text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight text-[var(--color-brand-700)]">
                {overallPct}%
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">ครบถ้วนรวม</p>
            </CardBody>
          </Card>
        </div>
      </Section>

      {/* Per-biztype breakdown */}
      <Section
        number="02"
        label="BY BIZTYPE"
        title="แยกตามประเภทธุรกิจ"
        description="เรียงตามสัดส่วน 'ยังขาด' มากสุดก่อน"
        className="mb-10 animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((r) => {
            const total = r.canonical.length;
            const pct =
              total === 0 ? 100 : Math.round((r.matched.length / total) * 100);

            return (
              <Card key={r.bizType} className="overflow-hidden">
                <CardBody className="p-0">
                  {/* Header */}
                  <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="size-10 shrink-0 rounded-xl bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-xl">
                        {r.emoji}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-zinc-900 text-base truncate font-display">
                          {r.label}
                        </p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          ตามกฎหมาย {total} · อัปโหลด {r.uploadedCount} ฉบับ
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`text-xl font-extrabold tabular-nums tracking-tight ${
                          pct >= 80
                            ? "text-green-700"
                            : pct >= 40
                              ? "text-amber-700"
                              : "text-rose-700"
                        }`}
                      >
                        {pct}%
                      </p>
                      <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-zinc-400">
                        Compliance
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 bg-zinc-100">
                    <div
                      className={`h-full transition-all ${
                        pct >= 80
                          ? "bg-green-500"
                          : pct >= 40
                            ? "bg-amber-500"
                            : "bg-rose-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  {/* Body — ✅ matched + ❌ missing list */}
                  <div className="p-5 space-y-3">
                    {/* Missing first (more urgent) */}
                    {r.missing.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <XCircle className="size-3.5 text-rose-700" />
                          <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-rose-700">
                            ยังไม่มี ({r.missing.length})
                          </p>
                        </div>
                        <ul className="space-y-1.5">
                          {r.missing.slice(0, 6).map((m) => (
                            <li
                              key={m.name}
                              className="flex items-start gap-2 text-sm"
                            >
                              <span className="text-rose-400 select-none mt-[3px]">
                                •
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-zinc-800 truncate">
                                  {m.name}
                                </p>
                                <p className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                  <span>{m.frequency}</span>
                                  {m.regulator && (
                                    <>
                                      <span className="text-zinc-300">·</span>
                                      <span className="truncate">
                                        {m.regulator}
                                      </span>
                                    </>
                                  )}
                                  <Badge tone={DOC_DANGER_TONE[m.dangerLevel]}>
                                    {m.dangerLevel}
                                  </Badge>
                                </p>
                              </div>
                            </li>
                          ))}
                          {r.missing.length > 6 && (
                            <li className="text-[11px] text-zinc-500 pl-4">
                              + อีก {r.missing.length - 6} รายการ
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {/* Matched (already uploaded) */}
                    {r.matched.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="size-3.5 text-green-700" />
                          <p className="text-[11px] uppercase tracking-[0.16em] font-bold text-green-700">
                            อัปโหลดแล้ว ({r.matched.length})
                          </p>
                        </div>
                        <ul className="space-y-1">
                          {r.matched.slice(0, 4).map((m) => (
                            <li
                              key={m.name}
                              className="text-sm text-zinc-600 flex items-center gap-2"
                            >
                              <span className="text-green-400 select-none">
                                ✓
                              </span>
                              <span className="truncate">{m.name}</span>
                            </li>
                          ))}
                          {r.matched.length > 4 && (
                            <li className="text-[11px] text-zinc-500 pl-5">
                              + อีก {r.matched.length - 4} รายการ
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {r.canonical.length === 0 && (
                      <p className="text-sm text-zinc-500 text-center py-4">
                        ยังไม่มีรายการมาตรฐานสำหรับประเภทธุรกิจนี้
                      </p>
                    )}
                  </div>

                  {/* Footer action */}
                  {r.missing.length > 0 && adminTier && (
                    <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50/40">
                      <Link
                        href={`/docuflow/documents/upload?businessType=${r.bizType}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)]"
                      >
                        <Upload className="size-3.5" />
                        อัปโหลดเดี๋ยวนี้
                        <ChevronRight className="size-3.5" />
                      </Link>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* Footer help */}
      <Card className="bg-[var(--color-brand-50)] border-[var(--color-brand-200)]">
        <CardBody className="flex items-start gap-3">
          <CheckSquare className="size-5 text-[var(--color-brand-700)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-zinc-900">
              ทำไมต้องเช็ค checklist นี้?
            </p>
            <p className="text-sm text-zinc-700 mt-1 leading-relaxed">
              เอกสารตามกฎหมายต้องมีครบ — ขาดแม้แต่ใบเดียวก็โดนปิดสาขา/ปรับ ระบบจะรวบรวม
              spec จากกฎหมายและเทียบกับสิ่งที่อัปโหลดให้อัตโนมัติ ผู้บริหารจะเห็น gap
              ก่อนหน่วยงานราชการมาตรวจ
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
