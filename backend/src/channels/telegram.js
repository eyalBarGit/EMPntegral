import { config, telegramConfigured } from "../config.js";
import { postJson } from "../lib/http.js";
import { logger } from "../logger.js";

/**
 * Telegram only accepts http, https and tg links on inline buttons, so a
 * "call now" button is rendered as a wa.me link plus the number in the body,
 * which phones turn into a tappable dial link on their own.
 */
export async function sendAlert(text, buttons = []) {
  if (!telegramConfigured()) {
    logger.warn("Telegram alert skipped: bot token or chat id missing");
    return false;
  }

  const usable = buttons.filter((b) => /^(https?|tg):\/\//i.test(b.url));

  try {
    await postJson({
      url: `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      body: {
        chat_id: config.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(usable.length
          ? {
              reply_markup: {
                inline_keyboard: [usable.map((b) => ({ text: b.text, url: b.url }))],
              },
            }
          : {}),
      },
    });
    return true;
  } catch (error) {
    logger.error("Telegram alert failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Telegram's HTML parse mode only needs these three escaped. */
export const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
