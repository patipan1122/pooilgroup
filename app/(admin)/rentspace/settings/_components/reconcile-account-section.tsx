"use client";

// ส่งบิลที่ "จ่ายครบ" เข้าคิว reconcile ของ LedgerLine — ตั้งค่าบริษัท/บัญชีธนาคาร
// ที่เงินเข้าจริงครั้งเดียว แล้วกดส่งทั้งโครงการทีเดียว (CEO 2026-08-17 เลือกแบบ
// bulk แทนส่งทีละบิล). Pattern เดียวกับ ChairOps "ส่งเข้าบัญชี reconcile".
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { actSaveReconcileAccountConfig, actSendBillsToReconcile } from "../../_actions";
import type { CompanyOpt, BankAccountOpt } from "@/lib/cashhub/amazon-settlement-data";
import type { ProjectReconcileSummary } from "@/lib/rentspace/ledger-push";

const fmtBaht = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ReconcileAccountSection({
  projectId,
  companies,
  bankAccounts,
  currentCompanyId,
  currentBankAccountId,
  summary,
}: {
  projectId: string;
  companies: CompanyOpt[];
  bankAccounts: BankAccountOpt[];
  currentCompanyId: string | null;
  currentBankAccountId: string | null;
  summary: ProjectReconcileSummary;
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(currentCompanyId ?? "");
  const [bankAccountId, setBankAccountId] = useState(currentBankAccountId ?? "");
  const [savingConfig, startSaveConfig] = useTransition();
  const [sending, startSend] = useTransition();

  function saveConfig() {
    if (!companyId || !bankAccountId) {
      toast.error("กรุณาเลือกบริษัทและบัญชีธนาคารให้ครบ");
      return;
    }
    startSaveConfig(async () => {
      try {
        await actSaveReconcileAccountConfig({ projectId, companyId, bankAccountId });
        toast.success("บันทึกการตั้งค่าแล้ว");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      }
    });
  }

  function send() {
    startSend(async () => {
      try {
        const r = await actSendBillsToReconcile(projectId);
        toast.success(`ส่งเข้าบัญชีแล้ว ${r.inserted} ใบ${r.alreadySent ? ` · ข้าม ${r.alreadySent} ใบ (ส่งไปแล้ว)` : ""}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ส่งไม่สำเร็จ");
      }
    });
  }

  return (
    <div className="rs-card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-bold" style={{ color: "var(--rs-text)" }}>
          ส่งเข้าบัญชี LedgerLine
        </h2>
        <span className="rs-chip">bank-recon</span>
      </div>
      <p className="mb-3.5 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
        ตั้งค่าว่ายอดบิลที่จ่ายครบของโครงการนี้เข้าบริษัท/บัญชีธนาคารไหน แล้วกดส่งทั้งโครงการทีเดียวเข้าคิวกระทบยอด —
        สถานะ &quot;จับคู่แล้ว&quot; ไปดูต่อที่หน้าบัญชี (LedgerLine bank-recon) · กดส่งซ้ำได้ตลอด ระบบข้ามรายการที่ส่งแล้วให้อัตโนมัติ
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rc-company" className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--rs-text-2)" }}>
            บริษัทที่เงินเข้า
          </label>
          <select
            id="rc-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rs-input w-full"
          >
            <option value="" disabled>เลือกบริษัท…</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="rc-bank" className="mb-1 block text-[12px] font-semibold" style={{ color: "var(--rs-text-2)" }}>
            บัญชีธนาคารที่เงินเข้า
          </label>
          <select
            id="rc-bank"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="rs-input w-full"
          >
            <option value="" disabled>เลือกบัญชี…</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" onClick={saveConfig} disabled={savingConfig} className="rs-btn-ghost mt-3 w-full justify-center">
        {savingConfig ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
      </button>

      <div className="mt-4 border-t pt-3.5" style={{ borderColor: "var(--rs-border)" }}>
        {summary.configured ? (
          <>
            <p className="mb-2.5 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
              พร้อมส่ง <strong style={{ color: "var(--rs-text)" }}>{summary.readyCount}</strong> ใบ · ยอดรวม{" "}
              <strong className="tabular-nums" style={{ color: "var(--rs-text)" }}>{fmtBaht(summary.readyAmountBaht)} ฿</strong>
            </p>
            <button
              type="button"
              onClick={send}
              disabled={sending || summary.readyCount === 0}
              className="rs-btn w-full justify-center"
            >
              <Send className="h-4 w-4" /> {sending ? "กำลังส่ง…" : "ส่งเข้าบัญชี LedgerLine"}
            </button>
          </>
        ) : (
          <p className="text-[12.5px]" style={{ color: "var(--rs-danger)" }}>
            ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคาร — ตั้งค่าด้านบนก่อนถึงจะส่งได้
          </p>
        )}
      </div>
    </div>
  );
}
