// Auto-generated social share card for /apply/[slug]
// (Facebook / LINE / Twitter preview image — 1200×630).
//
// WHY (2026-07-09): a bare share link ("pooilgroup.vercel.app" + long slug)
// reads like a scam and nobody clicks. This renders a branded card showing
// the JOB TITLE + company so the preview clearly says "รับสมัครพนักงาน …".
// Next auto-injects <meta og:image> pointing here (resolved against the
// metadataBase set in ./page.tsx → absolute pooilgroup.com URL).
//
// Robustness: everything that can fail (Thai font fetch, cover-image fetch,
// DB lookup) degrades gracefully — worst case we still return a branded card,
// never a 500 (a broken OG image would only drop the preview, page is fine).

import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; // needs prisma + Buffer
export const dynamic = "force-dynamic";
export const alt = "ประกาศรับสมัครงาน";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand indigo (globals.css --color-brand-* is oklch; Satori needs plain hex)
const BRAND_600 = "#4338ca";
const BRAND_700 = "#3730a3";
const BRAND_900 = "#1e1b4b";

// Canonical public origin for the recruit share surface. Hardcoded (not
// NEXT_PUBLIC_APP_URL) so the brand asset always resolves to the real public
// domain — never localhost/preview/vercel — no matter what the env is set to.
const PUBLIC_ORIGIN = "https://pooilgroup.com";

// Fetch just the glyphs we render, as TTF (Satori cannot parse woff2 — an old
// User-Agent makes Google Fonts serve truetype instead of woff2).
async function loadThaiFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const api = `https://fonts.googleapis.com/css2?family=Anuphan:wght@700&text=${encodeURIComponent(text)}`;
    const css = await fetch(api, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_9_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/32.0.1700.77 Safari/537.36",
      },
    }).then((r) => (r.ok ? r.text() : ""));
    const m = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/);
    if (!m) return null;
    const res = await fetch(m[1]!);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function loadPosting(slug: string) {
  const select = {
    title: true,
    settings: true,
    company: { select: { name: true } },
    org: { select: { name: true } },
  } as const;
  let p = await prisma.recruitJobPosting.findUnique({ where: { slug }, select });
  // Same trailing-token fallback as page.tsx so rescued/backfilled links still
  // render the right card.
  if (!p) {
    const token = slug.split("-").pop();
    if (token && token.length >= 4) {
      p = await prisma.recruitJobPosting.findFirst({
        where: { slug: { endsWith: `-${token}` } },
        select,
      });
    }
  }
  return p;
}

// Fetch any image URL into a data URL so a broken/private/unreachable image
// degrades gracefully (fall back to gradient / no logo) instead of erroring
// the whole card.
async function loadImageDataUrl(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "image/png";
    if (!ct.startsWith("image/")) return null;
    const b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const posting = await loadPosting(slug).catch(() => null);

  const companyName =
    posting?.company?.name ?? posting?.org?.name ?? "POOIL GROUP";
  const jobTitle = posting?.title ?? "ร่วมงานกับเรา";
  const shownTitle =
    jobTitle.length > 54 ? `${jobTitle.slice(0, 53).trimEnd()}…` : jobTitle;

  const coverUrl =
    posting?.settings &&
    typeof posting.settings === "object" &&
    !Array.isArray(posting.settings)
      ? (posting.settings as { coverImageUrl?: string }).coverImageUrl
      : undefined;

  // Load the workplace photo (if HR uploaded one). Degrades to null on failure
  // → card falls back to the brand gradient + decorative shapes below.
  const coverData = await loadImageDataUrl(coverUrl);

  const eyebrow = "เปิดรับสมัครพนักงาน";
  const label = "ตำแหน่งที่เปิดรับ";
  const cta = "สมัครออนไลน์ · ไม่ต้องล็อกอิน";
  const domain = "pooilgroup.com";
  const font = await loadThaiFont(
    eyebrow + label + companyName + shownTitle + cta + domain + "0123456789",
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          position: "relative",
          fontFamily: font ? "Anuphan, sans-serif" : "sans-serif",
          color: "white",
        }}
      >
        {/* Background: workplace photo (if uploaded) under a dark brand veil, or a solid brand gradient */}
        {coverData ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverData}
              alt=""
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "1200px",
                height: "630px",
                objectFit: "cover",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: "flex",
                background:
                  "linear-gradient(135deg, rgba(30,27,75,0.94) 0%, rgba(55,44,163,0.88) 60%, rgba(67,56,202,0.78) 100%)",
              }}
            />
          </>
        ) : (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: "flex",
              background: `linear-gradient(135deg, ${BRAND_600} 0%, ${BRAND_700} 55%, ${BRAND_900} 100%)`,
            }}
          />
        )}

        {/* Decorative depth — soft concentric shapes bleeding off the right edge.
            Only on the plain gradient (a real photo already carries the visual). */}
        {!coverData && (
          <>
            <div
              style={{
                position: "absolute",
                top: "-160px",
                right: "-140px",
                width: "560px",
                height: "560px",
                borderRadius: "999px",
                display: "flex",
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 70%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: "-220px",
                right: "180px",
                width: "460px",
                height: "460px",
                borderRadius: "999px",
                display: "flex",
                border: "2px solid rgba(255,255,255,0.10)",
              }}
            />
          </>
        )}

        {/* Content */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "72px 80px",
          }}
        >
          {/* Eyebrow pill */}
          <div style={{ display: "flex" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "14px",
                background: "rgba(255,255,255,0.16)",
                borderRadius: "999px",
                padding: "12px 26px",
                fontSize: "27px",
              }}
            >
              <div
                style={{
                  width: "15px",
                  height: "15px",
                  borderRadius: "999px",
                  background: "#34d399",
                  display: "flex",
                }}
              />
              {eyebrow}
            </div>
          </div>

          {/* Job title */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: "30px",
                color: "rgba(255,255,255,0.8)",
                marginBottom: "14px",
              }}
            >
              {label}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "70px",
                lineHeight: 1.12,
                letterSpacing: "-1px",
              }}
            >
              {shownTitle}
            </div>
          </div>

          {/* Footer: CTA pill + company/domain */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                background: "white",
                color: BRAND_700,
                borderRadius: "999px",
                padding: "17px 32px",
                fontSize: "31px",
              }}
            >
              {cta}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
              }}
            >
              <div style={{ display: "flex", fontSize: "35px" }}>
                {companyName}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "25px",
                  color: "rgba(255,255,255,0.8)",
                }}
              >
                {domain}
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: "Anuphan", data: font, style: "normal", weight: 700 }]
        : undefined,
    },
  );
}
