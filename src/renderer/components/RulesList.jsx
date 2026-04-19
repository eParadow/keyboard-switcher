import React, { useState } from "react";
import { labelForHkl } from "../layouts.js";

// Affiche la liste des regles avec toggle enabled + suppression.
export default function RulesList({ api, rules }) {
  const [pending, setPending] = useState({}); // { [id]: true }
  const [error, setError] = useState(null);

  function setPendingFor(id, value) {
    setPending((prev) => ({ ...prev, [id]: value }));
  }

  async function handleToggleRule(rule) {
    if (!api || pending[rule.id]) return;
    setPendingFor(rule.id, true);
    setError(null);
    try {
      const res = await api.config.updateRule(rule.id, {
        enabled: !rule.enabled
      });
      if (res && res.ok === false) {
        setError(res.error || "Echec de la mise a jour de la règle");
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setPendingFor(rule.id, false);
    }
  }

  async function handleRemoveRule(rule) {
    if (!api || pending[rule.id]) return;
    setPendingFor(rule.id, true);
    setError(null);
    try {
      const res = await api.config.removeRule(rule.id);
      if (res && res.ok === false) {
        setError(res.error || "Echec de la suppression");
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setPendingFor(rule.id, false);
    }
  }

  const list = Array.isArray(rules) ? rules : [];

  return (
    <section className="panel">
      <h2 className="section-title">Règles (mapping process → layout)</h2>
      {list.length === 0 ? (
        <div className="empty">Aucune règle définie.</div>
      ) : (
        <ul className="rules-list">
          {list.map((rule) => {
            const busy = Boolean(pending[rule.id]);
            return (
              <li key={rule.id} className="rule-row">
                <label className="rule-check">
                  <input
                    type="checkbox"
                    checked={Boolean(rule.enabled)}
                    onChange={() => handleToggleRule(rule)}
                    disabled={busy}
                  />
                </label>
                <div className="rule-main">
                  <div className="rule-line">
                    <span className="rule-process">{rule.processName}</span>
                    <span className="rule-arrow">→</span>
                    <span className="rule-layout">
                      {labelForHkl(rule.layout)}
                    </span>
                  </div>
                  {rule.label ? (
                    <div className="rule-label">"{rule.label}"</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn-icon btn-danger"
                  onClick={() => handleRemoveRule(rule)}
                  disabled={busy}
                  title="Supprimer"
                  aria-label="Supprimer la règle"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error ? <div className="inline-error">{error}</div> : null}
    </section>
  );
}
