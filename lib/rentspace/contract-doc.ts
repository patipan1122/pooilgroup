// RentSpace — fill a contract template/custom-terms HTML with the real contract
// data. Placeholders: {{tenantName}} {{unitCode}} {{rentAmount}} {{startDate}}
// {{endDate}} {{depositAmount}} {{projectName}} {{today}}
import { formatBaht, thaiDateLong, toNum, tenantDisplayName } from "@/lib/rentspace/format";

type ContractLike = {
  rentAmountThb: unknown;
  depositAmountThb: unknown;
  startDate: Date | string;
  endDate?: Date | string | null;
  unit: { code: string; name?: string | null };
  tenant: Parameters<typeof tenantDisplayName>[0];
  project: { name: string };
  template?: { bodyHtml: string } | null;
  customTermsHtml?: string | null;
};

export function contractPlaceholders(c: ContractLike): Record<string, string> {
  return {
    tenantName: tenantDisplayName(c.tenant),
    unitCode: c.unit.name ? `${c.unit.code} (${c.unit.name})` : c.unit.code,
    rentAmount: formatBaht(toNum(c.rentAmountThb)),
    startDate: thaiDateLong(c.startDate),
    endDate: c.endDate ? thaiDateLong(c.endDate) : "ไม่มีกำหนด",
    depositAmount: formatBaht(toNum(c.depositAmountThb)),
    projectName: c.project.name,
    today: thaiDateLong(new Date()),
  };
}

/** Replace every {{key}} in the html with its value (global). */
export function fillPlaceholders(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m,
  );
}

/** Resolve the document body for a contract: custom terms > template > fallback. */
export function resolveContractBody(c: ContractLike): string {
  const raw = c.customTermsHtml?.trim() || c.template?.bodyHtml?.trim() || "";
  if (!raw) return "";
  return fillPlaceholders(raw, contractPlaceholders(c));
}
