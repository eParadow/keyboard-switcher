# Keyboard Layout Switcher

> Application Windows qui change automatiquement la disposition du clavier en fonction de l'application active.

## 🎯 Contexte et objectif

Certains logiciels (notamment les jeux) ne gèrent pas correctement les dispositions de clavier AZERTY et imposent un QWERTY. Switcher manuellement à chaque `Alt+Tab` est fastidieux.

Cette application détecte la fenêtre active et applique automatiquement la disposition de clavier configurée pour celle-ci, de manière transparente.

**Cas d'usage typique :**

- En jeu sur _Arknights: Endfields_ → bascule automatique en **QWERTY US**
- `Alt+Tab` vers Discord, navigateur, IDE → retour automatique en **AZERTY BE**

## ✨ Fonctionnalités

### MVP

- [x] Détection de la fenêtre active
- [x] Changement automatique de la disposition clavier par application
- [x] Configuration persistante (mapping processus → layout)

### Fonctionnalités cibles

- [ ] Interface graphique de configuration
- [ ] Icône dans la zone de notification (systray)
- [ ] Démarrage automatique avec Windows
- [ ] Ajout de règles via liste des processus actifs
- [ ] Pause temporaire du switch auto
- [ ] Indicateur visuel du layout actuel

### Évolutions possibles

- [ ] Profils (gaming / travail / etc.)
- [ ] Règles conditionnelles avancées (par titre de fenêtre, pas juste processus)
- [ ] Raccourcis clavier pour switch manuel
- [ ] Export/import de configuration
- [ ] Historique / statistiques d'utilisation

## 🛠️ Stack technique

| Composant         | Techno               | Rôle                            |
| ----------------- | -------------------- | ------------------------------- |
| Runtime           | **Node.js** (≥ 18)   | Environnement d'exécution       |
| Framework         | **Electron**         | App desktop + UI + systray      |
| Détection fenêtre | **active-win**       | Récupère le process actif       |
| API Win32         | **koffi**            | Bindings natifs vers user32.dll |
| Config            | **electron-store**   | Persistance JSON                |
| Auto-start        | **auto-launch**      | Démarrage avec Windows          |
| Packaging         | **electron-builder** | Génération du .exe installable  |

### Pourquoi ces choix ?

- **Electron** plutôt que WPF/C# : cross-plateforme (utile si évolution Linux/Mac plus tard), UI web moderne, écosystème npm riche.
- **koffi** plutôt que ffi-napi : maintenu activement, compatible avec les versions récentes de Node, API plus simple.
- **active-win** plutôt qu'appel Win32 direct : abstraction fiable, gère les cas particuliers.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│          Process Electron (main)            │
│                                             │
│  ┌──────────────┐      ┌──────────────┐    │
│  │   Watcher    │─────▶│   Switcher   │    │
│  │ (active-win) │      │   (koffi)    │    │
│  └──────┬───────┘      └──────┬───────┘    │
│         │                     │             │
│         ▼                     ▼             │
│  ┌──────────────┐      ┌──────────────┐    │
│  │ Config store │      │     Tray     │    │
│  │   (JSON)     │      │  controller  │    │
│  └──────┬───────┘      └──────┬───────┘    │
│         │                     │             │
│         └──────────┬──────────┘             │
│                    ▼                        │
│  ┌───────────────────────────────────┐     │
│  │    BrowserWindow (UI config)      │     │
│  └───────────────────────────────────┘     │
└─────────────────────────────────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │   Windows OS     │
          │  (user32.dll)    │
          └──────────────────┘
```

### Modules

- **Watcher** — interroge `active-win` à intervalle régulier (500 ms) et émet un événement quand le process actif change.
- **Switcher** — charge `user32.dll` via koffi, expose `setLayout(hwnd, hkl)` qui appelle `LoadKeyboardLayout` + `PostMessage(WM_INPUTLANGCHANGEREQUEST)`.
- **Config store** — wrapper sur `electron-store`, schéma `{ rules: [...], defaultLayout, enabled }`.
- **Tray controller** — icône systray avec menu contextuel (Pause, Config, Quitter).
- **UI** — BrowserWindow avec React (ou HTML vanilla) pour la gestion des règles.

## 📂 Structure du projet

```
keyboard-switcher/
├── package.json
├── electron-builder.yml
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   ├── main/
│   │   ├── index.js              # Entry point Electron
│   │   ├── watcher.js            # Détection fenêtre active
│   │   ├── switcher.js           # Appels Win32 via koffi
│   │   ├── config.js             # Wrapper electron-store
│   │   ├── tray.js               # Systray + menu
│   │   └── ipc.js                # Handlers IPC main ↔ renderer
│   ├── preload/
│   │   └── index.js              # Bridge contextIsolation
│   └── renderer/
│       ├── index.html
│       ├── app.jsx               # UI de config (React)
│       └── styles.css
├── assets/
│   ├── tray-icon.png
│   ├── tray-icon-paused.png
│   └── app-icon.ico
└── docs/
    └── layouts.md                # Référence des codes de layouts
```

## 🔑 Concepts Win32 clés

### HKL (Handle to Keyboard Layout)

Identifiant 32 bits d'une disposition clavier. Représenté en hexadécimal 8 caractères :

| Code       | Layout                     |
| ---------- | -------------------------- |
| `00000409` | Anglais US (QWERTY)        |
| `0000040C` | Français (France) AZERTY   |
| `0000080C` | Français (Belgique) AZERTY |
| `00000813` | Néerlandais (Belgique)     |
| `00000407` | Allemand QWERTZ            |
| `00000410` | Italien QWERTY             |

La liste complète est disponible dans la registry Windows :
`HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Keyboard Layouts`

### Séquence de changement de layout

```js
// 1. Charger le layout (retourne un HKL)
const hkl = user32.LoadKeyboardLayoutW("00000409", KLF_ACTIVATE);

// 2. Récupérer la fenêtre active
const hwnd = user32.GetForegroundWindow();

// 3. Demander au système de changer la langue d'input
user32.PostMessageW(hwnd, WM_INPUTLANGCHANGEREQUEST, 0, hkl);
```

### Constantes utiles

```js
const KLF_ACTIVATE = 0x00000001;
const WM_INPUTLANGCHANGEREQUEST = 0x0050;
const HWND_BROADCAST = 0xffff;
```

## 🚀 Installation et développement

### Prérequis

- Node.js ≥ 18
- Windows 10 ou 11
- npm ou yarn

### Installation

```bash
git clone https://github.com/<user>/keyboard-switcher.git
cd keyboard-switcher
npm install
```

### Lancer en développement

```bash
npm run dev
```

### Builder l'installeur

```bash
npm run build
# Génère un .exe dans dist/
```

## 📋 Roadmap de développement

### Étape 1 — Proof of concept (1-2 h)

Script Node pur, sans Electron.

- [ ] Init projet `npm init` + install `active-win`
- [ ] Script qui log le process actif toutes les 500 ms
- [ ] Vérifier la détection fonctionne pendant un `Alt+Tab`

**Livrable :** `poc/watcher.js` qui affiche le nom du process actif en continu.

### Étape 2 — Switch de layout (1-2 h)

- [ ] Install `koffi`
- [ ] Wrapper autour de `LoadKeyboardLayoutW` et `PostMessageW`
- [ ] Tester le switch manuellement en hardcodant BE → US → BE
- [ ] Combiner watcher + switcher avec mapping en dur

**Livrable :** script qui switche automatiquement en QWERTY US quand le jeu est actif, AZERTY BE sinon.

**⚠️ Point critique :** valider que le switch fonctionne bien dans le jeu (certains jeux en plein écran exclusif peuvent résister).

### Étape 3 — Config persistante (1 h)

- [ ] Install `electron-store`
- [ ] Définir schéma de config
- [ ] Externaliser le mapping dans un JSON
- [ ] Fonction de rechargement à chaud de la config

**Livrable :** fichier `config.json` éditable manuellement, chargé au démarrage.

### Étape 4 — Electron + Systray (2-3 h)

- [ ] Migrer le script en app Electron
- [ ] Icône systray avec menu (Pause, Quitter)
- [ ] Pas de fenêtre principale au démarrage (headless + tray)
- [ ] Gestion propre du cycle de vie (quit, second-instance lock)

**Livrable :** app qui se lance discrètement et tourne en arrière-plan.

### Étape 5 — UI de configuration (2-3 h)

- [ ] BrowserWindow avec UI de config
- [ ] Liste des règles avec ajout/suppression/édition
- [ ] Dropdown pour choisir le layout (liste depuis registry ou hardcodée)
- [ ] Sélection de process depuis liste active-win
- [ ] IPC sécurisé main ↔ renderer

**Livrable :** UI fonctionnelle accessible depuis le systray.

### Étape 6 — Packaging et polish (1-2 h)

- [ ] `auto-launch` pour démarrage Windows
- [ ] `electron-builder` pour générer un installeur `.exe`
- [ ] Icône propre pour app et systray
- [ ] Optimisation : skip le switch si layout déjà correct
- [ ] Gestion erreurs (layout non installé, etc.)

**Livrable :** installeur `.exe` distribuable.

## ⚠️ Points d'attention

### Jeux en plein écran exclusif

Certains jeux bloquent ou ignorent les messages `WM_INPUTLANGCHANGEREQUEST`. Tester en priorité avec le cas d'usage réel avant de développer toute l'UI autour. Solutions de contournement possibles :

- Envoi du message à toutes les threads via `ActivateKeyboardLayout`
- Passage en mode fenêtre sans bordure plutôt que plein écran exclusif

### Droits administrateur

Pas nécessaires pour le cas standard. Requis uniquement si on veut switcher le layout d'applications lancées en admin (certains anti-cheat).

### Respect du choix manuel utilisateur

Si l'utilisateur change manuellement de layout (ex: `Win+Espace`) pendant qu'il est sur une app, ne pas écraser son choix immédiatement. Stratégie : mémoriser le dernier layout _automatiquement_ appliqué, et ne re-switcher que si le process actif change.

### Performance

Le polling à 500 ms sur `active-win` est suffisamment léger (< 1 % CPU). Pour aller plus loin : hook Windows `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` pour un vrai event-driven (zéro CPU au repos), mais nécessite un binding natif custom.

## 📚 Ressources

### Documentation technique

- [Microsoft Docs — Keyboard Layout](https://learn.microsoft.com/en-us/windows/win32/inputdev/keyboard-input)
- [Microsoft Docs — LoadKeyboardLayout](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-loadkeyboardlayouta)
- [Microsoft Docs — WM_INPUTLANGCHANGEREQUEST](https://learn.microsoft.com/en-us/windows/win32/inputdev/wm-inputlangchangerequest)

### Librairies

- [Electron](https://www.electronjs.org/docs/latest/)
- [active-win](https://github.com/sindresorhus/active-win)
- [koffi](https://koffi.dev/)
- [electron-store](https://github.com/sindresorhus/electron-store)
- [electron-builder](https://www.electron.build/)

### Référence codes de layout

- [Microsoft — Default Input Profiles (LCIDs)](https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-input-locales-for-windows-language-packs)

## 📝 Licence

MIT

## 🤝 Contribution

Projet personnel à l'origine, mais les suggestions et PRs sont bienvenues. Ouvre une issue pour discuter d'une évolution avant de coder.
