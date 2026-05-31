"use client";

import { useState, useTransition } from "react";
import {
  actUpsertRoom,
  actDeleteRoom,
  actUploadImage,
  actDeleteImage,
  actSetPrimaryImage,
} from "../../_actions";

type Room = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  bedDescription: string | null;
  priceThb: number;
  totalRooms: number;
  amenities: string[];
  sortOrder: number;
  isActive: boolean;
  primaryImageUrl: string | null;
  images: Array<{ id: string; url: string }>;
};

export function RoomsManager({ hotelId, rooms: initial }: { hotelId: string; rooms: Room[] }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<Room | null>(null);
  const [showNew, setShowNew] = useState(false);

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => { setEditing(null); setShowNew(true); }}
        className="h-10 px-4 rounded-lg bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800"
      >
        + เพิ่มห้องใหม่
      </button>

      <div className="space-y-3">
        {initial.map((r) => (
          <RoomCard
            key={r.id}
            room={r}
            hotelId={hotelId}
            onEdit={() => { setEditing(r); setShowNew(false); }}
            onDelete={() => start(async () => { if (confirm(`ลบห้อง "${r.name}"?`)) await actDeleteRoom(r.id); })}
            pending={pending}
            startTransition={start}
          />
        ))}
      </div>

      {(showNew || editing) && (
        <RoomFormModal
          hotelId={hotelId}
          existing={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function RoomCard({
  room, hotelId, onEdit, onDelete, pending, startTransition,
}: {
  room: Room;
  hotelId: string;
  onEdit: () => void;
  onDelete: () => void;
  pending: boolean;
  startTransition: (fn: () => Promise<void> | void) => void;
}) {
  return (
    <article className="rounded-xl ring-1 ring-zinc-200 bg-white overflow-hidden">
      <div className="grid sm:grid-cols-5">
        <div className="sm:col-span-2 p-3 space-y-2">
          {/* Image grid */}
          <div className="grid grid-cols-3 gap-2">
            {room.images.map((img) => (
              <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden ring-1 ring-zinc-200">
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                {room.primaryImageUrl === img.url ? (
                  <span className="absolute top-1 left-1 text-[9px] bg-emerald-600 text-white px-1.5 py-0.5 rounded">หลัก</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => startTransition(async () => { await actSetPrimaryImage(room.id, img.url); })}
                    className="absolute top-1 left-1 text-[9px] bg-zinc-900/70 text-white px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100"
                  >
                    ตั้งหลัก
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => startTransition(async () => { if (confirm("ลบรูปนี้?")) await actDeleteImage(img.id); })}
                  className="absolute top-1 right-1 text-[9px] bg-rose-600 text-white h-5 w-5 rounded-full opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
            <ImageUploader hotelId={hotelId} roomId={room.id} />
          </div>
        </div>

        <div className="sm:col-span-3 p-4 flex flex-col">
          <div className="flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">{room.name}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">{room.bedDescription}</p>
                {room.description && <p className="text-sm text-zinc-600 mt-2">{room.description}</p>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold font-mono">฿{room.priceThb.toLocaleString()}</div>
                <div className="text-[11px] text-zinc-500">{room.totalRooms} ห้อง</div>
              </div>
            </div>
            {room.amenities.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {room.amenities.map((a) => (
                  <span key={a} className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-50 ring-1 ring-zinc-200">{a}</span>
                ))}
              </div>
            )}
            {!room.isActive && (
              <div className="mt-2 text-[11px] text-rose-600 font-medium">⚠️ ปิดการจองชั่วคราว</div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-zinc-100 flex gap-2">
            <button disabled={pending} onClick={onEdit} className="text-sm px-3 py-1.5 rounded-lg ring-1 ring-zinc-200 hover:bg-zinc-50">แก้ไข</button>
            <button disabled={pending} onClick={onDelete} className="text-sm px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50">ลบ</button>
          </div>
        </div>
      </div>
    </article>
  );
}

function ImageUploader({ hotelId, roomId }: { hotelId: string; roomId?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <label className="aspect-square rounded-lg ring-1 ring-dashed ring-zinc-300 bg-zinc-50 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-100 transition">
      {pending ? (
        <span className="text-xs text-zinc-500">กำลังอัปโหลด...</span>
      ) : error ? (
        <span className="text-[10px] text-rose-600 text-center px-1">{error}</span>
      ) : (
        <>
          <span className="text-2xl">📷</span>
          <span className="text-[10px] text-zinc-500 mt-0.5">เพิ่มรูป</span>
        </>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) { setError("ไฟล์ใหญ่เกิน 5MB"); return; }
          start(async () => {
            try {
              const reader = new FileReader();
              const dataUrl: string = await new Promise((res, rej) => {
                reader.onload = () => res(reader.result as string);
                reader.onerror = () => rej(new Error("อ่านไฟล์ไม่ได้"));
                reader.readAsDataURL(file);
              });
              await actUploadImage({ hotelId, roomId, dataUrl });
              setError(null);
            } catch (e) {
              setError((e as Error).message.slice(0, 40));
            }
          });
        }}
      />
    </label>
  );
}

function RoomFormModal({
  hotelId, existing, onClose,
}: {
  hotelId: string;
  existing: Room | null;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [bedDescription, setBedDescription] = useState(existing?.bedDescription ?? "");
  const [priceThb, setPriceThb] = useState(String(existing?.priceThb ?? ""));
  const [totalRooms, setTotalRooms] = useState(String(existing?.totalRooms ?? "1"));
  const [amenities, setAmenities] = useState((existing?.amenities ?? []).join(", "));
  const [sortOrder, setSortOrder] = useState(String(existing?.sortOrder ?? "0"));
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => !pending && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">{existing ? "แก้ไขห้อง" : "เพิ่มห้องใหม่"}</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-full hover:bg-zinc-100">✕</button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              try {
                await actUpsertRoom({
                  id: existing?.id,
                  hotelId,
                  slug: slug.trim(),
                  name: name.trim(),
                  description: description.trim() || undefined,
                  bedDescription: bedDescription.trim() || undefined,
                  priceThb: Number(priceThb),
                  totalRooms: Number(totalRooms),
                  amenities: amenities.split(",").map((a) => a.trim()).filter(Boolean),
                  sortOrder: Number(sortOrder) || 0,
                  isActive,
                });
                onClose();
              } catch (e) {
                setError((e as Error).message);
              }
            });
          }}
          className="p-5 space-y-3"
        >
          <Field label="ชื่อห้อง"><input required value={name} onChange={(e) => setName(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
          <Field label="Slug (URL · ภาษาอังกฤษ · เช่น standard-single)"><input required value={slug} onChange={(e) => setSlug(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200 font-mono text-sm" /></Field>
          <Field label="เตียง"><input value={bedDescription} onChange={(e) => setBedDescription(e.target.value)} placeholder="เตียงเดี่ยว 6 ฟุต" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
          <Field label="คำอธิบาย"><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2 rounded-lg ring-1 ring-zinc-200" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ราคา/คืน (บาท)"><input required type="number" min={0} value={priceThb} onChange={(e) => setPriceThb(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
            <Field label="จำนวนห้อง"><input required type="number" min={1} value={totalRooms} onChange={(e) => setTotalRooms(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
          </div>
          <Field label="สิ่งอำนวยความสะดวก (คั่นด้วย , )"><input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="Wi-Fi, TV, ตู้เย็น, AC" className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ลำดับการแสดง"><input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-full h-10 px-3 rounded-lg ring-1 ring-zinc-200" /></Field>
            <Field label="เปิดรับจอง">
              <label className="flex items-center gap-2 h-10">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5" />
                <span className="text-sm">{isActive ? "เปิด" : "ปิด"}</span>
              </label>
            </Field>
          </div>

          {error && <div className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg">{error}</div>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-11 rounded-lg ring-1 ring-zinc-200 text-sm font-medium">ยกเลิก</button>
            <button type="submit" disabled={pending} className="flex-1 h-11 rounded-lg bg-zinc-900 text-white text-sm font-medium disabled:opacity-50">{pending ? "บันทึก..." : "บันทึก"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-medium text-zinc-700 mb-1">{label}</span>{children}</label>;
}
