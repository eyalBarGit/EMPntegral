import {
  escapeRegex,
  isDuplicateKeyError,
  leads,
  nextSequence,
  nowDate,
  toIso,
} from "./index.js";

/**
 * The shape the rest of the app works with: dates as ISO strings and a plain
 * numeric `id`, so nothing outside this module needs to know about Mongo.
 *
 * @typedef {object} Lead
 * @property {number} id
 * @property {string|null} ig_id
 * @property {string|null} ig_username
 * @property {string|null} name
 * @property {string|null} phone
 * @property {string} status
 * @property {string} source
 * @property {string|null} source_ref
 * @property {string} notes
 * @property {string|null} call_time
 * @property {string|null} call_time_raw
 * @property {string|null} reminder_sent_at
 * @property {boolean} automation_paused
 * @property {string|null} welcome_sent_at
 * @property {string|null} whatsapp_sent_at
 * @property {string|null} last_inbound_at
 * @property {string|null} last_outbound_at
 * @property {string} created_at
 * @property {string} updated_at
 */

/** @returns {Lead} */
const toLead = (doc) => ({
  id: doc._id,
  ig_id: doc.ig_id ?? null,
  ig_username: doc.ig_username ?? null,
  name: doc.name ?? null,
  phone: doc.phone ?? null,
  status: doc.status,
  source: doc.source,
  source_ref: doc.source_ref ?? null,
  notes: doc.notes ?? "",
  call_time: toIso(doc.call_time),
  call_time_raw: doc.call_time_raw ?? null,
  reminder_sent_at: toIso(doc.reminder_sent_at),
  automation_paused: Boolean(doc.automation_paused),
  welcome_sent_at: toIso(doc.welcome_sent_at),
  whatsapp_sent_at: toIso(doc.whatsapp_sent_at),
  last_inbound_at: toIso(doc.last_inbound_at),
  last_read_at: toIso(doc.last_read_at),
  last_outbound_at: toIso(doc.last_outbound_at),
  created_at: doc.created_at.toISOString(),
  updated_at: doc.updated_at.toISOString(),
});

const DATE_FIELDS = new Set([
  "call_time",
  "reminder_sent_at",
  "welcome_sent_at",
  "whatsapp_sent_at",
  "last_inbound_at",
  "last_outbound_at",
]);

/** Fields a caller may patch. Anything not listed here is ignored. */
const UPDATABLE = new Set([
  "ig_username",
  "name",
  "phone",
  "status",
  "source",
  "source_ref",
  "notes",
  "call_time",
  "call_time_raw",
  "reminder_sent_at",
  "automation_paused",
  "welcome_sent_at",
  "whatsapp_sent_at",
  "last_inbound_at",
  "last_outbound_at",
]);

/** Normalizes a patch into BSON values: dates as Date, everything else as-is. */
function toUpdateSet(patch) {
  const set = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || !UPDATABLE.has(key)) continue;

    if (DATE_FIELDS.has(key)) {
      set[key] = value === null ? null : value instanceof Date ? value : new Date(value);
      continue;
    }

    set[key] = value;
  }

  return set;
}

export async function findById(id) {
  const doc = await leads().findOne({ _id: id });
  return doc ? toLead(doc) : undefined;
}

export async function findByIgId(igId) {
  const doc = await leads().findOne({ ig_id: igId });
  return doc ? toLead(doc) : undefined;
}

export async function findByPhone(phone) {
  const doc = await leads().findOne({ phone });
  return doc ? toLead(doc) : undefined;
}

/**
 * Returns the existing lead for an Instagram-scoped ID, or creates one.
 *
 * Concurrent webhook deliveries for the same person are handled by the unique
 * index on ig_id: whichever insert loses the race gets a duplicate key error
 * and reads the winner's document instead of creating a second lead.
 */
export async function getOrCreateByIgId(input) {
  const existing = await leads().findOne({ ig_id: input.igId });

  if (existing) {
    const patch = {};
    if (input.igUsername && !existing.ig_username) patch.ig_username = input.igUsername;
    if (input.name && !existing.name) patch.name = input.name;
    if (input.sourceRef && !existing.source_ref) patch.source_ref = input.sourceRef;

    const lead =
      Object.keys(patch).length > 0 ? await update(existing._id, patch) : toLead(existing);
    return { lead, created: false };
  }

  const now = nowDate();
  const doc = {
    _id: await nextSequence("leads"),
    ig_id: input.igId,
    ig_username: input.igUsername ?? null,
    name: input.name ?? null,
    phone: null,
    status: "new",
    source: input.source ?? "instagram_dm",
    source_ref: input.sourceRef ?? null,
    notes: "",
    call_time: null,
    call_time_raw: null,
    reminder_sent_at: null,
    automation_paused: false,
    welcome_sent_at: null,
    whatsapp_sent_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    created_at: now,
    updated_at: now,
  };

  try {
    await leads().insertOne(doc);
    return { lead: toLead(doc), created: true };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const winner = await leads().findOne({ ig_id: input.igId });
    if (!winner) throw error;
    return { lead: toLead(winner), created: false };
  }
}

export async function update(id, patch) {
  const set = toUpdateSet(patch);
  set.updated_at = nowDate();

  const doc = await leads().findOneAndUpdate(
    { _id: id },
    { $set: set },
    { returnDocument: "after" },
  );

  if (!doc) throw new Error(`Lead ${id} not found`);
  return toLead(doc);
}

/**
 * Attaches a phone number to a lead. Returns null when the number already
 * belongs to a different lead, which is how the caller detects the same person
 * reaching out from two Instagram accounts.
 *
 * The unique index is the arbiter rather than a preliminary lookup, so there is
 * no window between checking and writing.
 */
export async function attachPhone(id, phone) {
  try {
    return await update(id, { phone });
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

export async function list(filters = {}) {
  const query = {};

  if (filters.status) query.status = filters.status;
  if (filters.hasPhone) query.phone = { $type: "string", $regex: /\S/ };

  if (filters.search) {
    const pattern = new RegExp(escapeRegex(filters.search), "i");
    query.$or = [
      { ig_username: pattern },
      { name: pattern },
      { phone: pattern },
      { notes: pattern },
    ];
  }

  const docs = await leads().aggregate([
    { $match: query }, { $sort: { updated_at: -1 } }, { $limit: filters.limit ?? 200 },
    { $lookup: { from: "messages", localField: "_id", foreignField: "lead_id", pipeline: [
      { $sort: { created_at: -1, _id: -1 } }, { $limit: 1 }, { $project: { body: 1, direction: 1, channel: 1 } },
    ], as: "latest" } },
  ]).toArray();
  return docs.map(doc => ({ ...toLead(doc), last_message: doc.latest[0]?.body ?? "", last_message_direction: doc.latest[0]?.direction ?? null }));
}

export async function countByStatus({ hasPhone = false } = {}) {
  const rows = await leads()
    .aggregate([...(hasPhone ? [{ $match: { phone: { $type: "string", $regex: /\S/ } } }] : []), { $group: { _id: "$status", n: { $sum: 1 } } }])
    .toArray();

  return Object.fromEntries(rows.map((row) => [row._id, row.n]));
}

/** Leads with a call due within the window whose reminder has not fired yet. */
export async function dueReminders(nowMs, minutesBefore) {
  const horizon = new Date(nowMs + minutesBefore * 60_000);

  const docs = await leads()
    .find({
      status: "call_scheduled",
      reminder_sent_at: null,
      call_time: { $ne: null, $lte: horizon },
    })
    .sort({ call_time: 1 })
    .toArray();

  return docs.map(toLead);
}

/** Claim the greeting atomically; a failed send releases it for a later message. */
export async function claimWelcome(id) {
  const doc = await leads().findOneAndUpdate(
    { _id: id, welcome_sent_at: null, $or: [{ welcome_claimed_at: null }, { welcome_claimed_at: { $lt: new Date(Date.now() - 120_000) } }] },
    { $set: { welcome_claimed_at: nowDate(), status: "awaiting_phone" } },
    { returnDocument: "after" },
  );
  return doc ? toLead(doc) : null;
}

export async function finishWelcome(id, succeeded) {
  const set = succeeded ? { welcome_sent_at: nowDate() } : {};
  await leads().updateOne({ _id: id }, {
    $set: set,
    $unset: { welcome_claimed_at: "" },
  });
  return findById(id);
}

/** Reading a conversation must not change its position in the lead list. */
export async function markRead(id, through) {
  await leads().updateOne({ _id: id }, { $max: { last_read_at: through } });
}
