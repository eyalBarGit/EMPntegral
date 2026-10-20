import { describe, expect, it } from "vitest";
import {
  extractPhone,
  formatForDisplay,
  normalizePhone,
  toWaMe,
} from "../src/lib/phone.js";

const IL = { defaultCountryCode: "972" };

describe("normalizePhone", () => {
  it("expands Israeli local mobile formats to E.164", () => {
    expect(normalizePhone("0501234567", IL)).toBe("+972501234567");
    expect(normalizePhone("050-123-4567", IL)).toBe("+972501234567");
    expect(normalizePhone("050 123 4567", IL)).toBe("+972501234567");
    expect(normalizePhone("(050) 123-4567", IL)).toBe("+972501234567");
  });

  it("accepts numbers that already carry a country code", () => {
    expect(normalizePhone("+972501234567", IL)).toBe("+972501234567");
    expect(normalizePhone("972501234567", IL)).toBe("+972501234567");
    expect(normalizePhone("00972501234567", IL)).toBe("+972501234567");
  });

  it("accepts a bare national mobile number", () => {
    expect(normalizePhone("501234567", IL)).toBe("+972501234567");
  });

  it("keeps foreign numbers as written", () => {
    expect(normalizePhone("+14155552671", IL)).toBe("+14155552671");
  });

  it("rejects things that are not phone numbers", () => {
    expect(normalizePhone("2025", IL)).toBeNull();
    expect(normalizePhone("12", IL)).toBeNull();
    expect(normalizePhone("", IL)).toBeNull();
    expect(normalizePhone("abc", IL)).toBeNull();
  });
});

describe("extractPhone", () => {
  it("finds a number inside a Hebrew sentence", () => {
    expect(extractPhone("היי, המספר שלי 050-123-4567 תודה", IL)).toBe("+972501234567");
    expect(extractPhone("אפשר לחזור אליי? 0521234567", IL)).toBe("+972521234567");
    expect(extractPhone("הנה: +972 54 987 6543", IL)).toBe("+972549876543");
  });

  it("ignores numbers that are clearly not phone numbers", () => {
    expect(extractPhone("כמה עולה מסלול 2025?", IL)).toBeNull();
    expect(extractPhone("אני בן 30 ומעוניין בקורס", IL)).toBeNull();
    expect(extractPhone("המחיר 12,500 שקל", IL)).toBeNull();
    expect(extractPhone("שלום, אפשר לקבל פרטים על מסלול הלימודים?", IL)).toBeNull();
  });

  it("returns null for text with no digits at all", () => {
    expect(extractPhone("שלום מה שלומך", IL)).toBeNull();
  });
});

describe("display helpers", () => {
  it("formats Israeli numbers the local way", () => {
    expect(formatForDisplay("+972501234567")).toBe("050-123-4567");
  });

  it("leaves foreign numbers untouched", () => {
    expect(formatForDisplay("+14155552671")).toBe("+14155552671");
  });

  it("builds a wa.me link without the plus sign", () => {
    expect(toWaMe("+972501234567")).toBe("https://wa.me/972501234567");
  });
});
