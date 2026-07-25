// Pinpoint — shared TS types (client + server).

export type PinpointSessionStatus =
  | "draft"
  | "submitted"
  | "reviewed"
  | "exported"
  | "closed";

export type PinpointPriority = "urgent" | "normal";
export type PinpointPinStatus = "open" | "fixed" | "wontfix";

/** Robust element-target bundle captured at click time. The selector is a best
 *  guess; element_text + meta let the developer/Claude re-find the node even
 *  after a refactor. */
export interface ElementMeta {
  tag: string;
  id?: string;
  testid?: string;
  role?: string;
  ariaLabel?: string;
  classes?: string;
  rect?: { x: number; y: number; w: number; h: number };
}

export interface PinpointPin {
  id: string;
  session_id: string;
  org_id: string;
  seq: number;
  url: string;
  element_selector: string | null;
  element_text: string | null;
  element_meta: ElementMeta | null;
  coord_x_pct: number | null;
  coord_y_pct: number | null;
  viewport_w: number | null;
  viewport_h: number | null;
  comment: string | null;
  priority: PinpointPriority;
  status: PinpointPinStatus;
  screenshot_key: string | null;
  fixed_at: string | null;
  fixed_commit_sha: string | null;
  created_at: string;
  updated_at: string;
}

export interface PinpointSession {
  id: string;
  org_id: string;
  author_id: string;
  title: string | null;
  status: PinpointSessionStatus;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  exported_at: string | null;
  consolidated_report_id: string | null;
  pin_count: number;
  /** R2 key of the per-session screen recording (webm), if one was captured. */
  recording_key: string | null;
  created_at: string;
  finished_at: string | null;
  updated_at: string;
}

/** Payload the client POSTs when dropping a pin. */
export interface NewPinPayload {
  url: string;
  elementSelector?: string | null;
  elementText?: string | null;
  elementMeta?: ElementMeta | null;
  coordXPct?: number | null;
  coordYPct?: number | null;
  viewportW?: number | null;
  viewportH?: number | null;
  comment?: string | null;
  priority?: PinpointPriority;
  screenshotKey?: string | null;
}
