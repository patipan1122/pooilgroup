// บริษัท/บัญชีธนาคารที่ยอดฝากสาขานี้เข้าจริง + ปุ่มส่งเข้าบัญชี reconcile
// (CEO 2026-08-15). Plain server-rendered forms — เลือก dropdown + กดส่ง
// ไม่มี auto-fill/preview เหมือน write-off ก็เลยไม่ต้อง "use client".

import { saveReconcileAccountConfig, sendDepositsToReconcile } from "../../../reconcile/actions";
import type { CompanyOpt, BankAccountOpt } from "@/lib/cashhub/amazon-settlement-data";
import type { BranchReconcileSummary } from "@/lib/chairops/reconcile/ledger-push";

const fmt = (n: number) => n.toLocaleString("en-US");

export function ReconcileAccountSection({
  branchId,
  companies,
  bankAccounts,
  currentCompanyId,
  currentBankAccountId,
  summary,
}: {
  branchId: string;
  companies: CompanyOpt[];
  bankAccounts: BankAccountOpt[];
  currentCompanyId: string | null;
  currentBankAccountId: string | null;
  summary: BranchReconcileSummary;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 600 }}>ส่งเข้าบัญชี reconcile</h2>
        <span className="chip chip-accent" style={{ fontSize: 11 }}>
          LedgerLine bank-recon
        </span>
      </div>
      <p className="text-3" style={{ fontSize: 12, marginBottom: 14 }}>
        ตั้งค่าว่ายอดฝากสาขานี้เข้าบริษัท/บัญชีธนาคารไหน แล้วกดส่งทั้งสาขาเข้าคิว
        reconcile — สถานะ &quot;จับคู่แล้ว&quot; ไปดูต่อที่หน้าบัญชี (LedgerLine
        bank-recon) · กดส่งซ้ำได้ตลอด ระบบข้ามรายการที่ส่งแล้วให้อัตโนมัติ
      </p>

      <form action={saveReconcileAccountConfig}>
        <input type="hidden" name="branchId" value={branchId} />

        <label
          htmlFor="rc-company"
          className="text-2"
          style={{ display: "block", fontSize: 12, fontWeight: 600 }}
        >
          บริษัทที่เงินเข้า
        </label>
        <select
          id="rc-company"
          name="companyId"
          required
          defaultValue={currentCompanyId ?? ""}
          className="input"
          style={{ margin: "4px 0 12px" }}
        >
          <option value="" disabled>
            เลือกบริษัท…
          </option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <label
          htmlFor="rc-bank"
          className="text-2"
          style={{ display: "block", fontSize: 12, fontWeight: 600 }}
        >
          บัญชีธนาคารที่เงินเข้า
        </label>
        <select
          id="rc-bank"
          name="bankAccountId"
          required
          defaultValue={currentBankAccountId ?? ""}
          className="input"
          style={{ margin: "4px 0 12px" }}
        >
          <option value="" disabled>
            เลือกบัญชี…
          </option>
          {bankAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>

        <button type="submit" className="btn" style={{ width: "100%" }}>
          บันทึกการตั้งค่า
        </button>
      </form>

      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px dashed var(--border)",
        }}
      >
        {summary.configured ? (
          <>
            <p className="text-3" style={{ fontSize: 12.5, marginBottom: 10 }}>
              พร้อมส่ง <strong>{fmt(summary.readyCount)}</strong> ใบ · ยอดรวม{" "}
              <strong className="mono">{fmt(summary.readyAmountBaht)} ฿</strong>
              {summary.pendingReviewCount > 0 && (
                <>
                  {" · "}
                  <span style={{ color: "var(--crit)" }}>
                    {summary.pendingReviewCount} ใบรอตรวจสอบ (ยังไม่ส่ง)
                  </span>
                </>
              )}
            </p>
            <form action={sendDepositsToReconcile}>
              <input type="hidden" name="branchId" value={branchId} />
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={summary.readyCount === 0}
              >
                ส่งเข้าบัญชี reconcile
              </button>
            </form>
          </>
        ) : (
          <p className="text-3" style={{ fontSize: 12.5, color: "var(--crit)" }}>
            ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคาร — ตั้งค่าด้านบนก่อนถึงจะส่งได้
          </p>
        )}
      </div>
    </div>
  );
}
