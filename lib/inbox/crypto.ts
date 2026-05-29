// Inbox channel crypto — reuses the proven envelope encryption + webhook
// signature verification from the Recruit omnichannel stack. One wrapping key
// (env RECRUIT_CHANNEL_KEY) protects all channel secrets across modules.
export {
  encryptToken,
  decryptToken,
  verifyLineSignature,
  verifyFacebookSignature,
} from "@/lib/recruit/channel-crypto";
