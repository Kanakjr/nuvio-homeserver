import { Eye, EyeOff, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { officialBackend, normalizeBackend, signIn, signInAsGuest, signInAsCloudflareUser } from "../lib/account";
import type { Session } from "../types";

export function AuthScreen({ onSession }: { onSession(session: Session): void }) {
  const official = useMemo(officialBackend, []);
  const [selfHosted, setSelfHosted] = useState(!official);
  const [backendUrl, setBackendUrl] = useState("");
  const [key, setKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const backend = selfHosted ? normalizeBackend(backendUrl, key) : official;
      if (!backend) throw new Error("This build has no official backend. Use a self-hosted backend.");
      const session = await signIn(backend, email, password);
      if (!session) setMessage("Confirm your email address, then sign in."); else onSession(session);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sign in failed"); }
    finally { setBusy(false); }
  }

  async function handleCloudflareLogin() {
    setBusy(true);
    try {
      const session = await signInAsCloudflareUser();
      onSession(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cloudflare sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGuest() {
    setBusy(true);
    try {
      const guestSession = await signInAsGuest();
      onSession(guestSession);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Guest sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <img className="auth-logo" src={`${import.meta.env.BASE_URL}nuvio-wordmark.png`} alt="Nuvio" />
        <h1>Your Nuvio, anywhere.</h1>
        <p>Browse Stremio catalogs and play high-definition streams with hardware decoding.</p>

        <button
          type="button"
          className="primary wide"
          style={{
            margin: "0.5rem 0 0.75rem 0",
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            fontWeight: 600,
            fontSize: "1rem",
            padding: "0.85rem",
            borderRadius: "10px",
            boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
            border: "none",
            cursor: "pointer",
          }}
          onClick={handleCloudflareLogin}
          disabled={busy}
        >
          <ShieldCheck size={20} /> Cloudflare Zero Trust Login
        </button>

        <button
          type="button"
          className="primary wide"
          style={{
            margin: "0 0 1.25rem 0",
            background: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
            color: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            fontWeight: 600,
            fontSize: "1rem",
            padding: "0.85rem",
            borderRadius: "10px",
            boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)",
            border: "none",
            cursor: "pointer",
          }}
          onClick={handleGuest}
          disabled={busy}
        >
          <Sparkles size={18} /> Instant Watch (Guest Mode)
        </button>

        <div style={{ display: "flex", alignItems: "center", margin: "0.5rem 0 1.25rem 0", color: "rgba(255, 255, 255, 0.35)", fontSize: "0.85rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
          <span style={{ padding: "0 0.75rem" }}>or sign in</span>
          <div style={{ flex: 1, height: "1px", background: "rgba(255, 255, 255, 0.1)" }} />
        </div>

        <form onSubmit={submit}>
          <label className="check-row">
            <span>
              <strong>Self-hosted backend</strong>
              <small>Use your own Nuvio server and publishable key.</small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={selfHosted}
                onChange={(event) => setSelfHosted(event.target.checked)}
              />
              <i />
            </span>
          </label>
          {selfHosted && (
            <div className="host-fields">
              <label>Backend URL<input type="url" value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} placeholder="https://nuvio.example.com" required /></label>
              <label>Publishable key<input type="password" value={key} onChange={(event) => setKey(event.target.value)} required /></label>
            </div>
          )}
          <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label>
            Password
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
          <button className="secondary wide" disabled={busy}>
            {busy ? "Connecting…" : "Sign in to account"}
          </button>
        </form>
        {message && <div className="notice error">{message}</div>}
        <a className="text-button" href={(import.meta.env.VITE_AUTH_SIGNUP_URL as string) || "/account/signup"} target="_blank" rel="noreferrer">
          New to Nuvio? Create an account on your HomeServer
        </a>
      </section>
    </main>
  );
}
