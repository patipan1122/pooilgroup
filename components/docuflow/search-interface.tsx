"use client";

// SearchInterface — DocuFlow AI Search ("ภาษาคน")
// ────────────────────────────────────────────────────────────────────
// Big input box + example chips + answer panel + citations.
// Recent queries kept in localStorage (last 5).
// ────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  Sparkles,
  AlertCircle,
  History,
  Loader2,
  FileText,
  Truck,
  User as UserIcon,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Citation {
  type: "document" | "vehicle" | "person" | "branch";
  id: string;
  label: string;
}

interface ApiResult {
  answer: string;
  citations: Citation[];
  cached: boolean;
}

const HISTORY_KEY = "docuflow:ai-search:history";
const MAX_HISTORY = 5;

/**
 * Export AI search result to a CSV that Excel opens cleanly.
 * - First rows: query + answer (multi-line preserved via quoting)
 * - Then a blank row + citation table (type · id · label · url)
 * - UTF-8 BOM prepended so Excel interprets Thai correctly.
 */
function exportSearchToCsv(query: string, result: ApiResult) {
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(escape("คำถาม") + "," + escape(query));
  lines.push(escape("คำตอบ") + "," + escape(result.answer));
  lines.push(""); // blank row separator
  lines.push(["ประเภท", "ID", "ชื่อ", "ลิงก์"].map(escape).join(","));
  for (const c of result.citations) {
    const href = citationHref(c);
    const url = `${typeof window !== "undefined" ? window.location.origin : ""}${href}`;
    lines.push([c.type, c.id, c.label, url].map(escape).join(","));
  }
  const csv = "﻿" + lines.join("\r\n"); // BOM for Excel UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const filename = `docuflow-search-${ts}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface Props {
  examples: string[];
}

export function SearchInterface({ examples }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Lazy state init — read localStorage once on mount without an effect
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((s): s is string => typeof s === "string")
        .slice(0, MAX_HISTORY);
    } catch {
      return [];
    }
  });

  const persistHistory = useCallback((items: string[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    } catch {
      // localStorage might be unavailable / full — silent
    }
  }, []);

  const submit = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setError("คำถามสั้นเกินไป");
        return;
      }
      if (trimmed.length > 500) {
        setError("คำถามยาวเกิน 500 ตัวอักษร");
        return;
      }
      setError(null);
      setLoading(true);
      setResult(null);
      try {
        const res = await fetch("/api/docuflow/ai-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: trimmed }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error ?? "เกิดข้อผิดพลาด");
        } else {
          setResult({
            answer: data.answer ?? "",
            citations: Array.isArray(data.citations) ? data.citations : [],
            cached: Boolean(data.cached),
          });
          // Update history (move to top, dedupe, cap)
          setHistory((prev) => {
            const next = [trimmed, ...prev.filter((p) => p !== trimmed)].slice(
              0,
              MAX_HISTORY,
            );
            persistHistory(next);
            return next;
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "ติดต่อระบบไม่ได้");
      } finally {
        setLoading(false);
      }
    },
    [persistHistory],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!loading) void submit(query);
  };

  const runExample = (ex: string) => {
    setQuery(ex);
    void submit(ex);
  };

  return (
    <div className="space-y-5">
      {/* Input form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-400">
            <Search className="size-5" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ถามอะไรก็ได้เกี่ยวกับเอกสาร เช่น 'ใบอนุญาต KKN ใกล้หมดไหม'"
            maxLength={500}
            className="w-full h-14 pl-12 pr-4 text-base rounded-2xl border border-zinc-200 bg-white focus:border-[var(--color-brand-600)] focus:ring-2 focus:ring-[var(--color-brand-100)] outline-none transition placeholder:text-zinc-400"
            disabled={loading}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            {query.length}/500 ตัวอักษร
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={loading || query.trim().length < 2}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังค้น...
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                ค้นหา
              </>
            )}
          </Button>
        </div>
      </form>

      {/* Example chips */}
      {!result && !loading && (
        <div>
          <p className="text-xs font-bold text-zinc-500 mb-2">
            ลองถาม
          </p>
          <div className="flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => runExample(ex)}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 bg-white text-zinc-700 hover:border-[var(--color-brand-300)] hover:text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] transition"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {!result && !loading && history.length > 0 && (
        <div>
          <p className="text-xs font-bold text-zinc-500 mb-2 flex items-center gap-1.5">
            <History className="size-3.5" />
            คำค้นล่าสุด
          </p>
          <div className="flex flex-wrap gap-2">
            {history.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => runExample(h)}
                className="text-xs px-3 py-1.5 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 transition"
              >
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-900">เกิดข้อผิดพลาด</p>
            <p className="text-sm text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 animate-pulse">
          <div className="flex items-center gap-2 mb-3">
            <Loader2 className="size-4 animate-spin text-[var(--color-brand-600)]" />
            <p className="text-sm text-zinc-600">AI กำลังค้นและประมวลผล...</p>
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-zinc-100 rounded w-3/4"></div>
            <div className="h-3 bg-zinc-100 rounded w-5/6"></div>
            <div className="h-3 bg-zinc-100 rounded w-2/3"></div>
          </div>
        </div>
      )}

      {/* Answer */}
      {result && !loading && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[var(--color-brand-700)]" />
                <p className="text-xs uppercase tracking-[0.16em] font-bold text-[var(--color-brand-700)]">
                  คำตอบ
                </p>
              </div>
              {result.cached && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                  อ่านจากที่เคยถาม
                </span>
              )}
            </div>
            <AnswerWithCitations
              text={result.answer}
              citations={result.citations}
            />
          </div>

          {/* Citations panel */}
          {result.citations.length > 0 && (
            <div>
              <p className="text-xs font-bold text-zinc-500 mb-2">
                เอกสาร / รถ / บุคคล ที่อ้างอิง
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {result.citations.map((c) => (
                  <CitationLink key={`${c.type}:${c.id}`} citation={c} />
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 items-center">
            <button
              type="button"
              onClick={() => exportSearchToCsv(query, result)}
              disabled={result.citations.length === 0}
              className="text-xs text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] transition disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              📊 Export Excel (CSV)
            </button>
            <span className="text-zinc-300">·</span>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setQuery("");
                setError(null);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-900 transition"
            >
              ล้างผลลัพธ์ + ถามใหม่
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   AnswerWithCitations — strip [type:id] tokens from text body
   (citations are surfaced in their own panel below)
   ============================================================ */

function AnswerWithCitations({
  text,
  citations,
}: {
  text: string;
  citations: Citation[];
}) {
  // Remove inline [document:UUID] / [vehicle:UUID] / [person:UUID] tokens —
  // they're for the model to cite to the citation panel, not the user.
  const cleaned = text.replace(
    /\s*\[(document|vehicle|person|branch):[a-f0-9-]+\]/gi,
    "",
  );
  void citations; // present so callers know to render citation panel separately
  return (
    <p className="text-sm text-zinc-900 leading-relaxed whitespace-pre-wrap">
      {cleaned}
    </p>
  );
}

/* ============================================================
   CitationLink — link to detail page
   ============================================================ */

function CitationLink({ citation }: { citation: Citation }) {
  const href = citationHref(citation);
  const Icon =
    citation.type === "vehicle"
      ? Truck
      : citation.type === "person"
        ? UserIcon
        : FileText;
  const typeLabel: Record<Citation["type"], string> = {
    document: "เอกสาร",
    vehicle: "รถ",
    person: "บุคคล",
    branch: "สาขา",
  };
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] transition"
    >
      <span className="size-8 shrink-0 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-100)] flex items-center justify-center text-[var(--color-brand-700)] group-hover:bg-white">
        <Icon className="size-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-bold text-zinc-500">
          {typeLabel[citation.type]}
        </span>
        <span className="block text-sm text-zinc-900 font-medium truncate">
          {citation.label}
        </span>
      </span>
      <ArrowUpRight className="size-4 text-zinc-400 group-hover:text-[var(--color-brand-600)] shrink-0" />
    </Link>
  );
}

function citationHref(c: Citation): string {
  switch (c.type) {
    case "document":
      return `/docuflow/documents/${c.id}`;
    case "vehicle":
      return `/docuflow/vehicles/${c.id}`;
    case "person":
      return `/docuflow/persons/${c.id}`;
    case "branch":
      return `/cashhub/reports?branch=${c.id}`;
  }
}
