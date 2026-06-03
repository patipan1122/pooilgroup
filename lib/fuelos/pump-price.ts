import "server-only";

// ราคาหน้าปั๊ม (อ้างอิง) — ใช้ thai-oil-api (JSON สาธารณะ ไม่ต้อง auth · อัปเดตรายวัน)
// แทน PTTOR SOAP ที่ติด auth. source: https://github.com/max180643/thai-oil-api
const ENDPOINT = "https://api.chnwt.dev/thai-oil-api/latest";

const STATION_LABELS: Record<string, string> = {
  ptt: "PTT Station",
  bcp: "บางจาก",
  shell: "Shell",
  esso: "Esso",
  caltex: "Caltex",
  pt: "PT",
  susco: "ซัสโก้",
  ptg: "PTG",
  irpc: "IRPC",
};

export type PumpProduct = { name: string; price: string };
export type PumpStation = { key: string; label: string; products: PumpProduct[] };
export type PumpPriceResult =
  | { ok: true; date: string; note: string; stations: PumpStation[] }
  | { ok: false; error: string };

type ApiResp = {
  status?: string;
  response?: {
    note?: string;
    date?: string;
    stations?: Record<string, Record<string, { name?: string; price?: string }>>;
  };
};

export async function fetchPumpPrices(): Promise<PumpPriceResult> {
  try {
    const res = await fetch(ENDPOINT, { next: { revalidate: 1800 } }); // cache 30 นาที
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = (await res.json()) as ApiResp;
    const raw = j.response?.stations;
    if (j.status !== "success" || !raw) return { ok: false, error: "รูปแบบข้อมูลไม่ตรง" };

    // เรียง PTT ก่อน แล้วตามด้วยปั๊มอื่น
    const order = (k: string) => (k === "ptt" ? 0 : k === "bcp" ? 1 : 2);
    const stations: PumpStation[] = Object.entries(raw)
      .map(([key, prods]) => ({
        key,
        label: STATION_LABELS[key] ?? key.toUpperCase(),
        products: Object.values(prods)
          .filter((p) => p?.name && p?.price)
          .map((p) => ({ name: p.name as string, price: p.price as string })),
      }))
      .filter((s) => s.products.length > 0)
      .sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));

    if (stations.length === 0) return { ok: false, error: "ไม่มีข้อมูลราคา" };
    return { ok: true, date: j.response?.date ?? "", note: j.response?.note ?? "", stations };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
