// Generic iframe preview shell — loads any /public/auditme/<slug>.html
// at full viewport. Renders the Claude.ai/design HTML mockup as-is so
// CEO can review pixel-perfect output before we convert to React.

import Link from "next/link";
import { notFound } from "next/navigation";
import { promises as fs } from "node:fs";
import path from "node:path";

const VALID_SLUGS = new Set([
  "design-system-v2",
  "hero",
  "owner-overview",
  "inspection",
  "sop",
  "schedule",
  "repairs",
  "rich-menu",
  "compliance-report",
]);

const TITLE_BY_SLUG: Record<string, string> = {
  "design-system-v2": "Design System v2",
  "hero": "Hero Redesign",
  "owner-overview": "Owner Overview",
  "inspection": "Inspection Console",
  "sop": "SOP Redesign v2",
  "schedule": "Schedule",
  "repairs": "Repairs",
  "rich-menu": "LINE Rich Menu v2",
  "compliance-report": "Daily Compliance Report",
};

export const dynamic = "force-dynamic";

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!VALID_SLUGS.has(slug)) notFound();

  const file = path.join(process.cwd(), "public", "auditme", `${slug}.html`);
  let exists = false;
  try {
    await fs.access(file);
    exists = true;
  } catch {
    exists = false;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-[#EEEEE6]">
      {/* Mini top bar */}
      <header className="flex items-center gap-3 px-4 sm:px-6 py-2.5 border-b border-slate-200/70 bg-white/85 backdrop-blur shrink-0">
        <Link href="/auditme" className="text-xs text-slate-500 hover:text-slate-900 transition">
          ← AuditMe Hub
        </Link>
        <span className="text-slate-300">/</span>
        <h1 className="text-sm font-semibold text-slate-900 truncate">{TITLE_BY_SLUG[slug]}</h1>
        <div className="ml-auto flex items-center gap-2">
          <a
            href={`/auditme/${slug}.html`}
            target="_blank"
            rel="noopener"
            className="font-mono text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-900 transition"
          >
            เปิดในแท็บใหม่ ↗
          </a>
        </div>
      </header>

      {exists ? (
        <iframe
          src={`/auditme/${slug}.html`}
          className="flex-1 w-full border-0"
          title={TITLE_BY_SLUG[slug]}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div>
            <div className="text-5xl mb-3">📄</div>
            <h2 className="text-xl font-semibold text-slate-900">ยังไม่มีไฟล์ HTML</h2>
            <p className="mt-2 text-sm text-slate-500">
              คาดว่าอยู่ที่ <code className="font-mono text-xs">public/auditme/{slug}.html</code>
            </p>
            <Link href="/auditme" className="mt-4 inline-block text-blue-600 hover:underline text-sm">
              ← กลับ AuditMe Hub
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
