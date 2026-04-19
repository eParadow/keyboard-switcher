import React, { useState } from "react";
import { useKeyboardApi } from "./hooks/useKeyboardApi.js";
import StatusPanel from "./components/StatusPanel.jsx";
import DefaultLayoutSection from "./components/DefaultLayoutSection.jsx";
import RulesList from "./components/RulesList.jsx";
import AddRuleForm from "./components/AddRuleForm.jsx";

export default function App() {
  const {
    api,
    apiReady,
    config,
    currentProcess,
    currentLayout,
    switcherStatus,
    version,
    activeProcesses,
    refreshActiveProcesses,
    loadError
  } = useKeyboardApi();

  const [openConfigError, setOpenConfigError] = useState(null);

  // Cas degrade : lancement hors Electron (dev pur navigateur).
  if (!apiReady) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Keyboard Switcher</h1>
        </header>
        <div className="banner banner-danger">
          Preload non chargé — window.api est indisponible. Lance l'application
          via Electron (npm run dev).
        </div>
      </div>
    );
  }

  async function handleOpenConfig() {
    setOpenConfigError(null);
    try {
      await api.app.openConfigPath();
    } catch (err) {
      setOpenConfigError(err?.message || String(err));
    }
  }

  const switcherUnavailable =
    switcherStatus && switcherStatus.available === false;

  // Etat de chargement : on attend la config initiale.
  if (!config) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Keyboard Switcher</h1>
          {version ? <span className="app-version">v{version}</span> : null}
        </header>
        {loadError ? (
          <div className="banner banner-danger">
            Erreur de chargement : {loadError}
          </div>
        ) : (
          <div className="loading">Chargement...</div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Keyboard Switcher</h1>
        {version ? <span className="app-version">v{version}</span> : null}
      </header>

      {switcherUnavailable ? (
        <div className="banner banner-danger">
          Les appels Win32 ne sont pas disponibles
          {switcherStatus.reason ? ` : ${switcherStatus.reason}` : ""}. Les
          changements de layout ne seront pas appliqués.
        </div>
      ) : null}

      <StatusPanel
        api={api}
        enabled={Boolean(config.enabled)}
        currentProcess={currentProcess}
        currentLayout={currentLayout}
        switcherStatus={switcherStatus}
      />

      <DefaultLayoutSection
        api={api}
        defaultLayout={config.defaultLayout}
      />

      <RulesList api={api} rules={config.rules || []} />

      <AddRuleForm
        api={api}
        currentProcess={currentProcess}
        activeProcesses={activeProcesses}
        refreshActiveProcesses={refreshActiveProcesses}
        defaultLayout={config.defaultLayout}
      />

      <section className="panel panel-flat">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleOpenConfig}
        >
          Ouvrir le fichier config
        </button>
        {openConfigError ? (
          <div className="inline-error">{openConfigError}</div>
        ) : null}
      </section>
    </div>
  );
}
