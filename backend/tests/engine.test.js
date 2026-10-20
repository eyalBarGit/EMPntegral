import { setWelcomeText } from "../src/db/settings.js";
import { setTriggerRules } from "../src/db/settings.js";
import { setAutomation, getAutomation } from "../src/db/settings.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above the file body, so the spies they close
// over have to be created by vi.hoisted rather than as plain consts.
const { igSendText, igFetchProfile, waSendTemplate, waSendText, telegramSend } = vi.hoisted(
  () => ({
    igSendText: vi.fn(async () => ({ ok: true, messageId: "mid.out.1" })),
    igFetchProfile: vi.fn(async () => ({ username: "dana_test", name: "דנה" })),
    waSendTemplate: vi.fn(async () => ({ ok: false, skipped: "disabled", payload: {} })),
    waSendText: vi.fn(async () => ({ ok: false, skipped: "disabled", payload: {} })),
    telegramSend: vi.fn(async () => true),
  }),
);

vi.mock("../src/channels/instagram.js", () => ({
  sendText: igSendText,
  fetchProfile: igFetchProfile,
}));

vi.mock("../src/channels/whatsapp.js", () => ({
  sendTemplate: waSendTemplate,
  sendText: waSendText,
  readPricing: () => null,
}));

vi.mock("../src/channels/telegram.js", () => ({
  sendAlert: telegramSend,
  escapeHtml: (v) => v,
}));

import * as leadsRepo from "../src/db/leads.js";
import * as messagesRepo from "../src/db/messages.js";
import { handleInstagramMessage, handleWhatsAppMessage } from "../src/flow/engine.js";
import { IG_WELCOME } from "../src/flow/templates.js";

const IGSID = "5551234567890";

const inbound = (text, messageId, igsid = IGSID) => ({
  igsid,
  text,
  messageId,
  source: "instagram_dm",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("first contact", () => {
  it("creates a lead and sends the opening message exactly once", async () => {
    const result = await handleInstagramMessage(
      inbound("שלום, אפשר לקבל מידע נוסף על זה?", "mid.1"),
    );

    expect(result.action).toBe("welcome_sent");

    const lead = await leadsRepo.findByIgId(IGSID);
    expect(lead.status).toBe("awaiting_phone");
    expect(lead.welcome_sent_at).toBeTruthy();
    expect(igSendText).toHaveBeenCalledTimes(1);
    expect(igSendText).toHaveBeenCalledWith(IGSID, IG_WELCOME);
  });

  it("does not greet the same person again on later messages", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    igSendText.mockClear();

    const second = await handleInstagramMessage(inbound("יש עוד פרטים?", "mid.2"));
    const third = await handleInstagramMessage(inbound("הלו?", "mid.3"));

    expect(second.action).toBe("stored_only");
    expect(third.action).toBe("stored_only");
    expect(igSendText).not.toHaveBeenCalled();
    expect(await leadsRepo.list()).toHaveLength(1);
  });

  it("enriches the lead with the Instagram profile", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    const lead = await leadsRepo.findByIgId(IGSID);
    expect(lead.ig_username).toBe("dana_test");
    expect(lead.name).toBe("דנה");
  });
});

describe("duplicate protection", () => {
  it("ignores a replayed message id without replying twice", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    igSendText.mockClear();

    const replay = await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));

    expect(replay.action).toBe("stored_only");
    expect(igSendText).not.toHaveBeenCalled();

    const lead = await leadsRepo.findByIgId(IGSID);
    expect(await messagesRepo.listForLead(lead.id)).toHaveLength(2);
  });

  it("keeps one lead row when the same person writes repeatedly", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    await handleInstagramMessage(inbound("עוד שאלה", "mid.2"));
    expect(await leadsRepo.list()).toHaveLength(1);
  });

  it("converges on a single lead when two deliveries race", async () => {
    // Mongo's unique index on ig_id is what makes this safe; without it the
    // two concurrent inserts would both succeed.
    await Promise.all([
      handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.a")),
      handleInstagramMessage(inbound("אשמח לקבל פרטים שוב", "mid.b")),
    ]);

    expect(await leadsRepo.list()).toHaveLength(1);
  });
});

describe("phone capture", () => {
  it("stores the number, moves the status and confirms on Instagram", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    igSendText.mockClear();
    telegramSend.mockClear();

    const result = await handleInstagramMessage(inbound("050-123-4567", "mid.2"));

    expect(result.action).toBe("phone_captured");

    const lead = await leadsRepo.findByIgId(IGSID);
    expect(lead.phone).toBe("+972501234567");
    expect(lead.status).toBe("phone_received");

    expect(igSendText).toHaveBeenCalledTimes(1);
    expect(telegramSend).toHaveBeenCalled();
  });

  it("does not send WhatsApp while the channel is gated off", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    await handleInstagramMessage(inbound("0501234567", "mid.2"));

    // The adapter is invoked so the intent is recorded, but it refuses to
    // transmit and the lead stays in phone_received.
    expect(waSendTemplate).toHaveBeenCalledTimes(1);

    const lead = await leadsRepo.findByIgId(IGSID);
    expect(lead.status).toBe("phone_received");
    expect(lead.whatsapp_sent_at).toBeNull();
  });

  it("does not mistake a course number for a phone number", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    const result = await handleInstagramMessage(inbound("מעניין אותי מסלול 2026", "mid.2"));

    expect(result.action).toBe("stored_only");
    expect((await leadsRepo.findByIgId(IGSID)).phone).toBeNull();
  });

  it("routes a number that already belongs to someone else to manual handling", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    await handleInstagramMessage(inbound("0501234567", "mid.2"));

    const other = "9998887776665";
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.3", other));
    const result = await handleInstagramMessage(inbound("0501234567", "mid.4", other));

    expect(result.action).toBe("duplicate_phone");

    const otherLead = await leadsRepo.findByIgId(other);
    expect(otherLead.status).toBe("manual");
    expect(otherLead.phone).toBeNull();
  });

  it("allows many leads to coexist without a phone number", async () => {
    // A plain unique index would reject the second null; the partial index on
    // string values is what makes this work.
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1", "1111"));
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.2", "2222"));
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.3", "3333"));

    const all = await leadsRepo.list();
    expect(all).toHaveLength(3);
    expect(all.every((lead) => lead.phone === null)).toBe(true);
  });
});

describe("manual override", () => {
  it("sends nothing once automation is paused", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    const lead = await leadsRepo.findByIgId(IGSID);
    await leadsRepo.update(lead.id, { automation_paused: true });
    igSendText.mockClear();

    const result = await handleInstagramMessage(inbound("0501234567", "mid.2"));

    expect(result.action).toBe("automation_paused");
    expect(igSendText).not.toHaveBeenCalled();
    expect((await leadsRepo.findByIgId(IGSID)).phone).toBeNull();
  });

  it("sends nothing for a lead that was closed", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "mid.1"));
    const lead = await leadsRepo.findByIgId(IGSID);
    await leadsRepo.update(lead.id, { status: "not_relevant" });
    igSendText.mockClear();

    const result = await handleInstagramMessage(inbound("היי שוב", "mid.2"));

    expect(result.action).toBe("automation_paused");
    expect(igSendText).not.toHaveBeenCalled();
  });
});

 describe("delivery recovery and scheduling", () => {
  it("allows another greeting attempt after a send failure", async () => {
    igSendText.mockResolvedValueOnce({ ok: false, error: "network error" });
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "failed.1"));
    expect((await leadsRepo.findByIgId(IGSID)).welcome_sent_at).toBeNull();
    await handleInstagramMessage(inbound("אשמח לקבל פרטים שוב", "failed.2"));
    expect((await leadsRepo.findByIgId(IGSID)).welcome_sent_at).not.toBeNull();
    expect(igSendText).toHaveBeenCalledTimes(2);
  });

  it("sends one greeting for concurrent distinct messages", async () => {
    await Promise.all([
      handleInstagramMessage(inbound("אשמח לקבל פרטים", "race.1")),
      handleInstagramMessage(inbound("אשמח לקבל פרטים", "race.2")),
    ]);
    expect(igSendText).toHaveBeenCalledTimes(1);
  });

  it("prefers an explicit appointment over a positive word", async () => {
    await handleInstagramMessage(inbound("אשמח לקבל פרטים 0501234567", "schedule.1"));
    await handleWhatsAppMessage({ from: "972501234567", text: "כן מחר בשעה 18:00", messageId: "schedule.2" });
    const lead = await leadsRepo.findByIgId(IGSID);
    expect(lead.status).toBe("call_scheduled");
    expect(lead.call_time).not.toBeNull();
  });
 });

 describe("global automation switch", () => {
  it("persists off state and stores messages without replying", async () => {
    await setAutomation(false);
    expect((await getAutomation()).enabled).toBe(false);
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "off.1"));
    const lead = await leadsRepo.findByIgId(IGSID);
    expect(lead).toBeDefined();
    expect(await messagesRepo.listForLead(lead.id)).toHaveLength(1);
    expect(igSendText).not.toHaveBeenCalled();
    await setAutomation(true);
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "on.1"));
    expect(igSendText).toHaveBeenCalledTimes(1);
  });

  it("does not reply to queued disabled messages or delayed old messages after enabling", async () => {
    await setAutomation(false);
    const oldTime = new Date(Date.now() - 10000);
    await setAutomation(true);
    await handleInstagramMessage({ ...inbound("אשמח לקבל פרטים", "queued.1"), automationAllowed: false });
    await handleInstagramMessage({ ...inbound("אשמח לקבל פרטים", "late.1"), sentAt: oldTime });
    expect(igSendText).not.toHaveBeenCalled();
    expect(await messagesRepo.listForLead((await leadsRepo.findByIgId(IGSID)).id)).toHaveLength(2);
  });
 });

describe("restricted automation entry", () => {
  it("stores unrelated messages and phone numbers without replying, then starts on a matching prefix", async () => {
    await handleInstagramMessage(inbound("היי מה נשמע", "unrelated.1"));
    await handleInstagramMessage(inbound("0501234567", "unrelated.2"));
    expect(igSendText).not.toHaveBeenCalled();
    expect((await leadsRepo.findByIgId(IGSID)).phone).toBeNull();
    await handleInstagramMessage(inbound("אשמח לקבל פרטים על הקורס", "matching.1"));
    expect(igSendText).toHaveBeenCalledTimes(1);
    await handleInstagramMessage(inbound("0501234567", "matching.2"));
    expect((await leadsRepo.findByIgId(IGSID)).phone).toBe("+972501234567");
  });
});

describe("saved trigger configuration", () => {
  it("uses customized contains rules instead of the defaults", async () => {
    await setTriggerRules([{ mode: "contains", text: "לימודי מוזיקה" }]);
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "custom.1"));
    expect(igSendText).not.toHaveBeenCalled();
    await handleInstagramMessage(inbound("היי רוצה לשמוע על לימודי מוזיקה אצלכם", "custom.2"));
    expect(igSendText).toHaveBeenCalledTimes(1);
  });
});

describe("editable opening message", () => {
  it("sends the saved dashboard text for a matching opening", async () => {
    await setWelcomeText("היי! תודה שפנית. מה מספר הטלפון שלך?");
    await handleInstagramMessage(inbound("אשמח לקבל פרטים", "editable.1"));
    expect(igSendText).toHaveBeenCalledWith(IGSID, "היי! תודה שפנית. מה מספר הטלפון שלך?");
  });
});
