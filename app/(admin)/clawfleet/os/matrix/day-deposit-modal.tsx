"use client";

/**
 * DayDepositModal — popup ที่โผล่เมื่อกด "ช่องรวมวันนั้น" (คอลัมน์ขวาสุดของแถววัน) ในรายงานเจาะสาขา.
 * ตอบคำถาม Pinpoint 6pt #1: "วันนี้เก็บเงินไปแล้ว ฝากธนาคารรึยัง ขอดูสลิปหน่อย".
 *
 * 1 วันไม่ใช่ 1 สถานะเสมอ — อาจมีพร้อมกันทั้ง:
 *   - บางรอบวันนี้ "ยังไม่ฝาก" (ค้างมือ) → แบนเนอร์เตือนด้านบน
 *   - บางรอบ "ฝากแล้ว" — อาจคนละใบฝากก็ได้ (แยกทริปธนาคาร/ฝากรวมหลายวัน) → การ์ด "ดูสลิป" ทีละใบ
 * reuse lightbox pattern เดียวกับหน้าประวัติฝาก (deposits-client.tsx :402-413 / :1115-1126) — ไม่ประดิษฐ์โมดัลใหม่.
 */

import { useState } from "react";
import { ImageIcon, Loader2, AlertTriangle } from "lucide-react";
import { Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { baht } from "@/components/clawfleet/os/format";
import type { DayDepositEntry } from "@/lib/clawfleet/matrix-queries";

/** ISO → "12 ต.ค. 2569 · 09:42 น." */
function fmtDepositedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const date = d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} · ${time} น.`;
}

export function DayDepositModal({
  open,
  onClose,
  title,
  sub,
  loading,
  deposits,
  undepositedCount,
  undepositedCents,
  hasActivity,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  loading: boolean;
  deposits: DayDepositEntry[];
  undepositedCount: number;
  undepositedCents: number;
  /** มีรอบเก็บ/ยอดตั้งต้นของวันนี้เลยไหม — false = วันนั้นไม่มีกิจกรรมอะไรเลย (edge case: วันที่ไม่มีการเก็บ) */
  hasActivity: boolean;
}) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const nothingAtAll = !loading && !hasActivity;

  return (
    <>
      <Modal open={open} onClose={onClose} title={title || "สถานะฝากเงิน"} sub={sub} width={520}>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxHeight: "70vh", overflow: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "40px 0", color: "#8A90A0", fontSize: 13 }}>
              <Loader2 size={18} style={{ animation: "cf-dd-spin 0.8s linear infinite" }} /> กำลังโหลด…
              <style>{"@keyframes cf-dd-spin{to{transform:rotate(360deg)}}"}</style>
            </div>
          ) : nothingAtAll ? (
            <EmptyState
              icon={<ImageIcon size={26} />}
              title="ไม่มีการเก็บเงินในวันนี้"
              sub="ยังไม่มีรอบเก็บ/ยอดตั้งต้นของวันนี้ที่สาขานี้ — ไม่มีอะไรให้ฝากธนาคาร"
            />
          ) : (
            <>
              {undepositedCount > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #F4CFCF",
                    background: "#FDECEC",
                    borderRadius: 12,
                    padding: "12px 14px",
                  }}
                >
                  <AlertTriangle size={18} color="#C0392B" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#C0392B" }}>
                      ยังไม่ฝาก {undepositedCount} รอบ
                    </div>
                    <div style={{ fontSize: 12, color: "#8A5555" }}>
                      รวม {baht(undepositedCents)} — เงินค้างมือ ยังไม่ถูกนำเข้าธนาคาร
                    </div>
                  </div>
                </div>
              )}

              {deposits.map((d) => (
                <div
                  key={d.depositId}
                  style={{
                    border: "1px solid #E8EAED",
                    borderRadius: 12,
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1A1D21" }}>{d.depositCode}</div>
                    <div style={{ fontSize: 11.5, color: "#8A90A0", marginTop: 2 }}>{fmtDepositedAt(d.depositedAt)}</div>
                    <div style={{ fontSize: 12, color: "#5A6270", marginTop: 4 }}>
                      ครอบรอบวันนี้ {d.sessionsThisDay} รอบ · {baht(d.coveredCentsThisDay)}
                    </div>
                  </div>
                  {d.slipPhotoUrl ? (
                    <button
                      type="button"
                      onClick={() => setLightbox(d.slipPhotoUrl)}
                      className="co-tap"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#4F46E5",
                        background: "#EEF0FE",
                        border: "1px solid #D9DBFB",
                        padding: "6px 12px",
                        borderRadius: 9,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      <ImageIcon size={13} /> ดูสลิป
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, color: "#AEB4BD", flexShrink: 0, whiteSpace: "nowrap" }}>ไม่มีสลิป</span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </Modal>

      {/* lightbox สลิป — mirror app/(admin)/clawfleet/os/deposits/deposits-client.tsx :402-413 */}
      <Modal open={lightbox !== null} onClose={() => setLightbox(null)} title="สลิปการฝากเงิน" width={620}>
        <div style={{ padding: 16, display: "flex", justifyContent: "center", background: "#111318" }}>
          {lightbox && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox}
              alt="สลิปการฝากเงิน"
              style={{ maxWidth: "100%", maxHeight: "72vh", borderRadius: 10, display: "block" }}
            />
          )}
        </div>
      </Modal>
    </>
  );
}
