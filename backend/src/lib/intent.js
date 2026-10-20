import { todayIn, zonedToUtc } from "./time.js";

/**
 * Strips niqqud and punctuation and pads with spaces, so that phrase lookups
 * can use plain `includes` with surrounding spaces as word boundaries.
 * JavaScript's \b does not work on Hebrew letters, hence this approach.
 */
function normalize(text) {
  const withoutNiqqud = text.replace(/[\u0591-\u05C7]/g, "");
  const cleaned = withoutNiqqud
    .replace(/["'`׳״]/g, "")
    .replace(/[^\p{L}\p{N}:]+/gu, " ")
    .trim()
    .toLowerCase();
  return ` ${cleaned} `;
}

const contains = (haystack, phrase) => haystack.includes(` ${phrase} `);
const containsAny = (haystack, phrases) => phrases.some((p) => contains(haystack, p));

// Checked before the positive list, because "לא פנוי" contains "פנוי".
const NEGATIVE_PHRASES = [
  "לא",
  "לא עכשיו",
  "לא פנוי",
  "לא פנויה",
  "לא זמין",
  "לא זמינה",
  "לא יכול",
  "לא יכולה",
  "לא מתאים",
  "עסוק",
  "עסוקה",
  "בעבודה",
  "בשיעור",
  "בנהיגה",
  "נוהג",
  "אחכ",
  "מאוחר יותר",
  "בהמשך",
  "אחר כך",
  "תתקשר אחר כך",
  "busy",
  "later",
  "no",
];

const POSITIVE_PHRASES = [
  "כן",
  "פנוי",
  "פנויה",
  "זמין",
  "זמינה",
  "אפשר",
  "בטח",
  "בהחלט",
  "כמובן",
  "יאללה",
  "סבבה",
  "אוקיי",
  "אוקי",
  "בסדר",
  "מתאים",
  "עכשיו",
  "מעולה",
  "תתקשר",
  "תתקשרי",
  "דבר",
  "נדבר",
  "ok",
  "okay",
  "yes",
  "sure",
];

/**
 * Reads a reply to "are you free for a short call?".
 * Returns "unknown" whenever the answer is ambiguous, so the flow can fall
 * back to asking a human instead of guessing.
 *
 * @returns {"available"|"unavailable"|"unknown"}
 */
export function detectAvailability(text) {
  const normalized = normalize(text);
  if (normalized.trim().length === 0) return "unknown";

  // "לא עכשיו, אבל אפשר מחר" hits both lists; the refusal is the real answer.
  if (containsAny(normalized, NEGATIVE_PHRASES)) return "unavailable";
  if (containsAny(normalized, POSITIVE_PHRASES)) return "available";
  return "unknown";
}

const DAY_OFFSETS = [
  ["מחרתיים", 2],
  ["מחר", 1],
  ["היום", 0],
  ["הערב", 0],
];

const WEEKDAYS = [
  ["ראשון", 0],
  ["שני", 1],
  ["שלישי", 2],
  ["רביעי", 3],
  ["חמישי", 4],
  ["שישי", 5],
  ["שבת", 6],
];

/** Shifts a bare hour into the afternoon when the wording implies it. */
function applyDaypart(hour, normalized) {
  const isAfternoon =
    contains(normalized, "אחהצ") ||
    contains(normalized, "אחרי הצהריים") ||
    contains(normalized, "בצהריים") ||
    contains(normalized, "בערב") ||
    contains(normalized, "הערב") ||
    contains(normalized, "בלילה");
  const isMorning = contains(normalized, "בבוקר") || contains(normalized, "בוקר");

  if (isMorning && hour === 12) return 0;
  if (isAfternoon && hour < 12) return hour + 12;
  // "נדבר ב-8" in the evening is more likely than 8am for a sales call, but
  // guessing is worse than being literal, so only explicit words shift it.
  return hour;
}

/**
 * Extracts a requested call time from Hebrew free text.
 * Handles "מחר ב-18:00", "היום בשעה 20", "בעוד שעתיים", "ביום שלישי ב-10".
 * Returns null when nothing parseable is found; the caller stores the raw text.
 *
 * @returns {{at: Date, raw: string}|null}
 */
export function parsePreferredTime(text, timeZone, now = new Date()) {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  const normalized = normalize(text);

  // Relative: "בעוד 20 דקות" / "בעוד שעה" / "בעוד שעתיים"
  const relative = /בעוד (\d+)? ?(דקות|דקה|שעות|שעה|שעתיים)/.exec(normalized);
  if (relative) {
    const unit = relative[2];
    let amount = relative[1] ? Number.parseInt(relative[1], 10) : 1;
    if (unit === "שעתיים") amount = 2;
    const minutes = unit === "דקות" || unit === "דקה" ? amount : amount * 60;
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 60 * 24 * 14) {
      return { at: new Date(now.getTime() + minutes * 60_000), raw: text.trim() };
    }
  }

  const hourMatch =
    /(?:^| )(?:ב|בשעה|בשעה ב|שעה) ?(\d{1,2})[:.](\d{2})(?:$| )/.exec(normalized) ??
    /(?:^| )(\d{1,2})[:.](\d{2})(?:$| )/.exec(normalized) ??
    /(?:^| )(?:ב|בשעה|שעה) ?(\d{1,2})(?:$| )/.exec(normalized);

  if (!hourMatch) return null;

  let hour = Number.parseInt(hourMatch[1] ?? "", 10);
  const minute = hourMatch[2] ? Number.parseInt(hourMatch[2], 10) : 0;
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;

  hour = applyDaypart(hour, normalized);
  if (hour > 23) return null;

  const today = todayIn(timeZone, now);
  let dayShift = null;

  for (const [word, offset] of DAY_OFFSETS) {
    if (normalized.includes(word)) {
      dayShift = offset;
      break;
    }
  }

  if (dayShift === null) {
    for (const [word, weekday] of WEEKDAYS) {
      if (normalized.includes(`יום ${word}`)) {
        const currentWeekday = new Date(
          zonedToUtc(today.year, today.month, today.day, 12, 0, timeZone),
        ).getUTCDay();
        dayShift = (weekday - currentWeekday + 7) % 7 || 7;
        break;
      }
    }
  }

  const base = zonedToUtc(
    today.year,
    today.month,
    today.day + (dayShift ?? 0),
    hour,
    minute,
    timeZone,
  );

  // A bare time that already passed today obviously means tomorrow.
  const at =
    dayShift === null && base.getTime() <= now.getTime()
      ? zonedToUtc(today.year, today.month, today.day + 1, hour, minute, timeZone)
      : base;

  return { at, raw: text.trim() };
}
