import cron from "node-cron";
import { config } from "../config.js";
import * as leadsRepo from "../db/leads.js";
import * as eventsRepo from "../db/events.js";
import { nowDate } from "../db/index.js";
import { alertReminder } from "../flow/alerts.js";
import { logger } from "../logger.js";

/**
 * Fires reminder alerts for calls that are about to start.
 * Exported separately from the schedule so tests can drive it directly.
 */
export async function runReminderSweep(now = new Date()) {
  const due = await leadsRepo.dueReminders(now.getTime(), config.CALL_REMINDER_MINUTES_BEFORE);
  let sent = 0;

  for (const lead of due) {
    // Retry failed deliveries on the next sweep.
    const ok = await alertReminder(lead);
    if (ok) await leadsRepo.update(lead.id, { reminder_sent_at: nowDate() });
    await eventsRepo.log(lead.id, "call_reminder_sent", { ok });
    if (ok) sent += 1;
  }

  return sent;
}

export function startJobs() {
  cron.schedule(
    "* * * * *",
    () => {
      void runReminderSweep().catch((error) => {
        logger.error("Reminder sweep failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    { timezone: config.TIMEZONE },
  );

  // The idempotency ledger is trimmed by a TTL index in Mongo, so no cleanup
  // job is needed here.
  logger.info("Scheduled jobs started");
}
