// หน้า diagnostic ชั่วคราว — ใช้หาเหตุที่ /fuelos/* เด้ง error (ลบทิ้งหลังแก้เสร็จ).
// แอปอ่าน DB ของตัวเอง (ตามสิทธิ์ปกติ) แล้วโชว์ error จริง + ข้อมูล + webhook URL บนจอ.
// ทุก query หุ้ม safe() → หน้านี้ "พังไม่ได้" จึงเห็นทุก error พร้อมกัน.
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/fuelos/auth";
import { listUsers, getStaffWorkload } from "@/lib/fuelos/settings-data";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; err: string }> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, err: msg };
  }
}

export default async function FuelosDiagPage() {
  const session = await requireSession();
  const u = session.user;
  if (!["super_admin", "org_admin", "admin"].includes(u.role)) {
    return <div className="p-6 text-sm">หน้านี้เฉพาะผู้ดูแลระบบ</div>;
  }

  const ctx = await safe(() => getCurrentUser());
  const orgs = await safe(() => prisma.org.findMany({ select: { id: true, name: true } }));
  const users = await safe(() =>
    prisma.fuelUser.findMany({ select: { id: true, email: true, orgId: true, role: true, isActive: true } }),
  );
  const channels = await safe(() =>
    prisma.fuelInboxChannel.findMany({
      select: { id: true, displayName: true, externalId: true, status: true, botEnabled: true },
    }),
  );
  const orgId = ctx.ok ? ctx.data.orgId : u.org_id;
  const usersQ = await safe(() => listUsers(orgId));
  const workloadQ = await safe(() => getStaffWorkload(orgId));

  const origin = "https://pooilgroup.vercel.app";

  return (
    <div className="p-4 space-y-3 text-xs">
      <h1 className="text-base font-bold">⛽ FuelOS Diagnostic</h1>

      <Box title="1. Pool session (ใครล็อกอิน)">
        {`id      = ${u.id}\nemail   = ${u.email}\norg_id  = ${u.org_id}\nrole    = ${u.role}`}
      </Box>

      <Box title="2. getCurrentUser() — สะพานเชื่อม login (จุดที่น่าจะพัง)">
        {ctx.ok
          ? `✅ OK\nid     = ${ctx.data.id}\norgId  = ${ctx.data.orgId}\nrole   = ${ctx.data.role}`
          : `❌ ERROR:\n${ctx.err}`}
      </Box>

      <Box title="3. fuel.orgs (บริษัทในระบบน้ำมัน)">
        {orgs.ok
          ? orgs.data.length
            ? orgs.data.map((o) => `${o.id}  ·  ${o.name}`).join("\n")
            : "(ว่าง — ไม่มี org)"
          : `❌ ${orgs.err}`}
      </Box>

      <Box title="4. fuel.users (บัญชีในระบบน้ำมัน — เทียบ email กับข้อ 1)">
        {users.ok
          ? users.data.length
            ? users.data.map((x) => `${x.email}  ·  ${x.role}  ·  org=${x.orgId}  ·  active=${x.isActive}`).join("\n")
            : "(ว่าง — ไม่มี user)"
          : `❌ ${users.err}`}
      </Box>

      <Box title="5. fuel.inbox_channels + 🔗 WEBHOOK URL (ก๊อปไปวาง LINE)">
        {channels.ok
          ? channels.data.length
            ? channels.data
                .map(
                  (c) =>
                    `${c.displayName}  ·  LINE id=${c.externalId ?? "-"}  ·  ${c.status}\n→ ${origin}/api/fuelos/webhooks/line/${c.id}`,
                )
                .join("\n\n")
            : "(ว่าง — ไม่มี channel)"
          : `❌ ${channels.err}`}
      </Box>

      <Box title="6. listUsers(orgId) — query แท็บพนักงาน">
        {usersQ.ok ? `✅ OK · ${usersQ.data.length} users` : `❌ ${usersQ.err}`}
      </Box>

      <Box title="7. getStaffWorkload(orgId) — query แท็บพนักงาน">
        {workloadQ.ok ? `✅ OK · ${Object.keys(workloadQ.data).length} staff` : `❌ ${workloadQ.err}`}
      </Box>
    </div>
  );
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-300 p-3 bg-white">
      <div className="font-bold text-[11px] text-zinc-500 mb-1.5">{title}</div>
      <pre className="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-zinc-800">{children}</pre>
    </div>
  );
}
