'use strict';

const path = require('path');
const fs = require('fs');
const { Tray, Menu, nativeImage, app, shell, dialog } = require('electron');
const autolaunch = require('./autolaunch');

// Chemins vers les icones tray. Les assets ne sont pas garantis d'exister
// a ce stade du projet (les icones sont livrees par un autre agent). On
// degrade gracieusement si absentes.
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const ICON_ACTIVE_PATH = path.join(ASSETS_DIR, 'tray-icon.png');
const ICON_PAUSED_PATH = path.join(ASSETS_DIR, 'tray-icon-paused.png');

const REBUILD_THROTTLE_MS = 500;

function loadIcon(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) return img;
    }
  } catch (_err) { /* ignore */ }
  return fallback;
}

function setupTray(appState) {
  const { config, watcher } = appState;

  // Pre-chargement des icones. Si tray-icon.png manque -> nativeImage vide
  // (le tray sera quand meme fonctionnel, juste sans visuel).
  const emptyIcon = nativeImage.createEmpty();
  const activeExists = fs.existsSync(ICON_ACTIVE_PATH);
  const pausedExists = fs.existsSync(ICON_PAUSED_PATH);

  if (!activeExists) {
    console.warn(`[tray] icon not found at ${ICON_ACTIVE_PATH} — using empty icon`);
  }

  const iconActive = loadIcon(ICON_ACTIVE_PATH, emptyIcon);
  // Fallback sur l'icone active si la variante "paused" n'existe pas.
  const iconPaused = pausedExists ? loadIcon(ICON_PAUSED_PATH, iconActive) : iconActive;

  const tray = new Tray(iconActive);

  // --- Throttle du rebuild --------------------------------------------
  let rebuildTimer = null;
  let rebuildPending = false;

  // Etat autolaunch mis en cache pour l'affichage du menu. On le
  // rafraichit en arriere-plan (async) avant chaque rebuild : la case
  // reflete donc l'etat reel au prochain ouverture du menu, avec au pire
  // un decalage d'un cycle si l'utilisateur clique tres vite.
  let autolaunchEnabled = false;
  let autolaunchRefreshInFlight = false;

  function refreshAutolaunch() {
    if (autolaunchRefreshInFlight) return;
    autolaunchRefreshInFlight = true;
    autolaunch.isEnabled()
      .then((val) => {
        const next = Boolean(val);
        if (next !== autolaunchEnabled) {
          autolaunchEnabled = next;
          scheduleRebuild();
        }
      })
      .catch(() => { /* tolere silencieusement */ })
      .finally(() => { autolaunchRefreshInFlight = false; });
  }

  function scheduleRebuild() {
    if (rebuildTimer) {
      rebuildPending = true;
      return;
    }
    doRebuild();
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      if (rebuildPending) {
        rebuildPending = false;
        scheduleRebuild();
      }
    }, REBUILD_THROTTLE_MS);
  }

  function doRebuild() {
    if (tray.isDestroyed()) return;

    const enabled = config.isEnabled();
    const current = watcher.getCurrent();
    const processName = (current && current.processName) || 'inactif';
    const currentLayout = appState.switcher && appState.switcher.getCurrentLayout
      ? appState.switcher.getCurrentLayout()
      : null;

    const template = [
      {
        label: 'Actif',
        type: 'checkbox',
        checked: enabled,
        click: () => {
          appState.togglePause();
          scheduleRebuild();
        },
      },
      { type: 'separator' },
      {
        label: `Processus actif : ${processName}`,
        enabled: false,
      },
      {
        label: `Layout courant : ${currentLayout || 'inconnu'}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Ouvrir la configuration...',
        click: () => {
          try {
            appState.openConfigWindow();
          } catch (err) {
            console.warn('[tray] openConfigWindow failed:', err && err.message);
          }
        },
      },
      {
        label: 'Ouvrir le fichier config',
        click: () => {
          const storePath = config.getStorePath();
          shell.openPath(storePath).then((msg) => {
            if (msg) {
              console.warn('[tray] openPath error:', msg);
            }
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Démarrer avec Windows',
        type: 'checkbox',
        checked: autolaunchEnabled,
        click: (item) => {
          // On lit la nouvelle valeur depuis `item.checked` (Electron a
          // deja flippe l'etat avant d'appeler click). On re-synchronise
          // ensuite depuis le vrai etat registry via refreshAutolaunch.
          const desired = Boolean(item.checked);
          autolaunch.setEnabled(desired)
            .then((res) => {
              if (res && res.ok) {
                autolaunchEnabled = Boolean(res.enabled);
              } else {
                console.warn('[tray] autolaunch setEnabled failed:', res && res.error);
              }
              refreshAutolaunch();
              scheduleRebuild();
            })
            .catch((err) => {
              console.warn('[tray] autolaunch setEnabled threw:', err && err.message);
              refreshAutolaunch();
              scheduleRebuild();
            });
        },
      },
      { type: 'separator' },
      {
        label: 'À propos',
        click: () => {
          const version = app.getVersion();
          dialog.showMessageBox({
            type: 'info',
            title: 'À propos',
            message: 'Keyboard Layout Switcher',
            detail: `Version ${version}`,
            buttons: ['OK'],
          }).catch(() => { /* ignore */ });
        },
      },
      {
        label: 'Quitter',
        click: () => {
          app.quit();
        },
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    tray.setContextMenu(menu);

    tray.setToolTip(`Keyboard Switcher — ${processName}`);
    tray.setImage(enabled ? iconActive : iconPaused);
  }

  // Double-clic et clic simple : ouvrent la config (comportement familier
  // sur Windows pour les apps en tray).
  tray.on('double-click', () => {
    try {
      appState.openConfigWindow();
    } catch (err) {
      console.warn('[tray] double-click open failed:', err && err.message);
    }
  });

  // Abonnement aux changements qui impactent le menu.
  const onWatcherChange = () => scheduleRebuild();
  watcher.on('change', onWatcherChange);

  const unsubscribeConfig = config.onChange(() => scheduleRebuild());

  // Premier render + demande async de l'etat autolaunch (un 2nd rebuild
  // aura lieu via scheduleRebuild() si la valeur differe du defaut).
  doRebuild();
  refreshAutolaunch();

  // On enveloppe destroy() pour unsubscribe proprement.
  const origDestroy = tray.destroy.bind(tray);
  tray.destroy = function destroy() {
    try {
      watcher.off('change', onWatcherChange);
    } catch (_err) { /* ignore */ }
    try {
      if (typeof unsubscribeConfig === 'function') unsubscribeConfig();
    } catch (_err) { /* ignore */ }
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = null;
    }
    return origDestroy();
  };

  return tray;
}

module.exports = { setupTray };
