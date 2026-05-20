import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

// PII scrubber (PDPA · พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล)
// ลบ email · phone · national_id · จาก event/breadcrumbs ก่อนส่งไป Sentry SaaS
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const THAI_PHONE_RE = /\b0\d{1,2}[-\s]?\d{3}[-\s]?\d{4}\b/g;
const NATIONAL_ID_RE = /\b\d-\d{4}-\d{5}-\d{2}-\d\b|\b\d{13}\b/g;
const CARD_RE = /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g;

function scrub(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(THAI_PHONE_RE, "[phone]")
    .replace(NATIONAL_ID_RE, "[national_id]")
    .replace(CARD_RE, "[card]");
}

function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  try {
    if (event.message) event.message = scrub(event.message);
    if (event.exception?.values) {
      for (const v of event.exception.values) {
        if (v.value) v.value = scrub(v.value);
      }
    }
    if (event.breadcrumbs) {
      for (const b of event.breadcrumbs) {
        if (b.message) b.message = scrub(b.message);
        if (b.data) {
          for (const k of Object.keys(b.data)) {
            const v = b.data[k];
            if (typeof v === "string") b.data[k] = scrub(v);
          }
        }
      }
    }
    if (event.request?.headers) {
      delete event.request.headers["cookie"];
      delete event.request.headers["authorization"];
    }
  } catch {
    /* ignore scrub errors — better to send raw than drop event */
  }
  return event;
}

const COMMON_CONFIG = {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  enabled: Boolean(process.env.SENTRY_DSN),
  beforeSend: scrubEvent,
};

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init(COMMON_CONFIG);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(COMMON_CONFIG);
  }
}

export const onRequestError = Sentry.captureRequestError;
