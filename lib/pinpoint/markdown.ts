// Pinpoint — "copy for Claude" markdown renderer.
//
// This is the load-bearing export: it leads with the structured target (page URL
// + element selector + innerText) so the developer/Claude can locate each issue
// precisely; the screenshot URL is attached as supporting evidence.

import type { PinpointPin, PinpointSession } from "./types";

export interface MarkdownOptions {
  /** Base origin for absolute page links, e.g. https://pooilgroup.vercel.app */
  appOrigin?: string;
  /** Base R2 public URL for screenshot links. */
  r2PublicUrl?: string;
}

function priorityTag(p: PinpointPin["priority"]): string {
  return p === "urgent" ? "🔴 ด่วน" : "⚪ ปกติ";
}

function statusTag(s: PinpointPin["status"]): string {
  if (s === "fixed") return "✅ แก้แล้ว";
  if (s === "wontfix") return "🚫 ไม่แก้";
  return "⬜ รอแก้";
}

export function sessionToMarkdown(
  session: PinpointSession,
  pins: PinpointPin[],
  opts: MarkdownOptions = {},
): string {
  const { appOrigin = "", r2PublicUrl = "" } = opts;
  const title = session.title?.trim() || `Pinpoint session ${session.id.slice(0, 8)}`;
  const lines: string[] = [];

  lines.push(`# 📌 Pinpoint — ${title}`);
  lines.push("");
  lines.push(
    `> ${pins.length} จุดติชม · สร้าง ${new Date(session.created_at).toLocaleString("th-TH")} · session \`${session.id}\``,
  );
  lines.push("");
  lines.push(
    "แต่ละจุดด้านล่างมาจากการคลิกบนหน้าจริง — แก้ตาม **หน้า + element + คอมเมนต์**:",
  );
  lines.push("");

  // Group pins by page for readability.
  const byUrl = new Map<string, PinpointPin[]>();
  for (const pin of pins) {
    const arr = byUrl.get(pin.url) ?? [];
    arr.push(pin);
    byUrl.set(pin.url, arr);
  }

  for (const [url, group] of byUrl) {
    const pageLink = appOrigin ? `${appOrigin}${url}` : url;
    lines.push(`## หน้า \`${url}\``);
    lines.push(`<${pageLink}>`);
    lines.push("");
    for (const pin of group) {
      lines.push(`### ${pin.seq}. ${priorityTag(pin.priority)} · ${statusTag(pin.status)}`);
      if (pin.comment) lines.push(`**คอมเมนต์:** ${pin.comment}`);
      if (pin.element_selector) lines.push(`- **Selector:** \`${pin.element_selector}\``);
      if (pin.element_text) lines.push(`- **ข้อความบน element:** "${pin.element_text}"`);
      if (pin.element_meta?.role || pin.element_meta?.ariaLabel) {
        const bits = [
          pin.element_meta.role ? `role=${pin.element_meta.role}` : null,
          pin.element_meta.ariaLabel ? `aria-label="${pin.element_meta.ariaLabel}"` : null,
        ].filter(Boolean);
        if (bits.length) lines.push(`- **Element:** ${bits.join(" · ")}`);
      }
      if (pin.coord_x_pct != null && pin.coord_y_pct != null) {
        lines.push(
          `- **ตำแหน่ง:** ${pin.coord_x_pct.toFixed(1)}% / ${pin.coord_y_pct.toFixed(1)}% ของจอ`,
        );
      }
      if (pin.screenshot_key && r2PublicUrl) {
        lines.push(`- **ภาพ:** ${r2PublicUrl}/${pin.screenshot_key}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("_สร้างโดย Pinpoint (โหมดติชม) · Pooil ERP_");
  return lines.join("\n");
}

/** Short plain-text summary stored in the consolidated bug_reports.description. */
export function sessionSummary(pins: PinpointPin[]): string {
  const urgent = pins.filter((p) => p.priority === "urgent").length;
  const head = `Pinpoint: ${pins.length} จุดติชม${urgent ? ` (ด่วน ${urgent})` : ""}`;
  const sample = pins
    .slice(0, 8)
    .map((p) => `• [${p.url}] ${p.comment?.slice(0, 80) || "(ไม่มีคอมเมนต์)"}`)
    .join("\n");
  const more = pins.length > 8 ? `\n…และอีก ${pins.length - 8} จุด` : "";
  return `${head}\n\n${sample}${more}`;
}
