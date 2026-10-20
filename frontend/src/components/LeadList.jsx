import { formatRelative, minutesUntil } from "../lib/datetime.js";
import StatusPill from "./StatusPill.jsx";

function LeadRow({ lead, active, onSelect, crm }) {
  const title = lead.name || (lead.ig_username ? `@${lead.ig_username}` : `ליד #${lead.id}`);
  const untilCall = lead.status === "call_scheduled" ? minutesUntil(lead.call_time) : null;
  const imminent = untilCall !== null && untilCall <= 60 && untilCall >= -30;

  return (
    <li>
      <button
        type="button"
        className={`lead-row ${active ? "is-active" : ""} ${lead.has_unread ? "is-unread" : ""}`}
        aria-current={active ? "true" : undefined}
        onClick={() => onSelect(lead.id)}
      >
        <div className="lead-row__top">
          <span className="lead-row__name">{lead.has_unread && <i className="unread-dot" aria-label="לא נקרא" />}{title}</span>
          <span className="lead-row__time">{formatRelative(lead.updated_at)}</span>
        </div>

        <p className="lead-row__preview" dir="auto">{lead.last_message ? (lead.last_message_direction === "out" ? "אתה: " : "") + lead.last_message : "טרם התקבלה הודעה"}</p>
        <div className="lead-row__bottom">
          {crm && <StatusPill status={lead.status} label={lead.status_label} />}
          {lead.phone_display ? (
            <span className="lead-row__phone" dir="ltr">
              {lead.phone_display}
            </span>
          ) : crm ? (
            <span className="lead-row__phone lead-row__phone--missing">אין מספר</span>
          ) : null}
          {lead.automation_paused ? <span className="tag tag--paused">ידני</span> : null}
          {crm && imminent ? <span className="tag tag--soon">שיחה קרובה</span> : null}
        </div>
      </button>
    </li>
  );
}

export default function LeadList({
  leads,
  counts,
  statuses,
  activeStatus,
  onStatusChange,
  search,
  onSearchChange,
  selectedId,
  onSelect,
  loading,
  crm = false,
  inboxView = "all",
  onInboxViewChange,
}) {
  const visible = leads.filter(lead => inboxView === "unread" ? lead.has_unread : inboxView === "attention" ? ["manual", "phone_received", "available", "no_answer", "follow_up"].includes(lead.status) : true);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <section className="panel panel--list">
      <div className="list-controls">
        <div className="list-title"><h2>{crm ? "ניהול לידים" : "הודעות"}</h2><span>{total}</span></div>
        <div className="inbox-tabs">{(crm ? [["all", "הכל"], ["unread", "לא נקראו"], ["attention", "לטיפול"]] : [["all", "הכל"], ["unread", "לא נקראו"]]).map(([value, label]) => <button type="button" key={value} aria-pressed={inboxView === value} onClick={() => onInboxViewChange?.(value)}>{label}</button>)}</div>
        <input
          type="search"
          className="input"
          aria-label="חיפוש פניות"
          placeholder="חיפוש פנייה…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />

        {crm && <div className="chips">
          <button
            type="button"
            className={`chip ${activeStatus === "" ? "is-active" : ""}`}
            onClick={() => onStatusChange("")}
          >
            הכל
            <span className="chip__count">{total}</span>
          </button>

          {statuses
            .filter((status) => counts[status.value])
            .map((status) => (
              <button
                key={status.value}
                type="button"
                className={`chip ${activeStatus === status.value ? "is-active" : ""}`}
                onClick={() => onStatusChange(status.value)}
              >
                {status.label}
                <span className="chip__count">{counts[status.value]}</span>
              </button>
            ))}
        </div>}
      </div>

      {visible.length === 0 ? (
        <p className="empty">{loading ? "טוען..." : "אין לידים להצגה"}</p>
      ) : (
        <ul className="lead-list">
          {visible.map((lead) => (
            <LeadRow
              key={lead.id}
              crm={crm}
              lead={lead}
              active={lead.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
