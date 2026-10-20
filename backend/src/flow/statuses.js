export const LEAD_STATUSES = [
  "new",
  "awaiting_phone",
  "phone_received",
  "whatsapp_sent",
  "available",
  "call_scheduled",
  "no_answer",
  "follow_up",
  "registered",
  "not_relevant",
  "manual",
];

export const STATUS_LABELS = {
  new: "ליד חדש",
  awaiting_phone: "ממתין למספר",
  phone_received: "מספר התקבל",
  whatsapp_sent: "הודעת WhatsApp נשלחה",
  available: "פנוי לשיחה",
  call_scheduled: "שיחה נקבעה",
  no_answer: "לא ענה",
  follow_up: "מעקב",
  registered: "נרשם",
  not_relevant: "לא רלוונטי",
  manual: "טיפול ידני",
};

export const isLeadStatus = (value) =>
  typeof value === "string" && LEAD_STATUSES.includes(value);

/**
 * Statuses that mean a human took over or the lead is closed. The flow engine
 * refuses to send anything automatic once a lead reaches one of these.
 */
const TERMINAL = new Set(["manual", "registered", "not_relevant"]);

export const isTerminal = (status) => TERMINAL.has(status);
