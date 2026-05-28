// Playland · Code generators for human-readable IDs
// Thai-friendly: BE year (พ.ศ.) · monotonically-ish via timestamp + random

const PREFIXES = {
  member: "PM",
  booking: "PB",
  sale: "PS",
  shift: "SH",
  ticket: "PT",
} as const;

function beYearTwoDigits(): string {
  const ad = new Date().getFullYear();
  const be = ad + 543;
  return String(be).slice(-2);
}

/** Generate a short numeric suffix using timestamp + random for low collision risk. */
function suffix(): string {
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${ts}${rnd}`;
}

export function newCode(kind: keyof typeof PREFIXES): string {
  return `${PREFIXES[kind]}-${beYearTwoDigits()}-${suffix()}`;
}

export function newMemberCode(): string {
  return newCode("member");
}

export function newBookingCode(): string {
  return newCode("booking");
}

export function newSaleCode(): string {
  return newCode("sale");
}

export function newShiftCode(): string {
  return `SH-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`;
}
