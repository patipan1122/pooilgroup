/**
 * ACS-F606 HTTP → HTTPS bridge · Cloudflare Worker
 *
 * Why: ACS-F606 firmware speaks HTTP only (doc-2 §2.6.1 explicit red text:
 *   "must set up http server to receive data").
 * Vercel terminates HTTPS only · port 80 traffic gets 308-redirected to HTTPS,
 * and doc-2 also says the device does NOT follow redirects.
 *
 * This worker accepts plain HTTP from the device and forwards each request to
 * https://pooilgroup.vercel.app/<same-path>?<same-query> preserving method,
 * headers, and body. Response is returned verbatim so the device sees the
 * exact JSON envelope our /api/playland/acs/event route produces
 * ({"result":0,"message":"OK"} per spec).
 *
 * IMPORTANT — deployment notes (see README.md):
 *   • The default *.workers.dev hostname force-upgrades HTTP→HTTPS.
 *     For real device use, attach a custom domain on Cloudflare where you can
 *     disable "Always Use HTTPS" under SSL/TLS → Edge Certificates.
 *   • Allow-list of upstream paths is enforced below — Worker only relays the
 *     two endpoints we expose. Anything else returns 404 to keep blast radius
 *     small if the worker URL leaks.
 */

const UPSTREAM_ORIGIN = "https://pooilgroup.vercel.app";

// Only these path prefixes are forwarded. Add more here as new ACS routes ship.
const ALLOWED_PATH_PREFIXES = [
  "/api/playland/acs/",
];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "acs-http-bridge",
          upstream: UPSTREAM_ORIGIN,
          scheme_seen: url.protocol,
          ts: new Date().toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    const allowed = ALLOWED_PATH_PREFIXES.some((p) => url.pathname.startsWith(p));
    if (!allowed) {
      return new Response(
        JSON.stringify({ result: 1, message: "path not allowed by bridge" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }

    const upstreamUrl = `${UPSTREAM_ORIGIN}${url.pathname}${url.search}`;

    // Clone headers · strip hop-by-hop / cloudflare-set ones · add an audit header
    const fwdHeaders = new Headers();
    for (const [k, v] of request.headers) {
      const lk = k.toLowerCase();
      if (lk === "host" || lk === "cf-connecting-ip" || lk.startsWith("cf-") || lk === "x-forwarded-host") continue;
      fwdHeaders.set(k, v);
    }
    fwdHeaders.set("x-acs-bridge", "cloudflare-worker");
    fwdHeaders.set("x-acs-original-scheme", url.protocol.replace(":", ""));
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp) fwdHeaders.set("x-acs-device-ip", clientIp);

    const upstreamReq = new Request(upstreamUrl, {
      method: request.method,
      headers: fwdHeaders,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "manual",
    });

    let upstreamRes;
    try {
      upstreamRes = await fetch(upstreamReq);
    } catch (err) {
      // Return result:1 so device retries · this is genuine upstream failure
      return new Response(
        JSON.stringify({ result: 1, message: `bridge upstream error: ${err.message}` }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    // Stream upstream response body back · preserve status + headers
    const respHeaders = new Headers(upstreamRes.headers);
    respHeaders.set("x-acs-bridge", "cloudflare-worker");
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: respHeaders,
    });
  },
};
