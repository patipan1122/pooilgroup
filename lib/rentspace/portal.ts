// พอร์ทัลผู้เช่า (ลิงก์เชิญ) — ไม่มี login ของผู้เช่า · portalToken (สุ่มยาว) = กุญแจ
// สะท้อนแนวทางเดียวกับ /rentspace/bill/[token] + /sign/rentspace/[token] (public, token=credential)
import { randomBytes, randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { putObject } from "@/lib/r2/upload";
import { getBaseUrl } from "@/lib/utils/base-url";

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
