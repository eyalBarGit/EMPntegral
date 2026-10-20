export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export async function postJson({ url, body, token, timeoutMs = 15_000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON error pages are surfaced as raw text */
    }

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === "object" && "error" in parsed
          ? JSON.stringify(parsed.error)
          : String(text).slice(0, 500);
      throw new ApiError(`HTTP ${response.status}: ${detail}`, response.status, parsed);
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}
