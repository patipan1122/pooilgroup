// RentSpace — เทียบข้อความสัญญา "ของเดิม ↔ ที่ขอแก้" แบบ redline (track changes)
// คำที่เพิ่ม = <ins class="rl-ins"> (เขียว) · คำที่ลบ = <del class="rl-del"> (แดงขีดฆ่า)
// pure · ไม่มี dependency (Ladder) · ใช้ LCS ระดับคำบนข้อความล้วน (ตัด tag ออกก่อน)

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** ตัด HTML → คำ (รักษาขึ้นบรรทัดของ p/li/div เพื่อไม่ให้คำข้ามข้อปนกัน) */
function toWords(html: string): string[] {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|li|div|h[1-6]|section|tr|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ");
  return text.split(/\s+/).filter((t) => t.length > 0);
}

type Seg = { t: "same" | "del" | "ins"; w: string };

/** สร้าง redline HTML เทียบ oldHtml → newHtml (คืน <div class="rl-diff">…</div>) */
export function redlineHtml(oldHtml: string, newHtml: string): string {
  const a = toWords(oldHtml);
  const b = toWords(newHtml);
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return '<div class="rl-diff"></div>';

  let segs: Seg[];
  // กันงานใหญ่เกิน (LCS = O(n·m)) → ถ้าคำเยอะมากใช้เทียบแบบบล็อก (prefix/suffix ร่วม)
  if ((n + 1) * (m + 1) > 4_000_000) {
    let p = 0;
    while (p < n && p < m && a[p] === b[p]) p++;
    let s = 0;
    while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s++;
    segs = [
      ...a.slice(0, p).map((w): Seg => ({ t: "same", w })),
      ...a.slice(p, n - s).map((w): Seg => ({ t: "del", w })),
      ...b.slice(p, m - s).map((w): Seg => ({ t: "ins", w })),
      ...a.slice(n - s).map((w): Seg => ({ t: "same", w })),
    ];
  } else {
    // LCS DP (backtrack) — dp[i][j] = ความยาว LCS ของ a[i:], b[j:]
    const W = m + 1;
    const dp = new Int32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] =
          a[i] === b[j]
            ? dp[(i + 1) * W + (j + 1)] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
      }
    }
    segs = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        segs.push({ t: "same", w: a[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) {
        segs.push({ t: "del", w: a[i] });
        i++;
      } else {
        segs.push({ t: "ins", w: b[j] });
        j++;
      }
    }
    while (i < n) segs.push({ t: "del", w: a[i++] });
    while (j < m) segs.push({ t: "ins", w: b[j++] });
  }

  // รวมคำติดกันที่คลาสเดียวกันเป็นก้อนเดียว
  let html = "";
  let cur: Seg["t"] | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = esc(buf.join(" "));
    if (cur === "del") html += `<del class="rl-del">${text}</del> `;
    else if (cur === "ins") html += `<ins class="rl-ins">${text}</ins> `;
    else html += `${text} `;
    buf = [];
  };
  for (const s of segs) {
    if (s.t !== cur) {
      flush();
      cur = s.t;
    }
    buf.push(s.w);
  }
  flush();
  return `<div class="rl-diff">${html.trim()}</div>`;
}

/** สรุปจำนวนคำที่เพิ่ม/ลบ (ไว้โชว์ "แก้ +X −Y คำ") */
export function redlineCounts(oldHtml: string, newHtml: string): { added: number; removed: number } {
  const a = toWords(oldHtml);
  const b = toWords(newHtml);
  const setA = new Map<string, number>();
  a.forEach((w) => setA.set(w, (setA.get(w) ?? 0) + 1));
  const setB = new Map<string, number>();
  b.forEach((w) => setB.set(w, (setB.get(w) ?? 0) + 1));
  let added = 0;
  let removed = 0;
  for (const [w, cb] of setB) added += Math.max(0, cb - (setA.get(w) ?? 0));
  for (const [w, ca] of setA) removed += Math.max(0, ca - (setB.get(w) ?? 0));
  return { added, removed };
}
