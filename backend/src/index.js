import { getAutomation } from "./db/settings.js";
import dns from "node:dns";
import { createApp } from "./app.js";
import { config, instagramConfigured, telegramConfigured } from "./config.js";
import { connect, disconnect } from "./db/index.js";
import { startInboxWorker, stopInboxWorker } from "./lib/inbox.js";
import { startJobs } from "./jobs/reminders.js";
import { logger } from "./logger.js";

/** Applied before anything resolves a hostname, so it covers the Mongo connect. */
function applyDnsOverride() {
  const servers = config.DNS_SERVERS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (servers.length === 0) return;

  dns.setServers(servers);
  logger.info(`DNS resolver overridden: ${servers.join(", ")}`);
}

async function reportReadiness() {
  const automation = await getAutomation();
  const lines = [
    `automation:  ${automation.enabled ? "on" : "off"}`,
    `instagram:   ${instagramConfigured() ? "configured" : "MISSING credentials"}`,
    `whatsapp:    ${config.WHATSAPP_ENABLED ? "enabled" : "disabled (safe mode, nothing will be sent)"}`,
    `telegram:    ${telegramConfigured() ? "configured" : "MISSING credentials"}`,
    `ig signature: ${config.INSTAGRAM_APP_SECRET ? "verified (Instagram app secret)" : config.META_APP_SECRET ? "using META_APP_SECRET, which Instagram Login does not sign with" : "NOT verified (no secret)"}`,
    `wa signature: ${config.META_APP_SECRET ? "verified" : "NOT verified (no META_APP_SECRET)"}`,
  ];
  for (const line of lines) logger.info(line);
}

async function main() {
  applyDnsOverride();

  // Connecting before listening means a bad connection string fails loudly at
  // startup rather than on the first incoming webhook.
  await connect();

  const app = createApp();
  await startInboxWorker();
  const server = app.listen(config.PORT, () => {
    logger.info(`EMPntegral API listening on port ${config.PORT}`);
    logger.info(`Webhook URL: ${config.PUBLIC_BASE_URL}/webhooks/instagram`);
    void reportReadiness().catch(() => logger.error("Could not read automation status"));
  });

  startJobs();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    stopInboxWorker();
    server.close(() => {
      void disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((error) => {
  // Printed raw: the connection failure message is multi-line guidance and
  // would be unreadable squeezed into a JSON log field.
  logger.error("Startup failed");
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
