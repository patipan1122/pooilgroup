// POST /api/cashhub/amazon-import/push
// สร้าง IV 1 วัน เข้า TRCloud (ทีละใบ — กัน 429). มี human-confirm จากฝั่ง UI (กดเลือกวันแล้วยืนยัน).
// dedup-guard + checksum guard อยู่ใน createAmazonIv. body = { storeCode, day: AmazonDayRow }
import { NextResponse, type NextRequest } from "next/server";
import { cashHubApiGuard } from "@/lib/cashhub/api-guard";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { audit } from "@/lib/audit/log";
import { branchByStoreCode, createAmazonIv } from "@/lib/cashhub/amazon-trcloud";
import { markIvPosted } from "@/lib/cashhub/amazon-data";
import type { AmazonDayRow } from "@/lib/cashhub/amazon-parse";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await cashHubApiGuard({ executive: true });
  if (gate.error) return gate.error;
  const session = gate.session;
  // ส่งใบกำกับเข้า TRCloud = ลงบัญชี+ภาษีจริง → เฉพาะ super_admin (ตาม super_admin-only connection gating D-022)
  if (!isSuperAdmin(session.user.role))
    return NextResponse.json(
      { error: "เฉพาะ super_admin เท่านั้นที่ส่งใบกำกับเข้า TRCloud ได้" },
      { status: 403 },
    );

  let body: {
    storeCode?: string;
    storeLabel?: string;
    day?: AmazonDayRow;
    force?: boolean;
    confirm?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body ไม่ถูกต้อง" }, { status: 400 });
  }
  // ใช้ store_code จริงจากแถวที่เซฟ (จากไฟล์ POS) เป็น key เขียน DB — ไม่ใช่ cfg.storeCode
  // (cfg.storeCode ว่างสำหรับสาขาที่จับคู่ด้วยชื่อ เช่น เทศบาลจักราช → จะอัปเดต DB ไม่ตรงแถว)
  const storeCode = (body.storeCode ?? "").trim();
  if (!storeCode) return NextResponse.json({ error: "ไม่มีรหัสสาขา" }, { status: 400 });
  const cfg = branchByStoreCode(storeCode, body.storeLabel ?? null);
  if (!cfg) return NextResponse.json({ error: "ไม่รู้จักสาขานี้" }, { status: 400 });
  const day = body.day;
  if (!day || !day.date)
    return NextResponse.json({ error: "ไม่มีข้อมูลวัน" }, { status: 400 });

  // ⚠️ force = ส่งซ้ำ (ข้าม dedup → ได้ใบกำกับซ้ำจริง) — ต้องพิมพ์ยืนยันตรงเป๊ะ (กันพลาด)
  const force = body.force === true;
  if (force && body.confirm !== "ยืนยัน")
    return NextResponse.json(
      { error: "การส่งซ้ำต้องพิมพ์คำว่า “ยืนยัน” ให้ถูกต้องก่อน" },
      { status: 400 },
    );

  const admin = adminClient();
  const orgId = session.user.org_id;

  // ── กัน race สร้างใบกำกับซ้ำ (2 แท็บ/2 คน/ลูปกดพร้อมกัน) ──
  // atomic claim: ตั้ง iv_status='creating' เฉพาะแถวที่ยังเป็น 'none' (UPDATE เดียว = atomic ระดับแถว)
  // ถ้า claim ไม่ได้ = มีคนกำลังสร้าง/สร้างไปแล้ว → ไม่ยิง create ซ้ำ (กันใบ+VAT ซ้ำใน ภ.พ.30)
  if (!force) {
    const { data: claimed } = await admin
      .from("cashhub_amazon_daily")
      .update({ iv_status: "creating", updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("store_code", storeCode)
      .eq("sales_date", day.date)
      .eq("iv_status", "none")
      .select("sales_date");
    if (!claimed || claimed.length === 0) {
      const { data: cur } = await admin
        .from("cashhub_amazon_daily")
        .select("iv_status, iv_doc_no")
        .eq("org_id", orgId)
        .eq("store_code", storeCode)
        .eq("sales_date", day.date)
        .maybeSingle();
      if (cur?.iv_status === "posted")
        return NextResponse.json({
          ok: true,
          duplicate: true,
          ivNo: (cur.iv_doc_no as string | null) ?? "",
        });
      return NextResponse.json(
        { error: "วันนี้กำลังสร้างใบกำกับอยู่ (อีกแท็บ/อีกคน) — รอสักครู่แล้วรีเฟรช" },
        { status: 409 },
      );
    }
  }

  const result = await createAmazonIv(cfg, day, { force });

  // create ไม่สำเร็จ → ปล่อย claim คืน (iv_status กลับเป็น 'none') ให้ลองใหม่ได้
  if (!result.ok && !force) {
    await admin
      .from("cashhub_amazon_daily")
      .update({ iv_status: "none", updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("store_code", storeCode)
      .eq("sales_date", day.date)
      .eq("iv_status", "creating");
  }

  if (result.ok) {
    // force = ใบทดสอบซ้ำ → ไม่อัปเดต DB (ไม่ให้ทับสถานะใบจริงเดิม) · ปกติ → markIvPosted
    // IV สร้างใน TRCloud สำเร็จแล้ว → DB-stamp = best-effort: ถ้าพังห้าม 500 (ไม่งั้น user เห็น error ทั้งที่ใบขึ้นแล้ว)
    if (!force) {
      try {
        await markIvPosted(
          admin,
          orgId,
          storeCode,
          day.date,
          result.ivNo,
          result.ivId,
          result.ivGross ?? day.gross, // ยอด IV จริง (ใบที่พบซ้ำอาจต่างจาก POS)
          day.gross, // ยอด POS — ใช้เทียบ match จริง
        );
      } catch (e) {
        console.error("[amazon push] markIvPosted failed (IV created OK):", e);
        // IV สร้างสำเร็จแล้วแต่ stamp พัง → กันแถวค้างสถานะ 'creating' (claim ตั้งไว้) แบบ best-effort
        // (ถ้า DB ล่มจริง ตัวนี้ก็พัง → กู้ได้ภายหลังด้วยปุ่ม "เทียบกับ TRCloud")
        try {
          await admin
            .from("cashhub_amazon_daily")
            .update({
              iv_status: "posted",
              iv_doc_no: result.ivNo,
              iv_doc_id: result.ivId,
              updated_at: new Date().toISOString(),
            })
            .eq("org_id", orgId)
            .eq("store_code", storeCode)
            .eq("sales_date", day.date);
        } catch {
          /* DB ล่ม — กู้สถานะภายหลังด้วยการกด "เทียบกับ TRCloud" */
        }
      }
    }
    await audit({
      orgId: session.user.org_id,
      userId: session.user.id,
      action: force
        ? "FORCE_CREATE_AMAZON_IV"
        : result.duplicate
          ? "SKIP_AMAZON_IV_DUPLICATE"
          : "CREATE_AMAZON_IV",
      resourceType: "cashhub_amazon_iv",
      resourceId: `${storeCode}:${day.date}`,
      diff: {
        new: {
          branch: cfg.label,
          date: day.date,
          gross: day.gross,
          ivNo: result.ivNo,
          duplicate: result.duplicate ?? false,
          force,
        },
      },
    });
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
