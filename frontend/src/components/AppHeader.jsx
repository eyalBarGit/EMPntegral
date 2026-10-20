const CHANNELS = [
  ["instagram", "Instagram"],
  ["whatsapp", "WhatsApp"],
  ["telegram", "Telegram"],
];

export default function AppHeader({ meta, refreshing, onRefresh, onLogout, onToggleAutomation, automationBusy, page, onNavigate }) {
  // Read through optional access rather than trusting the response shape: a
  // half-loaded or unexpected /api/meta reply must not take the whole app down.
  const channels = meta?.channels;

  return (
    <header className="topbar">
      <div className="topbar__inner">
      <div className="topbar__brand">
        <img className="brand-logo brand-logo--nav" src="/emp-logo.png" alt="EMP School" />
        <div>
          <strong>EMPntegral</strong>
          <span className="topbar__sub">אוטומציות והודעות אינסטגרם</span>
        </div>
      </div>

      <nav className="primary-nav" aria-label="ניווט ראשי">{[["automations", "אוטומציות"], ["messages", "הודעות"], ["crm", "CRM"]].map(([value, label]) => <button type="button" key={value} aria-current={page === value ? "page" : undefined} onClick={() => onNavigate(value)}>{label}</button>)}</nav>
      <details className="topbar__channels connection-menu"><summary>חיבורים</summary><div className="connection-menu__content">
        {channels
          ? CHANNELS.map(([key, label]) => (
              <span
                key={key}
                className={`dot-chip ${channels[key] ? "is-on" : "is-off"}`}
                title={channels[key] ? `${label}: פרטי חיבור שמורים; זמינות החיבור לא נבדקה` : `${label} לא מוגדר`}
              >
                <i className="dot" />
                {label} · {channels[key] ? "הוגדר" : "לא מוגדר"}
              </span>
            ))
          : null}
        {meta?.failedWebhooks > 0 ? (
          <span className="dot-chip is-warn" role="status">
            {meta.failedWebhooks} אירועים דורשים בדיקה
          </span>
        ) : null}
        {meta?.automationEnabled === false ? (
          <span className="dot-chip is-warn" title="הודעות נשמרות ללא מענה אוטומטי">
            <i className="dot" />
            אוטומציה כבויה
          </span>
        ) : null}
      </div></details>

      <div className="topbar__actions">
        <button type="button" role="switch" aria-checked={meta?.automationEnabled === true}
          className={`btn ${meta?.automationEnabled ? "btn--ok" : "btn--warn"}`}
          disabled={!meta || automationBusy} onClick={onToggleAutomation}
          title="כשהמענה כבוי, הודעות ולידים ממשיכים להישמר. הפעלה חלה על הודעות חדשות בלבד.">
          {automationBusy ? "שומר..." : meta?.automationEnabled ? "מענה אוטומטי פעיל" : "מענה אוטומטי כבוי"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "מרענן..." : "רענון"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onLogout}>
          יציאה
        </button>
      </div>
      </div>
    </header>
  );
}
