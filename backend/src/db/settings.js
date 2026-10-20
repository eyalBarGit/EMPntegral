import { IG_WELCOME } from "../flow/templates.js";
import { DEFAULT_TRIGGER_RULES } from "../lib/triggers.js";
import { getDb } from "./index.js";
import { config } from "../config.js";
const settings = () => getDb().collection("settings");

export async function getAutomation() {
  const doc = await settings().findOne({ _id: "automation" });
  return { enabled: doc?.enabled ?? config.AUTOMATION_ENABLED, enabledSince: doc?.enabled_since ?? null };
}

export async function setAutomation(enabled) {
  // Updating to the same value must not invalidate messages already in flight.
  await settings().updateOne({ _id: "automation" }, { $setOnInsert: { enabled: config.AUTOMATION_ENABLED, enabled_since: null } }, { upsert: true });
  await settings().updateOne({ _id: "automation", enabled: { $ne: enabled } }, {
    $set: { enabled, updated_at: new Date(), ...(enabled ? { enabled_since: new Date() } : {}) },
  });
  return getAutomation();
}

export async function canAutomate(inbound = {}) {
  const state = await getAutomation();
  if (!state.enabled || inbound.automationAllowed === false) return false;
  if (!state.enabledSince) return true;
  // The cutoff also excludes messages delivered late by Meta after re-enabling.
  const at = inbound.sentAt ?? inbound.receivedAt;
  return !at || new Date(at).getTime() >= state.enabledSince.getTime();
}

export async function getTriggerRules() {
  const doc = await settings().findOne({ _id: "trigger_rules" });
  return doc?.rules ?? DEFAULT_TRIGGER_RULES;
}
export async function setTriggerRules(rules) {
  await settings().updateOne({ _id: "trigger_rules" }, { $set: { rules, updated_at: new Date() } }, { upsert: true });
  return rules;
}

export const DEFAULT_COMMENT_SETTINGS = {
  enabled: false, generalEnabled: true, overrides: [], match: "all", keywords: [], scope: "all_reels", mediaIds: [],
  publicText: "שלחתי לך פרטים בפרטי 🙌", privateText: "היי! תודה על ההתעניינות. איך אפשר לעזור?", enabledSince: null,
};
export async function getCommentSettings() {
  const doc = await settings().findOne({ _id: "comment_automation" });
  if (!doc) return { ...DEFAULT_COMMENT_SETTINGS };
  const { _id, ...value } = doc;
  return { ...DEFAULT_COMMENT_SETTINGS, ...value };
}
export async function setCommentSettings(value) {
  const previous = await getCommentSettings();
  const enabledSince = value.enabled && !previous.enabled ? new Date() : previous.enabledSince;
  const generalEnabledSince = value.generalEnabled && previous.generalEnabled === false ? new Date() : previous.generalEnabledSince ?? null;
  const overrides = (value.overrides ?? previous.overrides ?? []).map(rule => {
    const old = previous.overrides?.find(item => item.mediaId === rule.mediaId);
    return { ...rule, enabledSince: rule.enabled && !old?.enabled ? new Date() : old?.enabledSince ?? null };
  });
  await settings().updateOne({ _id: "comment_automation" }, { $set: { ...value, overrides, enabledSince, generalEnabledSince } }, { upsert: true });
  return getCommentSettings();
}

export async function getWelcomeText() {
  const doc = await settings().findOne({ _id: "welcome_text" });
  return doc?.text ?? IG_WELCOME;
}
export async function setWelcomeText(text) {
  await settings().updateOne({ _id: "welcome_text" }, { $set: { text, updated_at: new Date() } }, { upsert: true });
  return text;
}
