// Read-only AI risk summary shown to signer before they sign.
// Per spec §13: "ก่อนเจ้าของเซ็น → กด AI วิเคราะห์" — extended to signer
// so counterparty/employee also sees the analysis before signing.
//
// Server component — uses native <details> for toggle, zero client JS.

import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import type { DocumentAnalysisResult } from "@/lib/docuflow/ai-analyze";

const RISK_DOT: Record<string, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

const RISK_LABEL: Record<string, string> = {
  green: "ปลอดภัย",
  yellow: "ควรระวัง",
  red: "น่ากังวล",
};

interface SignerRiskSummaryProps {
  analysis: DocumentAnalysisResult | null;
}

export function SignerRiskSummary({ analysis }: SignerRiskSummaryProps) {
  if (!analysis) return null;

  const dot = RISK_DOT[analysis.riskLevel] ?? "🟢";
  const label = RISK_LABEL[analysis.riskLevel] ?? "ปลอดภัย";
  const Icon =
    analysis.riskLevel === "red"
      ? AlertTriangle
      : analysis.riskLevel === "yellow"
        ? AlertTriangle
        : analysis.riskLevel === "green"
          ? ShieldCheck
          : CheckCircle2;

  return (
    <Card className="mb-4">
      <CardBody>
        <details className="group">
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3 select-none">
            <div className="flex items-center gap-3">
              <span className="text-lg">{dot}</span>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500 font-bold">
                  สรุปจาก AI · ก่อนเซ็น
                </p>
                <p className="text-sm font-medium text-zinc-900 mt-0.5">
                  ระดับความเสี่ยง: {label}
                </p>
              </div>
            </div>
            <span className="text-xs text-zinc-500 group-open:hidden">
              แตะเพื่อดู
            </span>
            <span className="text-xs text-zinc-500 hidden group-open:inline">
              ย่อ
            </span>
          </summary>

          <div className="mt-4 pt-4 border-t border-zinc-100 space-y-4">
            <div className="flex items-start gap-2">
              <Icon
                className={
                  analysis.riskLevel === "red"
                    ? "size-5 mt-0.5 text-rose-600 shrink-0"
                    : analysis.riskLevel === "yellow"
                      ? "size-5 mt-0.5 text-amber-600 shrink-0"
                      : "size-5 mt-0.5 text-green-600 shrink-0"
                }
              />
              <p className="text-sm text-zinc-800 leading-relaxed">
                {analysis.summary}
              </p>
            </div>

            {analysis.watchOuts && analysis.watchOuts.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-zinc-500 font-bold mb-2">
                  ⚠️ จุดที่ควรระวัง
                </p>
                <ol className="space-y-1.5 pl-1">
                  {analysis.watchOuts.map((point, i) => (
                    <li
                      key={i}
                      className="text-sm text-zinc-700 flex items-start gap-2"
                    >
                      <span className="text-amber-600 font-bold shrink-0">
                        {i + 1}.
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {analysis.metadata &&
              Object.keys(analysis.metadata).length > 0 && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {Object.entries(analysis.metadata)
                    .filter(([, v]) => v)
                    .slice(0, 6)
                    .map(([key, val]) => (
                      <div
                        key={key}
                        className="rounded-lg bg-zinc-50 border border-zinc-200 p-2.5"
                      >
                        <p className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">
                          {key}
                        </p>
                        <p className="text-xs font-medium text-zinc-900 mt-0.5 break-words">
                          {String(val)}
                        </p>
                      </div>
                    ))}
                </div>
              )}

            <div className="flex items-center justify-between pt-2 text-xs text-zinc-500">
              <Badge tone="neutral">📋 อ่านก่อนเซ็น · AI ช่วยอ่านให้</Badge>
              <span>
                วิเคราะห์เมื่อ{" "}
                {new Date(analysis.analyzedAt).toLocaleDateString("th-TH", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
