import { useEffect, useState } from "react";
export default function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const [help, setHelp] = useState(false);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  useEffect(() => {
    const capture = event => { event.preventDefault(); setPrompt(event); };
    const done = () => { setInstalled(true); setPrompt(null); setHelp(false); };
    const media = window.matchMedia('(display-mode: standalone)');
    const changed = () => setInstalled(media.matches || navigator.standalone === true);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    media.addEventListener('change', changed);
    return () => { window.removeEventListener('beforeinstallprompt', capture); window.removeEventListener('appinstalled', done); media.removeEventListener('change', changed); };
  }, []);
  if (installed) return null;
  const install = async () => {
    if (!prompt) { setHelp(value => !value); return; }
    try { await prompt.prompt(); await prompt.userChoice; } finally { setPrompt(null); }
  };
  return <div className="install-app"><button type="button" className="btn btn--ghost" onClick={install} aria-expanded={help}>התקן אפליקציה</button>{help && <div className="install-app__help" role="status"><strong>התקנה בטלפון</strong><p>{ios ? 'פתח ב־Safari, לחץ על שיתוף ובחר ״הוסף למסך הבית״. אם מוצגת האפשרות ״פתח כיישום אינטרנט״, הפעל אותה.' : 'בתפריט הדפדפן בחר ״התקן אפליקציה״ או ״הוסף למסך הבית״. מומלץ להשתמש ב־Chrome או Edge.'}</p><button type="button" className="btn btn--sm" onClick={() => setHelp(false)}>סגור</button></div>}</div>;
}
