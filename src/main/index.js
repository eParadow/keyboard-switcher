'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

const { Watcher } = require('./watcher');
const switcher = require('./switcher');
const { createConfig } = require('./config');
const { setupTray } = require('./tray');
const { setupIpc } = require('./ipc');

// --- Single-instance lock ----------------------------------------------
// On prend le verrou avant toute autre initialisation : si une instance
// tourne deja, on quitte immediatement sans rien toucher (pas de watcher,
// pas de tray, pas de store corrompu par deux processus concurrents).

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  // Une autre instance detient deja le verrou : on quitte immediatement
  // sans initialiser quoi que ce soit. L'instance primaire recevra
  // l'evenement 'second-instance' et fera remonter la fenetre config.
  app.quit();
}

// --- Etat module-local --------------------------------------------------

let config = null;
let watcher = null;
let tray = null;
let ipcCleanup = null;
let configWindow = null;
let unsubscribeConfigListener = null;

// Dernier HKL que _nous_ avons applique automatiquement. Utilise pour
// detecter un switch manuel utilisateur : si le layout courant differe
// de lastAutoAppliedLayout alors qu'on est toujours sur le meme process,
// c'est que l'utilisateur a change via Win+Espace -> on respecte son choix
// jusqu'au prochain changement de process.
let lastAutoAppliedLayout = null;
let lastProcessPath = null;

// Flag pour n'afficher qu'une seule fois le warning "switcher indisponible".
let switcherUnavailableWarned = false;

// --- Config window ------------------------------------------------------

function openConfigWindow() {
  if (configWindow && !configWindow.isDestroyed()) {
    if (configWindow.isMinimized()) configWindow.restore();
    configWindow.show();
    configWindow.focus();
    return configWindow;
  }

  const isDev = process.env.NODE_ENV === 'development';

  configWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'assets', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  configWindow.once('ready-to-show', () => {
    if (configWindow && !configWindow.isDestroyed()) {
      configWindow.show();
    }
  });

  configWindow.on('closed', () => {
    configWindow = null;
  });

  if (isDev) {
    configWindow.loadURL('http://localhost:5173').catch((err) => {
      console.warn('[main] failed to load dev URL:', err && err.message);
    });
  } else {
    const indexPath = path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html');
    configWindow.loadFile(indexPath).catch((err) => {
      console.warn('[main] failed to load renderer file:', err && err.message);
    });
  }

  return configWindow;
}

// --- Watcher -> Switcher wiring ----------------------------------------

function handleProcessChange(payload) {
  if (!config) return;

  if (!config.isEnabled()) return;

  if (!switcher.available) {
    if (!switcherUnavailableWarned) {
      console.warn(
        `[main] switcher unavailable (${switcher.unavailableReason}) — auto-switch disabled`
      );
      switcherUnavailableWarned = true;
    }
    return;
  }

  const { processName, processPath } = payload;

  // Reset de la memoire "choix utilisateur" des qu'on change de process.
  const processChanged = processPath !== lastProcessPath;
  if (processChanged) {
    lastAutoAppliedLayout = null;
    lastProcessPath = processPath;
  }

  const rule = config.findRuleForProcess(processName);
  const targetLayout = rule && rule.layout
    ? String(rule.layout).toUpperCase()
    : String(config.getDefaultLayout()).toUpperCase();

  console.log(
    `[main] process change: "${processName}" -> target=${targetLayout} ` +
    `(rule=${rule ? 'custom' : 'default'}, processChanged=${processChanged})`
  );

  // Respect du choix manuel : si on a deja applique un layout sur ce
  // process et que l'utilisateur l'a change entre-temps, on skippe.
  if (lastAutoAppliedLayout !== null) {
    const current = switcher.getCurrentLayout();
    if (current && current.toUpperCase() !== lastAutoAppliedLayout) {
      // L'utilisateur a manuellement switche : on respecte son choix.
      console.log(
        `[main] skipping switch: user manually changed layout ` +
        `(electronKlid=${current}, lastAuto=${lastAutoAppliedLayout})`
      );
      return;
    }
  }

  const result = switcher.switchLayout(targetLayout);
  if (result && result.ok) {
    lastAutoAppliedLayout = targetLayout;
    if (result.skipped) {
      console.log(`[main] switch skipped (already ${targetLayout}) for ${processName}`);
    } else if (result.viaBroadcast) {
      console.log(`[main] switched to ${targetLayout} for ${processName} (via broadcast)`);
    } else {
      console.log(`[main] switched to ${targetLayout} for ${processName}`);
    }
  } else {
    console.warn(
      `[main] switch failed for ${processName} -> ${targetLayout}:`,
      result && result.error
    );
  }
}

function handleWatcherError(err) {
  console.warn('[main] watcher error:', err && err.message ? err.message : err);
}

// --- App state partage avec tray + ipc ---------------------------------

function buildAppState() {
  return {
    config,
    watcher,
    switcher,
    openConfigWindow,
    getCurrentProcess: () => (watcher ? watcher.getCurrent() : null),
    getLastAutoAppliedLayout: () => lastAutoAppliedLayout,
    togglePause: () => {
      const next = !config.isEnabled();
      config.setEnabled(next);
      return next;
    },
  };
}

// --- Lifecycle ---------------------------------------------------------

if (hasLock) {

app.on('second-instance', () => {
  // Une deuxieme instance a ete lancee : on amene la fenetre config au
  // premier plan si elle existe, sinon on l'ouvre.
  openConfigWindow();
});

app.whenReady().then(() => {
  try {
    config = createConfig();
  } catch (err) {
    console.error('[main] failed to init config:', err);
    app.quit();
    return;
  }

  watcher = new Watcher({ intervalMs: 500 });
  watcher.on('change', handleProcessChange);
  watcher.on('error', handleWatcherError);

  const appState = buildAppState();

  try {
    tray = setupTray(appState);
  } catch (err) {
    console.warn('[main] tray setup failed:', err && err.message);
    tray = null;
  }

  ipcCleanup = setupIpc(appState);

  // Le push IPC vers le renderer et le rebuild du tray sont chacun
  // abonnes de leur cote via `config.onChange`. Pas besoin d'un listener
  // supplementaire ici.
  unsubscribeConfigListener = null;

  watcher.start();

  if (!app.isPackaged) {
    console.log('[main] dev mode');
    console.log('[main] store path:', config.getStorePath());
    console.log('[main] switcher.available:', switcher.available);
    if (!switcher.available) {
      console.log('[main] switcher.unavailableReason:', switcher.unavailableReason);
    }
    console.log('[main] current layout:', switcher.getCurrentLayout && switcher.getCurrentLayout());
    // Confort dev : l'app est headless par defaut (tray only). En dev on
    // ouvre la fenetre config directement pour voir l'UI sans devoir
    // trouver l'icone tray placeholder.
    openConfigWindow();
  }
});

app.on('window-all-closed', () => {
  // Sur Windows on reste en systray -- on ne quitte PAS quand la fenetre
  // config est fermee. L'utilisateur quitte via le menu tray.
  // (noop intentionnel)
});

app.on('before-quit', () => {
  try {
    if (watcher) {
      watcher.stop();
      watcher.removeAllListeners();
    }
  } catch (_err) { /* ignore */ }

  try {
    if (typeof unsubscribeConfigListener === 'function') {
      unsubscribeConfigListener();
    }
  } catch (_err) { /* ignore */ }

  try {
    if (typeof ipcCleanup === 'function') {
      ipcCleanup();
    }
  } catch (_err) { /* ignore */ }

  try {
    if (tray && typeof tray.destroy === 'function' && !tray.isDestroyed()) {
      tray.destroy();
    }
  } catch (_err) { /* ignore */ }
});

} // fin if (hasLock)

// --- Global error handlers ---------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.warn('[main] unhandledRejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.warn('[main] uncaughtException:', err && err.stack ? err.stack : err);
});
