import Link from "next/link";
import { ExternalLink, Zap } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { BackButton } from "@/components/ui/back-button";

export const dynamic = "force-dynamic";

const REPORT_ID = "9d875e89-7730-412f-a633-73fb5881cd9a";
const PAGE_ID = "m0ViF";
const EMBED_URL = `https://lookerstudio.google.com/embed/reporting/${REPORT_ID}/page/${PAGE_ID}`;
const OPEN_URL = `https://lookerstudio.google.com/reporting/${REPORT_ID}/page/${PAGE_ID}`;

export default async function EvDashboardPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />

      <header className="mb-5 animate-fade-up">
        <p className="text-xs uppercase tracking-widest text-[var(--color-brand-600)] font-semibold flex items-center gap-1.5">
          <Zap className="size-3.5" />
          EV CHARGING · PEA VOLTA CONNEXT
        </p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display mt-2">
          ⚡ <span className="accent">สถานีชาร์จพีโอออยล์</span>
        </h1>
        <p className="text-zinc-600 mt-2 text-sm max-w-2xl">
          ข้อมูลสดจาก VOLTA CONNEXT — รายได้ · พลังงาน (kWh) · จำนวน session ของสาขา EV
          ทุกแห่ง · อัปเดตโดย PEA (การไฟฟ้าส่วนภูมิภาค) โดยตรง
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={OPEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-brand-600)] hover:underline"
          >
            <ExternalLink className="size-3.5" />
            เปิดในแท็บใหม่ (แบบเต็มจอ)
          </Link>
          <span className="text-zinc-300">·</span>
          <span className="text-xs text-zinc-500">
            กรณีหน้านี้ไม่แสดง = Google บล็อก iframe → กดปุ่มข้างบนแทน
          </span>
        </div>
      </header>

      <div className="rounded-2xl border-2 border-zinc-200 bg-white overflow-hidden shadow-sm animate-fade-up delay-100">
        <iframe
          src={EMBED_URL}
          title="VOLTA CONNEXT — สถานีชาร์จพีโอออยล์"
          width="100%"
          height="1400"
          frameBorder={0}
          allowFullScreen
          loading="lazy"
          className="w-full block"
        />
      </div>

      <p className="mt-3 text-[11px] text-zinc-400 text-center">
        ข้อมูลโดย PEA VOLTA CONNEXT · Pooilgroup อยู่ในฐานะ partner station operator
      </p>
    </div>
  );
}
