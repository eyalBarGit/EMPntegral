import { MongoClient } from "mongodb";
import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Document shapes stored in MongoDB.
 *
 * @typedef {object} LeadDoc
 * @property {number} _id            Sequential number, so leads can be called "#12".
 * @property {string|null} ig_id
 * @property {string|null} ig_username
 * @property {string|null} name
 * @property {string|null} phone
 * @property {string} status
 * @property {string} source
 * @property {string|null} source_ref
 * @property {string} notes
 * @property {Date|null} call_time
 * @property {string|null} call_time_raw
 * @property {Date|null} reminder_sent_at
 * @property {boolean} automation_paused
 * @property {Date|null} welcome_sent_at
 * @property {Date|null} whatsapp_sent_at
 * @property {Date|null} last_inbound_at
 * @property {Date|null} last_outbound_at
 * @property {Date} created_at
 * @property {Date} updated_at
 */

let client = null;
let database = null;

export function getDb() {
  if (!database) {
    throw new Error("Database is not connected. Call connect() during startup.");
  }
  return database;
}

export const leads = () => getDb().collection("leads");
export const messages = () => getDb().collection("messages");
export const events = () => getDb().collection("events");
export const counters = () => getDb().collection("counters");
export const processedEvents = () => getDb().collection("processed_events");

export async function connect(uri = config.MONGODB_URI, dbName = config.MONGODB_DB) {
  if (database) return database;

  client = new MongoClient(uri, {
    // Fail fast on startup instead of hanging: a wrong Atlas URI or a missing
    // IP allowlist entry should surface as an error, not a silent stall.
    serverSelectionTimeoutMS: 10_000,
    retryWrites: true,
  });

  try {
    await client.connect();
  } catch (error) {
    // This is the first wall anyone hits on a fresh machine, so the message
    // names the likely cause instead of just repeating the driver's error.
    const reason = error instanceof Error ? error.message : String(error);

    const hint = () => {
      if (reason.includes("querySrv")) {
        return [
          "The SRV lookup failed. Node resolves SRV records with its own bundled",
          "resolver, not the system one, and on some hosts it cannot read the DNS",
          "configuration and falls back to 127.0.0.1 where nothing is listening.",
          "Set DNS_SERVERS=1.1.1.1,8.8.8.8 in backend/.env, or use the non-SRV",
          "connection string from Atlas (mongodb:// with the hosts listed).",
        ];
      }
      if (reason.includes("alert internal error") || reason.includes("alert number 80")) {
        return [
          "The server accepted the TCP connection and then rejected TLS. On Atlas",
          "that almost always means the cluster is refusing you at the proxy:",
          "  - this machine's IP is not in Network Access, or",
          "  - the cluster is paused (free clusters pause after inactivity).",
        ];
      }
      if (reason.includes("Authentication failed")) {
        return [
          "The host was reached but the credentials were rejected. Check the",
          "database user under Database Access, and remember that special",
          "characters in the password must be percent-encoded in the URI.",
        ];
      }
      return [
        "Set MONGODB_URI in backend/.env to a reachable database:",
        "  Atlas:  mongodb+srv://USER:PASSWORD@cluster.xxxxx.mongodb.net/",
        "  local:  mongodb://127.0.0.1:27017  (requires a running mongod)",
        "",
        "On Atlas, also allow this machine's IP under Network Access.",
      ];
    };

    throw new Error(
      [
        `Could not connect to MongoDB at ${uri.replace(/\/\/[^@]+@/, "//<credentials>@")}`,
        `Reason: ${reason}`,
        "",
        ...hint(),
      ].join("\n"),
    );
  }

  database = client.db(dbName);
  await ensureIndexes();

  logger.info(`Connected to MongoDB database "${dbName}"`);
  return database;
}

export async function disconnect() {
  await client?.close();
  client = null;
  database = null;
}

/**
 * Creates every index the app relies on. Called on each startup; Mongo makes
 * this a no-op once the indexes exist.
 *
 * The unique indexes carry a partialFilterExpression on purpose. Unlike SQL
 * databases, Mongo treats a missing or null field as a real value in a unique
 * index, so a plain unique index on `phone` would reject the second lead that
 * has no phone yet. Restricting the index to documents where the field is a
 * string keeps the uniqueness guarantee while allowing any number of leads
 * without a phone.
 */
async function ensureIndexes() {
  await leads().createIndexes([
    {
      key: { ig_id: 1 },
      name: "uniq_ig_id",
      unique: true,
      partialFilterExpression: { ig_id: { $type: "string" } },
    },
    {
      key: { phone: 1 },
      name: "uniq_phone",
      unique: true,
      partialFilterExpression: { phone: { $type: "string" } },
    },
    { key: { status: 1 }, name: "by_status" },
    { key: { updated_at: -1 }, name: "by_updated" },
    { key: { created_at: -1 }, name: "by_created" },
    { key: { status: 1, call_time: 1 }, name: "by_due_call" },
  ]);

  await messages().createIndexes([
    {
      key: { external_id: 1 },
      name: "uniq_external_id",
      unique: true,
      partialFilterExpression: { external_id: { $type: "string" } },
    },
    { key: { lead_id: 1, created_at: 1 }, name: "by_lead" },
  ]);

  await events().createIndexes([{ key: { lead_id: 1, created_at: -1 }, name: "by_lead" }]);

  await getDb().collection("webhook_inbox").createIndex({ status: 1, sequence: 1 });
  await getDb().collection("webhook_inbox").createIndex({ completed_at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

  // Expire the idempotency ledger automatically, so no cleanup job is needed.
  await processedEvents().createIndex(
    { created_at: 1 },
    { name: "ttl_created_at", expireAfterSeconds: 60 * 60 * 24 * 30 },
  );
}

/** Duplicate key violation. The signal that a unique index did its job. */
export const isDuplicateKeyError = (error) =>
  typeof error === "object" && error !== null && error.code === 11000;

/** Atomically allocates the next sequential id for a collection. */
export async function nextSequence(name) {
  const result = await counters().findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );

  if (!result) throw new Error(`Failed to allocate a sequence for "${name}"`);
  return result.seq;
}

export const nowDate = () => new Date();

/** Mongo dates become ISO strings at the API boundary, as the dashboard expects. */
export const toIso = (value) => (value instanceof Date ? value.toISOString() : null);

/** Escapes user input before it is used inside a regular expression. */
export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function clearAllCollections() {
  const db = getDb();
  await Promise.all([
    db.collection("leads").deleteMany({}),
    db.collection("messages").deleteMany({}),
    db.collection("events").deleteMany({}),
    db.collection("counters").deleteMany({}),
    db.collection("processed_events").deleteMany({}),
    db.collection("settings").deleteMany({}),
    db.collection("comment_runs").deleteMany({}),
    db.collection("webhook_inbox").deleteMany({}),
  ]);
}
