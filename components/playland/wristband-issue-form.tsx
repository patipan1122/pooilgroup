"use client";

// Cashier: issue a new wristband to a paid member · prints QR · /bigfeature W1
// Flow: search member by code/phone → confirm → POST /api/issue → show QR + print

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { issueWristband } from "@/lib/playland/wristband";
import { CheckCircle2, AlertCircle, ScanFace, Printer, RotateCcw } from "lucide-react";

// Auto-print sticker · opens dedicated popup with thermal-58mm CSS · prints immediately · closes when done.
// Fallback: if popup is blocked, returns false and caller shows manual print button.
function printWristbandSticker(opts: { code: string; memberName: string; nickname: string | null; memberCode: string | null; issuedAt: Date }): boolean {
  const safeName = opts.memberName.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
  const dateStr = opts.issuedAt.toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(opts.code)}&qzone=1&margin=0`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${opts.code}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  @media print { @page { size: 58mm auto; margin: 0; } body { margin: 0; } .sticker { page-break-after: always; } }
  html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, "IBM Plex Sans Thai", sans-serif; }
  .sticker { width: 58mm; padding: 3mm; box-sizing: border-box; text-align: center; color: #000; }
  .sticker img { width: 40mm; height: 40mm; display: block; margin: 0 auto 1mm; }
  .sticker .name { font-size: 11pt; font-weight: 700; line-height: 1.15; word-break: break-word; }
  .sticker .nick { font-size: 9pt; color: #444; }
  .sticker .code { font-family: ui-monospace, "IBM Plex Mono", monospace; font-size: 10pt; font-weight: 700; letter-spacing: 0.05em; margin-top: 1mm; }
  .sticker .meta { font-size: 7.5pt; color: #666; margin-top: 0.5mm; }
  .sticker .brand { font-size: 7pt; color: #888; margin-top: 2mm; letter-spacing: 0.1em; text-transform: uppercase; }
  @media screen { body { background: #eee; padding: 20px; } .sticker { background: white; box-shadow: 0 2px 12px rgba(0,0,0,.15); margin: 0 auto; } .hint { text-align: center; font-family: ui-sans-serif, system-ui; font-size: 12px; color: #555; margin-top: 16px; } }
</style></head><body>
<div class="sticker">
  <img src="${qrUrl}" alt="${opts.code}">
  <div class="name">${safeName}</div>
  ${opts.nickname ? `<div class="nick">${opts.nickname}</div>` : ""}
  <div class="code">${opts.code}</div>
  <div class="meta">${opts.memberCode ?? ""} · ${dateStr}</div>
  <div class="brand">PLAYLAND</div>
</div>
<div class="hint">ถ้าหน้าต่างนี้ไม่ปริ้นอัตโนมัติ · กด Ctrl+P (หรือ Cmd+P)</div>
<script>
  window.addEventListener("load", function(){
    var img = document.querySelector("img");
    function go(){ setTimeout(function(){ window.print(); }, 250); }
    if (img && !img.complete) { img.addEventListener("load", go); img.addEventListener("error", go); }
    else { go(); }
    window.addEventListener("afterprint", function(){ setTimeout(function(){ window.close(); }, 300); });
  });
</script>
</body></html>`;
  const w = window.open("", "_blank", "width=420,height=620");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
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
