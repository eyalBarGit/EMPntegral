import { useState } from "react";
import SettingsDialog, { useUnsavedChanges } from "./SettingsDialog.jsx";
import { api } from "../api.js";

// Same idea as the server's matching: punctuation, case and spacing don't matter.
const normalize = text => String(text ?? "").normalize("NFKC").toLowerCase().replace(/\p{M}/gu, "").replace(/[’'"]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Every phrase matches anywhere; older "starts_with" rules and duplicates fold into one list. */
function toPhrases(rules) {
  const seen = new Set();
  return rules.map(rule => rule.text.trim()).filter(text => {
    const key = normalize(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const toRules = phrases => phrases.map(text => ({ mode: "contains", text }));

function Editor({ rules, templates, welcomeText, onSaveRules, onWelcomeSaved, onError, onClose }) {
  const initialPhrases = toPhrases(rules);
  const [phrases, setPhrases] = useState(initialPhrases);
  const [text, setText] = useState("");
  const [welcome, setWelcome] = useState(welcomeText ?? "");
  const [saving, setSaving] = useState(false);
  // Compared with the cleaned list, so folding duplicates on open is not a change the owner made.
  const rulesDirty = JSON.stringify(phrases) !== JSON.stringify(initialPhrases);
  const welcomeDirty = welcome !== (welcomeText ?? "");
  const dirty = rulesDirty || welcomeDirty;
  useUnsavedChanges(dirty || Boolean(text.trim()));
  const bytes = new TextEncoder().encode(welcome.trim()).length;
  const has = value => phrases.some(item => normalize(item) === normalize(value));
  const canAdd = normalize(text) && !has(text) && phrases.length < 50;
  const add = value => { if (normalize(value) && !has(value) && phrases.length < 50) setPhrases(current => [...current, value.trim()]); };
  const suggestions = templates.filter(value => !has(value));
  const valid = welcome.trim() && bytes <= 1000;

  const save = async () => {
    setSaving(true);
    try {
      if (welcomeDirty) onWelcomeSaved(await api.setWelcomeText(welcome));
      if (rulesDirty && !(await onSaveRules(toRules(phrases)))) return;
      onClose();
    } catch (error) { onError(error); } finally { setSaving(false); }
  };

  return <div className="reel-editor">
    <div className={"reel-summary is-" + (phrases.length ? "on" : "off")} role="status">
      <strong>מה קורה עכשיו</strong>
      <p>{phrases.length
        ? `מי שכותב לך בפעם הראשונה הודעה שמכילה אחד מ־${phrases.length} הביטויים, מקבל את הודעת הפתיחה.`
        : "אין ביטויים, אז לא נשלחת הודעת פתיחה לאף אחד."}</p>
      <p>הודעות אחרות נשמרות בתיבת ההודעות בלי מענה.</p>
      <ol className="reel-flow" aria-label="סדר הפעולות"><li>מישהו כותב ביטוי</li><li>נשלחת הודעת הפתיחה</li><li>הוא שולח מספר טלפון</li><li>הליד עובר ל־CRM</li></ol>
    </div>

    <fieldset className="settings-fields" disabled={saving}>
      <section className="reply-steps">
        <div className="reply-step">
          <span className="reply-step__title"><b>1</b>מתי לענות? <small>כשההודעה מכילה אחד מהביטויים, בכל מקום בהודעה</small></span>
          {phrases.length ? <ul className="phrase-list">{phrases.map(phrase => <li key={phrase}>
            <span dir="auto">{phrase}</span>
            <button type="button" aria-label={"מחק את הביטוי " + phrase} onClick={() => setPhrases(current => current.filter(item => item !== phrase))}>×</button>
          </li>)}</ul> : <p className="rules-help">עוד אין ביטויים. הוסף לפחות אחד.</p>}
          <div className="phrase-add">
            <input className="input" dir="auto" maxLength={300} value={text} aria-label="ביטוי חדש" placeholder="ביטוי חדש, למשל: כמה עולה" onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (canAdd) { add(text); setText(""); } } }} />
            <button type="button" className="btn btn--sm btn--primary" disabled={!canAdd} onClick={() => { add(text); setText(""); }}>הוסף</button>
          </div>
          <small className="phrase-help">{text.trim() && has(text) ? "הביטוי הזה כבר ברשימה." : "פיסוק ואותיות גדולות לא משנים. \"קורס\" תופס גם \"הקורס\" ו\"לקורס\"."}</small>
          {suggestions.length > 0 && <details className="phrase-suggestions">
            <summary>ביטויים מוכנים ({suggestions.length})</summary>
            <div>{suggestions.map(value => <button type="button" key={value} dir="auto" onClick={() => add(value)}>+ {value}</button>)}</div>
          </details>}
        </div>

        <label className="message-field reply-step">
          <span className="reply-step__title"><b>2</b>מה לשלוח? <small>הודעת הפתיחה, נשלחת פעם אחת לכל אדם</small></span>
          <textarea className="input" dir="auto" rows={8} value={welcome} onChange={event => setWelcome(event.target.value)} />
          <span className="message-field__meta"><span>כדאי לסיים בבקשה למספר טלפון. כשהוא שולח מספר, הוא עובר ל־CRM.</span><span className={bytes > 1000 ? "is-error" : undefined}>{bytes}/1000 בתים</span></span>
        </label>
      </section>
    </fieldset>

    {!valid && <p className="rules-help is-error" role="status">הודעת הפתיחה ריקה או ארוכה מ־1000 בתים.</p>}
    <footer className="settings-dialog__footer"><span className="muted" role="status">{dirty ? "יש שינויים שלא נשמרו" : "כל השינויים שמורים"}</span><div><button type="button" className="btn btn--ghost" disabled={saving} onClick={onClose}>ביטול</button><button type="button" className="btn btn--primary" disabled={saving || !dirty || !valid || Boolean(text.trim())} title={text.trim() ? "לחץ \"הוסף\" על הביטוי שכתבת, או מחק אותו, לפני השמירה" : undefined} onClick={save}>{saving ? "שומר…" : "שמור שינויים"}</button></div></footer>
  </div>;
}

export default function AutomationRules({ rules, templates, onSave, welcomeText, onWelcomeSaved, onError }) {
  const [open, setOpen] = useState(false);
  const count = rules ? toPhrases(rules).length : 0;
  return <section className="automation-rules settings-launcher">
    <div><strong>מענה להודעות</strong><span>{count ? `עונה להודעות עם אחד מ־${count} ביטויים` : "אין ביטויים, לא עונה"}</span></div>
    <button type="button" className="btn btn--sm" disabled={!rules} aria-haspopup="dialog" onClick={() => setOpen(true)}>ערוך אוטומציה</button>
    {open && rules && <SettingsDialog title="מענה להודעות" subtitle="מי שכותב לך ביטוי שבחרת מקבל את הודעת הפתיחה" onClose={() => setOpen(false)}>
      <Editor rules={rules} templates={templates ?? []} welcomeText={welcomeText} onSaveRules={onSave} onWelcomeSaved={onWelcomeSaved} onError={onError} onClose={() => setOpen(false)} />
    </SettingsDialog>}
  </section>;
}
