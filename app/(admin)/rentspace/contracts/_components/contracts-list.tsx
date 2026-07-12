"use client";

// รายการสัญญา + ค้นหา + กรองสถานะ (client-side · instant) — CEO ขอ
import { useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Search } from "lucide-react";
import { RsCard, RsBadge, RsMobileCard, RsField } from "@/components/rentspace/ui";

export type ContractRow = {
  id: string;
  contractNo: string;
  unitCode: string;
  unitName: string | null;
  tenantName: string;
  rentText: string;
  rangeText: string;
  status: string; // raw
  showStatus: string; // display (expiring คำนวณแล้ว)
  tenantSigned: boolean;
  editPending: boolean;
};

// ชิปกรอง — key = showStatus · label จาก CONTRACT_STATUS
const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "ทั้งหมด" },
  { key: "active", label: "ใช้งาน" },
  { key: "expiring", label: "ใกล้หมดอายุ" },
  { key: "expired", label: "หมดอายุ" },
  { key: "draft", label: "ร่าง" },
  { key: "terminated", label: "ยกเลิก" },
];

export function ContractsList({ rows }: { rows: ContractRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  // นับต่อสถานะ (โชว์บนชิป)
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: rows.length };
    for (const r of rows) m[r.showStatus] = (m[r.showStatus] ?? 0) + 1;
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.showStatus !== status) return false;
      if (!query) return true;
      return [r.contractNo, r.unitCode, r.unitName, r.tenantName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [rows, q, status]);

  return (
    <div className="space-y-3">
      {/* ค้นหา + ชิปกรอง */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--rs-text-3)" }} />
          <input
            className="w-full h-10 pl-9 pr-3 rounded-lg text-[14px]"
            style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)", color: "var(--rs-text)" }}
            placeholder="ค้นหา เลขที่สัญญา / ห้อง / ผู้เช่า"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const active = status === f.key;
            const n = counts[f.key] ?? 0;
            if (f.key !== "all" && n === 0) return null; // ซ่อนชิปที่ไม่มีข้อมูล
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatus(f.key)}
                className="text-[12.5px] font-medium px-2.5 py-1.5 rounded-lg transition whitespace-nowrap"
                style={{
                  background: active ? "var(--rs-brand)" : "var(--rs-bg-2)",
                  color: active ? "#fff" : "var(--rs-text-2)",
                  border: `1px solid ${active ? "var(--rs-brand)" : "var(--rs-border)"}`,
                }}
              >
                {f.label} {n > 0 && <span className="tabular-nums opacity-80">({n})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-10" style={{ color: "var(--rs-text-3)" }}>
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-60" />
          <p className="text-[13.5px]">ไม่พบสัญญาที่ตรงกับการค้นหา</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <RsCard className="overflow-hidden hidden lg:block">
            <div className="overflow-x-auto">
              <table className="rs-table w-full text-sm">
                <thead>
                  <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                    <th className="px-4 py-2.5 font-semibold">เลขที่สัญญา</th>
                    <th className="px-4 py-2.5 font-semibold">ห้อง</th>
                    <th className="px-4 py-2.5 font-semibold">ผู้เช่า</th>
                    <th className="px-4 py-2.5 font-semibold text-right">ค่าเช่า/เดือน</th>
                    <th className="px-4 py-2.5 font-semibold">ระยะสัญญา</th>
                    <th className="px-4 py-2.5 font-semibold">สถานะ</th>
                    <th className="px-4 py-2.5 font-semibold text-center">เซ็นแล้ว</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-[var(--rs-bg-2)] transition" style={{ borderColor: "var(--rs-border)" }}>
                      <td className="px-4 py-3">
                        <Link href={`/rentspace/contracts/${c.id}`} className="font-semibold inline-flex items-center gap-1.5" style={{ color: "var(--rs-brand)" }}>
                          <FileText className="h-3.5 w-3.5" /> {c.contractNo}
                        </Link>
                        {c.editPending && (
                          <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}>
                            รอแก้ไข
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>
                        {c.unitCode}
                        {c.unitName ? <span style={{ color: "var(--rs-text-3)" }}> · {c.unitName}</span> : null}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>{c.tenantName}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--rs-text)" }}>{c.rentText}</td>
                      <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>{c.rangeText}</td>
                      <td className="px-4 py-3"><RsBadge kind="contract" status={c.showStatus} /></td>
                      <td className="px-4 py-3 text-center">
                        {c.tenantSigned ? <span style={{ color: "var(--rs-ok)" }} className="font-bold">✓</span> : <span style={{ color: "var(--rs-text-3)" }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RsCard>

          {/* Mobile cards */}
          <div className="space-y-2 lg:hidden">
            {filtered.map((c) => (
              <RsMobileCard
                key={c.id}
                href={`/rentspace/contracts/${c.id}`}
                title={
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5 flex-wrap">
                      <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--rs-brand)" }} />
                      <span className="truncate">{c.contractNo}</span>
                      {c.editPending && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--rs-pending-soft)", color: "var(--rs-pending)" }}>
                          รอแก้ไข
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[12px] font-normal" style={{ color: "var(--rs-text-3)" }}>
                      {c.unitCode}
                      {c.unitName ? ` · ${c.unitName}` : ""}
                    </div>
                  </div>
                }
                titleRight={<RsBadge kind="contract" status={c.showStatus} />}
              >
                <RsField label="ผู้เช่า" value={c.tenantName} />
                <RsField label="ค่าเช่า/เดือน" value={c.rentText} align="right" />
                <RsField label="ระยะสัญญา" value={c.rangeText} full />
                <RsField label="เซ็นแล้ว" value={c.tenantSigned ? "✓ เซ็นแล้ว" : "ยังไม่เซ็น"} tone={c.tenantSigned ? "ok" : "muted"} />
              </RsMobileCard>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
