"use client";

import { useState, useTransition, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Check, PenLine, Download, X, Pencil, Trash2, Paperclip, FileText, Upload } from "lucide-react";
import {
  actGenerateSignLink,
  actTerminateContract,
  actRecordDeposit,
  actUploadFile,
  actUpdateContractBilling,
  actRequestContractEdit,
  actDecideContractEdit,
  actDeleteContract,
  actAddContractDocument,
  actDeleteContractDocument,
} from "../../../_actions";
import { periodLabel } from "@/lib/rentspace/format";
import { redlineHtml, redlineCounts } from "@/lib/rentspace/redline";

/** จำนวนเดือนนับรวมปลายทาง · ผิดลำดับ = 0 */
function monthsInclusive(startPeriod: string, endPeriod: string): number {
  if (!startPeriod || !endPeriod) return 0;
  const [ys, ms] = startPeriod.split("-").map(Number);
  const [ye, me] = endPeriod.split("-").map(Number);
  if (!ys || !ms || !ye || !me) return 0;
  const diff = (ye - ys) * 12 + (me - ms);
  return diff >= 0 ? diff + 1 : 0;
}
/** งวด + n เดือน (YYYY-MM) */
function addPeriodStr(period: string, add: number): string {
  if (!period) return "";
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return "";
  const d = new Date(y, m - 1 + add, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const LATE_FEE_OPTIONS: Record<string, string> = {
  none: "ไม่คิดค่าปรับ",
  fixed: "คงที่ (บาท)",
  percent_total: "% ของยอดบิล",
  per_day: "ต่อวัน (บาท/วัน)",
};

const DEPOSIT_KINDS: Record<string, string> = {
  collect: "รับเงินประกัน",
  refund: "คืนเงินประกัน",
  deduct: "หักจากประกัน",
  forfeit: "ยึดประกัน",
};

function num(v: string): number {
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ───────── sign link ─────────
export function SignLinkBox({
  contractId,
  origin,
  initialToken,
}: {
  contractId: string;
  origin: string;
  initialToken: string | null;
}) {
  const [token, setToken] = useState(initialToken);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const url = token ? `${origin}/sign/rentspace/${token}` : "";

  function gen() {
    start(async () => {
      try {
        const r = await actGenerateSignLink(contractId);
        setToken(r.token);
        toast.success("สร้างลิงก์เซ็นสัญญาแล้ว");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "สร้างลิงก์ไม่สำเร็จ");
      }
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("คัดลอกลิงก์แล้ว");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("คัดลอกไม่สำเร็จ");
    }
  }

  if (!token) {
    return (
      <button className="rs-btn" onClick={gen} disabled={pending}>
        <PenLine className="h-4 w-4" /> {pending ? "กำลังสร้าง…" : "สร้างลิงก์เซ็นสัญญาออนไลน์"}
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 h-10 px-3 rounded-lg text-[13px] tabular-nums"
          style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)", color: "var(--rs-text)" }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button className="rs-btn rs-btn-ghost" onClick={copy}>
          {copied ? <Check className="h-4 w-4" style={{ color: "var(--rs-ok)" }} /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <button className="text-[12.5px] font-medium" style={{ color: "var(--rs-brand)" }} onClick={gen} disabled={pending}>
        สร้างลิงก์ใหม่ (ลิงก์เดิมจะใช้ไม่ได้)
      </button>
    </div>
  );
}

// ───────── print ─────────
export function PrintButton() {
  return (
    <button className="rs-btn rs-btn-ghost" onClick={() => window.print()}>
      <Download className="h-4 w-4" /> ดาวน์โหลด / พิมพ์ PDF
    </button>
  );
}

// ───────── terminate ─────────
export function TerminateButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    if (!confirm("ยืนยันยกเลิกสัญญานี้? ห้องจะกลับเป็นสถานะว่าง")) return;
    start(async () => {
      try {
        await actTerminateContract(contractId);
        toast.success("ยกเลิกสัญญาแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ");
      }
    });
  }
  return (
    <button
      className="rs-btn rs-btn-ghost"
      style={{ color: "var(--rs-danger)" }}
      onClick={go}
      disabled={pending}
    >
      ยกเลิกสัญญา
    </button>
  );
}

// ───────── #11/#3/#9c แก้เงื่อนไขการเรียกเก็บ (ค่าปรับรายคน · ส่วนลดโปรฯ · วันวางบิล) ─────────
export function BillingTermsEditor({
  contractId,
  initial,
}: {
  contractId: string;
  initial: {
    lateFeeType: "none" | "fixed" | "percent_total" | "per_day";
    lateFeeValue: number;
    lateFeeGraceDays: number;
    promoDiscountThb: number;
    promoMonths: number;
    promoStartPeriod: string | null;
    billIssueDay: number | null;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [lateFeeType, setLateFeeType] = useState(initial.lateFeeType);
  const [lateFeeValue, setLateFeeValue] = useState(initial.lateFeeValue ? String(initial.lateFeeValue) : "");
  const [graceDays, setGraceDays] = useState(String(initial.lateFeeGraceDays ?? 7));
  const [promo, setPromo] = useState(initial.promoDiscountThb ? String(initial.promoDiscountThb) : "");
  const [promoStart, setPromoStart] = useState(initial.promoStartPeriod || "");
  const [promoEnd, setPromoEnd] = useState(
    initial.promoStartPeriod && initial.promoMonths
      ? addPeriodStr(initial.promoStartPeriod, initial.promoMonths - 1)
      : "",
  );
  const [issueDay, setIssueDay] = useState(initial.billIssueDay ? String(initial.billIssueDay) : "");
  const promoMonthsCount = monthsInclusive(promoStart, promoEnd);

  function save() {
    if (num(promo) > 0 && promoMonthsCount <= 0) {
      toast.error("กรุณาเลือกช่วงเดือนส่วนลด (เดือนเริ่มต้องไม่เกินเดือนสิ้นสุด)");
      return;
    }
    start(async () => {
      try {
        await actUpdateContractBilling({
          contractId,
          lateFeeType,
          lateFeeValue: num(lateFeeValue),
          lateFeeGraceDays: Number(graceDays) || 0,
          promoDiscountThb: num(promo),
          promoMonths: num(promo) > 0 ? promoMonthsCount : 0,
          promoStartPeriod: num(promo) > 0 && promoStart ? promoStart : undefined,
          billIssueDay: issueDay ? Number(issueDay) : null,
        });
        toast.success("บันทึกเงื่อนไขแล้ว — มีผลกับบิลรอบถัดไป");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  if (!open) {
    return (
      <button className="rs-btn rs-btn-ghost w-full" onClick={() => setOpen(true)}>
        ตั้งค่าปรับ / ส่วนลด / วันวางบิล (รายคน)
      </button>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 10px",
    borderRadius: 10,
    border: "1px solid var(--rs-border)",
    background: "var(--rs-bg-2)",
    color: "var(--rs-text)",
    fontSize: 14,
  };
  const lbl = "block text-[12px] font-semibold mb-1";

  return (
    <div className="space-y-2.5">
      <div className="text-[13px] font-bold" style={{ color: "var(--rs-text)" }}>
        เงื่อนไขการเรียกเก็บ (เฉพาะผู้เช่ารายนี้)
      </div>
      <div>
        <label className={lbl} style={{ color: "var(--rs-text-2)" }}>ค่าปรับล่าช้า</label>
        <select style={inputStyle} value={lateFeeType} onChange={(e) => setLateFeeType(e.target.value as typeof lateFeeType)}>
          {Object.entries(LATE_FEE_OPTIONS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      {lateFeeType !== "none" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={lbl} style={{ color: "var(--rs-text-2)" }}>มูลค่าค่าปรับ</label>
            <input inputMode="decimal" style={inputStyle} value={lateFeeValue} onChange={(e) => setLateFeeValue(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className={lbl} style={{ color: "var(--rs-text-2)" }}>ผ่อนผัน (วัน)</label>
            <input type="number" min={0} style={inputStyle} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
          </div>
        </div>
      )}
      <div>
        <label className={lbl} style={{ color: "var(--rs-text-2)" }}>ส่วนลด/เดือน (บาท)</label>
        <input inputMode="decimal" style={inputStyle} value={promo} onChange={(e) => setPromo(e.target.value)} placeholder="0" />
      </div>
      {num(promo) > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl} style={{ color: "var(--rs-text-2)" }}>เริ่มลด (เดือน)</label>
              <input type="month" style={inputStyle} value={promoStart} onChange={(e) => setPromoStart(e.target.value)} />
            </div>
            <div>
              <label className={lbl} style={{ color: "var(--rs-text-2)" }}>ลดถึงเดือน</label>
              <input type="month" style={inputStyle} value={promoEnd} min={promoStart || undefined} onChange={(e) => setPromoEnd(e.target.value)} />
            </div>
          </div>
          {promoMonthsCount > 0 ? (
            <div className="text-[12px] rounded-lg px-2.5 py-1.5" style={{ background: "var(--rs-brand-50)", color: "var(--rs-brand)" }}>
              ลด ฿{baht(num(promo))}/เดือน · {periodLabel(promoStart)}
              {promoMonthsCount > 1 ? ` – ${periodLabel(promoEnd)}` : ""} ({promoMonthsCount} เดือน) · รวม ฿{baht(num(promo) * promoMonthsCount)}
            </div>
          ) : (
            <div className="text-[12px]" style={{ color: "var(--rs-danger)" }}>
              เลือกช่วงเดือน (เดือนเริ่มต้องไม่เกินเดือนสิ้นสุด)
            </div>
          )}
          <div className="text-[11px]" style={{ color: "var(--rs-text-2)" }}>
            ส่วนลดจะใช้กับบิลในช่วงเดือนที่เลือก ไม่ย้อนงวดเก่าที่ออกบิลไปแล้ว
          </div>
        </>
      )}
      <div>
        <label className={lbl} style={{ color: "var(--rs-text-2)" }}>วันวางบิล (1-28 · เว้นว่าง = ตามโครงการ)</label>
        <input type="number" min={1} max={28} style={inputStyle} value={issueDay} onChange={(e) => setIssueDay(e.target.value)} placeholder="ตามโครงการ" />
      </div>
      <div className="flex gap-2 pt-1">
        <button className="rs-btn flex-1 justify-center" onClick={save} disabled={pending}>
          {pending ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button className="rs-btn rs-btn-ghost" onClick={() => setOpen(false)} disabled={pending}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

// ───────── record deposit ─────────
export function RecordDepositButton({
  contractId,
  unpaidBills = [],
}: {
  contractId: string;
  /** บิลค้างของสัญญานี้ (ให้ "หัก/ริบ" เลือกตัดยอดบิลได้) */
  unpaidBills?: { id: string; billNo: string; period: string; remaining: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<"collect" | "refund" | "deduct" | "forfeit">("collect");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState("transfer");
  const [note, setNote] = useState("");
  const [targetBillId, setTargetBillId] = useState("");
  const showBillPicker = kind === "deduct" || kind === "forfeit";

  function submit() {
    if (num(amount) <= 0) return toast.error("กรุณากรอกจำนวนเงิน");
    start(async () => {
      try {
        let slipUrl: string | undefined;
        const f = fileRef.current?.files?.[0];
        if (f) {
          const dataUrl = await fileToDataUrl(f);
          const up = await actUploadFile({ sub: "deposit-slip", dataUrl });
          slipUrl = up.url;
        }
        await actRecordDeposit({
          contractId,
          kind,
          amountThb: num(amount),
          occurredOn,
          method,
          slipUrl,
          note: note || undefined,
          targetBillId: showBillPicker && targetBillId ? targetBillId : undefined,
        });
        toast.success("บันทึกเงินประกันแล้ว");
        setOpen(false);
        setAmount("");
        setNote("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      <button className="rs-btn rs-btn-ghost" onClick={() => setOpen(true)}>
        บันทึกเงินประกัน
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 print:hidden"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-md rounded-b-none sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--rs-border)" }}
            >
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                บันทึกเงินประกัน
              </div>
              <button onClick={() => setOpen(false)} disabled={pending} className="p-1 rounded-lg hover:bg-black/5">
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  ประเภท
                </label>
                <select className="rs-d-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  {Object.entries(DEPOSIT_KINDS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              {showBillPicker && (
                <div>
                  <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                    ตัดยอดบิลค้าง (ไม่บังคับ)
                  </label>
                  <select className="rs-d-input" value={targetBillId} onChange={(e) => setTargetBillId(e.target.value)}>
                    <option value="">— ไม่ผูกบิล (หักลอย) —</option>
                    {unpaidBills.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.billNo} · งวด {b.period} · ค้าง {b.remaining.toLocaleString("th-TH")} ฿
                      </option>
                    ))}
                  </select>
                  <p className="text-[11.5px] mt-1" style={{ color: "var(--rs-text-3)" }}>
                    เลือกบิล = ระบบตัดยอดบิลนั้นให้ด้วย (บันทึกการชำระจากเงินประกัน)
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                    จำนวนเงิน (บาท)
                  </label>
                  <input inputMode="decimal" className="rs-d-input" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                    วันที่
                  </label>
                  <input type="date" className="rs-d-input" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  วิธีรับ/จ่าย
                </label>
                <select className="rs-d-input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">เงินสด</option>
                  <option value="transfer">โอน</option>
                  <option value="qr">QR / พร้อมเพย์</option>
                  <option value="card">บัตร</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  สลิป (ไม่บังคับ)
                </label>
                <input ref={fileRef} type="file" accept="image/*,application/pdf" className="text-[13px]" />
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  หมายเหตุ
                </label>
                <textarea className="rs-d-input min-h-[56px]" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
              <button className="rs-btn rs-btn-ghost flex-1" disabled={pending} onClick={() => setOpen(false)}>
                ยกเลิก
              </button>
              <button className="rs-btn flex-1" disabled={pending} onClick={submit}>
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`
        :global(.rs-d-input) {
          width: 100%;
          height: 42px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          font-size: 14px;
        }
        :global(textarea.rs-d-input) {
          height: auto;
          padding: 10px 12px;
        }
        :global(.rs-d-input:focus) {
          outline: none;
          border-color: var(--rs-brand);
          background: #fff;
        }
      `}</style>
    </>
  );
}

// ───────── แก้ไขสัญญา (maker-checker) — เลียนแบบ "ขอยกเลิกบิล" ─────────
// flow: เซ็นแล้ว → ขอแก้ไข → อีกคนอนุมัติ → กดแก้ไขเพื่อออกฉบับแก้ไข (เซ็นใหม่)
export function ContractEditRequest({
  contractId,
  tenantSigned,
  editStatus,
  editRequestReason,
  editDecisionNote,
  currentBodyHtml,
  proposedBodyHtml,
}: {
  contractId: string;
  tenantSigned: boolean;
  editStatus: "none" | "pending" | "approved" | "rejected";
  editRequestReason?: string | null;
  editDecisionNote?: string | null;
  /** เนื้อสัญญาปัจจุบัน (resolved) — ตั้งต้นในกล่องแก้ + ฐานเทียบ redline */
  currentBodyHtml: string;
  /** ข้อความที่พนักงานขอแก้ (รออนุมัติ) — null = ยังไม่มี proposal */
  proposedBodyHtml: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false); // โมดัลขอแก้ไข
  const [body, setBody] = useState(currentBodyHtml); // เนื้อสัญญาเต็มที่กำลังแก้
  const [reason, setReason] = useState(""); // เหตุผลที่ขอแก้
  const [decideNote, setDecideNote] = useState(""); // หมายเหตุอนุมัติ/ปฏิเสธ (ไม่บังคับ)

  // redline — คำนวณเฉพาะตอน pending + มี proposal (LCS อาจหนักถ้าเอกสารยาว → memo กันคิดซ้ำตอนพิมพ์หมายเหตุ)
  const diffHtml = useMemo(
    () => (editStatus === "pending" && proposedBodyHtml ? redlineHtml(currentBodyHtml, proposedBodyHtml) : ""),
    [editStatus, currentBodyHtml, proposedBodyHtml],
  );
  const counts = useMemo(
    () =>
      editStatus === "pending" && proposedBodyHtml
        ? redlineCounts(currentBodyHtml, proposedBodyHtml)
        : { added: 0, removed: 0 },
    [editStatus, currentBodyHtml, proposedBodyHtml],
  );

  // ยังไม่เซ็น → แก้ได้เลย ไม่ต้องขออนุมัติ (ปุ่มแก้ไขอยู่ที่ ContractEditButton บนหน้า)
  if (!tenantSigned) return null;

  function openRequest() {
    setBody(currentBodyHtml); // รีเซ็ตเป็นเนื้อปัจจุบันทุกครั้งที่เปิด
    setReason("");
    setOpen(true);
  }

  function submitRequest() {
    if (reason.trim().length < 3) {
      toast.error("กรุณาระบุเหตุผลที่ต้องแก้ไขสัญญา");
      return;
    }
    if (!body.trim()) {
      toast.error("เนื้อสัญญาว่างไม่ได้");
      return;
    }
    start(async () => {
      try {
        await actRequestContractEdit(contractId, reason.trim(), body);
        toast.success("ส่งคำขอแก้ไขแล้ว — รอแอดมินอีกคนรีวิวส่วนที่แก้และอนุมัติ");
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ส่งคำขอไม่สำเร็จ");
      }
    });
  }

  function decide(decision: "approve" | "reject") {
    if (
      decision === "approve" &&
      !confirm("ยืนยันอนุมัติ? ระบบจะนำข้อความที่ขอแก้ไปใช้ ออกฉบับแก้ไข และผู้เช่าต้องเซ็นใหม่")
    )
      return;
    start(async () => {
      try {
        await actDecideContractEdit(contractId, decision, decideNote.trim() || undefined);
        if (decision === "approve") {
          toast.success("อนุมัติแล้ว — นำข้อความใหม่ไปใช้ · ผู้เช่าต้องเซ็นสัญญาใหม่");
        } else {
          toast.success("ปฏิเสธคำขอแก้ไขแล้ว");
        }
        setDecideNote("");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
      }
    });
  }

  return (
    <>
      {/* pending → ฝั่งแอดมินรีวิว redline + อนุมัติ/ปฏิเสธ (checker ≠ requester บังคับฝั่ง server) */}
      {editStatus === "pending" ? (
        <div className="space-y-2.5">
          <div
            className="rounded-xl px-3 py-2.5 text-[12.5px]"
            style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}
          >
            <div className="font-semibold">รออนุมัติแก้ไขสัญญา</div>
            {editRequestReason && <div className="mt-0.5">เหตุผล: {editRequestReason}</div>}
          </div>

          {proposedBodyHtml && (
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="text-[12.5px] font-semibold" style={{ color: "var(--rs-text)" }}>
                  สิ่งที่ลูกค้าขอแก้ (แดง=ลบ · เขียว=เพิ่ม)
                </div>
                <div className="text-[11.5px] flex-shrink-0" style={{ color: "var(--rs-text-3)" }}>
                  เพิ่ม {counts.added} คำ · ลบ {counts.removed} คำ
                </div>
              </div>
              <div
                className="rounded-xl px-3 py-2.5 overflow-y-auto"
                style={{ maxHeight: 320, border: "1px solid var(--rs-border)", background: "#fff" }}
                dangerouslySetInnerHTML={{ __html: diffHtml }}
              />
            </div>
          )}

          <div>
            <label className="block text-[12px] font-semibold mb-1" style={{ color: "var(--rs-text-2)" }}>
              หมายเหตุ (ไม่บังคับ)
            </label>
            <textarea
              className="rs-edit-input"
              style={{ minHeight: 52 }}
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value)}
              placeholder="เช่น เหตุผลที่ไม่อนุมัติ"
            />
          </div>

          <div className="flex gap-2">
            <button className="rs-btn flex-1 min-h-[44px] sm:min-h-0" onClick={() => decide("approve")} disabled={pending}>
              <Check className="h-4 w-4" /> อนุมัติ
            </button>
            <button
              className="rs-btn rs-btn-ghost flex-1 min-h-[44px] sm:min-h-0"
              style={{ color: "var(--rs-danger)" }}
              onClick={() => decide("reject")}
              disabled={pending}
            >
              <X className="h-4 w-4" /> ปฏิเสธ
            </button>
          </div>
          <p className="text-[11px]" style={{ color: "var(--rs-text-3)" }}>
            ผู้อนุมัติต้องเป็นแอดมินคนละคนกับผู้ขอ (กันการอนุมัติเอง) · อนุมัติแล้วจะนำข้อความใหม่ไปใช้และผู้เช่าต้องเซ็นใหม่
          </p>
        </div>
      ) : editStatus === "approved" ? (
        // approved → แบนเนอร์ชวนกดแก้ไข
        <div
          className="rounded-xl px-3 py-2.5 text-[12.5px]"
          style={{ background: "var(--rs-ok-soft)", color: "var(--rs-ok)" }}
        >
          <div className="font-semibold">อนุมัติแล้ว — กดปุ่ม “แก้ไขสัญญา” เพื่อออกฉบับแก้ไข</div>
          <div className="mt-0.5">เมื่อบันทึก ระบบจะออกฉบับแก้ไขและผู้เช่าต้องเซ็นใหม่</div>
        </div>
      ) : editStatus === "rejected" ? (
        // rejected → แบนเนอร์ + ขอใหม่ได้
        <div className="space-y-2">
          <div
            className="rounded-xl px-3 py-2.5 text-[12.5px]"
            style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
          >
            <div className="font-semibold">คำขอแก้ไขถูกปฏิเสธ</div>
            {editDecisionNote && <div className="mt-0.5">หมายเหตุ: {editDecisionNote}</div>}
          </div>
          <button
            className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0"
            onClick={openRequest}
            disabled={pending}
          >
            <Pencil className="h-4 w-4" /> ขอแก้ไขใหม่อีกครั้ง
          </button>
        </div>
      ) : (
        // none → ปุ่มขอแก้ไข
        <button
          className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0"
          onClick={openRequest}
          disabled={pending}
        >
          <Pencil className="h-4 w-4" /> ขอแก้ไขสัญญา
        </button>
      )}

      {/* โมดัลขอแก้ไข — แก้ข้อความสัญญาได้ทุกบรรทัด + เหตุผล */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4 print:hidden"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="rs-card w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] flex flex-col rounded-b-none sm:rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: "var(--rs-border)" }}
            >
              <div className="font-bold text-lg" style={{ color: "var(--rs-text)" }}>
                ขอแก้ไขสัญญา
              </div>
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="p-1 rounded-lg hover:bg-black/5"
                aria-label="ปิด"
              >
                <X className="h-5 w-5" style={{ color: "var(--rs-text-2)" }} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
              <div
                className="rounded-xl px-3 py-2.5 text-[12px]"
                style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}
              >
                แก้ข้อความได้ทุกบรรทัด · เมื่อส่ง แอดมินอีกคนจะเห็นเฉพาะส่วนที่แก้ (redline) ก่อนอนุมัติ · อนุมัติแล้วจะออกฉบับแก้ไขและผู้เช่าต้องเซ็นใหม่
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  แก้ข้อความสัญญา (แก้ได้ทุกบรรทัด)
                </label>
                <textarea
                  className="rs-edit-input font-mono"
                  style={{ minHeight: 300 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  aria-label="ข้อความสัญญาที่ขอแก้"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  เหตุผลที่ขอแก้
                </label>
                <textarea
                  className="rs-edit-input"
                  style={{ minHeight: 56 }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น แก้ค่าเช่าตามที่ตกลงใหม่กับผู้เช่า"
                  aria-label="เหตุผลที่ขอแก้"
                />
              </div>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
              <button className="rs-btn rs-btn-ghost flex-1 justify-center" disabled={pending} onClick={() => setOpen(false)}>
                ยกเลิก
              </button>
              <button className="rs-btn flex-1 justify-center" disabled={pending} onClick={submitRequest}>
                {pending ? "กำลังส่ง…" : "ส่งคำขอแก้ไข"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        :global(.rl-ins) {
          background: #dcfce7;
          color: #166534;
          text-decoration: none;
          border-radius: 2px;
        }
        :global(.rl-del) {
          background: #fee2e2;
          color: #991b1b;
          text-decoration: line-through;
          border-radius: 2px;
        }
        :global(.rl-diff) {
          line-height: 1.9;
          font-size: 13.5px;
        }
        :global(.rs-edit-input) {
          width: 100%;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid var(--rs-border);
          background: var(--rs-bg-2);
          color: var(--rs-text);
          font-size: 14px;
          line-height: 1.6;
        }
        :global(.rs-edit-input:focus) {
          outline: none;
          border-color: var(--rs-brand);
          background: #fff;
        }
      `}</style>
    </>
  );
}

// ───────── ลบสัญญา — แสดงเฉพาะเมื่อเปิดสิทธิ์ (กันลบที่มีบิลผ่าน thrown error) ─────────
export function DeleteContractButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function go() {
    if (!confirm("ยืนยันลบสัญญานี้ถาวร?\n(ลบไม่ได้ถ้ามีบิลผูกอยู่ — ให้ใช้ “ยกเลิกสัญญา” แทน)")) return;
    start(async () => {
      try {
        await actDeleteContract(contractId);
        toast.success("ลบสัญญาแล้ว");
        router.push("/rentspace/contracts");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }
  return (
    <button
      className="rs-btn rs-btn-ghost w-full min-h-[44px] sm:min-h-0"
      style={{ color: "var(--rs-danger)" }}
      onClick={go}
      disabled={pending}
    >
      <Trash2 className="h-4 w-4" /> ลบสัญญา
    </button>
  );
}

// ───────── เอกสารแนบประกอบสัญญา (สำเนาบัตร · ทะเบียนพาณิชย์ · เอกสารอื่น) ─────────
type ContractDoc = {
  id: string;
  label: string | null;
  url: string;
  mime: string | null;
  sizeBytes: number | null;
};

function humanSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ContractAttachments({
  contractId,
  documents,
}: {
  contractId: string;
  documents: ContractDoc[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) return toast.error("กรุณาเลือกไฟล์");
    if (f.size > 8 * 1024 * 1024) return toast.error("ไฟล์ใหญ่เกิน 8MB");
    start(async () => {
      try {
        const dataUrl = await fileToDataUrl(f);
        await actAddContractDocument({ contractId, label: label.trim() || undefined, dataUrl });
        toast.success("แนบเอกสารแล้ว");
        setLabel("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "แนบเอกสารไม่สำเร็จ");
      }
    });
  }

  function remove(docId: string) {
    if (!confirm("ยืนยันลบเอกสารแนบนี้?")) return;
    start(async () => {
      try {
        await actDeleteContractDocument(docId);
        toast.success("ลบเอกสารแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4" style={{ color: "var(--rs-brand)" }} />
        <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
          เอกสารแนบประกอบสัญญา
        </h2>
      </div>

      {documents.length === 0 ? (
        <div className="text-center py-6" style={{ color: "var(--rs-text-3)" }}>
          <Paperclip className="h-7 w-7 mx-auto mb-2 opacity-60" />
          <p className="text-[13px]">
            ยังไม่มีเอกสารแนบ — แนบสำเนาบัตรประชาชน ทะเบียนพาณิชย์ หรือเอกสารอื่นได้ที่นี่
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {documents.map((doc) => {
            const isPdf = doc.mime?.includes("pdf");
            return (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)" }}
              >
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 min-w-0 flex-1"
                >
                  <FileText className="h-4 w-4 flex-shrink-0" style={{ color: isPdf ? "var(--rs-danger)" : "var(--rs-brand)" }} />
                  <span className="text-[13px] truncate" style={{ color: "var(--rs-text)" }}>
                    {doc.label || (isPdf ? "เอกสาร PDF" : "เอกสารแนบ")}
                  </span>
                  {doc.sizeBytes ? (
                    <span className="text-[11px] flex-shrink-0" style={{ color: "var(--rs-text-3)" }}>
                      {humanSize(doc.sizeBytes)}
                    </span>
                  ) : null}
                </a>
                <button
                  onClick={() => remove(doc.id)}
                  disabled={pending}
                  className="p-1 rounded-lg hover:bg-black/5 flex-shrink-0"
                  aria-label="ลบเอกสาร"
                >
                  <Trash2 className="h-4 w-4" style={{ color: "var(--rs-danger)" }} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-2 pt-1">
        <input
          className="w-full h-10 px-3 rounded-lg text-[13px]"
          style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)", color: "var(--rs-text)" }}
          placeholder="ชื่อเอกสาร (เช่น สำเนาบัตร ปชช.) — ไม่บังคับ"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          className="text-[13px] w-full"
        />
        <button className="rs-btn w-full justify-center min-h-[44px] sm:min-h-0" onClick={upload} disabled={pending}>
          <Upload className="h-4 w-4" /> {pending ? "กำลังแนบ…" : "แนบเอกสาร"}
        </button>
        <p className="text-[11px]" style={{ color: "var(--rs-text-3)" }}>
          รองรับรูปภาพและ PDF · ไม่เกิน 8MB ต่อไฟล์
        </p>
      </div>
    </div>
  );
}
