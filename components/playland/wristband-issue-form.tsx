"use client";

// Cashier: issue a new wristband to a paid member · prints QR · /bigfeature W1
// Flow: search member by code/phone → confirm → POST /api/issue → show QR + print

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { issueWristband } from "@/lib/playland/wristband";
import { printWristband } from "@/components/playland/print-wristband";
import { CheckCircle2, AlertCircle, ScanFace, Printer, RotateCcw } from "lucide-react";

// Auto-print sticker · shared thermal-58mm helper · prints immediately · closes when done.
// Fallback: if popup is blocked, returns false and caller shows manual print button.
function printWristbandSticker(opts: { code: string; memberName: string; nickname: string | null; memberCode: string | null; issuedAt: Date }): boolean {
  return printWristband({
    code: opts.code,
    memberName: opts.memberName,
    nickname: opts.nickname,
    memberCode: opts.memberCode,
    issuedAt: opts.issuedAt,
  });
}

interface Member {
  id: string;
  name: string;
  nickname: string | null;
  memberCode: string | null;
  type: string;
  phone: string | null;
  photoR2Path: string | null;
}

export function WristbandIssueForm({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Member | null>(null);
  const [issued, setIssued] = useState<{ code: string; member: Member; issuedAt: Date } | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [autoPrintFailed, setAutoPrintFailed] = useState(false);
  const printedFor = useRef<string | null>(null);

  // Auto-print fires once per newly-issued code
  useEffect(() => {
    if (!issued) return;
    if (printedFor.current === issued.code) return;
    printedFor.current = issued.code;
    const ok = printWristbandSticker({
      code: issued.code,
      memberName: issued.member.name,
      nickname: issued.member.nickname,
      memberCode: issued.member.memberCode,
      issuedAt: issued.issuedAt,
    });
    setAutoPrintFailed(!ok);
  }, [issued]);

  function reprint() {
    if (!issued) return;
    const ok = printWristbandSticker({
      code: issued.code,
      memberName: issued.member.name,
      nickname: issued.member.nickname,
      memberCode: issued.member.memberCode,
      issuedAt: issued.issuedAt,
    });
    setAutoPrintFailed(!ok);
  }

  async function search() {
    if (query.trim().length < 2) return;
    try {
      const res = await fetch(`/api/playland/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      if (data.ok) {
        // Fetch full member detail for each (need photoR2Path)
        setMembers(data.members.map((m: { id: string; name: string; phone: string | null; memberCode: string | null }) => ({
          ...m, nickname: null, type: "KID", photoR2Path: null,
        })));
      }
    } catch (e) {
      console.error(e);
    }
  }

  function doIssue() {
    if (!selected) return;
    start(async () => {
      const res = await issueWristband({ branchId, memberId: selected.id });
      if (!res.ok) { setMsg({ kind: "err", text: res.error }); return; }
      setIssued({ code: res.data.code, member: selected, issuedAt: new Date() });
      setMsg(null);
      router.refresh();
    });
  }

  function reset() {
    setIssued(null);
    setSelected(null);
    setQuery("");
    setMembers([]);
    setMsg(null);
    setAutoPrintFailed(false);
    printedFor.current = null;
  }

  // ── ISSUED state · show QR + print ──────────────────────────────
  if (issued) {
    return (
      <div className="pl-card" style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--pl-ok)", fontWeight: 600 }}>
          <CheckCircle2 size={18} /> ออก wristband สำเร็จ
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 20, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="pl-eyebrow">ผูกให้</div>
            <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.4rem", fontWeight: 600 }}>
              {issued.member.name} {issued.member.nickname && <span style={{ color: "var(--pl-text-muted)" }}>· {issued.member.nickname}</span>}
            </div>
            <div style={{ fontSize: 13, color: "var(--pl-text-muted)", fontFamily: "var(--pl-font-mono)" }}>
              {issued.member.memberCode ?? "—"} · {issued.member.phone ?? "—"}
            </div>
            <div className="pl-divider" />
            <div className="pl-eyebrow">QR Code</div>
            <div style={{ fontFamily: "var(--pl-font-mono)", fontSize: "1.8rem", fontWeight: 700, letterSpacing: "0.06em", color: "var(--pl-brand-dark)" }}>
              {issued.code}
            </div>
            <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>
              เขียนหรือพิมพ์ลงบนสายรัด · ลูกค้าเอาไปสแกนที่ gate เพื่อเปิดประตู
            </div>
          </div>

          {/* QR display · use QR.io free render via img · cashier can also use printer */}
          <div style={{ background: "white", padding: 12, borderRadius: 12, border: "1px solid var(--pl-line)", textAlign: "center" }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(issued.code)}&qzone=1`}
              alt={`QR: ${issued.code}`}
              width={240}
              height={240}
              style={{ width: 240, height: 240, display: "block" }}
            />
            <div style={{ marginTop: 6, fontSize: 11, fontFamily: "var(--pl-font-mono)", color: "var(--pl-text-muted)" }}>{issued.code}</div>
          </div>
        </div>

        {autoPrintFailed && (
          <div className="pl-card" style={{ background: "var(--pl-danger-soft)", color: "var(--pl-danger-ink)", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
            <AlertCircle size={16} />
            <span>browser block popup · กดปุ่ม "พิมพ์ sticker" ด้านล่าง · ครั้งต่อไป allow popup ของ site นี้</span>
          </div>
        )}
        {!autoPrintFailed && (
          <div style={{ fontSize: 12, color: "var(--pl-text-muted)", display: "flex", gap: 6, alignItems: "center" }}>
            <Printer size={12} /> sticker ถูกส่งไปเครื่องปริ้นแล้ว · ถ้าไม่ออก กดพิมพ์อีกครั้ง
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" className="pl-btn" onClick={reprint}>
            <Printer size={14} /> พิมพ์ sticker {autoPrintFailed ? "" : "อีกครั้ง"}
          </button>
          <button type="button" className="pl-btn pl-btn-primary" onClick={reset}>
            <RotateCcw size={14} /> ออก wristband อีก
          </button>
        </div>
      </div>
    );
  }

  // ── Search + select state ──────────────────────────────
  return (
    <div className="pl-card" style={{ display: "grid", gap: 14 }}>
      {msg && (
        <div className="pl-card" style={{
          background: msg.kind === "ok" ? "var(--pl-ok-soft)" : "var(--pl-danger-soft)",
          color: msg.kind === "ok" ? "var(--pl-ok-ink)" : "var(--pl-danger-ink)",
          display: "flex", gap: 8, alignItems: "center", fontSize: 14,
        }}>
          {msg.kind === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}{msg.text}
        </div>
      )}

      <div>
        <label className="pl-label">ค้นหาสมาชิก (ชื่อ · เบอร์ · code)</label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="pl-input"
            placeholder="เช่น น้องเอ · 0812345678 · PM-..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
            autoFocus
          />
          <button type="button" className="pl-btn" onClick={search}>ค้นหา</button>
        </div>
      </div>

      {members.length > 0 && !selected && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="pl-eyebrow">เลือกสมาชิกเพื่อออก wristband</div>
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className="pl-card pl-card-hover"
              onClick={() => setSelected(m)}
              style={{ textAlign: "left", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: 12, color: "var(--pl-text-muted)" }}>{m.memberCode ?? "—"} · {m.phone ?? "—"}</div>
              </div>
              <span className="pl-chip pl-chip-brand">{m.type}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="pl-card pl-card-accent">
          <div className="pl-eyebrow">ยืนยันออก wristband ให้</div>
          <div style={{ fontFamily: "var(--pl-font-display)", fontSize: "1.4rem", fontWeight: 600, marginTop: 4 }}>{selected.name}</div>
          <div style={{ fontSize: 12, color: "var(--pl-text-muted)", marginTop: 2 }}>{selected.memberCode ?? "—"}</div>
          <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <button type="button" className="pl-btn pl-btn-primary" onClick={doIssue} disabled={pending}>
              <ScanFace size={14} /> {pending ? "กำลังออก..." : "ออก wristband"}
            </button>
            <button type="button" className="pl-btn" onClick={() => setSelected(null)} disabled={pending}>
              เลือกใหม่
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
