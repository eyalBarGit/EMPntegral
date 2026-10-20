import { createContext, useCallback, useContext, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const DirtyContext = createContext(null);
export function useUnsavedChanges(dirty) {
  const register = useContext(DirtyContext);
  const id = useId();
  useEffect(() => {
    register?.(id, dirty);
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ""; };
    if (dirty) window.addEventListener("beforeunload", beforeUnload);
    return () => { register?.(id, false); window.removeEventListener("beforeunload", beforeUnload); };
  }, [dirty, id, register]);
}

export default function SettingsDialog({ title, subtitle, onClose, children }) {
  const dialog = useRef(null);
  const titleId = useId();
  const drafts = useRef(new Map());
  const register = useCallback((id, dirty) => { drafts.current.set(id, dirty); }, []);
  const requestClose = () => {
    if ([...drafts.current.values()].some(Boolean) && !window.confirm("יש שינויים שלא נשמרו. לסגור ולבטל אותם?")) return;
    onClose();
  };
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.showModal();
    return () => {
      dialog.current?.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<dialog className="settings-dialog" ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); requestClose(); }}>
    <header className="settings-dialog__header">
      <div><h2 id={titleId}>{title}</h2><p>{subtitle}</p></div>
      <button type="button" className="btn btn--ghost" aria-label="סגור הגדרות" onClick={requestClose}>✕</button>
    </header>
    <div className="settings-dialog__body"><DirtyContext.Provider value={register}>{children}</DirtyContext.Provider></div>
  </dialog>, document.body);
}
