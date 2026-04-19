'use strict';

/*
 * Switcher — bindings koffi vers `user32.dll` pour changer la disposition
 * clavier de la fenêtre active.
 *
 * Séquence standard :
 *   1. LoadKeyboardLayoutW(KLID, KLF_ACTIVATE) → HKL
 *   2. GetForegroundWindow() → HWND
 *   3. PostMessageW(HWND, WM_INPUTLANGCHANGEREQUEST, 0, HKL)
 *
 * Pourquoi PostMessage plutôt que SendMessage ?
 *   - SendMessage bloque tant que la fenêtre cible n'a pas traité le
 *     message. Si l'app est gelée (cas réel : jeux en chargement), on
 *     bloque Electron pour plusieurs secondes.
 *   - Le message WM_INPUTLANGCHANGEREQUEST est "fire and forget" côté
 *     UX : on veut juste demander au système de basculer, pas attendre
 *     une réponse. PostMessage est donc le bon outil.
 *
 * Pourquoi les noms en "W" (UTF-16) ?
 *   - Windows a deux ABIs pour la plupart des APIs texte : `*A` (ANSI,
 *     dépend de la codepage système, à éviter) et `*W` (UTF-16, stable).
 *     On prend systématiquement la version W et on laisse koffi gérer
 *     la conversion string JS ↔ wchar_t*.
 */

const koffi = (() => {
  try {
    return require('koffi');
  } catch (err) {
    // koffi absent (CI non-Windows, install cassée, etc.). On loggera
    // au moment du require du fichier pour signaler que le switcher
    // est en mode stub.
    return null;
  }
})();

// === Constantes Win32 ===
const KLF_ACTIVATE = 0x00000001;
const WM_INPUTLANGCHANGEREQUEST = 0x0050;
const HWND_BROADCAST = 0xffff;
// KL_NAMELENGTH = 9 (8 chars hex + null terminator). On alloue donc
// 9 wchar_t = 18 octets pour GetKeyboardLayoutNameW.
const KL_NAMELENGTH = 9;

const CONSTANTS = Object.freeze({
  KLF_ACTIVATE,
  WM_INPUTLANGCHANGEREQUEST,
  HWND_BROADCAST,
});

// Regex pour valider un KLID : exactement 8 caractères hexadécimaux.
const KLID_REGEX = /^[0-9a-fA-F]{8}$/;

/**
 * Construit un stub "no-op" utilisé quand user32.dll n'a pas pu être
 * chargé (environnement non-Windows, koffi absent, etc.). Toutes les
 * méthodes retournent des valeurs qui permettent à l'appelant de
 * continuer sans crash.
 */
function buildStub(reason) {
  const error = reason || 'win32-unavailable';
  const fail = () => ({ ok: false, error });
  return {
    loadLayout: () => null,
    getForegroundWindow: () => null,
    setLayoutForWindow: () => false,
    getCurrentLayout: () => null,
    switchLayout: fail,
    activateKeyboardLayout: () => null,
    constants: CONSTANTS,
    available: false,
    unavailableReason: error,
  };
}

/**
 * Tente de charger `user32.dll` et de résoudre les symboles Win32 dont
 * on a besoin. Renvoie un objet { ok, user32?, fns?, error? }.
 *
 * Choix des types koffi pour HKL et HWND :
 *   - HKL et HWND sont des handles opaques. Sur Windows 64-bit ils
 *     occupent 64 bits en mémoire, mais seuls les 32 bits bas sont
 *     significatifs pour un HKL (la partie haute est un "device handle"
 *     souvent nul).
 *   - On les déclare comme `void *` côté koffi. koffi renvoie alors un
 *     pointeur JavaScript opaque (un objet/BigInt selon version) que
 *     l'on peut repasser tel quel à d'autres APIs. C'est la forme la
 *     plus sûre car on n'a pas à se soucier de la taille du pointeur.
 *   - Pour les UINT/WPARAM/LPARAM/DWORD/BOOL, on utilise les types
 *     primitifs koffi (`uint32`, `int32`, `uintptr_t`).
 *   - WPARAM/LPARAM sont de taille pointeur : on prend `uintptr_t` /
 *     `intptr_t` pour ne pas tronquer sur 64-bit. Le HKL passé en
 *     LPARAM est donc accepté tel quel (koffi convertit un `void*`
 *     en entier pointeur automatiquement quand on le passe là où un
 *     `intptr_t` est attendu).
 */
function loadWin32() {
  if (!koffi) {
    return { ok: false, error: 'koffi-unavailable' };
  }
  if (process.platform !== 'win32') {
    return { ok: false, error: 'not-windows' };
  }

  let user32;
  try {
    user32 = koffi.load('user32.dll');
  } catch (err) {
    return {
      ok: false,
      error: `user32-load-failed: ${err && err.message ? err.message : err}`,
    };
  }

  try {
    // HKL LoadKeyboardLayoutW(LPCWSTR pwszKLID, UINT Flags)
    // pwszKLID : string UTF-16 → koffi convertit depuis une string JS
    // via le type `str16` (ou `wchar_t *` + string JS, selon version).
    // On utilise `str16` qui est l'alias clair de koffi pour LPCWSTR.
    const LoadKeyboardLayoutW = user32.func(
      'LoadKeyboardLayoutW',
      'void *',
      ['str16', 'uint32']
    );

    // HWND GetForegroundWindow(void)
    const GetForegroundWindow = user32.func(
      'GetForegroundWindow',
      'void *',
      []
    );

    // BOOL PostMessageW(HWND hWnd, UINT Msg, WPARAM wParam, LPARAM lParam)
    // WPARAM = UINT_PTR, LPARAM = LONG_PTR : taille pointeur.
    const PostMessageW = user32.func(
      'PostMessageW',
      'int32',
      ['void *', 'uint32', 'uintptr_t', 'intptr_t']
    );

    // BOOL GetKeyboardLayoutNameW(LPWSTR pwszKLID)
    // pwszKLID doit pointer sur un buffer d'au moins KL_NAMELENGTH
    // (9) wchar_t alloué par l'appelant. On utilise `_Out_` pour que
    // koffi convertisse le buffer en string JS au retour.
    const GetKeyboardLayoutNameW = user32.func(
      'GetKeyboardLayoutNameW',
      'int32',
      [koffi.out(koffi.pointer('uint16'))]
    );

    // HKL ActivateKeyboardLayout(HKL hkl, UINT Flags)
    // Exposé en fallback pour certains jeux en plein écran exclusif
    // qui ignorent WM_INPUTLANGCHANGEREQUEST. Non utilisé par défaut
    // dans switchLayout (cf. spec).
    const ActivateKeyboardLayout = user32.func(
      'ActivateKeyboardLayout',
      'void *',
      ['void *', 'uint32']
    );

    return {
      ok: true,
      user32,
      fns: {
        LoadKeyboardLayoutW,
        GetForegroundWindow,
        PostMessageW,
        GetKeyboardLayoutNameW,
        ActivateKeyboardLayout,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `user32-symbol-failed: ${err && err.message ? err.message : err}`,
    };
  }
}

const loaded = loadWin32();

if (!loaded.ok) {
  // Un seul warning au require, pas à chaque appel. L'appelant voit
  // aussi l'état via `module.available`.
  // eslint-disable-next-line no-console
  console.warn(`[switcher] win32 unavailable — running as stub (${loaded.error})`);
  module.exports = buildStub(loaded.error);
} else {
  const {
    LoadKeyboardLayoutW,
    GetForegroundWindow,
    PostMessageW,
    GetKeyboardLayoutNameW,
    ActivateKeyboardLayout,
  } = loaded.fns;

  /**
   * Teste si un handle retourné par Win32 est "nul". Selon la version
   * de koffi et le type déclaré, un HKL/HWND peut arriver en JS sous
   * forme de :
   *   - `null` (le cas le plus propre),
   *   - un pointeur "koffi" opaque dont `koffi.address(ptr) === 0n`,
   *   - un BigInt `0n` directement,
   *   - un Number `0`.
   * On couvre tous les cas de manière défensive.
   */
  function isNullHandle(handle) {
    if (handle === null || handle === undefined) return true;
    if (typeof handle === 'number') return handle === 0;
    if (typeof handle === 'bigint') return handle === 0n;
    // Pointeur koffi : on essaie koffi.address, sinon on considère
    // que l'objet est non-null (il existe, donc il pointe quelque part).
    try {
      if (typeof koffi.address === 'function') {
        return koffi.address(handle) === 0n;
      }
    } catch (_err) {
      // Ignoré : handle n'est pas un pointeur koffi, on le garde.
    }
    return false;
  }

  /**
   * (hklString: string) => HKL handle | null
   *
   * Charge un layout clavier en mémoire et le rend disponible comme
   * "candidat" au switch. Ne bascule rien tout seul ; il faut ensuite
   * PostMessage pour appliquer à la fenêtre active.
   *
   * Validation stricte du format : KLID = 8 chars hex. Une valeur
   * mal formée renverrait un ERROR_INVALID_PARAMETER côté Win32 de
   * toute façon.
   */
  function loadLayout(hklString) {
    if (typeof hklString !== 'string' || !KLID_REGEX.test(hklString)) {
      return null;
    }
    try {
      const hkl = LoadKeyboardLayoutW(hklString, KLF_ACTIVATE);
      return isNullHandle(hkl) ? null : hkl;
    } catch (_err) {
      return null;
    }
  }

  /**
   * () => HWND | null — fenêtre au premier plan (celle qui reçoit les
   * frappes clavier). Peut renvoyer null si l'utilisateur est sur le
   * bureau sécurisé (Ctrl+Alt+Suppr, UAC, écran verrouillé).
   */
  function getForegroundWindow() {
    try {
      const hwnd = GetForegroundWindow();
      return isNullHandle(hwnd) ? null : hwnd;
    } catch (_err) {
      return null;
    }
  }

  /**
   * (hwnd, hkl) => boolean
   *
   * Poste WM_INPUTLANGCHANGEREQUEST à la fenêtre avec le HKL en LPARAM.
   * PostMessageW renvoie non-zéro en cas de succès (le message est dans
   * la queue, pas forcément traité) et zéro en cas d'échec (ex: HWND
   * invalide, thread sans message queue).
   */
  function setLayoutForWindow(hwnd, hkl) {
    if (isNullHandle(hwnd) || isNullHandle(hkl)) return false;
    try {
      const ret = PostMessageW(hwnd, WM_INPUTLANGCHANGEREQUEST, 0, hkl);
      return ret !== 0;
    } catch (_err) {
      return false;
    }
  }

  /**
   * () => string (KLID uppercase) | null
   *
   * Récupère le KLID du layout actif dans le thread courant via
   * GetKeyboardLayoutNameW. On privilégie cette API plutôt que
   * GetKeyboardLayout(0) car elle retourne directement une string
   * hex 8 chars (ex "0000080C"), exactement le format que l'on
   * manipule partout ailleurs dans le code.
   *
   * Note : "thread courant" = le thread Node/Electron principal.
   * Pour comparer avec le HKL de la fenêtre active, cette API suffit
   * en pratique car l'input language est synchronisé entre les
   * threads ayant le focus.
   */
  function getCurrentLayout() {
    try {
      // koffi alloue un array de KL_NAMELENGTH uint16, Win32 le remplit,
      // et koffi.decode nous rend une string JS.
      const buffer = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      const ret = GetKeyboardLayoutNameW(buffer);
      if (ret === 0) return null;
      // buffer contient maintenant les code units UTF-16 du KLID,
      // terminé par 0. On les reconstruit manuellement pour ne pas
      // dépendre d'un type de retour spécifique de koffi.
      let s = '';
      for (let i = 0; i < KL_NAMELENGTH; i += 1) {
        const c = buffer[i];
        if (!c) break;
        s += String.fromCharCode(c);
      }
      if (!KLID_REGEX.test(s)) return null;
      return s.toUpperCase();
    } catch (_err) {
      return null;
    }
  }

  /**
   * (hklString) => { ok, hkl?, skipped?, error? }
   *
   * Orchestration de haut niveau. Optimisation : on skippe le round-trip
   * Win32 si le layout courant est déjà celui demandé. Cette comparaison
   * est insensible à la casse (les KLID reviennent tantôt en majuscules
   * depuis Win32, tantôt en minuscules depuis la config utilisateur).
   */
  function switchLayout(hklString) {
    if (typeof hklString !== 'string' || !KLID_REGEX.test(hklString)) {
      return { ok: false, error: 'invalid-klid' };
    }

    const target = hklString.toUpperCase();

    const current = getCurrentLayout();
    if (current && current === target) {
      return { ok: true, skipped: true };
    }

    const hkl = loadLayout(hklString);
    if (!hkl) {
      return { ok: false, error: 'load-layout-failed' };
    }

    const hwnd = getForegroundWindow();
    if (!hwnd) {
      // Pas de fenêtre active (écran verrouillé, secure desktop...).
      // On ne broadcast PAS par défaut pour ne pas polluer toutes les
      // apps : il faut un hwnd valide pour un switch ciblé.
      return { ok: false, error: 'no-foreground-window' };
    }

    const posted = setLayoutForWindow(hwnd, hkl);
    if (!posted) {
      return { ok: false, error: 'post-message-failed' };
    }

    return { ok: true, hkl };
  }

  /**
   * (hkl, flags = KLF_ACTIVATE) => HKL | null
   *
   * Fallback exposé pour les cas où PostMessage est ignoré (jeux en
   * plein écran exclusif, principalement). Modifie le layout du thread
   * appelant — pas du thread de la fenêtre cible — ce qui peut ne pas
   * suffire selon le jeu. À utiliser en dernier recours.
   */
  function activateKeyboardLayout(hkl, flags = KLF_ACTIVATE) {
    if (isNullHandle(hkl)) return null;
    try {
      const prev = ActivateKeyboardLayout(hkl, flags);
      return isNullHandle(prev) ? null : prev;
    } catch (_err) {
      return null;
    }
  }

  module.exports = {
    loadLayout,
    getForegroundWindow,
    setLayoutForWindow,
    getCurrentLayout,
    switchLayout,
    activateKeyboardLayout,
    constants: CONSTANTS,
    available: true,
  };
}
