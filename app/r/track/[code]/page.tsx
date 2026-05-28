// /r/track/[code]?p=<phone> — public ticket tracking detail
// Requires both ticket code + phone match (validated server-side)
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { normalizePhone, normalizeTicketCode } from "@/lib/repair/slug";
import { checkRateLimit } from "@/lib/rate-limit";
import { PublicTrackDetail } from "@/components/repair/track-detail";

export const dynamic = "force-dynamic";

interface Params { code: string }
interface Search { p?: string }

export default async function RepairTrackDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { code: rawCode } = await params;
  const { p: phoneRaw } = await searchParams;

  const code = normalizeTicketCode(rawCode);
  if (!code) notFound();

  if (!phoneRaw) {
    // No phone in URL — bounce to entry form with code prefilled
    redirect(`/r/track?code=${encodeURIComponent(code)}`);
  }
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    redirect(`/r/track?code=${encodeURIComponent(code)}&error=${encodeURIComponent("เบอร์โทรไม่ถูกต้อง")}`);
  }

  // Anti-enumeration: throttle unauthenticated lookups per IP so attackers
  // can't brute-force code+phone combinations.
  const hdrs = await headers();
  const ip =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    hdrs.get("x-real-ip") ??
    "unknown";
  const rl = await checkRateLimit({
    bucket: `repair-track:ip:${ip}`,
    max: 30,
    windowSec: 600,
  });
  if (rl.limited) {
    redirect(`/r/track?code=${encodeURIComponent(code)}&error=${encodeURIComponent("ลองใหม่ภายหลัง (เช็คบ่อยเกินไป)")}`);
  }

  const ticket = await prisma.repairTicket.findFirst({
    where: { ticketCode: code, reporterPhone: phone },
    include: {
      branch: { select: { id: true, name: true, code: true, businessType: true } },
      company: { select: { name: true, code: true } },
      category: { select: { id: true, slug: true, label: true, emoji: true } },
      assignedTech: { select: { id: true, name: true, kind: true, phone: true } },
      photos: { orderBy: { createdAt: "desc" } },
      events: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          actorName: true,
          payload: true,
          createdAt: true,
        },
      },
    },
  });

  if (!ticket) {
    redirect(`/r/track?code=${encodeURIComponent(code)}&error=${encodeURIComponent("ไม่พบใบ · เช็คเลขที่+เบอร์อีกครั้ง")}`);
  }

  return <PublicTrackDetail ticket={ticket} />;
}
