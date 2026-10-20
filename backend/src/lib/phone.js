const DIGITS_ONLY = /\D+/g;

/**
 * A candidate is a run of 8+ characters made of digits and common separators.
 * The surrounding lookarounds stop us from slicing a longer number in half.
 */
const CANDIDATE = /(?<![\d])(\+?[\d][\d\s\-().\u2013\u2014]{6,24}\d)(?![\d])/g;

/**
 * Converts a single phone-like string to E.164, or returns null if it does not
 * look like a real phone number.
 *
 * Israeli local forms ("050-123-4567", "0501234567") are expanded with the
 * default country code. Anything already carrying a "+" is trusted as-is.
 */
export function normalizePhone(raw, options = {}) {
  if (typeof raw !== "string") return null;

  const cc = (options.defaultCountryCode ?? "972").replace(DIGITS_ONLY, "");
  const trimmed = raw.trim();
  const hadPlus = trimmed.startsWith("+") || trimmed.startsWith("00");
  const digits = trimmed.replace(/^00/, "").replace(DIGITS_ONLY, "");

  if (digits.length === 0) return null;

  if (hadPlus) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  // Local notation: a leading zero is the national trunk prefix.
  if (digits.startsWith("0")) {
    const national = digits.slice(1);
    if (national.length < 8 || national.length > 11) return null;
    return `+${cc}${national}`;
  }

  // Already carries the country code but no plus sign.
  if (digits.startsWith(cc)) {
    const national = digits.slice(cc.length);
    if (national.length < 8 || national.length > 11) return null;
    return `+${cc}${national}`;
  }

  // Bare national number, e.g. "501234567" for an Israeli mobile.
  if (digits.length === 9 && digits.startsWith("5")) return `+${cc}${digits}`;

  // Any other bare digit run is too ambiguous to accept: it is far more likely
  // to be a price, a date or a course number than a phone number.
  return null;
}

/**
 * Scans free-form text and returns the first thing that is convincingly a
 * phone number. Deliberately conservative: a lead typing "the 2025 program"
 * must not create a bogus contact.
 */
export function extractPhone(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) return null;

  for (const match of text.matchAll(CANDIDATE)) {
    const candidate = match[1];
    if (!candidate) continue;

    const digits = candidate.replace(DIGITS_ONLY, "");
    const explicit = candidate.trim().startsWith("+");

    // Without a "+" we demand a shape that a plain quantity would not have.
    if (!explicit) {
      const cc = (options.defaultCountryCode ?? "972").replace(DIGITS_ONLY, "");
      const looksLocal = digits.startsWith("0") && digits.length >= 9 && digits.length <= 11;
      const looksInternational = digits.startsWith(cc) && digits.length >= 11;
      const looksBareMobile = digits.length === 9 && digits.startsWith("5");
      if (!looksLocal && !looksInternational && !looksBareMobile) continue;
    }

    const normalized = normalizePhone(candidate, options);
    if (normalized) return normalized;
  }

  return null;
}

/** Renders an E.164 number the way an Israeli reader expects to see it. */
export function formatForDisplay(e164) {
  const match = /^\+972(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (match) return `0${match[1]}-${match[2]}-${match[3]}`;
  return e164;
}

/** wa.me links want the digits with no plus sign. */
export const toWaMe = (e164) => `https://wa.me/${e164.replace(DIGITS_ONLY, "")}`;
