import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";

// PII scrubber client-side (PDPA)
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
      }
    }
  } catch {
    /* ignore */
  }
  return event;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0.1,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  beforeSend: scrubEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
