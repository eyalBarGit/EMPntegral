import nodemailer from "nodemailer";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { formatForDisplay, toWaMe } from "../lib/phone.js";

// Based on Emp-Calendar's Email.service.js; retain legacy SMTP settings.
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export async function sendPhoneReceivedEmail(lead) {
  const calendar = Boolean(config.EMAIL_HOST);
  const host = calendar ? config.EMAIL_HOST : config.SMTP_HOST;
  const user = calendar ? config.EMAIL_USER : config.SMTP_USER;
  const rawPass = calendar ? config.EMAIL_PASS : config.SMTP_PASS;
  const port = calendar ? config.EMAIL_PORT : config.SMTP_PORT;
  const from = calendar ? { name: config.EMAIL_FROM_NAME, address: user } : config.SMTP_FROM;
  const to = config.ADMIN_NOTIFY_EMAIL || config.LEAD_ALERT_EMAIL;
  const password = String(rawPass ?? "").trim();
  const invalidPassword = !password || /your-gmail-app-password|^changeme$/i.test(password);
  if (!host || !to || !from || (calendar && !user) || (user && invalidPassword)) {
    logger.warn("Lead email skipped: email settings missing or placeholder password");
    return false;
  }
  // Gmail App Passwords are often pasted with spaces between groups.
  const pass = /(^|\.)gmail\.com$/i.test(host) ? password.replace(/\s+/g, "") : rawPass;
  let transport;
  try {
    transport = nodemailer.createTransport({
      host, port, secure: calendar ? port === 465 : config.SMTP_SECURE,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    const dashboard = config.PUBLIC_BASE_URL.replace(/\/+$/, "") + "/#lead-" + encodeURIComponent(lead.id);
    await transport.sendMail({
      from, to,
      subject: "EMPntegral — התקבל מספר טלפון חדש",
      html: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;max-width:500px;margin:auto;color:#202124">' +
        '<h2>ליד חדש השאיר מספר טלפון</h2>' +
        '<p>שם: ' + escapeHtml(lead.name || "לא צוין") + '</p>' +
        '<p>אינסטגרם: ' + escapeHtml(lead.ig_username ? "@" + lead.ig_username : "לא צוין") + '</p>' +
        '<p>טלפון: <b dir="ltr">' + escapeHtml(formatForDisplay(lead.phone)) + '</b></p>' +
        '<p>מקור: ' + escapeHtml(lead.source || "לא צוין") + '</p>' +
        '<p><a href="' + escapeHtml(toWaMe(lead.phone)) + '">פתיחה בוואטסאפ</a></p>' +
        '<p><a href="' + escapeHtml(dashboard) + '">פתיחה בדשבורד</a></p></div>',
      text: [
        "ליד חדש השאיר מספר טלפון",
        "שם: " + (lead.name || "לא צוין"),
        "אינסטגרם: " + (lead.ig_username ? "@" + lead.ig_username : "לא צוין"),
        "טלפון: " + formatForDisplay(lead.phone),
        "מקור: " + (lead.source || "לא צוין"),
        "וואטסאפ: " + toWaMe(lead.phone),
        "דשבורד: " + dashboard,
      ].join("\n"),
    });
    logger.info("Lead phone email sent", { leadId: lead.id });
    return true;
  } catch {
    logger.error("Lead phone email failed", { leadId: lead.id });
    return false;
  } finally {
    transport?.close?.();
  }
}
