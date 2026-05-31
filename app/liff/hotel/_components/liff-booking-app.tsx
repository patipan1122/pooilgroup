"use client";

import { useState, useTransition } from "react";
import { actPublicCreateBooking } from "../../../hotel/[slug]/_actions";

type Hotel = {
  slug: string;
  name: string;
  concept: string | null;
  description: string | null;
  brandColor: string;
  heroImageUrl: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  reservationPhones: string[];
  ownerPhone: string | null;
  googleMapsUrl: string | null;
  paymentMethods: string[];
  amenities: string[];
  rooms: Array<{
    id: string;
    name: string;
    description: string | null;
    bedDescription: string | null;
    priceThb: number;
    totalRooms: number;
    amenities: string[];
    primaryImageUrl: string | null;
    imageUrls: string[];
  }>;
};

type Step = "rooms" | "form" | "done";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function LiffBookingApp({ hotel }: { hotel: Hotel }) {
  const [step, setStep] = useState<Step>("rooms");
  const [selectedRoom, setSelectedRoom] = useState<Hotel["rooms"][0] | null>(null);
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(tomorrowISO());
  const [rooms, setRooms] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [payment, setPayment] = useState<"cash" | "transfer" | "qr">("transfer");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const brand = hotel.brandColor;
  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400_000));
  const total = (selectedRoom?.priceThb ?? 0) * nights * rooms;

  return (
    <div className="min-h-screen bg-zinc-50 pb-32">
      {/* Hero (compact for LIFF) */}
      {step === "rooms" && (
        <header
          className="relative px-5 pt-8 pb-12"
          style={{ background: `linear-gradient(160deg, ${brand} 0%, ${brand}dd 100%)` }}
        >
          {hotel.heroImageUrl && (
            <div className="absolute inset-0">
              <img src={hotel.heroImageUrl} alt="" className="w-full h-full object-cover opacity-30" />
            </div>
          )}
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 text-white/90 text-[11px] font-medium mb-2">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              เปิด 24 ชม.
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">{hotel.name}</h1>
            {hotel.concept && <p className="text-white/85 text-sm mt-1">{hotel.concept}</p>}
          </div>
        </header>
      )}

      {/* Header for form/done step */}
      {step !== "rooms" && (
        <header className="sticky top-0 z-10 bg-white border-b border-zinc-200 px-5 py-3 flex items-center gap-3">
          <button
            onClick={() => {
              if (step === "form") setStep("rooms");
              else if (step === "done") {
                setStep("rooms");
                setSelectedRoom(null);
                setBookingCode(null);
              }
            }}
            className="h-9 w-9 rounded-full hover:bg-zinc-100 flex items-center justify-center"
            aria-label="ย้อนกลับ"
          >
            ←
          </button>
          <div>
            <div className="text-[11px] text-zinc-500">{hotel.name}</div>
            <div className="font-semibold text-sm">{step === "form" ? "กรอกข้อมูล" : "จองสำเร็จ"}</div>
          </div>
        </header>
      )}

      {/* Step 1: Pick room */}
      {step === "rooms" && (
        <div className="px-5 pt-4 space-y-3">
          <p className="text-xs text-zinc-500 px-1">เลือกห้องที่ต้องการ</p>
          {hotel.rooms.map((r) => {
            const img = r.primaryImageUrl ?? r.imageUrls[0];
            return (
              <button
                key={r.id}
                onClick={() => {
                  setSelectedRoom(r);
                  setStep("form");
                }}
                className="block w-full text-left rounded-2xl bg-white ring-1 ring-zinc-200 hover:shadow-md transition overflow-hidden"
              >
                <div className="flex">
                  <div className="w-28 h-28 bg-zinc-100 shrink-0">
                    {img ? (
                      <img src={img} alt={r.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-400">📷</div>
                    )}
                  </div>
                  <div className="flex-1 p-3 flex flex-col justify-between">
                    <div>
                      <div className="font-semibold text-sm">{r.name}</div>
                      {r.bedDescription && <div className="text-[11px] text-zinc-500">🛏 {r.bedDescription}</div>}
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-[10px] text-zinc-500">เริ่ม</div>
                        <div className="text-lg font-bold text-zinc-900">฿{r.priceThb.toLocaleString()}</div>
                      </div>
                      <div className="text-xs px-2 py-1 rounded-full text-white" style={{ background: brand }}>
                        จอง →
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          <div className="pt-4 grid grid-cols-2 gap-2">
            {hotel.reservationPhones.slice(0, 1).map((p) => (
              <a key={p} href={`tel:${p.replace(/\D/g, "")}`} className="rounded-xl ring-1 ring-zinc-200 bg-white p-3 text-center text-sm">
                📞 โทรจอง
              </a>
            ))}
            {hotel.googleMapsUrl && (
              <a href={hotel.googleMapsUrl} target="_blank" rel="noopener" className="rounded-xl ring-1 ring-zinc-200 bg-white p-3 text-center text-sm">
                📍 แผนที่
              </a>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Form */}
      {step === "form" && selectedRoom && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await actPublicCreateBooking({
                hotelSlug: hotel.slug,
                roomId: selectedRoom.id,
                guestName: name,
                guestPhone: phone,
                checkInDate: checkIn,
                checkOutDate: checkOut,
                rooms,
                paymentMethod: payment,
                source: "liff",
                note: note || undefined,
              });
              if (r.ok) {
                setBookingCode(r.code);
                setStep("done");
              } else setError(r.error);
            });
          }}
          className="px-5 pt-4 space-y-4"
        >
          <div className="rounded-xl ring-1 ring-zinc-200 bg-white p-3">
            <div className="text-xs text-zinc-500">ห้องที่เลือก</div>
            <div className="font-semibold">{selectedRoom.name}</div>
            <div className="text-xs text-zinc-500 mt-0.5">฿{selectedRoom.priceThb.toLocaleString()}/คืน</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="วันเช็คอิน">
              <input type="date" required min={todayISO()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 outline-none" />
            </Field>
            <Field label="วันเช็คเอาท์">
              <input type="date" required min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 outline-none" />
            </Field>
          </div>

          <Field label={`จำนวนห้อง · ${nights} คืน`}>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setRooms((n) => Math.max(1, n - 1))} className="h-11 w-11 rounded-xl ring-1 ring-zinc-200 text-xl">−</button>
              <div className="flex-1 text-center text-lg font-semibold">{rooms}</div>
              <button type="button" onClick={() => setRooms((n) => Math.min(10, n + 1))} className="h-11 w-11 rounded-xl ring-1 ring-zinc-200 text-xl">+</button>
            </div>
          </Field>

          <Field label="ชื่อผู้จอง">
            <input required value={name} onChange={(e) => setName(e.target.value)} className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 outline-none" />
          </Field>

          <Field label="เบอร์โทร">
            <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0XX-XXX-XXXX" className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 outline-none" />
          </Field>

          <Field label="ชำระเงิน">
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: "cash" as const, label: "💵 สด" },
                { v: "transfer" as const, label: "🏦 โอน" },
                { v: "qr" as const, label: "📱 QR" },
              ].map((p) => (
                <button key={p.v} type="button" onClick={() => setPayment(p.v)} className={`h-11 rounded-xl text-sm font-medium ring-1 ${payment === p.v ? "ring-2 ring-zinc-900 bg-zinc-900 text-white" : "ring-zinc-200"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="หมายเหตุ (ถ้ามี)">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-xl ring-1 ring-zinc-200 outline-none resize-none" />
          </Field>

          {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-xl">{error}</div>}

          <div className="sticky bottom-0 left-0 right-0 -mx-5 px-5 py-4 bg-white border-t border-zinc-200">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-zinc-500">รวม ({nights} คืน × {rooms} ห้อง)</div>
              <div className="text-xl font-bold">฿{total.toLocaleString()}</div>
            </div>
            <button type="submit" disabled={pending} className="w-full h-12 rounded-xl text-white font-semibold shadow-lg disabled:opacity-50" style={{ background: brand }}>
              {pending ? "กำลังจอง..." : "ยืนยันจอง"}
            </button>
          </div>
        </form>
      )}

      {/* Step 3: Done */}
      {step === "done" && bookingCode && (
        <div className="px-5 pt-8 text-center space-y-4">
          <div className="text-6xl">🎉</div>
          <h2 className="text-xl font-bold">จองสำเร็จแล้ว!</h2>
          <div className="bg-white ring-1 ring-zinc-200 rounded-xl p-4 inline-block">
            <div className="text-xs text-zinc-500">รหัสการจอง</div>
            <div className="text-2xl font-mono font-bold tracking-wider">{bookingCode}</div>
          </div>
          <p className="text-sm text-zinc-600 px-4">โรงแรมจะติดต่อกลับเพื่อยืนยันการจองค่ะ</p>
          <button onClick={() => { setStep("rooms"); setSelectedRoom(null); setBookingCode(null); }} className="w-full h-12 rounded-xl text-white font-semibold" style={{ background: brand }}>
            จองห้องอื่น
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-zinc-700 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
