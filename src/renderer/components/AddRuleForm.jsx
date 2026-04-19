import React, { useState } from "react";
import { LAYOUTS } from "../layouts.js";

// Formulaire d'ajout d'une regle. Pre-remplissage possible depuis le process actif.
export default function AddRuleForm({
  api,
  currentProcess,
  activeProcesses,
  refreshActiveProcesses,
  defaultLayout
}) {
  const [processName, setProcessName] = useState("");
  const [layout, setLayout] = useState(defaultLayout || LAYOUTS[0].hkl);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showDatalist, setShowDatalist] = useState(false);

  const canSubmit = processName.trim().length > 0 && layout && !busy;

  function handleFillFromActive() {
    if (currentProcess && currentProcess.processName) {
      setProcessName(currentProcess.processName);
      if (currentProcess.title && !label) {
        setLabel(currentProcess.title);
      }
    }
  }

  async function handleShowActiveList() {
    await refreshActiveProcesses();
    setShowDatalist(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!api || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.config.addRule({
        processName: processName.trim(),
        layout,
        label: label.trim() || undefined
      });
      if (res && res.ok === false) {
        setError(res.error || "Echec de l'ajout");
      } else {
        setProcessName("");
        setLabel("");
        setShowDatalist(false);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2 className="section-title">Ajouter une règle</h2>
      <form onSubmit={handleSubmit} className="add-rule-form">
        <div className="field-row">
          <label className="field-label" htmlFor="add-process">
            Processus
          </label>
          <input
            id="add-process"
            type="text"
            className="input"
            value={processName}
            onChange={(e) => setProcessName(e.target.value)}
            onFocus={handleShowActiveList}
            placeholder="exemple.exe"
            list={showDatalist ? "active-processes-list" : undefined}
            autoComplete="off"
            disabled={busy}
          />
          {showDatalist ? (
            <datalist id="active-processes-list">
              {activeProcesses.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          ) : null}
        </div>
        <div className="field-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleFillFromActive}
            disabled={busy || !currentProcess}
          >
            + depuis processus actif
            {currentProcess && currentProcess.processName
              ? ` (${currentProcess.processName})`
              : ""}
          </button>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="add-layout">
            Layout
          </label>
          <select
            id="add-layout"
            className="input"
            value={layout}
            onChange={(e) => setLayout(e.target.value)}
            disabled={busy}
          >
            {LAYOUTS.map((l) => (
              <option key={l.hkl} value={l.hkl}>
                {l.label} ({l.hkl})
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="add-label">
            Label
          </label>
          <input
            id="add-label"
            type="text"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optionnel"
            disabled={busy}
          />
        </div>
        <div className="field-row">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit}
          >
            Ajouter
          </button>
        </div>
        {error ? <div className="inline-error">{error}</div> : null}
      </form>
    </section>
  );
}
