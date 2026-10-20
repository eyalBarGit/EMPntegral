import { matchesRules } from "../lib/triggers.js";
import { canAutomate, getTriggerRules, getWelcomeText } from "../db/settings.js";
import { config, whatsappConfigured } from "../config.js";
import * as instagram from "../channels/instagram.js";
import * as whatsapp from "../channels/whatsapp.js";
import * as leadsRepo from "../db/leads.js";
import * as messagesRepo from "../db/messages.js";
import * as eventsRepo from "../db/events.js";
import { nowDate } from "../db/index.js";
import { detectAvailability, parsePreferredTime } from "../lib/intent.js";
import { extractPhone } from "../lib/phone.js";
import { logger } from "../logger.js";
import * as alerts from "./alerts.js";
import { isTerminal } from "./statuses.js";
import * as copy from "./templates.js";

/**
 * Records an outbound Instagram message and keeps the lead's timestamps in
 * sync. Returns the updated lead.
 */
async function replyOnInstagram(lead, text, inbound) {
  if (!(await canAutomate(inbound))) return { ok: false, skipped: "automation_disabled" };
  const result = await instagram.sendText(lead.ig_id ?? "", text);

  await messagesRepo.record({
    leadId: lead.id,
    channel: "instagram",
    direction: "out",
    body: text,
    externalId: result.messageId ?? null,
    meta: result.ok ? null : { failed: true, reason: result.error ?? result.skipped },
  });

  if (!result.ok) {
    await eventsRepo.log(lead.id, "instagram_send_failed", {
      reason: result.error ?? result.skipped,
    });
  }

  if (result.ok) await leadsRepo.update(lead.id, { last_outbound_at: nowDate() });
  return result;
}

/**
 * Attempts the WhatsApp first-contact step. While WHATSAPP_ENABLED is false
 * this records the intent and leaves the lead in phone_received for manual
 * handling, without ever touching the phone number.
 */
async function attemptWhatsAppFirstContact(lead, inbound) {
  if (!(await canAutomate(inbound))) return lead;
  if (!lead.phone) return lead;

  const result = await whatsapp.sendTemplate(lead.phone, [lead.name ?? ""]);

  await messagesRepo.record({
    leadId: lead.id,
    channel: "whatsapp",
    direction: "out",
    body: copy.WA_FIRST_CONTACT,
    externalId: result.messageId ?? null,
    meta: {
      kind: "template",
      template: config.WHATSAPP_TEMPLATE_NAME || null,
      declaredCategory: config.WHATSAPP_TEMPLATE_CATEGORY,
      // Real category and billability arrive later via the status webhook.
      billedCategory: null,
      delivered: result.ok,
      ...(result.skipped ? { skipped: result.skipped } : {}),
      ...(result.error ? { error: result.error } : {}),
    },
  });

  if (!result.ok) {
    await eventsRepo.log(lead.id, "whatsapp_not_sent", {
      reason: result.skipped ?? result.error,
    });
    return lead;
  }

  await eventsRepo.log(lead.id, "whatsapp_sent", { messageId: result.messageId });
  return leadsRepo.update(lead.id, {
    status: "whatsapp_sent",
    whatsapp_sent_at: nowDate(),
    last_outbound_at: nowDate(),
  });
}

/**
 * Main entry point for an inbound Instagram direct message.
 *
 * Callers must have already filtered out echoes and claimed the message id for
 * idempotency; this function assumes it is running exactly once per message.
 */
export async function handleInstagramMessage(inbound) {
  inbound = { receivedAt: new Date(), ...inbound };
  const { lead: initial, created } = await leadsRepo.getOrCreateByIgId({
    igId: inbound.igsid,
    igUsername: inbound.username ?? null,
    name: inbound.name ?? null,
    source: inbound.source ?? (inbound.referralRef ? "instagram_ad" : "instagram_dm"),
    sourceRef: inbound.referralRef ?? null,
  });

  const stored = await messagesRepo.record({
    leadId: initial.id,
    channel: "instagram",
    direction: "in",
    body: inbound.text,
    externalId: inbound.messageId,
  });

  // The message id was already in the collection: a redelivery slipped past the
  // idempotency claim. Stop before doing anything with side effects.
  if (!stored) {
    return { leadId: initial.id, action: "stored_only" };
  }

  let lead = await leadsRepo.update(initial.id, { last_inbound_at: nowDate() });

  if (created) {
    await eventsRepo.log(lead.id, "lead_created", { source: lead.source });

    // Enriching the profile is best effort and must not block the reply.
    const profile = await instagram.fetchProfile(inbound.igsid);
    if (profile?.username || profile?.name) {
      lead = await leadsRepo.update(lead.id, {
        ig_username: lead.ig_username ?? profile.username ?? null,
        name: lead.name ?? profile.name ?? null,
      });
    }
    void alerts.alertNewConversation(lead, inbound.text);
  }

  if (lead.automation_paused || !(await canAutomate(inbound)) || isTerminal(lead.status)) {
    await eventsRepo.log(lead.id, "automation_skipped", { status: lead.status });
    return { leadId: lead.id, action: "automation_paused" };
  }

  // Continue an already opened flow, but never initiate one on unrelated DMs.
  if (!lead.welcome_sent_at && !matchesRules(inbound.text, await getTriggerRules())) {
    return { leadId: lead.id, action: "stored_only" };
  }

  // ---- Phone capture -----------------------------------------------------
  if (!lead.phone) {
    const phone = extractPhone(inbound.text, {
      defaultCountryCode: config.DEFAULT_COUNTRY_CODE,
    });

    if (phone) {
      const withPhone = await leadsRepo.attachPhone(lead.id, phone);

      if (!withPhone) {
        // The number already belongs to another lead. Never create a second
        // record for the same person; hand it to a human instead.
        await eventsRepo.log(lead.id, "duplicate_phone", { phone });
        lead = await leadsRepo.update(lead.id, { status: "manual" });
        void alerts.alertStatusChanged(lead);
        return { leadId: lead.id, action: "duplicate_phone" };
      }

      lead = await leadsRepo.update(withPhone.id, { status: "phone_received" });
      await eventsRepo.log(lead.id, "phone_captured", { phone });
      void alerts.alertPhoneReceived(lead);

      await replyOnInstagram(
        lead,
        whatsappConfigured() ? copy.IG_PHONE_RECEIVED : copy.IG_PHONE_RECEIVED_NO_WHATSAPP,
        inbound,
      );
      lead = await attemptWhatsAppFirstContact(lead, inbound);

      return { leadId: lead.id, action: "phone_captured" };
    }

    // No phone yet. The opening message goes out exactly once, ever.
    if (!lead.welcome_sent_at) {
      const claimed = await leadsRepo.claimWelcome(lead.id);
      if (!claimed) return { leadId: lead.id, action: "stored_only" };
      let succeeded = false;
      try {
        const result = await replyOnInstagram(claimed, await getWelcomeText(), inbound);
        succeeded = result.ok;
      } finally {
        lead = await leadsRepo.finishWelcome(lead.id, succeeded);
      }
      if (succeeded) await eventsRepo.log(lead.id, "welcome_sent");
      return { leadId: lead.id, action: succeeded ? "welcome_sent" : "welcome_failed" };
    }

    // Already greeted and still no number: stay quiet rather than nag.
    return { leadId: lead.id, action: "stored_only" };
  }

  // ---- Lead already has a phone -----------------------------------------
  // Conversation continues on WhatsApp; nothing automatic is sent back on
  // Instagram, but the message is stored and visible in the dashboard.
  return { leadId: lead.id, action: "stored_only" };
}

async function replyOnWhatsApp(lead, text, inbound) {
  if (!(await canAutomate(inbound))) return;
  if (!lead.phone) return;

  const result = await whatsapp.sendText(lead.phone, text);

  await messagesRepo.record({
    leadId: lead.id,
    channel: "whatsapp",
    direction: "out",
    body: text,
    externalId: result.messageId ?? null,
    meta: {
      kind: "text",
      delivered: result.ok,
      ...(result.skipped ? { skipped: result.skipped } : {}),
    },
  });

  if (result.ok) await leadsRepo.update(lead.id, { last_outbound_at: nowDate() });
}

/**
 * Inbound WhatsApp reply. Wired and tested, but unreachable until
 * WHATSAPP_ENABLED is turned on and a number is connected.
 */
export async function handleWhatsAppMessage(inbound) {
  inbound = { receivedAt: new Date(), ...inbound };
  const phone = inbound.from.startsWith("+") ? inbound.from : `+${inbound.from}`;
  const existing = await leadsRepo.findByPhone(phone);

  if (!existing) {
    logger.warn("WhatsApp message from an unknown number", { phone });
    return null;
  }

  const stored = await messagesRepo.record({
    leadId: existing.id,
    channel: "whatsapp",
    direction: "in",
    body: inbound.text,
    externalId: inbound.messageId,
  });
  if (!stored) return { leadId: existing.id, action: "stored_only" };

  let lead = await leadsRepo.update(existing.id, { last_inbound_at: nowDate() });

  if (lead.automation_paused || !(await canAutomate(inbound)) || isTerminal(lead.status)) {
    return { leadId: lead.id, action: "automation_paused" };
  }

  const availability = detectAvailability(inbound.text);

  const preferred = parsePreferredTime(inbound.text, config.TIMEZONE);

  if (preferred) {
    lead = await leadsRepo.update(lead.id, {
      status: "call_scheduled",
      call_time: preferred.at,
      call_time_raw: preferred.raw,
      reminder_sent_at: null,
    });
    await eventsRepo.log(lead.id, "call_scheduled", { at: preferred.at.toISOString() });
    void alerts.alertCallScheduled(lead);
    await replyOnWhatsApp(lead, copy.waConfirmScheduled(preferred.raw), inbound);
    return { leadId: lead.id, action: "stored_only" };
  }

  if (availability === "available" && lead.status !== "call_scheduled") {
    lead = await leadsRepo.update(lead.id, { status: "available" });
    await eventsRepo.log(lead.id, "lead_available");
    void alerts.alertAvailableNow(lead);
    await replyOnWhatsApp(lead, copy.WA_CONFIRM_AVAILABLE, inbound);
    return { leadId: lead.id, action: "stored_only" };
  }

  if (availability === "unavailable") {
    lead = await leadsRepo.update(lead.id, { status: "follow_up" });
    await eventsRepo.log(lead.id, "lead_unavailable");
    await replyOnWhatsApp(lead, copy.WA_ASK_WHEN, inbound);
    return { leadId: lead.id, action: "stored_only" };
  }

  // Ambiguous reply: a human reads it.
  lead = await leadsRepo.update(lead.id, { status: "manual" });
  await eventsRepo.log(lead.id, "needs_human", { text: inbound.text.slice(0, 200) });
  void alerts.alertStatusChanged(lead);
  return { leadId: lead.id, action: "stored_only" };
}
