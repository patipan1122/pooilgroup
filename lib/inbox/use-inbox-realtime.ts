"use client";

// useInboxRealtime — subscribe to "inbox:org:<orgId>" broadcast events fired
// by server-side ingest / recordOutbound and trigger a router.refresh() when
// an event arrives.  Mirrors the role of the old setInterval poll but only
// re-fetches when there's an actual change · zero idle DB load.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/db/client";

const REFRESH_DEBOUNCE_MS = 250;

export function useInboxRealtime(opts: {
  orgId: string | null | undefined;
}) {
  const router = useRouter();
  // Keep the router ref out of the effect deps so we don't tear down + remount
  // the channel every render (audit RT-001 — earlier version threaded
  // conversationId through the deps and rebuilt the socket on every click).
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!opts.orgId) return;
    const supabase = browserClient();
    const channel = supabase.channel(`inbox:org:${opts.orgId}`);

    // Debounce: a webhook can land 3-5 messages back-to-back (FB carousel,
    // bot reply right after ingest).  Without this, each broadcast fires
    // its own router.refresh() and the workspace re-fetches N times in a
    // row · DB hammered + UI flicker (audit RT-002).
    let pending: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        routerRef.current.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    channel
      .on("broadcast", { event: "changed" }, () => {
        scheduleRefresh();
      })
      .subscribe((status) => {
        // Surface socket-level failures in the console so a regressed
        // env-var / network outage is debuggable (audit RT-007).
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[inbox realtime] channel state:", status);
        }
      });

    return () => {
      if (pending) clearTimeout(pending);
      void supabase.removeChannel(channel);
    };
  }, [opts.orgId]);
}
