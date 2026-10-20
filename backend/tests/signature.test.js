import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeEquals, verifyMetaSignature } from "../src/lib/signature.js";

const SECRET = "test-app-secret";
const sign = (body) =>
  `sha256=${crypto.createHmac("sha256", SECRET).update(body).digest("hex")}`;

describe("verifyMetaSignature", () => {
  const body = JSON.stringify({ object: "instagram", entry: [{ id: "1" }] });

  it("accepts a signature produced with the app secret", () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyMetaSignature(Buffer.from(body), sign(body), SECRET)).toBe(true);
  });

  it("rejects a body that was altered in transit", () => {
    const tampered = body.replace("instagram", "whatsapp");
    expect(verifyMetaSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const forged = `sha256=${crypto.createHmac("sha256", "wrong").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, forged, SECRET)).toBe(false);
  });

  it("rejects malformed or missing headers", () => {
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=nothex", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=aabb", SECRET)).toBe(false);
  });

  it("refuses to validate anything when no secret is configured", () => {
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });
});

describe("safeEquals", () => {
  it("compares equal strings", () => {
    expect(safeEquals("hunter2", "hunter2")).toBe(true);
  });

  it("rejects different strings and different lengths", () => {
    expect(safeEquals("hunter2", "hunter3")).toBe(false);
    expect(safeEquals("short", "much-longer-value")).toBe(false);
  });
});
