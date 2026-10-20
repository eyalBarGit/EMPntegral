import { useEffect, useRef, useState } from "react";
import { formatDateTime, fromLocalInput, toLocalInput } from "../lib/datetime.js";
import Conversation from "./Conversation.jsx";


const EVENT_LABEL = {
  comment_automation_sent: "נשלחו תגובה לריל והודעה פרטית",
  comment_automation_failed: "שליחת תגובה לריל או הודעה פרטית נכשלה",
  lead_created: "ליד נוצר",
  welcome_sent: "הודעת פתיחה נשלחה",
  phone_captured: "מספר טלפון נקלט",
  duplicate_phone: "מספר כפול",
  whatsapp_sent: "WhatsApp נשלח",
  whatsapp_not_sent: "WhatsApp לא נשלח",
  instagram_send_failed: "שליחה באינסטגרם נכשלה",
  lead_available: "הליד פנוי לשיחה",
  lead_unavailable: "הליד לא פנוי",
  call_scheduled: "נקבעה שיחה",
  call_reminder_sent: "נשלחה תזכורת",
  needs_human: "דורש טיפול אנושי",
  automation_paused: "אוטומציה הושהתה",
  automation_resumed: "אוטומציה חודשה",
  automation_skipped: "אוטומציה דילגה",
  status_changed_manually: "שינוי סטטוס ידני",
  instagram_non_text: "התקבלה הודעה שאינה טקסט",
};


function useDraft(leadId, field, fallback) {
  const key = "emp-draft:" + leadId + ":" + field;
  const [value, setValue] = useState(() => {
    try { return sessionStorage.getItem(key) ?? fallback; } catch { return fallback; }
  });
  useEffect(() => {
    try { if (value === fallback) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch { /* Draft still remains in this view. */ }
  }, [key, value, fallback]);
  return [value, setValue];
}
const SOURCE = { instagram_dm: "הודעה באינסטגרם", instagram_ad: "מודעת אינסטגרם", instagram_reel: "תגובה לריל" };

export default function LeadDetail({ detail, statuses, timezone, onPatch, onAddNote, onClose, busy, crm = false }) {
  const { lead, messages, events } = detail;
  const [notes, setNotes] = useDraft(lead.id, "notes", lead.notes ?? "");
  const [callTime, setCallTime] = useDraft(lead.id, "call", toLocalInput(lead.call_time, timezone));
  const [note, setNote] = useDraft(lead.id, "manual", "");
  const [panel, setPanel] = useState(null);
  const [seenCount, setSeenCount] = useState(messages.length);
  const scroller = useRef(null);
  const newCount = Math.max(0, messages.length - seenCount);
  const title = lead.name || (lead.ig_username ? "@" + lead.ig_username : "ליד #" + lead.id);
  const notesDirty = notes !== (lead.notes ?? "");
  const toggle = name => setPanel(current => current === name ? null : name);
  const saveNotes = async () => { if (await onPatch({ notes })) setPanel(null); };
  const saveCall = async () => {
    const value = fromLocalInput(callTime, timezone);
    if (!value) return;
    if (await onPatch({ call_time: value, status: "call_scheduled" })) setPanel(null);
  };
  return <section className="panel panel--detail lead-workspace">
    <header className="lead-header">
      <div className="lead-header__identity">
        <button type="button" className="btn btn--ghost detail__back" onClick={onClose}>חזרה</button>
        <div><h2>{title}</h2><div className="lead-header__meta">
          {lead.ig_username && <a className="link" href={"https://instagram.com/" + lead.ig_username} target="_blank" rel="noreferrer" dir="ltr">@{lead.ig_username}</a>}
          <span>{SOURCE[lead.source] ?? lead.source}</span>
          {lead.phone ? <a className="link" href={lead.tel_url} dir="ltr">{lead.phone_display}</a> : crm ? <span>ממתין למספר טלפון</span> : null}
        </div></div>
        {crm && <label className="lead-header__status"><span className="sr-only">סטטוס הפנייה</span><select className="input" value={lead.status} disabled={busy} onChange={event => onPatch({ status: event.target.value })}>{statuses.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>}
      </div>
      <div className="lead-toolbar">
        {crm && lead.whatsapp_url && <a className="btn btn--primary btn--sm" href={lead.whatsapp_url} target="_blank" rel="noreferrer">פתח בוואטסאפ</a>}
        {crm && lead.tel_url && <a className="btn btn--sm" href={lead.tel_url}>חייג</a>}
        {crm && <button type="button" className={"btn btn--sm " + (panel === "call" ? "is-selected" : "btn--ghost")} onClick={() => toggle("call")} aria-expanded={panel === "call"}>{lead.call_time ? "שנה מועד" : "קבע שיחה"}</button>}
        {crm && <button type="button" className={"btn btn--sm " + (panel === "notes" ? "is-selected" : "btn--ghost")} onClick={() => toggle("notes")} aria-expanded={panel === "notes"}>הערות{notesDirty ? " · טיוטה" : ""}</button>}
        {!crm && <button type="button" className="btn btn--sm btn--ghost" disabled={busy} onClick={() => onPatch({ automation_paused: !lead.automation_paused })}>{lead.automation_paused ? "חדש מענה לאיש הקשר" : "השהה מענה לאיש הקשר"}</button>}
        {crm && <details className="lead-menu"><summary className="btn btn--sm btn--ghost">פעולות נוספות</summary><div>
          <button type="button" disabled={busy} onClick={() => onPatch({ automation_paused: !lead.automation_paused })}>{lead.automation_paused ? "חדש אוטומציה לליד" : "העבר לטיפול ידני"}</button>
          <button type="button" disabled={busy || lead.status === "registered"} onClick={() => onPatch({ status: "registered" })}>סמן כנרשם</button>
          <button type="button" disabled={busy || lead.status === "not_relevant"} onClick={() => onPatch({ status: "not_relevant" })}>סמן כלא רלוונטי</button>
          <button type="button" onClick={() => toggle("manual")}>תעד הודעה שנשלחה מחוץ למערכת</button>
        </div></details>}
        {lead.automation_paused && <span className="tag tag--paused">טיפול ידני</span>}
      </div>
      {crm && (lead.call_time || lead.notes) && <div className="lead-summary">
        {lead.call_time && <button type="button" onClick={() => toggle("call")}>שיחה: {formatDateTime(lead.call_time, timezone)}</button>}
        {lead.notes && <button type="button" onClick={() => toggle("notes")} title={lead.notes}>הערה: {lead.notes.slice(0, 100)}{lead.notes.length > 100 ? "…" : ""}</button>}
      </div>}
    </header>
    <div className="lead-content" ref={scroller} onScroll={() => { const node = scroller.current; if (node && node.scrollHeight - node.scrollTop - node.clientHeight < 40) setSeenCount(messages.length); }}>
      {crm && panel === "notes" && <section className="lead-inline-editor"><label>הערות לפנייה<textarea className="input" rows={3} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)} placeholder="מה חשוב לזכור להמשך הטיפול?" /></label><div><span className="muted">הטיוטה נשמרת במעבר בין לידים בחלון הזה.</span><button type="button" className="btn btn--primary btn--sm" disabled={busy || !notesDirty} onClick={saveNotes}>שמור הערה</button></div></section>}
      {crm && panel === "call" && <section className="lead-inline-editor"><label>מועד השיחה<input className="input" type="datetime-local" value={callTime} onChange={event => setCallTime(event.target.value)} /></label><div><button type="button" className="btn btn--primary btn--sm" disabled={busy || !callTime} onClick={saveCall}>שמור מועד</button>{lead.call_time && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={async () => { if (await onPatch({ call_time: null, call_time_raw: null, status: lead.status === "call_scheduled" ? "follow_up" : lead.status })) { setCallTime(""); setPanel(null); } }}>בטל שיחה</button>}</div></section>}
      {crm && panel === "manual" && <form className="lead-inline-editor" onSubmit={async event => { event.preventDefault(); if (note.trim() && await onAddNote(note.trim())) { setNote(""); setPanel(null); } }}><label>תיעוד פנימי של הודעה<input className="input" value={note} maxLength={4000} onChange={event => setNote(event.target.value)} /></label><div><span className="muted">התיעוד לא שולח הודעה ללקוח.</span><button className="btn btn--primary btn--sm" disabled={busy || !note.trim()}>הוסף לתיעוד</button></div></form>}
      <div className="conversation-heading"><h3>השיחה</h3><span>{messages.length} הודעות</span></div>
      <Conversation messages={messages} timezone={timezone} />
      <details className="timeline"><summary>פרטי פנייה ויומן אירועים</summary><p className="muted">נוצרה ב־{formatDateTime(lead.created_at, timezone)}</p><ul>{events.map(event => <li key={event.id}><span className="timeline__time">{formatDateTime(event.created_at, timezone)}</span><span>{EVENT_LABEL[event.type] ?? event.type}{event.data?.reason ? " · " + event.data.reason : ""}</span></li>)}</ul></details>
      {newCount > 0 && <button type="button" className="new-messages btn btn--primary btn--sm" onClick={() => { const node = scroller.current; if (node) node.scrollTop = node.scrollHeight; setSeenCount(messages.length); }}>{newCount} הודעות חדשות ↓</button>}
    </div>
  </section>;
}
