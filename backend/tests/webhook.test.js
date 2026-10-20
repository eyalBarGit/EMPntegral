import * as messagesRepo from "../src/db/messages.js";
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { igSendText } = vi.hoisted(() => ({
  igSendText: vi.fn(async () => ({ ok: true, messageId: "mid.out" })),
}));

vi.mock("../src/channels/instagram.js", () => ({
  sendText: igSendText,
  fetchProfile: vi.fn(async () => null),
}));

vi.mock("../src/channels/telegram.js", () => ({
  sendAlert: vi.fn(async () => true),
  escapeHtml: (v) => v,
}));

import { createApp } from "../src/app.js";
import * as leadsRepo from "../src/db/leads.js";

const SECRET = "test-app-secret";
const IG_SECRET = "test-ig-app-secret";
const IGSID = "778899001122";

let server;
let baseUrl;

beforeAll(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
});

function igPayload(message, sender = IGSID) {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: "17841400000000000",
        time: Date.now(),
        messaging: [{ sender: { id: sender }, recipient: { id: "17841400000000000" }, message }],
      },
    ],
  });
}

/** Instagram Login and WhatsApp sign with different app secrets. */
const secretForPath = (path) => (path.includes("/instagram") ? IG_SECRET : SECRET);

async function post(path, body, signed = true, secret = secretForPath(path)) {
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signed ? { "x-hub-signature-256": signature } : {}),
    },
    body,
  });
}

/** The route answers 200 immediately and works afterwards, so poll briefly. */
async function waitFor(read, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

describe("verification handshake", () => {
  it("echoes the challenge for the right verify token", async () => {
    const response = await fetch(
      `${baseUrl}/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=42`,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("42");
  });

  it("refuses a wrong verify token", async () => {
    const response = await fetch(
      `${baseUrl}/webhooks/instagram?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`,
    );
    expect(response.status).toBe(403);
  });
});

describe("signature enforcement", () => {
  it("rejects an unsigned delivery", async () => {
    const response = await post("/webhooks/instagram", igPayload({ mid: "m1", text: "היי" }), false);
    expect(response.status).toBe(403);
    await settle();
    expect(await leadsRepo.list()).toHaveLength(0);
  });

  it("rejects a delivery whose body was modified", async () => {
    const body = igPayload({ mid: "m1", text: "היי" });
    const signature = `sha256=${crypto.createHmac("sha256", IG_SECRET).update(body).digest("hex")}`;
    const response = await fetch(`${baseUrl}/webhooks/instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-signature-256": signature },
      body: body.replace("היי", "אשמח לקבל פרטים"),
    });
    expect(response.status).toBe(403);
  });

  // Instagram Login signs with the Instagram app secret. Verifying it against
  // the Meta app secret rejects every real message, which is a failure that
  // looks like broken credentials rather than a wrong secret.
  it("rejects an Instagram delivery signed with the Meta app secret", async () => {
    const response = await post(
      "/webhooks/instagram",
      igPayload({ mid: "m-wrong-secret", text: "היי" }),
      true,
      SECRET,
    );
    expect(response.status).toBe(403);
    await settle();
    expect(await leadsRepo.list()).toHaveLength(0);
  });
});

describe("echo filtering", () => {
  it("ignores our own outbound message coming back as an echo", async () => {
    const response = await post(
      "/webhooks/instagram",
      igPayload({ mid: "m-echo", text: "הודעה שלנו", is_echo: true }),
    );
    expect(response.status).toBe(200);
    await settle();

    expect(await leadsRepo.list()).toHaveLength(0);
    expect(igSendText).not.toHaveBeenCalled();
  });

  it("ignores a message sent from the business account id", async () => {
    await post(
      "/webhooks/instagram",
      igPayload({ mid: "m-self", text: "היי" }, "17841400000000000"),
    );
    await settle();
    expect(await leadsRepo.list()).toHaveLength(0);
  });

  it("ignores deleted and unsupported messages", async () => {
    await post("/webhooks/instagram", igPayload({ mid: "m-del", text: "x", is_deleted: true }));
    await post("/webhooks/instagram", igPayload({ mid: "m-uns", is_unsupported: true }));
    await settle();
    expect(await leadsRepo.list()).toHaveLength(0);
  });
});

describe("delivery of a real message", () => {
  it("creates the lead and replies once", async () => {
    const response = await post(
      "/webhooks/instagram",
      igPayload({ mid: "m-real", text: "שלום, אפשר לקבל מידע נוסף על זה?" }),
    );
    expect(response.status).toBe(200);

    const lead = await waitFor(() => leadsRepo.findByIgId(IGSID));
    expect(lead.status).toBe("awaiting_phone");
    expect(igSendText).toHaveBeenCalledTimes(1);
  });

  it("does not act twice when Meta redelivers the same event", async () => {
    const body = igPayload({ mid: "m-dup", text: "אשמח לקבל פרטים" });

    await post("/webhooks/instagram", body);
    await waitFor(() => leadsRepo.findByIgId(IGSID));

    await post("/webhooks/instagram", body);
    await post("/webhooks/instagram", body);
    await settle();

    expect(await leadsRepo.list()).toHaveLength(1);
    expect(igSendText).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard API", () => {
  const login = async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-password" }),
    });
    return response.headers.getSetCookie().join("; ");
  };

  it("protects the global switch and exposes the saved value", async () => {
    const path = baseUrl + "/api/settings/automation";
    const options = { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) };
    expect((await fetch(path, options)).status).toBe(401);
    const cookie = await login();
    options.headers.cookie = cookie;
    const result = await fetch(path, options);
    expect(result.status).toBe(200);
    expect((await result.json()).automationEnabled).toBe(false);
    const meta = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    expect(meta.automationEnabled).toBe(false);
    const invalid = await fetch(path, { ...options, body: JSON.stringify({ enabled: "false" }) });
    expect(invalid.status).toBe(400);
  });

  it("saves multiple trigger rules, validates them, and supports no rules", async () => {
    const url = baseUrl + "/api/settings/triggers";
    const request = (rules, cookie) => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ rules }) });
    expect((await request([])).status).toBe(401);
    const cookie = await login();
    const rules = [{ mode: "starts_with", text: "hello" }, { mode: "contains", text: "פרטים" }];
    expect((await request(rules, cookie)).status).toBe(200);
    const meta = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    expect(meta.triggerRules).toEqual(rules);
    expect(meta.triggerTemplates).toContain("אשמח לקבל פרטים");
    expect((await request([{ mode: "contains", text: "???" }], cookie)).status).toBe(400);
    expect((await request([{ mode: "anything", text: "hello" }], cookie)).status).toBe(400);
    expect((await request([], cookie)).status).toBe(200);
  });

  it("protects and validates reel comment settings", async () => {
    const cookie = await login();
    const meta = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    const { enabledSince, ...settings } = meta.commentSettings;
    const update = (body, authenticated = true) => fetch(baseUrl + "/api/settings/comments", { method: "PATCH", headers: { "Content-Type": "application/json", ...(authenticated ? { cookie } : {}) }, body: JSON.stringify(body) });
    expect((await update(settings, false)).status).toBe(401);
    expect((await update({ ...settings, enabled: true, scope: "selected", mediaIds: [] })).status).toBe(400);
    expect((await update({ ...settings, enabled: true, match: "keywords", keywords: [] })).status).toBe(400);
    expect((await update({ ...settings, enabled: true, scope: "selected", mediaIds: ["123"], publicText: "תגובה", privateText: "פרטים" })).status).toBe(200);
    const saved = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    expect(saved.commentSettings.mediaIds).toEqual(["123"]);
    expect(saved.commentSettings.privateText).toBe("פרטים");
  });

  it("saves opening text and rejects empty or oversized messages", async () => {
    const cookie = await login();
    const update = (text, auth = true) => fetch(baseUrl + "/api/settings/welcome", { method: "PATCH", headers: { "Content-Type": "application/json", ...(auth ? { cookie } : {}) }, body: JSON.stringify({ text }) });
    expect((await update("שלום", false)).status).toBe(401);
    expect((await update(" ")).status).toBe(400);
    expect((await update("א".repeat(501))).status).toBe(400);
    expect((await update("תודה שפנית! מה הטלפון שלך?")).status).toBe(200);
    const meta = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    expect(meta.welcomeText).toBe("תודה שפנית! מה הטלפון שלך?");
  });

  it("returns latest previews and keeps unread state accurate across reads", async () => {
    const { lead } = await leadsRepo.getOrCreateByIgId({ igId: "preview-test" });
    const first = new Date(Date.now() - 10000);
    const second = new Date(Date.now() - 5000);
    await leadsRepo.update(lead.id, { last_inbound_at: second });
    await messagesRepo.record({ leadId: lead.id, channel: "instagram", direction: "in", body: "הודעה ראשונה", externalId: "preview1" });
    await messagesRepo.record({ leadId: lead.id, channel: "instagram", direction: "in", body: "הודעה אחרונה", externalId: "preview2" });
    const cookie = await login();
    const list = () => fetch(baseUrl + "/api/leads", { headers: { cookie } }).then(r => r.json());
    const read = through => fetch(baseUrl + "/api/leads/" + lead.id + "/read", { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ through }) });
    let data = await list();
    expect(data.leads[0].last_message).toBe("הודעה אחרונה");
    expect(data.leads[0].has_unread).toBe(true);
    await read(first.toISOString());
    expect((await list()).leads[0].has_unread).toBe(true);
    await read(second.toISOString());
    expect((await list()).leads[0].has_unread).toBe(false);
    await read(first.toISOString());
    expect((await list()).leads[0].has_unread).toBe(false);
    await leadsRepo.update(lead.id, { last_inbound_at: new Date() });
    expect((await list()).leads[0].has_unread).toBe(true);
  });

  it("saves per-reel overrides and rejects duplicate reel IDs", async () => {
    const cookie = await login();
    const meta = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    const { enabledSince, generalEnabledSince, ...base } = meta.commentSettings;
    const rule = { mediaId: "123", enabled: true, match: "keywords", keywords: ["מדריך"], publicText: "תגובה לריל", privateText: "קישור למדריך" };
    const update = overrides => fetch(baseUrl + "/api/settings/comments", { method: "PATCH", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify({ ...base, enabled: true, generalEnabled: false, overrides }) });
    expect((await update([rule])).status).toBe(200);
    const saved = await fetch(baseUrl + "/api/meta", { headers: { cookie } }).then(r => r.json());
    expect(saved.commentSettings.overrides[0].privateText).toBe("קישור למדריך");
    expect(saved.commentSettings.generalEnabled).toBe(false);
    expect((await update([rule, rule])).status).toBe(400);
    expect((await update([{ ...rule, keywords: [] }])).status).toBe(400);
  });

  it("refuses access without a session", async () => {
    const response = await fetch(`${baseUrl}/api/leads`);
    expect(response.status).toBe(401);
  });

  it("refuses a wrong password", async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(response.status).toBe(401);
  });

  it("serves leads and applies a manual patch once logged in", async () => {
    await post("/webhooks/instagram", igPayload({ mid: "m-api", text: "אשמח לקבל פרטים" }));
    const lead = await waitFor(() => leadsRepo.findByIgId(IGSID));

    const cookie = await login();

    const listed = await fetch(`${baseUrl}/api/leads`, { headers: { cookie } }).then((r) =>
      r.json(),
    );
    expect(listed.leads).toHaveLength(1);
    expect(listed.leads[0].status_label).toBe("ממתין למספר");

    const patched = await fetch(`${baseUrl}/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ automation_paused: true, status: "manual", notes: "בדיקה" }),
    }).then((r) => r.json());

    expect(patched.lead.automation_paused).toBe(true);
    expect(patched.lead.status).toBe("manual");
    expect(patched.lead.notes).toBe("בדיקה");
  });

  it("rejects an unknown status", async () => {
    await post("/webhooks/instagram", igPayload({ mid: "m-bad", text: "אשמח לקבל פרטים" }));
    const lead = await waitFor(() => leadsRepo.findByIgId(IGSID));
    const cookie = await login();

    const response = await fetch(`${baseUrl}/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ status: "not_a_real_status" }),
    });

    expect(response.status).toBe(400);
  });
});
