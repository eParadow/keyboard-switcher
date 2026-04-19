'use strict';

/*
 * PoC — Watcher de fenêtre active (étape 1 de la roadmap).
 *
 * Lancement :
 *   node poc/watcher.js
 *
 * Ce qu'on doit voir :
 *   À chaque Alt+Tab (ou changement de fenêtre au foreground), une ligne
 *   de log s'affiche avec un timestamp, le nom du process actif et le
 *   titre de sa fenêtre. Ctrl+C pour arrêter proprement.
 *
 * Prérequis :
 *   `npm install` effectué (en particulier `active-win`).
 */

const { Watcher } = require('../src/main/watcher.js');

const watcher = new Watcher({ intervalMs: 500 });

watcher.on('change', (info) => {
  const ts = new Date().toISOString();
  const name = info.processName || '<unknown>';
  const title = info.title || '';
  console.log(`[${ts}] ${name} — ${title}`);
});

watcher.on('error', (err) => {
  const ts = new Date().toISOString();
  console.error(`[${ts}] watcher error:`, err && err.message ? err.message : err);
});

console.log('Watcher PoC démarré. Alt+Tab pour tester. Ctrl+C pour quitter.');
watcher.start();

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nArrêt du watcher...');
  watcher.stop();
  // Laisse le temps aux logs d'être flushés avant de sortir.
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
