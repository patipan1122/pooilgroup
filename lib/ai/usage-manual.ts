// คลังคู่มือการใช้งาน — ดึงสดจาก Google Sheet ที่ CEO แก้ไขเองได้
// ทุก Sheet ต้องแชร์แบบ "ทุกคนที่มีลิงก์ดูได้" (anyone-with-link viewer) ถึงจะอ่านผ่าน export?format=csv ได้
// แคช 10 นาทีในหน่วยความจำ กันยิง Google ถี่เกิน + ตอบเร็ว ถ้าดึงไม่สำเร็จใช้ของแคชเก่าต่อ (ไม่ทำให้ผู้ช่วยใบ้ทั้งระบบ)

interface ManualEntry {
  program: string;
  page: string;
  route: string;
  audience: string;
  whatYouCanDo: string;
  steps: string;
  faq: string;
}

const MANUAL_SHEET_IDS = [
  "1v0rD9IdCeWpyXbSUWpaWcAwMlTvblp0Fxv6v4vWPtG4", // ClawFleet
  "1QDrXp9DYdq69VieX1O70IHSyAPnbchzeCHfyqSk5TUk", // LedgerLine (บัญชี + กระทบยอดธนาคาร)
  "1AmLjqUxnbXWayRkCqacaBa-aQtC5SJKHUXe-UTZ8AEc", // RentSpace
  "1rAKp7VeaNfgPrRr3YA9CAlmQpOG4LIGGTuNv2VUMHII", // CashHub (รายงานเงินสาขา)
  "1sDhQkUntTegSOgOBiND35o5OFHlXleO_U2h0-2n0HsI", // CashHub (ธุรกิจย่อย)
  "1TKLHxuNrHJvc823nb4cOlbDNMRePTQa2N89FPB6AMVA", // DC (หน้างาน)
  "1DEb1LkuE_TTtGWO9ldhTepKvcRy-1gntnnHtCXpm-oM", // DC (สำนักงาน)
];

const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { entries: ManualEntry[]; fetchedAt: number } | null = null;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ข้าม \r ของ CRLF
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchSheetRows(fileId: string): Promise<string[][]> {
  const url = `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return [];
  return parseCsv(await res.text());
}

async function loadManual(): Promise<ManualEntry[]> {
  const sheets = await Promise.all(MANUAL_SHEET_IDS.map(fetchSheetRows));
  const entries: ManualEntry[] = [];
  for (const rows of sheets) {
    for (const r of rows.slice(1)) {
      if (r.length < 7 || !r[2]) continue;
      entries.push({
        program: r[0],
        page: r[1],
        route: r[2],
        audience: r[3],
        whatYouCanDo: r[4],
        steps: r[5],
        faq: r[6],
      });
    }
  }
  return entries;
}

async function getManual(): Promise<ManualEntry[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.entries;
  try {
    const entries = await loadManual();
    if (entries.length > 0) {
      cache = { entries, fetchedAt: Date.now() };
      return entries;
    }
  } catch (err) {
    console.error("[usage-manual] fetch failed", err);
  }
  return cache?.entries ?? [];
}

/** จับคู่ path ปัจจุบันกับหน้าคู่มือที่ route ตรงที่สุด (prefix ยาวสุดชนะ) */
export async function findManualEntry(pathname: string): Promise<ManualEntry | null> {
  const entries = await getManual();
  let best: ManualEntry | null = null;
  let bestLen = 0;
  for (const e of entries) {
    const route = e.route.split(" ")[0]?.trim();
    if (route && pathname.startsWith(route) && route.length > bestLen) {
      best = e;
      bestLen = route.length;
    }
  }
  return best;
}

export function manualEntryToText(e: ManualEntry): string {
  return `โปรแกรม: ${e.program}\nหน้า: ${e.page} (${e.route})\nสำหรับใคร: ${e.audience}\nทำอะไรได้บ้าง: ${e.whatYouCanDo}\nขั้นตอนการใช้งาน: ${e.steps}\nข้อควรระวัง/คำถามที่พบบ่อย: ${e.faq}`;
}
