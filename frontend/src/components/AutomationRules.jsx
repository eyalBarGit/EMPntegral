import WelcomeEditor from "./WelcomeEditor.jsx";
import { useState } from "react";
import SettingsDialog, { useUnsavedChanges } from "./SettingsDialog.jsx";

function RuleEditor({ rules, templates, onSave, onClose }) {
  const [draft, setDraft] = useState(() => rules.map(rule => ({ ...rule })));
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState("starts_with");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("custom");
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules);
  useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(rules) || Boolean(text.trim()));
  const validText = text.trim() && /[\p{L}\p{N}]/u.test(text);
  const reset = () => { setText(""); setEditing(null); };
  const add = () => {
    if (!validText || (editing === null && draft.length >= 50)) return;
    const rule = { mode, text: text.trim() };
    setDraft(current => editing === null ? [...current, rule] : current.map((item, index) => index === editing ? rule : item));
    reset();
  };
  const edit = index => { setEditing(index); setText(draft[index].text); setMode(draft[index].mode); setTab("custom"); };
  const remove = index => { setDraft(current => current.filter((_, i) => i !== index)); reset(); };
  const save = async () => {
    setSaving(true);
    try { if (await onSave(draft)) onClose(); } finally { setSaving(false); }
  };
  return <div className="rules-editor rules-editor--compact">
    <p className="rules-summary">המענה מתחיל כשמתאים <strong>לפחות ביטוי אחד</strong>. לחץ על ביטוי כדי לערוך אותו.</p>
    <div className="rule-groups">
      {[["starts_with", "ההודעה מתחילה ב־"], ["contains", "ההודעה מכילה"]].map(([type, label]) => <section className="rule-group" key={type}>
        <header><h3>{label}</h3><span>{draft.filter(rule => rule.mode === type).length}</span></header>
        <div className="rule-tags">
          {draft.map((rule, index) => rule.mode !== type ? null : <div className={"rule-tag" + (editing === index ? " is-editing" : "")} key={index}>
            <button type="button" dir="auto" disabled={saving} onClick={() => edit(index)} title="ערוך ביטוי">{rule.text}</button>
            <button type="button" disabled={saving} aria-label={"מחק את הביטוי " + rule.text} onClick={() => remove(index)}>×</button>
          </div>)}
          {!draft.some(rule => rule.mode === type) && <span className="rule-group__empty">לא הוגדרו ביטויים בקבוצה הזו</span>}
        </div>
      </section>)}
    </div>
    <section className="rule-composer">
      <div className="rule-composer__tabs" role="tablist" aria-label="הוספת ביטויים">
        <button type="button" role="tab" aria-selected={tab === "custom"} aria-controls="rule-custom-panel" id="rule-custom-tab" onClick={() => setTab("custom")}>{editing === null ? "ביטוי חדש" : "עריכת ביטוי"}</button>
        <button type="button" role="tab" aria-selected={tab === "templates"} aria-controls="rule-templates-panel" id="rule-templates-tab" onClick={() => setTab("templates")}>שבלונות מוכנות</button>
      </div>
      {tab === "custom" ? <div id="rule-custom-panel" role="tabpanel" aria-labelledby="rule-custom-tab">
        <div className="rule-composer__fields">
          <label>התאמה<select className="input" value={mode} disabled={saving} onChange={event => setMode(event.target.value)}><option value="starts_with">מתחילה ב־</option><option value="contains">מכילה</option></select></label>
          <label>הביטוי<input className="input" dir="auto" maxLength={300} value={text} disabled={saving} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder="למשל: אשמח לקבל פרטים" /></label>
          <button type="button" className="btn btn--primary" disabled={saving || !validText || (editing === null && draft.length >= 50)} onClick={add}>{editing === null ? "הוסף" : "עדכן"}</button>
          {editing !== null && <button type="button" className="rule-action" onClick={reset}>בטל עריכה</button>}
        </div>
        <p className="rules-help">אפשר להוסיף כמה ביטויים. פיסוק ואותיות גדולות אינם משנים את ההתאמה.</p>
      </div> : <div id="rule-templates-panel" role="tabpanel" aria-labelledby="rule-templates-tab" className="rule-template-options">
        {templates.map(value => {
          const selected = draft.some(rule => rule.text === value);
          return <label key={value}><input type="checkbox" checked={selected} disabled={saving || (!selected && draft.length >= 50)} onChange={event => { reset(); setDraft(current => event.target.checked ? [...current, { mode: "starts_with", text: value }] : current.filter(rule => rule.text !== value)); }} /><span dir="auto">{value}</span></label>;
        })}
      </div>}
    </section>
    {draft.length === 0 && <p className="rules-help">בלי ביטויים, לא יתחיל מענה אוטומטי לפניות חדשות.</p>}
    <footer className="settings-dialog__footer"><span className="muted" role="status">{dirty ? "יש שינויים שלא נשמרו" : draft.length + " ביטויים מוגדרים"}</span><div><button type="button" className="btn btn--ghost" disabled={saving} onClick={onClose}>ביטול</button><button type="button" className="btn btn--primary" disabled={saving || !dirty || Boolean(text.trim())} title={text.trim() ? "יש להוסיף או לעדכן את הביטוי לפני השמירה" : undefined} onClick={save}>{saving ? "שומר…" : "שמור שינויים"}</button></div></footer>
  </div>;
}

export default function AutomationRules({ rules, templates, onSave, welcomeText, onWelcomeSaved, onError }) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("text");
  return <section className="automation-rules settings-launcher">
    <div><strong>מענה להודעות</strong><span>{rules?.length ?? 0} כללי פתיחה</span></div>
    <button type="button" className="btn btn--sm" disabled={!rules} aria-haspopup="dialog" onClick={() => setOpen(true)}>ערוך אוטומציה</button>
    {open && rules && <SettingsDialog title="מענה להודעות" subtitle="עריכת התשובה והביטויים שמפעילים אותה" onClose={() => setOpen(false)}><div className="settings-tabs"><button type="button" aria-pressed={activeTab === "text"} onClick={() => setActiveTab("text")}>נוסח התשובה</button><button type="button" aria-pressed={activeTab === "rules"} onClick={() => setActiveTab("rules")}>מתי לענות · {rules.length}</button></div><div hidden={activeTab !== "text"}><WelcomeEditor text={welcomeText} onSaved={onWelcomeSaved} onError={onError} onClose={() => setOpen(false)} /></div><div hidden={activeTab !== "rules"}><RuleEditor rules={rules} templates={templates ?? []} onSave={onSave} onClose={() => setOpen(false)} /></div></SettingsDialog>}
  </section>;
}
