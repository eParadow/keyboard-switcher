# Keyboard Switcher

Application Windows qui change automatiquement la disposition du clavier en fonction de l'application active. Utile pour basculer automatiquement entre AZERTY et QWERTY selon le logiciel utilisé (par exemple pour les jeux qui imposent un QWERTY).

Construite avec Electron, `active-win` pour détecter la fenêtre au premier plan et `koffi` pour appeler les API Win32 de changement de layout.

## Développement

```bash
npm install
npm run dev
```

`npm run dev` lance Electron en mode développement avec `NODE_ENV=development`.

## Build

```bash
npm run build
```

Ce script compile le renderer avec Vite puis génère un installeur NSIS via `electron-builder`. L'installeur est produit dans `dist/installer/`.

Pour générer uniquement l'installeur sans rebuilder le renderer :

```bash
npm run dist
```

## Structure

- `src/main/` — process principal Electron (watcher, switcher, config, tray, IPC)
- `src/preload/` — script de preload (bridge contextIsolation)
- `src/renderer/` — UI React de configuration
- `assets/` — icônes et ressources statiques
- `docs/` — documentation technique
- `poc/` — scripts standalone de validation (étapes 1-2 de la roadmap)

## Licence

MIT
