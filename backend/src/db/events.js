import { ObjectId } from "mongodb";
import { events, nowDate } from "./index.js";

const toEvent = (doc) => ({
  id: doc._id,
  lead_id: doc.lead_id ?? null,
  type: doc.type,
  data: doc.data ?? null,
  created_at: doc.created_at.toISOString(),
});

export async function log(leadId, type, data) {
  await events().insertOne({
    _id: new ObjectId().toHexString(),
    lead_id: leadId,
    type,
    data: data ?? null,
    created_at: nowDate(),
  });
}

export async function listForLead(leadId, limit = 100) {
  const docs = await events()
    .find({ lead_id: leadId })
    .sort({ created_at: -1, _id: -1 })
    .limit(limit)
    .toArray();

  return docs.map(toEvent);
}
