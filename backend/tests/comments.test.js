import { beforeEach, describe, it, expect, vi } from "vitest";
const { media, publicReply, privateReply, details } = vi.hoisted(() => ({ media: vi.fn(), details: vi.fn(), publicReply: vi.fn(), privateReply: vi.fn() }));
vi.mock("../src/channels/instagram.js", () => ({ fetchMedia: media, fetchComment: details, replyToComment: publicReply, sendPrivateReply: privateReply }));
import { handleInstagramComment } from "../src/flow/comments.js";
import { getCommentSettings, setCommentSettings, setAutomation } from "../src/db/settings.js";
import { getDb } from "../src/db/index.js";
import * as leads from "../src/db/leads.js";
import * as messages from "../src/db/messages.js";
import crypto from "node:crypto";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
const comment = (extra = {}) => ({ id: "c1", text: "אפשר פרטים", from: { id: "person1", username: "test" }, media: { id: "123" }, ...extra });
const enable = async (extra = {}) => setCommentSettings({ ...(await getCommentSettings()), enabled: true, ...extra });
beforeEach(() => {
  vi.resetAllMocks();
  details.mockResolvedValue({ id: "c1" });
  media.mockResolvedValue({ id: "123", media_product_type: "REELS", permalink: "https://instagram.com/reel/example" });
  publicReply.mockResolvedValue({ ok: true, messageId: "public1" });
  privateReply.mockResolvedValue({ ok: true, messageId: "private1" });
});
describe("reel comment automation", () => {
  it("is disabled by default", async () => {
    await handleInstagramComment(comment());
    expect(publicReply).not.toHaveBeenCalled();
  });
  it("sends public then private once and stores the transcript", async () => {
    await enable();
    await handleInstagramComment(comment());
    await handleInstagramComment(comment());
    expect(publicReply).toHaveBeenCalledTimes(1);
    expect(privateReply).toHaveBeenCalledTimes(1);
    expect(publicReply.mock.invocationCallOrder[0]).toBeLessThan(privateReply.mock.invocationCallOrder[0]);
    expect(privateReply).toHaveBeenCalledWith("c1", (await getCommentSettings()).privateText);
    const lead = await leads.findByIgId("person1");
    expect(await messages.listForLead(lead.id)).toHaveLength(3);
  });
  it("filters keywords and selected reels", async () => {
    await enable({ match: "keywords", keywords: ["פרטים", "details"], scope: "selected", mediaIds: ["123"] });
    await handleInstagramComment(comment({ text: "תודה" }));
    await handleInstagramComment(comment({ media: { id: "456" } }));
    expect(publicReply).not.toHaveBeenCalled();
    await handleInstagramComment(comment({ text: "I'd like DETAILS please" }));
    expect(publicReply).toHaveBeenCalledTimes(1);
  });
  it("does not send to feed posts, self comments, or child comments", async () => {
    await enable();
    media.mockResolvedValue({ media_product_type: "FEED" });
    await handleInstagramComment(comment());
    await handleInstagramComment(comment({ from: { id: config.INSTAGRAM_ACCOUNT_ID } }));
    await handleInstagramComment(comment({ parent_id: "parent" }));
    expect(publicReply).not.toHaveBeenCalled();
  });
  it("respects the global switch and disabled receipt snapshot", async () => {
    await enable();
    await handleInstagramComment(comment(), { commentsAllowed: false });
    await setAutomation(false);
    await handleInstagramComment(comment());
    expect(publicReply).not.toHaveBeenCalled();
  });
  it("does not send private if public failed or resend a partial failure", async () => {
    await enable();
    publicReply.mockResolvedValueOnce({ ok: false, error: "Permission missing" });
    await handleInstagramComment(comment());
    await handleInstagramComment(comment());
    expect(privateReply).not.toHaveBeenCalled();
    expect(publicReply).toHaveBeenCalledTimes(1);
    expect((await getDb().collection("comment_runs").findOne({ _id: "c1" })).status).toBe("failed");
  });
  it("does not replay older comments when enabled", async () => {
    await enable();
    await handleInstagramComment(comment({ timestamp: Math.floor(Date.now() / 1000) - 600 }));
    expect(publicReply).not.toHaveBeenCalled();
  });
});

describe("signed comment webhooks", () => {
  it("routes changes.comments to the reel flow", async () => {
    await enable();
    const server = createApp().listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    try {
      const payload = JSON.stringify({ object: "instagram", entry: [{ id: config.INSTAGRAM_ACCOUNT_ID, time: Date.now(), changes: [{ field: "comments", value: comment() }] }] });
      const signature = "sha256=" + crypto.createHmac("sha256", config.INSTAGRAM_APP_SECRET).update(payload).digest("hex");
      const response = await fetch("http://127.0.0.1:" + server.address().port + "/webhooks/instagram", { method: "POST", headers: { "Content-Type": "application/json", "x-hub-signature-256": signature }, body: payload });
      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(privateReply).toHaveBeenCalledTimes(1));
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
});

describe("general and per-reel replies", () => {
  const specific = (extra = {}) => ({ mediaId: "123", enabled: true, match: "all", keywords: [], publicText: "תגובה מיוחדת", privateText: "מדריך ייעודי לריל", ...extra });
  it("prefers the specific reel texts and never sends both configurations", async () => {
    await enable({ overrides: [specific()] });
    await handleInstagramComment(comment());
    expect(publicReply).toHaveBeenCalledTimes(1);
    expect(publicReply).toHaveBeenCalledWith("c1", "תגובה מיוחדת");
    expect(privateReply).toHaveBeenCalledWith("c1", "מדריך ייעודי לריל");
  });
  it("uses the general reply for other reels", async () => {
    await enable({ overrides: [specific({ mediaId: "456" })] });
    await handleInstagramComment(comment());
    expect(privateReply).toHaveBeenCalledWith("c1", (await getCommentSettings()).privateText);
  });
  it("does not fall back when a specific rule is disabled or its keywords do not match", async () => {
    await enable({ overrides: [specific({ enabled: false })] });
    await handleInstagramComment(comment());
    await enable({ overrides: [specific({ match: "keywords", keywords: ["מדריך"] })] });
    await handleInstagramComment(comment());
    expect(publicReply).not.toHaveBeenCalled();
  });
  it("can run specific replies with the general default switched off", async () => {
    await enable({ generalEnabled: false, overrides: [specific()] });
    await handleInstagramComment(comment());
    expect(privateReply).toHaveBeenCalledTimes(1);
    await handleInstagramComment(comment({ id: "c2", media: { id: "456" } }));
    expect(privateReply).toHaveBeenCalledTimes(1);
  });
  it("preserves legacy selected-reel scope and stored text", async () => {
    await enable({ scope: "selected", mediaIds: ["123"], publicText: "הנוסח הקיים", privateText: "ההודעה הקיימת" });
    await handleInstagramComment(comment({ id: "other", media: { id: "456" } }));
    expect(publicReply).not.toHaveBeenCalled();
    await handleInstagramComment(comment());
    expect(privateReply).toHaveBeenCalledWith("c1", "ההודעה הקיימת");
  });
});
