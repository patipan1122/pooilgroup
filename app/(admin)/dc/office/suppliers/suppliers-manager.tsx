"use client";

// DC · จัดการทะเบียนผู้ขาย — รายการ + ฟอร์มสร้าง/แก้ (modal) + เปิด/ปิดการใช้งาน.
// เรียก server actions ผ่าน useTransition. โชว์ error ภาษาไทย.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Pencil, Plus } from "lucide-react";
import {
  createSupplier,
  updateSupplier,
  toggleSupplierActive,
  type CreateSupplierInput,
} from "@/lib/dc/supplier-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type SupplierRow = {
  id: string;
  name: string;
  country: string;
  contact: string | null;
  wechat: string | null;
  paymentTerms: string | null;
  note: string | null;
  active: boolean;
};

type FormValues = {
  name: string;
  country: string;
  contact: string;
  wechat: string;
  paymentTerms: string;
  note: string;
};

const EMPTY: FormValues = {
  name: "",
  country: "CN",
  contact: "",
  wechat: "",
  paymentTerms: "",
  note: "",
};

export function SuppliersManager({ suppliers }: { suppliers: SupplierRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(s: SupplierRow) {
    setPendingId(s.id);
    startTransition(async () => {
      await toggleSupplierActive(s.id, !s.active);
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <Button size="lg" onClick={() => setEditing("new")}>
          <Plus size={18} /> เพิ่มผู้ขาย
        </Button>
      </div>

      {suppliers.length === 0 ? (
        <EmptyState
          icon={<Building2 size={26} />}
          title="ยังไม่มีผู้ขายในทะเบียน"
          description="เพิ่มโรงงาน/ผู้ขายจีน เพื่อใช้อ้างอิงในใบสั่งซื้อ"
          action={
            <Button onClick={() => setEditing("new")}>
              <Plus size={16} /> เพิ่มผู้ขายรายแรก
            </Button>
          }
        />
      ) : (
        <div className="dc-card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#71717a", background: "#fafafa" }}>
                <th style={cellHead}>ชื่อผู้ขาย</th>
                <th style={cellHead}>ประเทศ</th>
                <th style={cellHead}>ติดต่อ / WeChat</th>
                <th style={cellHead}>เงื่อนไขชำระ</th>
                <th style={cellHead}>สถานะ</th>
                <th style={{ ...cellHead, textAlign: "right" }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} style={{ borderTop: "1px solid var(--dc-line, #f0f0f2)" }}>
                  <td style={cell}>
                    <div style={{ fontWeight: 600, color: "#18181b" }}>{s.name}</div>
                    {s.note && (
                      <div style={{ fontSize: 12, color: "#a1a1aa" }}>{s.note}</div>
                    )}
                  </td>
                  <td style={cell}>{s.country}</td>
                  <td style={cell}>
                    <div style={{ color: "#52525b" }}>{s.contact ?? "—"}</div>
                    {s.wechat && (
                      <div style={{ fontSize: 12, color: "#a1a1aa" }}>WeChat: {s.wechat}</div>
                    )}
                  </td>
                  <td style={{ ...cell, color: "#52525b" }}>{s.paymentTerms ?? "—"}</td>
                  <td style={cell}>
                    <StatusPill tone={s.active ? "success" : "neutral"} size="sm" dot>
                      {s.active ? "ใช้งาน" : "ปิด"}
                    </StatusPill>
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 8 }}>
                      <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                        <Pencil size={14} /> แก้ไข
                      </Button>
                      <Button
                        size="sm"
                        variant={s.active ? "ghost" : "primary"}
                        loading={pending && pendingId === s.id}
                        onClick={() => toggle(s)}
                      >
                        {s.active ? "ปิด" : "เปิด"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SupplierFormModal
          supplier={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!supplier;
  const [values, setValues] = useState<FormValues>(
    supplier
      ? {
          name: supplier.name,
          country: supplier.country,
          contact: supplier.contact ?? "",
          wechat: supplier.wechat ?? "",
          paymentTerms: supplier.paymentTerms ?? "",
          note: supplier.note ?? "",
        }
      : EMPTY,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormValues>(key: K, v: FormValues[K]) {
    setValues((p) => ({ ...p, [key]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: CreateSupplierInput = {
      name: values.name,
      country: values.country,
      contact: values.contact,
      wechat: values.wechat,
      paymentTerms: values.paymentTerms,
      note: values.note,
    };
    startTransition(async () => {
      const res =
        isEdit && supplier
          ? await updateSupplier(supplier.id, payload)
          : await createSupplier(payload);
      if (res.ok) onSaved();
      else setError(res.error);
    });
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>
            {isEdit ? "แก้ไขผู้ขาย" : "เพิ่มผู้ขาย"}
          </div>

          <Field label="ชื่อผู้ขาย / โรงงาน" required htmlFor="s-name">
            <Input
              id="s-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="เช่น Yiwu Toys Factory"
              autoComplete="off"
            />
          </Field>

          <Field label="ประเทศ" htmlFor="s-country" hint="ค่าเริ่มต้น CN (จีน)">
            <Input
              id="s-country"
              value={values.country}
              onChange={(e) => set("country", e.target.value)}
              placeholder="CN"
              autoComplete="off"
            />
          </Field>

          <Field label="ผู้ติดต่อ / เบอร์" optional htmlFor="s-contact">
            <Input
              id="s-contact"
              value={values.contact}
              onChange={(e) => set("contact", e.target.value)}
              placeholder="เช่น คุณหลี่ +86 ..."
              autoComplete="off"
            />
          </Field>

          <Field label="WeChat ID" optional htmlFor="s-wechat">
            <Input
              id="s-wechat"
              value={values.wechat}
              onChange={(e) => set("wechat", e.target.value)}
              placeholder="เช่น wxid_..."
              autoComplete="off"
            />
          </Field>

          <Field label="เงื่อนไขการชำระเงิน" optional htmlFor="s-terms">
            <Input
              id="s-terms"
              value={values.paymentTerms}
              onChange={(e) => set("paymentTerms", e.target.value)}
              placeholder="เช่น มัดจำ 30% ที่เหลือก่อนส่ง"
              autoComplete="off"
            />
          </Field>

          <Field label="โน้ต" optional htmlFor="s-note">
            <Input
              id="s-note"
              value={values.note}
              onChange={(e) => set("note", e.target.value)}
              placeholder="หมายเหตุเพิ่มเติม"
              autoComplete="off"
            />
          </Field>

          {error && (
            <p style={{ color: "var(--color-danger, #dc2626)", fontSize: 14, fontWeight: 600 }}>
              {error}
            </p>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <Button type="submit" size="lg" loading={pending} className="flex-1">
              {isEdit ? "บันทึกการแก้ไข" : "เพิ่มผู้ขาย"}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={pending}>
              ยกเลิก
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};
const modal: React.CSSProperties = {
  background: "#fff",
  borderRadius: 20,
  padding: 24,
  width: "100%",
  maxWidth: 480,
  maxHeight: "90vh",
  overflowY: "auto",
  boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
};
const cellHead: React.CSSProperties = {
  padding: "10px 14px",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};
const cell: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "top",
};
