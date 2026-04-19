'use strict';

const AutoLaunch = require('auto-launch');

// Wrapper fin autour d'`auto-launch`. Fournit une API promise-based
// tolerante aux erreurs : toutes les erreurs natives (registry inaccessible,
// chemin binaire absent, etc.) sont captees et renvoyees en resultat
// structure plutot que de casser le main process.
//
// Attention : `auto-launch` n'est reellement fiable qu'une fois l'app
// packagee. En dev, il ecrira une entree de registre qui pointe vers
// `node_modules/.bin/electron` (ou vers le .exe de dev) -- fonctionnel
// mais moche. On ne l'utilise donc realistiquement qu'en prod.

let autoLauncher = null;

function getAutoLauncher() {
  if (!autoLauncher) {
    autoLauncher = new AutoLaunch({
      name: 'Keyboard Switcher',
      // `isHidden` demande a l'app de demarrer en background (sans fenetre
      // principale visible). On est en systray-only de toute facon, donc
      // l'option est coherente avec le design.
      isHidden: true,
    });
  }
  return autoLauncher;
}

async function isEnabled() {
  try {
    return await getAutoLauncher().isEnabled();
  } catch (_err) {
    return false;
  }
}

async function setEnabled(enabled) {
  try {
    const launcher = getAutoLauncher();
    const current = await launcher.isEnabled();
    if (enabled && !current) {
      await launcher.enable();
    } else if (!enabled && current) {
      await launcher.disable();
    }
    return { ok: true, enabled };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { isEnabled, setEnabled };
