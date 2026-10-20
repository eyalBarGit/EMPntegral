import { matchesRules } from "../lib/triggers.js";

/** Specific reel configuration owns that reel, including its disabled/no-match state. */
export function selectCommentRule(settings, comment) {
  if (!settings.enabled) return null;
  const specific = (settings.overrides ?? []).find(rule => rule.mediaId === comment.media?.id);
  let rule;
  if (specific) {
    if (!specific.enabled) return null;
    rule = { ...specific, ruleKey: specific.mediaId };
  } else {
    if (settings.generalEnabled === false) return null;
    if (settings.scope === "selected" && !settings.mediaIds.includes(comment.media?.id)) return null;
    rule = { ...settings, enabledSince: settings.generalEnabledSince ?? settings.enabledSince, ruleKey: "general" };
  }
  if (rule.match === "keywords" && !matchesRules(comment.text, rule.keywords.map(text => ({ mode: "contains", text })))) return null;
  return rule;
}
