# Keyboard Switcher

Application Windows qui change automatiquement la disposition du clavier en fonction de l'application active. Utile pour basculer automatiquement entre AZERTY et QWERTY selon le logiciel utilisé (typiquement pour les jeux qui imposent un QWERTY).

## Site et téléchargements

- **Page d’accueil (GitHub Pages)** : [eparadow.github.io/keyboard-switcher](https://eparadow.github.io/keyboard-switcher/) — présentation, lien direct vers l’installeur Windows et historique des versions.
- **Première publication** : dans les réglages du dépôt GitHub, activez **Pages** avec la source **GitHub Actions** (le workflow `.github/workflows/pages.yml` déploie le dossier `docs/`).
- **Publier un installeur** : créez un tag de version (`git tag v0.1.0 && git push origin v0.1.0`) ; le workflow **Release Windows installer** construit l’EXE et l’attache à la release GitHub.

Construite avec Electron, `active-win` pour détecter la fenêtre au premier plan et `koffi` pour appeler les API Win32 de changement de layout (`LoadKeyboardLayoutW` + `PostMessageW(WM_INPUTLANGCHANGEREQUEST)`).

## Fonctionnalités

### MVP

- [x] Détection de la fenêtre active (polling 500 ms sur `active-win`)
- [x] Changement automatique de la disposition clavier par application
- [x] Configuration persistante via `electron-store` (mapping processus → layout)

### Fonctionnalités cibles

- [x] Interface graphique de configuration (React)
- [x] Icône dans la zone de notification (systray)
- [x] Démarrage automatique avec Windows (via `auto-launch`)
- [x] Ajout de règles via liste des processus actifs
- [x] Pause temporaire du switch auto
- [x] Indicateur visuel du layout actuel
- [x] Respect du choix manuel utilisateur (si switch `Win+Espace` pendant la session sur un process)

### Évolutions possibles

- [ ] Profils (gaming / travail / etc.)
- [ ] Règles conditionnelles avancées (par titre de fenêtre, pas juste processus)
- [ ] Raccourcis clavier pour switch manuel
- [ ] Export/import de configuration
- [ ] Historique / statistiques d'utilisation

## Prérequis

- Node.js ≥ 18
- Windows 10 ou 11 (l'app utilise des API Win32 spécifiques)
- npm

## Installation

```bash
git clone <repo-url>
cd KeyboardAdapter
npm install
```

## Développement

```bash
npm run dev
```

Cette commande lance deux processus en parallèle via `concurrently` :

- `vite` sert le renderer React sur `http://localhost:5173` (HMR actif)
- `electron` attend que Vite soit prêt (via `wait-on`), puis démarre avec `NODE_ENV=development` et charge l'URL de dev

`Ctrl+C` arrête proprement les deux.

La détection `NODE_ENV=development` dans `src/main/index.js` aiguille la fenêtre de config vers `http://localhost:5173`. En production (app packagée), elle charge le bundle Vite depuis `dist/renderer/index.html`.

## Build

```bash
npm run build
```

Enchaîne le build Vite (`dist/renderer/`) puis `electron-builder --win` qui produit :

- un installeur NSIS dans `dist/installer/` (configurable installation, raccourci bureau, raccourci menu démarrer)

Pour rebuilder l'installeur sans re-transpiler le renderer :

```bash
npm run dist
```

## Structure

```
KeyboardAdapter/
├── package.json
├── electron-builder.yml
├── vite.config.js
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   ├── main/
│   │   ├── index.js              # Entry point Electron (single-instance, lifecycle)
│   │   ├── watcher.js            # Detection fenetre active (active-win)
│   │   ├── switcher.js           # Appels Win32 via koffi
│   │   ├── config.js             # Wrapper electron-store
│   │   ├── tray.js               # Systray + menu contextuel
│   │   ├── ipc.js                # Handlers IPC main <-> renderer
│   │   └── autolaunch.js         # Wrapper auto-launch
│   ├── preload/
│   │   └── index.js              # Bridge contextIsolation (window.api)
│   └── renderer/
│       ├── index.html
│       ├── main.jsx              # Bootstrap React
│       ├── app.jsx               # Composant racine
│       ├── layouts.js            # Table HKL -> label
│       ├── styles.css
│       ├── components/           # StatusPanel, RulesList, AddRuleForm, etc.
│       └── hooks/
│           └── useKeyboardApi.js # Encapsule window.api
├── assets/
│   ├── tray-icon.png             # 32x32 clavier bleu (actif)
│   ├── tray-icon-paused.png      # 32x32 clavier gris (pause)
│   └── app-icon.ico              # multi-taille 16/32/48/64/128/256
├── scripts/
│   └── gen-placeholder-icons.js  # regenere les icones (PNG + ICO)
├── poc/                          # scripts standalone de validation
├── docs/
│   └── layouts.md                # Reference des codes de layouts Windows
└── dist/                         # sortie de build (gitignore)
    ├── renderer/                 # bundle Vite
    └── installer/                # NSIS .exe
```

## PoC scripts

Les scripts dans `poc/` sont des validations isolées (étapes 1-2 de la roadmap initiale). Ils tournent en Node pur, sans Electron :

```bash
node poc/watcher.js    # log le process actif toutes les 500 ms
node poc/switcher.js   # switch manuel de layout BE -> US -> BE
```

Le schéma de config peut être inspecté en standalone :

```bash
node src/main/config.js
```

## Icônes

Les icônes sont générées proceduralement en pixel art (clavier stylisé) sans dépendance externe :

- `assets/tray-icon.png` — 32×32, clavier bleu (état actif)
- `assets/tray-icon-paused.png` — 32×32, clavier gris (état pause)
- `assets/app-icon.ico` — multi-taille (16/32/48/64/128/256), utilisé par la fenêtre, la barre des tâches et l'installeur

Pour les régénérer après modification du script `scripts/gen-placeholder-icons.js` :

```bash
npm run gen-icons
```

## Limitations connues

- **Jeux en plein écran exclusif** : certains jeux bloquent ou ignorent les messages `WM_INPUTLANGCHANGEREQUEST`. Solution recommandée : passer le jeu en mode fenêtre sans bordure. Voir `context.md` § Points d'attention pour d'autres contournements.
- **Respect du choix manuel** : si l'utilisateur change manuellement de layout (`Win+Espace`) pendant qu'une règle s'applique, l'app mémorise son choix et ne re-switche plus tant qu'il reste sur le même processus. Au prochain changement de processus actif, l'automatisme reprend.
- **Droits administrateur** : pas nécessaires pour le cas standard. Requis uniquement pour switcher le layout d'applications lancées en admin (certains anti-cheat).
- **`auto-launch` en dev** : en développement (non packagé), l'entrée de registre créée pointe vers le binaire Electron de `node_modules/.bin/`. Fonctionnel mais peu propre — la feature est réellement destinée à la version packagée.

## Licence

MIT. Voir [LICENSE](LICENSE).
