/** Explicit opening phrases only; punctuation/case/spacing are insignificant. */
export function normalizeOpening(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase()
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

export const DEFAULT_TRIGGER_RULES = TRIGGER_TEMPLATES.map(text => ({ mode: "starts_with", text }));
export const OPENING_PREFIXES = TRIGGER_TEMPLATES.map(normalizeOpening);

export function matchesOpening(text) {
  const normalized = normalizeOpening(text);
  return OPENING_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(prefix + " "));
}

/** Contains matches complete words/phrases, avoiding partial-word false positives. */
export function matchesRules(text, rules) {
  const normalized = normalizeOpening(text);
  return rules.some(rule => {
    const phrase = normalizeOpening(rule.text);
    if (!phrase) return false;
    return rule.mode === "contains"
      ? (" " + normalized + " ").includes(" " + phrase + " ")
      : normalized === phrase || normalized.startsWith(phrase + " ");
  });
}
