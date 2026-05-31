"use client";

import { useState, useTransition, useEffect } from "react";
import { actPublicCreateBooking } from "../_actions";

type Room = { id: string; name: string; price: number };

export function BookingFlow({ hotelSlug, brand }: { hotelSlug: string; brand: string }) {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: true; code: string; total: number } | { ok: false; msg: string } | null>(null);

  // form state
  const [checkIn, setCheckIn] = useState(todayISO());
  const [checkOut, setCheckOut] = useState(tomorrowISO());
  const [rooms, setRooms] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<"cash" | "transfer" | "qr">("transfer");
  const [note, setNote] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-book-room-id]");
      if (!t) return;
      e.preventDefault();
      setRoom({
        id: t.dataset.bookRoomId!,
        name: t.dataset.bookRoomName ?? "",
        price: Number(t.dataset.bookRoomPrice ?? 0),
      });
      setResult(null);
      setOpen(true);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  if (!open || !room) return null;

  const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400_000));
  const total = room.price * nights * rooms;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={() => !pending && setOpen(false)}>
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-3xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between" style={{ background: `${brand}10` }}>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-zinc-500">จองห้องพัก</div>
            <div className="text-lg font-bold text-zinc-900">{room.name}</div>
          </div>
          <button onClick={() => !pending && setOpen(false)} className="h-8 w-8 rounded-full hover:bg-zinc-100 flex items-center justify-center text-zinc-500" aria-label="ปิด">✕</button>
        </div>

        {result?.ok ? (
          <div className="p-6 text-center space-y-4">
            <div className="text-6xl">🎉</div>
            <h3 className="text-xl font-bold text-zinc-900">จองสำเร็จแล้ว!</h3>
            <div className="bg-zinc-50 ring-1 ring-zinc-200 rounded-xl p-4 inline-block">
              <div className="text-xs text-zinc-500">รหัสการจอง</div>
              <div className="text-2xl font-mono font-bold text-zinc-900 tracking-wider">{result.code}</div>
            </div>
            <p className="text-sm text-zinc-600">
              รวมทั้งสิ้น <span className="font-semibold">฿{result.total.toLocaleString()}</span><br />
              ทางโรงแรมจะติดต่อกลับเพื่อยืนยันการจอง · กรุณาเก็บรหัสไว้
            </p>
            <button onClick={() => setOpen(false)} className="w-full h-12 rounded-xl text-white font-semibold" style={{ background: brand }}>เสร็จสิ้น</button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                try {
                  const r = await actPublicCreateBooking({
                    hotelSlug,
                    roomId: room.id,
                    guestName: name,
                    guestPhone: phone,
                    guestEmail: email || undefined,
                    checkInDate: checkIn,
                    checkOutDate: checkOut,
                    rooms,
                    paymentMethod: payment,
                    source: "web",
                    note: note || undefined,
                  });
                  if (r.ok) setResult({ ok: true, code: r.code, total: r.totalThb });
                  else setResult({ ok: false, msg: r.error });
                } catch (e) {
                  setResult({ ok: false, msg: (e as Error).message });
                }
              });
            }}
            className="overflow-y-auto p-5 space-y-4"
          >
            <div className="grid grid-cols-2 gap-3">
              <Field label="วันเช็คอิน">
                <input type="date" required min={todayISO()} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none" />
              </Field>
              <Field label="วันเช็คเอาท์">
                <input type="date" required min={checkIn} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none" />
              </Field>
            </div>

            <Field label={`จำนวนห้อง (${nights} คืน)`}>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setRooms((n) => Math.max(1, n - 1))} className="h-11 w-11 rounded-xl ring-1 ring-zinc-200 text-xl">−</button>
                <div className="flex-1 text-center text-lg font-semibold">{rooms}</div>
                <button type="button" onClick={() => setRooms((n) => Math.min(10, n + 1))} className="h-11 w-11 rounded-xl ring-1 ring-zinc-200 text-xl">+</button>
              </div>
            </Field>

            <Field label="ชื่อผู้จอง">
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="ชื่อ-นามสกุล" className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none" />
            </Field>

            <Field label="เบอร์โทร">
              <input required type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0XX-XXX-XXXX" className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none" />
            </Field>

            <Field label="อีเมล (ถ้ามี)">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@email.com" className="w-full h-11 px-3 rounded-xl ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none" />
            </Field>

            <Field label="ชำระเงิน">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { v: "cash", label: "💵 เงินสด" },
                  { v: "transfer", label: "🏦 โอน" },
                  { v: "qr", label: "📱 QR" },
                ].map((p) => (
                  <button
                    key={p.v}
                    type="button"
                    onClick={() => setPayment(p.v as "cash" | "transfer" | "qr")}
                    className={`h-11 rounded-xl text-sm font-medium ring-1 transition ${
                      payment === p.v ? "ring-2 ring-zinc-900 bg-zinc-900 text-white" : "ring-zinc-200 hover:ring-zinc-400"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="หมายเหตุ (ถ้ามี)">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="เช่น เช็คอินกี่โมง · ขอห้องชั้นบน" className="w-full px-3 py-2 rounded-xl ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 outline-none resize-none" />
            </Field>

            {result?.ok === false && (
              <div className="text-sm text-rose-600 bg-rose-50 ring-1 ring-rose-200 px-3 py-2 rounded-xl">{result.msg}</div>
            )}

            {/* Summary + CTA */}
            <div className="pt-3 border-t border-zinc-100">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-zinc-500">รวมทั้งสิ้น ({nights} คืน × {rooms} ห้อง)</div>
                <div className="text-2xl font-bold">฿{total.toLocaleString()}</div>
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full h-12 rounded-xl text-white font-semibold shadow-lg disabled:opacity-50"
                style={{ background: brand }}
              >
                {pending ? "กำลังจอง..." : "ยืนยันจอง"}
              </button>
              <p className="text-[11px] text-zinc-500 text-center mt-2">ไม่มีค่ามัดจำ · ทางโรงแรมจะติดต่อกลับเพื่อยืนยัน</p>
            </div>
          </form>
        )}
      </div>
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
