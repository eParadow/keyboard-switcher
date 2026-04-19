'use strict';

// Wrapper autour d'electron-store qui expose une API typee de haut niveau
// pour la gestion de la configuration du Keyboard Layout Switcher.
//
// Note : electron-store v8 (CommonJS). La v9+ est ESM-only et incompatible
// avec un require() direct dans le main process.

const Store = require('electron-store');
const crypto = require('crypto');

// Defaults appliques a l'init (et a toute config existante a laquelle
// manquerait une cle -- electron-store merge automatiquement les defaults).
const DEFAULTS = Object.freeze({
  enabled: true,
  // AZERTY BE par defaut (utilisateur belge).
  defaultLayout: '0000080C',
  rules: []
});

// Schema JSON Schema utilise par electron-store pour valider la config.
// electron-store throw si la config stockee ne respecte pas ce schema.
const SCHEMA = {
  enabled: { type: 'boolean' },
  defaultLayout: {
    type: 'string',
    pattern: '^[0-9a-fA-F]{8}$'
  },
  rules: {
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'processName', 'layout', 'enabled'],
      properties: {
        id: { type: 'string' },
        processName: { type: 'string', minLength: 1 },
        layout: { type: 'string', pattern: '^[0-9a-fA-F]{8}$' },
        enabled: { type: 'boolean' },
        label: { type: ['string', 'null'] }
      }
    }
  }
};

// --- Validation ---------------------------------------------------------

const HKL_REGEX = /^[0-9a-fA-F]{8}$/;

function validateHkl(value) {
  if (typeof value !== 'string' || !HKL_REGEX.test(value)) {
    throw new TypeError(
      `Invalid HKL: expected 8-char hex string, got ${JSON.stringify(value)}`
    );
  }
  return value.toUpperCase();
}

function validateRuleInput({ processName, layout }) {
  if (typeof processName !== 'string' || processName.trim().length === 0) {
    throw new TypeError('Invalid rule: processName must be a non-empty string');
  }
  validateHkl(layout);
}

// Deep clone simple suffisant pour la structure de config (pas de Date,
// pas de fonctions, pas de cycles). Evite de rendre la reference interne.
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- Factory ------------------------------------------------------------

function createConfig({ cwd } = {}) {
  // On ne passe `cwd` que s'il est explicitement fourni : en contexte
  // Electron, electron-store utilisera app.getPath('userData') par defaut.
  const storeOptions = {
    name: 'config',
    defaults: clone(DEFAULTS),
    schema: SCHEMA,
    clearInvalidConfig: false
  };
  if (cwd) {
    storeOptions.cwd = cwd;
  }

  const store = new Store(storeOptions);

  // --- Helpers internes -------------------------------------------------

  function readRules() {
    // electron-store renvoie deja une copie pour les tableaux d'objets,
    // mais on clone explicitement pour etre certain qu'aucune mutation
    // externe ne corrompe le store.
    return clone(store.get('rules', []));
  }

  function writeRules(rules) {
    store.set('rules', rules);
  }

  // --- API publique -----------------------------------------------------

  function getAll() {
    return clone(store.store);
  }

  function isEnabled() {
    return Boolean(store.get('enabled'));
  }

  function setEnabled(value) {
    const next = Boolean(value);
    store.set('enabled', next);
    return next;
  }

  function getDefaultLayout() {
    return store.get('defaultLayout');
  }

  function setDefaultLayout(hkl) {
    const normalized = validateHkl(hkl);
    store.set('defaultLayout', normalized);
    return normalized;
  }

  function getRules() {
    return readRules();
  }

  function findRuleForProcess(processName) {
    if (typeof processName !== 'string' || processName.length === 0) {
      return null;
    }
    const needle = processName.toLowerCase();
    const rules = readRules();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      // processName est deja stocke en lowercase, mais on re-normalise
      // cote requete (belt + suspenders) au cas ou une config externe
      // aurait ete editee a la main.
      if (String(rule.processName).toLowerCase() === needle) {
        return rule;
      }
    }
    return null;
  }

  function addRule({ processName, layout, label } = {}) {
    validateRuleInput({ processName, layout });
    const rule = {
      id: crypto.randomUUID(),
      processName: processName.toLowerCase(),
      layout: layout.toUpperCase(),
      enabled: true,
      label: typeof label === 'string' && label.length > 0 ? label : undefined
    };
    const rules = readRules();
    rules.push(rule);
    writeRules(rules);
    return clone(rule);
  }

  function updateRule(id, patch = {}) {
    if (typeof id !== 'string' || id.length === 0) return null;
    const rules = readRules();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return null;

    const current = rules[idx];
    const next = { ...current };

    if (Object.prototype.hasOwnProperty.call(patch, 'processName')) {
      if (
        typeof patch.processName !== 'string' ||
        patch.processName.trim().length === 0
      ) {
        throw new TypeError('Invalid patch: processName must be a non-empty string');
      }
      next.processName = patch.processName.toLowerCase();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'layout')) {
      next.layout = validateHkl(patch.layout);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) {
      next.enabled = Boolean(patch.enabled);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'label')) {
      // label peut etre explicitement mis a undefined / null / '' pour retirer
      if (
        patch.label === null ||
        patch.label === undefined ||
        patch.label === ''
      ) {
        next.label = undefined;
      } else if (typeof patch.label === 'string') {
        next.label = patch.label;
      } else {
        throw new TypeError('Invalid patch: label must be a string or null');
      }
    }
    // L'id reste immutable
    next.id = current.id;

    rules[idx] = next;
    writeRules(rules);
    return clone(next);
  }

  function removeRule(id) {
    if (typeof id !== 'string' || id.length === 0) return false;
    const rules = readRules();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    rules.splice(idx, 1);
    writeRules(rules);
    return true;
  }

  function onChange(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('onChange: listener must be a function');
    }
    // store.onDidAnyChange retourne deja une fonction d'unsubscribe, on
    // la renvoie telle quelle pour un comportement symetrique.
    const unsubscribe = store.onDidAnyChange((newValue, oldValue) => {
      listener(clone(newValue), clone(oldValue));
    });
    return unsubscribe;
  }

  function getStorePath() {
    return store.path;
  }

  return {
    getAll,
    isEnabled,
    setEnabled,
    getDefaultLayout,
    setDefaultLayout,
    getRules,
    findRuleForProcess,
    addRule,
    updateRule,
    removeRule,
    onChange,
    getStorePath
  };
}

module.exports = { createConfig };

// --- Bloc de test inline ------------------------------------------------
// Executable via `node src/main/config.js` pour un smoke test rapide
// sans avoir besoin de lancer Electron.

if (require.main === module) {
  const path = require('path');
  const fs = require('fs');

  const testDir = path.resolve(__dirname, '..', '..', 'poc', '.config-test');
  fs.mkdirSync(testDir, { recursive: true });
  // Reset propre entre deux runs pour eviter les effets de bord
  const existing = path.join(testDir, 'config.json');
  if (fs.existsSync(existing)) fs.unlinkSync(existing);

  const config = createConfig({ cwd: testDir });
  console.log('Store path:', config.getStorePath());
  console.log('Initial state:', config.getAll());

  const rule1 = config.addRule({
    processName: 'Arknights-Endfields.exe',
    layout: '00000409',
    label: 'Arknights Endfields'
  });
  const rule2 = config.addRule({
    processName: 'notepad.exe',
    layout: '0000080c'
  });
  console.log('Rule 1 added:', rule1);
  console.log('Rule 2 added:', rule2);

  console.log('getAll() after adds:', config.getAll());

  const match = config.findRuleForProcess('ARKNIGHTS-ENDFIELDS.exe');
  console.log('findRuleForProcess("ARKNIGHTS-ENDFIELDS.exe"):', match);

  const noMatch = config.findRuleForProcess('unknown.exe');
  console.log('findRuleForProcess("unknown.exe"):', noMatch);

  const removed = config.removeRule(rule2.id);
  console.log(`removeRule(${rule2.id}):`, removed);

  console.log('Final state:', config.getAll());
}
