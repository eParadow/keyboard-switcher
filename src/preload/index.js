'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// --- Canaux IPC --------------------------------------------------------
// Dupliques (et non importes) depuis `src/main/ipc.js` pour garder le
// preload totalement autonome : pas d'import de module main, ce qui
// faciliterait une fuite cote renderer. Toute evolution doit etre
// repercutee dans les deux fichiers.

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

// --- Helpers internes --------------------------------------------------

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

/**
 * Abonne un listener a un canal push main -> renderer. On wrappe pour
 * retirer `event` du 1er argument (sinon le renderer aurait acces a
 * `event.sender`, qui est une fuite de capabilities main).
 * Retourne une fonction d'unsubscribe -- essentielle pour le cleanup
 * des effets React (useEffect).
 */
function subscribe(channel, listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }
  const wrapped = (_event, payload) => {
    try {
      listener(payload);
    } catch (_err) {
      // On isole les erreurs consumer : pas de throw cote IPC.
    }
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

// --- API exposee au renderer -------------------------------------------

/**
 * @typedef {Object} ProcessInfo
 * @property {number|null} pid
 * @property {string|null} processName
 * @property {string|null} processPath
 * @property {string|null} title
 * @property {number|null} hwnd
 */

/**
 * @typedef {Object} Rule
 * @property {string} id
 * @property {string} processName
 * @property {string} layout
 * @property {string} [label]
 */

/**
 * @typedef {Object} Config
 * @property {boolean} enabled
 * @property {string} defaultLayout
 * @property {Rule[]} rules
 */

/**
 * @typedef {Object} OkResult
 * @property {boolean} ok
 * @property {string} [error]
 */

/**
 * @typedef {Object} SwitcherStatus
 * @property {boolean} available
 * @property {string|null} reason
 */

/**
 * @typedef {Object} ConfigApi
 * @property {() => Promise<Config>} getAll
 * @property {(value: boolean) => Promise<OkResult & {value?: boolean}>} setEnabled
 * @property {(hkl: string) => Promise<OkResult & {value?: string}>} setDefaultLayout
 * @property {(payload: {processName: string, layout: string, label?: string}) => Promise<OkResult & {rule?: Rule}>} addRule
 * @property {(id: string, patch: Partial<Rule>) => Promise<OkResult & {rule?: Rule}>} updateRule
 * @property {(id: string) => Promise<OkResult & {removed?: boolean}>} removeRule
 * @property {(listener: (config: Config) => void) => () => void} onChange
 */

/**
 * @typedef {Object} SystemApi
 * @property {() => Promise<ProcessInfo|null>} getCurrentProcess
 * @property {() => Promise<string|null>} getCurrentLayout
 * @property {() => Promise<string[]>} getActiveProcesses
 * @property {() => Promise<SwitcherStatus>} getSwitcherStatus
 * @property {(listener: (info: ProcessInfo|null) => void) => () => void} onProcessChanged
 */

/**
 * @typedef {Object} AppApi
 * @property {() => Promise<string>} openConfigPath
 * @property {() => Promise<string>} getVersion
 * @property {() => Promise<{enabled: boolean, error?: string}>} togglePause
 * @property {() => Promise<{enabled: boolean, error?: string}>} getAutoLaunch
 * @property {(value: boolean) => Promise<{ok: boolean, enabled?: boolean, error?: string}>} setAutoLaunch
 */

/**
 * @typedef {Object} KeyboardAdapterApi
 * @property {ConfigApi} config
 * @property {SystemApi} system
 * @property {AppApi} app
 */

/** @type {KeyboardAdapterApi} */
const api = {
  config: {
    getAll: () => invoke(CHANNELS.CONFIG_GET_ALL),
    setEnabled: (value) => invoke(CHANNELS.CONFIG_SET_ENABLED, Boolean(value)),
    setDefaultLayout: (hkl) => invoke(CHANNELS.CONFIG_SET_DEFAULT_LAYOUT, hkl),
    addRule: (payload) => invoke(CHANNELS.CONFIG_ADD_RULE, payload),
    updateRule: (id, patch) => invoke(CHANNELS.CONFIG_UPDATE_RULE, id, patch),
    removeRule: (id) => invoke(CHANNELS.CONFIG_REMOVE_RULE, id),
    onChange: (listener) => subscribe(EVENTS.CONFIG_CHANGED, listener),
  },
  system: {
    getCurrentProcess: () => invoke(CHANNELS.SYSTEM_GET_CURRENT_PROCESS),
    getCurrentLayout: () => invoke(CHANNELS.SYSTEM_GET_CURRENT_LAYOUT),
    getActiveProcesses: () => invoke(CHANNELS.SYSTEM_GET_ACTIVE_PROCESSES),
    getSwitcherStatus: () => invoke(CHANNELS.SYSTEM_SWITCHER_AVAILABLE),
    onProcessChanged: (listener) => subscribe(EVENTS.PROCESS_CHANGED, listener),
  },
  app: {
    openConfigPath: () => invoke(CHANNELS.APP_OPEN_CONFIG_PATH),
    getVersion: () => invoke(CHANNELS.APP_GET_VERSION),
    togglePause: () => invoke(CHANNELS.APP_TOGGLE_PAUSE),
    getAutoLaunch: () => invoke(CHANNELS.APP_GET_AUTOLAUNCH),
    setAutoLaunch: (value) => invoke(CHANNELS.APP_SET_AUTOLAUNCH, Boolean(value)),
  },
};

// `exposeInMainWorld` echouera si contextIsolation est false ; c'est
// volontaire : on ne supporte que le mode isole (cf. contraintes projet).
contextBridge.exposeInMainWorld('api', api);
