import { getWelcomeText, setWelcomeText } from "../db/settings.js";
import { getCommentSettings, setCommentSettings } from "../db/settings.js";
import * as instagram from "../channels/instagram.js";
import { Router } from "express";
import { z } from "zod";
import {
  config,
  instagramConfigured,
  telegramConfigured,
  whatsappConfigured,
} from "../config.js";
import * as leadsRepo from "../db/leads.js";
import * as messagesRepo from "../db/messages.js";
import * as eventsRepo from "../db/events.js";
import { formatForDisplay, toWaMe, normalizePhone } from "../lib/phone.js";
import { isLeadStatus, LEAD_STATUSES, STATUS_LABELS } from "../flow/statuses.js";
import { getDb } from "../db/index.js";
import { TRIGGER_TEMPLATES, normalizeOpening } from "../lib/triggers.js";
import { getAutomation, setAutomation, getTriggerRules, setTriggerRules } from "../db/settings.js";
import { requireAuth } from "./auth.js";

export const apiRouter = Router();

apiRouter.use(requireAuth);

apiRouter.get("/meta", async (_req, res) => {
  const failedWebhooks = await getDb().collection("webhook_inbox").countDocuments({ status: "failed" });
  res.json({
    failedWebhooks,
    welcomeText: await getWelcomeText(),
    commentSettings: await getCommentSettings(),
    failedCommentRuns: await getDb().collection("comment_runs").countDocuments({ status: "failed" }),
    triggerRules: await getTriggerRules(),
    triggerTemplates: TRIGGER_TEMPLATES,
    statuses: LEAD_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    timezone: config.TIMEZONE,
    channels: {
      instagram: instagramConfigured(),
      whatsapp: whatsappConfigured(),
      whatsappEnabled: config.WHATSAPP_ENABLED,
      telegram: telegramConfigured(),
    },
    automationEnabled: (await getAutomation()).enabled,
  });
});

apiRouter.patch("/settings/automation", async (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  const state = await setAutomation(parsed.data.enabled);
  res.json({ automationEnabled: state.enabled });
});

const triggerSchema = z.object({ rules: z.array(z.object({
  mode: z.enum(["starts_with", "contains"]),
  text: z.string().trim().min(1).max(300).refine(text => Boolean(normalizeOpening(text))),
}).strict()).max(50) }).strict();
apiRouter.patch("/settings/triggers", async (req, res) => {
  const parsed = triggerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  res.json({ triggerRules: await setTriggerRules(parsed.data.rules) });
});

const commentSchema = z.object({
  enabled: z.boolean(), generalEnabled: z.boolean().default(true),
  overrides: z.array(z.object({
    mediaId: z.string().regex(/^\d+$/), enabled: z.boolean(),
    match: z.enum(["all", "keywords"]),
    keywords: z.array(z.string().trim().min(1).max(100).refine(text => Boolean(normalizeOpening(text)))).max(50),
    publicText: z.string().trim().min(1).max(2000),
    privateText: z.string().trim().min(1).max(1000).refine(text => Buffer.byteLength(text, "utf8") <= 1000),
  }).strict().refine(rule => !rule.enabled || rule.match !== "keywords" || rule.keywords.length > 0)).max(200).default([])
    .refine(rules => new Set(rules.map(rule => rule.mediaId)).size === rules.length),
  match: z.enum(["all", "keywords"]), scope: z.enum(["all_reels", "selected"]),
  keywords: z.array(z.string().trim().min(1).max(100).refine(text => Boolean(normalizeOpening(text)))).max(50),
  mediaIds: z.array(z.string().regex(/^\d+$/)).max(200),
  publicText: z.string().trim().min(1).max(2000),
  privateText: z.string().trim().min(1).max(1000).refine(text => Buffer.byteLength(text, "utf8") <= 1000),
}).strict().refine(value => !value.enabled || !value.generalEnabled || (value.match !== "keywords" || value.keywords.length > 0))
  .refine(value => !value.enabled || !value.generalEnabled || (value.scope !== "selected" || value.mediaIds.length > 0));
apiRouter.patch("/settings/comments", async (req, res) => {
  const parsed = commentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  res.json({ commentSettings: await setCommentSettings(parsed.data) });
});
apiRouter.get("/instagram/reels", async (req, res) => {
  try { res.json(await instagram.listReels(typeof req.query.after === "string" ? req.query.after : undefined)); }
  catch (error) { res.status(502).json({ error: "לא ניתן לטעון רילז: " + error.message }); }
});

apiRouter.patch("/settings/welcome", async (req, res) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(1000).refine(text => Buffer.byteLength(text, "utf8") <= 1000) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  res.json({ welcomeText: await setWelcomeText(parsed.data.text) });
});

const serialize = (lead) => ({
  ...lead,
  has_unread: Boolean(lead.last_inbound_at && (!lead.last_read_at || new Date(lead.last_inbound_at) > new Date(lead.last_read_at))),
  status_label: STATUS_LABELS[lead.status] ?? lead.status,
  phone_display: lead.phone ? formatForDisplay(lead.phone) : null,
  whatsapp_url: lead.phone ? toWaMe(lead.phone) : null,
  tel_url: lead.phone ? `tel:${lead.phone}` : null,
});

apiRouter.get("/leads", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;

  const hasPhone = req.query.hasPhone === "true";
  const [leads, counts] = await Promise.all([
    leadsRepo.list({
      hasPhone,
      status: status && isLeadStatus(status) ? status : undefined,
      search: search || undefined,
      limit: 300,
    }),
    leadsRepo.countByStatus({ hasPhone }),
  ]);

  res.json({ leads: leads.map(serialize), counts });
});

apiRouter.get("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const lead = Number.isFinite(id) ? await leadsRepo.findById(id) : undefined;
  if (!lead) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const [messages, events] = await Promise.all([
    messagesRepo.listForLead(lead.id),
    eventsRepo.listForLead(lead.id, 50),
  ]);

  res.json({ lead: serialize(lead), messages, events });
});

apiRouter.post("/leads/:id/read", async (req, res) => {
  const lead = await leadsRepo.findById(Number(req.params.id));
  if (!lead) return res.status(404).json({ error: "not_found" });
  const parsed = z.object({ through: z.string().datetime() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_body" });
  if (lead.last_inbound_at) {
    const through = new Date(Math.min(new Date(parsed.data.through).getTime(), new Date(lead.last_inbound_at).getTime()));
    await leadsRepo.markRead(lead.id, through);
  }
  res.json({ ok: true });
});

const patchSchema = z.object({
  status: z.string().optional(),
  notes: z.string().max(5000).optional(),
  name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  automation_paused: z.boolean().optional(),
  /** ISO instant, or null to clear the scheduled call. */
  call_time: z.string().datetime().nullable().optional(),
  call_time_raw: z.string().max(200).nullable().optional(),
});

apiRouter.patch("/leads/:id", async (req, res) => {
  const id = Number(req.params.id);
  const lead = Number.isFinite(id) ? await leadsRepo.findById(id) : undefined;
  if (!lead) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }

  const patch = {};
  const body = parsed.data;

  if (body.status !== undefined) {
    if (!isLeadStatus(body.status)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    patch.status = body.status;
    await eventsRepo.log(lead.id, "status_changed_manually", {
      from: lead.status,
      to: body.status,
    });
  }

  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.name !== undefined) patch.name = body.name;
  if (body.phone !== undefined) {
    patch.phone = body.phone.trim() ? normalizePhone(body.phone, { defaultCountryCode: config.DEFAULT_COUNTRY_CODE }) : null;
    if (body.phone.trim() && !patch.phone) {
      res.status(400).json({ error: "invalid_phone" });
      return;
    }
  }

  if (body.automation_paused !== undefined) {
    patch.automation_paused = body.automation_paused;
    await eventsRepo.log(
      lead.id,
      body.automation_paused ? "automation_paused" : "automation_resumed",
    );
  }

  if (body.call_time !== undefined) {
    patch.call_time = body.call_time;
    // A rescheduled call must be able to fire its reminder again.
    patch.reminder_sent_at = null;
    if (body.call_time && !body.call_time_raw) patch.call_time_raw = null;
  }
  if (body.call_time_raw !== undefined) patch.call_time_raw = body.call_time_raw;

  try {
    res.json({ lead: serialize(await leadsRepo.update(lead.id, patch)) });
  } catch (error) {
    // The only realistic failure is the unique phone index rejecting a number
    // that already belongs to another lead.
    if (patch.phone && error?.code === 11000) {
      res.status(409).json({ error: "phone_belongs_to_another_lead" });
      return;
    }
    throw error;
  }
});

/** Records a message you sent by hand, so the transcript stays complete. */
const noteSchema = z.object({ body: z.string().min(1).max(4000) });

apiRouter.post("/leads/:id/notes", async (req, res) => {
  const id = Number(req.params.id);
  const lead = Number.isFinite(id) ? await leadsRepo.findById(id) : undefined;
  if (!lead) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }

  await messagesRepo.record({
    leadId: lead.id,
    channel: "system",
    direction: "out",
    body: parsed.data.body,
    externalId: null,
    meta: { manual: true },
  });

  res.json({ messages: await messagesRepo.listForLead(lead.id) });
});
