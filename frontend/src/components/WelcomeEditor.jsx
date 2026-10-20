import { useUnsavedChanges } from "./SettingsDialog.jsx";
import { useState } from "react";
import { api } from "../api.js";
export default function WelcomeEditor({ text, onSaved, onError, onClose }) {
  const [draft, setDraft] = useState(text ?? "");
  const [saving, setSaving] = useState(false);
  useUnsavedChanges(draft !== text);
  const bytes = new TextEncoder().encode(draft.trim()).length;
  const save = async () => {
    setSaving(true);
    try { onSaved(await api.setWelcomeText(draft)); onClose(); }
    catch (error) { onError(error); }
    finally { setSaving(false); }
  };
  return <div className="welcome-editor">
    <p className="rules-summary">זו ההודעה שתישלח כשמתקבלת פנייה שמתאימה לאחד מכללי הפתיחה שלך.</p>
    <label className="message-field">הודעת הפתיחה<textarea className="input" dir="auto" rows={6} value={draft} disabled={saving} onChange={event => setDraft(event.target.value)} /></label>
    <div className="message-field__meta"><span>מומלץ לסיים בבקשה למספר טלפון להמשך התהליך.</span><span>{bytes}/1000 בתים</span></div>
    <div className="message-preview"><span>תצוגה מקדימה</span><p dir="auto">{draft || "הטקסט יופיע כאן"}</p></div>
    <p className="rules-help">השינוי חל על פתיחות חדשות. הודעת פתיחה שכבר נשלחה לליד לא נשלחת שוב.</p>
    <footer className="settings-dialog__footer"><button type="button" className="btn btn--ghost" disabled={saving} onClick={onClose}>ביטול</button><button type="button" className="btn btn--primary" disabled={saving || !draft.trim() || bytes > 1000 || draft === text} onClick={save}>{saving ? "שומר…" : "שמור נוסח"}</button></footer>
  </div>;
}
