import { config } from "../config.js";
import { escapeHtml, sendAlert } from "../channels/telegram.js";
import { formatForDisplay, toWaMe } from "../lib/phone.js";
import { formatInZone } from "../lib/time.js";
import { STATUS_LABELS } from "./statuses.js";

const leadUrl = (lead) =>
  `${config.PUBLIC_BASE_URL.replace(/\/+$/, "")}/#lead-${lead.id}`;

const identity = (lead) => {
  const parts = [];
  if (lead.name) parts.push(escapeHtml(lead.name));
  if (lead.ig_username) parts.push(`@${escapeHtml(lead.ig_username)}`);
  if (parts.length === 0) parts.push(`ליד #${lead.id}`);
  return parts.join(" ");
};

function baseButtons(lead) {
  const buttons = [];
  if (lead.phone) buttons.push({ text: "פתח בוואטסאפ", url: toWaMe(lead.phone) });
  buttons.push({ text: "פתח בדשבורד", url: leadUrl(lead) });
  return buttons;
}

export function alertNewConversation(lead, firstMessage) {
  const text = [
    `💬 <b>שיחה חדשה באינסטגרם</b>`,
    `${identity(lead)}`,
    ``,
    `<i>${escapeHtml(firstMessage.slice(0, 300))}</i>`,
  ].join("\n");
  return sendAlert(text, baseButtons(lead));
}

export function alertPhoneReceived(lead) {
  const text = [
    `🔥 <b>ליד חדש - התקבל מספר טלפון</b>`,
    ``,
    `👤 ${identity(lead)}`,
    `📞 <code>${escapeHtml(formatForDisplay(lead.phone ?? ""))}</code>`,
    `📍 מקור: ${escapeHtml(lead.source)}`,
    `🕐 ${formatInZone(new Date(lead.created_at), config.TIMEZONE)}`,
  ].join("\n");
  return sendAlert(text, baseButtons(lead));
}

export function alertAvailableNow(lead) {
  const text = [
    `📞📞 <b>הליד פנוי לשיחה עכשיו!</b>`,
    ``,
    `👤 ${identity(lead)}`,
    `📱 <code>${escapeHtml(formatForDisplay(lead.phone ?? ""))}</code>`,
    ``,
    `<b>חייג עכשיו.</b>`,
  ].join("\n");
  return sendAlert(text, baseButtons(lead));
}

export function alertCallScheduled(lead) {
  const when = lead.call_time
    ? formatInZone(new Date(lead.call_time), config.TIMEZONE)
    : (lead.call_time_raw ?? "לא צוין");
  const text = [
    `🗓 <b>נקבעה שיחה</b>`,
    ``,
    `👤 ${identity(lead)}`,
    `📱 <code>${escapeHtml(formatForDisplay(lead.phone ?? ""))}</code>`,
    `⏰ ${escapeHtml(when)}`,
  ].join("\n");
  return sendAlert(text, baseButtons(lead));
}

export function alertReminder(lead) {
  const when = lead.call_time
    ? formatInZone(new Date(lead.call_time), config.TIMEZONE)
    : (lead.call_time_raw ?? "");
  const text = [
    `⏰ <b>תזכורת: שיחה מתקרבת</b>`,
    ``,
    `👤 ${identity(lead)}`,
    `📱 <code>${escapeHtml(formatForDisplay(lead.phone ?? ""))}</code>`,
    `🕐 ${escapeHtml(when)}`,
  ].join("\n");
  return sendAlert(text, baseButtons(lead));
}

export function alertStatusChanged(lead) {
  const text = [
    `ℹ️ <b>שינוי סטטוס</b>`,
    `${identity(lead)} → ${STATUS_LABELS[lead.status] ?? lead.status}`,
  ].join("\n");
  return sendAlert(text, baseButtons(lead));
}
