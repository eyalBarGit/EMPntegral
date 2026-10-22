import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import "../pwa.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => {
      const check = () => { if (document.visibilityState === 'visible') void registration.update().catch(() => {}); };
      document.addEventListener('visibilitychange', check);
    }).catch(error => console.warn('PWA registration failed', error));
  });
}
