// DocuFlow · Checklist เอกสารที่ต้องมี (per business type)
// ────────────────────────────────────────────────────────────────────
// แสดงเทียบ "เอกสารที่อัปโหลดแล้ว" vs "เอกสารที่ต้องมี" ต่อ business type —
// ช่วยผู้บริหารเห็น compliance gap ทันที
//
// Data sources (Pinpoint 18-pt Batch 3, 2026-10-13 — CEO complaint #9:
// checklist used to be 100% read-only, hardcoded to the static catalog
// below, with ZERO connection to the org's own DocumentType rows even
// though a full admin CRUD page for DocumentType already existed at
// /docuflow/settings/document-types):
//   - Requirements: lib/docuflow/document-types.ts →
//       listChecklistRequirements(orgId, bt) — merges the org's real,
//       admin-managed DocumentType rows (create/edit/deactivate at
//       /docuflow/settings/document-types) with any canonical-docs.ts
//       (static, ไม่มี orgId) entries not yet covered by a real row, so an
//       org that has customized nothing still sees the full legal list
//       exactly as before, and any custom/edited row the admin creates
//       now actually affects this page.
//   - Uploaded : lib/docuflow/data.ts → loadDocuments(orgId, { businessType })
//     — matched against each requirement by the real DocumentType.id FK
//     (documentTypeId) when the requirement is a real row, falling back
//     to the original fuzzy name-match only for still-unimported
//     canonical entries (preserves today's behavior for those).
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
  ShieldCheck,
  Settings,
} from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { userIsModuleAdmin, requireModuleView } from "@/lib/auth/module-access";
import { loadDocuments } from "@/lib/docuflow/data";
import { BUSINESS_TYPES } from "@/constants/business-types";
import {
  listSupportedBizTypes,
  DOC_DANGER_TONE,
  type DocDangerLevel,
  type CanonicalBizType,
} from "@/lib/docuflow/canonical-docs";
import {
  listChecklistRequirements,
  type DocumentTypeOption,
} from "@/lib/docuflow/document-types";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { thaiDateLong } from "@/lib/utils/format";
import {
  DfButton,
  DfEyebrow,
  DfPageHeader,
  DfStatCard,
} from "@/components/docuflow/df-ui";
import { DfTopBanner } from "@/components/docuflow/df-top-banner";

export const dynamic = "force-dynamic";

/** Safe lookup — DocumentTypeOption.dangerLevel is `string | null` (an
 *  admin-typed free value on custom rows), unlike CanonicalDocSpec's
 *  closed DocDangerLevel union, so an unrecognized/missing value falls
 *  back to a neutral badge instead of throwing/indexing undefined. */
function dangerTone(level: string | null): "danger" | "warning" | "neutral" | "success" {
  if (level && level in DOC_DANGER_TONE) {
    return DOC_DANGER_TONE[level as DocDangerLevel];
  }
  return "neutral";
}

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
  /** org's real DocumentType rows for this biztype, merged with any
   *  not-yet-covered canonical-docs.ts entries — see
   *  listChecklistRequirements() for the merge rule. */
  requirements: DocumentTypeOption[];
  /** uploaded — distinct doc names ที่อัปโหลดผูก biztype นี้ (fuzzy-match
   *  fallback for requirements not yet linked to a real DocumentType row) */
  uploadedNames: Set<string>;
  /** total uploaded ฉบับ (รวม duplicate sub-branches) */
  uploadedCount: number;
  /** matched requirements (อัปโหลดครบแล้ว) */
  matched: DocumentTypeOption[];
  /** missing requirements */
  missing: DocumentTypeOption[];
}

/**
 * Match each requirement against what's been uploaded. A requirement
 * backed by a real DocumentType row (`id` populated) matches by the exact
 * `documentTypeId` FK — precise, no guessing. A requirement still
 * unimported from the static catalog (`id === null`) has no FK to match
 * against yet, so it falls back to the original fuzzy name substring
 * match (both ways) — identical to this page's pre-existing behavior,
 * so an org that hasn't customized anything sees zero change.
 */
function matchRequirements(
  requirements: DocumentTypeOption[],
  uploadedNames: Set<string>,
  uploadedTypeIds: Set<string>,
): { matched: DocumentTypeOption[]; missing: DocumentTypeOption[] } {
  const uploadedLowerArr = Array.from(uploadedNames).map((n) =>
    n.toLowerCase(),
  );
  const matched: DocumentTypeOption[] = [];
  const missing: DocumentTypeOption[] = [];
  for (const req of requirements) {
    const hit = req.id
      ? uploadedTypeIds.has(req.id)
      : uploadedLowerArr.some((u) => {
          const cLower = req.name.toLowerCase();
          return u.includes(cLower) || cLower.includes(u);
        });
    if (hit) matched.push(req);
    else missing.push(req);
  }
  return { matched, missing };
}

export default async function DocuFlowChecklistPage() {
  const session = await requireSession();
  await requireModuleView(session.user, "docuflow");
  const orgId = session.user.org_id;
  const adminTier = await userIsModuleAdmin(session.user, "docuflow");

  // Fetch uploaded docs ต่อ biztype แบบขนาน (max 14 biztype × 50 = 700 docs)
  const supported = listSupportedBizTypes();
  const rowsRaw = await Promise.all(
    supported.map(async (bt): Promise<ChecklistRow> => {
      const meta =
        BUSINESS_TYPES[bt] ??
        EXTRA_BIZTYPE_META[bt] ?? { label: bt, emoji: "📦" };

      const [requirements, uploaded] = await Promise.all([
        listChecklistRequirements(orgId, bt),
        loadDocuments(orgId, { businessType: bt, limit: 200 }),
      ]);

      const uploadedNames = new Set(uploaded.map((d) => d.name));
      const uploadedTypeIds = new Set(
        uploaded
          .map((d) => d.documentTypeId)
          .filter((id): id is string => !!id),
      );
      const { matched, missing } = matchRequirements(
        requirements,
        uploadedNames,
        uploadedTypeIds,
      );

      return {
        bizType: bt,
        label: meta.label,
        emoji: meta.emoji,
        requirements,
        uploadedNames,
        uploadedCount: uploaded.length,
        matched,
        missing,
      };
    }),
  );

  // เรียงตาม % ขาด มากสุดก่อน (เน้น compliance gap)
  const rows = rowsRaw.sort((a, b) => {
    const aRatio = a.requirements.length === 0 ? 0 : a.missing.length / a.requirements.length;
    const bRatio = b.requirements.length === 0 ? 0 : b.missing.length / b.requirements.length;
    return bRatio - aRatio;
  });

  // Org-wide stats
  const totalRequired = rows.reduce((s, r) => s + r.requirements.length, 0);
  const totalMatched = rows.reduce((s, r) => s + r.matched.length, 0);
  const totalMissing = rows.reduce((s, r) => s + r.missing.length, 0);
  const overallPct =
    totalRequired === 0 ? 100 : Math.round((totalMatched / totalRequired) * 100);

  return (
    <div
      style={{
        padding: "28px clamp(16px, 4vw, 40px)",
        paddingBottom: 96,
        maxWidth: 1500,
        margin: "0 auto",
      }}
    >
      <DfTopBanner breadcrumbs={[{ label: "หน้าหลัก", href: "/docuflow" }, { label: "Checklist เอกสาร" }]} />

      <DfPageHeader
        eyebrow={<DfEyebrow>Checklist · เอกสารที่กฎหมายกำหนด</DfEyebrow>}
        title={
          <>
            Compliance{" "}
            <span
              style={{
                color:
                  overallPct >= 80
                    ? "var(--df-success)"
                    : overallPct >= 40
                      ? "var(--df-warn)"
                      : "var(--df-danger)",
              }}
            >
              {overallPct}%
            </span>{" "}
            · {totalMatched}/{totalRequired} ฉบับครบ
          </>
        }
        description={`${thaiDateLong(new Date())} · เทียบเอกสารที่อัปโหลดกับมาตรฐานกฎหมายต่อประเภทธุรกิจ`}
        actions={
          adminTier ? (
            <DfButton href="/docuflow/settings/document-types" variant="ghost" size="sm">
              <Settings size={14} />
              จัดการประเภทเอกสาร
            </DfButton>
          ) : undefined
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 12,
          marginBottom: 22,
        }}
        className="df-fade-up df-fade-up-100"
      >
        <DfStatCard
          label="กฎหมายกำหนด"
          value={totalRequired.toLocaleString("th-TH")}
          sub="ทุกประเภทธุรกิจ"
          tone="ink"
          icon={<CheckSquare size={17} />}
        />
        <DfStatCard
          label="อัปโหลดครบ"
          value={totalMatched.toLocaleString("th-TH")}
          sub="ตรงกับ canonical"
          tone="success"
          icon={<CheckCircle2 size={17} />}
        />
        <DfStatCard
          label="ยังขาด"
          value={totalMissing.toLocaleString("th-TH")}
          sub={totalMissing > 0 ? "ต้องอัปโหลด" : "ครบเรียบร้อย"}
          tone={totalMissing > 0 ? "danger" : "ink"}
          icon={<XCircle size={17} />}
        />
        <DfStatCard
          label="Compliance Score"
          value={`${overallPct}%`}
          sub="ครบถ้วนรวม"
          tone={
            overallPct >= 80 ? "success" : overallPct >= 40 ? "warn" : "danger"
          }
          icon={<ShieldCheck size={17} />}
        />
      </div>

      {/* Per-biztype breakdown */}
      <Section
        number="02"
        label="ตามประเภทธุรกิจ"
        title="แยกตามประเภทธุรกิจ"
        description="เรียงตามสัดส่วน 'ยังขาด' มากสุดก่อน"
        className="mb-10 animate-fade-up delay-200"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {rows.map((r) => {
            const total = r.requirements.length;
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-zinc-900 text-base truncate font-display">
                            {r.label}
                          </p>
                          {adminTier && (
                            <Link
                              href={`/docuflow/settings/document-types?businessType=${r.bizType}`}
                              className="text-[11px] font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] whitespace-nowrap"
                            >
                              จัดการ
                            </Link>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          ต้องมี {total} · อัปโหลด {r.uploadedCount} ฉบับ
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
                      <p className="text-xs uppercase tracking-wide font-bold text-zinc-400">
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
                          <p className="text-xs font-bold text-rose-700">
                            ยังไม่มี ({r.missing.length})
                          </p>
                        </div>
                        <ul className="space-y-1.5">
                          {r.missing.slice(0, 6).map((m) => (
                            <li
                              key={m.id ?? m.canonicalKey ?? m.name}
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
                                  {m.frequency && <span>{m.frequency}</span>}
                                  {m.regulator && (
                                    <>
                                      <span className="text-zinc-300">·</span>
                                      <span className="truncate">
                                        {m.regulator}
                                      </span>
                                    </>
                                  )}
                                  {m.dangerLevel && (
                                    <Badge tone={dangerTone(m.dangerLevel)}>
                                      {m.dangerLevel}
                                    </Badge>
                                  )}
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
                          <p className="text-xs font-bold text-green-700">
                            อัปโหลดแล้ว ({r.matched.length})
                          </p>
                        </div>
                        <ul className="space-y-1">
                          {r.matched.slice(0, 4).map((m) => (
                            <li
                              key={m.id ?? m.canonicalKey ?? m.name}
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

                    {r.requirements.length === 0 && (
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
