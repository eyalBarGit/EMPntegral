import { config, whatsappConfigured } from "../config.js";
import { postJson } from "../lib/http.js";
import { logger } from "../logger.js";

const endpoint = () =>
  `https://graph.facebook.com/${config.GRAPH_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * The gate is checked here rather than at the call sites, so there is exactly
 * one place that can ever put traffic on the business phone number.
 */
function gate(payload) {
  if (!config.WHATSAPP_ENABLED) {
    logger.info("WhatsApp send suppressed: WHATSAPP_ENABLED is false", { to: payload.to });
    return { ok: false, skipped: "disabled", payload };
  }
  if (!whatsappConfigured()) {
    logger.warn("WhatsApp send skipped: credentials are incomplete", { to: payload.to });
    return { ok: false, skipped: "not_configured", payload };
  }
  return null;
}

async function dispatch(payload) {
  const blocked = gate(payload);
  if (blocked) return blocked;

  try {
    const response = await postJson({
      url: endpoint(),
      token: config.WHATSAPP_ACCESS_TOKEN,
      body: payload,
    });
    return { ok: true, messageId: response?.messages?.[0]?.id, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("WhatsApp send failed", { message });
    return { ok: false, payload, error: message };
  }
}

/**
 * First contact with a lead. There is no open customer service window at this
 * point, so a template is mandatory.
 *
 * The template's billing category is decided by Meta at approval time, not by
 * us. We pass no category here; the value actually billed arrives later in the
 * `pricing` object of the status webhook and is recorded then.
 */
export function sendTemplate(to, variables = []) {
  const components =
    variables.length > 0
      ? [{ type: "body", parameters: variables.map((text) => ({ type: "text", text })) }]
      : undefined;

  return dispatch({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: config.WHATSAPP_TEMPLATE_NAME,
      language: { code: config.WHATSAPP_TEMPLATE_LANGUAGE },
      ...(components ? { components } : {}),
    },
  });
}

/**
 * Free-form reply. Valid only while the 24 hour customer service window opened
 * by the lead's last inbound message is still open.
 */
export function sendText(to, text) {
  return dispatch({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  });
}

/**
 * Reads the billing facts Meta reports for a delivered message. Everything is
 * optional because the shape has changed over time and we never want a missing
 * field to throw inside a webhook handler.
 */
export function readPricing(status) {
  if (typeof status !== "object" || status === null) return null;
  const pricing = status.pricing;
  if (typeof pricing !== "object" || pricing === null) return null;

  return {
    billable: typeof pricing.billable === "boolean" ? pricing.billable : undefined,
    category: typeof pricing.category === "string" ? pricing.category : undefined,
    pricingModel: typeof pricing.pricing_model === "string" ? pricing.pricing_model : undefined,
    type: typeof pricing.type === "string" ? pricing.type : undefined,
  };
}
