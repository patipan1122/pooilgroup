import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { createCustomer } from "../actions";
import { ArrowLeft } from "lucide-react";

const field = "mt-1.5 w-full h-11 rounded-xl border border-border bg-surface px-3.5 text-sm outline-none focus:border-brand-500";

export default async function NewCustomerPage() {
  await requireUser();
  return (
    <div className="max-w-lg mx-auto">
      <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-zinc-500 mb-3"><ArrowLeft className="size-4" /> กลับ</Link>
      <PageHeader title="เพิ่มลูกค้าใหม่" />
      <form action={createCustomer} className="space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div>
          <label className="text-sm font-medium">ชื่อลูกค้า/ร้าน *</label>
          <input name="name" required className={field} placeholder="เช่น ปั๊มสมชาย" />
        </div>
        <div>
          <label className="text-sm font-medium">ชื่อนิติบุคคล (ออกใบ)</label>
          <input name="legalName" className={field} placeholder="บจก. ..." />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">เบอร์โทร</label>
            <input name="phone" className={field} placeholder="08x-xxx-xxxx" />
          </div>
          <div>
            <label className="text-sm font-medium">โซน</label>
            <input name="zone" className={field} placeholder="เช่น โคราช" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">วงเงินเครดิต (บาท)</label>
            <input name="creditLimit" type="number" className={field} placeholder="300000" />
          </div>
          <div>
            <label className="text-sm font-medium">เครดิต (วัน)</label>
            <input name="paymentTerms" type="number" className={field} placeholder="30" />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">รอบซื้อปกติ (วัน)</label>
          <input name="cadence" type="number" className={field} placeholder="7" />
        </div>
        <button className="w-full h-12 rounded-xl bg-brand-600 text-white font-medium">บันทึกลูกค้า</button>
      </form>
    </div>
  );
}
