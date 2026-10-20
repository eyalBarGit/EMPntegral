import { isDuplicateKeyError, nowDate, processedEvents } from "../db/index.js";

/**
 * Claims a webhook key exactly once.
 *
 * Returns true the first time a key is seen and false on every redelivery.
 * The key is the document `_id`, so the insert is atomic and two concurrent
 * deliveries of the same event cannot both win.
 */
export async function claim(key) {
  try {
    await processedEvents().insertOne({ _id: key, created_at: nowDate() });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}
