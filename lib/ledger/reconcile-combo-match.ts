// LedgerLine — N:1 combination matching (2-3 bank lines summing to one book entry).
// Pure (no DB) — used by autoMatchAccountAction (_actions.ts) AFTER the 1:1 pass has
// already failed to match a book entry. Reuses the SAME concept/date-window/tolerance
// rules as 1:1 matching (reconcile-match-keywords.ts) — a combined sum does NOT get a
// looser tolerance just because it's a sum of N bank lines.
//
// Why this exists (CEO case, 2026-08-13): Café Amazon KBANK ****1657 — TRCloud/POS QR
// settlement sometimes lands as TWO separate bank txns the same day (e.g. ฿135.00 +
// ฿4,505.00 = ฿4,640.00, verified exact-to-the-satang across 8+ real August days) —
// never as one combined line. The old auto-matcher only ever tried 1 bank : 1 book, so
// those days never auto-matched even though the money is genuinely there.
//
// Safety rules (money-matching — a false-positive match is worse than a missed one):
//   - try pairs (2 lines) first; only try triples (3 lines) if NO pair combo is found
//   - if MORE THAN ONE valid combo exists at a given size → ambiguous → return null
//     (do not guess — leave it for manual matching)
//   - never combine more than 3 lines (avoid combinatorial blow-up on a busy account)
//   - candidate list capped at MAX_COMBO_CANDIDATES — past that, skip N:1 for this
//     book entry entirely rather than doing an expensive/speculative search

import { bankNameMatches, amountToleranceSatang, type MatchConcept } from "./reconcile-match-keywords";

export interface ComboBankCandidate {
  id: string;
  amountSatang: number;
  dateMs: number; // epoch ms of the bank txn date
  text: string; // lowercase ref2+description+channel — same shape as autoMatchAccountAction's bk.text
}

// เพดานกัน combinatorial blow-up บนบัญชียุ่ง — เกินนี้ = ข้าม N:1 ให้บรรทัดนี้ (ปล่อยจับมือ)
export const MAX_COMBO_CANDIDATES = 25;

/**
 * หา "ชุดรวม" รายการธนาคาร 2 หรือ 3 รายการที่ผลรวมตรงกับ book entry เดียว ภายใต้กฎเดียวกับ
 * การจับคู่ 1:1 ทุกอย่าง (concept ต้องตรง/อยู่ในหน้าต่างวัน/ผลรวมอยู่ใน tolerance เดิม)
 * คืน null ถ้าไม่เจอ หรือเจอมากกว่า 1 ชุดที่ตรง (กำกวม → ไม่จับ ให้จับคู่มือแทน)
 */
export function findBankCombo(
  bookAmountSatang: number,
  bookDateMs: number,
  concept: MatchConcept,
  bankCandidates: ComboBankCandidate[],
  extraKeywords: string[] = [],
): { ids: string[] } | null {
  const filtered = bankCandidates.filter((bk) => {
    if (bookAmountSatang >= 0 !== bk.amountSatang >= 0) return false; // ต้องเป็นด้านเดียวกัน (เงินเข้า↔รายได้)
    if (!bankNameMatches(concept, bk.text, extraKeywords)) return false; // ชื่อไม่ตรง concept = ข้าม
    const dateDiff = Math.abs((bk.dateMs - bookDateMs) / 86400000);
    if (dateDiff > concept.dateWindowDays) return false; // นอกหน้าต่างวันของ concept นี้
    return true;
  });
  if (filtered.length < 2 || filtered.length > MAX_COMBO_CANDIDATES) return null;

  const tol = amountToleranceSatang(concept, bookAmountSatang);

  const pairs: string[][] = [];
  for (let i = 0; i < filtered.length; i++) {
    for (let j = i + 1; j < filtered.length; j++) {
      const sum = filtered[i].amountSatang + filtered[j].amountSatang;
      if (Math.abs(sum - bookAmountSatang) <= tol) pairs.push([filtered[i].id, filtered[j].id]);
    }
  }
  if (pairs.length === 1) return { ids: pairs[0] };
  if (pairs.length > 1) return null; // กำกวม — เจอมากกว่า 1 คู่ที่ตรง → ไม่จับ

  // ไม่เจอคู่เลย → ลองรวม 3 รายการ
  const triples: string[][] = [];
  for (let i = 0; i < filtered.length; i++) {
    for (let j = i + 1; j < filtered.length; j++) {
      for (let k = j + 1; k < filtered.length; k++) {
        const sum = filtered[i].amountSatang + filtered[j].amountSatang + filtered[k].amountSatang;
        if (Math.abs(sum - bookAmountSatang) <= tol)
          triples.push([filtered[i].id, filtered[j].id, filtered[k].id]);
      }
    }
  }
  if (triples.length === 1) return { ids: triples[0] };
  return null; // 0 หรือมากกว่า 1 ชุด = ไม่จับ
}
