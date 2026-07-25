// PUBLIC พอร์ทัลผู้เช่า — ไม่มี login · portalToken = กุญแจ (เหมือน /rentspace/bill/[token])
// ผู้เช่าเปิดลิงก์เชิญ → ดูใบแจ้งหนี้ทุกใบ · ประวัติ · ข่าวสาร · เอกสาร · แจ้งชำระ+แนบสลิป · ผูก LINE/อีเมล
import "@/components/rentspace/tokens.css";
import { notFound } from "next/navigation";
import { getTenantByPortalToken, buildPortalView } from "@/lib/rentspace/portal";
import { PortalClient } from "./_components/portal-client";

export const dynamic = "force-dynamic";

const LINE_NOTICE: Record<string, { kind: "ok" | "err" | "info"; text: string }> = {
  ok: { kind: "ok", text: "เชื่อม LINE สำเร็จ! จะได้รับแจ้งเตือนเมื่อมีบิลใหม่" },
  err: { kind: "err", text: "เชื่อม LINE ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
  cancel: { kind: "info", text: "ยกเลิกการเชื่อม LINE แล้ว" },
  dupe: { kind: "err", text: "บัญชี LINE นี้ถูกเชื่อมกับผู้เช่ารายอื่นแล้ว" },
  unavailable: { kind: "info", text: "ระบบ LINE ยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง" },
};

export default async function TenantPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ line?: string; screen?: string }>;
}) {
  const { token } = await params;
  const { line, screen } = await searchParams;
  const tenant = await getTenantByPortalToken(token);
  if (!tenant) notFound();

  const view = await buildPortalView(tenant);

  return (
    <PortalClient
      token={token}
      tenantName={view.tenantName}
      bills={view.bills}
      announcements={view.announcements}
      documents={view.documents}
      payments={view.payments}
      lineLinked={view.lineLinked}
      email={view.email}
      emailOptIn={view.emailOptIn}
      lineNotice={(line && LINE_NOTICE[line]) || null}
      initialScreen={screen}
    />
  );
}
