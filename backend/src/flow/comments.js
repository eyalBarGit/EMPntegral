import { config } from "../config.js";
import { getDb, isDuplicateKeyError } from "../db/index.js";
import { getCommentSettings, canAutomate } from "../db/settings.js";
import { selectCommentRule } from "./comment-rules.js";
import * as instagram from "../channels/instagram.js";
import * as leads from "../db/leads.js";
import * as messages from "../db/messages.js";
import * as events from "../db/events.js";
import { isTerminal } from "./statuses.js";

export async function handleInstagramComment(comment, context = {}) {
  const settings = await getCommentSettings();
  if (!settings.enabled || context.commentsAllowed === false || !(await canAutomate(context))) return;
  const receivedAt = context.receivedAt ?? new Date();
  const timestamp = comment.timestamp;
  const at = timestamp ? new Date(Number.isFinite(Number(timestamp)) ? Number(timestamp) * (Number(timestamp) < 1e12 ? 1000 : 1) : timestamp) : new Date(receivedAt);
  if (settings.enabledSince && at < settings.enabledSince) return;
  if (Date.now() - at.getTime() > 7 * 86400000) return;
  const sender = comment.from?.id;
  const mediaId = comment.media?.id;
  if (!comment.id || !sender || !mediaId || comment.parent_id || comment.verb === "remove") return;
  if (sender === config.INSTAGRAM_ACCOUNT_ID || sender === config.FACEBOOK_PAGE_ID) return;
  const rule = selectCommentRule(settings, comment);
  if (!rule || (rule.enabledSince && at < new Date(rule.enabledSince))) return;
  // Fetch authoritative media type: never auto-reply to a feed post as if it were a reel.
  const details = await instagram.fetchComment(comment.id);
  if (details.parent_id) return;
  if (details.timestamp && new Date(details.timestamp) < new Date(Math.max(Date.now() - 7 * 86400000, Math.max(settings.enabledSince ? new Date(settings.enabledSince).getTime() : 0, rule.enabledSince ? new Date(rule.enabledSince).getTime() : 0)))) return;
  const media = await instagram.fetchMedia(mediaId);
  if (media.media_product_type !== "REELS") return;
  const { lead } = await leads.getOrCreateByIgId({ igId: sender, igUsername: comment.from?.username, source: "instagram_reel", sourceRef: mediaId });
  await messages.record({ leadId: lead.id, channel: "instagram_comment", direction: "in", body: comment.text ?? "", externalId: "ig-comment:" + comment.id, meta: { mediaId, permalink: media.permalink } });
  if (lead.automation_paused || isTerminal(lead.status)) return;
  // Persistent claim has no TTL: a repeated webhook must never repeat external replies.
  try { await getDb().collection("comment_runs").insertOne({ _id: comment.id, lead_id: lead.id, media_id: mediaId, rule_key: rule.ruleKey, status: "processing", created_at: new Date() }); }
  catch (error) { if (isDuplicateKeyError(error)) return; throw error; }
  const allowed = async () => {
    const current = await getCommentSettings();
    const currentRule = selectCommentRule(current, comment);
    const currentLead = await leads.findById(lead.id);
    return currentRule?.ruleKey === rule.ruleKey && (!currentRule.enabledSince || at >= new Date(currentRule.enabledSince)) && current.enabled && (!current.enabledSince || at >= current.enabledSince) && await canAutomate(context) && !currentLead.automation_paused && !isTerminal(currentLead.status);
  };
  const record = async (channel, body, result) => messages.record({ leadId: lead.id, channel, direction: "out", body, externalId: result.messageId ?? null, meta: { commentId: comment.id, mediaId, failed: !result.ok, reason: result.error ?? result.skipped } });
  try {
    if (!(await allowed())) { await getDb().collection("comment_runs").updateOne({ _id: comment.id }, { $set: { status: "cancelled" } }); return; }
    const publicResult = await instagram.replyToComment(comment.id, rule.publicText);
    await record("instagram_comment", rule.publicText, publicResult);
    if (!publicResult.ok) throw new Error(publicResult.error ?? "Public reply not sent");
    await getDb().collection("comment_runs").updateOne({ _id: comment.id }, { $set: { public_sent_at: new Date() } });
    if (!(await allowed())) { await getDb().collection("comment_runs").updateOne({ _id: comment.id }, { $set: { status: "cancelled" } }); return; }
    const privateResult = await instagram.sendPrivateReply(comment.id, rule.privateText);
    await record("instagram", rule.privateText, privateResult);
    if (!privateResult.ok) throw new Error(privateResult.error ?? "Private reply not sent");
    await leads.update(lead.id, { last_outbound_at: new Date() });
    await getDb().collection("comment_runs").updateOne({ _id: comment.id }, { $set: { status: "done", private_sent_at: new Date() } });
    await events.log(lead.id, "comment_automation_sent", { commentId: comment.id, mediaId });
  } catch (error) {
    await getDb().collection("comment_runs").updateOne({ _id: comment.id }, { $set: { status: "failed", error: error.message } });
    await events.log(lead.id, "comment_automation_failed", { commentId: comment.id, reason: error.message });
  }
}
