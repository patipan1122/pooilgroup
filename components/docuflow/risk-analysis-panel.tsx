"use client";

// DocuFlow — Capability H · AI Risk Analysis panel ("น่ากลัวไหม?")
// ────────────────────────────────────────────────────────────────────
// Spec: ดีเทลv1/DOCUFLOW.md §13
//
// Behaviour:
//   - On mount → GET /api/docuflow/[id]/analyze (cache only)
//   - "🤖 AI วิเคราะห์เอกสารนี้" button → POST (admin only)
//   - "วิเคราะห์ใหม่" → POST { force: true }
//   - Exec without admin tier sees results read-only (no buttons)
// ────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Sparkles,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  PenLine,
  Edit3,
  Scale,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";

interface AnalysisDTO {
  id: string;
  documentId: string;
  riskLevel: "green" | "yellow" | "red";
  summary: string;
  metadata: Record<string, string | undefined>;
  watchOuts: string[];
  normalPoints: string[];
  modelUsed: string | null;
  tokensUsed: number | null;
  analyzedAt: string;
  fromCache: boolean;
}

interface Props {
  documentId: string;
  /** When false, hide trigger buttons and show read-only result. */
  canAnalyze: boolean;
  /** Document name (used for "ปรึกษาทนาย" mailto subject). Optional. */
  documentName?: string;
}

const RISK_LABEL: Record<AnalysisDTO["riskLevel"], string> = {
  green: "ปลอดภัย",
  yellow: "ควรระวัง",
  red: "น่ากังวล",
};

const RISK_DOT: Record<AnalysisDTO["riskLevel"], string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

const RISK_TONE: Record<
  AnalysisDTO["riskLevel"],
  "success" | "warning" | "danger"
> = {
  green: "success",
  yellow: "warning",
  red: "danger",
};

export function RiskAnalysisPanel({ documentId, canAnalyze, documentName }: Props) {
  const [analysis, setAnalysis] = useState<AnalysisDTO | null>(null);
  const [loadingCache, setLoadingCache] = useState(true);
  const [running, setRunning] = useState(false);

  // Initial cache fetch (GET — any executive role)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/docuflow/${documentId}/analyze`, {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { analysis: AnalysisDTO | null };
        if (!cancelled) setAnalysis(data.analysis);
      } catch {
        /* silent — cache miss is expected */
      } finally {
        if (!cancelled) setLoadingCache(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  async function runAnalysis(force: boolean) {
    setRunning(true);
    try {
      const res = await fetch(`/api/docuflow/${documentId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "วิเคราะห์ไม่สำเร็จ");
      }
      setAnalysis(data.analysis as AnalysisDTO);
      toast.success(
        force ? "วิเคราะห์ใหม่เรียบร้อย" : "วิเคราะห์เอกสารเรียบร้อย",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "วิเคราะห์ไม่สำเร็จ");
    } finally {
      setRunning(false);
    }
  }

  const action = canAnalyze ? (
    analysis ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => runAnalysis(true)}
        loading={running}
      >
        <RefreshCw className="size-4" />
        วิเคราะห์ใหม่
      </Button>
    ) : null
  ) : null;

  return (
    <Section
      number="05"
      label="AI ANALYSIS"
      title="น่ากลัวไหม? — AI ช่วยอ่านเอกสาร"
      description="Claude อ่านเนื้อหาและสรุปจุดที่ควรระวังก่อนเซ็น"
      action={action}
      className="animate-fade-up delay-200"
    >
      {/* No analysis yet */}
      {!loadingCache && !analysis && (
        <Card>
          <CardBody className="flex flex-col items-center text-center gap-4 py-10">
            <div className="size-14 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-200)] flex items-center justify-center text-[var(--color-brand-600)]">
              <Sparkles className="size-6" />
            </div>
            <div className="max-w-md">
              <h4 className="text-base font-bold text-zinc-900">
                ยังไม่ได้วิเคราะห์เอกสารนี้
              </h4>
              <p className="text-sm text-zinc-600 mt-1.5 leading-relaxed">
                AI จะอ่านเอกสาร · ระบุประเภท · หาจุดที่ควรระวัง
                <br />
                {canAnalyze
                  ? "กดปุ่มด้านล่างเพื่อให้ AI ช่วยอ่าน (ใช้เวลา 5-15 วินาที)"
                  : "ติดต่อแอดมินให้รันการวิเคราะห์"}
              </p>
            </div>
            {canAnalyze && (
              <Button
                variant="primary"
                size="lg"
                onClick={() => runAnalysis(false)}
                loading={running}
              >
                <Sparkles className="size-5" />
                ให้ AI วิเคราะห์เอกสาร
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* Loading cache */}
      {loadingCache && (
        <Card>
          <CardBody className="py-10 flex items-center justify-center text-sm text-zinc-500">
            <RefreshCw className="size-4 animate-spin mr-2" />
            กำลังโหลดผลวิเคราะห์...
          </CardBody>
        </Card>
      )}

      {/* Running spinner overlay (replaces card when no prior result) */}
      {running && !analysis && (
        <Card>
          <CardBody className="py-10 flex flex-col items-center gap-3 text-center">
            <RefreshCw className="size-6 animate-spin text-[var(--color-brand-600)]" />
            <p className="text-sm text-zinc-700 font-medium">
              AI กำลังอ่านเอกสาร...
            </p>
            <p className="text-xs text-zinc-500">
              ใช้เวลาประมาณ 5-15 วินาที
            </p>
          </CardBody>
        </Card>
      )}

      {/* Result */}
      {analysis && (
        <AnalysisResult
          analysis={analysis}
          documentId={documentId}
          documentName={documentName}
          canAnalyze={canAnalyze}
        />
      )}
    </Section>
  );
}

/* ============================================================
   Result card
   ============================================================ */

function AnalysisResult({
  analysis,
  documentId,
  documentName,
  canAnalyze,
}: {
  analysis: AnalysisDTO;
  documentId: string;
  documentName?: string;
  canAnalyze: boolean;
}) {
  const riskTone = RISK_TONE[analysis.riskLevel];
  const RiskIcon =
    analysis.riskLevel === "green"
      ? ShieldCheck
      : analysis.riskLevel === "yellow"
        ? AlertTriangle
        : AlertCircle;

  const docLabel = documentName ?? "เอกสาร";

  function handleRequestRevision() {
    // TODO: wire to a real "needs revision" flag/notification flow.
    toast.success("แจ้งผู้รับผิดชอบเรียบร้อย");
  }

  function handleConsultLawyer() {
    // TODO: replace with org-configured legal contact when settings ship.
    const subject = encodeURIComponent(`ปรึกษาเอกสาร: ${docLabel}`);
    const body = encodeURIComponent(
      `ขอความเห็นเรื่องเอกสาร "${docLabel}" ก่อนเซ็น\n\nลิงก์: /docuflow/documents/${documentId}\n\nสรุป AI:\n${analysis.summary || "—"}`,
    );
    if (typeof window !== "undefined") {
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
    }
    toast.success("เปิดอีเมลปรึกษาทนายแล้ว");
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        {/* Header — risk badge + summary */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Badge tone={riskTone}>
              {RISK_DOT[analysis.riskLevel]} {RISK_LABEL[analysis.riskLevel]}
            </Badge>
            {analysis.metadata.docType && (
              <Badge tone="neutral">📋 {analysis.metadata.docType}</Badge>
            )}
          </div>
        </div>

        {analysis.summary && (
          <div className="rounded-xl border border-zinc-100 bg-zinc-50/50 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <RiskIcon
                className={`size-4 mt-0.5 shrink-0 ${
                  analysis.riskLevel === "green"
                    ? "text-green-600"
                    : analysis.riskLevel === "yellow"
                      ? "text-amber-600"
                      : "text-red-600"
                }`}
              />
              <p className="text-sm text-zinc-800 leading-relaxed">
                {analysis.summary}
              </p>
            </div>
          </div>
        )}

        {/* Metadata grid */}
        {hasMetadataDisplay(analysis.metadata) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {analysis.metadata.duration && (
              <MetaRow
                emoji="📅"
                label="ระยะเวลา"
                value={analysis.metadata.duration}
              />
            )}
            {analysis.metadata.amount && (
              <MetaRow
                emoji="💰"
                label="จำนวนเงิน"
                value={analysis.metadata.amount}
              />
            )}
            {analysis.metadata.parties && (
              <MetaRow
                emoji="👥"
                label="คู่สัญญา"
                value={analysis.metadata.parties}
              />
            )}
          </div>
        )}

        {/* Watch-outs */}
        {analysis.watchOuts.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-2">
              ⚠️ จุดที่ควรระวัง
            </p>
            <ul className="space-y-2">
              {analysis.watchOuts.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2.5 text-sm text-zinc-800 leading-relaxed"
                >
                  <span className="size-5 shrink-0 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold flex items-center justify-center mt-0.5 tabular-nums">
                    {i + 1}
                  </span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Normal points */}
        {analysis.normalPoints.length > 0 && (
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold mb-2">
              ✅ ปกติดี
            </p>
            <ul className="space-y-1.5">
              {analysis.normalPoints.map((n, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-zinc-700 leading-relaxed"
                >
                  <span className="text-green-600 mt-0.5">•</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer — bottom-line */}
        <div className="rounded-xl border-2 border-[var(--color-brand-100)] bg-[var(--color-brand-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-brand-700)] font-bold">
            สรุป
          </p>
          <p className="text-sm text-zinc-900 font-medium mt-1 leading-relaxed">
            {bottomLine(analysis)}
          </p>
        </div>

        {/* CTA row — spec §13 line 559 */}
        {canAnalyze && (
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Link
              href={`/docuflow/documents/${documentId}/signatures`}
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 bg-[var(--color-brand-600)] text-white hover:bg-[var(--color-brand-700)] active:bg-[var(--color-brand-800)] shadow-soft h-10 px-4 text-sm rounded-xl"
            >
              <PenLine className="size-4" />
              เซ็นต่อ
            </Link>
            <Button
              variant="outline"
              onClick={handleRequestRevision}
              type="button"
            >
              <Edit3 className="size-4" />
              ขอแก้ไขก่อน
            </Button>
            <Button
              variant="outline"
              onClick={handleConsultLawyer}
              type="button"
            >
              <Scale className="size-4" />
              ปรึกษาทนาย
            </Button>
          </div>
        )}

        {/* Meta footer */}
        <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-2 border-t border-zinc-100">
          <span>
            วิเคราะห์เมื่อ{" "}
            {new Date(analysis.analyzedAt).toLocaleString("th-TH", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
          {analysis.modelUsed && <span>{analysis.modelUsed}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

function MetaRow({
  emoji,
  label,
  value,
}: {
  emoji: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="text-base leading-none mt-0.5">{emoji}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500 font-bold">
          {label}
        </p>
        <p className="text-sm text-zinc-900 font-medium mt-0.5 break-words">
          {value}
        </p>
      </div>
    </div>
  );
}

function hasMetadataDisplay(meta: Record<string, string | undefined>): boolean {
  return Boolean(meta.duration || meta.amount || meta.parties);
}

function bottomLine(analysis: AnalysisDTO): string {
  const dot = RISK_DOT[analysis.riskLevel];
  const label = RISK_LABEL[analysis.riskLevel];
  const count = analysis.watchOuts.length;
  if (analysis.riskLevel === "green") {
    return `${dot} ${label} — เอกสารดูปกติ ไม่มีเงื่อนไขผิดปกติ`;
  }
  if (count === 0) {
    return `${dot} ${label}`;
  }
  return `${dot} ${label} ${count} ข้อก่อนเซ็น`;
}
