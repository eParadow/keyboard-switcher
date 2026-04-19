import { useEffect, useState, useRef, useCallback } from "react";

// Hook principal qui encapsule toute l'interaction avec window.api.
// Centralise : config, process actif, layout courant, switcher status, version.
export function useKeyboardApi() {
  const api = typeof window !== "undefined" ? window.api : null;
  const apiReady = Boolean(api);

  const [config, setConfig] = useState(null);
  const [currentProcess, setCurrentProcess] = useState(null);
  const [currentLayout, setCurrentLayout] = useState(null);
  const [switcherStatus, setSwitcherStatus] = useState(null);
  const [version, setVersion] = useState("");
  const [activeProcesses, setActiveProcesses] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const mountedRef = useRef(true);

  // Chargement initial + abonnements aux events push du main.
  useEffect(() => {
    mountedRef.current = true;
    if (!api) return;

    let unsubConfig = null;
    let unsubProcess = null;

    (async () => {
      try {
        const [cfg, proc, layout, status, ver] = await Promise.all([
          api.config.getAll(),
          api.system.getCurrentProcess(),
          api.system.getCurrentLayout(),
          api.system.getSwitcherStatus(),
          api.app.getVersion()
        ]);
        if (!mountedRef.current) return;
        setConfig(cfg || null);
        setCurrentProcess(proc || null);
        setCurrentLayout(layout || null);
        setSwitcherStatus(status || null);
        setVersion(ver || "");
      } catch (err) {
        if (mountedRef.current) {
          setLoadError(err?.message || String(err));
        }
      }
    })();

    try {
      unsubConfig = api.config.onChange((newConfig) => {
        if (mountedRef.current) setConfig(newConfig || null);
      });
    } catch (err) {
      // On ignore : l'UI continue a fonctionner via les appels ponctuels.
    }

    try {
      unsubProcess = api.system.onProcessChanged((proc) => {
        if (!mountedRef.current) return;
        setCurrentProcess(proc || null);
        // Rafraichir le layout immediatement quand le process change.
        api.system
          .getCurrentLayout()
          .then((l) => {
            if (mountedRef.current) setCurrentLayout(l || null);
          })
          .catch(() => {});
      });
    } catch (err) {
      // idem
    }

    return () => {
      mountedRef.current = false;
      if (typeof unsubConfig === "function") unsubConfig();
      if (typeof unsubProcess === "function") unsubProcess();
    };
  }, [api]);

  // Poll du layout courant toutes les 2s (l'utilisateur peut switcher manuellement).
  useEffect(() => {
    if (!api) return undefined;
    const interval = setInterval(() => {
      api.system
        .getCurrentLayout()
        .then((l) => {
          if (mountedRef.current) setCurrentLayout(l || null);
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [api]);

  const refreshActiveProcesses = useCallback(async () => {
    if (!api) return [];
    try {
      const list = await api.system.getActiveProcesses();
      const deduped = Array.from(new Set(list || [])).sort((a, b) =>
        a.localeCompare(b)
      );
      if (mountedRef.current) setActiveProcesses(deduped);
      return deduped;
    } catch {
      return [];
    }
  }, [api]);

  return {
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
  };
}
