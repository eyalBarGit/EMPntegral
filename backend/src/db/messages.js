import { ObjectId } from "mongodb";
import { isDuplicateKeyError, messages, nowDate } from "./index.js";

const toMessage = (doc) => ({
  id: doc._id,
  lead_id: doc.lead_id,
  channel: doc.channel,
  direction: doc.direction,
  body: doc.body,
  external_id: doc.external_id ?? null,
  meta: doc.meta ?? null,
  created_at: doc.created_at.toISOString(),
});

/**
 * Inserts a message. Returns null when `externalId` was already stored, which
 * is the primary guard against Meta redelivering the same webhook.
 */
export async function record(input) {
  const doc = {
    _id: new ObjectId().toHexString(),
    lead_id: input.leadId,
    channel: input.channel,
    direction: input.direction,
    body: input.body,
    external_id: input.externalId ?? null,
    meta: input.meta ?? null,
    created_at: nowDate(),
  };

  try {
    await messages().insertOne(doc);
    return toMessage(doc);
  } catch (error) {
    if (isDuplicateKeyError(error)) return null;
    throw error;
  }
}

export async function listForLead(leadId, limit = 200) {
  const docs = await messages()
    .find({ lead_id: leadId })
    .sort({ created_at: 1, _id: 1 })
    .limit(limit)
    .toArray();

  return docs.map(toMessage);
}

export async function existsByExternalId(externalId) {
  const doc = await messages().findOne({ external_id: externalId }, { projection: { _id: 1 } });
  return doc !== null;
}

/**
 * Merges delivery and pricing information reported by a WhatsApp status webhook
 * into the stored message. The billed category comes from Meta, never from our
 * own assumptions about the template.
 */
export async function mergeMeta(externalId, extra) {
  const set = Object.fromEntries(
    Object.entries(extra).map(([key, value]) => [`meta.${key}`, value]),
  );

  await messages().updateOne({ external_id: externalId }, { $set: set });
}
