// Playland · "Play a lot" — single-page tablet cashier app (thin server shell).
//
// Seeds the client SPA (<PlaylandApp>) with real data: active sessions → kids,
// real packages/products, today's revenue, open-shift, cashier name. All in-app
// navigation (home/board/checkout/pos/checkin/monitor/shift/...) is handled
// client-side by the SPA — the old /playland/board, /checkout, /checkin routes
// remain for deep-linking but the home no longer needs to link out.

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { R2_PUBLIC_URL } from "@/lib/r2/client";
import {
  getActiveSessions,
  listPackages,
  listProducts,
  getTodayStats,
  listBranches,
  listOpenShift,
  searchMembers,
  listBookings,
} from "@/lib/playland/queries";
import PlaylandApp, {
  type PlaylandKid,
  type PlaylandPackageVM,
  type PlaylandProductVM,
  type PlaylandMemberVM,
  type PlaylandBookingVM,
  type PlaylandStats,
  type Screen,
} from "@/components/playland/playland-app";

// Old front-of-house routes now redirect here as /playland?screen=<x>; honor it so
// a bookmarked TV (?screen=monitor) or deep-link opens the right in-app screen.
const DEEP_LINK_SCREENS = [
  "board", "checkout", "pos", "checkin", "monitor", "members", "wristband", "bookings",
];

export const dynamic = "force-dynamic";
export const metadata = { title: "Play a lot · สวนสนุก" };

const MASCOTS = ["sunny", "skye", "rocky"];
// stable mascot per session id (deterministic so it doesn't flip on refresh)
function mascotFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MASCOTS[h % MASCOTS.length];
}
// emoji per product name keyword (best-effort; falls back to a snack)
function emojiFor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("ป๊อป") || n.includes("pop")) return "🍿";
  if (n.includes("ไอ") || n.includes("cream") || n.includes("ไอศ")) return "🍦";
  if (n.includes("โอริ") || n.includes("oreo") || n.includes("cookie") || n.includes("คุกกี้")) return "🍪";
  if (n.includes("เยล") || n.includes("jelly")) return "🍬";
  if (n.includes("โดนัท") || n.includes("donut")) return "🍩";
  if (n.includes("เค้ก") || n.includes("cake") || n.includes("คัพ")) return "🧁";
  if (n.includes("ช็อก") || n.includes("choc")) return "🍫";
  if (n.includes("น้ำ") || n.includes("juice") || n.includes("drink") || n.includes("เครื่องดื่ม")) return "🥤";
  return "🍡";
}
function pkgLabel(p: { name: string; minutes: number | null; type: string }): string {
  if (p.type === "DAY_PASS" || (p.minutes ?? 0) === 0) return "Day Pass";
  return `${p.minutes} นาที`;
}
function pkgSub(p: { type: string; minutes: number | null }): string {
  if (p.type === "DAY_PASS" || (p.minutes ?? 0) === 0) return "เล่นทั้งวัน";
  const m = p.minutes ?? 0;
  if (m <= 30) return "เล่นสั้น";
  if (m <= 60) return "มาตรฐาน · ขายดี";
  return "เล่นนาน";
}

export default async function PlaylandPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string; screen?: string }>;
}) {
  const sp = await searchParams;
  const initialScreen: Screen | undefined =
    sp.screen && DEEP_LINK_SCREENS.includes(sp.screen) ? (sp.screen as Screen) : undefined;
  const session = await requireSession();
  const orgId = session.user.org_id;
  const cashierName = session.user.name || session.user.email || "พนักงาน";

  const branches = await listBranches(orgId);
  const branchId = sp.branch || branches[0]?.id;

  // No branch yet → send to branch onboarding (settings)
  if (!branchId) redirect("/playland/settings/branches");

  const [active, packages, products, stats, openShift, recentMembers, todayBookings] = await Promise.all([
    getActiveSessions(orgId, branchId),
    listPackages(orgId, branchId),
    listProducts(orgId, branchId),
    getTodayStats(orgId, branchId),
    listOpenShift(orgId, branchId, session.user.id),
    // recent members (empty query → most-recently-visited) for the สมาชิก screen seed
    searchMembers(orgId, "", branchId, 12),
    listBookings(orgId, { branchId }),
  ]);
  const branch = branches.find((b) => b.id === branchId);

  // map active sessions → kids
  const now = Date.now();
  const initialKids: PlaylandKid[] = active.map((sess) => {
    const dayPass = sess.packageMinutes === 0;
    const sec = sess.expiresAt
      ? Math.max(0, Math.round((new Date(sess.expiresAt).getTime() - now) / 1000))
      : 0;
    const pkgName = sess.package
      ? pkgLabel({ name: sess.package.name, minutes: sess.package.minutes, type: sess.package.type })
      : dayPass
        ? "Day Pass"
        : `${sess.packageMinutes} นาที`;
    return {
      id: sess.id, // real sessionId → extend/checkout target the right session
      name: sess.member?.nickname || sess.member?.name || "น้อง",
      mascot: mascotFor(sess.id),
      pkg: pkgName,
      sec,
      dayPass,
      charges: [{ label: `ค่าเล่น ${pkgName}`, amount: Math.round(sess.packagePriceCents / 100) }],
    };
  });

  const packagesVM: PlaylandPackageVM[] = packages.map((p) => ({
    id: p.id,
    mins: p.type === "DAY_PASS" ? 0 : p.minutes ?? 0,
    label: pkgLabel(p),
    sub: pkgSub(p),
    price: Math.round(p.price / 100),
  }));

  const productsVM: PlaylandProductVM[] = products.map((p) => ({
    id: p.id,
    emoji: emojiFor(p.name),
    name: p.name,
    price: Math.round(p.priceCents / 100),
    // resolve R2 key → public URL (repo pattern: `${R2_PUBLIC_URL}/${key}`)
    image: p.imageR2Path ? `${R2_PUBLIC_URL}/${p.imageR2Path}` : null,
  }));

  const MASCOTS3 = ["sunny", "skye", "rocky"];
  const membersVM: PlaylandMemberVM[] = recentMembers.map((m, i) => ({
    id: m.id,
    name: m.name,
    nickname: m.nickname,
    phone: m.phone,
    memberCode: m.memberCode,
    type: m.type,
    lastVisit: m.lastVisitAt ? m.lastVisitAt.toISOString() : null,
    mascot: MASCOTS3[i % 3],
  }));

  const bookingsVM: PlaylandBookingVM[] = todayBookings.map((b) => ({
    id: b.id,
    code: b.bookingCode,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    slotTime: new Date(b.slotStart).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }),
    slotDate: new Date(b.slotStart).toLocaleDateString("th-TH"),
    pkgName: b.package?.name ?? "—",
    partySize: b.partySize,
    amount: Math.round(b.amountCents / 100),
    status: b.status,
  }));

  const revenue = Math.round(stats.totalRevenueCents / 100);
  const statsVM: PlaylandStats = {
    revenue,
    entryRevenue: Math.round(stats.entryRevenueCents / 100),
    productRevenue: Math.round(stats.productRevenueCents / 100),
    kidsActive: stats.activeSessions,
    sessionsToday: stats.sessionsToday,
    memberCount: stats.memberCount,
    salesCount: stats.salesCount,
    bookingsToday: stats.bookingsToday,
  };

  return (
    <PlaylandApp
      initialKids={initialKids}
      packages={packagesVM}
      products={productsVM}
      members={membersVM}
      bookings={bookingsVM}
      stats={statsVM}
      revenue={revenue}
      branchId={branchId}
      branchSlug={branch?.slug ?? null}
      cashierName={cashierName}
      hasOpenShift={!!openShift}
      initialScreen={initialScreen}
      key={`${branchId}:${openShift?.id ?? "noshift"}`}
    />
  );
}
