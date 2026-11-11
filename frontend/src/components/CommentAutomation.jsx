import SettingsDialog, { useUnsavedChanges } from "./SettingsDialog.jsx";
import { useEffect, useState } from "react";
import { api } from "../api.js";

function clean(settings) {
  const { enabledSince, generalEnabledSince, ...value } = settings;
  return { ...value, generalEnabled: value.generalEnabled ?? false, overrides: (value.overrides ?? []).map(({ enabledSince, ...rule }) => rule) };
}
const keywordList = value => value.keywords.map(text => text.trim()).filter(Boolean);
/** One short line that says when a reel answers, in the owner's words. */
const whenText = value => value.match === "keywords"
  ? (keywordList(value).length ? "עונה רק לתגובות עם: " + keywordList(value).join(", ") : "עונה רק לתגובות עם מילים, אבל עוד לא נבחרו מילים")
  : "עונה לכל תגובה";

/** The three questions every reply answers, numbered in the order they happen. */
function ResponseFields({ value, onChange, name }) {
  const bytes = new TextEncoder().encode(value.privateText).length;
  return <div className="reply-steps">
    <fieldset className="reply-step">
      <legend><b>1</b>על אילו תגובות לענות?</legend>
      <label className="reply-choice"><input type="radio" name={name} checked={value.match === "all"} onChange={() => onChange({ match: "all" })} /><span>על כל תגובה</span></label>
      <label className="reply-choice"><input type="radio" name={name} checked={value.match === "keywords"} onChange={() => onChange({ match: "keywords" })} /><span>רק כשהתגובה מכילה מילה שבחרתי</span></label>
      {value.match === "keywords" && <label className="message-field reply-step__extra">המילים, אחת בכל שורה<textarea className="input" rows={2} dir="auto" value={value.keywords.join("\n")} onChange={event => onChange({ keywords: event.target.value.split("\n") })} placeholder={"פרטים\nמחיר"} /><small>מספיקה מילה אחת. "פרטים" תופס גם "לפרטים".</small></label>}
    </fieldset>
    <label className="message-field reply-step"><span className="reply-step__title"><b>2</b>תגובה ציבורית <small>מופיעה מתחת לתגובה שלו, כולם רואים</small></span><textarea className="input" rows={2} maxLength={2000} dir="auto" value={value.publicText} onChange={event => onChange({ publicText: event.target.value })} /></label>
    <label className="message-field reply-step"><span className="reply-step__title"><b>3</b>הודעה פרטית <small>נשלחת אליו לתיבת ההודעות, רק הוא רואה</small></span><textarea className="input" rows={3} dir="auto" value={value.privateText} onChange={event => onChange({ privateText: event.target.value })} /><small className={bytes > 1000 ? "is-error" : undefined}>{bytes}/1000 בתים</small></label>
  </div>;
}

function Editor({ settings, onSaved, onError, onClose }) {
  const [draft, setDraft] = useState(() => clean(settings));
  const [open, setOpen] = useState(null);
  const [reels, setReels] = useState([]);
  const [after, setAfter] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(clean(settings));
  useUnsavedChanges(dirty);
  const patch = value => setDraft(current => ({ ...current, ...value }));
  const patchRule = (id, value) => setDraft(current => ({ ...current, overrides: current.overrides.map(rule => rule.mediaId === id ? { ...rule, ...value } : rule) }));
  const load = async cursor => {
    setLoading(true);
    try { const result = await api.reels(cursor); setReels(current => [...new Map([...current, ...result.reels].map(reel => [reel.id, reel])).values()]); setAfter(result.after); setLoaded(true); }
    catch(error) { onError(error); } finally { setLoading(false); }
  };
  // Load once on open so the chosen reels show their picture and caption, not a bare id.
  useEffect(() => { void load(undefined); }, []);
  const addRule = reel => {
    if (!draft.overrides.some(rule => rule.mediaId === reel.id)) patch({ overrides: [...draft.overrides, { mediaId: reel.id, enabled: true, match: "all", keywords: [], publicText: draft.publicText, privateText: draft.privateText }] });
    setOpen(reel.id); setPicker(false);
  };
  const removeRule = id => { patch({ overrides: draft.overrides.filter(rule => rule.mediaId !== id) }); setOpen(null); };
  const normalized = value => ({ ...value, keywords: keywordList(value) });
  const validResponse = value => value.publicText.trim() && value.privateText.trim() && new TextEncoder().encode(value.privateText.trim()).length <= 1000 && (value.enabled === false || value.match !== "keywords" || keywordList(value).length > 0);
  const valid = validResponse({ ...draft, enabled: draft.enabled && draft.generalEnabled }) && draft.overrides.every(validResponse) && (!draft.enabled || !draft.generalEnabled || draft.scope !== "selected" || draft.mediaIds.length > 0);
  const save = async () => {
    setSaving(true);
    try { const result = await api.setCommentSettings({ ...normalized(draft), overrides: draft.overrides.map(normalized) }); onSaved(result); }
    catch(error) { onError(error); } finally { setSaving(false); }
  };
  const reelOf = id => reels.find(reel => reel.id === id);
  const reelName = id => reelOf(id)?.caption?.slice(0, 90) || (loading ? "טוען…" : "ריל " + id);
  const active = draft.overrides.filter(rule => rule.enabled).length;
  const available = reels.filter(reel => !draft.overrides.some(rule => rule.mediaId === reel.id));

  // What will actually happen, said once, in plain words.
  const summary = !draft.enabled
    ? { tone: "off", lines: ["כבוי. לא עונים לאף תגובה על רילז."] }
    : { tone: active || draft.generalEnabled ? "on" : "off", lines: [
      active ? `עונים לתגובות על ${active === 1 ? "ריל אחד" : active + " רילז"} שבחרת.` : "עוד לא בחרת רילז, אז לא עונים לאף תגובה.",
      draft.generalEnabled ? "גם על כל שאר הרילז עונים, עם המענה לשאר הרילז." : "על שאר הרילז לא עונים.",
    ] };

  const renderPicker = forLegacy => <div className="reel-picker">
    <div className="reel-picker__list">{(forLegacy ? reels : available).map(reel => <div className="reel-picker__item" key={reel.id}>
      {reel.thumbnail_url && <img src={reel.thumbnail_url} alt="" loading="lazy" />}
      <div><span>{reel.caption?.slice(0, 100) || reel.id}</span>{reel.permalink && <a href={reel.permalink} className="link" target="_blank" rel="noreferrer">פתח באינסטגרם</a>}</div>
      {forLegacy
        ? <input type="checkbox" aria-label={"בחר " + reelName(reel.id)} checked={draft.mediaIds.includes(reel.id)} onChange={event => patch({ mediaIds: event.target.checked ? [...draft.mediaIds, reel.id] : draft.mediaIds.filter(id => id !== reel.id) })} />
        : <button type="button" className="btn btn--sm btn--primary" onClick={() => addRule(reel)}>הוסף</button>}
    </div>)}</div>
    {loading && <p role="status">טוען רילז…</p>}
    {loaded && !loading && !(forLegacy ? reels : available).length && <p className="rules-help">{reels.length ? "כל הרילז שנטענו כבר ברשימה." : "לא נמצאו רילז בחשבון."}</p>}
    <div className="reel-picker__foot">
      {after && <button type="button" className="btn btn--sm" disabled={loading} onClick={() => load(after)}>טען רילז ישנים יותר</button>}
      {!forLegacy && <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPicker(false)}>סגור</button>}
    </div>
  </div>;

  return <div className="reel-editor">
    <label className="settings-enable"><span><strong>לענות לתגובות על רילז</strong><small>המתג הראשי של החלון הזה. כשהוא כבוי, לא עונים לשום תגובה.</small></span><input type="checkbox" role="switch" checked={draft.enabled} disabled={saving} onChange={event => patch({ enabled: event.target.checked })} /></label>

    <div className={"reel-summary is-" + summary.tone} role="status">
      <strong>מה קורה עכשיו</strong>
      {summary.lines.map(line => <p key={line}>{line}</p>)}
      <ol className="reel-flow" aria-label="סדר הפעולות"><li>מישהו מגיב על הריל</li><li>נשלחת תגובה ציבורית</li><li>נשלחת הודעה פרטית</li></ol>
    </div>

    <fieldset className="settings-fields" disabled={saving || !draft.enabled}>
      <section className="reel-section">
        <header><h3>הרילז שעונים עליהם</h3><span>{draft.overrides.length}</span></header>
        {!draft.overrides.length && <p className="rules-help">עוד אין רילז. לחץ "הוסף ריל" ובחר ריל מהרשימה.</p>}
        <ul className="chosen-reels">{draft.overrides.map(rule => {
          const reel = reelOf(rule.mediaId);
          const isOpen = open === rule.mediaId;
          return <li key={rule.mediaId} className={"chosen-reel" + (isOpen ? " is-open" : "") + (rule.enabled ? "" : " is-paused")}>
            <button type="button" className="chosen-reel__row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : rule.mediaId)}>
              {reel?.thumbnail_url ? <img src={reel.thumbnail_url} alt="" loading="lazy" /> : <span className="chosen-reel__thumb" aria-hidden="true" />}
              <span className="chosen-reel__text"><span>{reelName(rule.mediaId)}</span><small>{rule.enabled ? whenText(rule) : "מושהה, לא עונה"}</small></span>
              <span className="chosen-reel__action">{isOpen ? "סגור" : "ערוך"}</span>
            </button>
            {isOpen && <div className="chosen-reel__editor">
              <ResponseFields value={rule} onChange={value => patchRule(rule.mediaId, value)} name={"match-" + rule.mediaId} />
              <div className="chosen-reel__foot">
                <label className="reply-choice"><input type="checkbox" checked={!rule.enabled} onChange={event => patchRule(rule.mediaId, { enabled: !event.target.checked })} /><span>להשהות את הריל הזה</span></label>
                {reel?.permalink && <a href={reel.permalink} className="link" target="_blank" rel="noreferrer">פתח באינסטגרם</a>}
                <button type="button" className="rule-action rule-action--delete" onClick={() => removeRule(rule.mediaId)}>הסר מהרשימה</button>
              </div>
            </div>}
          </li>;
        })}</ul>
        {picker ? renderPicker(false) : <button type="button" className="btn btn--sm" disabled={draft.overrides.length >= 200} onClick={() => { setPicker(true); setOpen(null); }}>+ הוסף ריל</button>}
      </section>

      <details className="reel-advanced" open={draft.generalEnabled || draft.scope === "selected" || undefined}>
        <summary>מתקדם: מענה לכל שאר הרילז</summary>
        <p className="rules-help">בדרך כלל משאירים כבוי. כשדלוק, כל תגובה על כל ריל שלא ברשימה למעלה תקבל את המענה הזה.</p>
        <label className="settings-enable"><span><strong>לענות גם על כל שאר הרילז</strong><small>{draft.generalEnabled ? "דלוק: כל ריל מקבל מענה." : "כבוי: רק הרילז ברשימה למעלה מקבלים מענה."}</small></span><input type="checkbox" checked={draft.generalEnabled} onChange={event => patch({ generalEnabled: event.target.checked })} /></label>
        {draft.generalEnabled && draft.scope === "selected" && <div className="settings-note"><p>הגדרה ישנה שלך מגבילה את המענה הזה ל־{draft.mediaIds.length} רילז.</p><button type="button" className="btn btn--sm" onClick={() => patch({ scope: "all_reels" })}>החל על כל הרילז</button><details><summary>ערוך את הבחירה הישנה</summary>{renderPicker(true)}</details></div>}
        {draft.generalEnabled && <ResponseFields value={draft} onChange={patch} name="match-general" />}
      </details>
    </fieldset>

    {!valid && <p className="rules-help is-error" role="status">חסר משהו: בדוק שכל תגובה ציבורית והודעה פרטית מלאות, ושבחרת מילים איפה שסימנת "רק כשהתגובה מכילה מילה".</p>}
    <footer className="settings-dialog__footer"><span className="muted">{dirty ? "יש שינויים שלא נשמרו" : "כל השינויים שמורים"}</span><div><button type="button" className="btn btn--ghost" disabled={saving} onClick={onClose}>ביטול</button><button type="button" className="btn btn--primary" disabled={saving || !valid || !dirty} onClick={save}>{saving ? "שומר…" : "שמור שינויים"}</button></div></footer>
  </div>;
}

export default function CommentAutomation({ settings, failed, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  const active = settings?.overrides?.filter(rule => rule.enabled).length ?? 0;
  const status = !settings?.enabled ? "כבוי" : (active ? `עונה על ${active === 1 ? "ריל אחד" : active + " רילז"}` : "פעיל, אבל לא נבחרו רילז") + (settings?.generalEnabled ? " + כל שאר הרילז" : "");
  return <section className="automation-rules settings-launcher"><div><strong>תגובות לרילז</strong><span>{status}</span></div><button type="button" className="btn btn--sm" disabled={!settings} aria-haspopup="dialog" onClick={() => setOpen(true)}>ערוך אוטומציה</button>
    {failed > 0 && <span role="status">{failed} תגובות נכשלו</span>}
    {open && settings && <SettingsDialog title="תגובות לרילז" subtitle="בוחרים רילז, ומי שמגיב עליהם מקבל תגובה ציבורית והודעה פרטית" onClose={() => setOpen(false)}><Editor settings={settings} onSaved={result => { onSaved(result); setOpen(false); }} onError={onError} onClose={() => setOpen(false)} /></SettingsDialog>}
  </section>;
}
