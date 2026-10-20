/**
 * Time helpers that work in the business timezone reported by the API, rather
 * than in the browser's timezone. The dashboard, the Telegram alerts and the
 * reminder job must all agree on what "18:00" means.
 */

const cache = new Map();

function formatter(timeZone) {
  let existing = cache.get(timeZone);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    cache.set(timeZone, existing);
  }
  return existing;
}

function partsIn(date, timeZone) {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type) => Number.parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (value) => String(value).padStart(2, "0");

/** ISO instant to the "YYYY-MM-DDTHH:mm" a datetime-local input expects. */
export function toLocalInput(iso, timeZone) {
  if (!iso) return "";
  const p = partsIn(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The reverse: a wall-clock string in `timeZone` back to an ISO instant. */
export function fromLocalInput(value, timeZone) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match.map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);

  // Two correction passes settle the offset even across a DST boundary.
  const offsetAt = (ms) => {
    const p = partsIn(new Date(ms), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(first - offsetAt(first)).toISOString();
}

export function formatDateTime(iso, timeZone) {
  if (!iso) return "—";
  const p = partsIn(new Date(iso), timeZone);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatTime(iso, timeZone) {
  if (!iso) return "";
  const p = partsIn(new Date(iso), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

const UNITS = [
  [60, "שניות", 1],
  [3600, "דקות", 60],
  [86_400, "שעות", 3600],
];

/** Short relative label for list rows: "עכשיו", "לפני 5 דקות", "לפני 3 ימים". */
export function formatRelative(iso) {
  if (!iso) return "";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "עכשיו";

  for (const [limit, label, divisor] of UNITS) {
    if (seconds < limit) {
      const value = Math.round(seconds / divisor);
      return `לפני ${value} ${label}`;
    }
  }

  const days = Math.round(seconds / 86_400);
  if (days === 1) return "אתמול";
  if (days < 30) return `לפני ${days} ימים`;
  const months = Math.round(days / 30);
  return months === 1 ? "לפני חודש" : `לפני ${months} חודשים`;
}

/** How long until a scheduled call, used to highlight imminent ones. */
export function minutesUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}
