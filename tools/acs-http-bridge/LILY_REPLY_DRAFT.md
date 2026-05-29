# Draft message to Lily Huang (ACS Auto)

> Copy-paste below. Translate via Alibaba's built-in translator (works fine).
> Tone: professional · diagnostic-first · gives them concrete options.

---

Hi Lily,

Thanks for your engineer's quick test. I want to confirm what we found so we can move forward.

**Our side is verified working:**
We tested the endpoint `https://pooilgroup.vercel.app/api/playland/acs/event` from multiple external clients. HTTPS terminates correctly, authentication via the URL-query secret works, device TEST-CLOUD-001 is registered, and the server replies in the exact format your doc-2 §2.6.1 specifies:

```json
{"result": 0, "message": "OK"}
```

within 200ms. So the cloud endpoint itself is reachable and answering correctly for HTTPS clients.

**Where we think the gap is:**
Your doc-2 §2.6.1 (page 28, red text) says the platform must be an **HTTP server**, and the device's internal log on page 30 shows it constructs `http api post record url:http://...`. So when the F606 firmware tries to POST to our `https://` URL, it sends plain HTTP to TCP port 443, which our cloud (Vercel) cannot decode — hence your engineer's "cannot be connected" report. This is also consistent with the spec: there is no example of an `https://` platformIp anywhere in doc-2.

**Two questions to confirm root cause:**

1. **Does the ACS-F606 firmware have any build that supports HTTPS / TLS for the `platformIp` callback?** If yes, what's the firmware version we should upgrade to?

2. **Does ACS Auto offer a vendor cloud relay** (a service we point our device's `platformIp` to, that then forwards events to our HTTPS endpoint over a secure channel)? If yes, please share the API doc.

3. **Could your engineer share the exact error message from the device-side log** (the line equivalent to `httpsdkapibll.uploadrecordthread.cpp` in doc-2 page 30)? That will let us pinpoint whether the failure is TLS handshake, HTTP parse, or DNS — and rule out anything on our end.

**What we're doing in parallel:**
While waiting for your answers, we're putting up an HTTP→HTTPS bridge on our side so the F606 firmware can talk HTTP as it expects, and the bridge forwards over TLS to our cloud. Should be ready within 24 hours. Once it's live, the device's `platformIp` will be:

```
http://acs.<our-domain>.com/api/playland/acs/event?device=TEST-CLOUD-001&secret=cloud-test-secret-2026
```

(plain `http://`, not `https://`). We'll send the final URL once deployed.

**Next step:**
Once your engineer confirms questions 1-3 above, and we share the bridge URL, we'd like to run the cloud test again. If it passes, we'll order the 3 physical devices for our branches right after.

Thanks!
