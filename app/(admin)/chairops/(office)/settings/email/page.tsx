// /chairops/settings/email — connect Gmail for StarThing XLSX auto-import. CEO 2026-06-05.

import Link from "next/link";
import { Mail, CheckCircle2, AlertTriangle, Clock } from "lucide-react";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { getGmailConnection, isGmailOAuthConfigured } from "@/lib/chairops/email/gmail";
import { GmailConnectButton, GmailDisconnectButton } from "./email-connect-buttons";

export const dynamic = "force-dynamic";

const ERR_MSG: Record<string, string> = {
  forbidden: "คุณไม่มีสิทธิ์ (ต้องเป็น CEO/ADMIN)",
  bad_state: "การเชื่อมต่อหมดเวลา ลองใหม่อีกครั้ง",
  exchange_failed: "แลก token กับ Google ไม่สำเร็จ · ตรวจ Client ID/Secret + redirect URI",
  store_failed: "บันทึกการเชื่อมต่อไม่สำเร็จ",
};

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  // เชื่อม Gmail (StarThing XLSX) = โครงสร้างเจ้าของระบบ → เฉพาะ Pool super_admin (CEO 2026-06-12)
  if (!isSuperAdmin(session.poolUser.role)) redirect("/chairops?error=forbidden");
  const sp = await searchParams;
  const conn = await getGmailConnection(session.user.orgId);
  const configured = isGmailOAuthConfigured();

  const lastSyncDisplay = conn?.lastSyncAt
    ? conn.lastSyncAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })
    : "—";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <div className="text-xs text-zinc-500">
          <Link href="/chairops" className="hover:text-emerald-700">
            เก้าอี้นวด
          </Link>{" "}
          / ตั้งค่า / Gmail Auto-Import
        </div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
          <Mail className="size-5 text-blue-600" /> Gmail Auto-Import · StarThing XLSX
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          เชื่อม Gmail → ระบบดึงไฟล์ XLSX จาก <code className="text-xs">notify@starthing.com</code>{" "}
          เข้าระบบอัตโนมัติทุกวัน 08:00 น. โดยไม่ต้องโหลดไฟล์มือถือ
        </p>
      </header>

      {sp.connected && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" /> เชื่อม Gmail สำเร็จ
        </div>
      )}
      {sp.error && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="size-4" />
          {ERR_MSG[sp.error] ?? sp.error}
        </div>
      )}

      {!configured && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          ⚠️ ยังไม่ได้ตั้งค่า <code>GOOGLE_OAUTH_CLIENT_ID</code> +{" "}
          <code>GOOGLE_OAUTH_CLIENT_SECRET</code> ใน Vercel — ดูขั้นตอนด้านล่าง
        </div>
      )}

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        {conn ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
              <CheckCircle2 className="size-4" /> เชื่อมต่อแล้ว
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-zinc-500">อีเมล</dt>
              <dd className="font-medium text-zinc-800">{conn.gmailEmail ?? "—"}</dd>
              <dt className="text-zinc-500">sync ล่าสุด</dt>
              <dd className="font-medium text-zinc-800">{lastSyncDisplay}</dd>
              <dt className="text-zinc-500">สถานะ</dt>
              <dd className={`font-medium ${conn.lastSyncStatus === "ok" ? "text-emerald-700" : "text-amber-700"}`}>
                {conn.lastSyncStatus ?? "ยังไม่เคย sync"}
              </dd>
              {conn.lastSyncCount > 0 && (
                <>
                  <dt className="text-zinc-500">import ล่าสุด</dt>
                  <dd className="font-medium text-zinc-800">{conn.lastSyncCount} แถว</dd>
                </>
              )}
            </dl>
            <GmailDisconnectButton />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">
              ยังไม่ได้เชื่อม Gmail — กดปุ่มเพื่อล็อกอินบัญชี Google ที่รับอีเมล StarThing
            </p>
            <GmailConnectButton />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <Clock className="size-4 text-zinc-500" /> กำหนดการทำงานอัตโนมัติ
        </div>
        <ul className="space-y-1 text-sm text-zinc-600">
          <li>• ทุกวัน 08:00 น. (Thailand) — ค้นหาอีเมล <code className="text-xs">notify@starthing.com</code> 7 วันย้อนหลัง</li>
          <li>• ถ้าไฟล์ซ้ำกับที่ import แล้ว → ข้าม (dedup ด้วย SHA-256)</li>
          <li>• ถ้าชื่อสาขาไม่ตรง → ข้าม ไม่ import อัตโนมัติ (ต้อง upload มือ)</li>
          <li>• ถ้า import สำเร็จ → คำนวณ drift + แจ้งเตือนขาดเงินใหม่ทันที</li>
        </ul>
      </section>

      {!conn && (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold text-zinc-800">ตั้งค่าครั้งแรก (ทำครั้งเดียว)</h2>
          <ol className="list-decimal space-y-1 pl-5 text-zinc-600">
            <li>
              ไปที่ Google Cloud Console → เปิด OAuth Client ID เดิม (ที่ใช้กับ Google Drive) → เพิ่ม Authorized redirect URI:
              <code className="ml-1 break-all text-xs">
                https://pooilgroup.vercel.app/api/chairops/email/oauth/callback
              </code>
            </li>
            <li>
              ตรวจว่าใน Vercel มี: <code>GOOGLE_OAUTH_CLIENT_ID</code>, <code>GOOGLE_OAUTH_CLIENT_SECRET</code>
            </li>
            <li>กลับมาหน้านี้ กด &quot;เชื่อม Gmail&quot; → ล็อกอินด้วยบัญชีที่รับอีเมล StarThing</li>
          </ol>
        </section>
      )}
    </div>
  );
}
