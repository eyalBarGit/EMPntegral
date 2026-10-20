export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

const MESSAGES = {
  phone_belongs_to_another_lead: "מספר הטלפון כבר משויך לליד אחר",
  invalid_status: "סטטוס לא חוקי",
  invalid_body: "הנתונים שנשלחו אינם תקינים",
  not_found: "הליד לא נמצא",
  unauthorized: "פג תוקף החיבור, יש להתחבר מחדש",
};

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const code = payload?.error;
    throw new ApiError(MESSAGES[code] ?? code ?? "אירעה שגיאה", response.status, payload);
  }

  return payload;
}

export const api = {
  session: () => request("/auth/session"),
  login: (password) => request("/auth/login", { method: "POST", body: { password } }),
  logout: () => request("/auth/logout", { method: "POST" }),

  meta: () => request("/meta"),
  setWelcomeText: (text) => request("/settings/welcome", { method: "PATCH", body: { text } }),
  setCommentSettings: (settings) => request("/settings/comments", { method: "PATCH", body: settings }),
  reels: (after) => request("/instagram/reels" + (after ? "?after=" + encodeURIComponent(after) : "")),
  setTriggerRules: (rules) => request("/settings/triggers", { method: "PATCH", body: { rules } }),
  setAutomation: (enabled) => request("/settings/automation", { method: "PATCH", body: { enabled } }),

  leads: ({ status, search, hasPhone } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (hasPhone) params.set("hasPhone", "true");
    if (search) params.set("search", search);
    const query = params.toString();
    return request(`/leads${query ? `?${query}` : ""}`);
  },

  lead: (id) => request(`/leads/${id}`),
  markRead: (id, through) => request(`/leads/${id}/read`, { method: "POST", body: { through } }),
  patchLead: (id, patch) => request(`/leads/${id}`, { method: "PATCH", body: patch }),
  addNote: (id, body) => request(`/leads/${id}/notes`, { method: "POST", body: { body } }),
};
