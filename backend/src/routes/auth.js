import crypto from "node:crypto";
import { Router } from "express";
import { config } from "../config.js";
import { safeEquals } from "../lib/signature.js";

const COOKIE_NAME = "emp_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const sign = (payload) =>
  crypto.createHmac("sha256", config.SESSION_SECRET).update(payload).digest("hex");

const issue = () => {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt)}`;
};

function isValid(token) {
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;
  if (!safeEquals(signature, sign(expiresAt))) return false;
  return Number(expiresAt) > Date.now();
}

/** Minimal cookie reader; the app has no other cookie needs. */
function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

export function requireAuth(req, res, next) {
  if (isValid(readCookie(req, COOKIE_NAME))) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

export const authRouter = Router();

authRouter.get("/session", (req, res) => {
  res.json({ authenticated: isValid(readCookie(req, COOKIE_NAME)) });
});

authRouter.post("/login", (req, res) => {
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!safeEquals(password, config.DASHBOARD_PASSWORD)) {
    res.status(401).json({ error: "סיסמה שגויה" });
    return;
  }

  res.cookie(COOKIE_NAME, issue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  res.json({ ok: true });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});
