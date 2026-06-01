// AuditMe preview hub — lists all design files extracted from the
// Claude.ai/design "auditmekub" bundle. Each card opens the real HTML
// mockup in an iframe via /auditme/preview/[slug].

import Link from "next/link";

const PREVIEWS: Array<{ slug: string; title: string; tag: string; size: string }> = [
  { slug: "design-system-v2", title: "Design System v2", tag: "Foundation", size: "83 KB" },
  { slug: "hero", title: "Hero Redesign", tag: "Landing", size: "2 KB" },
  { slug: "owner-overview", title: "Owner Overview", tag: "Dashboard", size: "3 KB" },
  { slug: "inspection", title: "Inspection Console", tag: "Ops", size: "3 KB" },
  { slug: "sop", title: "SOP Redesign v2", tag: "Ops", size: "6 KB" },
  { slug: "schedule", title: "Schedule", tag: "Ops", size: "68 KB" },
  { slug: "repairs", title: "Repairs", tag: "Ops", size: "77 KB" },
  { slug: "rich-menu", title: "LINE Rich Menu v2", tag: "Mobile", size: "66 KB" },
  { slug: "compliance-report", title: "Daily Compliance Report", tag: "Report", size: "3 KB" },
];

const TAG_TONE: Record<string, string> = {
  Foundation: "bg-blue-50 text-blue-700 ring-blue-200",
  Landing: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  Dashboard: "bg-violet-50 text-violet-700 ring-violet-200",
  Ops: "bg-amber-50 text-amber-700 ring-amber-200",
  Mobile: "bg-rose-50 text-rose-700 ring-rose-200",
  Report: "bg-slate-100 text-slate-700 ring-slate-200",
};

export default function AuditMeHub() {
  return (
    <main className="mx-auto max-w-[1280px] px-6 sm:px-10 py-12 sm:py-16">
      <div className="max-w-2xl">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">AuditMe · Design Preview</div>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900" style={{ textWrap: "balance" }}>
          ระบบ SOP + ตรวจงาน + KPI <br />
          <span className="text-blue-600">สำหรับธุรกิจบริการ</span>
        </h1>
        <p className="mt-5 max-w-prose text-base leading-relaxed text-slate-600">
          คลังออกแบบ HTML จาก Claude.ai/design — Design System v2 + 8 หน้า surface (Hero · Owner ·
          Inspection · SOP · Schedule · Repairs · Rich Menu · Compliance Report). คลิกเปิดดูในเฟรมเต็มจอ ·
          เป็น preview เพื่อตัดสินใจ scope ก่อนแปลงเป็น production code.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">IBM Plex Sans Thai</span>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">Pastel + Duotone</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-200">Owner-first</span>
        </div>
      </div>

      <section className="mt-12">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-4">
          9 surface designs
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PREVIEWS.map((p) => (
            <Link
              key={p.slug}
              href={`/auditme/preview/${p.slug}`}
              className="group block rounded-2xl border border-slate-200/70 bg-white p-5 hover:border-slate-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ${TAG_TONE[p.tag]}`}>
                  {p.tag}
                </span>
                <span className="font-mono text-[10px] text-slate-400">{p.size}</span>
              </div>
              <div className="text-lg font-semibold text-slate-900 group-hover:text-blue-700 transition">
                {p.title}
              </div>
              <div className="mt-3 text-xs text-slate-500 group-hover:text-slate-700 transition flex items-center gap-1.5">
                เปิดดูในเฟรมเต็มจอ
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-16 rounded-2xl border border-slate-200/70 bg-white p-6">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-3">Tokens — quick reference</div>
        <h2 className="text-xl font-semibold text-slate-900 mb-4">Design System v2 · CSS variables</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-xs">
          <div>
            <div className="font-semibold text-slate-700 mb-2">Surface</div>
            <Token name="bg" hex="#EEEEE6" />
            <Token name="paper" hex="#FAFAF7" />
            <Token name="ink" hex="#0F172A" />
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-2">Brand · Blue</div>
            <Token name="blue-500" hex="#3B82F6" />
            <Token name="blue-600" hex="#2563EB" />
            <Token name="blue-700" hex="#1D4ED8" />
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-2">Semantic</div>
            <Token name="emerald" hex="#1F8A5B" />
            <Token name="amber" hex="#D97706" />
            <Token name="rose" hex="#B91C1C" />
            <Token name="violet" hex="#7C3AED" />
          </div>
          <div>
            <div className="font-semibold text-slate-700 mb-2">Pastel</div>
            <Token name="sky" hex="#DDEBFF" />
            <Token name="mint" hex="#DFF5E8" />
            <Token name="butter" hex="#FFF1CF" />
            <Token name="lav" hex="#ECE7FE" />
          </div>
        </div>
      </section>

      <footer className="mt-12 text-center text-xs text-slate-500">
        Source: <code className="text-slate-700">auditmekub</code> bundle · claude.ai/design ·
        8 chats · 47 files · Imported 2026-06-01
      </footer>
    </main>
  );
}

function Token({ name, hex }: { name: string; hex: string }) {
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <div className="h-5 w-5 rounded-md ring-1 ring-slate-200/80" style={{ background: hex }} />
      <span className="font-mono text-[11px] text-slate-700">{name}</span>
      <span className="font-mono text-[10px] text-slate-400 ml-auto">{hex}</span>
    </div>
  );
}
