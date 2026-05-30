"use client";

// useInboxRealtime — subscribe to "inbox:org:<orgId>" broadcast events fired
// by server-side ingest / recordOutbound and trigger a router.refresh() when
// an event arrives.  Mirrors the role of the old setInterval poll but only
// re-fetches when there's an actual change · zero idle DB load.
//
// optional `conversationId` — when present, the caller only cares about
// changes affecting that thread; we still refresh on any org-level event
// because list-pane counts + the latest snippet may have changed too.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/db/client";

export function useInboxRealtime(opts: {
  orgId: string | null | undefined;
  conversationId?: string | null;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!opts.orgId) return;
    const supabase = browserClient();
    const channel = supabase
      .channel(`inbox:org:${opts.orgId}`)
      .on("broadcast", { event: "changed" }, () => {
        router.refresh();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [opts.orgId, opts.conversationId, router]);
}
