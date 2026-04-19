'use strict';

const { ipcMain, BrowserWindow, shell, app } = require('electron');
const { exec } = require('child_process');
const autolaunch = require('./autolaunch');

// Liste des canaux IPC exposes au renderer (tous en `handle` + `invoke`).
// Centralisee ici pour rendre l'API visible d'un coup d'oeil. Les events
// push main -> renderer sont documentes plus bas.
const CHANNELS = Object.freeze({
  CONFIG_GET_ALL: 'config:get-all',
  CONFIG_SET_ENABLED: 'config:set-enabled',
  CONFIG_SET_DEFAULT_LAYOUT: 'config:set-default-layout',
  CONFIG_ADD_RULE: 'config:add-rule',
  CONFIG_UPDATE_RULE: 'config:update-rule',
  CONFIG_REMOVE_RULE: 'config:remove-rule',
  SYSTEM_GET_CURRENT_PROCESS: 'system:get-current-process',
  SYSTEM_GET_CURRENT_LAYOUT: 'system:get-current-layout',
  SYSTEM_GET_ACTIVE_PROCESSES: 'system:get-active-processes',
  SYSTEM_SWITCHER_AVAILABLE: 'system:switcher-available',
  APP_OPEN_CONFIG_PATH: 'app:open-config-path',
  APP_GET_VERSION: 'app:get-version',
  APP_TOGGLE_PAUSE: 'app:toggle-pause',
  APP_GET_AUTOLAUNCH: 'app:get-autolaunch',
  APP_SET_AUTOLAUNCH: 'app:set-autolaunch',
});

const EVENTS = Object.freeze({
  PROCESS_CHANGED: 'system:process-changed',
  CONFIG_CHANGED: 'config:changed',
});

const MAX_ACTIVE_PROCESSES = 50;

// --- Utils --------------------------------------------------------------

/**
 * Sanitize une payload de watcher pour le renderer : on garde uniquement
 * des primitives JSON-safe. hwnd est deja un number donc OK, mais on
 * re-project explicitement pour ne pas laisser fuir des champs inconnus
 * si active-win evolue.
 */
function sanitizeProcessPayload(payload) {
  if (!payload) return null;
  return {
    pid: typeof payload.pid === 'number' ? payload.pid : null,
    processName: typeof payload.processName === 'string' ? payload.processName : null,
    processPath: typeof payload.processPath === 'string' ? payload.processPath : null,
    title: typeof payload.title === 'string' ? payload.title : null,
    hwnd: typeof payload.hwnd === 'number' ? payload.hwnd : null,
  };
}

function broadcast(channel, payload) {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (!w || w.isDestroyed()) continue;
    if (!w.webContents || w.webContents.isDestroyed()) continue;
    try {
      w.webContents.send(channel, payload);
    } catch (_err) { /* ignore */ }
  }
}

/**
 * Liste best-effort des processus via `tasklist /FO CSV /NH`. On limite
 * a MAX_ACTIVE_PROCESSES pour eviter de noyer le renderer avec plusieurs
 * centaines de lignes. En cas d'erreur on renvoie un tableau vide plutot
 * que de propager l'echec -- cette fonctionnalite est "nice to have".
 */
function listActiveProcesses() {
  return new Promise((resolve) => {
    exec('tasklist /FO CSV /NH', { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) {
        resolve([]);
        return;
      }
      try {
        const lines = String(stdout).split(/\r?\n/).filter(Boolean);
        const names = new Set();
        for (const line of lines) {
          // Format CSV : "name","pid","session","session#","mem"
          // On fait un parse simple des deux premieres cellules.
          const match = line.match(/^"([^"]+)","(\d+)"/);
          if (!match) continue;
          const name = match[1];
          if (!name) continue;
          names.add(name);
          if (names.size >= MAX_ACTIVE_PROCESSES) break;
        }
        resolve(Array.from(names));
      } catch (_err) {
        resolve([]);
      }
    });
  });
}

// --- Setup -------------------------------------------------------------

function setupIpc(appState) {
  const { config, watcher, switcher } = appState;

  // Liste des `{ channel, handler }` enregistres pour pouvoir les retirer
  // proprement au shutdown.
  const registered = [];

  function handle(channel, fn) {
    ipcMain.handle(channel, fn);
    registered.push(channel);
  }

  // --- config:* ---------------------------------------------------------

  handle(CHANNELS.CONFIG_GET_ALL, () => {
    try {
      return config.getAll();
    } catch (err) {
      return { error: err && err.message ? err.message : String(err) };
    }
  });

  handle(CHANNELS.CONFIG_SET_ENABLED, (_evt, value) => {
    try {
      const next = config.setEnabled(Boolean(value));
      return { ok: true, value: next };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  handle(CHANNELS.CONFIG_SET_DEFAULT_LAYOUT, (_evt, hkl) => {
    try {
      const value = config.setDefaultLayout(hkl);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  handle(CHANNELS.CONFIG_ADD_RULE, (_evt, payload) => {
    try {
      const rule = config.addRule(payload || {});
      return { ok: true, rule };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  handle(CHANNELS.CONFIG_UPDATE_RULE, (_evt, id, patch) => {
    try {
      const rule = config.updateRule(id, patch || {});
      if (!rule) return { ok: false, error: 'rule-not-found' };
      return { ok: true, rule };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  handle(CHANNELS.CONFIG_REMOVE_RULE, (_evt, id) => {
    try {
      const removed = config.removeRule(id);
      return { ok: true, removed };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // --- system:* ---------------------------------------------------------

  handle(CHANNELS.SYSTEM_GET_CURRENT_PROCESS, () => {
    try {
      return sanitizeProcessPayload(watcher.getCurrent());
    } catch (_err) {
      return null;
    }
  });

  handle(CHANNELS.SYSTEM_GET_CURRENT_LAYOUT, () => {
    try {
      if (!switcher.available) return null;
      return switcher.getCurrentLayout();
    } catch (_err) {
      return null;
    }
  });

  handle(CHANNELS.SYSTEM_GET_ACTIVE_PROCESSES, async () => {
    try {
      return await listActiveProcesses();
    } catch (_err) {
      return [];
    }
  });

  handle(CHANNELS.SYSTEM_SWITCHER_AVAILABLE, () => ({
    available: Boolean(switcher.available),
    reason: switcher.unavailableReason || null,
  }));

  // --- app:* ------------------------------------------------------------

  handle(CHANNELS.APP_OPEN_CONFIG_PATH, async () => {
    try {
      const storePath = config.getStorePath();
      const result = await shell.openPath(storePath);
      return result || '';
    } catch (err) {
      return err && err.message ? err.message : String(err);
    }
  });

  handle(CHANNELS.APP_GET_VERSION, () => app.getVersion());

  handle(CHANNELS.APP_TOGGLE_PAUSE, () => {
    try {
      appState.togglePause();
      return { enabled: config.isEnabled() };
    } catch (err) {
      return { enabled: config.isEnabled(), error: err && err.message };
    }
  });

  handle(CHANNELS.APP_GET_AUTOLAUNCH, async () => {
    try {
      const enabled = await autolaunch.isEnabled();
      return { enabled: Boolean(enabled) };
    } catch (err) {
      return { enabled: false, error: err && err.message ? err.message : String(err) };
    }
  });

  handle(CHANNELS.APP_SET_AUTOLAUNCH, async (_evt, value) => {
    try {
      return await autolaunch.setEnabled(Boolean(value));
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });

  // --- Push events main -> renderer -------------------------------------

  const onWatcherChange = (payload) => {
    broadcast(EVENTS.PROCESS_CHANGED, sanitizeProcessPayload(payload));
  };
  watcher.on('change', onWatcherChange);

  const unsubscribeConfig = config.onChange((newValue) => {
    broadcast(EVENTS.CONFIG_CHANGED, newValue);
  });

  // --- Cleanup ----------------------------------------------------------

  function cleanup() {
    for (const channel of registered) {
      try {
        ipcMain.removeHandler(channel);
      } catch (_err) { /* ignore */ }
    }
    registered.length = 0;

    try {
      watcher.off('change', onWatcherChange);
    } catch (_err) { /* ignore */ }

    try {
      if (typeof unsubscribeConfig === 'function') unsubscribeConfig();
    } catch (_err) { /* ignore */ }
  }

  return cleanup;
}

module.exports = { setupIpc, CHANNELS, EVENTS };
