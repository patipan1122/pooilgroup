// Server-side broadcaster for /inbox real-time updates.
//
// When a customer message lands (ingest) or staff/bot replies (recordOutbound)
// we fire a single broadcast to "inbox:org:<orgId>" — admins viewing /inbox
// pick it up via Supabase Realtime and call router.refresh() to re-fetch the
// org-scoped Server Component data.  No DB polling, only events.
//
// We talk to Supabase's REST broadcast endpoint directly so we don't have to
// manage a long-lived channel from a one-shot webhook handler.

const FIVE_SECONDS = 5_000;

export async function broadcastInboxChange(opts: {
  orgId: string;
  conversationId?: string;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return; // Misconfigured — drop silently rather than break ingest.

  const topic = `inbox:org:${opts.orgId}`;
  const body = {
    messages: [
      {
        topic,
        event: "changed",
        payload: {
          ts: Date.now(),
          conversationId: opts.conversationId ?? null,
        },
      },
    ],
  };

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FIVE_SECONDS),
    });
  } catch (e) {
    // Best-effort: a failed broadcast just means the admin sees the message
    // on their next manual refresh instead of instantly.  Don't fail ingest.
    console.warn("[inbox realtime] broadcast failed", (e as Error).message);
  }
}
