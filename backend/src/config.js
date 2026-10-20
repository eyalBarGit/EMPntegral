import "dotenv/config";
import { z } from "zod";

/** Env vars are always strings; treat only "true"/"1" as true. */
const boolish = (fallback) =>
  z.preprocess(
    (value) =>
      value === undefined || value === "" ? fallback : value === "true" || value === "1",
    z.boolean(),
  );

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  DASHBOARD_PASSWORD: z.string().min(1).default("changeme"),
  SESSION_SECRET: z.string().min(1).default("dev-insecure-session-secret"),

  // Works unchanged for Atlas (mongodb+srv://), a self-hosted replica set or a
  // plain local mongod.
  MONGODB_URI: z.string().min(1).default("mongodb://127.0.0.1:27017"),
  MONGODB_DB: z.string().min(1).default("empntegral"),

  // Optional resolver override, comma separated. Needed on hosts where Node
  // cannot read the system DNS configuration: `mongodb+srv://` requires an SRV
  // lookup, and those go through Node's bundled c-ares resolver rather than the
  // OS one. When c-ares finds no servers it silently falls back to 127.0.0.1 and
  // every lookup fails with querySrv ECONNREFUSED, even though the machine's DNS
  // is perfectly fine for everything else.
  DNS_SERVERS: z.string().default(""),

  TIMEZONE: z.string().default("Asia/Jerusalem"),

  META_APP_SECRET: z.string().default(""),
  // Instagram Login signs its webhooks with the Instagram app's own secret,
  // which is a different value from META_APP_SECRET. Found on the Instagram API
  // setup page rather than under App settings > Basic. Leave empty in
  // facebook_login mode, where META_APP_SECRET signs everything.
  INSTAGRAM_APP_SECRET: z.string().default(""),
  WEBHOOK_VERIFY_TOKEN: z.string().default("dev-verify-token"),
  GRAPH_API_VERSION: z.string().default("v23.0"),

  INSTAGRAM_LOGIN_MODE: z.enum(["instagram_login", "facebook_login"]).default("instagram_login"),
  INSTAGRAM_ACCESS_TOKEN: z.string().default(""),
  INSTAGRAM_ACCOUNT_ID: z.string().default(""),
  FACEBOOK_PAGE_ID: z.string().default(""),

  // Hard gate. While false the adapter never performs a network call; it only
  // records what it would have sent. Keeps the existing business number safe.
  WHATSAPP_ENABLED: boolish(false),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().default(""),
  WHATSAPP_TEMPLATE_NAME: z.string().default(""),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("he"),
  // Declared category only. Meta decides the real category at approval time and
  // reports the billed category per message in the status webhook, which is what
  // we actually persist. Never used to infer cost.
  WHATSAPP_TEMPLATE_CATEGORY: z
    .enum(["marketing", "utility", "authentication", "unknown"])
    .default("unknown"),
  DEFAULT_COUNTRY_CODE: z.string().default("972"),

  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),

  AUTOMATION_ENABLED: boolish(true),
  CALL_REMINDER_MINUTES_BEFORE: z.coerce.number().int().min(0).default(10),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n${issues.join("\n")}`);
}

export const config = parsed.data;

/** Instagram is only usable once a token and an account/page id are present. */
export const instagramConfigured = () => {
  if (!config.INSTAGRAM_ACCESS_TOKEN) return false;
  return config.INSTAGRAM_LOGIN_MODE === "instagram_login"
    ? Boolean(config.INSTAGRAM_ACCOUNT_ID)
    : Boolean(config.FACEBOOK_PAGE_ID);
};

export const whatsappConfigured = () =>
  Boolean(
    config.WHATSAPP_ENABLED &&
      config.WHATSAPP_ACCESS_TOKEN &&
      config.WHATSAPP_PHONE_NUMBER_ID &&
      config.WHATSAPP_TEMPLATE_NAME,
  );

export const telegramConfigured = () =>
  Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID);
