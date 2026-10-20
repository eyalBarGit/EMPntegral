import { formatDateTime } from "../lib/datetime.js";

const CHANNEL_LABEL = {
  instagram: "Instagram",
  instagram_comment: "תגובה לריל",
  whatsapp: "WhatsApp",
  system: "פנימי",
};

function undelivered(message) {
  const meta = message.meta;
  if (!meta || message.direction !== "out") return null;
  if (meta.failed) return "ההודעה לא נשלחה";
  if (meta.delivered === false) {
    return meta.skipped === "disabled" ? "לא נשלח: הערוץ כבוי" : "ההודעה לא נשלחה";
  }
  return null;
}

export default function Conversation({ messages, timezone }) {
if (messages.length === 0) {
    return <p className="empty">אין הודעות עדיין</p>;
  }

  return (
    <div className="thread">
      {messages.map((message) => {
        const warning = undelivered(message);
        return (
          <article
            key={message.id}
            className={`bubble bubble--${message.direction} bubble--${message.channel}`}
          >
            <p className="bubble__body">{message.body}</p>
            <footer className="bubble__meta">
              <span>{CHANNEL_LABEL[message.channel] ?? message.channel}</span>
              <span>{formatDateTime(message.created_at, timezone)}</span>
              {warning ? <span className="bubble__warn">{warning}</span> : null}
              {message.meta?.billedCategory ? (
                <span className="bubble__tag">חויב כ-{message.meta.billedCategory}</span>
              ) : null}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
