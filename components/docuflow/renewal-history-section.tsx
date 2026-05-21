// DocuFlow · RenewalHistorySection — Capability J UI
// ────────────────────────────────────────────────────────────────────
// Server component. Renders inside the document detail page.
//
// Layout decisions:
//   - chain length 1   → "เป็นเอกสารฉบับแรก · ไม่มีของเปรียบเทียบ"
//   - chain length 2   → comparison table (old vs new)
//   - chain length 3+  → comparison + timeline list + sparkline
//
// Sparkline: hand-rolled SVG (no recharts dep). Keeps the UI dependency
// surface small + Brand DNA "less is more". Data is the primary numeric
// metric across the chain (premium for insurance, monthlyRent for rental,
// tax for registration).
//
// AI metadata: read-only here. Triggered separately via
// <ExtractMetadataButton/> on the same page.
// ────────────────────────────────────────────────────────────────────

import {
  FileClock,
  TrendingUp,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Section } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComparisonRow } from "./comparison-row";
import { ExtractMetadataButton } from "./extract-metadata-button";
import { RenewalCtaRow } from "./renewal-cta-row";
import { loadRenewalChain } from "@/lib/docuflow/renewal-history";
import { loadCachedMetadataMap } from "@/lib/docuflow/metadata-extract";
import { prisma } from "@/lib/prisma";
import type {
  ExtractedMetadata,
  InsuranceMetadata,
  RentalMetadata,
  RegistrationMetadata,
} from "@/lib/docuflow/metadata-extract";
import { thaiDateLong } from "@/lib/utils/format";

interface Props {
  documentId: string;
  orgId: string;
  /** Whether the viewer can trigger AI extraction (admin tier) */
  canExtract: boolean;
  /** Section number in the parent page layout (default "05") */
  sectionNumber?: string;
}

export async function RenewalHistorySection({
  documentId,
  orgId,
  canExtract,
  sectionNumber = "05",
}: Props) {
  const chain = await loadRenewalChain(orgId, documentId);
  if (chain.length === 0) return null;

  const metaMap = await loadCachedMetadataMap(
    orgId,
    chain.map((n) => n.document.id),
  );

  // Most recent + immediately prior (for diff table)
  const newest = chain[chain.length - 1];
  const newestMeta = metaMap.get(newest.document.id) ?? null;
  const prior = chain.length >= 2 ? chain[chain.length - 2] : null;
  const priorMeta = prior ? metaMap.get(prior.document.id) ?? null : null;

  // For registration-kind: look up the linked vehicle so the CTA "ต่อทะเบียนเลย"
  // can deep-link to /docuflow/vehicles/[id]/renew?type=registration. Only the
  // first link is needed (one doc → one vehicle in practice).
  const newestKind = newestMeta?.kind ?? null;
  let vehicleIdForRenew: string | null = null;
  if (newestKind === "registration") {
    const link = await prisma.vehicleDocument.findFirst({
      where: { orgId, documentId: newest.document.id },
      select: { vehicleId: true },
    });
    vehicleIdForRenew = link?.vehicleId ?? null;
  }

  // Collect numeric series for the sparkline (primary metric per kind)
  const series = buildPrimarySeries(chain, metaMap);

  // ============== chain length 1 ==============
  if (chain.length === 1) {
    return (
      <Section
        number={sectionNumber}
        label="RENEWAL HISTORY"
        title="ประวัติการต่ออายุ"
        className="animate-fade-up delay-400"
      >
        <Card>
          <CardBody className="flex items-start gap-3">
            <div className="size-10 rounded-xl bg-zinc-50 border-2 border-zinc-200 flex items-center justify-center text-zinc-400 shrink-0">
              <FileClock className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-900 font-medium">
                เป็นเอกสารฉบับแรก
              </p>
              <p className="text-sm text-zinc-500 mt-1">
                ยังไม่มีของเปรียบเทียบ — เมื่อต่ออายุครั้งหน้า ระบบจะแสดง
                old vs new และเทรนด์ราคาให้อัตโนมัติ
              </p>
              {canExtract && !newestMeta && (
                <div className="mt-3">
                  <ExtractMetadataButton documentId={documentId} />
                </div>
              )}
              {newestMeta && (
                <div className="mt-3">
                  <MetadataPills metadata={newestMeta} />
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </Section>
    );
  }

  // ============== chain length 2+ ==============
  const hasMeta = !!(newestMeta && priorMeta);
  const showSparkline = chain.length >= 3 && series.points.length >= 3;

  return (
    <Section
      number={sectionNumber}
      label="RENEWAL HISTORY"
      title="ประวัติการต่ออายุ · เปรียบเทียบของเดิม vs ใหม่"
      description={`เอกสารนี้ต่ออายุมาแล้ว ${chain.length - 1} ครั้ง`}
      action={
        canExtract ? (
          <ExtractMetadataButton
            documentId={documentId}
            hasExisting={!!newestMeta}
          />
        ) : undefined
      }
      className="animate-fade-up delay-400"
    >
      <div className="grid grid-cols-1 gap-4">
        {/* ────────── Comparison table ────────── */}
        <Card>
          <CardBody>
            <div className="grid grid-cols-12 gap-2 pb-2 border-b border-zinc-200 mb-1">
              <p className="col-span-4 text-xs font-bold text-zinc-500">
                รายการ
              </p>
              <p className="col-span-3 text-xs font-bold text-zinc-500">
                ฉบับเก่า · {prior ? `พ.ศ. ${prior.year + 543}` : "—"}
              </p>
              <span className="col-span-1" />
              <p className="col-span-2 text-xs font-bold text-zinc-500">
                ฉบับใหม่ · พ.ศ. {newest.year + 543}
              </p>
              <p className="col-span-2 text-xs font-bold text-zinc-500 text-right">
                เปลี่ยน
              </p>
            </div>

            {hasMeta ? (
              <>
                <RenewalAdviceBanner
                  oldMeta={priorMeta}
                  newMeta={newestMeta}
                />
                <ComparisonContent oldMeta={priorMeta} newMeta={newestMeta} />
              </>
            ) : (
              <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                <Sparkles className="size-5 text-zinc-300" />
                <p className="text-sm text-zinc-600">
                  ยังไม่มีข้อมูลที่ AI ดึงไว้ —{" "}
                  {canExtract
                    ? 'กดปุ่ม "ดึงข้อมูลด้วย AI" เพื่อเปรียบเทียบ'
                    : "ติดต่อผู้ดูแลให้สั่งดึงข้อมูล"}
                </p>
              </div>
            )}

            {/* CTA row — spec §14 lines 599/612/630 */}
            <div className="mt-4 pt-4 border-t border-zinc-100">
              <RenewalCtaRow
                kind={newestKind}
                newestDocumentId={newest.document.id}
                priorDocumentId={prior ? prior.document.id : null}
                vehicleIdForRenew={vehicleIdForRenew}
              />
            </div>
          </CardBody>
        </Card>

        {/* ────────── Timeline list ────────── */}
        {chain.length >= 3 && (
          <Card data-renewal-timeline="true">
            <CardBody className="space-y-1">
              <p className="text-xs font-bold text-zinc-500 mb-2">
                ประวัติทั้งหมด
              </p>
              {chain.map((node, idx) => {
                const meta = metaMap.get(node.document.id);
                const primary = pickPrimary(meta);
                const prev = idx > 0 ? chain[idx - 1] : null;
                const prevMeta = prev ? metaMap.get(prev.document.id) : null;
                const prevPrimary = pickPrimary(prevMeta ?? null);
                let pctText = "";
                let pctTone = "text-zinc-400";
                if (
                  primary !== null &&
                  prevPrimary !== null &&
                  prevPrimary > 0
                ) {
                  const pct = ((primary - prevPrimary) / prevPrimary) * 100;
                  if (pct === 0) {
                    pctText = "เท่าเดิม";
                  } else {
                    const sign = pct > 0 ? "+" : "";
                    pctText = `${sign}${pct.toFixed(1)}%`;
                    if (pct <= 0) pctTone = "text-green-600";
                    else if (pct <= 10) pctTone = "text-amber-600";
                    else pctTone = "text-red-600";
                  }
                }
                const isCurrent = node.document.id === documentId;

                return (
                  <Link
                    key={node.document.id}
                    href={`/docuflow/documents/${node.document.id}`}
                    className={`grid grid-cols-12 gap-2 items-center py-2 border-b border-zinc-100 last:border-0 rounded-md hover:bg-zinc-50 transition-colors ${isCurrent ? "bg-[var(--color-brand-50)]" : ""}`}
                  >
                    <p className="col-span-2 text-sm font-bold text-zinc-900 tabular-nums">
                      {node.year + 543}
                    </p>
                    <p className="col-span-5 text-sm text-zinc-700 truncate">
                      {node.document.name}
                      {isCurrent && (
                        <span className="ml-1.5 text-xs font-bold text-[var(--color-brand-700)]">
                          (ฉบับนี้)
                        </span>
                      )}
                    </p>
                    <p className="col-span-3 text-sm text-zinc-500 tabular-nums">
                      {primary !== null
                        ? `฿${primary.toLocaleString("th-TH")}`
                        : "—"}
                    </p>
                    <p
                      className={`col-span-2 text-xs font-semibold tabular-nums text-right ${pctTone}`}
                    >
                      {pctText}
                    </p>
                  </Link>
                );
              })}
            </CardBody>
          </Card>
        )}

        {/* ────────── Sparkline trend ────────── */}
        {showSparkline && (
          <Card>
            <CardBody>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="text-xs font-bold text-zinc-500 flex items-center gap-1">
                    <TrendingUp className="size-3.5" />
                    เทรนด์ {series.label}
                  </p>
                  <p className="text-sm text-zinc-700 mt-0.5">
                    {series.points.length} ปี · ขึ้น/ลง{" "}
                    <span
                      className={
                        series.totalPctChange > 10
                          ? "text-red-600 font-semibold"
                          : series.totalPctChange > 0
                            ? "text-amber-600 font-semibold"
                            : "text-green-600 font-semibold"
                      }
                    >
                      {series.totalPctChange > 0 ? "+" : ""}
                      {series.totalPctChange.toFixed(1)}% รวม
                    </span>
                  </p>
                </div>
                {series.totalPctChange > 10 && (
                  <Badge tone="danger">
                    <AlertTriangle className="size-3" />
                    ขึ้นเยอะ
                  </Badge>
                )}
              </div>
              <Sparkline points={series.points} />
            </CardBody>
          </Card>
        )}
      </div>
    </Section>
  );
}

/* ============================================================
   Comparison content — typed dispatch on metadata kind
   ============================================================ */

function ComparisonContent({
  oldMeta,
  newMeta,
}: {
  oldMeta: ExtractedMetadata;
  newMeta: ExtractedMetadata;
}) {
  // Both must have same kind for a real comparison
  if (oldMeta.kind !== newMeta.kind) {
    return (
      <p className="py-4 text-sm text-zinc-500">
        ประเภทเอกสารเก่า/ใหม่ไม่ตรงกัน ({oldMeta.kind} vs {newMeta.kind})
      </p>
    );
  }

  if (newMeta.kind === "insurance") {
    const o = oldMeta as InsuranceMetadata;
    const n = newMeta;
    return (
      <>
        <ComparisonRow label="เบี้ยประกัน" oldValue={o.premium} newValue={n.premium} currency />
        <ComparisonRow label="ทุนประกัน" oldValue={o.sumInsured} newValue={n.sumInsured} currency />
        <ComparisonRow label="ค่าเสียหายส่วนแรก" oldValue={o.deductible} newValue={n.deductible} currency />
        <ComparisonRow label="ระยะเวลาคุ้มครอง" oldValue={o.periodMonths} newValue={n.periodMonths} unit="เดือน" />
        <ComparisonRow label="บริษัทประกัน" oldValue={o.insurer} newValue={n.insurer} />
      </>
    );
  }
  if (newMeta.kind === "rental") {
    const o = oldMeta as RentalMetadata;
    const n = newMeta;
    return (
      <>
        <ComparisonRow label="ค่าเช่า/เดือน" oldValue={o.monthlyRent} newValue={n.monthlyRent} currency />
        <ComparisonRow label="เงินมัดจำ" oldValue={o.deposit} newValue={n.deposit} currency />
        <ComparisonRow label="ระยะเวลาเช่า" oldValue={o.periodMonths} newValue={n.periodMonths} unit="เดือน" />
        <ComparisonRow label="บอกเลิกล่วงหน้า" oldValue={o.terminationNoticeMonths} newValue={n.terminationNoticeMonths} unit="เดือน" />
        <ComparisonRow label="% ขึ้นค่าเช่าเมื่อต่อ" oldValue={o.renewalIncrease} newValue={n.renewalIncrease} unit="%" />
      </>
    );
  }
  if (newMeta.kind === "registration") {
    const o = oldMeta as RegistrationMetadata;
    const n = newMeta;
    return (
      <>
        <ComparisonRow label="ภาษีรถ" oldValue={o.tax} newValue={n.tax} currency />
        <ComparisonRow label="อายุทะเบียน" oldValue={o.periodMonths} newValue={n.periodMonths} unit="เดือน" />
      </>
    );
  }

  return (
    <p className="py-4 text-sm text-zinc-500">
      AI ระบุประเภทเอกสารไม่ได้ — ลองสั่งดึงข้อมูลใหม่
    </p>
  );
}

/* ============================================================
   MetadataPills — quick-look readout when only one node has metadata
   ============================================================ */

function MetadataPills({ metadata }: { metadata: ExtractedMetadata }) {
  if (metadata.kind === "insurance") {
    const m = metadata;
    return (
      <div className="flex flex-wrap gap-2">
        {m.premium !== undefined && (
          <Badge tone="brand">เบี้ย ฿{m.premium.toLocaleString("th-TH")}</Badge>
        )}
        {m.sumInsured !== undefined && (
          <Badge tone="neutral">
            ทุน ฿{m.sumInsured.toLocaleString("th-TH")}
          </Badge>
        )}
        {m.insurer && <Badge tone="neutral">{m.insurer}</Badge>}
      </div>
    );
  }
  if (metadata.kind === "rental") {
    const m = metadata;
    return (
      <div className="flex flex-wrap gap-2">
        {m.monthlyRent !== undefined && (
          <Badge tone="brand">
            ค่าเช่า ฿{m.monthlyRent.toLocaleString("th-TH")}/ด.
          </Badge>
        )}
        {m.deposit !== undefined && (
          <Badge tone="neutral">
            มัดจำ ฿{m.deposit.toLocaleString("th-TH")}
          </Badge>
        )}
      </div>
    );
  }
  if (metadata.kind === "registration") {
    const m = metadata;
    return (
      <div className="flex flex-wrap gap-2">
        {m.tax !== undefined && (
          <Badge tone="brand">ภาษี ฿{m.tax.toLocaleString("th-TH")}</Badge>
        )}
      </div>
    );
  }
  return null;
}

/* ============================================================
   Sparkline (inline SVG, no chart lib)
   ============================================================ */

interface SparklinePoint {
  year: number;
  value: number;
}

function Sparkline({ points }: { points: SparklinePoint[] }) {
  if (points.length < 2) return null;

  const W = 480;
  const H = 120;
  const PAD_X = 28;
  const PAD_Y = 16;

  const values = points.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(maxV - minV, 1);

  const xStep = (W - 2 * PAD_X) / (points.length - 1);
  const xs = points.map((_, i) => PAD_X + i * xStep);
  const ys = points.map(
    (p) => H - PAD_Y - ((p.value - minV) / range) * (H - 2 * PAD_Y),
  );

  const path = xs
    .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`)
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H + 24}`}
        className="w-full h-32"
        role="img"
        aria-label="กราฟแนวโน้ม"
      >
        {/* baseline */}
        <line
          x1={PAD_X}
          x2={W - PAD_X}
          y1={H - PAD_Y}
          y2={H - PAD_Y}
          stroke="var(--color-zinc-200, #e4e4e7)"
          strokeWidth="1"
        />
        {/* line */}
        <path
          d={path}
          fill="none"
          stroke="var(--color-brand-600)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* dots + labels */}
        {points.map((p, i) => (
          <g key={p.year}>
            <circle
              cx={xs[i]}
              cy={ys[i]}
              r="3.5"
              fill="white"
              stroke="var(--color-brand-600)"
              strokeWidth="2"
            />
            <text
              x={xs[i]}
              y={H + 14}
              textAnchor="middle"
              fontSize="10"
              fill="#71717a"
            >
              {p.year + 543}
            </text>
            <text
              x={xs[i]}
              y={ys[i] - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#27272a"
              fontWeight="600"
            >
              {compactBaht(p.value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function compactBaht(n: number): string {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(0)}K`;
  return `฿${n.toLocaleString("th-TH")}`;
}

/* ============================================================
   Series builder — pick the right primary metric per kind
   ============================================================ */

interface PrimarySeries {
  label: string;
  points: SparklinePoint[];
  /** total % change from oldest to newest data point */
  totalPctChange: number;
}

function buildPrimarySeries(
  chain: Awaited<ReturnType<typeof loadRenewalChain>>,
  metaMap: Map<string, ExtractedMetadata>,
): PrimarySeries {
  const points: SparklinePoint[] = [];
  let label = "ราคา";

  for (const node of chain) {
    const meta = metaMap.get(node.document.id);
    const v = pickPrimary(meta ?? null);
    if (v !== null) {
      points.push({ year: node.year, value: v });
    }
  }

  // Resolve label from the first non-null kind
  const firstKind = chain
    .map((n) => metaMap.get(n.document.id)?.kind)
    .find((k): k is ExtractedMetadata["kind"] => !!k && k !== "unknown");
  if (firstKind === "insurance") label = "เบี้ยประกัน";
  else if (firstKind === "rental") label = "ค่าเช่า/เดือน";
  else if (firstKind === "registration") label = "ภาษีรถ";

  let totalPctChange = 0;
  if (points.length >= 2) {
    const first = points[0].value;
    const last = points[points.length - 1].value;
    if (first > 0) totalPctChange = ((last - first) / first) * 100;
  }

  return { label, points, totalPctChange };
}

/** Pick the primary numeric metric from metadata, kind-aware. */
function pickPrimary(meta: ExtractedMetadata | null | undefined): number | null {
  if (!meta) return null;
  if (meta.kind === "insurance" && typeof meta.premium === "number") {
    return meta.premium;
  }
  if (meta.kind === "rental" && typeof meta.monthlyRent === "number") {
    return meta.monthlyRent;
  }
  if (meta.kind === "registration" && typeof meta.tax === "number") {
    return meta.tax;
  }
  return null;
}

/* ============================================================
   Renewal Advice Banner — rule-based Thai recommendation
   Inspired by spec §14 line 627 "AI: ⚠️ ค่าเช่าขึ้น 15.6% และ Deposit เพิ่ม
   แนะนำ: ต่อรองค่าเช่าก่อนเซ็น"
   ============================================================ */

function RenewalAdviceBanner({
  oldMeta,
  newMeta,
}: {
  oldMeta: ExtractedMetadata | null;
  newMeta: ExtractedMetadata | null;
}) {
  if (!oldMeta || !newMeta || oldMeta.kind !== newMeta.kind) return null;

  // Compute primary % change + flag deposit/notice changes by kind
  const oldPrimary = pickPrimary(oldMeta);
  const newPrimary = pickPrimary(newMeta);

  if (oldPrimary == null || newPrimary == null || oldPrimary === 0) return null;

  const pct = ((newPrimary - oldPrimary) / oldPrimary) * 100;
  const tone = pct > 10 ? "danger" : pct > 5 ? "warning" : pct < 0 ? "success" : "neutral";

  let primaryLabel = "ราคา";
  if (newMeta.kind === "insurance") primaryLabel = "เบี้ยประกัน";
  else if (newMeta.kind === "rental") primaryLabel = "ค่าเช่า";
  else if (newMeta.kind === "registration") primaryLabel = "ภาษีรถ";

  // Extra signals (kind-specific)
  const signals: string[] = [];
  let recommendation = "";

  if (newMeta.kind === "rental") {
    const o = oldMeta as RentalMetadata;
    const n = newMeta;
    if (
      typeof o.deposit === "number" &&
      typeof n.deposit === "number" &&
      n.deposit > o.deposit
    ) {
      signals.push("Deposit เพิ่ม");
    }
    if (
      typeof o.terminationNoticeMonths === "number" &&
      typeof n.terminationNoticeMonths === "number" &&
      n.terminationNoticeMonths > o.terminationNoticeMonths
    ) {
      signals.push("ระยะเวลาบอกเลิกยาวขึ้น");
    }
  }
  if (newMeta.kind === "insurance") {
    const o = oldMeta as InsuranceMetadata;
    const n = newMeta;
    if (
      typeof o.deductible === "number" &&
      typeof n.deductible === "number" &&
      n.deductible > o.deductible
    ) {
      signals.push("ค่าเสียหายส่วนแรกสูงขึ้น");
    }
  }

  // Build recommendation text
  if (pct > 10) {
    recommendation = `แนะนำ: ต่อรองก่อนเซ็น · เทียบกับเจ้าอื่น`;
  } else if (pct > 5) {
    recommendation = `แนะนำ: ทบทวนเงื่อนไขก่อนเซ็น`;
  } else if (pct < 0) {
    recommendation = `ราคาลดลง · พิจารณาเซ็นต่อได้`;
  } else {
    recommendation = `เงื่อนไขใกล้เคียงเดิม · พิจารณาเซ็นต่อได้`;
  }

  const toneClasses: Record<string, string> = {
    danger: "bg-rose-50 border-rose-200 text-rose-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    success: "bg-green-50 border-green-200 text-green-900",
    neutral: "bg-zinc-50 border-zinc-200 text-zinc-900",
  };

  const directionLabel =
    pct > 0 ? "ขึ้น" : pct < 0 ? "ลดลง" : "เท่าเดิม";

  return (
    <div
      className={`mb-3 mt-1 rounded-lg border px-3 py-2.5 ${toneClasses[tone]}`}
    >
      <p className="text-xs uppercase tracking-[0.14em] font-bold opacity-70 mb-1">
        💡 AI สรุปการเปลี่ยนแปลง
      </p>
      <p className="text-sm leading-relaxed">
        {primaryLabel}
        {directionLabel}
        <span className="font-bold mx-1">
          {pct > 0 ? "+" : ""}
          {pct.toFixed(1)}%
        </span>
        {signals.length > 0 && (
          <span> · {signals.join(" · ")}</span>
        )}
      </p>
      <p className="text-sm font-semibold mt-1">{recommendation}</p>
    </div>
  );
}

// Suppress unused import warnings if Section internals change
void thaiDateLong;
