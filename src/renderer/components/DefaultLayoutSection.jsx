import React, { useState } from "react";
import { LAYOUTS, normalizeHkl } from "../layouts.js";

// Dropdown pour le layout par defaut (utilise quand aucune regle ne matche).
export default function DefaultLayoutSection({ api, defaultLayout }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const normalized = normalizeHkl(defaultLayout) || "";

  async function handleChange(e) {
    const value = e.target.value;
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.config.setDefaultLayout(value);
      if (res && res.ok === false) {
        setError(res.error || "Echec de la mise a jour");
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  // Si le defaultLayout courant n'est pas dans la liste hardcodee, on l'ajoute en option pour ne pas le perdre.
  const knownHkls = LAYOUTS.map((l) => l.hkl);
  const extraOption =
    normalized && !knownHkls.includes(normalized)
      ? { hkl: normalized, label: `${normalized} (inconnu)` }
      : null;

  return (
    <section className="panel">
      <h2 className="section-title">Layout par défaut</h2>
      <div className="field-row">
        <select
          className="input"
          value={normalized}
          onChange={handleChange}
          disabled={busy}
        >
          {!normalized ? <option value="">— choisir —</option> : null}
          {extraOption ? (
            <option value={extraOption.hkl}>{extraOption.label}</option>
          ) : null}
          {LAYOUTS.map((l) => (
            <option key={l.hkl} value={l.hkl}>
              {l.label} ({l.hkl})
            </option>
          ))}
        </select>
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
    </section>
  );
}
