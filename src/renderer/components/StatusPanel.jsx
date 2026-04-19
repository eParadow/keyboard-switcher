import React, { useEffect, useState } from "react";
import { labelForHkl } from "../layouts.js";

// Affiche l'etat global : enabled, process actif, layout courant, switcher Win32.
export default function StatusPanel({
  api,
  enabled,
  currentProcess,
  currentLayout,
  switcherStatus
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // --- Autolaunch ------------------------------------------------------
  // Etat charge async au mount. On tolere les erreurs silencieusement :
  // en dev ou sur une install hors-standard, auto-launch peut echouer,
  // l'UI se degrade alors en case desactivee.
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [autoLaunchBusy, setAutoLaunchBusy] = useState(false);
  const [autoLaunchError, setAutoLaunchError] = useState(null);

  useEffect(() => {
    if (!api || !api.app || typeof api.app.getAutoLaunch !== "function") return;
    let cancelled = false;
    api.app
      .getAutoLaunch()
      .then((res) => {
        if (cancelled) return;
        setAutoLaunch(Boolean(res && res.enabled));
        if (res && res.error) setAutoLaunchError(res.error);
      })
      .catch((err) => {
        if (cancelled) return;
        setAutoLaunchError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function handleToggle() {
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.config.setEnabled(!enabled);
      if (res && res.ok === false) {
        setError(res.error || "Echec du toggle");
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoLaunchToggle(e) {
    if (!api || !api.app || typeof api.app.setAutoLaunch !== "function") return;
    const desired = Boolean(e.target.checked);
    setAutoLaunchBusy(true);
    setAutoLaunchError(null);
    // Optimiste : on met a jour l'UI tout de suite, on revert si echec.
    setAutoLaunch(desired);
    try {
      const res = await api.app.setAutoLaunch(desired);
      if (res && res.ok === false) {
        setAutoLaunchError(res.error || "Echec de la modification");
        setAutoLaunch(!desired);
      } else if (res && typeof res.enabled === "boolean") {
        setAutoLaunch(res.enabled);
      }
    } catch (err) {
      setAutoLaunchError(err?.message || String(err));
      setAutoLaunch(!desired);
    } finally {
      setAutoLaunchBusy(false);
    }
  }

  const dotClass = enabled ? "status-dot status-dot-on" : "status-dot status-dot-off";
  const statusLabel = enabled ? "Actif" : "En pause";
  const buttonLabel = enabled ? "Pause" : "Activer";

  const processLine = currentProcess
    ? `${currentProcess.processName || "?"}${
        currentProcess.title ? " — " + currentProcess.title : ""
      }`
    : "— aucune fenêtre active —";

  const layoutLine = currentLayout
    ? `${currentLayout} (${labelForHkl(currentLayout)})`
    : "— inconnu —";

  const switcherAvailable = switcherStatus && switcherStatus.available;
  const switcherLine = switcherStatus
    ? switcherAvailable
      ? "disponible"
      : `indisponible${switcherStatus.reason ? " : " + switcherStatus.reason : ""}`
    : "chargement...";

  return (
    <section className="panel">
      <div className="status-row">
        <span className={dotClass} aria-hidden="true" />
        <span className="status-text">
          Statut : <strong>{statusLabel}</strong>
        </span>
        <button
          type="button"
          className="btn"
          onClick={handleToggle}
          disabled={busy}
        >
          {buttonLabel}
        </button>
      </div>
      <div className="status-line">
        <span className="label">Processus actif :</span>{" "}
        <span className="value">{processLine}</span>
      </div>
      <div className="status-line">
        <span className="label">Layout courant :</span>{" "}
        <span className="value">{layoutLine}</span>
      </div>
      <div className="status-line">
        <span className="label">Switcher Win32 :</span>{" "}
        <span className={switcherAvailable ? "value success" : "value danger"}>
          {switcherLine}
        </span>
      </div>
      <div className="status-line">
        <label className="autolaunch-label">
          <input
            type="checkbox"
            checked={autoLaunch}
            onChange={handleAutoLaunchToggle}
            disabled={autoLaunchBusy}
          />
          {" "}Démarrer avec Windows
        </label>
        {autoLaunchError ? (
          <span className="inline-error">{autoLaunchError}</span>
        ) : null}
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
    </section>
  );
}
