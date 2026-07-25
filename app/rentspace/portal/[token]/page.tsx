// PUBLIC พอร์ทัลผู้เช่า — ไม่มี login · portalToken = กุญแจ (เหมือน /rentspace/bill/[token])
// ผู้เช่าเปิดลิงก์เชิญ → ดูใบแจ้งหนี้ทุกใบ · ข่าวสาร · เอกสาร · แจ้งชำระ+แนบสลิป · ผูก LINE/อีเมล
import "@/components/rentspace/tokens.css";
import { notFound } from "next/navigation";
import { getTenantByPortalToken, loadPortalData } from "@/lib/rentspace/portal";
import { tenantDisplayName, toNum } from "@/lib/rentspace/format";
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
  searchParams: Promise<{ line?: string }>;
}) {
  const { token } = await params;
  const { line } = await searchParams;
  const tenant = await getTenantByPortalToken(token);
  if (!tenant) notFound();

  const { bills, documents, announcements } = await loadPortalData(tenant.id, tenant.orgId);

  const billVMs = bills.map((b) => ({
    id: b.id,
    billNo: b.billNo,
    period: b.period,
    status: b.status as string,
    dueDate: b.dueDate.toISOString().slice(0, 10),
    total: toNum(b.totalAmount),
    paid: toNum(b.paidAmount),
    unitCode: b.unit?.code ?? "",
    projectName: b.project?.name ?? "",
    publicToken: b.publicToken ?? null,
    // มีสลิปของผู้เช่าที่รอแอดมินตรวจอยู่ไหม → โชว์ป้าย "รอตรวจสอบ"
    pendingSlip: b.payments.some((p) => p.status === "pending" && p.source === "tenant"),
  }));

  const annVMs = announcements.map((a) => ({
    id: a.id,
    title: a.title,
    body: a.body,
    pinned: a.pinned,
    publishedAt: (a.publishedAt ?? a.createdAt).toISOString(),
    attachmentUrls: a.attachmentUrls ?? [],
  }));

  const docVMs = documents.map((d) => ({
    id: d.id,
    label: d.label ?? "เอกสาร",
    url: d.url,
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <PortalClient
      token={token}
      tenantName={tenantDisplayName(tenant)}
      bills={billVMs}
      announcements={annVMs}
      documents={docVMs}
      lineLinked={!!tenant.lineUserId}
      email={tenant.email ?? ""}
      emailOptIn={tenant.emailBillOptIn}
      lineNotice={(line && LINE_NOTICE[line]) || null}
    />
  );
}
