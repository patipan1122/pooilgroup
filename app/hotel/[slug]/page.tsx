// Public hotel booking page · /hotel/[slug]
// SSR · SEO-friendly · mobile-first · beautiful (CEO requirement)
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
    openGraph: { title: hotel.name, description: hotel.description ?? hotel.name, images: hotel.heroImageUrl ? [hotel.heroImageUrl] : [] },
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

  const brand = hotel.brandColor || "#7c3aed";
  const minPrice = Math.min(...hotel.rooms.map((r) => Number(r.priceThb)));

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* HERO */}
      <header
        className="relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${brand} 0%, ${brand}cc 60%, ${brand}88 100%)` }}
      >
        {hotel.heroImageUrl && (
          <div className="absolute inset-0">
            <img src={hotel.heroImageUrl} alt={hotel.name} className="w-full h-full object-cover opacity-30" />
          </div>
        )}
        <div className="relative max-w-5xl mx-auto px-5 sm:px-8 pt-14 pb-20 sm:pt-20 sm:pb-28">
          <div className="inline-flex items-center gap-2 text-white/90 text-xs sm:text-sm font-medium mb-3">
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            <span>{hotel.is24h ? "เปิด 24 ชั่วโมง · ทุกวัน" : "เปิดบริการ"}</span>
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">{hotel.name}</h1>
          {hotel.concept && <p className="text-white/85 text-base sm:text-lg mt-2">{hotel.concept}</p>}
          {hotel.description && <p className="text-white/75 text-sm sm:text-base mt-3 max-w-2xl">{hotel.description}</p>}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a
              href="#rooms"
              className="inline-flex items-center justify-center h-12 px-6 rounded-full bg-white text-zinc-900 font-semibold shadow-lg hover:shadow-xl transition"
            >
              จองห้องเลย · เริ่ม ฿{minPrice.toLocaleString()}
            </a>
            {hotel.googleMapsUrl && (
              <a
                href={hotel.googleMapsUrl}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center justify-center h-12 px-5 rounded-full ring-1 ring-white/50 text-white hover:bg-white/10 transition"
              >
                📍 ดูแผนที่
              </a>
            )}
          </div>
        </div>
      </header>

      {/* HIGHLIGHTS */}
      <section className="max-w-5xl mx-auto px-5 sm:px-8 -mt-10 sm:-mt-14 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {[
            { icon: "🛏", label: `${hotel.rooms.length} แบบห้อง` },
            { icon: "💰", label: `เริ่ม ฿${minPrice.toLocaleString()}/คืน` },
            { icon: "🕐", label: hotel.is24h ? "24 ชม." : "เปิดบริการ" },
            { icon: "💳", label: paymentLabel(hotel.paymentMethods) },
          ].map((h) => (
            <div key={h.label} className="rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm p-4 text-center">
              <div className="text-2xl mb-1">{h.icon}</div>
              <div className="text-xs sm:text-sm font-medium text-zinc-700">{h.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ROOMS */}
      <section id="rooms" className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
        <div className="flex items-baseline justify-between gap-3 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900">เลือกห้องพัก</h2>
            <p className="text-sm text-zinc-500 mt-1">ราคาเท่ากันทุกวัน · ไม่มีค่าใช้จ่ายซ่อนเร้น</p>
          </div>
        </div>

        <div className="space-y-5">
          {hotel.rooms.map((room) => (
            <RoomCard
              key={room.id}
              roomId={room.id}
              hotelSlug={hotel.slug}
              hotelBrand={brand}
              name={room.name}
              description={room.description}
              bedDescription={room.bedDescription}
              priceThb={Number(room.priceThb)}
              totalRooms={room.totalRooms}
              amenities={room.amenities}
              imageUrls={room.images.map((i) => i.url)}
              primaryImageUrl={room.primaryImageUrl}
            />
          ))}
        </div>
      </section>

      {/* INFO + CONTACT */}
      <section className="bg-white border-t border-zinc-200">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14 grid gap-8 sm:grid-cols-2">
          <div>
            <h3 className="text-xl font-semibold mb-4">ข้อมูลโรงแรม</h3>
            <dl className="space-y-3 text-sm">
              {hotel.checkInTime && (
                <Row label="เช็คอิน">หลัง {hotel.checkInTime} น.</Row>
              )}
              {hotel.checkOutTime && (
                <Row label="เช็คเอาท์">ก่อน {hotel.checkOutTime} น.</Row>
              )}
              <Row label="ชำระเงิน">{paymentLabelDetail(hotel.paymentMethods)}</Row>
              <Row label="สัตว์เลี้ยง">{hotel.allowsPets ? "✅ อนุญาต" : "❌ ไม่อนุญาต"}</Row>
              <Row label="สูบบุหรี่">{hotel.smokingAllowed ? "✅ ได้" : "❌ ห้ามสูบในห้อง"}</Row>
              {hotel.multiNightDiscountNote && (
                <Row label="จองหลายห้อง">{hotel.multiNightDiscountNote}</Row>
              )}
            </dl>
          </div>

          <div>
            <h3 className="text-xl font-semibold mb-4">ติดต่อโรงแรม</h3>
            <div className="space-y-3 text-sm">
              {hotel.reservationPhones.map((p) => (
                <a key={p} href={`tel:${p.replace(/\D/g, "")}`} className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 p-3 hover:bg-zinc-50 transition">
                  <span className="text-xl">📞</span>
                  <div>
                    <div className="font-medium">{p}</div>
                    <div className="text-xs text-zinc-500">จองห้องพัก</div>
                  </div>
                </a>
              ))}
              {hotel.ownerPhone && (
                <a href={`tel:${hotel.ownerPhone.replace(/\D/g, "")}`} className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 p-3 hover:bg-zinc-50 transition">
                  <span className="text-xl">🤝</span>
                  <div>
                    <div className="font-medium">{hotel.ownerPhone}</div>
                    <div className="text-xs text-zinc-500">เจ้าของ · เหมา/ร้องเรียน</div>
                  </div>
                </a>
              )}
              {hotel.googleMapsUrl && (
                <a href={hotel.googleMapsUrl} target="_blank" rel="noopener" className="flex items-center gap-3 rounded-xl ring-1 ring-zinc-200 p-3 hover:bg-zinc-50 transition">
                  <span className="text-xl">🗺</span>
                  <div>
                    <div className="font-medium">เปิด Google Maps</div>
                    <div className="text-xs text-zinc-500">ดูเส้นทาง · pin location</div>
                  </div>
                </a>
              )}
            </div>

            {hotel.amenities.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-semibold mb-2">สิ่งอำนวยความสะดวก</h4>
                <div className="flex flex-wrap gap-1.5">
                  {hotel.amenities.map((a) => (
                    <span key={a} className="text-xs px-2.5 py-1 rounded-full bg-zinc-100 ring-1 ring-zinc-200 text-zinc-700">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {hotel.nearbyPlaces.length > 0 && (
              <div className="mt-6">
                <h4 className="text-sm font-semibold mb-2">ใกล้ๆ โรงแรม</h4>
                <ul className="text-sm text-zinc-600 space-y-1">
                  {hotel.nearbyPlaces.map((p) => (
                    <li key={p} className="flex items-center gap-2"><span>📍</span>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 bg-zinc-50">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 py-8 text-xs text-zinc-500 text-center">
          © {new Date().getFullYear()} {hotel.name} · Powered by Pooilgroup HotelBook
        </div>
      </footer>

      {/* Hidden booking flow — opened by clicking room button */}
      <BookingFlow hotelSlug={hotel.slug} brand={brand} />
      <RoomGallery />
    </main>
  );
}

function paymentLabel(methods: string[]): string {
  if (methods.includes("qr") && methods.includes("cash")) return "เงินสด · โอน · QR";
  return methods.join(" · ");
}

function paymentLabelDetail(methods: string[]): string {
  const m: Record<string, string> = { cash: "เงินสด", transfer: "โอนผ่านธนาคาร", qr: "QR PromptPay", card: "บัตรเครดิต" };
  return methods.map((x) => m[x] ?? x).join(" · ");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <dt className="w-24 text-zinc-500 shrink-0">{label}</dt>
      <dd className="text-zinc-900">{children}</dd>
    </div>
  );
}

function RoomCard(props: {
  roomId: string;
  hotelSlug: string;
  hotelBrand: string;
  name: string;
  description: string | null;
  bedDescription: string | null;
  priceThb: number;
  totalRooms: number;
  amenities: string[];
  imageUrls: string[];
  primaryImageUrl: string | null;
}) {
  const main = props.primaryImageUrl ?? props.imageUrls[0] ?? null;
  const others = props.imageUrls.filter((u) => u !== main).slice(0, 2);
  return (
    <article className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm hover:shadow-md transition">
      <div className="grid sm:grid-cols-5 gap-0">
        {/* image */}
        <div className="sm:col-span-2 relative h-52 sm:h-auto bg-zinc-100">
          {main ? (
            <button
              type="button"
              data-gallery-images={JSON.stringify(props.imageUrls)}
              data-gallery-name={props.name}
              className="block w-full h-full cursor-zoom-in group"
            >
              <img src={main} alt={props.name} className="w-full h-full object-cover" />
              {props.imageUrls.length > 1 && (
                <span className="absolute bottom-2 right-2 text-[11px] bg-black/60 text-white px-2 py-0.5 rounded-full">
                  📷 {props.imageUrls.length}
                </span>
              )}
            </button>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
              📷 ยังไม่มีรูป
            </div>
          )}
          {others.length > 0 && (
            <div className="absolute top-2 right-2 flex flex-col gap-1.5">
              {others.map((u) => (
                <img key={u} src={u} alt="" className="w-12 h-12 object-cover rounded-md ring-2 ring-white shadow-sm" />
              ))}
            </div>
          )}
        </div>

        {/* details */}
        <div className="sm:col-span-3 p-5 flex flex-col">
          <div className="flex-1">
            <h3 className="text-lg sm:text-xl font-bold text-zinc-900">{props.name}</h3>
            {props.bedDescription && <p className="text-sm text-zinc-500 mt-0.5">🛏 {props.bedDescription}</p>}
            {props.description && <p className="text-sm text-zinc-600 mt-2">{props.description}</p>}

            {props.amenities.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {props.amenities.slice(0, 6).map((a) => (
                  <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-50 ring-1 ring-zinc-200 text-zinc-700">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-100 flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] text-zinc-500">ราคา/คืน</div>
              <div className="text-2xl font-bold text-zinc-900">฿{props.priceThb.toLocaleString()}</div>
              {props.totalRooms > 1 && <div className="text-[11px] text-emerald-600 mt-0.5">ว่าง {props.totalRooms} ห้อง</div>}
            </div>
            <button
              type="button"
              data-book-room-id={props.roomId}
              data-book-room-name={props.name}
              data-book-room-price={props.priceThb}
              className="inline-flex items-center justify-center h-11 px-5 rounded-xl font-semibold text-white shadow-md hover:shadow-lg active:scale-95 transition"
              style={{ background: props.hotelBrand }}
            >
              จองเลย →
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
