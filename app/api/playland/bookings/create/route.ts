// Public booking endpoint — no auth (form is public)
// Creates booking + initiates Stripe checkout (or fallback to no-payment-confirm mode)

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newBookingCode } from "@/lib/playland/codes";
import { isValidThaiPhone } from "@/lib/playland/guards";
import { checkRate, getClientIp } from "@/lib/playland/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Body {
  branchId: string;
  packageId: string;
  customerName: string;
  customerPhone: string;
  partySize: number;
  slotDate: string;
  slotHour: number;
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 bookings per IP per 10 minutes
  const ip = getClientIp(req);
  const rl = checkRate(`pl:public:book:${ip}`, 10, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "rate limit · ลองใหม่ทีหลัง" }, { status: 429 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }

  if (!body.branchId || !body.packageId || !body.customerName || !body.customerPhone) {
    return NextResponse.json({ ok: false, error: "missing fields" }, { status: 400 });
  }
  if (!isValidThaiPhone(body.customerPhone)) return NextResponse.json({ ok: false, error: "เบอร์โทรไม่ถูกต้อง" }, { status: 400 });
  if (body.customerName.length > 100) return NextResponse.json({ ok: false, error: "name too long" }, { status: 400 });
  if (body.partySize < 1 || body.partySize > 20) return NextResponse.json({ ok: false, error: "party size 1-20" }, { status: 400 });
  if (body.slotHour < 0 || body.slotHour > 23) return NextResponse.json({ ok: false, error: "bad hour" }, { status: 400 });
  const slotDate = new Date(`${body.slotDate}T${String(body.slotHour).padStart(2, "0")}:00:00+07:00`);
  if (Number.isNaN(slotDate.getTime())) return NextResponse.json({ ok: false, error: "bad date" }, { status: 400 });
  if (slotDate.getTime() < Date.now() - 24 * 3600_000) return NextResponse.json({ ok: false, error: "slot too far in past" }, { status: 400 });
  if (slotDate.getTime() > Date.now() + 365 * 24 * 3600_000) return NextResponse.json({ ok: false, error: "slot too far in future" }, { status: 400 });

  const branch = await prisma.playlandBranch.findFirst({ where: { id: body.branchId, active: true } });
  if (!branch) return NextResponse.json({ ok: false, error: "branch not found" }, { status: 404 });

  const pkg = await prisma.playlandPackage.findFirst({ where: { id: body.packageId, active: true } });
  if (!pkg) return NextResponse.json({ ok: false, error: "package not found" }, { status: 404 });

  const slotStart = slotDate;
  const slotEnd = new Date(slotStart.getTime() + (pkg.minutes ?? 60) * 60_000);
  const amount = pkg.price * body.partySize;

  const booking = await prisma.playlandBooking.create({
    data: {
      orgId: branch.orgId,
      branchId: branch.id,
      packageId: pkg.id,
      bookingCode: newBookingCode(),
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      partySize: Math.max(1, body.partySize),
      slotStart,
      slotEnd,
      amountCents: amount,
      paymentMethod: "STRIPE",
      paymentStatus: "pending",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 30 * 60_000), // 30 min to pay
    },
  });

  // Stripe integration · graceful fallback when STRIPE_SECRET_KEY not set
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  let paymentUrl: string | null = null;

  if (stripeKey) {
    try {
      const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${stripeKey}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          mode: "payment",
          "line_items[0][quantity]": "1",
          "line_items[0][price_data][currency]": "thb",
          "line_items[0][price_data][unit_amount]": String(amount),
          "line_items[0][price_data][product_data][name]": `${pkg.name} × ${body.partySize}`,
          success_url: `${new URL(req.url).origin}/p/playland/${branch.slug}/book/${booking.id}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${new URL(req.url).origin}/p/playland/${branch.slug}/book/${booking.id}/cancel`,
          "metadata[booking_id]": booking.id,
          "metadata[booking_code]": booking.bookingCode,
        }),
      });
      const stripeData = (await stripeRes.json()) as { url?: string; id?: string };
      if (stripeRes.ok && stripeData.url) {
        paymentUrl = stripeData.url;
        await prisma.playlandBooking.update({ where: { id: booking.id }, data: { paymentRef: stripeData.id } });
      }
    } catch (e) {
      console.warn("[playland/booking] stripe error", e);
    }
  }

  // Fallback: dev/mock payment page
  if (!paymentUrl) {
    paymentUrl = `/p/playland/${branch.slug}/book/${booking.id}/pay`;
  }

  return NextResponse.json({
    ok: true,
    bookingId: booking.id,
    bookingCode: booking.bookingCode,
    amountCents: amount,
    paymentUrl,
  });
}
