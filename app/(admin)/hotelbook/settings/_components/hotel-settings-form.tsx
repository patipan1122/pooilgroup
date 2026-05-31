"use client";

import { useState, useTransition } from "react";
import { actUpsertHotel } from "../../_actions";

type Existing = {
  id: string;
  slug: string;
  name: string;
  concept: string | null;
  description: string | null;
  reservationPhones: string[];
  ownerPhone: string | null;
  googleMapsUrl: string | null;
  address: string | null;
  email: string | null;
  brandColor: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  is24h: boolean;
  paymentMethods: string[];
  allowsPets: boolean;
  smokingAllowed: boolean;
  cancellationNote: string | null;
  multiNightDiscountNote: string | null;
  amenities: string[];
  nearbyPlaces: string[];
  enabled: boolean;
};

export function HotelSettingsForm({ existing }: { existing: Existing | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // form state
  const [slug, setSlug] = useState(existing?.slug ?? "mix-hotel");
  const [name, setName] = useState(existing?.name ?? "");
  const [concept, setConcept] = useState(existing?.concept ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [reservationPhones, setReservationPhones] = useState((existing?.reservationPhones ?? []).join(", "));
  const [ownerPhone, setOwnerPhone] = useState(existing?.ownerPhone ?? "");
  const [googleMapsUrl, setGoogleMapsUrl] = useState(existing?.googleMapsUrl ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [brandColor, setBrandColor] = useState(existing?.brandColor ?? "#7c3aed");
  const [checkInTime, setCheckInTime] = useState(existing?.checkInTime ?? "12:00");
  const [checkOutTime, setCheckOutTime] = useState(existing?.checkOutTime ?? "12:00");
  const [is24h, setIs24h] = useState(existing?.is24h ?? true);
  const [paymentMethods, setPaymentMethods] = useState<Set<string>>(new Set(existing?.paymentMethods ?? ["cash", "transfer", "qr"]));
  const [allowsPets, setAllowsPets] = useState(existing?.allowsPets ?? false);
  const [smokingAllowed, setSmokingAllowed] = useState(existing?.smokingAllowed ?? false);
  const [cancellationNote, setCancellationNote] = useState(existing?.cancellationNote ?? "");
  const [multiNightDiscountNote, setMultiNightDiscountNote] = useState(existing?.multiNightDiscountNote ?? "");
  const [amenities, setAmenities] = useState((existing?.amenities ?? []).join(", "));
  const [nearbyPlaces, setNearbyPlaces] = useState((existing?.nearbyPlaces ?? []).join("\n"));
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const togglePayment = (k: string) => {
    setPaymentMethods((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        setSaved(false);
        start(async () => {
          try {
            await actUpsertHotel({
              id: existing?.id,
              slug: slug.trim(),
              name: name.trim(),
              concept: concept.trim() || undefined,
              description: description.trim() || undefined,
              reservationPhones: reservationPhones.split(",").map((p) => p.trim()).filter(Boolean),
              ownerPhone: ownerPhone.trim() || undefined,
              googleMapsUrl: googleMapsUrl.trim() || undefined,
              address: address.trim() || undefined,
              email: email.trim() || undefined,
              brandColor,
              checkInTime: checkInTime || undefined,
              checkOutTime: checkOutTime || undefined,
              is24h,
              paymentMethods: Array.from(paymentMethods),
              allowsPets,
              smokingAllowed,
              cancellationNote: cancellationNote.trim() || undefined,
              multiNightDiscountNote: multiNightDiscountNote.trim() || undefined,
              amenities: amenities.split(",").map((a) => a.trim()).filter(Boolean),
              nearbyPlaces: nearbyPlaces.split("\n").map((a) => a.trim()).filter(Boolean),
              enabled,
            });
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
          }
        });
      }}
      className="space-y-5"
    >
      {/* Basics */}
      <Section title="ข้อมูลพื้นฐาน">
        <Field label="ชื่อโรงแรม"><input required value={name} onChange={(e) => setName(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="Slug (URL)"><input required value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200 font-mono" /></Field>
        <Field label="คอนเซ็ปต์ (1 บรรทัด)"><input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="เช่น โรงแรมบัดเจท 3 ดาว" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="คำอธิบาย"><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-lg ring-1 ring-zinc-200" /></Field>
      </Section>

      {/* Contact */}
      <Section title="ข้อมูลติดต่อ">
        <Field label="เบอร์จองห้องพัก (คั่นด้วย , )"><input value={reservationPhones} onChange={(e) => setReservationPhones(e.target.value)} placeholder="044-244-700, 092-154-1234" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="เบอร์เจ้าของ"><input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="086-980-1234" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="Google Maps URL"><input value={googleMapsUrl} onChange={(e) => setGoogleMapsUrl(e.target.value)} placeholder="https://maps.app.goo.gl/..." className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200 text-sm" /></Field>
        <Field label="ที่อยู่"><input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="อีเมล"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
      </Section>

      {/* Brand + ops */}
      <Section title="แบรนด์ + นโยบาย">
        <Field label="สีหลัก (Brand color)">
          <div className="flex items-center gap-3">
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-16 rounded-lg ring-1 ring-zinc-200" />
            <input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="flex-1 h-10 px-3 rounded-lg ring-1 ring-zinc-200 font-mono" />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="เช็คอินตั้งแต่"><input type="time" value={checkInTime} onChange={(e) => setCheckInTime(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
          <Field label="เช็คเอาท์ก่อน"><input type="time" value={checkOutTime} onChange={(e) => setCheckOutTime(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        </div>
        <Toggle label="เปิด 24 ชั่วโมง" checked={is24h} onChange={setIs24h} />

        <Field label="ชำระเงิน">
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: "cash", label: "💵 เงินสด" },
              { v: "transfer", label: "🏦 โอน" },
              { v: "qr", label: "📱 QR" },
              { v: "card", label: "💳 บัตร" },
            ].map((p) => (
              <button key={p.v} type="button" onClick={() => togglePayment(p.v)} className={`h-10 rounded-lg text-sm font-medium ring-1 ${paymentMethods.has(p.v) ? "ring-2 ring-zinc-900 bg-zinc-900 text-white" : "ring-zinc-200"}`}>{p.label}</button>
            ))}
          </div>
        </Field>

        <Toggle label="อนุญาตสัตว์เลี้ยง" checked={allowsPets} onChange={setAllowsPets} />
        <Toggle label="อนุญาตสูบบุหรี่" checked={smokingAllowed} onChange={setSmokingAllowed} />

        <Field label="นโยบายยกเลิก"><textarea rows={2} value={cancellationNote} onChange={(e) => setCancellationNote(e.target.value)} placeholder="เช่น ยกเลิกฟรี 3 วันก่อนเช็คอิน" className="w-full px-3 py-2 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="โน้ตการจองหลายห้อง/เหมา"><input value={multiNightDiscountNote} onChange={(e) => setMultiNightDiscountNote(e.target.value)} placeholder="จองหลายห้อง โทร 086-980-1234" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
      </Section>

      <Section title="สิ่งอำนวยความสะดวก + ใกล้ๆ">
        <Field label="สิ่งอำนวยความสะดวก (คั่นด้วย , )"><input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="Wi-Fi, TV, ตู้เย็น, AC" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
        <Field label="ใกล้ๆ โรงแรม (1 บรรทัด/รายการ)"><textarea rows={3} value={nearbyPlaces} onChange={(e) => setNearbyPlaces(e.target.value)} placeholder="7-Eleven (เดินถึง)&#10;ร้านกาแฟ&#10;Grab Food ส่งถึงห้อง" className="w-full px-3 py-2 rounded-lg ring-1 ring-zinc-200" /></Field>
      </Section>

      <Section title="สถานะ">
        <Toggle label="เปิดให้จองออนไลน์" checked={enabled} onChange={setEnabled} />
      </Section>

      {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</div>}
      {saved && <div className="text-sm text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">✓ บันทึกเรียบร้อย</div>}

      <div className="sticky bottom-0 bg-white border-t border-zinc-100 -mx-4 px-4 sm:-mx-8 sm:px-8 py-4">
        <button type="submit" disabled={pending} className="w-full h-12 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50">{pending ? "บันทึก..." : "บันทึก"}</button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-medium text-zinc-700 mb-1">{label}</span>{children}</label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1.5">
      <span className="text-sm text-zinc-700">{label}</span>
      <button type="button" onClick={() => onChange(!checked)} className={`h-6 w-11 rounded-full transition relative ${checked ? "bg-zinc-900" : "bg-zinc-200"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-5" : "left-0.5"}`} />
      </button>
    </label>
  );
}
