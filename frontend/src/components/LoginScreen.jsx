import { useState } from "react";
import { api } from "../api.js";

export default function LoginScreen({ onAuthenticated }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await api.login(password);
      onAuthenticated();
    } catch (caught) {
      setError(caught.message || "התחברות נכשלה");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <img className="brand-logo brand-logo--login" src="/emp-logo.png" alt="EMP School" />
          <div>
            <h1>EMPntegral</h1>
            <p>אוטומציות והודעות אינסטגרם</p>
          </div>
        </div>

        <label className="field">
          <span className="field__label">סיסמת גישה</span>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
            autoComplete="current-password"
            required
          />
        </label>

        {error ? <p className="login__error">{error}</p> : null}

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "מתחבר..." : "כניסה"}
        </button>
      </form>
    </div>
  );
}
