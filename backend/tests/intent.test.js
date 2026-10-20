import { describe, expect, it } from "vitest";
import { detectAvailability, parsePreferredTime } from "../src/lib/intent.js";

const TZ = "Asia/Jerusalem";

describe("detectAvailability", () => {
  it("reads a positive answer", () => {
    expect(detectAvailability("כן")).toBe("available");
    expect(detectAvailability("כן בטח, אפשר עכשיו")).toBe("available");
    expect(detectAvailability("פנוי")).toBe("available");
    expect(detectAvailability("יאללה תתקשר")).toBe("available");
  });

  it("reads a refusal", () => {
    expect(detectAvailability("לא")).toBe("unavailable");
    expect(detectAvailability("לא פנוי כרגע")).toBe("unavailable");
    expect(detectAvailability("אני עסוק בעבודה")).toBe("unavailable");
  });

  it("treats a refusal that mentions a positive word as a refusal", () => {
    expect(detectAvailability("לא עכשיו, אפשר מחר")).toBe("unavailable");
  });

  it("gives up on ambiguous text instead of guessing", () => {
    expect(detectAvailability("כמה זה עולה?")).toBe("unknown");
    expect(detectAvailability("")).toBe("unknown");
    expect(detectAvailability("🙂")).toBe("unknown");
  });
});

describe("parsePreferredTime", () => {
  // Sunday 2026-08-02, 09:00 Israel time.
  const now = new Date("2026-08-02T06:00:00.000Z");

  const hourIn = (date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);

  const dayIn = (date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "short" }).format(date);

  it("parses an explicit time later today", () => {
    const parsed = parsePreferredTime("היום ב-18:00", TZ, now);
    expect(parsed).not.toBeNull();
    expect(hourIn(parsed.at)).toBe("18:00");
    expect(dayIn(parsed.at)).toBe("2026-08-02");
  });

  it("parses tomorrow with a bare hour", () => {
    const parsed = parsePreferredTime("מחר בשעה 10", TZ, now);
    expect(parsed).not.toBeNull();
    expect(hourIn(parsed.at)).toBe("10:00");
    expect(dayIn(parsed.at)).toBe("2026-08-03");
  });

  it("shifts a bare hour into the evening when the wording says so", () => {
    const parsed = parsePreferredTime("מחר ב-8 בערב", TZ, now);
    expect(parsed).not.toBeNull();
    expect(hourIn(parsed.at)).toBe("20:00");
  });

  it("rolls a time that already passed today over to tomorrow", () => {
    const parsed = parsePreferredTime("ב-07:00", TZ, now);
    expect(parsed).not.toBeNull();
    expect(dayIn(parsed.at)).toBe("2026-08-03");
  });

  it("handles relative phrasing", () => {
    const inTwoHours = parsePreferredTime("בעוד שעתיים", TZ, now);
    expect(inTwoHours.at.getTime()).toBe(now.getTime() + 2 * 3600_000);

    const inTwentyMinutes = parsePreferredTime("בעוד 20 דקות", TZ, now);
    expect(inTwentyMinutes.at.getTime()).toBe(now.getTime() + 20 * 60_000);
  });

  it("keeps the original wording for display", () => {
    expect(parsePreferredTime("מחר ב-18:00", TZ, now).raw).toBe("מחר ב-18:00");
  });

  it("returns null when there is no time in the text", () => {
    expect(parsePreferredTime("אני לא פנוי", TZ, now)).toBeNull();
    expect(parsePreferredTime("", TZ, now)).toBeNull();
  });
});
