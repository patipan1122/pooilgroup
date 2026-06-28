// DC · หลังบ้าน · สร้างใบสั่งซื้อใหม่ (จีน CNY / ไทย THB)
// อ่าน ?origin=thai|china (default จีน) → จีนดึงเรตวันนี้อัตโนมัติ.
// โหลดผู้ขาย + คลัง ส่งให้ฟอร์ม client แบบกะทัดรัด.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getDcContext } from "@/lib/dc/access";
import { requireDcManager } from "@/lib/dc/role-guard";
import { getDcOfficeChrome, dcShellChrome } from "@/lib/dc/office-chrome";
import { DcOfficeShell } from "@/components/dc/office-shell";
import { listSuppliersForPo } from "@/lib/dc/po-actions";
import { getTodayFxRate } from "@/lib/dc/fx";
import { PO_ORIGIN_LABEL } from "@/lib/dc/nav";
import { PoCreateForm } from "./po-create-form";

export const dynamic = "force-dynamic";

type SearchParams = { origin?: string };

export default async function DcNewPoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getDcContext();
  requireDcManager(ctx.session.user.role);

  const sp = await searchParams;
  const origin: "CHINA" | "THAI" = sp.origin === "thai" ? "THAI" : "CHINA";

  // เรตแลกเปลี่ยนวันนี้ — เฉพาะใบจีน (ไทยใช้บาทตรง ๆ ไม่มีเรต)
  const fx = origin === "CHINA" ? await getTodayFxRate("CNY", "THB") : null;

  const suppliers = await listSuppliersForPo();
  const warehouses = ctx.warehouses.map((w) => ({ id: w.id, name: w.name }));

  const originLabel = PO_ORIGIN_LABEL[origin] ?? origin;

  const chrome = await getDcOfficeChrome(ctx.session.user.org_id);

  return (
    <DcOfficeShell active="po" {...dcShellChrome(ctx, chrome)}>
      <div className="dc-page dc-page--wide" style={{ padding: 0, maxWidth: "none", margin: 0 }}>
        <Link href="/dc/office/purchasing" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink2)", marginBottom: 8, textDecoration: "none" }}>
          <ArrowLeft size={15} /> กลับรายการใบสั่งซื้อ
        </Link>
        <div style={{ marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-.01em" }}>สร้างใบสั่งซื้อ ({originLabel})</h1>
          <p style={{ margin: "5px 0 0", color: "var(--ink2)", fontSize: 14 }}>
            {origin === "CHINA"
              ? "สั่งจากจีน · ราคาเป็นหยวน (CNY) แปลงเป็นบาทอัตโนมัติ"
              : "ซื้อในไทย · ราคาเป็นบาท (THB)"}{" "}
            · เลือก/สร้างผู้ขาย+สินค้าตรงนี้ได้เลย → บันทึกเป็นร่าง
          </p>
        </div>

        <PoCreateForm
          origin={origin}
          warehouses={warehouses}
          suppliers={suppliers}
          initialFxRate={fx?.rate ?? null}
          fxDate={fx?.date ?? null}
        />
      </div>
    </DcOfficeShell>
  );
}
