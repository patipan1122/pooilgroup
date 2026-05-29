// Outbound senders — reuse the LINE Reply/Push + FB Send API helpers built
// for Recruit. Structural typing lets us call them with our own input shape.
export { sendLineMessage, sendFacebookMessage } from "@/lib/recruit/inbox-send";

export interface InboxSendInput {
  body: string;
  recipientExternalId: string;
  accessToken: string;
  replyToken?: string | null;
}

export interface InboxSendResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}
