import fs from "node:fs";
import path from "node:path";
import express from "express";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { logger } from "./logger.js";

/** Built React app, produced by `npm run build` in the frontend workspace. */
const FRONTEND_DIST = path.resolve(import.meta.dirname, "..", "..", "frontend", "dist");

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  // The raw body is required to verify Meta's HMAC signature, and it must be
  // the exact bytes received. Re-serializing the parsed object would not match.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  app.use("/webhooks", webhooksRouter);
  app.use("/api/auth", authRouter);
  app.use("/api", apiRouter);

  if (fs.existsSync(FRONTEND_DIST)) {
    app.use(express.static(FRONTEND_DIST));

    // The dashboard is a single page app, so any unknown non-API path has to
    // return index.html and let the client render it.
    app.get(/.*/, (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/webhooks")) {
        next();
        return;
      }
      res.sendFile(path.join(FRONTEND_DIST, "index.html"));
    });
  } else {
    logger.warn(
      "frontend/dist not found. Run `npm run build` to serve the dashboard from this server.",
    );
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use((error, _req, res, _next) => {
    logger.error("Unhandled request error", {
      message: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}
