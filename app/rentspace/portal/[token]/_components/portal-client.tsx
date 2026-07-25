"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Megaphone,
  FolderOpen,
  Upload,
  CheckCircle2,
  Clock,
  MessageCircle,
  Mail,
  ExternalLink,
} from "lucide-react";
import { BILL_STATUS, periodLabel } from "@/lib/rentspace/format";
import { actPortalSubmitSlip, actPortalSaveEmail } from "../_actions";

type Bill = {
  id: string;
  billNo: string;
  period: string;
  status: string;
  dueDate: string;
  total: number;
  paid: number;
  unitCode: string;
  projectName: string;
  publicToken: string | null;
  pendingSlip: boolean;
};
type Ann = { id: string; title: string; body: string; pinned: boolean; publishedAt: string; attachmentUrls: string[] };
type Doc = { id: string; label: string; url: string; createdAt: string };

const baht = (n: number) => "฿" + n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const dateTH = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });

export function PortalClient({
  token,
  tenantName,
  bills,
  announcements,
  documents,
  lineLinked,
  email: email0,
  emailOptIn: optIn0,
  lineNotice,
}: {
  token: string;
  tenantName: string;
  bills: Bill[];
  announcements: Ann[];
  documents: Doc[];
  lineLinked: boolean;
  email: string;
  emailOptIn: boolean;
  lineNotice: { kind: "ok" | "err" | "info"; text: string } | null;
}) {
  const [tab, setTab] = useState<"bills" | "news" | "docs">("bills");
  const [notice, setNotice] = useState(lineNotice);
  const outstanding = bills.reduce((s, b) => s + Math.max(0, b.total - b.paid), 0);

  return (
    <div className="rs-scope min-h-screen pb-16" style={{ background: "var(--rs-bg-2)" }}>
      {/* header */}
      <div
        className="px-5 py-5 text-white"
        style={{ background: "linear-gradient(135deg, var(--rs-brand), var(--rs-navy))" }}
      >
        <div className="max-w-xl mx-auto">
          <div className="text-[12px] opacity-90">พื้นที่เช่า · ใบแจ้งหนี้ของคุณ</div>
          <h1 className="text-xl font-bold mt-0.5">{tenantName}</h1>
          {outstanding > 0 ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-[13px]">
              ยอดค้างชำระรวม <b>{baht(outstanding)}</b>
            </div>
          ) : (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-[13px]">
              <CheckCircle2 className="h-4 w-4" /> ไม่มียอดค้าง
            </div>
          )}
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-4 space-y-4">
        {/* ผลการเชื่อม LINE */}
        {notice && (
          <div
            className="rounded-lg px-3.5 py-2.5 text-[13px] flex items-center justify-between gap-2"
            style={
              notice.kind === "ok"
                ? { background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }
                : notice.kind === "err"
                  ? { background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }
                  : { background: "var(--rs-info-soft)", color: "var(--rs-info)" }
            }
          >
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100 text-[16px] leading-none">×</button>
          </div>
        )}

        {/* รับแจ้งเตือน: LINE + อีเมล */}
        <NotifyCard token={token} lineLinked={lineLinked} email0={email0} optIn0={optIn0} />

        {/* tabs */}
        <div className="flex gap-1.5">
          <TabBtn active={tab === "bills"} onClick={() => setTab("bills")} icon={<FileText className="h-4 w-4" />} label={`บิล (${bills.length})`} />
          <TabBtn active={tab === "news"} onClick={() => setTab("news")} icon={<Megaphone className="h-4 w-4" />} label={`ข่าว (${announcements.length})`} />
          <TabBtn active={tab === "docs"} onClick={() => setTab("docs")} icon={<FolderOpen className="h-4 w-4" />} label={`เอกสาร (${documents.length})`} />
        </div>

        {tab === "bills" &&
          (bills.length === 0 ? (
            <Empty text="ยังไม่มีใบแจ้งหนี้" />
          ) : (
            <div className="space-y-2.5">
              {bills.map((b) => (
                <BillCard key={b.id} token={token} bill={b} />
              ))}
            </div>
          ))}

        {tab === "news" &&
          (announcements.length === 0 ? (
            <Empty text="ยังไม่มีข่าวสาร" />
          ) : (
            <div className="space-y-2.5">
              {announcements.map((a) => (
                <div key={a.id} className="rs-card p-4">
                  <div className="flex items-center gap-2">
                    {a.pinned && <span className="rs-chip" style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}>ปักหมุด</span>}
                    <h3 className="font-semibold text-[15px]">{a.title}</h3>
                  </div>
                  <div className="text-[11px] rs-text-2 mt-0.5">{dateTH(a.publishedAt)}</div>
                  <p className="text-[13.5px] rs-text mt-2 whitespace-pre-wrap leading-relaxed">{a.body}</p>
                  {a.attachmentUrls.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {a.attachmentUrls.map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="rs-btn-ghost text-[12px] inline-flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5" /> ไฟล์แนบ {i + 1}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

        {tab === "docs" &&
          (documents.length === 0 ? (
            <Empty text="ยังไม่มีเอกสาร" />
          ) : (
            <div className="space-y-2">
              {documents.map((d) => (
                <a key={d.id} href={d.url} target="_blank" rel="noreferrer" className="rs-card p-3.5 flex items-center gap-3 hover:opacity-90">
                  <FileText className="h-5 w-5 shrink-0" style={{ color: "var(--rs-brand)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium truncate">{d.label}</div>
                    <div className="text-[11px] rs-text-2">{dateTH(d.createdAt)}</div>
                  </div>
                  <ExternalLink className="h-4 w-4 rs-text-2" />
                </a>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-[13px] font-medium transition"
      style={
        active
          ? { background: "var(--rs-brand)", color: "#fff" }
          : { background: "var(--rs-bg)", color: "var(--rs-text-2)", border: "1px solid var(--rs-border)" }
      }
    >
      {icon}
      {label}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rs-card p-8 text-center text-[13px] rs-text-2">{text}</div>;
}

function BillCard({ token, bill }: { token: string; bill: Bill }) {
  const [open, setOpen] = useState(false);
  const st = BILL_STATUS[bill.status] ?? { label: bill.status, color: "var(--rs-text-2)", soft: "var(--rs-bg-2)" };
  const outstanding = Math.max(0, bill.total - bill.paid);
  const canPay = bill.status !== "void" && outstanding > 0;

  return (
    <div className="rs-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rs-chip" style={{ background: st.soft, color: st.color }}>{st.label}</span>
            {bill.pendingSlip && (
              <span className="rs-chip inline-flex items-center gap-1" style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}>
                <Clock className="h-3 w-3" /> รอตรวจสลิป
              </span>
            )}
          </div>
          <div className="text-[15px] font-semibold mt-1.5">งวด {periodLabel(bill.period)}</div>
          <div className="text-[11.5px] rs-text-2">
            บิล {bill.billNo}
            {bill.unitCode ? ` · ห้อง ${bill.unitCode}` : ""} · ครบกำหนด {dateTH(bill.dueDate)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[17px] font-bold">{baht(outstanding > 0 ? outstanding : bill.total)}</div>
          <div className="text-[10.5px] rs-text-2">{outstanding > 0 ? "ค้างชำระ" : "ยอดรวม"}</div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        {bill.publicToken && (
          <a
            href={`/rentspace/bill/${bill.publicToken}`}
            target="_blank"
            rel="noreferrer"
            className="rs-btn-ghost flex-1 inline-flex items-center justify-center gap-1.5 text-[13px]"
          >
            <FileText className="h-4 w-4" /> ดูใบแจ้งหนี้
          </a>
        )}
        {canPay && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rs-btn flex-1 inline-flex items-center justify-center gap-1.5 text-[13px]"
            style={{ background: "var(--rs-brand)", color: "#fff" }}
          >
            <Upload className="h-4 w-4" /> แจ้งชำระเงิน
          </button>
        )}
      </div>

      {open && canPay && <PayPanel token={token} bill={bill} outstanding={outstanding} onDone={() => setOpen(false)} />}
    </div>
  );
}

function PayPanel({ token, bill, outstanding, onDone }: { token: string; bill: Bill; outstanding: number; onDone: () => void }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(outstanding));
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [slip, setSlip] = useState<{ dataUrl: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    // อ่านไฟล์จาก FileList ให้เสร็จก่อนล้าง value (FileList เป็น live · จะว่างทันทีถ้าล้างก่อน)
    const files = Array.from(e.target.files ?? []);
    const f = files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      setErr("ไฟล์ใหญ่เกิน 8MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSlip({ dataUrl: String(reader.result), name: f.name });
    reader.readAsDataURL(f);
  }

  async function submit() {
    setErr("");
    if (!slip) {
      setErr("กรุณาแนบสลิปโอนเงิน");
      return;
    }
    const amt = Number(amount);
    if (!(amt > 0)) {
      setErr("จำนวนเงินต้องมากกว่า 0");
      return;
    }
    setBusy(true);
    try {
      await actPortalSubmitSlip({ token, billId: bill.id, amountThb: amt, paidOn, slipDataUrl: slip.dataUrl, note });
      setDone(true);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ส่งไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="mt-3 rounded-lg p-3 text-[13px] flex items-center gap-2" style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}>
        <CheckCircle2 className="h-4 w-4" /> ส่งแล้ว! เจ้าหน้าที่จะตรวจสอบสลิปและยืนยันให้ครับ
      </div>
    );

  return (
    <div className="mt-3 rounded-lg p-3 space-y-2.5" style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[12px] rs-text-2">
          จำนวนเงินที่โอน
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-md px-2.5 py-2 text-[14px]"
            style={{ background: "var(--rs-bg)", border: "1px solid var(--rs-border)", color: "var(--rs-text)" }}
          />
        </label>
        <label className="text-[12px] rs-text-2">
          วันที่โอน
          <input
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
            className="mt-1 w-full rounded-md px-2.5 py-2 text-[14px]"
            style={{ background: "var(--rs-bg)", border: "1px solid var(--rs-border)", color: "var(--rs-text)" }}
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[12px] rs-text-2">สลิปโอนเงิน (รูปหรือ PDF)</span>
        <div className="mt-1 flex items-center gap-2">
          <label className="rs-btn-ghost inline-flex items-center gap-1.5 text-[13px] cursor-pointer">
            <Upload className="h-4 w-4" /> เลือกไฟล์
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={pickFile} />
          </label>
          {slip && <span className="text-[12px] rs-text truncate">{slip.name}</span>}
        </div>
      </label>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="หมายเหตุ (ถ้ามี)"
        className="w-full rounded-md px-2.5 py-2 text-[13px]"
        style={{ background: "var(--rs-bg)", border: "1px solid var(--rs-border)", color: "var(--rs-text)" }}
      />

      {err && <div className="text-[12px]" style={{ color: "var(--rs-danger)" }}>{err}</div>}

      <div className="flex gap-2">
        <button onClick={onDone} className="rs-btn-ghost flex-1 text-[13px]">ยกเลิก</button>
        <button
          onClick={submit}
          disabled={busy}
          className="rs-btn flex-1 text-[13px] disabled:opacity-60"
          style={{ background: "var(--rs-brand)", color: "#fff" }}
        >
          {busy ? "กำลังส่ง…" : "ส่งแจ้งชำระ"}
        </button>
      </div>
    </div>
  );
}

function NotifyCard({ token, lineLinked, email0, optIn0 }: { token: string; lineLinked: boolean; email0: string; optIn0: boolean }) {
  const [email, setEmail] = useState(email0);
  const [optIn, setOptIn] = useState(optIn0);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    setBusy(true);
    try {
      await actPortalSaveEmail({ token, email, optIn });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rs-card p-4 space-y-3">
      <div className="text-[13px] font-semibold">รับแจ้งเตือนเมื่อมีบิลใหม่</div>

      {/* LINE */}
      <div className="flex items-center gap-2.5">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#06C755" }}>
          <MessageCircle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium">LINE</div>
          <div className="text-[11px] rs-text-2">เด้งเตือนทันทีที่วางบิล</div>
        </div>
        {lineLinked ? (
          <span className="rs-chip inline-flex items-center gap-1" style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}>
            <CheckCircle2 className="h-3.5 w-3.5" /> เชื่อมแล้ว
          </span>
        ) : (
          <a href={`/rentspace/line/start?token=${token}`} className="rs-btn text-[12.5px]" style={{ background: "#06C755", color: "#fff" }}>
            เชื่อม LINE
          </a>
        )}
      </div>

      {/* Email */}
      <div className="flex items-start gap-2.5">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--rs-brand)" }}>
          <Mail className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-medium">อีเมล</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="กรอกอีเมลเพื่อรับบิล"
            className="mt-1 w-full rounded-md px-2.5 py-1.5 text-[13px]"
            style={{ background: "var(--rs-bg)", border: "1px solid var(--rs-border)", color: "var(--rs-text)" }}
          />
          <label className="mt-1.5 flex items-center gap-1.5 text-[12px] rs-text-2 cursor-pointer">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
            ส่งใบแจ้งหนี้เข้าอีเมลนี้
          </label>
          {err && <div className="text-[11px] mt-1" style={{ color: "var(--rs-danger)" }}>{err}</div>}
        </div>
        <button onClick={save} disabled={busy} className="rs-btn-ghost text-[12.5px] shrink-0 disabled:opacity-60">
          {saved ? "บันทึกแล้ว" : busy ? "…" : "บันทึก"}
        </button>
      </div>
    </div>
  );
}
