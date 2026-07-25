"use server";

// CafeOrder · menu import server actions (preview + commit).
//   ทั้ง 2 step parse ไฟล์ที่ server เอง (ไม่เชื่อ rows จาก client — integrity).
//   guard: requireManager. commit re-parses แล้ว upsert.
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import { canCafeManage } from "@/lib/cafeorder/role-guard";
import { CafeBrand } from "@/lib/generated/prisma/enums";
import { parseWorkbook, previewImport, commitImport, type ImportPreview, type CommitResult } from "@/lib/cafeorder/menu-import";

async function requireManagerOrg(): Promise<string> {
  const session = await requireSession();
  if (!canCafeManage(session.user.role)) throw new Error("ไม่มีสิทธิ์นำเข้าเมนู");
  return session.user.org_id;
}

function normBrand(b: string): CafeBrand {
  return b === "punthai" ? CafeBrand.punthai : CafeBrand.amazon;
}

async function fileToBuffer(formData: FormData): Promise<Buffer | null> {
  const f = formData.get("file");
  if (!f || typeof f === "string") return null;
  const ab = await (f as File).arrayBuffer();
  return Buffer.from(ab);
}

export type PreviewResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };

export async function previewMenuImport(brand: string, formData: FormData): Promise<PreviewResult> {
  try {
    const orgId = await requireManagerOrg();
    const buf = await fileToBuffer(formData);
    if (!buf) return { ok: false, error: "ไม่พบไฟล์" };
    const { rows, fileErrors } = parseWorkbook(buf);
    if (fileErrors.length) return { ok: false, error: fileErrors.join(" · ") };
    if (!rows.length) return { ok: false, error: "ไม่มีข้อมูลในไฟล์" };
    const preview = await previewImport(orgId, normBrand(brand), rows);
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "อ่านไฟล์ไม่สำเร็จ" };
  }
}

export type CommitResp = { ok: true; result: CommitResult } | { ok: false; error: string };

export async function commitMenuImport(brand: string, formData: FormData): Promise<CommitResp> {
  try {
    const orgId = await requireManagerOrg();
    const buf = await fileToBuffer(formData);
    if (!buf) return { ok: false, error: "ไม่พบไฟล์" };
    const { rows, fileErrors } = parseWorkbook(buf);
    if (fileErrors.length) return { ok: false, error: fileErrors.join(" · ") };
    const result = await commitImport(orgId, normBrand(brand), rows);
    revalidatePath("/cafeorder/office/menu");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "นำเข้าไม่สำเร็จ" };
  }
}
