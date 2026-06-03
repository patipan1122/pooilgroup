"use client";

import { useState, useEffect, useTransition, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { X, UserRound, FileText, Pencil, Check, Phone, Building2, TrendingUp, Calendar, Lock } from "lucide-react";
import { QuoteForm } from "@/app/(admin)/fuelos/quotes/quote-form";
import { updateContact } from "@/app/(admin)/fuelos/inbox/actions";
import { cn } from "@/lib/fuelos/utils/cn";

type Person = {
  lineUserId: string;
  displayName: string | null;
  alias: string | null;
  pictureUrl: string | null;
  roleLabel: string | null;
};

type Profile = {
  id: string; name: string; nickname: string | null; legalName: string | null;
  phone: string | null; zone: string | null; province: string | null;
  creditLimit: number | null; creditUsed: number; paymentTerms: number | null;
  firstOrderAt: string | null; lastOrderAt: string | null; normalCadenceDays: number | null; notes: string | null;
  orderCount: number; totalLiters: number; avgLitersPerOrder: number; avgMarginPerL: number; totalProfit: number;
  recentOrders: { id: string; orderNo: string; status: string; subtotal: number; createdAt: string }[];
} | null;

type QuoteProps = Omit<ComponentProps<typeof QuoteForm>, "conversationId">;

function nf(n: number) {
  return new Intl.NumberFormat("th-TH").format(Math.round(n));
}
function nf2(n: number) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
function dt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

// Slide-over ขวา (LINE-like) — reusable
function SlideOver({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  // ⚠️ ต้อง render ผ่าน portal ไป document.body — ไม่งั้น fixed panel จะถูก trap/clip
  // เพราะ inbox container มี overflow-hidden + header มี backdrop-blur (filter สร้าง containing block)
  // → panel จะโผล่แค่ในกล่อง content แทนที่จะเต็มจอ (อาการที่ CEO เห็น: panel ตัน/ว่าง)
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // ล็อก scroll พื้นหลังตอนเปิด
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={cn("absolute right-0 top-0 h-full bg-surface shadow-xl flex flex-col w-full", wide ? "sm:w-[480px]" : "sm:w-[380px]")}>
        <div className="shrink-0 flex items-center justify-between border-b border-border px-4 h-14">
          <h2 className="font-bold">{title}</h2>
          <button onClick={onClose} className="size-9 grid place-items-center rounded-lg hover:bg-surface-2"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function PersonRow({ convId, p }: { convId: string; p: Person }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(p.alias ?? "");
  const [role, setRole] = useState(p.roleLabel ?? "");
  const [pending, start] = useTransition();
  const shown = p.alias || p.displayName || "ไม่ทราบชื่อ";

  function save() {
    start(async () => {
      const r = await updateContact(convId, p.lineUserId, { alias, roleLabel: role });
      if (r.ok) { toast.success("บันทึกแล้ว"); setEditing(false); router.refresh(); }
      else toast.error(r.error ?? "บันทึกไม่สำเร็จ");
    });
  }

  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-border last:border-0">
      {p.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.pictureUrl} alt={shown} className="size-9 rounded-full object-cover shrink-0" />
      ) : (
        <div className="size-9 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-sm font-bold shrink-0">{shown.slice(0, 1)}</div>
      )}
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1.5">
            <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="ตั้งชื่อเรียก (เช่น เถ้าแก่สมชาย)" className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="ป้ายบทบาท (เช่น เถ้าแก่ / บัญชี)" className="h-8 w-full rounded-lg border border-border bg-surface px-2 text-sm" />
            <div className="flex gap-1.5">
              <button onClick={save} disabled={pending} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg bg-brand-600 text-white text-xs"><Check className="size-3.5" /> บันทึก</button>
              <button onClick={() => setEditing(false)} className="h-7 px-2.5 rounded-lg border border-border text-xs">ยกเลิก</button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-sm truncate">{shown}</span>
                {p.roleLabel && <span className="text-[10px] text-brand-600 bg-brand-50 rounded px-1 shrink-0">{p.roleLabel}</span>}
              </div>
              {p.alias && p.displayName && <div className="text-[11px] text-zinc-400 truncate">ชื่อจริง: {p.displayName}</div>}
            </div>
            <button onClick={() => setEditing(true)} className="ml-auto size-7 grid place-items-center rounded-lg hover:bg-surface-2 text-zinc-400 shrink-0" title="ตั้งชื่อ/ป้าย"><Pencil className="size-3.5" /></button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatTools({ convId, customerId, profile, people, quote }: {
  convId: string;
  customerId: string | null;
  profile: Profile;
  people: Person[];
  quote: QuoteProps;
}) {
  const [panel, setPanel] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  return (
    <>
      <button onClick={() => setPanel(true)} className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg border border-border text-xs text-zinc-600 hover:bg-surface-2" title="ดูข้อมูลลูกค้า/กลุ่ม">
        <UserRound className="size-4" /> ข้อมูล
      </button>
      <button onClick={() => setQuoteOpen(true)} className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-brand-600 text-white text-xs" title="ออกใบเสนอราคา">
        <FileText className="size-4" /> ใบเสนอราคา
      </button>

      {/* PANEL: customer profile + people in group */}
      <SlideOver open={panel} onClose={() => setPanel(false)} title="ข้อมูลลูกค้า / กลุ่ม">
        {profile ? (
          <div className="space-y-4">
            <div>
              <div className="text-lg font-bold">{profile.nickname || profile.name}</div>
              {profile.nickname && <div className="text-xs text-zinc-500">{profile.name}</div>}
              {profile.legalName && <div className="text-xs text-zinc-500 flex items-center gap-1"><Building2 className="size-3" />{profile.legalName}</div>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-zinc-600">
                {profile.phone && <a href={`tel:${profile.phone}`} className="inline-flex items-center gap-1 text-brand-600"><Phone className="size-3" />{profile.phone}</a>}
                {profile.zone && <span>โซน {profile.zone}</span>}
                {profile.paymentTerms != null && <span>เครดิต {profile.paymentTerms} วัน</span>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Stat icon={<TrendingUp className="size-4" />} label="ออเดอร์ทั้งหมด" value={`${nf(profile.orderCount)} ครั้ง`} />
              <Stat icon={<TrendingUp className="size-4" />} label="ปริมาณรวม" value={`${nf(profile.totalLiters)} ล.`} />
              <Stat icon={<TrendingUp className="size-4" />} label="เฉลี่ย/ออเดอร์" value={`${nf(profile.avgLitersPerOrder)} ล.`} />
              <Stat icon={<TrendingUp className="size-4" />} label="margin เฉลี่ย" value={`${nf2(profile.avgMarginPerL)} ฿/ล.`} />
              <Stat icon={<Calendar className="size-4" />} label="ซื้อล่าสุด" value={dt(profile.lastOrderAt)} />
              <Stat icon={<Calendar className="size-4" />} label="รอบซื้อปกติ" value={profile.normalCadenceDays ? `${profile.normalCadenceDays} วัน` : "—"} />
            </div>

            {profile.recentOrders.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-zinc-500 mb-1">ออเดอร์ล่าสุด</div>
                <div className="space-y-1">
                  {profile.recentOrders.map((o) => (
                    <div key={o.id} className="flex items-center justify-between text-xs border border-border rounded-lg px-2.5 py-1.5">
                      <span className="font-mono text-zinc-500">{o.orderNo}</span>
                      <span>{nf(o.subtotal)} ฿</span>
                      <span className="text-zinc-400">{dt(o.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <a href={`/fuelos/customers/${profile.id}`} className="block text-center text-sm text-brand-600 hover:underline">เปิดหน้าลูกค้าเต็ม →</a>
          </div>
        ) : (
          <div className="rounded-xl bg-surface-2 border border-border p-3 text-sm text-zinc-500">
            แชทนี้ยังไม่ผูกลูกค้า · {customerId ? "" : "ผูกลูกค้าเพื่อเห็นประวัติซื้อขาย"}
          </div>
        )}

        {/* people in group */}
        <div className="mt-5">
          <div className="text-xs font-semibold text-zinc-500 mb-1 flex items-center gap-1.5">
            คนในกลุ่มนี้ ({people.length})
            <span className="text-zinc-400 font-normal">· กดดินสอเปลี่ยนชื่อเรียก/ใส่ป้ายได้</span>
          </div>
          {people.length === 0 ? (
            <div className="text-xs text-zinc-400">ยังไม่มีข้อมูลผู้ส่ง</div>
          ) : (
            people.map((p) => <PersonRow key={p.lineUserId} convId={convId} p={p} />)
          )}
        </div>
      </SlideOver>

      {/* DRAWER: quote form */}
      <SlideOver open={quoteOpen} onClose={() => setQuoteOpen(false)} title="ออกใบเสนอราคา" wide>
        <div className="mb-3 text-xs text-zinc-500 inline-flex items-center gap-1"><Lock className="size-3" /> ผูกกับแชทนี้อัตโนมัติ</div>
        <QuoteForm {...quote} conversationId={convId} />
      </SlideOver>
    </>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <div className="text-[11px] text-zinc-500 flex items-center gap-1">{icon}{label}</div>
      <div className="font-bold text-sm mt-0.5">{value}</div>
    </div>
  );
}
