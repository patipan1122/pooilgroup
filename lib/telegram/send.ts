// Telegram bot send helpers — safe no-op if TELEGRAM_BOT_TOKEN is not set.
// Used for register-request approval, daily report approval (CashHub), etc.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const TELEGRAM_API = "https://api.telegram.org";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface SendMessageOptions {
  chatId: string | number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  inlineKeyboard?: InlineButton[][];
  disableNotification?: boolean;
  /**
   * If true, attaches Telegram's `force_reply` markup so the user's keyboard
   * pre-fills "reply to this message". Used for the reject-reason capture flow.
   * Mutually exclusive with `inlineKeyboard` (force_reply wins if both passed).
   */
  forceReply?: boolean;
}

/**
 * Send a Telegram message. Returns the message_id on success, or null on failure.
 * Silently no-ops if TELEGRAM_BOT_TOKEN is not configured.
 */
export async function sendTelegramMessage(
  opts: SendMessageOptions,
): Promise<{ messageId: number; chatId: string | number } | null> {
  if (!BOT_TOKEN) {
    console.warn("[telegram] TELEGRAM_BOT_TOKEN not set — skipping");
    return null;
  }

  try {
    const replyMarkup = opts.forceReply
      ? { force_reply: true, selective: true }
      : opts.inlineKeyboard
        ? { inline_keyboard: opts.inlineKeyboard }
        : undefined;
    const res = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.chatId,
        text: opts.text,
        parse_mode: opts.parseMode ?? "HTML",
        disable_notification: opts.disableNotification ?? false,
        reply_markup: replyMarkup,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[telegram] sendMessage failed", res.status, errText);
      return null;
    }

    const data = await res.json();
    if (!data.ok || !data.result) {
      console.error("[telegram] sendMessage error", data);
      return null;
    }

    return { messageId: data.result.message_id, chatId: opts.chatId };
  } catch (err) {
    console.error("[telegram] sendMessage exception", err);
    return null;
  }
}

/**
 * Edit a previously-sent Telegram message (e.g. to remove approve buttons after action).
 */
export async function editTelegramMessage(opts: {
  chatId: string | number;
  messageId: number;
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  inlineKeyboard?: InlineButton[][];
}): Promise<boolean> {
  if (!BOT_TOKEN) return false;

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: opts.chatId,
        message_id: opts.messageId,
        text: opts.text,
        parse_mode: opts.parseMode ?? "HTML",
        reply_markup: opts.inlineKeyboard
          ? { inline_keyboard: opts.inlineKeyboard }
          : undefined,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[telegram] editMessage failed", res.status, errText);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] editMessage exception", err);
    return false;
  }
}

/**
 * Answer a callback query (so the loading spinner on the user's button stops).
 */
export async function answerCallbackQuery(opts: {
  callbackQueryId: string;
  text?: string;
  showAlert?: boolean;
}): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    await fetch(`${TELEGRAM_API}/bot${BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: opts.callbackQueryId,
        text: opts.text,
        show_alert: opts.showAlert ?? false,
      }),
    });
    return true;
  } catch {
    return false;
  }
}

/** Convenience: send to the org's Admin chat (from env). */
export async function sendToAdminChat(opts: {
  text: string;
  parseMode?: "HTML" | "MarkdownV2";
  inlineKeyboard?: InlineButton[][];
}) {
  if (!ADMIN_CHAT_ID) {
    console.warn("[telegram] TELEGRAM_ADMIN_CHAT_ID not set");
    return null;
  }
  return sendTelegramMessage({ ...opts, chatId: ADMIN_CHAT_ID });
}

/** Escape HTML special chars (Telegram HTML mode). */
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
