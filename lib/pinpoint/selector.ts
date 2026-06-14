// Pinpoint — client-side element targeting.
//
// Domain-expert insight (workshop): for a tool whose purpose is "hand the report
// to Claude to fix", the structured target is the load-bearing payload. We build
// a SHORT, robust CSS selector AND keep fallbacks (innerText + tag/role/aria +
// bounding-rect) so the node is re-findable even after a refactor.

import type { ElementMeta } from "./types";

const STOP_ATTRS = ["data-testid", "data-test", "data-pin-id", "id"];

function escapeIdent(value: string): string {
  // Minimal CSS.escape fallback (older webviews) — good enough for class/id paths.
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([^\w-])/g, "\\$1");
}

/** A stable hook on this element alone (id / data-testid), if any. */
function ownHook(el: Element): string | null {
  for (const attr of STOP_ATTRS) {
    const v = el.getAttribute(attr);
    if (v && v.trim()) {
      return attr === "id" ? `#${escapeIdent(v)}` : `[${attr}="${escapeIdent(v)}"]`;
    }
  }
  return null;
}

function nthOfType(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;
  const sibs = Array.from(parent.children).filter(
    (c) => c.tagName === el.tagName,
  );
  if (sibs.length <= 1) return tag;
  const idx = sibs.indexOf(el) + 1;
  return `${tag}:nth-of-type(${idx})`;
}

/** Build a short selector: walk up to ~6 levels, stopping early at the first
 *  ancestor that has a stable hook (id / data-testid). */
export function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth < 6) {
    const hook = ownHook(node);
    if (hook) {
      parts.unshift(hook);
      break; // a stable hook anchors the whole path — stop climbing
    }
    parts.unshift(nthOfType(node));
    node = node.parentElement;
    depth++;
  }
  return parts.join(" > ");
}

export function buildElementMeta(el: Element): ElementMeta {
  const rect = el.getBoundingClientRect();
  const cls =
    typeof el.className === "string" ? el.className.trim().slice(0, 120) : undefined;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    testid: el.getAttribute("data-testid") || undefined,
    role: el.getAttribute("role") || undefined,
    ariaLabel: el.getAttribute("aria-label") || undefined,
    classes: cls || undefined,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    },
  };
}

/** A SHORT, meaningful label for the clicked element — prefer an accessible
 *  name / direct text over the whole subtree's concatenated text (which on a
 *  big container is a noisy blob like "ภาพรวมภาพรวม…"). This is what the
 *  developer reads to locate the target, so keep it tight + relevant. */
export function elementText(el: Element): string {
  const cap = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 80);

  // 1. Explicit accessible name.
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return cap(aria);
  const title = el.getAttribute("title");
  if (title?.trim()) return cap(title);

  // 2. Form controls → value / placeholder.
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const v = el.value || el.placeholder;
    if (v?.trim()) return cap(v);
  }
  if (el instanceof HTMLImageElement && el.alt?.trim()) return cap(el.alt);

  // 3. The element's OWN direct text nodes (not deep descendants).
  let direct = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) direct += node.textContent ?? "";
  }
  if (direct.trim()) return cap(direct);

  // 4. Last resort — full text, but short so a container blob stays bounded.
  const t = el.textContent ?? "";
  return cap(t);
}
