"use client";

// ClawHub points & history — balance + expiry countdown + point ledger + refund/redeem
// statuses. Pulls history from /api/clawhub/member {includeHistory:true} (server verifies
// the id_token). Read-only.

import { useEffect, useState } from "react";
import { useClawhub } from "./liff-context";
import {
  CwHeader,
  CwButtonLink,
  CwMembershipCard,
  CwMascot,
  CW_MASCOT,
  formatThaiDate,
} from "./ui";
import type {
  PointHistoryRow,
  RefundHistoryRow,
  RedemptionHistoryRow,
  MemberSummary,
} from "@/lib/clawhub/customer-data";

type Tab = "points" | "refunds" | "rewards";

const POINT_LABEL: Record<PointHistoryRow["kind"], string> = {
  EARN_REFUND: "ได้รับแต้ม (คืนเงิน)",
  REDEEM: "ใช้แลกของ",
  EXPIRE: "แต้มหมดอายุ",
  ADJUST: "ปรับแต้มโดยแอดมิน",
};

const REFUND_BADGE: Record<RefundHistoryRow["status"], { t: string; c: string }> = {
  AUTO_APPROVED: { t: "อนุมัติแล้ว", c: "cw-badge-ok" },
  APPROVED: { t: "อนุมัติแล้ว", c: "cw-badge-ok" },
  PENDING_REVIEW: { t: "รอตรวจสอบ", c: "cw-badge-pending" },
  REJECTED: { t: "ไม่อนุมัติ", c: "cw-badge-danger" },
};

const REDEEM_BADGE: Record<RedemptionHistoryRow["status"], { t: string; c: string }> = {
  PENDING: { t: "รอรับของ", c: "cw-badge-pending" },
  FULFILLED: { t: "รับแล้ว", c: "cw-badge-ok" },
  CANCELLED: { t: "ยกเลิก", c: "cw-badge-danger" },
};

export function PointsScreen() {
  const { member, getIdToken } = useClawhub();
  const [tab, setTab] = useState<Tab>("points");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<MemberSummary | null>(member);
  const [points, setPoints] = useState<PointHistoryRow[]>([]);
  const [refunds, setRefunds] = useState<RefundHistoryRow[]>([]);
  const [rewards, setRewards] = useState<RedemptionHistoryRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const idToken = await getIdToken();
      if (!idToken) {
        if (!cancelled) setLoading(false);
        return;
      }
      const res = await fetch("/api/clawhub/member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, includeHistory: true }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        member?: MemberSummary;
        history?: {
          points: PointHistoryRow[];
          refunds: RefundHistoryRow[];
          redemptions: RedemptionHistoryRow[];
        };
      };
      if (cancelled) return;
      if (json.member) setSummary(json.member);
      if (json.history) {
        setPoints(json.history.points);
        setRefunds(json.history.refunds);
        setRewards(json.history.redemptions);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [getIdToken]);

  return (
    <div className="mx-auto w-full max-w-md pb-10">
      <CwHeader title="แต้ม & ประวัติ" back />

      <div className="px-4">
        <CwMembershipCard
          name={summary?.fullName || summary?.displayName || member?.fullName || ""}
          memberCode={summary?.memberCode ?? member?.memberCode ?? "—"}
          balance={summary?.balance ?? 0}
          expiryAt={summary?.nearestExpiryAt ?? null}
        />
      </div>

      {/* tabs */}
      <div className="mt-4 flex gap-2 px-4">
        {([
          ["points", "แต้ม"],
          ["refunds", "ขอคืน"],
          ["rewards", "แลกของ"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`cw-chip ${tab === k ? "active" : ""}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2 px-4">
        {loading ? (
          <div className="py-10 text-center text-[13px]" style={{ color: "var(--cw-text-3)" }}>
            กำลังโหลดประวัติ...
          </div>
        ) : tab === "points" ? (
          points.length === 0 ? (
            <Empty text="ยังไม่มีรายการแต้ม" sub="ขอคืนแต้มจากตู้ที่มีปัญหาเพื่อเริ่มสะสม" />
          ) : (
            points.map((p) => (
              <Row
                key={p.id}
                title={POINT_LABEL[p.kind]}
                sub={formatThaiDate(p.createdAt)}
                amount={`${p.delta > 0 ? "+" : ""}${p.delta.toLocaleString("th-TH")}`}
                positive={p.delta > 0}
              />
            ))
          )
        ) : tab === "refunds" ? (
          refunds.length === 0 ? (
            <Empty text="ยังไม่มีคำขอคืนแต้ม" sub="ตู้มีปัญหา? ถ่ายรูปจอแล้วขอคืนแต้มได้เลย" />
          ) : (
            refunds.map((r) => {
              const b = REFUND_BADGE[r.status];
              return (
                <div key={r.id} className="cw-card flex items-center justify-between p-3.5">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: "var(--cw-text)" }}>
                      หยอด {r.claimedBaht.toLocaleString("th-TH")} บาท
                      {r.machineCode ? ` · ${r.machineCode}` : ""}
                    </div>
                    <div className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
                      {formatThaiDate(r.createdAt)}
                      {r.pointsAwarded > 0 ? ` · +${r.pointsAwarded} แต้ม` : ""}
                    </div>
                  </div>
                  <span className={`cw-badge ${b.c}`}>{b.t}</span>
                </div>
              );
            })
          )
        ) : rewards.length === 0 ? (
          <Empty text="ยังไม่เคยแลกของ" sub="ใช้แต้มแลกตุ๊กตาน่ารัก ๆ ได้ที่เมนูแลกตุ๊กตา" />
        ) : (
          rewards.map((r) => {
            const b = REDEEM_BADGE[r.status];
            return (
              <div key={r.id} className="cw-card flex items-center justify-between p-3.5">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-semibold" style={{ color: "var(--cw-text)" }}>
                    {r.productName ?? "ตุ๊กตา"}
                  </div>
                  <div className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
                    {formatThaiDate(r.createdAt)} · -{r.pointsSpent} แต้ม · รหัส {r.pickupCode}
                  </div>
                </div>
                <span className={`cw-badge ${b.c}`}>{b.t}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 px-4">
        <CwButtonLink href="/liff/clawhub?screen=home" variant="ghost">
          กลับหน้าหลัก
        </CwButtonLink>
      </div>
    </div>
  );
}

function Row({
  title,
  sub,
  amount,
  positive,
}: {
  title: string;
  sub: string;
  amount: string;
  positive: boolean;
}) {
  return (
    <div className="cw-card flex items-center justify-between p-3.5">
      <div className="min-w-0">
        <div className="text-[14px] font-semibold" style={{ color: "var(--cw-text)" }}>
          {title}
        </div>
        <div className="text-[12px]" style={{ color: "var(--cw-text-3)" }}>
          {sub}
        </div>
      </div>
      <div
        className="cw-tnum text-[16px] font-extrabold"
        style={{ color: positive ? "var(--cw-ok)" : "var(--cw-text-2)" }}
      >
        {amount}
      </div>
    </div>
  );
}

function Empty({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <CwMascot src={CW_MASCOT.babyDragon} alt="มังกรน้อย JOLLY PLAY" size={104} />
      <div className="text-[14px] font-bold" style={{ color: "var(--cw-text-2)" }}>
        {text}
      </div>
      {sub ? (
        <div className="max-w-[16rem] text-[12.5px]" style={{ color: "var(--cw-text-3)" }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}
