"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkInSession } from "@/lib/playland/actions";
import { thb } from "@/lib/playland/format";
import { LogIn } from "lucide-react";

const PAY = [
  { v: "CASH", label: "เงินสด" },
  { v: "PROMPTPAY", label: "PromptPay" },
  { v: "STRIPE", label: "บัตร" },
  { v: "CHARGE_TO_MEMBER", label: "บิล" },
] as const;

export function CheckinExistingButton({
  branchId, memberId, memberName, packages,
}: {
  branchId: string;
  memberId: string;
  memberName: string;
  packages: Array<{ id: string; name: string; price: number; minutes: number; type: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [pkgId, setPkgId] = useState(packages[0]?.id ?? "");
  const [pay, setPay] = useState<(typeof PAY)[number]["v"]>("CASH");

  function doCheckin() {
    if (!pkgId) return;
    start(async () => {
      const res = await checkInSession({ branchId, memberId, packageId: pkgId, paymentMethod: pay });
      if (!res.ok) alert(res.error);
      else { setOpen(false); router.push("/playland"); }
    });
  }

  if (!open) {
    return (
      <button className="pl-btn pl-btn-primary" style={{ width: "100%" }} onClick={() => setOpen(true)}>
        <LogIn size={14} /> Check-in {memberName} เข้าร้าน
      </button>
    );
  }
  return (
    <div className="pl-card" style={{ background: "var(--pl-brand-soft)" }}>
      <div className="pl-eyebrow" style={{ marginBottom: 6 }}>Check-in {memberName}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 4, marginBottom: 8 }}>
        {packages.map((p) => (
          <button
            key={p.id}
            type="button"
            className="pl-card"
            style={{
              padding: 8, fontSize: 12, textAlign: "left", cursor: "pointer",
              border: pkgId === p.id ? "2px solid var(--pl-brand)" : "1px solid var(--pl-line)",
              background: pkgId === p.id ? "white" : "var(--pl-paper)",
            }}
            onClick={() => setPkgId(p.id)}
          >
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--pl-brand-dark)" }}>{thb(p.price)}</div>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {PAY.map((m) => (
          <button key={m.v} type="button" className="pl-btn pl-btn-sm" onClick={() => setPay(m.v)} style={pay === m.v ? { background: "var(--pl-info)", color: "white", borderColor: "var(--pl-info)" } : {}}>{m.label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" className="pl-btn" onClick={() => setOpen(false)}>ยกเลิก</button>
        <button type="button" className="pl-btn pl-btn-primary" onClick={doCheckin} disabled={pending} style={{ flex: 1 }}>
          {pending ? "..." : "Confirm Check-in"}
        </button>
      </div>
    </div>
  );
}
