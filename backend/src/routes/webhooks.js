import { handleInstagramComment } from "../flow/comments.js";
import { Router } from "express";
import { config } from "../config.js";
import * as whatsapp from "../channels/whatsapp.js";
import * as messagesRepo from "../db/messages.js";
import * as eventsRepo from "../db/events.js";
import { handleInstagramMessage, handleWhatsAppMessage } from "../flow/engine.js";
import { claim } from "../lib/idempotency.js";
import { safeEquals, verifyMetaSignature } from "../lib/signature.js";
import { enqueueWebhook, drainInbox, registerWebhookHandler } from "../lib/inbox.js";
import { logger } from "../logger.js";

export const webhooksRouter = Router();

/** Meta's one-time subscription handshake, identical for both products. */
function handleVerification(req, res) {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");

  if (mode === "subscribe" && safeEquals(token, config.WEBHOOK_VERIFY_TOKEN)) {
    logger.info("Webhook verification succeeded");
    res.status(200).type("text/plain").send(challenge);
    return;
  }

  logger.warn("Webhook verification rejected");
  res.sendStatus(403);
}

/**
 * Instagram Login signs with the Instagram app's own secret, a different value
 * from the Meta app secret that signs WhatsApp. Verifying against the wrong one
 * rejects every payload, so each channel names the secret it expects.
 */
function secretFor(channel) {
  if (channel === "instagram" && config.INSTAGRAM_APP_SECRET) {
    return config.INSTAGRAM_APP_SECRET;
  }
  return config.META_APP_SECRET;
}

function signatureOk(req, channel) {
  const secret = secretFor(channel);

  // Signature checking is only skippable in local development, where the app
  // secret is typically absent.
  if (!secret) {
    if (config.NODE_ENV === "production") return false;
    logger.warn(`No app secret for ${channel}; skipping signature check (development only)`);
    return true;
  }

  if (!req.rawBody) return false;

  return verifyMetaSignature(req.rawBody, req.get("x-hub-signature-256") ?? undefined, secret);
}

function readEntries(payload) {
  if (typeof payload !== "object" || payload === null) return [];
  return Array.isArray(payload.entry) ? payload.entry : [];
}

// ---------------------------------------------------------------------------
// Instagram
// ---------------------------------------------------------------------------

webhooksRouter.get("/instagram", handleVerification);

webhooksRouter.post("/instagram", async (req, res) => {
  if (!signatureOk(req, "instagram")) {
    logger.warn("Instagram webhook rejected: bad signature");
    res.sendStatus(403);
    return;
  }

  logger.info("Instagram webhook received");

  await enqueueWebhook("instagram", req.body);
  res.sendStatus(200);
  void drainInbox().catch(() => logger.error("Instagram inbox drain failed"));
});

async function processInstagramPayload(payload, context = {}) {
  const entries = readEntries(payload);

  // Every skip below is legitimate, but without a trace a filtered payload is
  // indistinguishable from one that never arrived, which makes the whole flow
  // impossible to debug from the outside.
  if (entries.length === 0) {
    logger.info("Instagram webhook carried no entries", { keys: Object.keys(payload ?? {}) });
  }

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      if (config.INSTAGRAM_ACCOUNT_ID && String(entry.id) !== config.INSTAGRAM_ACCOUNT_ID) continue;
      await handleInstagramComment(change.value ?? {}, { ...context, sentAt: entry.time ? Number(entry.time) * (Number(entry.time) < 1e12 ? 1000 : 1) : context.receivedAt });
    }
    const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];

    if (messagingEvents.length === 0) {
      logger.info("Instagram entry carried no messaging events", { keys: Object.keys(entry ?? {}) });
    }

    for (const event of messagingEvents) {
      const message = event.message;
      if (!message) {
        logger.info("Instagram event skipped: not a message", { keys: Object.keys(event ?? {}) });
        continue;
      }

      // An echo is our own outbound message coming back. Acting on it would
      // make the bot answer itself forever.
      if (message.is_echo) {
        logger.info("Instagram message skipped: echo of our own message");
        continue;
      }
      if (message.is_deleted || message.is_unsupported) {
        logger.info("Instagram message skipped: deleted or unsupported");
        continue;
      }

      const igsid = event.sender?.id;
      const mid = message.mid;
      if (!igsid || !mid) {
        logger.info("Instagram message skipped: missing sender id or message id");
        continue;
      }

      // Never reply to ourselves even if is_echo is missing on some payload.
      if (igsid === config.INSTAGRAM_ACCOUNT_ID || igsid === config.FACEBOOK_PAGE_ID) {
        logger.info("Instagram message skipped: sender is our own account", { igsid });
        continue;
      }

      const text = typeof message.text === "string" ? message.text.trim() : "";
      if (!text) {
        // Media-only messages still deserve a place in the transcript.
        await eventsRepo.log(null, "instagram_non_text", { igsid, mid });
        continue;
      }

      if (!(await claim(`ig:${mid}`))) {
        logger.info("Instagram webhook redelivery ignored", { mid });
        continue;
      }

      const referral = message.referral ?? event.referral;
      const referralRef = referral?.ad_id ?? referral?.ref ?? null;

      await handleInstagramMessage({
        ...context,
        sentAt: event.timestamp ? Number(event.timestamp) : undefined,
        igsid,
        text,
        messageId: mid,
        referralRef,
        source: referralRef ? "instagram_ad" : "instagram_dm",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

webhooksRouter.get("/whatsapp", handleVerification);

webhooksRouter.post("/whatsapp", async (req, res) => {
  if (!signatureOk(req, "whatsapp")) {
    logger.warn("WhatsApp webhook rejected: bad signature");
    res.sendStatus(403);
    return;
  }

  await enqueueWebhook("whatsapp", req.body);
  res.sendStatus(200);
  void drainInbox().catch(() => logger.error("WhatsApp inbox drain failed"));
});

async function processWhatsAppPayload(payload, context = {}) {
  for (const entry of readEntries(payload)) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change.value;
      if (!value) continue;

      // Delivery receipts carry the only trustworthy statement about what a
      // message actually cost, so they are recorded verbatim.
      for (const status of value.statuses ?? []) {
        if (!status.id) continue;
        if (!(await claim(`wa-status:${status.id}:${status.status ?? "unknown"}`))) continue;

        const pricing = whatsapp.readPricing(status);
        await messagesRepo.mergeMeta(status.id, {
          deliveryStatus: status.status ?? null,
          ...(pricing
            ? {
                billedCategory: pricing.category ?? null,
                billable: pricing.billable ?? null,
                pricingModel: pricing.pricingModel ?? null,
                pricingType: pricing.type ?? null,
              }
            : {}),
        });
      }

      const profileName = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages ?? []) {
        const id = message.id;
        const from = message.from;
        if (!id || !from) continue;

        const text =
          message.text?.body ??
          message.button?.text ??
          message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          "";

        if (!text.trim()) continue;
        if (!(await claim(`wa:${id}`))) continue;

        await handleWhatsAppMessage({
          ...context,
          sentAt: message.timestamp ? Number(message.timestamp) * 1000 : undefined,
          from,
          text: text.trim(),
          messageId: id,
          profileName,
        });
      }
    }
  }
}

registerWebhookHandler("instagram", processInstagramPayload);
registerWebhookHandler("whatsapp", processWhatsAppPayload);
