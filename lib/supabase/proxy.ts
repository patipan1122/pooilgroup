import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Security headers (RULES §21 Layer 2). Applied on every response so
// static assets, API routes, and SSR pages all carry the same hardening.
// CSP is permissive enough to allow LIFF / Supabase / R2 / Recharts /
// inline SVG (Lucide). Tighten when external integrations stabilise.
//
// IMPORTANT — this is the layer that actually controls the shipped
// X-Frame-Options/CSP, NOT next.config.ts's `headers()`. Both this file
// and next.config.ts declare a rule for the same header keys; when a
// Next.js middleware (this file, via proxy.ts) calls `headers.set(...)`
// on the response, that value wins over whatever `next.config.ts`'s
// `headers()` config declared for the same path/key (verified locally by
// comparing `curl -I` output before/after this file's change — the
// next.config.ts rule alone had ZERO effect on the response actually
// sent). Keep next.config.ts's `/telegram-app` rule in sync with this
// file's TELEGRAM_MINI_APP_CSP if either ever changes — this file is the
// one that matters at runtime, next.config.ts's copy is a secondary,
// currently-superseded declaration kept for documentation/defense-in-
// depth in case the middleware layer is ever removed.
const BASE_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.line-scdn.net https://*.line.me",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.upstash.io https://*.r2.cloudflarestorage.com https://api.telegram.org https://*.line.me https://*.line-scdn.net wss://*.supabase.co",
  // DocuFlow embeds the signed-URL PDF preview in an <iframe src={r2SignedUrl}>
  // (components/docuflow/viewer-tabs.tsx). That domain is *.r2.cloudflarestorage.com,
  // the same host already trusted above for connect-src — frame-src had been left
  // without it, so the browser silently blocked every PDF preview (console-only
  // CSP violation, nothing shown to the user). Bug: 2026-10-10.
  "frame-src 'self' https://liff.line.me https://*.line.me https://*.r2.cloudflarestorage.com",
  "frame-ancestors 'self' https://liff.line.me",
  "base-uri 'self'",
  "form-action 'self'",
];
const CSP = BASE_CSP_DIRECTIVES.join("; ");

// Telegram Mini App (DocuFlow signing, 2026-10-16) — /telegram-app is
// embedded INSIDE Telegram's own WebView and loads Telegram's JS SDK
// (`https://telegram.org/js/telegram-web-app.js`). The global CSP above
// blocks both: `frame-ancestors` only allows LIFF, and `script-src` only
// allows LINE's CDN. Derived from BASE_CSP_DIRECTIVES (not a hand-copied
// second CSP string) so the two can never silently drift apart — only
// the two lines that need to differ are swapped.
const TELEGRAM_MINI_APP_CSP = BASE_CSP_DIRECTIVES.map((directive) => {
  if (directive.startsWith("script-src")) {
    return `${directive} https://telegram.org`;
  }
  if (directive.startsWith("frame-ancestors")) {
    return "frame-ancestors 'self' https://web.telegram.org https://telegram.org";
  }
  return directive;
}).join("; ");

function isTelegramMiniAppRoute(pathname: string): boolean {
  return pathname.startsWith("/telegram-app");
}

const ALLOWED_ORIGINS = [
  "https://pooilgroup.com",
  "https://www.pooilgroup.com",
  "https://pooilgroup.vercel.app",
  "https://poolgroup.com",
  "https://www.poolgroup.com",
  "https://liff.line.me",
  "http://localhost:3100",
];

function applySecurityHeaders(headers: Headers, pathname: string) {
  const isTelegramMiniApp = isTelegramMiniAppRoute(pathname);
  headers.set(
    "Content-Security-Policy",
    isTelegramMiniApp ? TELEGRAM_MINI_APP_CSP : CSP,
  );
  headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  if (isTelegramMiniApp) {
    // Not SAMEORIGIN — this route must embed inside Telegram's WebView
    // (a different origin). "ALLOWALL" isn't a real standard value; it's
    // a legacy-browser fallback that modern browsers simply ignore
    // rather than blocking the frame — the CSP frame-ancestors line above
    // is the actual enforcement. Scoped to exactly this route; every
    // other path keeps SAMEORIGIN untouched.
    headers.set("X-Frame-Options", "ALLOWALL");
  } else {
    headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    // camera=(self) lets our origin call getUserMedia (Playland face register).
    // Mic/payment stay blocked (we don't need them). Geo stays for CashHub.
    "camera=(self), microphone=(), geolocation=(self), payment=()",
  );
  headers.set("X-XSS-Protection", "0");
}

function applyCors(req: NextRequest, headers: Headers) {
  if (!req.nextUrl.pathname.startsWith("/api/")) return;
  const origin = req.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    );
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Telegram-Bot-Api-Secret-Token",
    );
    headers.set("Access-Control-Max-Age", "86400");
  }
}

export async function updateSession(request: NextRequest) {
  // CORS preflight short-circuit (don't bother with Supabase for OPTIONS)
  if (
    request.method === "OPTIONS" &&
    request.nextUrl.pathname.startsWith("/api/")
  ) {
    const preflight = new NextResponse(null, { status: 204 });
    applySecurityHeaders(preflight.headers, request.nextUrl.pathname);
    applyCors(request, preflight.headers);
    return preflight;
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  applySecurityHeaders(supabaseResponse.headers, request.nextUrl.pathname);
  applyCors(request, supabaseResponse.headers);

  return supabaseResponse;
}
