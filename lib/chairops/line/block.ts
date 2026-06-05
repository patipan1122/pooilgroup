// F8: LINE Messaging API — blockMember (unfollow from OA)
// Called after deactivateUser to prevent deactivated maid from messaging the OA.
// IMPORTANT: this is a best-effort call — failure logs but does NOT block deactivation.
// Per [[ceo-prefers-manual-ai-triggers]] + [[line-channels-separate-per-module]]:
//   uses CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN exclusively.

export async function blockLineUser(lineUserId: string): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) {
    return { ok: false, error: "CHAIROPS_LINE_CHANNEL_ACCESS_TOKEN ไม่ได้ตั้งค่า" };
  }

  // LINE Messaging API: block a user from following the OA
  const res = await fetch(`https://api.line.me/v2/bot/users/${lineUserId}/block`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `LINE block failed ${res.status}: ${body}` };
  }

  return { ok: true };
}
