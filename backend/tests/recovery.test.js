import { describe, it, expect, vi } from "vitest";
import { getDb } from "../src/db/index.js";
import { enqueueWebhook, drainInbox, registerWebhookHandler } from "../src/lib/inbox.js";
import * as leads from "../src/db/leads.js";
const { reminder } = vi.hoisted(() => ({ reminder: vi.fn() }));
vi.mock("../src/flow/alerts.js", () => ({ alertReminder: reminder }));
import { runReminderSweep } from "../src/jobs/reminders.js";

describe("durable webhook intake", () => {
  it("persists before processing and deduplicates identical deliveries", async () => {
    const handler = vi.fn(async () => {});
    registerWebhookHandler("test", handler);
    const id = await enqueueWebhook("test", { entry: [1] });
    await enqueueWebhook("test", { entry: [1] });
    expect((await getDb().collection("webhook_inbox").findOne({ _id: id })).status).toBe("pending");
    await drainInbox();
    expect(handler).toHaveBeenCalledTimes(1);
    const job = await getDb().collection("webhook_inbox").findOne({ _id: id });
    expect(job.status).toBe("done");
    expect(job.payload).toBeUndefined();
  });

  it("retains failed input and continues processing the next job", async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValueOnce();
    registerWebhookHandler("test", handler);
    const id = await enqueueWebhook("test", { order: 1 });
    await enqueueWebhook("test", { order: 2 });
    await drainInbox();
    expect(handler).toHaveBeenCalledTimes(2);
    const job = await getDb().collection("webhook_inbox").findOne({ _id: id });
    expect(job.status).toBe("failed");
    expect(job.payload).toEqual({ order: 1 });
  });
});

describe("reminder delivery", () => {
  it("retries a failed alert and stops after successful delivery", async () => {
    const { lead } = await leads.getOrCreateByIgId({ igId: "reminder-test" });
    await leads.update(lead.id, { status: "call_scheduled", call_time: new Date(Date.now() + 60_000) });
    reminder.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await runReminderSweep()).toBe(0);
    expect((await leads.findById(lead.id)).reminder_sent_at).toBeNull();
    expect(await runReminderSweep()).toBe(1);
    expect(await runReminderSweep()).toBe(0);
    expect(reminder).toHaveBeenCalledTimes(2);
  });
});
