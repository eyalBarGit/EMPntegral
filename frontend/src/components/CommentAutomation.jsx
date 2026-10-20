import SettingsDialog, { useUnsavedChanges } from "./SettingsDialog.jsx";
import { useState } from "react";
import { api } from "../api.js";

function clean(settings) {
  const { enabledSince, generalEnabledSince, ...value } = settings;
  return { ...value, generalEnabled: value.generalEnabled ?? true, overrides: (value.overrides ?? []).map(({ enabledSince, ...rule }) => rule) };
}
function ResponseFields({ value, onChange, prefix }) {
  const bytes = new TextEncoder().encode(value.privateText).length;
  return <div className="response-fields">
    <label className="message-field">על אילו תגובות לענות?<select className="input" value={value.match} onChange={event => onChange({ match: event.target.value })}><option value="all">כל תגובה</option><option value="keywords">רק מילים או ביטויים שבחרתי</option></select></label>
    {value.match === "keywords" && <label className="message-field">מילים או ביטויים<textarea className="input" rows={2} value={value.keywords.join("\n")} onChange={event => onChange({ keywords: event.target.value.split("\n") })} placeholder="ביטוי אחד בכל שורה" /><small>התאמה לביטוי אחד מספיקה.</small></label>}
    <label className="message-field">תגובה ציבורית<textarea className="input" rows={2} maxLength={2000} dir="auto" value={value.publicText} onChange={event => onChange({ publicText: event.target.value })} /></label>
    <label className="message-field">הודעה פרטית<textarea className="input" rows={3} dir="auto" value={value.privateText} onChange={event => onChange({ privateText: event.target.value })} /><small>{bytes}/1000 בתים · נשלחת אחרי התגובה הציבורית</small></label>
  </div>;
}
function Editor({ settings, onSaved, onError, onClose }) {
  const [draft, setDraft] = useState(() => clean(settings));
  const [tab, setTab] = useState("general");
  const [selected, setSelected] = useState(null);
  const [reels, setReels] = useState([]);
  const [after, setAfter] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(clean(settings));
  useUnsavedChanges(dirty);
  const patch = value => setDraft(current => ({ ...current, ...value }));
  const patchRule = value => patch({ overrides: draft.overrides.map(rule => rule.mediaId === selected ? { ...rule, ...value } : rule) });
  const load = async cursor => {
    setLoading(true);
    try { const result = await api.reels(cursor); setReels(current => [...new Map([...current, ...result.reels].map(reel => [reel.id, reel])).values()]); setAfter(result.after); setLoaded(true); }
    catch(error) { onError(error); } finally { setLoading(false); }
  };
  const addRule = reel => {
    if (!draft.overrides.some(rule => rule.mediaId === reel.id)) patch({ overrides: [...draft.overrides, { mediaId: reel.id, enabled: true, match: "all", keywords: [], publicText: draft.publicText, privateText: draft.privateText }] });
    setSelected(reel.id); setPicker(false);
  };
  const normalized = value => ({ ...value, keywords: value.keywords.map(text => text.trim()).filter(Boolean) });
  const validResponse = value => value.publicText.trim() && value.privateText.trim() && new TextEncoder().encode(value.privateText.trim()).length <= 1000 && (value.enabled === false || value.match !== "keywords" || value.keywords.some(text => text.trim()));
  const valid = validResponse({ ...draft, enabled: draft.enabled && draft.generalEnabled }) && draft.overrides.every(validResponse) && (!draft.enabled || !draft.generalEnabled || draft.scope !== "selected" || draft.mediaIds.length > 0);
  const activeRule = draft.overrides.find(rule => rule.mediaId === selected);
  const save = async () => {
    setSaving(true);
    try { const result = await api.setCommentSettings({ ...normalized(draft), overrides: draft.overrides.map(normalized) }); onSaved(result); }
    catch(error) { onError(error); } finally { setSaving(false); }
  };
  const reelName = id => reels.find(reel => reel.id === id)?.caption?.slice(0, 90) || "ריל " + id;
  const renderPicker = forLegacy => <div className="reel-picker">
    <button type="button" className="btn btn--sm" disabled={loading} onClick={() => load(undefined)}>{loaded ? "רענן רילז" : "טען רילז מהחשבון"}</button>
    <div className="reel-picker__list">{reels.map(reel => <div className="reel-picker__item" key={reel.id}>
      {reel.thumbnail_url && <img src={reel.thumbnail_url} alt="" loading="lazy" />}
      <div><span>{reel.caption?.slice(0, 100) || reel.id}</span>{reel.permalink && <a href={reel.permalink} className="link" target="_blank" rel="noreferrer">פתח באינסטגרם</a>}</div>
      {forLegacy ? <input type="checkbox" aria-label={"בחר " + reelName(reel.id)} checked={draft.mediaIds.includes(reel.id)} onChange={event => patch({ mediaIds: event.target.checked ? [...draft.mediaIds, reel.id] : draft.mediaIds.filter(id => id !== reel.id) })} /> : <button type="button" className="btn btn--sm" onClick={() => addRule(reel)}>{draft.overrides.some(rule => rule.mediaId === reel.id) ? "ערוך" : "בחר ריל"}</button>}
    </div>)}</div>
    {loading && <p role="status">טוען…</p>}{loaded && !reels.length && <p>אין רילז בעמוד הזה.</p>}
    {after && <button type="button" className="btn btn--sm" disabled={loading} onClick={() => load(after)}>טען עוד</button>}
  </div>;
  return <div className="reel-editor">
    <label className="settings-enable"><span><strong>הפעל אוטומציות לרילז</strong><small>כיבוי עוצר גם את המענה הכללי וגם את ההגדרות הספציפיות.</small></span><input type="checkbox" role="switch" checked={draft.enabled} disabled={saving} onChange={event => patch({ enabled: event.target.checked })} /></label>
    <div className="settings-tabs"><button type="button" aria-pressed={tab === "general"} onClick={() => setTab("general")}>מענה כללי</button><button type="button" aria-pressed={tab === "specific"} onClick={() => setTab("specific")}>רילז ספציפיים · {draft.overrides.length}</button></div>
    <fieldset className="settings-fields" disabled={saving}>
    <div hidden={tab !== "general"}>
      <label className="settings-enable"><span><strong>מענה ברירת מחדל</strong><small>חל על כל ריל שאין לו הגדרה ספציפית.</small></span><input type="checkbox" checked={draft.generalEnabled} onChange={event => patch({ generalEnabled: event.target.checked })} /></label>
      {draft.scope === "selected" && <div className="settings-note"><p>ההגדרה הקיימת שלך נשמרה ומוגבלת ל־{draft.mediaIds.length} רילז שנבחרו.</p><button type="button" className="btn btn--sm" onClick={() => patch({ scope: "all_reels" })}>החל את המענה הכללי על כל הרילז</button><details><summary>ערוך את הבחירה הקיימת</summary>{renderPicker(true)}</details></div>}
      <ResponseFields value={draft} onChange={patch} />
    </div>
    <div hidden={tab !== "specific"}>
      <p className="rules-summary">הגדרה ספציפית מקבלת עדיפות. אם היא כבויה או שהמילים אינן מתאימות, לא נשלח מענה כללי לאותו ריל.</p>
      <div className="specific-reel-list">{draft.overrides.map(rule => <button type="button" key={rule.mediaId} className={selected === rule.mediaId ? "is-selected" : ""} onClick={() => { setSelected(rule.mediaId); setPicker(false); }}><span>{reelName(rule.mediaId)}</span><small>{rule.enabled ? "פעיל" : "כבוי"}</small></button>)}</div>
      <button type="button" className="btn btn--sm" disabled={draft.overrides.length >= 200} onClick={() => { setPicker(current => !current); setSelected(null); }}>+ הוסף ריל עם מענה משלו</button>
      {picker && renderPicker(false)}
      {activeRule && <section className="specific-reel-editor">
        <div className="specific-reel-editor__head"><strong>{reelName(selected)}</strong><button type="button" className="rule-action rule-action--delete" onClick={() => { patch({ overrides: draft.overrides.filter(rule => rule.mediaId !== selected) }); setSelected(null); }}>הסר הגדרה</button></div>
        <p className="rules-help">הסרת ההגדרה מחזירה את הריל למענה הכללי, אם הוא פעיל.</p>
        <label className="settings-enable"><span>הפעל מענה לריל הזה</span><input type="checkbox" checked={activeRule.enabled} onChange={event => patchRule({ enabled: event.target.checked })} /></label>
        <ResponseFields value={activeRule} onChange={patchRule} />
      </section>}
      {!draft.overrides.length && !picker && <p className="rules-help">אין עדיין הגדרות ספציפיות. הוסף ריל כדי לתת לו מילים וטקסטים משלו.</p>}
    </div>
    </fieldset>
    {!valid && <p className="rules-help" role="status">בדוק שהנוסחים מלאים ושהוגדר ביטוי כשהתאמה לפי מילים נבחרה. הודעה פרטית מוגבלת ל־1000 בתים.</p>}
    <footer className="settings-dialog__footer"><span className="muted">{dirty ? "יש שינויים שלא נשמרו" : "כל השינויים שמורים"}</span><div><button type="button" className="btn btn--ghost" disabled={saving} onClick={onClose}>ביטול</button><button type="button" className="btn btn--primary" disabled={saving || !valid || !dirty} onClick={save}>{saving ? "שומר…" : "שמור שינויים"}</button></div></footer>
  </div>;
}
export default function CommentAutomation({ settings, failed, onSaved, onError }) {
  const [open, setOpen] = useState(false);
  return <section className="automation-rules settings-launcher"><div><strong>תגובות לרילז</strong><span>{settings?.enabled ? "פעיל" : "כבוי"} · {settings?.overrides?.length ?? 0} הגדרות לרילז ספציפיים</span></div><button type="button" className="btn btn--sm" disabled={!settings} aria-haspopup="dialog" onClick={() => setOpen(true)}>ערוך אוטומציה</button>
    {failed > 0 && <span role="status">{failed} תגובות נכשלו</span>}
    {open && settings && <SettingsDialog title="תגובות לרילז" subtitle="מענה כללי לכל הרילז ומענה מותאם לריל מסוים" onClose={() => setOpen(false)}><Editor settings={settings} onSaved={result => { onSaved(result); setOpen(false); }} onError={onError} onClose={() => setOpen(false)} /></SettingsDialog>}
  </section>;
}
