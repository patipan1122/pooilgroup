import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { getPricingContext } from "@/lib/fuelos/pricing-data";
import {
  listCustomerOptions,
  resolveConversationCustomer,
  getCustomerLite,
} from "@/lib/fuelos/quotes-data";
import { ArrowLeft } from "lucide-react";
import { QuoteForm } from "../quote-form";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ conv?: string; customer?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const [ctx, customers] = await Promise.all([
    getPricingContext(user.orgId),
    listCustomerOptions(user.orgId),
  ]);

  // prefill ลูกค้า: ?customer=<id> ตรง ๆ หรือ ?conv=<id> → แปลงผ่าน conversation
  let prefillCustomerId: string | null = null;
  let prefillZone: string | null = null;
  let prospectHint: string | null = null;

  if (sp.customer) {
    const c = await getCustomerLite(user.orgId, sp.customer);
    if (c) {
      prefillCustomerId = c.id;
      prefillZone = c.zone;
    }
  } else if (sp.conv) {
    const conv = await resolveConversationCustomer(user.orgId, sp.conv);
    if (conv?.customerId) {
      const c = await getCustomerLite(user.orgId, conv.customerId);
      if (c) {
        prefillCustomerId = c.id;
        prefillZone = c.zone;
      }
    } else if (conv) {
      // แชทยังไม่ผูกลูกค้า → ใช้ชื่อกลุ่มเป็นชื่อผู้สนใจตั้งต้น
      prospectHint = conv.displayName ?? null;
    }
  }

  return (
    <div>
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-zinc-500 mb-3">
        <ArrowLeft className="size-4" /> ใบเสนอราคาทั้งหมด
      </Link>

      <h1 className="text-xl sm:text-2xl font-bold tracking-tight mb-5">สร้างใบเสนอราคา</h1>

      <QuoteForm
        customers={customers}
        costs={ctx.costs}
        margins={ctx.margins}
        prefillCustomerId={prefillCustomerId}
        prefillZone={prefillZone}
        prospectHint={prospectHint}
        conversationId={sp.conv ?? null}
      />
    </div>
  );
}
