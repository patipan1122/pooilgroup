// POST /api/ledger/ocr — read a receipt image with AI (no DB write).
//
// Mirrors app/api/cashhub/ocr-slip: auth + budget guard live inside parseReceipt
// (lib/ledger/ai-parse) which reuses lib/ai/cost-cap. Accepts either a multipart
// file upload OR a JSON body { imageUrl } (e.g. an already-uploaded R2 URL).
// Returns the parsed fields + per-field confidence + recheck warnings. The UI
// then shows them for human confirm — we NEVER create a row here.

import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { isAdminTier } from "@/lib/auth/role-guards";
import { parseReceipt, AiBudgetError, MAX_RECEIPT_PAGES } from "@/lib/ledger/ai-parse";
import { recheckParsed } from "@/lib/ledger/recheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAdminTier(session.user.role)) {
    const ok = await userHasModuleAccess(session.user, "ledger");
    if (!ok) return NextResponse.json({ error: "ไม่มีสิทธิ์" }, { status: 403 });
  }

  const orgId = session.user.org_id;
  const userId = session.user.id;
  const contentType = req.headers.get("content-type") ?? "";

  // string เดี่ยว (บิลหน้าเดียว) หรือ string[] (บิลหลายหน้า = หน้าต่อเนื่องของใบเดียว)
  let imageInput: string | string[];
  try {
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        imageUrl?: string;
        imageUrls?: string[];
        imageBase64?: string;
      };
      // SSRF guard: caller-supplied URLs are fetched server-side, so only allow our
      // own R2 public bucket (where the presign route uploads). Anything else
      // (internal IPs, metadata endpoints, arbitrary hosts) is rejected.
      const r2Base = process.env.R2_PUBLIC_URL;
      const urlAllowed = (u: string) => {
        const isHttp = /^https?:\/\//i.test(u);
        return !isHttp || (!!r2Base && u.startsWith(r2Base));
      };
      if (Array.isArray(body.imageUrls) && body.imageUrls.length > 0) {
        // บิลหลายหน้า — ตรวจทุก url + จำกัดจำนวนหน้าตามเพดานเดียวกับตัวอ่าน
        const urls = body.imageUrls.filter((u) => typeof u === "string" && u.length > 0);
        if (urls.length === 0 || !urls.every(urlAllowed)) {
          return NextResponse.json({ error: "URL ไม่ได้รับอนุญาต" }, { status: 400 });
        }
        imageInput = urls.slice(0, MAX_RECEIPT_PAGES);
      } else if (body.imageUrl) {
        if (!urlAllowed(body.imageUrl)) {
          return NextResponse.json({ error: "URL ไม่ได้รับอนุญาต" }, { status: 400 });
        }
        imageInput = body.imageUrl;
      } else if (body.imageBase64) imageInput = body.imageBase64;
      else return NextResponse.json({ error: "ต้องมี imageUrl หรือไฟล์" }, { status: 400 });
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "ต้องแนบรูป" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "รูปใหญ่เกิน 8 MB" }, { status: 413 });
      }
      if (file.type && !ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: `รูปแบบไฟล์ไม่รองรับ (${file.type})` }, { status: 415 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      imageInput = `data:${file.type || "image/jpeg"};base64,${buf.toString("base64")}`;
    }
  } catch {
    return NextResponse.json({ error: "อ่าน request ไม่ได้" }, { status: 400 });
  }

  try {
    const parsed = await parseReceipt(imageInput, userId, orgId);
    const recheck = recheckParsed(parsed);
    return NextResponse.json({ parsed, recheck });
  } catch (err) {
    if (err instanceof AiBudgetError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    console.error("[ledger:ocr] parse failed", err);
    return NextResponse.json(
      { error: "อ่านใบเสร็จไม่ออก · กรอกข้อมูลเอง" },
      { status: 200 },
    );
  }
}
