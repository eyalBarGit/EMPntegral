import CommentAutomation from "./components/CommentAutomation.jsx";
import AutomationRules from "./components/AutomationRules.jsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import AppHeader from "./components/AppHeader.jsx";
import LeadDetail from "./components/LeadDetail.jsx";
import LeadList from "./components/LeadList.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import ToastStack from "./components/ToastStack.jsx";
import useToasts from "./hooks/useToasts.js";

const POLL_MS = 15_000;

/** Telegram alerts link to /#lead-12, so the hash drives the selection. */
const readHash = () => {
  const match = /^#(?:crm\/)?lead-(\d+)$/.exec(window.location.hash);
  return match ? Number(match[1]) : null;
};

const readPage = () => window.location.hash.startsWith("#crm") ? "crm" : /^#(messages|lead-)/.test(window.location.hash) ? "messages" : "automations";

export default function App() {
  const [page, setPage] = useState(readPage);
  const [authenticated, setAuthenticated] = useState(null);
  const [meta, setMeta] = useState(null);

  const [leads, setLeads] = useState([]);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [inboxView, setInboxView] = useState("all");
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState(readHash);
  const [detail, setDetail] = useState(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;


  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);

  const { toasts, push, dismiss } = useToasts();

  // Kept in a ref so the polling effect does not restart on every keystroke.
  const filters = useRef({ status, search });
  filters.current = { status, search, page };

  const handleError = useCallback(
    (error) => {
      if (error?.status === 401) {
        setAuthenticated(false);
        return;
      }
      push(error?.message ?? "אירעה שגיאה", "error");
    },
    [push],
  );

  useEffect(() => {
    api
      .session()
      // Strict comparison, so anything other than a real "yes" is treated as
      // logged out instead of letting the app render in a broken half state.
      .then((result) => setAuthenticated(result?.authenticated === true))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    api.meta().then(setMeta).catch(handleError);
  }, [authenticated, handleError]);

  // Debounce typing so a search does not fire a request per character.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadLeads = useCallback(async () => {
    const { status: s, search: q, page: currentPage } = filters.current;
    const result = await api.leads({ status: s, search: q, hasPhone: currentPage === "crm" });
    if (filters.current.page !== currentPage) return;
    setLeads(result.leads);
    setCounts(result.counts);
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (id === null) {
      setDetail(null);
      return;
    }
    const result = await api.lead(id);
    if (selectedRef.current === id) setDetail(result);
  }, []);

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setRefreshing(true);
      try {
        await Promise.all([loadLeads(), loadDetail(selectedId), api.meta().then(setMeta)]);
      } catch (error) {
        if (!silent) handleError(error);
      } finally {
        setRefreshing(false);
        setLoading(false);
      }
    },
    [handleError, loadDetail, loadLeads, selectedId],
  );

  useEffect(() => {
    if (!authenticated) return undefined;

    setLoading(true);
    void refresh({ silent: true });

    const timer = setInterval(() => void refresh({ silent: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [authenticated, page, status, search, selectedId, refresh]);

  useEffect(() => {
    const onHashChange = () => { setSelectedId(readHash()); setPage(readPage()); };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const select = useCallback((id) => {
    selectedRef.current = id;
    setSelectedId(id);
    window.location.hash = id === null ? page : page === "crm" ? `crm/lead-${id}` : `lead-${id}`;
  }, [page]);

  useEffect(() => { setStatus(""); setInboxView("all"); }, [page]);

  const navigate = target => {
    setPage(target); setSelectedId(null); selectedRef.current = null;
    setStatus(""); setInboxView("all"); setSearchInput("");
    window.location.hash = target;
  };

  const patchLead = useCallback(
    async (patch) => {
      if (selectedId === null) return;
      setBusy(true);
      try {
        await api.patchLead(selectedId, patch);
        await Promise.all([loadLeads(), loadDetail(selectedId)]);
        push("נשמר");
        return true;
      } catch (error) {
        handleError(error);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [handleError, loadDetail, loadLeads, push, selectedId],
  );

  const addNote = useCallback(
    async (body) => {
      if (selectedId === null) return;
      setBusy(true);
      try {
        const result = await api.addNote(selectedId, body);
        setDetail((current) => (current?.lead.id === selectedId ? { ...current, messages: result.messages } : current));
        return true;
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    },
    [handleError, selectedId],
  );

  useEffect(() => {
    if (page === "automations" || !detail || detail.lead.id !== selectedId || !detail.lead.has_unread || !detail.lead.last_inbound_at) return;
    const { id, last_inbound_at } = detail.lead;
    void api.markRead(id, last_inbound_at).then(() => {
      setLeads(current => current.map(lead => lead.id === id && lead.last_inbound_at === last_inbound_at ? { ...lead, has_unread: false } : lead));
    }).catch(handleError);
  }, [selectedId, detail?.lead.id]);

  const toggleAutomation = async () => {
    if (!meta || automationBusy) return;
    setAutomationBusy(true);
    try {
      const result = await api.setAutomation(!meta.automationEnabled);
      setMeta((current) => ({ ...current, ...result }));
      push(result.automationEnabled ? "המענה האוטומטי הופעל להודעות חדשות" : "המענה האוטומטי כבוי; הודעות ממשיכות להישמר");
    } catch (error) { handleError(error); }
    finally { setAutomationBusy(false); }
  };

  const saveTriggerRules = async (rules) => {
    try {
      const result = await api.setTriggerRules(rules);
      setMeta(current => ({ ...current, ...result }));
      push("כללי המענה נשמרו");
      return true;
    } catch (error) { handleError(error); return false; }
  };

  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setAuthenticated(false);
    setDetail(null);
    setLeads([]);
  }, []);

  if (authenticated === null) {
    return <div className="boot">טוען...</div>;
  }

  if (!authenticated) {
    return (
      <>
        <LoginScreen onAuthenticated={() => setAuthenticated(true)} />
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </>
    );
  }

  return (
    <div className={`shell ${page !== "automations" && selectedId ? "has-detail" : ""}`}>
      <AppHeader
        meta={meta}
        onToggleAutomation={toggleAutomation}
        page={page}
        onNavigate={navigate}
        automationBusy={automationBusy}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onLogout={() => void logout()}
      />

      {page === "automations" && <main className="automation-home">
        <header className="automation-home__heading"><div><h1>אוטומציות אינסטגרם</h1><p>בחר מתי לענות ומה לשלוח.</p></div><span className="automation-state">{meta?.automationEnabled ? "המענה הכללי פעיל" : "המענה הכללי כבוי"}</span></header>
        <div className="automation-home__grid">
          <article className="automation-card"><span className="automation-card__category">הודעות פרטיות</span><h2>מענה לפנייה נכנסת</h2><p>שולח תשובה כשהודעה חדשה מתאימה לביטויים שבחרת.</p><div className="automation-card__preview"><small>נוסח הפתיחה</small><p dir="auto">{meta?.welcomeText || "טוען…"}</p></div>
      <AutomationRules rules={meta?.triggerRules} templates={meta?.triggerTemplates} onSave={saveTriggerRules} welcomeText={meta?.welcomeText} onError={handleError} onWelcomeSaved={result => { setMeta(current => ({ ...current, ...result })); push("הודעת הפתיחה נשמרה"); }} />
          </article>
          <article className="automation-card"><span className="automation-card__category">תגובות לרילז</span><h2>מתגובה לשיחה בפרטי</h2><p>תגובה ציבורית ולאחריה הודעה פרטית, לפי הרילז והמילים שבחרת.</p><div className="automation-card__preview"><small>{meta?.commentSettings?.generalEnabled === false ? "מענה כללי כבוי" : meta?.commentSettings?.scope === "selected" ? "מענה כללי לרילז שנבחרו" : "מענה כללי לכל הרילז"} · {meta?.commentSettings?.overrides?.length ?? 0} הגדרות ספציפיות</small><p dir="auto">{meta?.commentSettings?.privateText || "טוען…"}</p></div>
      <CommentAutomation settings={meta?.commentSettings} failed={meta?.failedCommentRuns} onError={handleError} onSaved={result => { setMeta(current => ({ ...current, ...result })); push("הגדרות התגובות נשמרו"); }} />
          </article>
        </div>
        <div className="automation-home__foot"><p>צפייה במה שהתקבל ובתשובות שנשלחו</p><button type="button" className="btn" onClick={() => navigate("messages")}>פתח הודעות</button></div>
      </main>}
      {page !== "automations" && <main className="workspace">

        <LeadList
          crm={page === "crm"}
          leads={page === "crm" ? leads.filter(lead => lead.phone?.trim()) : leads}
          counts={counts}
          statuses={meta?.statuses ?? []}
          activeStatus={status}
          onStatusChange={setStatus}
          search={searchInput}
          onSearchChange={setSearchInput}
          selectedId={selectedId}
          onSelect={select}
          loading={loading}
          inboxView={inboxView}
          onInboxViewChange={setInboxView}
        />

        {detail && detail.lead.id === selectedId && (page !== "crm" || detail.lead.phone?.trim()) ? (
          <LeadDetail
            key={page + ":" + detail.lead.id}
            crm={page === "crm"}
            detail={detail}
            statuses={meta?.statuses ?? []}
            timezone={meta?.timezone ?? "Asia/Jerusalem"}
            onPatch={patchLead}
            onAddNote={addNote}
            onClose={() => select(null)}
            busy={busy}
          />
        ) : (
          <section className="panel panel--placeholder">
            <p>{selectedId && page === "crm" && detail && !detail.lead.phone?.trim() ? "פנייה ללא מספר טלפון מופיעה בעמוד ההודעות בלבד" : selectedId ? "טוען שיחה…" : "בחר פנייה כדי לקרוא את השיחה ולטפל בה"}</p>
          </section>
        )}
      </main>}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
