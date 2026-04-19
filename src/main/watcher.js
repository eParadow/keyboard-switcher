'use strict';

const { EventEmitter } = require('events');

// `active-win` v8 est un module ESM-only ; on l'importe dynamiquement pour
// rester compatible avec le `package.json` en `"type": "commonjs"`.
// On cache la promesse pour ne charger le module qu'une seule fois.
let activeWinPromise = null;
function loadActiveWin() {
  if (!activeWinPromise) {
    activeWinPromise = import('active-win').then((mod) => mod.default || mod);
  }
  return activeWinPromise;
}

const DEFAULT_INTERVAL_MS = 500;

/**
 * Watcher — polle la fenêtre active via `active-win` et émet un évènement
 * `'change'` quand le process actif change.
 *
 * Évènements :
 *   - 'change' : payload { pid, processName, processPath, title, hwnd }
 *   - 'error'  : payload = Error d'origine (le polling continue quand même)
 */
class Watcher extends EventEmitter {
  constructor({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    super();
    this._intervalMs = intervalMs;
    this._timer = null;
    this._running = false;
    // Flag positionné par stop() ; toute résolution async en cours
    // l'ignorera pour éviter d'émettre un event après l'arrêt.
    this._stopped = false;
    // Protège contre les appels `active-win` qui se chevauchent si un tick
    // dépasse la durée de `intervalMs` (UAC prompt, lock screen, etc.).
    this._inFlight = false;
    this._current = null;
  }

  /**
   * Démarre le polling. Émet immédiatement un premier `change` pour la
   * fenêtre courante (pas d'attente du premier tick de 500 ms).
   * Double-start : no-op.
   */
  start() {
    if (this._running) return;
    this._running = true;
    this._stopped = false;

    // Premier tick immédiat — on n'attend pas `intervalMs`.
    this._tick();

    this._timer = setInterval(() => this._tick(), this._intervalMs);
  }

  /**
   * Arrête proprement le polling. Ignore ensuite toute résolution
   * async encore en vol. Double-stop : no-op.
   */
  stop() {
    if (!this._running) return;
    this._running = false;
    this._stopped = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Retourne la dernière info connue de fenêtre active (ou null si rien
   * n'a encore été détecté).
   */
  getCurrent() {
    return this._current;
  }

  async _tick() {
    // Si un appel précédent est toujours en cours, on skippe ce tick
    // pour éviter des résolutions parallèles désordonnées.
    if (this._inFlight) return;
    this._inFlight = true;

    try {
      const activeWin = await loadActiveWin();
      const info = await activeWin();

      // Si on a été stoppés pendant l'attente, on ignore ce résultat.
      if (this._stopped) return;

      // `active-win` peut renvoyer undefined/null (aucune fenêtre active,
      // écran verrouillé, bureau sécurisé...). On ne considère pas cela
      // comme un changement — on garde la dernière info connue.
      if (!info || !info.owner) return;

      const payload = {
        pid: info.owner.processId,
        processName: info.owner.name,
        processPath: info.owner.path,
        title: info.title,
        hwnd: info.id,
      };

      if (this._hasChanged(payload)) {
        this._current = payload;
        this.emit('change', payload);
      }
    } catch (err) {
      if (this._stopped) return;
      // `active-win` peut échouer sporadiquement — on émet l'erreur et on
      // laisse le polling continuer pour les prochains ticks.
      this.emit('error', err);
    } finally {
      this._inFlight = false;
    }
  }

  /**
   * Détermine si le process actif a changé. On compare par `processPath`
   * (plus robuste : deux process peuvent avoir le même nom), avec fallback
   * sur `processName` si le path n'est pas disponible.
   */
  _hasChanged(next) {
    const prev = this._current;
    if (!prev) return true;

    if (next.processPath && prev.processPath) {
      return next.processPath !== prev.processPath;
    }
    return next.processName !== prev.processName;
  }
}

module.exports = { Watcher };
