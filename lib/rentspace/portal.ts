// พอร์ทัลผู้เช่า (ลิงก์เชิญ) — ไม่มี login ของผู้เช่า · portalToken (สุ่มยาว) = กุญแจ
// สะท้อนแนวทางเดียวกับ /rentspace/bill/[token] + /sign/rentspace/[token] (public, token=credential)
import { randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { putObject } from "@/lib/r2/upload";
import { getBaseUrl } from "@/lib/utils/base-url";
import { toNum, tenantDisplayName } from "@/lib/rentspace/format";

/** ออก token ลิงก์เชิญ (24 ไบต์สุ่ม ≈ 192 บิต · เดายาก) */
export function newPortalToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * คืน portalToken ที่ใช้งานได้ของผู้เช่า — สร้างใหม่ถ้ายังไม่มี.
 * ถ้าลิงก์ถูกเพิกถอน (portalRevoked) → คืน null (เคารพการเพิกถอน · ไม่ปลุกคืนเอง).
 * ใช้ตอนส่งแจ้งเตือน: มีลิงก์อยู่แล้ว→ใช้เลย · ยังไม่มี→ออกให้อัตโนมัติ (แอดมินไม่ต้องกดเอง).
 */
export async function ensurePortalToken(tenantId: string): Promise<string | null> {
  const t = await prisma.rentalTenant.findUnique({
    where: { id: tenantId },
    select: { portalToken: true, portalRevoked: true },
  });
  if (!t) return null;
  if (t.portalRevoked) return null;
  if (t.portalToken) return t.portalToken;
  const token = newPortalToken();
  await prisma.rentalTenant.update({
    where: { id: tenantId },
    data: { portalToken: token, portalTokenAt: new Date() },
  });
  return token;
}

/** ลิงก์พอร์ทัลเต็ม (absolute) */
export function portalUrl(token: string): string {
  return `${getBaseUrl().replace(/\/$/, "")}/rentspace/portal/${token}`;
}

/**
 * หาผู้เช่าจาก portalToken — public, ไม่ผูก orgId (token คือกุญแจ).
 * คืน null ถ้าไม่พบ / ลิงก์ถูกเพิกถอน / ผู้เช่าถูกปิด → หน้าเรียก notFound().
 */
export async function getTenantByPortalToken(token: string) {
  if (!token) return null;
  const tenant = await prisma.rentalTenant.findUnique({ where: { portalToken: token } });
  if (!tenant || tenant.portalRevoked || !tenant.isActive) return null;
  return tenant;
}

/** โหลดข้อมูลที่ผู้เช่าเห็นในพอร์ทัล: บิล (ไม่รวมร่าง/ยกเลิก) + ข่าว + เอกสาร */
export async function loadPortalData(tenantId: string, orgId: string) {
  const [bills, contracts, documents] = await Promise.all([
    prisma.rentalBill.findMany({
      where: { tenantId, orgId, status: { notIn: ["void", "draft"] } },
      orderBy: [{ period: "desc" }, { billNo: "desc" }],
      include: {
        unit: true,
        project: true,
        items: { orderBy: { sort: "asc" } },
        payments: { orderBy: { createdAt: "desc" } },
      },
      take: 60,
    }),
    prisma.rentalContract.findMany({ where: { tenantId, orgId }, select: { projectId: true } }),
    prisma.rentalDocument.findMany({
      where: { orgId, ownerType: "tenant", ownerId: tenantId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const projectIds = Array.from(new Set(contracts.map((c) => c.projectId).filter(Boolean)));
  const announcements = await prisma.rentalAnnouncement.findMany({
    where: {
      orgId,
      isPublished: true,
      // ข่าวส่วนกลาง (projectId=null) หรือข่าวของโครงการที่ผู้เช่ามีสัญญาอยู่
      OR: [{ projectId: null }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])],
    },
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }, { createdAt: "desc" }],
    take: 30,
  });

  return { bills, documents, announcements };
}

// ── View model ที่ใช้ร่วมกันทั้งพอร์ทัลลิงก์ (page.tsx) และ LIFF (เว็บแอปในไลน์) ──
export type PortalBillVM = {
  id: string; billNo: string; period: string; status: string; dueDate: string;
  total: number; paid: number; unitCode: string; projectName: string;
  publicToken: string | null; pendingSlip: boolean;
};
export type PortalAnnVM = { id: string; title: string; body: string; pinned: boolean; publishedAt: string; attachmentUrls: string[] };
export type PortalDocVM = { id: string; label: string; url: string; createdAt: string };
export type PortalPayVM = { id: string; billNo: string; amount: number; paidOn: string; method: string };
export type PortalView = {
  tenantName: string; token: string; lineLinked: boolean; email: string; emailOptIn: boolean;
  bills: PortalBillVM[]; announcements: PortalAnnVM[]; documents: PortalDocVM[]; payments: PortalPayVM[];
};

type TenantRow = {
  id: string; orgId: string; email: string | null; emailBillOptIn: boolean; lineUserId: string | null;
} & Record<string, unknown>;

/** โหลด + serialize ข้อมูลพอร์ทัลทั้งหมด (บิล/ข่าว/เอกสาร/ประวัติชำระ) เป็น plain object ส่งเข้า client */
export async function buildPortalView(tenant: TenantRow): Promise<PortalView> {
  const { bills, documents, announcements } = await loadPortalData(tenant.id, tenant.orgId);
  const payments = await prisma.rentalPayment.findMany({
    where: { orgId: tenant.orgId, status: "confirmed", bill: { tenantId: tenant.id } },
    orderBy: { paidOn: "desc" },
    take: 50,
    include: { bill: { select: { billNo: true } } },
  });
  const token = (await ensurePortalToken(tenant.id)) ?? "";

  return {
    tenantName: tenantDisplayName(tenant as never),
    token,
    lineLinked: !!tenant.lineUserId,
    email: tenant.email ?? "",
    emailOptIn: tenant.emailBillOptIn,
    bills: bills.map((b) => ({
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
      pendingSlip: b.payments.some((p) => p.status === "pending" && p.source === "tenant"),
    })),
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      pinned: a.pinned,
      publishedAt: (a.publishedAt ?? a.createdAt).toISOString(),
      attachmentUrls: a.attachmentUrls ?? [],
    })),
    documents: documents.map((d) => ({ id: d.id, label: d.label ?? "เอกสาร", url: d.url, createdAt: d.createdAt.toISOString() })),
    payments: payments.map((p) => ({
      id: p.id,
      billNo: p.bill?.billNo ?? "",
      amount: toNum(p.amountThb),
      paidOn: p.paidOn.toISOString().slice(0, 10),
      method: p.method,
    })),
  };
}

/**
 * อัปโหลดสลิปจากฝั่งผู้เช่า (ไม่มี admin session) → R2 · โฟลเดอร์เดียวกับที่แอดมินอัป.
 * รับเฉพาะรูป/PDF · เพดาน 8MB. คืน public URL.
 */
export async function uploadPortalSlip(orgId: string, dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("ไฟล์ไม่ถูกต้อง");
  const mime = m[1];
  if (!/^image\/|^application\/pdf/.test(mime)) throw new Error("แนบได้เฉพาะรูปภาพหรือไฟล์ PDF");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 8 * 1024 * 1024) throw new Error("ไฟล์ใหญ่เกิน 8MB");
  const ext = mime.includes("pdf") ? "pdf" : mime.split("/")[1]?.split("+")[0] || "bin";
  const key = `orgs/${orgId}/rentspace/slips/${randomUUID()}.${ext}`;
  return putObject(key, buf, mime);
}
