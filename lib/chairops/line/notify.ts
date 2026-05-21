// LINE Notify — 5 role-channels (not 20 per-branch · per SA call #3)
// finance / repair / ops / branch / ceo
type LineChannel = "finance" | "repair" | "ops" | "branch" | "ceo";

const TOKEN_ENV: Record<LineChannel, string> = {
  finance: "LINE_NOTIFY_TOKEN_FINANCE",
  repair: "LINE_NOTIFY_TOKEN_REPAIR",
  ops: "LINE_NOTIFY_TOKEN_OPS",
  branch: "LINE_NOTIFY_TOKEN_BRANCH",
  ceo: "LINE_NOTIFY_TOKEN_CEO",
};

export async function sendLineNotify(
  channel: LineChannel,
  message: string,
  imageUrl?: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const token = process.env[TOKEN_ENV[channel]];
  if (!token) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[line-notify dev · ${channel}] ${message}`);
    }
    return { ok: false, error: "no-token" };
  }
  try {
    const body = new URLSearchParams({ message });
    if (imageUrl) body.set("imageThumbnail", imageUrl);
    const r = await fetch("https://notify-api.line.me/api/notify", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unknown" };
  }
}
