import crypto from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header against the exact raw request
 * body. Any reserialized body will fail, which is why the webhook routes keep
 * the raw Buffer.
 */
export function verifyMetaSignature(rawBody, headerValue, appSecret) {
  if (!appSecret) return false;
  if (!headerValue || !headerValue.startsWith("sha256=")) return false;

  const provided = headerValue.slice("sha256=".length).trim();
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;

  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided.toLowerCase(), "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Constant-time string compare for the dashboard password and verify token. */
export function safeEquals(a, b) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
