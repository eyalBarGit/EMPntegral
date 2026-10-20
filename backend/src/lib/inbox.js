import { getAutomation, getCommentSettings } from "../db/settings.js";
import crypto from "node:crypto";
import { getDb, nowDate, nextSequence } from "../db/index.js";
import { logger } from "../logger.js";

const inbox = () => getDb().collection("webhook_inbox");
const handlers = new Map();
let draining = false;
let timer;

export function registerWebhookHandler(channel, handler) { handlers.set(channel, handler); }

/** Persist before acknowledging Meta. Identical deliveries share one record. */
export async function enqueueWebhook(channel, payload) {
  const receivedAt = nowDate();
  const automation = await getAutomation();
  const comments = await getCommentSettings();
  const id = crypto.createHash("sha256").update(channel + JSON.stringify(payload)).digest("hex");
  await inbox().updateOne({ _id: id }, { $setOnInsert: {
    channel, payload, comments_allowed: comments.enabled, automation_allowed: automation.enabled, received_at: receivedAt, status: "pending", sequence: await nextSequence("webhook_inbox"), created_at: nowDate(),
  } }, { upsert: true });
  return id;
}

/** A single worker preserves arrival order in this single-process application. */
export async function drainInbox() {
  if (draining) return;
  draining = true;
  try {
    for (let count = 0; count < 100; count += 1) {
      const job = await inbox().findOneAndUpdate(
        { status: "pending" },
        { $set: { status: "processing", started_at: nowDate() } },
        { sort: { sequence: 1 }, returnDocument: "after" },
      );
      if (!job) break;
      try {
        const handler = handlers.get(job.channel);
        if (!handler) throw new Error("Unknown webhook channel");
        await handler(job.payload, { commentsAllowed: job.comments_allowed ?? false, automationAllowed: job.automation_allowed ?? false, receivedAt: job.received_at ?? job.created_at });
        await inbox().updateOne({ _id: job._id }, { $set: { status: "done", completed_at: nowDate() }, $unset: { payload: "" } });
      } catch (error) {
        // Preserve failed input for inspection. Do not replay partially completed
        // external sends automatically: delivery may have succeeded remotely.
        await inbox().updateOne({ _id: job._id }, { $set: { status: "failed", failed_at: nowDate(), error: error instanceof Error ? error.message : String(error) } });
        logger.error("Webhook processing failed; input retained", { inboxId: job._id });
      }
    }
  } finally { draining = false; }
}

export async function startInboxWorker() {
  // An interrupted job may contain completed side effects. Keep it for review.
  await inbox().updateMany({ status: "processing" }, { $set: { status: "failed", failed_at: nowDate(), error: "Server interrupted during processing; inspect before replay" } });
  timer = setInterval(() => void drainInbox().catch(() => logger.error("Inbox worker failed")), 1000);
  timer.unref();
  await drainInbox();
}

export function stopInboxWorker() { clearInterval(timer); }
