import { config, instagramConfigured } from "../config.js";
import { postJson } from "../lib/http.js";
import { logger } from "../logger.js";

/**
 * Both official Instagram messaging paths speak the same request shape and
 * differ only in host and in which id owns the /messages edge:
 *
 *   instagram_login -> graph.instagram.com/<IG_ID>/messages
 *   facebook_login  -> graph.facebook.com/<PAGE_ID>/messages
 */
function endpoint() {
  const version = config.GRAPH_API_VERSION;
  if (config.INSTAGRAM_LOGIN_MODE === "instagram_login") {
    return `https://graph.instagram.com/${version}/${config.INSTAGRAM_ACCOUNT_ID}/messages`;
  }
  return `https://graph.facebook.com/${version}/${config.FACEBOOK_PAGE_ID}/messages`;
}

function truncateToBytes(text, maxBytes) {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;

  let result = text;
  while (encoder.encode(result).length > maxBytes && result.length > 0) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Sends a plain text direct message to an Instagram-scoped user id.
 * Only valid inside the 24 hour window opened by the lead's own message.
 */
export async function sendText(igsid, text) {
  if (!instagramConfigured()) {
    logger.warn("Instagram send skipped: credentials are not configured", { igsid });
    return { ok: false, skipped: "not_configured" };
  }

  // Meta rejects text over 1000 bytes on this edge.
  const body = truncateToBytes(text, 1000);

  try {
    const response = await postJson({
      url: endpoint(),
      token: config.INSTAGRAM_ACCESS_TOKEN,
      body: {
        recipient: { id: igsid },
        message: { text: body },
      },
    });
    return { ok: true, messageId: response?.message_id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Instagram send failed", { igsid, message });
    return { ok: false, error: message };
  }
}

/** Looks up the public profile of a lead so the dashboard can show a name. */
export async function fetchProfile(igsid) {
  if (!instagramConfigured()) return null;

  const host =
    config.INSTAGRAM_LOGIN_MODE === "instagram_login"
      ? "graph.instagram.com"
      : "graph.facebook.com";
  const url = `https://${host}/${config.GRAPH_API_VERSION}/${igsid}?fields=name,username&access_token=${encodeURIComponent(config.INSTAGRAM_ACCESS_TOKEN)}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // A missing profile must never block the reply flow.
    return null;
  }
}

function graphBase() {
  return "https://" + (config.INSTAGRAM_LOGIN_MODE === "instagram_login" ? "graph.instagram.com" : "graph.facebook.com") + "/" + config.GRAPH_API_VERSION;
}
async function graphGet(path, fields) {
  const url = new URL(graphBase() + "/" + path);
  url.searchParams.set("fields", fields);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + config.INSTAGRAM_ACCESS_TOKEN }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Instagram request failed");
  return body;
}
export async function fetchMedia(mediaId) {
  return graphGet(mediaId, "id,media_product_type,permalink,caption");
}
export async function listReels(after) {
  if (!instagramConfigured()) throw new Error("Instagram is not configured");
  const account = config.INSTAGRAM_ACCOUNT_ID;
  if (!account) throw new Error("Instagram account ID is required to list reels");
  const url = new URL(graphBase() + "/" + account + "/media");
  url.searchParams.set("fields", "id,caption,permalink,thumbnail_url,media_product_type,timestamp");
  url.searchParams.set("limit", "50");
  if (after) url.searchParams.set("after", after);
  const response = await fetch(url, { headers: { Authorization: "Bearer " + config.INSTAGRAM_ACCESS_TOKEN }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Could not list reels");
  return { reels: (body.data ?? []).filter(media => media.media_product_type === "REELS"), after: body.paging?.next ? body.paging?.cursors?.after ?? null : null };
}
async function commentPost(url, body) {
  if (!instagramConfigured()) return { ok: false, skipped: "not_configured" };
  try {
    const response = await postJson({ url, token: config.INSTAGRAM_ACCESS_TOKEN, body });
    return { ok: true, messageId: response?.message_id ?? response?.id };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
}
export async function replyToComment(commentId, text) {
  return commentPost(graphBase() + "/" + commentId + "/replies", { message: text });
}
export async function sendPrivateReply(commentId, text) {
  // Private replies use the comment ID, never the general DM recipient ID.
  return commentPost(endpoint(), { recipient: { comment_id: commentId }, message: { text } });
}

export async function fetchComment(commentId) {
  return graphGet(commentId, "id,parent_id,timestamp");
}
