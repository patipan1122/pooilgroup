// Public hotel booking page · /hotel/[slug]
// Claude Design upgrade 2026-06-01: warm editorial · cream base · soft warm
// purple · Sarabun display · large room photography · beautiful empty-state
// gradient placeholders so the page looks designed even without real photos.

import { notFound } from "next/navigation";
import { getHotelBySlug } from "@/lib/hotelbook/data";
import { BookingFlow } from "./_components/booking-flow";
import { RoomGallery } from "./_components/room-gallery";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const hotel = await getHotelBySlug(slug);
  if (!hotel) return { title: "ไม่พบโรงแรม" };
  return {
    title: `${hotel.name} · จองห้องพักออนไลน์`,
    description: hotel.description ?? hotel.concept ?? hotel.name,
    openGraph: {
      title: hotel.name,
      description: hotel.description ?? hotel.name,
      images: hotel.heroImageUrl ? [hotel.heroImageUrl] : [],
    },
  };
}

export default async function PublicHotelPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const hotel = await getHotelBySlug(slug);
  if (!hotel || !hotel.enabled) notFound();

  const brand = hotel.brandColor || "#7C5BC9";
  const brandSoft = withOpacity(brand, 0.08);
  const brandDeep = darken(brand, 0.15);
  const minPrice = Math.min(...hotel.rooms.map((r) => Number(r.priceThb)));

  return (
    <main
      className="min-h-screen text-stone-900"
      style={{ background: "#FAF7F2", fontFamily: "var(--font-noto-thai), var(--font-sarabun), system-ui, sans-serif" }}
    >
      {/* HERO ─────────────────────────────────────────────────────────── */}
      <header
        className="relative overflow-hidden"
        style={{
          background: hotel.heroImageUrl
            ? `linear-gradient(180deg, ${brand}cc 0%, ${brandDeep}f0 100%)`
            : `linear-gradient(135deg, ${brand} 0%, ${brandDeep} 100%)`,
        }}
      >
        {/* Hero image (if uploaded) */}
        {hotel.heroImageUrl && (
          <img
            src={hotel.heroImageUrl}
            alt={hotel.name}
            className="absolute inset-0 w-full h-full object-cover -z-10"
          />
        )}

        {/* Decorative texture (no real image needed) */}
        {!hotel.heroImageUrl && (
          <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "radial-gradient(circle at 25% 25%, rgba(255,255,255,0.6) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(255,255,255,0.4) 0%, transparent 50%)" }} />
        )}

        <div className="relative max-w-6xl mx-auto px-6 sm:px-10 pt-16 pb-24 sm:pt-24 sm:pb-32">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-white/90 text-xs sm:text-sm font-medium mb-5">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />
            <span>{hotel.is24h ? "เปิดบริการ 24 ชั่วโมง ทุกวัน" : "เปิดบริการ"}</span>
          </div>

          <h1
            className="text-white tracking-tight"
            style={{
              fontFamily: "var(--font-sarabun)",
              fontWeight: 700,
              fontSize: "clamp(2.25rem, 5vw, 3.5rem)",
              lineHeight: 1.1,
            }}
          >
            {hotel.name}
          </h1>

          {hotel.concept && (
            <p className="text-white/90 text-lg sm:text-xl mt-3 max-w-2xl" style={{ fontWeight: 400 }}>
              {hotel.concept}
            </p>
          )}
          {hotel.description && (
            <p className="text-white/75 text-sm sm:text-base mt-4 max-w-2xl leading-relaxed">{hotel.description}</p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href="#rooms"
              className="inline-flex items-center justify-center h-12 px-7 rounded-full bg-white text-stone-900 font-semibold shadow-xl hover:shadow-2xl active:scale-95 transition"
            >
              <span>จองห้องเลย</span>
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs" style={{ background: brandSoft, color: brandDeep }}>
                เริ่ม ฿{minPrice.toLocaleString()}
              </span>
            </a>
            {hotel.googleMapsUrl && (
              <a
                href={hotel.googleMapsUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center justify-center h-12 px-5 rounded-full ring-1 ring-white/40 text-white hover:bg-white/10 transition"
              >
                <span>📍</span>
                <span className="ml-2 font-medium">ดูแผนที่</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {/* TRUST STRIP ─────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 sm:px-10 -mt-12 sm:-mt-16 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: "🛏", label: `${hotel.rooms.length} แบบห้อง`, sub: "ให้เลือก" },
            { icon: "💰", label: `เริ่ม ฿${minPrice.toLocaleString()}`, sub: "ต่อคืน" },
            { icon: "🕐", label: hotel.is24h ? "24 ชม." : "เปิดบริการ", sub: "ทุกวัน" },
            { icon: "💳", label: paymentLabel(hotel.paymentMethods), sub: "ชำระสะดวก" },
          ].map((h) => (
            <div key={h.label} className="rounded-2xl bg-white ring-1 ring-stone-200/80 shadow-sm p-5 text-center">
              <div className="text-2xl mb-1.5">{h.icon}</div>
              <div className="text-sm font-semibold text-stone-900">{h.label}</div>
              <div className="text-xs text-stone-500 mt-0.5">{h.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ROOMS ───────────────────────────────────────────────────────── */}
      <section id="rooms" className="max-w-6xl mx-auto px-6 sm:px-10 py-14 sm:py-20">
        <div className="mb-8 sm:mb-10">
          <span
            className="inline-block text-[11px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{ background: brandSoft, color: brandDeep }}
          >
            เลือกห้องพัก
          </span>
          <h2
            className="text-stone-900 mt-3"
            style={{ fontFamily: "var(--font-sarabun)", fontWeight: 700, fontSize: "clamp(1.5rem, 3vw, 2rem)", lineHeight: 1.2 }}
          >
            ห้องสะอาด · ราคาเท่ากันทุกวัน
          </h2>
          <p className="text-stone-600 mt-1.5">ไม่มีค่าใช้จ่ายซ่อนเร้น · ไม่ต้องวางมัดจำ</p>
        </div>

        <div className="space-y-5">
          {hotel.rooms.map((room, idx) => (
            <RoomCard
              key={room.id}
              roomId={room.id}
              hotelBrand={brand}
              hotelBrandDeep={brandDeep}
              hotelBrandSoft={brandSoft}
              name={room.name}
              description={room.description}
              bedDescription={room.bedDescription}
              priceThb={Number(room.priceThb)}
              totalRooms={room.totalRooms}
              amenities={room.amenities}
              imageUrls={room.images.map((i) => i.url)}
              primaryImageUrl={room.primaryImageUrl}
              isPopular={room.name.includes("Single") && room.totalRooms > 5}
              index={idx}
            />
          ))}
        </div>
      </section>

      {/* INFO + CONTACT ─────────────────────────────────────────────── */}
      <section className="bg-white border-t border-stone-200/60">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-14 sm:py-20 grid gap-10 sm:gap-12 lg:grid-cols-2">
          <div>
            <span
              className="inline-block text-[11px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
              style={{ background: brandSoft, color: brandDeep }}
            >
              ข้อมูลโรงแรม
            </span>
            <h3 className="mt-3 mb-5 text-2xl text-stone-900" style={{ fontFamily: "var(--font-sarabun)", fontWeight: 700 }}>
              สิ่งที่ควรรู้ก่อนจอง
            </h3>
            <dl className="space-y-3.5 text-sm">
              {hotel.checkInTime && <Row label="เช็คอิน">หลัง {hotel.checkInTime} น.</Row>}
              {hotel.checkOutTime && <Row label="เช็คเอาท์">ก่อน {hotel.checkOutTime} น.</Row>}
              <Row label="ชำระเงิน">{paymentLabelDetail(hotel.paymentMethods)}</Row>
              <Row label="สัตว์เลี้ยง">{hotel.allowsPets ? "✅ อนุญาต" : "❌ ไม่อนุญาต"}</Row>
              <Row label="สูบบุหรี่">{hotel.smokingAllowed ? "✅ ได้" : "❌ ห้ามสูบในห้อง"}</Row>
              {hotel.multiNightDiscountNote && <Row label="จองหลายห้อง">{hotel.multiNightDiscountNote}</Row>}
            </dl>

            {hotel.amenities.length > 0 && (
              <div className="mt-8">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-3">สิ่งอำนวยความสะดวก</h4>
                <div className="flex flex-wrap gap-2">
                  {hotel.amenities.map((a) => (
                    <span key={a} className="text-sm px-3 py-1.5 rounded-full bg-stone-100 ring-1 ring-stone-200/80 text-stone-700">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {hotel.nearbyPlaces.length > 0 && (
              <div className="mt-8">
                <h4 className="text-xs font-semibold uppercase tracking-widest text-stone-500 mb-3">ใกล้ๆ โรงแรม</h4>
                <ul className="text-sm text-stone-700 space-y-2">
                  {hotel.nearbyPlaces.map((p) => (
                    <li key={p} className="flex items-center gap-2"><span>📍</span>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <span
              className="inline-block text-[11px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
              style={{ background: brandSoft, color: brandDeep }}
            >
              ติดต่อโดยตรง
            </span>
            <h3 className="mt-3 mb-5 text-2xl text-stone-900" style={{ fontFamily: "var(--font-sarabun)", fontWeight: 700 }}>
              คุยกับเราโดยตรง
            </h3>
            <div className="space-y-3">
              {hotel.reservationPhones.map((p) => (
                <a
                  key={p}
                  href={`tel:${p.replace(/\D/g, "")}`}
                  className="flex items-center gap-4 rounded-2xl ring-1 ring-stone-200 p-4 hover:bg-stone-50 hover:ring-stone-300 transition"
                >
                  <div className="h-12 w-12 rounded-full flex items-center justify-center text-xl" style={{ background: brandSoft }}>
                    📞
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-stone-900">{p}</div>
                    <div className="text-xs text-stone-500">จองห้องพัก · 24 ชม.</div>
                  </div>
                </a>
              ))}
              {hotel.ownerPhone && (
                <a
                  href={`tel:${hotel.ownerPhone.replace(/\D/g, "")}`}
                  className="flex items-center gap-4 rounded-2xl ring-1 ring-stone-200 p-4 hover:bg-stone-50 hover:ring-stone-300 transition"
                >
                  <div className="h-12 w-12 rounded-full flex items-center justify-center text-xl" style={{ background: brandSoft }}>
                    🤝
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-stone-900">{hotel.ownerPhone}</div>
                    <div className="text-xs text-stone-500">เจ้าของ · เหมา / ร้องเรียน</div>
                  </div>
                </a>
              )}
              {hotel.googleMapsUrl && (
                <a
                  href={hotel.googleMapsUrl}
                  target="_blank"
                  rel="noopener"
                  className="flex items-center gap-4 rounded-2xl ring-1 ring-stone-200 p-4 hover:bg-stone-50 hover:ring-stone-300 transition"
                >
                  <div className="h-12 w-12 rounded-full flex items-center justify-center text-xl" style={{ background: brandSoft }}>
                    🗺
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-stone-900">เปิด Google Maps</div>
                    <div className="text-xs text-stone-500">ดูเส้นทาง · pin location</div>
                  </div>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="bg-stone-50 border-t border-stone-200/60">
        <div className="max-w-6xl mx-auto px-6 sm:px-10 py-10 text-center">
          <p className="text-stone-700 font-semibold">{hotel.name}</p>
          <p className="text-xs text-stone-500 mt-2">© {new Date().getFullYear()} · Powered by Pooilgroup HotelBook</p>
        </div>
      </footer>

      <BookingFlow hotelSlug={hotel.slug} brand={brand} />
      <RoomGallery />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function withOpacity(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function darken(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - 255 * amount);
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - 255 * amount);
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - 255 * amount);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function paymentLabel(methods: string[]): string {
  if (methods.includes("qr") && methods.includes("cash")) return "เงินสด · QR";
  return methods.join(" · ");
}

function paymentLabelDetail(methods: string[]): string {
  const m: Record<string, string> = { cash: "เงินสด", transfer: "โอนผ่านธนาคาร", qr: "QR PromptPay", card: "บัตรเครดิต" };
  return methods.map((x) => m[x] ?? x).join(" · ");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm py-1">
      <dt className="w-28 text-stone-500 shrink-0">{label}</dt>
      <dd className="text-stone-900 font-medium">{children}</dd>
    </div>
  );
}

// Beautiful empty-state placeholder — looks designed even without real photos.
// Uses hue derived from price tier + bed icon + room name as visual art.
function PhotoPlaceholder({ name, price, brand }: { name: string; price: number; brand: string }) {
  // Hue based on price tier · 300 = warm coral · 400 = warm sand · 450 = soft sage · 550 = deep wine
  const variants: Record<string, { from: string; to: string; icon: string }> = {
    "300": { from: "#F4D5C6", to: "#E8B595", icon: "🛏" },
    "400": { from: "#F2DDC4", to: "#D9B687", icon: "🛏" },
    "450": { from: "#DDD4E8", to: "#B5A4D2", icon: "🛏" },
    "550": { from: "#C9B7DD", to: "#8B6CB5", icon: "🏨" },
  };
  const v = variants[String(price)] ?? variants["400"];
  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${v.from} 0%, ${v.to} 100%)` }}
    >
      <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.5) 0%, transparent 50%)" }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <div className="text-5xl sm:text-6xl mb-2 opacity-90" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))" }}>{v.icon}</div>
        <div className="text-sm sm:text-base font-semibold tracking-wide text-center px-3" style={{ textShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>{name}</div>
        <div className="text-[10px] sm:text-[11px] text-white/80 mt-3 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm">ภาพห้องจริง · เร็วๆ นี้</div>
      </div>
    </div>
  );
}

function RoomCard(props: {
  roomId: string;
  hotelBrand: string;
  hotelBrandDeep: string;
  hotelBrandSoft: string;
  name: string;
  description: string | null;
  bedDescription: string | null;
  priceThb: number;
  totalRooms: number;
  amenities: string[];
  imageUrls: string[];
  primaryImageUrl: string | null;
  isPopular: boolean;
  index: number;
}) {
  const main = props.primaryImageUrl ?? props.imageUrls[0] ?? null;
  const others = props.imageUrls.filter((u) => u !== main).slice(0, 2);
  return (
    <article className="group overflow-hidden rounded-3xl bg-white ring-1 ring-stone-200/80 shadow-sm hover:shadow-xl hover:ring-stone-300 transition-all duration-300">
      <div className="grid sm:grid-cols-5 gap-0">
        {/* image side */}
        <div className="sm:col-span-2 relative h-64 sm:h-auto sm:min-h-[260px]">
          {main ? (
            <button
              type="button"
              data-gallery-images={JSON.stringify(props.imageUrls)}
              data-gallery-name={props.name}
              className="block w-full h-full cursor-zoom-in"
            >
              <img src={main} alt={props.name} className="w-full h-full object-cover" />
              {props.imageUrls.length > 1 && (
                <span className="absolute bottom-3 right-3 text-xs bg-black/60 backdrop-blur-sm text-white px-2.5 py-1 rounded-full font-medium">
                  📷 {props.imageUrls.length}
                </span>
              )}
            </button>
          ) : (
            <PhotoPlaceholder name={props.name} price={props.priceThb} brand={props.hotelBrand} />
          )}
          {others.length > 0 && (
            <div className="absolute top-3 right-3 flex flex-col gap-1.5">
              {others.map((u) => (
                <img key={u} src={u} alt="" className="w-12 h-12 object-cover rounded-lg ring-2 ring-white shadow-md" />
              ))}
            </div>
          )}
          {props.isPopular && (
            <span
              className="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 rounded-full backdrop-blur-md"
              style={{ background: "rgba(255,255,255,0.95)", color: props.hotelBrandDeep }}
            >
              ⭐ ยอดนิยม
            </span>
          )}
        </div>

        {/* details side */}
        <div className="sm:col-span-3 p-6 sm:p-7 flex flex-col">
          <div className="flex-1">
            <h3
              className="text-xl sm:text-2xl text-stone-900 leading-tight"
              style={{ fontFamily: "var(--font-sarabun)", fontWeight: 700 }}
            >
              {props.name}
            </h3>
            {props.bedDescription && <p className="text-sm text-stone-500 mt-1">🛏 {props.bedDescription}</p>}
            {props.description && <p className="text-sm text-stone-600 mt-3 leading-relaxed">{props.description}</p>}

            {props.amenities.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {props.amenities.slice(0, 6).map((a) => (
                  <span key={a} className="text-xs px-2.5 py-1 rounded-full bg-stone-50 ring-1 ring-stone-200/80 text-stone-700">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 pt-5 border-t border-stone-100 flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-stone-500 font-medium">ราคาต่อคืน</div>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-3xl text-stone-900 tabular-nums" style={{ fontFamily: "var(--font-sarabun)", fontWeight: 700 }}>
                  ฿{props.priceThb.toLocaleString()}
                </span>
              </div>
              {props.totalRooms > 1 && (
                <div className="text-[11px] text-emerald-600 font-medium mt-1.5 flex items-center gap-1.5">
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  ว่าง {props.totalRooms} ห้อง
                </div>
              )}
            </div>
            <button
              type="button"
              data-book-room-id={props.roomId}
              data-book-room-name={props.name}
              data-book-room-price={props.priceThb}
              className="inline-flex items-center justify-center h-12 px-6 rounded-2xl font-semibold text-white shadow-md hover:shadow-xl active:scale-95 transition"
              style={{ background: `linear-gradient(135deg, ${props.hotelBrand} 0%, ${props.hotelBrandDeep} 100%)` }}
            >
              จองเลย
              <span className="ml-1.5">→</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
