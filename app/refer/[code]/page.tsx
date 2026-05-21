// Public referral landing — /refer/<code>
// Per Recruit Redesign canvas section 12 (employee shares this link)
//
// Flow: friend opens link → see referrer name + branded landing → click → /apply/<posting>
// or /recruit if no posting attached.

import Link from "next/link";
import { redirect } from "next/navigation";
import { lookupReferral } from "@/lib/recruit/referral-actions";
import { CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReferLandingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const ref = await lookupReferral(code);

  if (!ref) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50">
        <div className="max-w-md w-full bg-white rounded-3xl border-2 border-zinc-200 p-8 text-center">
          <p className="text-5xl mb-3">🤔</p>
          <h1 className="text-2xl font-extrabold text-zinc-900 font-display">
            ลิ้งค์ไม่ถูกต้อง
          </h1>
          <p className="text-sm text-zinc-600 mt-2">
            ลิ้งค์ที่คุณคลิกอาจหมดอายุแล้ว · ลองขอใหม่จากเพื่อน
          </p>
        </div>
      </div>
    );
  }

  // If referral targets a specific posting · redirect to that apply page with attribution
  if (ref.postingSlug) {
    redirect(`/apply/${ref.postingSlug}?ref=${code}`);
  }

  // Generic referral landing (no specific posting · let friend browse openings)
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-white py-12 px-6">
      <div className="max-w-md mx-auto">
        <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="size-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500 to-purple-700 text-white flex items-center justify-center text-3xl">
            🎉
          </div>
          <h1 className="text-2xl font-extrabold text-zinc-900 font-display mt-5 leading-tight">
            <b className="text-purple-700">{ref.referrerName}</b>
            <br />
            ชวนคุณมาสมัครงาน
          </h1>
          <p className="text-sm text-zinc-600 mt-3 leading-relaxed">
            ที่ <b className="text-zinc-900">{ref.orgName}</b> · มีตำแหน่งงานเปิดรับ
            หลายอัน · มาดูกัน
          </p>

          <div className="mt-6 inline-flex items-center gap-1.5 text-xs text-purple-700 bg-purple-50 px-3 py-1.5 rounded-full">
            <CheckCircle2 className="size-3.5" />
            รหัสของคุณ · {code}
          </div>

          <Link
            href={`/jobs?ref=${code}`}
            className="mt-8 block w-full h-12 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm flex items-center justify-center"
          >
            ดูตำแหน่งงานที่เปิดรับ →
          </Link>

          <p className="text-[11px] text-zinc-400 mt-4 leading-relaxed">
            พอเพื่อนคุณรับเข้าทำงาน · {ref.referrerName} จะได้โบนัสตาม
            ข้อกำหนดบริษัท
          </p>
        </div>
      </div>
    </div>
  );
}
