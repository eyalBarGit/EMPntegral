/** Groups the eleven statuses into four colour families. */
const TONE = {
  new: "hot",
  phone_received: "hot",
  available: "hot",
  awaiting_phone: "wait",
  whatsapp_sent: "wait",
  follow_up: "wait",
  no_answer: "wait",
  call_scheduled: "sched",
  registered: "done",
  not_relevant: "muted",
  manual: "muted",
};

export default function StatusPill({ status, label }) {
  return <span className={`pill pill--${TONE[status] ?? "muted"}`}>{label ?? status}</span>;
}
