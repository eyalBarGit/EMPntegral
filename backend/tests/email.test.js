import { beforeEach, expect, it, vi } from "vitest";
const { sendMail, close, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(); const close = vi.fn();
  return { sendMail, close, createTransport: vi.fn(() => ({ sendMail, close })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));
import { config } from "../src/config.js";
import { sendPhoneReceivedEmail } from "../src/channels/email.js";
const lead = { id: "123", name: "דנה", phone: "+972501234567", ig_username: "dana", source: "instagram_dm" };
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(config, { EMAIL_HOST: "", ADMIN_NOTIFY_EMAIL: "", SMTP_USER: "", SMTP_HOST: "smtp.example.com", SMTP_FROM: "sender@example.com", LEAD_ALERT_EMAIL: "owner@example.com" });
  sendMail.mockResolvedValue({ messageId: "test" });
});
it("sends the captured phone and lead links to the configured owner", async () => {
  expect(await sendPhoneReceivedEmail(lead)).toBe(true);
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "owner@example.com", text: expect.stringContaining("https://wa.me/972501234567") }));
  expect(sendMail.mock.calls[0][0].text).toContain("#lead-123");
  expect(close).toHaveBeenCalledOnce();
});
it("skips delivery when configuration is missing", async () => {
  config.LEAD_ALERT_EMAIL = "";
  expect(await sendPhoneReceivedEmail(lead)).toBe(false);
  expect(createTransport).not.toHaveBeenCalled();
});
it("contains SMTP failures and closes the transport", async () => {
  sendMail.mockRejectedValue(new Error("SMTP failed"));
  expect(await sendPhoneReceivedEmail(lead)).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});

it("uses Calendar Gmail settings, strips password spaces and escapes HTML", async () => {
  Object.assign(config, { EMAIL_HOST: "smtp.gmail.com", EMAIL_PORT: 465, EMAIL_USER: "sender@example.com", EMAIL_PASS: "abcd efgh ijkl mnop", ADMIN_NOTIFY_EMAIL: "admin@example.com" });
  expect(await sendPhoneReceivedEmail({ ...lead, name: '<script>"test"</script>' })).toBe(true);
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, auth: { user: "sender@example.com", pass: "abcdefghijklmnop" } }));
  expect(sendMail.mock.calls[0][0].to).toBe("admin@example.com");
  expect(sendMail.mock.calls[0][0].html).toContain("&lt;script&gt;");
  expect(sendMail.mock.calls[0][0].html).not.toContain("<script>");
});
it("rejects Calendar placeholder credentials without opening a connection", async () => {
  Object.assign(config, { EMAIL_HOST: "smtp.gmail.com", EMAIL_USER: "sender@example.com", EMAIL_PASS: "your-gmail-app-password" });
  expect(await sendPhoneReceivedEmail(lead)).toBe(false);
  expect(createTransport).not.toHaveBeenCalled();
});
