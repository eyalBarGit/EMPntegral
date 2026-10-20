import { describe, it, expect } from "vitest";
import { matchesOpening, matchesRules } from "../src/lib/triggers.js";
describe("opening prefixes", () => {
  it.each([
    "שלום, אפשר לקבל מידע נוסף על זה?", "אשמח לקבל פרטים על המסלול", 
    "  שלום אפשר לקבל מידע נוסף על זה ? עוד שאלה",
    "Hello, can I get more information about this?", "HI! Can I get more info about this?",
    "I'd like to get more details", "I’d like more details about the course",
  ])("accepts %s", text => expect(matchesOpening(text)).toBe(true));
  it.each(["שלום", "היי", "0501234567", "אפשר פרטים", "לא אשמח לקבל פרטים", "הוא כתב אשמח לקבל פרטים", "אשמח לקבל פרטיםאחרים", "Hello", "Can I get more information about this?"])("rejects %s", text => expect(matchesOpening(text)).toBe(false));
});

describe("configurable rule matching", () => {
  it("matches any selected rule with different modes", () => {
    const rules = [{ mode: "starts_with", text: "אשמח לקבל פרטים" }, { mode: "contains", text: "לימודי מוזיקה" }];
    expect(matchesRules("שלום מעניין אותי לימודי מוזיקה אצלכם", rules)).toBe(true);
    expect(matchesRules("כתבתי אשמח לקבל פרטים", rules)).toBe(false);
    expect(matchesRules("אשמח לקבל פרטים בבקשה", rules)).toBe(true);
    expect(matchesRules("לימודי מוזיקה", [])).toBe(false);
    expect(matchesRules("Hi, MORE details please!", [{ mode: "contains", text: "more details" }])).toBe(true);
    expect(matchesRules("details", [{ mode: "contains", text: "tail" }])).toBe(false);
  });
});
