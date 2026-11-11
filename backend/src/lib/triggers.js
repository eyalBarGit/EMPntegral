/** Explicit opening phrases only; punctuation/case/spacing are insignificant. */
export function normalizeOpening(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase()
    // Niqqud and other combining marks would otherwise split a word in two.
    .replace(/\p{M}/gu, "")
    .replace(/[’'"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const TRIGGER_TEMPLATES = [
  "שלום, אפשר לקבל מידע נוסף על זה?",
  "אשמח לקבל פרטים",
  "Hello, can I get more information about this?",
  "Hi, can I get more information about this?",
  "Hi, can I get more info about this?",
  "Hello, can I get more info about this?",
  "I'd like to get more details",
  "I'd like more details",
  "I would like to get more details",
  "I would like more details",
];

export const DEFAULT_TRIGGER_RULES = TRIGGER_TEMPLATES.map(text => ({ mode: "contains", text }));
export const OPENING_PREFIXES = TRIGGER_TEMPLATES.map(normalizeOpening);

export function matchesOpening(text) {
  const normalized = normalizeOpening(text);
  return OPENING_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix + " "));
}

// Hebrew attaches ו/ה/ב/כ/ל/מ/ש to the next word ("הקורס", "ולקבל"), so a
// Hebrew phrase still counts as a whole-word match after up to three of them.
const HEBREW_PREFIXES = "[ובכלמשה]{0,3}";
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when the phrase appears anywhere in the text as whole words. */
export function containsPhrase(text, phraseText) {
  const phrase = normalizeOpening(phraseText);
  if (!phrase) return false;
  const prefix = /^\p{Script=Hebrew}/u.test(phrase) ? HEBREW_PREFIXES : "";
  return new RegExp("(?:^| )" + prefix + escapeRegExp(phrase) + "(?= |$)", "u").test(normalizeOpening(text));
}

/**
 * Any saved phrase anywhere in the message triggers the reply. Older rules
 * saved as "starts_with" are matched the same way: people open with a greeting
 * ("היי, אשמח לקבל פרטים") far more often than with the exact phrase.
 */
export function matchesRules(text, rules) {
  return rules.some(rule => containsPhrase(text, rule.text));
}
