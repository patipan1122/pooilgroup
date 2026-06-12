// /chairops/settings/drive — connect the org's Google Drive backup (CEO 2026-06-03).

import Link from "next/link";
import {
  CloudUpload,
  CheckCircle2,
  AlertTriangle,
  FolderTree,
} from "lucide-react";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/chairops/auth/session";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import {
  getDriveConnection,
  isDriveOAuthConfigured,
} from "@/lib/chairops/storage/drive";
import { prisma } from "@/lib/prisma";
import { ConnectButton, DisconnectButton } from "./drive-connect-buttons";

export const dynamic = "force-dynamic";

const ERR_MSG: Record<string, string> = {
  forbidden: "คุณไม่มีสิทธิ์ (ต้องเป็น CEO/ADMIN)",
  bad_state: "การเชื่อมต่อหมดเวลา ลองใหม่อีกครั้ง",
  exchange_failed: "แลก token กับ Google ไม่สำเร็จ · ตรวจ Client ID/Secret + redirect URI",
  store_failed: "บันทึกการเชื่อมต่อไม่สำเร็จ",
};

export default async function DriveSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  // เชื่อม Google Drive = โครงสร้างเจ้าของระบบ → เฉพาะ Pool super_admin (CEO 2026-06-12)
  if (!isSuperAdmin(session.poolUser.role)) redirect("/chairops?error=forbidden");
  const sp = await searchParams;
  const conn = await getDriveConnection(session.user.orgId);
  const configured = isDriveOAuthConfigured();
  const assetCount = await prisma.chairopsDriveAsset.count({
    where: { orgId: session.user.orgId },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <div className="text-xs text-zinc-500">
          <Link href="/chairops" className="hover:text-emerald-700">
            เก้าอี้นวด
          </Link>{" "}
          / ตั้งค่า / Google Drive
        </div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-900">
          <CloudUpload className="size-5 text-blue-600" /> สำรองไฟล์ขึ้น Google Drive
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          เก็บสลิป/ใบเสร็จ/สัญญา ขึ้น Google Drive ของบริษัท (พื้นที่ฟรี 2TB) —
          แล้วลบสำเนาฝั่งเราอัตโนมัติหลัง ~2 เดือนเพื่อประหยัด
        </p>
      </header>

      {sp.connected && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="size-4" /> เชื่อม Google Drive สำเร็จ
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
              <dt className="text-zinc-500">โฟลเดอร์หลัก</dt>
              <dd className="font-medium text-zinc-800">{conn.rootFolderName}</dd>
              <dt className="text-zinc-500">ไฟล์ที่สำรองแล้ว</dt>
              <dd className="font-medium text-zinc-800">{assetCount} ไฟล์</dd>
              <dt className="text-zinc-500">เชื่อมเมื่อ</dt>
              <dd className="font-medium text-zinc-800">
                {conn.createdAt.toLocaleDateString("th-TH")}
              </dd>
            </dl>
            <DisconnectButton />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600">
              ยังไม่ได้เชื่อม Google Drive — กดปุ่มเพื่อล็อกอินบัญชี Google
              ของบริษัทและอนุญาตให้ระบบสร้างโฟลเดอร์ + อัปโหลดไฟล์
            </p>
            <ConnectButton />
          </div>
        )}
      </section>

      {/* folder structure preview */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <FolderTree className="size-4 text-zinc-500" /> โครงสร้างโฟลเดอร์
        </div>
        <pre className="overflow-x-auto rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-700">
{`เก้าอี้นวด backup1/
  └─ 2026-06/
       ├─ ค่าใช้จ่าย/      (สลิปจ่ายบิล)
       ├─ สลิปรายได้/     (สลิปฝากเงินแม่บ้าน)
       └─ สัญญา/          (สัญญาจ้างแม่บ้าน)`}
        </pre>
      </section>

      {/* setup guide */}
      {!conn && (
        <section className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm">
          <h2 className="mb-2 font-semibold text-zinc-800">
            ตั้งค่าครั้งแรก (ทำครั้งเดียว)
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-zinc-600">
            <li>
              ไปที่ Google Cloud Console → สร้าง OAuth Client ID (ชนิด Web
              application)
            </li>
            <li>
              ใส่ Authorized redirect URI:{" "}
              <code className="break-all text-xs">
                https://pooilgroup.vercel.app/api/chairops/drive/oauth/callback
              </code>
            </li>
            <li>
              เอา Client ID + Secret ไปใส่ใน Vercel env:{" "}
              <code>GOOGLE_OAUTH_CLIENT_ID</code>,{" "}
              <code>GOOGLE_OAUTH_CLIENT_SECRET</code>
            </li>
            <li>กลับมาหน้านี้ กด &quot;เชื่อม Google Drive&quot;</li>
          </ol>
        </section>
      )}
    </div>
  );
}
